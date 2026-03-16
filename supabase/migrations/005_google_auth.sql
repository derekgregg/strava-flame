-- Allow 'google' as a platform in platform_connections
ALTER TABLE platform_connections DROP CONSTRAINT IF EXISTS platform_connections_platform_check;
ALTER TABLE platform_connections ADD CONSTRAINT platform_connections_platform_check
  CHECK (platform IN ('strava', 'wahoo', 'garmin', 'google'));
