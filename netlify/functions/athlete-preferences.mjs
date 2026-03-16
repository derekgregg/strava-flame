import { getSupabase } from './lib/supabase.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const { athleteId, share_with_group, weight } = await req.json();
  if (!athleteId) {
    return new Response(JSON.stringify({ error: 'athleteId required' }), { status: 400 });
  }

  const db = getSupabase();
  const updates = { share_with_group };
  if (weight !== undefined) {
    updates.weight = weight > 0 ? weight : null;
  }
  const { error } = await db
    .from('athletes')
    .update(updates)
    .eq('id', athleteId);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
