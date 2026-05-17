-- v0.9: inbound replies + reply-drafting
--
-- Adds:
--   - `replies`            : every inbound Gmail reply we ingest.
--   - `drafts.reply_to_id` : extends drafts so v0.9+ "auto-drafted reply"
--                            rows can FK back to the reply that prompted
--                            them. Nullable — v0.4-v0.7 cold-outbound
--                            drafts continue to work with NULL.
--   - `gmail_poll_cursor`  : single-row history-id cursor for the poller.
--                            First poll seeds the cursor with the current
--                            Gmail historyId; subsequent polls list new
--                            messages since the stored id.
--   - `reply_settings`     : single-row toggle for auto-reply drafting.
--                            DEFAULT FALSE — the user must explicitly opt
--                            in (trust-tier decision; recorded as a
--                            trust event at toggle time).
--
-- Sentinel: { kind: "table", name: "replies" } — see lib/supabase/migrate.ts.

CREATE TABLE IF NOT EXISTS replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id text NOT NULL UNIQUE,
  gmail_thread_id text NOT NULL,
  sent_message_id uuid REFERENCES sent_messages(id) ON DELETE SET NULL,
  from_email text NOT NULL,
  subject text,
  body text NOT NULL,
  received_at timestamptz NOT NULL,
  classified_intent text,
  classification_model text,
  classified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS replies_thread_id_idx ON replies (gmail_thread_id);
CREATE INDEX IF NOT EXISTS replies_received_at_idx ON replies (received_at DESC);

-- Extend drafts to support reply drafts (FK to the reply being responded to).
-- Idempotent: ADD COLUMN IF NOT EXISTS handles re-runs.
ALTER TABLE drafts ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES replies(id) ON DELETE SET NULL;

-- Polling cursor: track the latest Gmail history id we processed. Single-
-- row table (the orchestrator only ever upserts one row). We use a uuid
-- PK so the column matches the rest of the schema; the cursor logic uses
-- "latest row by updated_at" rather than a deterministic id (cheap on a
-- single-row table; correct under accidental dupe inserts).
CREATE TABLE IF NOT EXISTS gmail_poll_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  last_history_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Auto-reply toggle. Single-row table; default OFF (Tay gate I — the user
-- must explicitly turn this on; flipping it ON records a trust event).
CREATE TABLE IF NOT EXISTS reply_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_reply_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
