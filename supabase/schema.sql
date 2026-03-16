-- Le Directeur — Full Database Schema
-- Run this on a fresh Supabase project

-- 1. Users (platform-agnostic identity)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name TEXT NOT NULL,
  profile_pic TEXT,
  weight REAL,
  share_with_group BOOLEAN DEFAULT false,
  is_tracked BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Platform connections (OAuth tokens per platform per user)
CREATE TABLE platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('strava', 'wahoo', 'garmin', 'google')),
  platform_user_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at BIGINT,
  scopes TEXT,
  platform_profile JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(platform, platform_user_id)
);

CREATE INDEX idx_pc_user_id ON platform_connections(user_id);
CREATE INDEX idx_pc_lookup ON platform_connections(platform, platform_user_id);

-- 3. OAuth state (transient, for CSRF + PKCE)
CREATE TABLE oauth_state (
  state TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  code_verifier TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + interval '10 minutes')
);

-- 4. Activities (the top-level entity)
CREATE TABLE activities (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform_links JSONB DEFAULT '{}',

  -- Core activity data
  name TEXT,
  sport_type TEXT,
  start_date TIMESTAMPTZ,
  distance REAL DEFAULT 0,
  moving_time INTEGER DEFAULT 0,
  elapsed_time INTEGER DEFAULT 0,
  elevation_gain REAL DEFAULT 0,
  average_speed REAL DEFAULT 0,
  max_speed REAL DEFAULT 0,

  -- Power
  average_watts INTEGER,
  max_watts INTEGER,
  normalized_power INTEGER,

  -- Heart rate
  avg_heart_rate SMALLINT,
  max_heart_rate SMALLINT,

  -- Cadence
  avg_cadence SMALLINT,
  max_cadence SMALLINT,

  -- Other metrics
  suffer_score INTEGER,
  calories INTEGER,

  -- Enrichment (from file uploads)
  lap_data JSONB,
  enrichment_data JSONB,

  -- AI commentary
  roast TEXT,
  roast_generated_at TIMESTAMPTZ,

  -- Dedup
  dedup_key TEXT,
  external_id TEXT,

  -- Legacy / query convenience (denormalized from platform_links)
  source_platform TEXT,
  source_activity_id TEXT,
  athlete_id BIGINT,

  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_activities_user ON activities(user_id, start_date DESC);
CREATE INDEX idx_activities_dedup ON activities(user_id, dedup_key) WHERE dedup_key IS NOT NULL;
CREATE INDEX idx_activities_source ON activities(source_platform, source_activity_id) WHERE source_activity_id IS NOT NULL;
CREATE INDEX idx_activities_platform_links ON activities USING gin(platform_links);

-- 5. Uploads (tracks file upload processing status)
CREATE TABLE uploads (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_format TEXT NOT NULL,
  file_size INTEGER,
  activity_name TEXT,
  status TEXT DEFAULT 'pending',
  error_message TEXT,
  activity_id BIGINT REFERENCES activities(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_uploads_user ON uploads(user_id, created_at DESC);

-- 6. Legacy athletes table (kept for backwards compat during migration)
CREATE TABLE athletes (
  id BIGINT PRIMARY KEY,
  firstname TEXT,
  lastname TEXT,
  profile_pic TEXT,
  weight REAL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at BIGINT,
  is_tracked BOOLEAN DEFAULT true,
  share_with_group BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Storage bucket for file uploads
-- Run this separately or create via Supabase dashboard:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('uploads', 'uploads', false);
