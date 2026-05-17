-- v1.0: trust-tier promotion state + Gmail poll cursor single-row constraint.
--
-- Two concerns rolled into one migration so the v1.0 ship gate is a single
-- schema bump.

-- ---------------------------------------------------------------------
-- 1. trust_tiers — cached per-capability promotion state.
--
-- Written by lib/trust/tier.ts:recomputeTrustTier(). Reading is cheap
-- (single-row lookup by capability PK). The cached row is recomputed on
-- demand (Settings → Trust → "Recompute") and on each Tier-3 action's
-- success path in the orchestrator (deferred to a post-ship follow-up).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trust_tiers (
  capability text PRIMARY KEY CHECK (capability IN ('send','reply_send','book')),
  tier text NOT NULL CHECK (tier IN ('tier_0','tier_1','tier_2','tier_3')) DEFAULT 'tier_0',
  promoted_at timestamptz,
  manual_override boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. gmail_poll_cursor — switch to a deterministic single-row pattern.
--
-- v0.9 used random UUID PK + .neq("id","") for advance. That works for
-- a single tenant but is brittle (a second insert would silently
-- accumulate, and the .neq quirk is hard to read). We migrate to the
-- same SINGLE_ROW_ID + UNIQUE lock_col pattern used elsewhere
-- (reply_settings, oauth/persist).
--
-- Note: v0.9 hasn't been deployed live yet (per builds/STATE.md), so
-- there's no production data to migrate. Existing rows (if a dev
-- happened to seed one) are squashed at runtime by the upsert path in
-- lib/reply/poll.ts.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gmail_poll_cursor_single_row'
  ) THEN
    -- Add the sentinel "lock" column (default 1) and uniquely constrain
    -- it so at most one row can exist in the table.
    ALTER TABLE gmail_poll_cursor
      ADD COLUMN IF NOT EXISTS lock_col integer NOT NULL DEFAULT 1;
    ALTER TABLE gmail_poll_cursor
      ADD CONSTRAINT gmail_poll_cursor_single_row UNIQUE (lock_col);
  END IF;
END$$;
