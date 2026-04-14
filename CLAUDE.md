# CLAUDE.md

## Project Overview

Le Directeur is a cycling activity analysis app that generates AI-powered brutally honest commentary. Users sign in with Google, connect fitness platforms (Strava, Wahoo, Garmin), or upload activity files (.FIT, .GPX, .TCX) directly. Activities are analyzed for power, intervals, and best efforts, then Claude generates commentary displayed on a shared leaderboard with route maps.

## Tech Stack

- **Frontend:** Plain HTML/CSS/JS, built with Vite. Leaflet for maps.
- **Backend:** Netlify Functions (`.mjs`, ESM)
- **Database:** Supabase (PostgreSQL + Storage)
- **AI:** Claude API (Sonnet) via `@anthropic-ai/sdk`
- **Activity parsing:** `fit-file-parser`, `fast-xml-parser`
- **Maps:** Leaflet + CartoDB dark tiles, Google encoded polylines
- **Package manager:** pnpm

## Commands

- `pnpm run build` — Vite production build
- `pnpm run dev` — Local dev via `netlify dev` (port 8888)
- `supabase db push` — Push pending migrations to remote database
- Netlify Functions are at `netlify/functions/`, served under `/api/*`

## Data Model

**Activity is the top-level entity.** An activity represents one real-world ride/run and may be linked to multiple sources via `platform_links` JSONB (`{"strava": "123", "garmin": "456", "upload": "upload:abc"}`).

Key tables:
- `users` — platform-agnostic identity (Google auth, display name, weight, height, FTP)
- `platform_connections` — OAuth tokens per platform per user (strava, wahoo, garmin, google)
- `activities` — the activity itself with stats, commentary, route polyline, enrichment data
- `uploads` — tracks file upload processing status
- `oauth_state` — transient CSRF/PKCE state

## Activity Processing Pipeline

1. Activity arrives via webhook (Strava/Wahoo/Garmin), backfill, or file upload
2. Dedup checks: platform_links match → dedup key (start time + distance) → fuzzy match
3. If duplicate, merge platform link and fill missing data fields
4. If new, insert and run power analysis (best efforts, NP, VI, TSS, intervals)
5. Generate AI commentary via Claude with full context (stats, efforts, laps, user FTP/weight/height)
6. Store route polyline (from Strava map or encoded from FIT/GPX GPS data)

## Power Analysis

Per-second power data is analyzed from FIT files and Strava streams API:
- **Best efforts:** 5s, 15s, 30s, 1min, 3min, 5min, 8min, 10min, 15min, 20min, 30min, 45min, 60min, 90min
- **Normalized Power (NP):** 30s rolling average raised to 4th power
- **Variability Index:** NP / avg power (surgy vs steady)
- **Intensity Factor:** NP / FTP
- **TSS:** Training Stress Score
- **Interval detection:** 3+ sustained efforts above 85% FTP

## Deduplication

Users often sync Garmin→Strava or Wahoo→Strava, creating duplicates. Dedup matches on:
1. Exact platform_links match (same source re-processed)
2. Dedup key: start time (rounded to minute) + distance (rounded to 100m)
3. Fuzzy: start within 2 minutes + distance within 15%

Duration is NOT used for dedup — Strava excludes stopped time, Garmin/FIT files don't.

## Platform API Compliance

### Strava — CRITICAL
- **7-day data retention.** Strava-sourced activities purged daily. Never store longer.
- **Community Application** exception (< 10,000 users) allows shared data display with opt-in.
- **"View on Strava"** link required on all Strava-sourced activity cards.
- **"Powered by Strava"** logo in footer.
- **No AI training.** Claude used for inference only.
- **No "Strava" in app name.** The app is "Le Directeur".
- Full agreement saved in `docs/strava-api-agreement.md`.

### Wahoo (INACTIVE)
- API access request never received a response. Connect option disabled in UI, code retained.
- No hard data retention limit. We use 30-day retention.
- Must attribute with Wahoo branding.
- Full agreement saved in `docs/wahoo-api-agreement.md`.

### Garmin (INACTIVE)
- API access was denied. Connect option disabled in UI, code retained.
- No hard data retention limit. We use 30-day retention.
- Must display "Garmin [device model]" attribution.
- Agreement provided during developer application (not public).

## Environment Variables

All secrets in `.env` (gitignored) and Netlify dashboard:

```
STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_VERIFY_TOKEN
SUPABASE_URL, SUPABASE_SERVICE_KEY
ANTHROPIC_API_KEY
ADMIN_SECRET, ADMIN_ATHLETE_ID
SITE_URL
JWT_SECRET
WAHOO_CLIENT_ID, WAHOO_CLIENT_SECRET, WAHOO_WEBHOOK_TOKEN
GARMIN_CLIENT_ID, GARMIN_CLIENT_SECRET
GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
GITHUB_TOKEN
```

## Git / Deployment

- **Production deploys from the `deploy` branch only.** Pushes to `main` do NOT trigger Netlify deploys. To deploy: `git checkout deploy && git merge main && git push origin deploy && git checkout main`
- Day-to-day development happens on `main`. Push freely without burning build credits.
- Custom domain: `ledirecteur.app`. Netlify domain: `le-directeur.netlify.app`.
- Database migrations managed via `supabase db push`.

## Key Architecture Decisions

- **Activity-first model:** Activities are the top-level object, linked to platforms via `platform_links` JSONB. No single "source platform" owns an activity.
- **Background functions:** File parsing and backfill use `-background.mjs` suffix (15-min timeout). Regular functions have 10s limit.
- **Internal dispatch:** Background functions called via `${SITE_URL}/api/` path (not `/.netlify/functions/`) to work with custom domains.
- **JWT sessions:** HMAC-SHA256 signed cookies (`directeur_session`), 30-day expiry. No external auth service.
- **Polyline storage:** GPS tracks stored as Google encoded polylines (compact text). Simplified with Douglas-Peucker before encoding.

## Design

- **Color palette:** Dark bottle green (#1a2418) background, aged cream (#d4c5a0) accents, warm gold (#c9a84c) highlights, deep red (#8b2500) for errors. Inspired by Bénédictine liqueur labels.
- **Fonts:** Cormorant Garamond serif for headers, Courier monospace for commentary, system sans-serif for body.
- **Maps:** CartoDB dark tiles with gold polylines.
- **Do not use the words "flame" or "roast" in user-facing text.** Use "commentary" instead.
