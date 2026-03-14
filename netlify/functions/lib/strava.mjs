import { getSupabase } from './supabase.mjs';

const STRAVA_API = 'https://www.strava.com/api/v3';
const TOKEN_URL = 'https://www.strava.com/oauth/token';

export function getOAuthURL() {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: `${process.env.SITE_URL}/api/strava-callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
  });
  return `https://www.strava.com/oauth/authorize?${params}`;
}

export async function exchangeToken(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  return res.json();
}

export async function refreshAccessToken(athleteId) {
  const db = getSupabase();
  const { data: athlete } = await db
    .from('athletes')
    .select('refresh_token, access_token, token_expires_at')
    .eq('id', athleteId)
    .single();

  if (!athlete) throw new Error(`Athlete ${athleteId} not found`);

  // Return existing token if still valid (with 60s buffer)
  if (athlete.token_expires_at > Math.floor(Date.now() / 1000) + 60) {
    return athlete.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: athlete.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

  const data = await res.json();
  await db
    .from('athletes')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: data.expires_at,
    })
    .eq('id', athleteId);

  return data.access_token;
}

export async function getActivity(athleteId, activityId) {
  const token = await refreshAccessToken(athleteId);
  const res = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Activity fetch failed: ${res.status}`);
  return res.json();
}

export async function upsertAthlete(tokenData) {
  const db = getSupabase();
  const athlete = tokenData.athlete;
  const { error } = await db.from('athletes').upsert({
    id: athlete.id,
    firstname: athlete.firstname,
    lastname: athlete.lastname,
    profile_pic: athlete.profile_medium || athlete.profile,
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_expires_at: tokenData.expires_at,
    is_tracked: true,
  });
  if (error) throw error;
  return athlete;
}
