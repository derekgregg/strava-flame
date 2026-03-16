import { getSupabase } from './lib/supabase.mjs';
import { getAthleteActivities, getActivity, normalizeActivity } from './lib/strava.mjs';
import { listWorkouts, normalizeActivity as normalizeWahooActivity } from './lib/wahoo.mjs';
import { processActivity } from './lib/activity.mjs';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { userId, athleteId, platform } = JSON.parse(event.body);

  if (platform === 'wahoo' && userId) {
    await backfillWahoo(userId);
  } else if (athleteId) {
    await backfillStrava(userId, athleteId);
  }

  return { statusCode: 200, body: JSON.stringify({ status: 'backfill complete' }) };
};

async function backfillStrava(userId, athleteId) {
  const db = getSupabase();

  // Get user (try new schema first, then legacy)
  let user;
  if (userId) {
    const { data } = await db.from('users').select('*').eq('id', userId).single();
    user = data;
  }

  // Last 7 days (Strava API terms: max 7-day cache)
  const after = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const activities = await getAthleteActivities(athleteId, after);
  console.log(`Backfill: found ${activities.length} Strava activities for athlete ${athleteId}`);

  for (const summary of activities) {
    // Check if already stored (dedup handles cross-platform, this just skips re-fetching)
    const { data: existing } = await db
      .from('activities')
      .select('id')
      .contains('platform_links', { strava: String(summary.id) })
      .single();

    if (existing) continue;

    const rawActivity = await getActivity(athleteId, summary.id);
    const activity = normalizeActivity(rawActivity);

    if (userId && user) {
      await processActivity({
        userId,
        platform: 'strava',
        platformActivityId: String(summary.id),
        activity,
        user,
      });
    } else {
      // Legacy path
      const { data: athlete } = await db.from('athletes').select('*').eq('id', athleteId).single();
      if (!athlete) continue;

      await db.from('activities').upsert({
        id: rawActivity.id,
        athlete_id: athleteId,
        name: rawActivity.name,
        distance: rawActivity.distance,
        moving_time: rawActivity.moving_time,
        elapsed_time: rawActivity.elapsed_time,
        elevation_gain: rawActivity.total_elevation_gain,
        average_speed: rawActivity.average_speed,
        max_speed: rawActivity.max_speed,
        average_watts: rawActivity.average_watts || null,
        max_watts: rawActivity.max_watts || null,
        suffer_score: rawActivity.suffer_score || null,
        start_date: rawActivity.start_date,
        sport_type: rawActivity.sport_type || rawActivity.type,
        source_platform: 'strava',
        source_activity_id: String(rawActivity.id),
      });

      if (athlete.weight) rawActivity.athlete_weight = athlete.weight;
      try {
        const { generateRoast } = await import('./lib/claude.mjs');
        const roast = await generateRoast(rawActivity, athlete);
        await db.from('activities')
          .update({ roast, roast_generated_at: new Date().toISOString() })
          .eq('id', rawActivity.id);
      } catch (err) {
        console.error(`Backfill roast failed for ${rawActivity.id}:`, err);
      }
    }
  }

  console.log(`Strava backfill complete for athlete ${athleteId}`);
}

async function backfillWahoo(userId) {
  const db = getSupabase();
  const { data: user } = await db.from('users').select('*').eq('id', userId).single();
  if (!user) return;

  // Fetch recent workouts (last 7 days worth)
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let page = 1;

  while (page <= 5) { // Max 5 pages
    let result;
    try {
      result = await listWorkouts(userId, page);
    } catch (err) {
      console.error('Wahoo backfill list error:', err);
      break;
    }

    const workouts = result.workouts || [];
    if (!workouts.length) break;

    for (const w of workouts) {
      const workout = w.workout || w;
      if (new Date(workout.starts) < cutoff) continue;

      const activity = normalizeWahooActivity(workout, w.workout_summary);
      await processActivity({
        userId,
        platform: 'wahoo',
        platformActivityId: String(workout.id),
        activity,
        user,
      });
    }

    page++;
  }

  console.log(`Wahoo backfill complete for user ${userId}`);
}
