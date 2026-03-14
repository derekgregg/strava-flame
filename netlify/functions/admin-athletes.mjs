import { getSupabase } from './lib/supabase.mjs';

function checkAuth(req) {
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${process.env.ADMIN_SECRET}`;
}

export default async (req) => {
  if (!checkAuth(req)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const db = getSupabase();

  // GET — list all athletes
  if (req.method === 'GET') {
    const { data, error } = await db
      .from('athletes')
      .select('id, firstname, lastname, profile_pic, is_tracked, share_with_group, created_at')
      .order('created_at', { ascending: false });

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // POST — toggle tracking
  if (req.method === 'POST') {
    const { athleteId, is_tracked } = await req.json();
    const { error } = await db
      .from('athletes')
      .update({ is_tracked })
      .eq('id', athleteId);

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // DELETE — remove athlete and their activities
  if (req.method === 'DELETE') {
    const { athleteId } = await req.json();
    await db.from('activities').delete().eq('athlete_id', athleteId);
    await db.from('athletes').delete().eq('id', athleteId);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Method not allowed', { status: 405 });
};
