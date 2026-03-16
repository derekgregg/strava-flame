import { getSupabase } from './lib/supabase.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
  }

  const { platform } = await req.json();
  if (!['strava', 'wahoo', 'garmin'].includes(platform)) {
    return new Response(JSON.stringify({ error: 'Invalid platform' }), { status: 400 });
  }

  const db = getSupabase();

  // Check that user has at least one other connection
  const { data: connections } = await db
    .from('platform_connections')
    .select('id, platform')
    .eq('user_id', userId);

  const otherConnections = (connections || []).filter(c => c.platform !== platform);
  if (otherConnections.length === 0) {
    return new Response(JSON.stringify({ error: 'Cannot disconnect your only platform. Delete your account instead.' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get all activities for this user that have this platform linked
  const { data: activities } = await db
    .from('activities')
    .select('id, platform_links')
    .eq('user_id', userId)
    .contains('platform_links', { [platform]: '' })
    .not('platform_links', 'is', null);

  // For activities linked ONLY to this platform, delete them.
  // For activities linked to multiple platforms, remove this platform's link.
  if (activities) {
    for (const a of activities) {
      const links = { ...(a.platform_links || {}) };
      delete links[platform];

      if (Object.keys(links).length === 0) {
        await db.from('activities').delete().eq('id', a.id);
      } else {
        await db.from('activities').update({ platform_links: links }).eq('id', a.id);
      }
    }
  }

  // Also clean up any activities only tracked via source_platform (legacy)
  await db.from('activities')
    .delete()
    .eq('user_id', userId)
    .eq('source_platform', platform)
    .or('platform_links.is.null,platform_links.eq.{}');

  // Remove the platform connection
  await db.from('platform_connections')
    .delete()
    .eq('user_id', userId)
    .eq('platform', platform);

  console.log(`User ${userId} disconnected ${platform}`);

  return new Response(JSON.stringify({ success: true }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
