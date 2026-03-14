import { getSupabase } from './lib/supabase.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const sort = url.searchParams.get('sort') || 'start_date';
  const order = url.searchParams.get('order') || 'desc';
  const athleteId = url.searchParams.get('athlete_id');
  const sportType = url.searchParams.get('sport_type');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  const allowedSorts = ['start_date', 'distance', 'average_speed', 'moving_time', 'elevation_gain'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'start_date';
  const ascending = order === 'asc';

  const db = getSupabase();

  // Only show activities from athletes who opted in to group sharing
  let query = db
    .from('activities')
    .select('*, athletes!inner(id, firstname, lastname, profile_pic, share_with_group)')
    .eq('athletes.share_with_group', true)
    .not('roast', 'is', null)
    .order(sortCol, { ascending })
    .limit(limit);

  if (athleteId) query = query.eq('athlete_id', parseInt(athleteId));
  if (sportType) query = query.eq('sport_type', sportType);

  const { data, error } = await query;

  if (error) {
    console.error('Leaderboard query error:', error);
    return new Response(JSON.stringify({ error: 'Query failed' }), { status: 500 });
  }

  // Only show opted-in athletes in filter dropdown
  const { data: athletes } = await db
    .from('athletes')
    .select('id, firstname, lastname')
    .eq('is_tracked', true)
    .eq('share_with_group', true)
    .order('firstname');

  return new Response(JSON.stringify({ activities: data || [], athletes: athletes || [] }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30',
    },
  });
};
