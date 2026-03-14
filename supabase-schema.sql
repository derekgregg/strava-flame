-- Strava Flame: Supabase schema
-- Run this in the Supabase SQL editor to set up the database

CREATE TABLE IF NOT EXISTS athletes (
  id BIGINT PRIMARY KEY,  -- Strava athlete ID
  firstname TEXT,
  lastname TEXT,
  profile_pic TEXT,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at BIGINT,
  is_tracked BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id BIGINT PRIMARY KEY,  -- Strava activity ID
  athlete_id BIGINT REFERENCES athletes(id),
  name TEXT,
  distance DOUBLE PRECISION,
  moving_time INTEGER,
  elapsed_time INTEGER,
  elevation_gain DOUBLE PRECISION,
  average_speed DOUBLE PRECISION,
  max_speed DOUBLE PRECISION,
  average_watts DOUBLE PRECISION,
  max_watts DOUBLE PRECISION,
  suffer_score INTEGER,
  start_date TIMESTAMPTZ,
  sport_type TEXT,
  roast TEXT,
  roast_generated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activities_athlete ON activities(athlete_id);
CREATE INDEX IF NOT EXISTS idx_activities_start_date ON activities(start_date DESC);
CREATE INDEX IF NOT EXISTS idx_activities_sport_type ON activities(sport_type);

-- Enable Row Level Security (keeping it open since we use service key)
ALTER TABLE athletes ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS, so no policies needed for our backend
