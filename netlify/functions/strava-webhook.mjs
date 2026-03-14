import { getSupabase } from './lib/supabase.mjs';
import { getActivity, refreshAccessToken } from './lib/strava.mjs';
import { generateRoast } from './lib/claude.mjs';

export default async (req) => {
  // GET = webhook validation from Strava
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === process.env.STRAVA_VERIFY_TOKEN) {
      return new Response(JSON.stringify({ 'hub.challenge': challenge }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('Forbidden', { status: 403 });
  }

  // POST = incoming webhook event
  if (req.method === 'POST') {
    const event = await req.json();
    console.log('Webhook event:', JSON.stringify(event));

    // Handle athlete deauthorization
    if (event.object_type === 'athlete' && event.updates?.authorized === 'false') {
      const db = getSupabase();
      const athleteId = event.owner_id;
      await db.from('activities').delete().eq('athlete_id', athleteId);
      await db.from('athletes').delete().eq('id', athleteId);
      console.log(`Deauthorized athlete ${athleteId} — data deleted`);
      return new Response('OK', { status: 200 });
    }

    // Only process new/updated activities
    if (event.object_type !== 'activity') {
      return new Response('OK', { status: 200 });
    }

    // Skip deleted activities
    if (event.aspect_type === 'delete') {
      const db = getSupabase();
      await db.from('activities').delete().eq('id', event.object_id);
      return new Response('OK', { status: 200 });
    }

    // Process asynchronously — respond immediately to Strava
    // Strava requires 2s response time
    const athleteId = event.owner_id;
    const activityId = event.object_id;

    // Fire and forget — process in background
    processActivity(athleteId, activityId).catch((err) =>
      console.error('Activity processing error:', err)
    );

    return new Response('OK', { status: 200 });
  }

  return new Response('Method not allowed', { status: 405 });
};

async function processActivity(athleteId, activityId) {
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
    return;
  }

  // Fetch activity from Strava
  const activity = await getActivity(athleteId, activityId);

  // Store activity
  const activityRow = {
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
  };

  await db.from('activities').upsert(activityRow);

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
}
