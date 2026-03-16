import { getSupabase } from './lib/supabase.mjs';
import { getActivity } from './lib/strava.mjs';
import { generateRoast } from './lib/claude.mjs';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const { athleteId, activityId } = JSON.parse(event.body);
  if (!athleteId || !activityId) {
    return { statusCode: 400, body: 'Missing athleteId or activityId' };
  }

  const db = getSupabase();

  // Check if athlete is tracked
  const { data: athlete } = await db
    .from('athletes')
    .select('*')
    .eq('id', athleteId)
    .eq('is_tracked', true)
    .single();

  if (!athlete) {
    console.log(`Athlete ${athleteId} not tracked, skipping`);
    return { statusCode: 200, body: 'Athlete not tracked' };
  }

  // Fetch activity from Strava
  const activity = await getActivity(athleteId, activityId);

  // Store activity
  await db.from('activities').upsert({
    id: activity.id,
    athlete_id: athleteId,
    name: activity.name,
    distance: activity.distance,
    moving_time: activity.moving_time,
    elapsed_time: activity.elapsed_time,
    elevation_gain: activity.total_elevation_gain,
    average_speed: activity.average_speed,
    max_speed: activity.max_speed,
    average_watts: activity.average_watts || null,
    max_watts: activity.max_watts || null,
    suffer_score: activity.suffer_score || null,
    start_date: activity.start_date,
    sport_type: activity.sport_type || activity.type,
  });

  // Attach athlete weight for W/kg calculation in roast prompt
  if (athlete.weight) {
    activity.athlete_weight = athlete.weight;
  }

  // Generate roast
  try {
    const roast = await generateRoast(activity, athlete);
    await db
      .from('activities')
      .update({ roast, roast_generated_at: new Date().toISOString() })
      .eq('id', activityId);
    console.log(`Roast generated for activity ${activityId}`);
  } catch (err) {
    console.error(`Roast generation failed for ${activityId}:`, err);
  }

  return { statusCode: 200, body: 'OK' };
};
