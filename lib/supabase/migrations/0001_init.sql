-- Tay v0.2 init migration.
--
-- Idempotent: every CREATE uses IF NOT EXISTS so re-running this against an
-- already-migrated DB is a no-op. The migration runner also pre-checks for
-- the existence of `app_config` before applying.
--
-- Tay gate B (no special-category data): these tables collect ONLY
-- operational fields. No race, religion, health, sexual orientation,
-- political opinion, biometric, or genetic columns — by design and by
-- review. Future migrations must hold this line.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Single-row config table. One install = one config. The setup wizard
-- writes one row; updates overwrite it (delete + insert in a txn).
CREATE TABLE IF NOT EXISTS app_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  validated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Prospect skeleton. v0.4+ will extend with company-domain, source, status,
-- last-contacted, etc. v0.2 just stakes the table out so the migration
-- runner has something to migrate.
CREATE TABLE IF NOT EXISTS prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text,
  company text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Audit log skeleton. v0.6 wires the hash chain over Tier-3 actions
-- (send, judge decision, override). `prev_hash` / `this_hash` columns are
-- present now so v0.6 doesn't need a schema migration just to start
-- chaining. `bigserial` because audit volume is monotonic-append and we
-- want fast ordered scans.
CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  payload jsonb NOT NULL,
  prev_hash text,
  this_hash text
);
