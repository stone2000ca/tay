// Auto-migration runner for Tay.
//
// Strategy: on first server cold-start, apply every migration in
// `lib/supabase/migrations/*.sql` in lexicographic order. Each migration
// is idempotent (CREATE … IF NOT EXISTS) so re-running is safe. We wrap
// each migration in its own transaction. If env vars are missing
// (Supabase not linked yet — pre-wizard, local dev), skip silently.
// Never throws — callers get a result tuple, and a page render must never
// fail because we couldn't reach the DB.
//
// Caching: module-scoped Promise so a hundred concurrent page loads on a
// cold start dedupe to one DB round-trip. Per-server-instance — Vercel
// will obviously cold-start more than one worker, but the per-migration
// pre-check short-circuits later workers cheaply.
//
// Bundling: we ship the SQL inline as a MIGRATIONS_INLINE map AND attempt
// to read each on-disk copy. Inline wins if the disk read fails —
// Turbopack's handling of `__dirname` for non-JS assets is inconsistent,
// and we'd rather succeed than be elegant. The on-disk files are the
// source of truth for humans; the inline map is the source of truth for
// the runtime.

import { Client } from "pg";
import { promises as fs } from "node:fs";
import path from "node:path";

export type MigrateResult = {
  ran: boolean;
  skipped: boolean;
  error?: string;
  /** Names of migrations actually applied this call (lexicographic). */
  applied?: string[];
};

// Keep keys in sync with lib/supabase/migrations/*.sql filenames. The
// on-disk files are the human-readable source of truth; these inline
// strings are the runtime fallback for bundlers that don't ship .sql
// alongside the JS.
const MIGRATIONS_INLINE: Record<string, string> = {
  "0001_init.sql": `
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS app_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  validated_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  full_name text,
  company text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action text NOT NULL,
  payload jsonb NOT NULL,
  prev_hash text,
  this_hash text
);
`,
  "0002_voice_calibration.sql": `
CREATE TABLE IF NOT EXISTS voice_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric jsonb NOT NULL,
  sample_count integer NOT NULL,
  model_used text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  "0003_drafts.sql": `
ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  subject text NOT NULL,
  body text NOT NULL,
  model_used text NOT NULL,
  rubric_snapshot jsonb NOT NULL,
  prompt_inputs jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drafts_prospect_id_created_at_idx
  ON drafts (prospect_id, created_at DESC);
`,
  "0004_judge_decisions.sql": `
CREATE TABLE IF NOT EXISTS judge_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('allow','block','revise','escalate')),
  reasons jsonb NOT NULL,
  rewrite jsonb,
  model_used text NOT NULL,
  rubric_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS judge_decisions_draft_id_idx
  ON judge_decisions (draft_id);

CREATE INDEX IF NOT EXISTS judge_decisions_decision_created_at_idx
  ON judge_decisions (decision, created_at DESC);
`,
  "0005_audit_index.sql": `
CREATE INDEX IF NOT EXISTS audit_log_occurred_at_idx
  ON audit_log (occurred_at DESC, id DESC);
`,
  "0006_google_oauth.sql": `
CREATE TABLE IF NOT EXISTS google_oauth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_address text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  access_token_encrypted text,
  access_token_expires_at timestamptz,
  scopes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  "0007_sent_messages_and_trust.sql": `
CREATE TABLE IF NOT EXISTS sent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  gmail_thread_id text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  recipient_email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sent_messages_prospect_id_sent_at_idx
  ON sent_messages (prospect_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS trust_events (
  id bigserial PRIMARY KEY,
  capability text NOT NULL CHECK (capability IN ('send','reply_send','book')),
  event_type text NOT NULL CHECK (event_type IN ('sent','blocked_by_judge','blocked_by_suppression','override_to_send','override_to_skip','bounced','complained','replied_positive','replied_negative')),
  metadata jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trust_events_capability_event_type_idx
  ON trust_events (capability, event_type);
`,
  "0008_suppression_and_constraints.sql": `
-- v0.8 suppression list (Tay gate E load-bearing)
CREATE TABLE IF NOT EXISTS suppression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_lower text NOT NULL UNIQUE,
  reason text NOT NULL CHECK (reason IN ('user_unsubscribe','bounce','complaint','manual_add')),
  source text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppression_added_at_idx ON suppression (added_at DESC);

-- v0.7 carry-forward #1: backstop orchestrator's already-sent race with
-- DB-level UNIQUE constraint on sent_messages.draft_id. Wrapped in a
-- DO block so the ALTER is idempotent (re-runs are no-ops once the
-- constraint exists).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sent_messages_draft_id_unique'
  ) THEN
    ALTER TABLE sent_messages
      ADD CONSTRAINT sent_messages_draft_id_unique UNIQUE (draft_id);
  END IF;
END$$;
`,
  "0009_replies_and_reply_drafts.sql": `
-- v0.9 inbound replies + reply drafts + Gmail poll cursor + auto-reply toggle.
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

ALTER TABLE drafts ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES replies(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS gmail_poll_cursor (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  last_history_id text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reply_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auto_reply_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  "0010_trust_tiers_and_polling_fixes.sql": `
-- v1.0: trust-tier promotion state + Gmail poll cursor single-row constraint.
CREATE TABLE IF NOT EXISTS trust_tiers (
  capability text PRIMARY KEY CHECK (capability IN ('send','reply_send','book')),
  tier text NOT NULL CHECK (tier IN ('tier_0','tier_1','tier_2','tier_3')) DEFAULT 'tier_0',
  promoted_at timestamptz,
  manual_override boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'gmail_poll_cursor_single_row'
  ) THEN
    ALTER TABLE gmail_poll_cursor
      ADD COLUMN IF NOT EXISTS lock_col integer NOT NULL DEFAULT 1;
    ALTER TABLE gmail_poll_cursor
      ADD CONSTRAINT gmail_poll_cursor_single_row UNIQUE (lock_col);
  END IF;
END$$;
`,
  "0011_instance_secrets.sql": `
-- v1.1.1: instance secrets — single-row table holding the HKDF salt and
-- the user's BYO LLM provider key (encrypted via the derived oauth secret).
CREATE TABLE IF NOT EXISTS instance_secrets (
  lock_col integer NOT NULL DEFAULT 1 UNIQUE,
  salt bytea NOT NULL,
  llm_provider text CHECK (llm_provider IN ('anthropic','openai','openrouter')),
  llm_key_ciphertext text,
  llm_key_fingerprint text,
  llm_key_set_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  "0012_mailbox_credentials.sql": `
-- v1.1.2: unified mailbox credentials supporting both Gmail OAuth and SMTP
-- App Password. Replaces v0.7's google_oauth table as the new primary read
-- target; google_oauth stays as a backwards-compat fallback (lazy
-- migration). Single-row pattern (lock_col UNIQUE DEFAULT 1).
CREATE TABLE IF NOT EXISTS mailbox_credentials (
  lock_col integer NOT NULL DEFAULT 1 UNIQUE,
  kind text NOT NULL CHECK (kind IN ('oauth', 'app_password')),
  email_address text NOT NULL,
  oauth_refresh_token_encrypted text,
  oauth_access_token_encrypted text,
  oauth_access_token_expires_at timestamptz,
  oauth_scopes text,
  smtp_password_encrypted text,
  smtp_host text,
  smtp_port integer,
  imap_host text,
  imap_port integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
  "0013_imap_poll_cursor.sql": `
-- v1.1.2.5: IMAP poll cursor (single-row, parallel to gmail_poll_cursor from v0.9).
-- Tracks the last IMAP UID we processed; next poll starts from UID+1.
--
-- IMAP UIDs are monotonically increasing per-mailbox (RFC 3501 §2.3.1.1).
-- A \`last_uid = 0\` value means "first poll — seed from current highest UID
-- without backfill" (same pattern as gmail_poll_cursor's first-poll seed).
CREATE TABLE IF NOT EXISTS imap_poll_cursor (
  lock_col integer NOT NULL DEFAULT 1 UNIQUE,
  last_uid bigint NOT NULL DEFAULT 0,
  mailbox_path text NOT NULL DEFAULT 'INBOX',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
`,
  "0014_setup_state.sql": `
-- v1.1.3: track wizard completion so users aren't perpetually redirected
-- through the post-rubric polish steps (preview → sample → test-send →
-- prospect-quickadd). Once setup_complete=true, the /app/page.tsx
-- redirect chain stops short of the wizard and lands on the dashboard.
ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS setup_complete boolean NOT NULL DEFAULT false;

ALTER TABLE app_config
  ADD COLUMN IF NOT EXISTS setup_completed_at timestamptz;
`,
  "0015_notification_preferences.sql": `
-- v1.1.4: reply notification preferences (single-row, single-tenant).
-- Channel = email (default — zero extra setup), slack_webhook (Advanced),
-- or none. Slack webhook URL stored encrypted (reuse lib/oauth/crypto).
-- email_override lets the user send notifications elsewhere than their
-- connected mailbox. enabled_for_intents is a comma-separated list of
-- ReplyIntent values (default: ALL).
CREATE TABLE IF NOT EXISTS notification_preferences (
  lock_col integer NOT NULL DEFAULT 1 UNIQUE,
  channel text NOT NULL CHECK (channel IN ('email', 'slack_webhook', 'none')) DEFAULT 'email',
  slack_webhook_url_encrypted text,
  email_override text,
  enabled_for_intents text NOT NULL DEFAULT 'interested,not_interested,unsubscribe_request,out_of_office,other',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`,
};

// Lexicographic order is the migration apply order. Filenames are
// numerically prefixed (`0001_`, `0002_`, ...) so this matches intent.
const MIGRATION_FILES = Object.keys(MIGRATIONS_INLINE).sort();

let cached: Promise<MigrateResult> | null = null;

/**
 * Idempotent schema bootstrap. Safe to call from any server entrypoint;
 * deduplicates within a single Node process via a module-scoped promise.
 *
 * Returns a result tuple; never throws.
 */
export function ensureSchema(): Promise<MigrateResult> {
  if (cached) return cached;
  cached = runMigrationsOnce();
  return cached;
}

/** Test-only: reset the dedupe cache so a new call actually re-runs. */
export function __resetMigrateCacheForTests(): void {
  cached = null;
}

async function runMigrationsOnce(): Promise<MigrateResult> {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;

  if (!connectionString) {
    return { ran: false, skipped: true };
  }

  let client: Client | null = null;
  const applied: string[] = [];
  try {
    client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();

    for (const file of MIGRATION_FILES) {
      // Per-migration idempotence is on the SQL (CREATE IF NOT EXISTS),
      // but we also pre-check a sentinel per migration so we skip the
      // entire SQL apply when it's already been run. Cheaper, and avoids
      // any unforeseen side-effects of re-running DDL.
      const sentinel = sentinelFor(file);
      const { sql: sentinelSql, params: sentinelParams } =
        sentinelQuery(sentinel);
      const existsRes = await client.query<{ exists: boolean }>(
        sentinelSql,
        sentinelParams,
      );
      if (existsRes.rows[0]?.exists) {
        continue;
      }

      const sql = await loadMigrationSql(file);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("COMMIT");
        applied.push(file);
      } catch (inner) {
        await client.query("ROLLBACK").catch(() => {
          /* swallow; original error is more interesting */
        });
        throw inner;
      }
    }

    return {
      ran: applied.length > 0,
      skipped: applied.length === 0,
      applied,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never log raw connection string / service-role key. `message` from pg
    // can include the DSN on connection failure — strip anything that looks
    // like one.
    console.warn("[migrate] schema bootstrap failed:", redact(message));
    return { ran: false, skipped: false, error: message, applied };
  } finally {
    if (client) {
      await client.end().catch(() => {
        /* swallow; we already have our result */
      });
    }
  }
}

type Sentinel =
  | { kind: "table"; table: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "index"; index: string };

/**
 * Sentinel for each migration. Pick evidence that the migration ran:
 *  - `table`: a table the migration creates (most common).
 *  - `column`: a column added by ALTER (used when the migration both
 *    ALTERs and CREATEs — the column is the more specific signal that
 *    THIS migration ran, vs a future migration that recreates the table).
 * Keep in sync if migration contents change.
 */
function sentinelFor(file: string): Sentinel {
  switch (file) {
    case "0001_init.sql":
      return { kind: "table", table: "app_config" };
    case "0002_voice_calibration.sql":
      return { kind: "table", table: "voice_calibration" };
    case "0003_drafts.sql":
      // 0003 both creates `drafts` AND alters `prospects` to add `notes`.
      // The `notes` column is the strictly-stronger signal: if it exists,
      // the migration definitely ran (a fresh install without 0003 would
      // never have it). Checking drafts alone would miss the edge case
      // where a prior partial-failure left drafts created but the ALTER
      // unrolled.
      return { kind: "column", table: "prospects", column: "notes" };
    case "0004_judge_decisions.sql":
      return { kind: "table", table: "judge_decisions" };
    case "0005_audit_index.sql":
      // 0005 is index-only — the audit_log TABLE already exists from
      // 0001 so a table sentinel would say "already there" and skip
      // the index. Check for the index itself.
      return { kind: "index", index: "audit_log_occurred_at_idx" };
    case "0006_google_oauth.sql":
      return { kind: "table", table: "google_oauth" };
    case "0007_sent_messages_and_trust.sql":
      // 0007 creates two tables — pick the one that strictly belongs to
      // this migration (sent_messages — trust_events is also unique to
      // 0007 but sent_messages is the more semantically central one).
      return { kind: "table", table: "sent_messages" };
    case "0008_suppression_and_constraints.sql":
      // 0008 creates the suppression table AND adds a UNIQUE constraint
      // to sent_messages. The suppression table is the strictly-stronger
      // signal: if it exists, this migration ran. The constraint-add is
      // already idempotent via the DO block, so re-running the SQL when
      // the constraint exists but the table somehow doesn't would still
      // be safe.
      return { kind: "table", table: "suppression" };
    case "0009_replies_and_reply_drafts.sql":
      // 0009 creates `replies`, `gmail_poll_cursor`, `reply_settings` AND
      // alters `drafts` to add `reply_to_id`. The `replies` table is the
      // strictly-stronger signal: if it exists, this migration ran. The
      // ALTER is idempotent via ADD COLUMN IF NOT EXISTS.
      return { kind: "table", table: "replies" };
    case "0010_trust_tiers_and_polling_fixes.sql":
      // 0010 creates `trust_tiers` AND adds a UNIQUE constraint
      // (`gmail_poll_cursor_single_row`) to gmail_poll_cursor. The
      // trust_tiers table is the strictly-stronger signal: if it exists,
      // this migration ran. The constraint-add is idempotent via the DO
      // block, so re-running when the constraint exists but the table
      // somehow doesn't would still be safe.
      return { kind: "table", table: "trust_tiers" };
    case "0011_instance_secrets.sql":
      // 0011 creates the single instance_secrets table. Once the table
      // exists, the salt-bootstrap path in lib/secrets/derive.ts handles
      // populating the lone row on first cold start — that's not a
      // migration concern.
      return { kind: "table", table: "instance_secrets" };
    case "0012_mailbox_credentials.sql":
      // 0012 creates the single mailbox_credentials table. The lazy
      // migration from google_oauth happens in lib/mailbox/persist.ts on
      // first read after deploy.
      return { kind: "table", table: "mailbox_credentials" };
    case "0013_imap_poll_cursor.sql":
      // 0013 creates the single imap_poll_cursor table. Same single-row
      // pattern as gmail_poll_cursor; lib/reply/imap-poll.ts seeds the
      // lone row on first poll (no backfill).
      return { kind: "table", table: "imap_poll_cursor" };
    case "0014_setup_state.sql":
      // 0014 is ALTER-only — both columns added via ADD IF NOT EXISTS.
      // The setup_complete column is the strictly-stronger signal: if
      // it exists, the migration ran. (Same column-sentinel pattern as
      // 0003's `notes` column on `prospects`.)
      return { kind: "column", table: "app_config", column: "setup_complete" };
    case "0015_notification_preferences.sql":
      // 0015 creates the single notification_preferences table. Same
      // single-row pattern as instance_secrets / mailbox_credentials /
      // gmail_poll_cursor / imap_poll_cursor — the lone row is seeded
      // lazily on first write (setPreferences); reads soft-fail to
      // defaults when empty.
      return { kind: "table", table: "notification_preferences" };
    default:
      // Unknown file — return an impossible table so the pre-check fails
      // closed and we re-run the SQL. Idempotent CREATEs make this safe.
      return { kind: "table", table: `__tay_unknown_${file}` };
  }
}

function sentinelQuery(sentinel: Sentinel): {
  sql: string;
  params: string[];
} {
  if (sentinel.kind === "table") {
    return {
      sql: `SELECT EXISTS (
              SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = $1
            ) AS exists`,
      params: [sentinel.table],
    };
  }
  if (sentinel.kind === "column") {
    return {
      sql: `SELECT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND table_name = $1
                AND column_name = $2
            ) AS exists`,
      params: [sentinel.table, sentinel.column],
    };
  }
  // kind === "index" — pg_indexes is the canonical place to look.
  return {
    sql: `SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE schemaname = 'public' AND indexname = $1
          ) AS exists`,
    params: [sentinel.index],
  };
}

async function loadMigrationSql(file: string): Promise<string> {
  // Try disk first; fall back to the inlined copy. Inline keeps us alive
  // when the bundler doesn't ship the .sql file (Turbopack quirks).
  // The disk read is a "nice to have" — MIGRATIONS_INLINE is the runtime
  // source of truth.
  const candidate = path.join(
    process.cwd(),
    "lib",
    "supabase",
    "migrations",
    file,
  );
  try {
    const text = await fs.readFile(candidate, "utf8");
    if (text.trim().length > 0) return text;
  } catch {
    // ignore; fall through to inline
  }
  const inline = MIGRATIONS_INLINE[file];
  if (!inline) {
    throw new Error(`[migrate] no inline SQL for migration: ${file}`);
  }
  return inline;
}

function redact(message: string): string {
  // postgres://user:pass@host:port/db  →  postgres://***@host:port/db
  return message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://***@");
}
