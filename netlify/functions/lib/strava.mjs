import { getSupabase } from './supabase.mjs';

const STRAVA_API = 'https://www.strava.com/api/v3';
const TOKEN_URL = 'https://www.strava.com/oauth/token';

export function getOAuthURL(state) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: `${process.env.SITE_URL}/api/strava-callback`,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state: state || '',
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

// Refresh access token using platform_connections table
export async function refreshAccessToken(platformUserId) {
  const db = getSupabase();
  const { data: conn } = await db
    .from('platform_connections')
    .select('id, access_token, refresh_token, token_expires_at')
    .eq('platform', 'strava')
    .eq('platform_user_id', platformUserId)
    .single();

  if (!conn) {
    // Fallback: try legacy athletes table during migration
    return refreshAccessTokenLegacy(platformUserId);
  }

  // Return existing token if still valid (with 60s buffer)
  if (conn.token_expires_at > Math.floor(Date.now() / 1000) + 60) {
    return conn.access_token;
  }

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: 'refresh_token',
      refresh_token: conn.refresh_token,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

  const data = await res.json();
  await db
    .from('platform_connections')
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_expires_at: data.expires_at,
      updated_at: new Date().toISOString(),
    })
    .eq('id', conn.id);

  return data.access_token;
}

// Legacy fallback for migration period
async function refreshAccessTokenLegacy(athleteId) {
  const db = getSupabase();
  const { data: athlete } = await db
    .from('athletes')
    .select('refresh_token, access_token, token_expires_at')
    .eq('id', athleteId)
    .single();

  if (!athlete) throw new Error(`Athlete ${athleteId} not found`);

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
  const token = await refreshAccessToken(String(athleteId));
  const res = await fetch(`${STRAVA_API}/activities/${activityId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Activity fetch failed: ${res.status}`);
  return res.json();
}

export async function getAthleteActivities(athleteId, after) {
  const token = await refreshAccessToken(String(athleteId));
  const activities = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      after: String(after),
      per_page: '50',
      page: String(page),
    });
    const res = await fetch(`${STRAVA_API}/athlete/activities?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Activities list failed: ${res.status}`);
    const batch = await res.json();
    if (!batch.length) break;
    activities.push(...batch);
    page++;
  }

  return activities;
}

export async function getActivityStreams(athleteId, activityId) {
  const token = await refreshAccessToken(String(athleteId));
  const res = await fetch(
    `${STRAVA_API}/activities/${activityId}/streams?keys=time,latlng,distance,altitude,velocity_smooth,heartrate,cadence,watts,temp,moving,grade_smooth&key_by_type=true`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  return res.json();
}

// Convert Strava streams response to canonical streams object.
// Strava returns { watts: { data: [...] }, heartrate: { data: [...] }, ... }
// or an array of { type, data } objects. We normalize to a flat keyed object.
export function normalizeStreams(stravaStreams) {
  if (!stravaStreams) return null;

  // Handle array format
  if (Array.isArray(stravaStreams)) {
    const keyed = {};
    for (const s of stravaStreams) keyed[s.type] = s.data;
    return {
      time: keyed.time || null,
      watts: keyed.watts || null,
      heartrate: keyed.heartrate || null,
      cadence: keyed.cadence || null,
      altitude: keyed.altitude || null,
      distance: keyed.distance || null,
      velocity_smooth: keyed.velocity_smooth || null,
      grade_smooth: keyed.grade_smooth || null,
      latlng: keyed.latlng || null,
      temp: keyed.temp || null,
      moving: keyed.moving || null,
    };
  }

  // Handle keyed object format
  return {
    time: stravaStreams.time?.data || null,
    watts: stravaStreams.watts?.data || null,
    heartrate: stravaStreams.heartrate?.data || null,
    cadence: stravaStreams.cadence?.data || null,
    altitude: stravaStreams.altitude?.data || null,
    distance: stravaStreams.distance?.data || null,
    velocity_smooth: stravaStreams.velocity_smooth?.data || null,
    grade_smooth: stravaStreams.grade_smooth?.data || null,
    latlng: stravaStreams.latlng?.data || null,
    temp: stravaStreams.temp?.data || null,
    moving: stravaStreams.moving?.data || null,
  };
}

// Normalize Strava activity to our standard format
export function normalizeActivity(stravaActivity) {
  return {
    name: stravaActivity.name,
    sport_type: stravaActivity.sport_type || stravaActivity.type,
    start_date: stravaActivity.start_date,
    distance: stravaActivity.distance || 0,
    moving_time: stravaActivity.moving_time || 0,
    elapsed_time: stravaActivity.elapsed_time || 0,
    total_elevation_gain: stravaActivity.total_elevation_gain || 0,
    average_speed: stravaActivity.average_speed || 0,
    max_speed: stravaActivity.max_speed || 0,
    average_watts: stravaActivity.average_watts || null,
    max_watts: stravaActivity.max_watts || null,
    average_heartrate: stravaActivity.average_heartrate || null,
    suffer_score: stravaActivity.suffer_score || null,
    external_id: stravaActivity.external_id || null,
    route_polyline: stravaActivity.map?.polyline || stravaActivity.map?.summary_polyline || null,
  };
}
