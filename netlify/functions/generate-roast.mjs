import { getSupabase } from './lib/supabase.mjs';
import { generateRoast } from './lib/claude.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Admin-only endpoint
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.ADMIN_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const { activityId } = await req.json();
  if (!activityId) {
    return new Response(JSON.stringify({ error: 'activityId required' }), { status: 400 });
  }

  const db = getSupabase();

  // Get activity and athlete
  const { data: activity } = await db
    .from('activities')
    .select('*, athletes(*)')
    .eq('id', activityId)
    .single();

  if (!activity) {
    return new Response(JSON.stringify({ error: 'Activity not found' }), { status: 404 });
  }

  try {
    const roast = await generateRoast(activity, activity.athletes);
    await db
      .from('activities')
      .update({ roast, roast_generated_at: new Date().toISOString() })
      .eq('id', activityId);

    return new Response(JSON.stringify({ roast }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Roast generation error:', err);
    return new Response(JSON.stringify({ error: 'Roast generation failed' }), { status: 500 });
  }
};
