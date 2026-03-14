import { exchangeToken, upsertAthlete } from './lib/strava.mjs';

export default async (req) => {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=${error}` },
    });
  }

  if (!code) {
    return new Response(JSON.stringify({ error: 'Missing code' }), { status: 400 });
  }

  try {
    const tokenData = await exchangeToken(code);
    const athlete = await upsertAthlete(tokenData);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${process.env.SITE_URL}/callback.html?success=true&name=${encodeURIComponent(athlete.firstname)}`,
      },
    });
  } catch (err) {
    console.error('OAuth callback error:', err);
    return new Response(null, {
      status: 302,
      headers: { Location: `${process.env.SITE_URL}/callback.html?error=token_exchange_failed` },
    });
  }
};
