# Le Directeur

Your brutally honest directeur sportif. An AI-powered cycling activity analysis app that generates savage commentary on your rides.

## What It Does

Upload a .FIT file, connect Strava, Wahoo, or Garmin — Le Directeur analyzes your power data, detects intervals, computes best efforts, and delivers brutally honest commentary on every ride. Activities are displayed on a shared leaderboard with route maps.

## Features

- **Multi-platform:** Strava, Wahoo, Garmin, Google sign-in, direct file uploads (.FIT, .GPX, .TCX)
- **Power analysis:** Best efforts (5s to 90min), Normalized Power, Variability Index, TSS, interval detection
- **AI commentary:** Claude generates context-aware commentary using your FTP, weight, height, best efforts, lap splits, and intervals
- **Route maps:** GPS tracks rendered on dark map tiles via Leaflet
- **Activity deduplication:** Automatically merges the same ride from multiple platforms
- **Privacy-first:** Opt-in group sharing, 7-day Strava retention, GDPR/CCPA compliant

## Tech Stack

- **Frontend:** HTML/CSS/JS, Vite, Leaflet
- **Backend:** Netlify Functions (Node.js ESM)
- **Database:** Supabase (PostgreSQL + Storage)
- **AI:** Claude API (Sonnet) via Anthropic SDK
- **Parsing:** fit-file-parser, fast-xml-parser

## Setup

### 1. Clone and install

```bash
git clone git@github.com:derekgregg/directeur.git
cd directeur
pnpm install
```

### 2. Create external services

- **Supabase:** Create a project, run `supabase/schema.sql` in the SQL editor, create an `uploads` storage bucket (private)
- **Strava API:** Create an app at https://developers.strava.com
- **Google OAuth:** Create credentials at https://console.cloud.google.com
- **Anthropic:** Get an API key at https://console.anthropic.com

### 3. Configure environment

Create `.env` with:

```
STRAVA_CLIENT_ID=
STRAVA_CLIENT_SECRET=
STRAVA_VERIFY_TOKEN=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
ANTHROPIC_API_KEY=
ADMIN_SECRET=
SITE_URL=http://localhost:8888
JWT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_TOKEN=
```

Optional (when platform integrations are approved):
```
WAHOO_CLIENT_ID=
WAHOO_CLIENT_SECRET=
WAHOO_WEBHOOK_TOKEN=
GARMIN_CLIENT_ID=
GARMIN_CLIENT_SECRET=
```

### 4. Run locally

```bash
pnpm run dev
```

### 5. Deploy

```bash
# Development pushes (no deploy)
git push origin main

# Production deploy
git checkout deploy && git merge main && git push origin deploy && git checkout main
```

### 6. Register Strava webhook

```bash
curl -X POST https://www.strava.com/api/v3/push_subscriptions \
  -F client_id=YOUR_CLIENT_ID \
  -F client_secret=YOUR_CLIENT_SECRET \
  -F callback_url=https://ledirecteur.app/api/strava-webhook \
  -F verify_token=YOUR_VERIFY_TOKEN
```

## Project Structure

```
src/                              Frontend (Vite)
  index.html                      Leaderboard
  upload.html                     File upload page
  settings.html                   User settings + feed
  callback.html                   OAuth callback
  privacy.html                    Privacy policy
  css/style.css                   Dark green + gold theme
  js/
    app.js                        Leaderboard + maps
    upload.js                     File upload + progress
    settings.js                   Profile + connections
    auth.js                       OAuth callback handler

netlify/functions/                Backend
  lib/
    activity.mjs                  Unified activity processor + dedup
    auth.mjs                      JWT sessions
    claude.mjs                    AI prompt builder
    dedup.mjs                     Deduplication engine
    file-parser.mjs               FIT/GPX/TCX parser
    garmin.mjs                    Garmin API client
    polyline.mjs                  Polyline encoder/decoder
    power-analysis.mjs            Best efforts, NP, intervals
    strava.mjs                    Strava API client
    supabase.mjs                  Database client
    wahoo.mjs                     Wahoo API client
  google-auth.mjs                 Google OAuth
  strava-auth.mjs                 Strava OAuth
  wahoo-auth.mjs                  Wahoo OAuth
  garmin-auth.mjs                 Garmin OAuth (PKCE)
  *-callback.mjs                  OAuth callbacks
  *-webhook.mjs                   Platform webhooks
  upload-activity.mjs             File upload intake
  parse-upload-background.mjs     Async file processing
  get-leaderboard.mjs             Public leaderboard API
  get-feed.mjs                    Personal feed API
  get-user.mjs                    Current user API
  report-bug.mjs                  GitHub issue creation

supabase/
  schema.sql                      Full database schema
  migrations/                     Incremental migrations

docs/                             API references + agreements
```

## Privacy & Compliance

- Privacy policy at [ledirecteur.app/privacy.html](https://ledirecteur.app/privacy.html)
- Strava: 7-day data retention, "View on Strava" links, "Powered by Strava" attribution
- GDPR/CCPA compliant, opt-in data sharing
- Claude used for inference only, never training

---

[ledirecteur.app](https://ledirecteur.app)
