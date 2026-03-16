import { getSupabase } from './lib/supabase.mjs';
import { createSessionToken, getSessionCookie, getUserIdFromRequest } from './lib/auth.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  const state = url.searchParams.get('state');

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=${error}&platform=google` },
    });
  }

  if (!code || !state) {
    return new Response(JSON.stringify({ error: 'Missing code or state' }), { status: 400 });
  }

  const db = getSupabase();

  // Validate state
  const { data: oauthState } = await db
    .from('oauth_state')
    .select('*')
    .eq('state', state)
    .single();

  if (!oauthState) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=invalid_state&platform=google` },
    });
  }
  await db.from('oauth_state').delete().eq('state', state);

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: `${process.env.SITE_URL}/api/google-callback`,
      }),
    });

    if (!tokenRes.ok) throw new Error(`Google token exchange failed: ${tokenRes.status}`);
    const tokenData = await tokenRes.json();

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error(`Google userinfo failed: ${userRes.status}`);
    const googleUser = await userRes.json();

    // Find or create user
    let userId = getUserIdFromRequest(req) || oauthState.user_id;

    // Check if this Google account is already linked
    const { data: existing } = await db
      .from('platform_connections')
      .select('user_id')
      .eq('platform', 'google')
      .eq('platform_user_id', googleUser.id)
      .single();

    if (existing) {
      userId = existing.user_id;
      // Update profile pic if changed
      await db.from('users').update({
        profile_pic: googleUser.picture || undefined,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
    } else if (userId) {
      // Logged-in user linking Google — add connection
      await db.from('platform_connections').insert({
        user_id: userId,
        platform: 'google',
        platform_user_id: googleUser.id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || '',
        token_expires_at: tokenData.expires_in
          ? Math.floor(Date.now() / 1000) + tokenData.expires_in
          : null,
        platform_profile: { email: googleUser.email, name: googleUser.name, picture: googleUser.picture },
      });
    } else {
      // New user — create account
      const { data: newUser, error: userError } = await db
        .from('users')
        .insert({
          display_name: googleUser.name || googleUser.email,
          profile_pic: googleUser.picture || null,
        })
        .select('id')
        .single();
      if (userError) throw userError;
      userId = newUser.id;

      await db.from('platform_connections').insert({
        user_id: userId,
        platform: 'google',
        platform_user_id: googleUser.id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token || '',
        token_expires_at: tokenData.expires_in
          ? Math.floor(Date.now() / 1000) + tokenData.expires_in
          : null,
        platform_profile: { email: googleUser.email, name: googleUser.name, picture: googleUser.picture },
      });
    }

    const token = createSessionToken(userId);
    const name = googleUser.given_name || googleUser.name || 'there';

    return new Response(null, {
      status: 302,
      headers: {
        Location: `${process.env.SITE_URL}/callback.html?success=true&name=${encodeURIComponent(name)}&user_id=${userId}&platform=google`,
        'Set-Cookie': getSessionCookie(token),
      },
    });
  } catch (err) {
    console.error('Google OAuth error:', err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=login_failed&platform=google` },
    });
  }
};
