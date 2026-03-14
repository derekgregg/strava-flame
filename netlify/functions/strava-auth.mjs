import { getOAuthURL } from './lib/strava.mjs';

export default async () => {
  return new Response(null, {
    status: 302,
    headers: { Location: getOAuthURL() },
  });
};
