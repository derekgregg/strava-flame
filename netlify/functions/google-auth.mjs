import { randomBytes } from 'crypto';
import { getSupabase } from './lib/supabase.mjs';
import { getUserIdFromRequest } from './lib/auth.mjs';

export default async (req) => {
  const db = getSupabase();
  const state = randomBytes(16).toString('hex');
  const userId = getUserIdFromRequest(req);

  await db.from('oauth_state').insert({
    state,
    platform: 'google',
    user_id: userId || null,
  });

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${process.env.SITE_URL}/api/google-callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  return new Response(null, {
    status: 302,
    headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}` },
  });
};
