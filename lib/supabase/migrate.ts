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
