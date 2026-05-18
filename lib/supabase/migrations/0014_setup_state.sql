-- v1.1.3: track wizard completion so users aren't perpetually redirected
-- through the post-rubric polish steps (preview → sample → test-send →
-- prospect-quickadd). Once setup_complete=true, the /app/page.tsx
-- redirect chain stops short of the wizard and lands on the dashboard.
--
-- Both columns are ADD IF NOT EXISTS so re-running this migration is a
-- no-op (matches the idempotence convention of every migration in this
-- tree).
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS setup_complete boolean NOT NULL DEFAULT false;

ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;
