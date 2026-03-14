# Flame

A community web app that generates AI-powered humorous commentary on your group's Strava activities. Friends connect their Strava accounts, and every activity gets a personalized roast displayed on a shared leaderboard.

## How It Works

1. Athletes authorize via Strava OAuth
2. New activities arrive via Strava's Webhook Events API
3. Activity stats are sent to Claude (Sonnet) to generate a roast
4. Roasts appear on the shared group leaderboard

Athletes must opt in to share their activities with the group. Activity data is automatically purged after 7 days per Strava's API caching policy.

## Tech Stack

- **Frontend:** HTML/CSS/JS with Vite
- **Backend:** Netlify Functions (Node.js)
- **Database:** Supabase (PostgreSQL)
- **AI:** Claude API (Sonnet) for roast generation
- **Auth:** Strava OAuth 2.0

## Setup

### 1. Clone and install

```bash
git clone git@github.com:derekgregg/strava-flame.git
cd strava-flame
pnpm install
```

### 2. Create external services

- **Supabase:** Create a project and run `supabase-schema.sql` in the SQL editor
- **Strava API:** Create an app at https://developers.strava.com
- **Anthropic:** Get an API key at https://console.anthropic.com

### 3. Configure environment

Copy `.env` and fill in your values:

```
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_VERIFY_TOKEN=          # random string for webhook validation
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ANTHROPIC_API_KEY=
ADMIN_SECRET=                 # random string for admin panel auth
ADMIN_ATHLETE_ID=             # your Strava athlete ID
SITE_URL=http://localhost:8888
```

Set the same variables in Netlify: `netlify env:import .env`

### 4. Deploy

Push to GitHub — Netlify builds automatically from `main`.

Update `SITE_URL` in Netlify env vars to your production URL.

### 5. Register Strava webhook

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://your-site.netlify.app/api/strava-webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

### 6. Connect athletes

Share your site URL with friends. They click "Connect Strava", authorize, and opt in to group sharing.

## Project Structure

```
├── src/                        # Frontend (Vite)
│   ├── index.html              # Leaderboard
│   ├── admin.html              # Admin panel
│   ├── callback.html           # OAuth callback
│   ├── css/style.css
│   └── js/
│       ├── app.js              # Leaderboard logic
│       ├── admin.js            # Admin panel logic
│       └── auth.js             # OAuth callback handler
├── netlify/functions/          # Backend
│   ├── strava-auth.mjs         # OAuth redirect
│   ├── strava-callback.mjs     # Token exchange
│   ├── strava-webhook.mjs      # Webhook handler
│   ├── generate-roast.mjs      # Regenerate roast (admin)
│   ├── get-leaderboard.mjs     # Leaderboard API
│   ├── admin-athletes.mjs      # Athlete management
│   ├── athlete-preferences.mjs # Privacy opt-in
│   ├── purge-old-activities.mjs# Daily 7-day cleanup
│   ├── backfill-activities-background.mjs
│   └── lib/
│       ├── supabase.mjs
│       ├── strava.mjs
│       └── claude.mjs
├── supabase-schema.sql         # Database schema
└── netlify.toml                # Build + redirect config
```

## Strava API Compliance

- Athletes explicitly opt in before data is shared with the group
- Activity data purged after 7 days
- Deauthorization deletes all athlete data immediately
- "Powered by Strava" attribution displayed
- "View on Strava" links on all activity cards
- App name does not contain "Strava"

---

Compatible with Strava
