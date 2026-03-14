-- Migration: Add share_with_group privacy toggle
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS share_with_group BOOLEAN DEFAULT false;

-- Purge old activities (run periodically or via cron)
-- DELETE FROM activities WHERE start_date < now() - interval '7 days';
