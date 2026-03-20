import { getSupabase } from './lib/supabase.mjs';

function checkAuth(req) {
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${process.env.ADMIN_SECRET}`;
}

export default async (req) => {
  if (!checkAuth(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const db = getSupabase();

  // Find all tracked users with Strava connections
  const { data: connections, error } = await db
    .from('platform_connections')
    .select('user_id, platform_user_id, users!inner(id, is_tracked)')
    .eq('platform', 'strava')
    .eq('users.is_tracked', true);

  if (error) {
    console.error('Failed to fetch connections:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  // Also get legacy tracked athletes
  const { data: legacyAthletes } = await db
    .from('athletes')
    .select('id')
    .eq('is_tracked', true);

  const dispatched = [];

  // Dispatch backfill for each new-schema user
  for (const conn of connections || []) {
    const url = `${process.env.SITE_URL}/api/backfill-activities-background`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: conn.user_id,
          athleteId: Number(conn.platform_user_id),
          platform: 'strava',
        }),
      });
      dispatched.push({ userId: conn.user_id, athleteId: conn.platform_user_id, schema: 'new' });
      console.log(`Dispatched backfill for user ${conn.user_id} (athlete ${conn.platform_user_id})`);
    } catch (err) {
      console.error(`Failed to dispatch backfill for user ${conn.user_id}:`, err);
    }
  }

  // Dispatch for legacy athletes not already covered
  const coveredAthleteIds = new Set((connections || []).map((c) => c.platform_user_id));
  for (const athlete of legacyAthletes || []) {
    if (coveredAthleteIds.has(String(athlete.id))) continue;
    const url = `${process.env.SITE_URL}/api/backfill-activities-background`;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athleteId: athlete.id, platform: 'strava' }),
      });
      dispatched.push({ athleteId: athlete.id, schema: 'legacy' });
      console.log(`Dispatched legacy backfill for athlete ${athlete.id}`);
    } catch (err) {
      console.error(`Failed to dispatch legacy backfill for athlete ${athlete.id}:`, err);
    }
  }

  return new Response(JSON.stringify({ dispatched, count: dispatched.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
