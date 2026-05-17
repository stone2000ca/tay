// Auto-migration runner for Tay.
//
// Strategy: on first server cold-start, check if `app_config` exists. If
// not, apply `0001_init.sql` in a transaction. If yes, skip. If env vars
// are missing (Supabase not linked yet — pre-wizard, local dev), skip
// silently. Never throws — callers get a result tuple, and a page render
// must never fail because we couldn't reach the DB.
//
// Caching: module-scoped Promise so a hundred concurrent page loads on a
// cold start dedupe to one DB round-trip. Per-server-instance — Vercel
// will obviously cold-start more than one worker, but the pre-check
// short-circuits all later workers cheaply.
//
// Bundling: we ship the SQL inline as a string constant (INIT_SQL_INLINE)
// AND attempt to read the on-disk copy. Inline wins if the disk read
// fails — Turbopack's handling of `__dirname` for non-JS assets is
// inconsistent, and we'd rather succeed than be elegant. The on-disk file
// is the source of truth for humans; the inline string is the source of
// truth for the runtime.

import { Client } from "pg";
import { promises as fs } from "node:fs";
import path from "node:path";

export type MigrateResult = {
  ran: boolean;
  skipped: boolean;
  error?: string;
};

// Keep in sync with lib/supabase/migrations/0001_init.sql. The on-disk file
// is the human-readable source of truth; this inline copy is the runtime
// fallback for bundlers that don't ship the .sql alongside the JS.
const INIT_SQL_INLINE = `
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
`;

let cached: Promise<MigrateResult> | null = null;

/**
 * Idempotent schema bootstrap. Safe to call from any server entrypoint;
 * deduplicates within a single Node process via a module-scoped promise.
 *
 * Returns a result tuple; never throws.
 */
export function ensureSchema(): Promise<MigrateResult> {
  if (cached) return cached;
  cached = runMigrationOnce();
  return cached;
}

/** Test-only: reset the dedupe cache so a new call actually re-runs. */
export function __resetMigrateCacheForTests(): void {
  cached = null;
}

async function runMigrationOnce(): Promise<MigrateResult> {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;

  if (!connectionString) {
    return { ran: false, skipped: true };
  }

  let client: Client | null = null;
  try {
    client = new Client({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();

    // Cheap pre-check: if `app_config` already exists, treat as migrated.
    const exists = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'app_config'
       ) AS exists`,
    );
    if (exists.rows[0]?.exists) {
      return { ran: false, skipped: true };
    }

    const sql = await loadInitSql();

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("COMMIT");
    } catch (inner) {
      await client.query("ROLLBACK").catch(() => {
        /* swallow; original error is more interesting */
      });
      throw inner;
    }

    return { ran: true, skipped: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Never log raw connection string / service-role key. `message` from pg
    // can include the DSN on connection failure — strip anything that looks
    // like one.
    console.warn("[migrate] schema bootstrap failed:", redact(message));
    return { ran: false, skipped: false, error: message };
  } finally {
    if (client) {
      await client.end().catch(() => {
        /* swallow; we already have our result */
      });
    }
  }
}

async function loadInitSql(): Promise<string> {
  // Try disk first; fall back to the inlined copy. Inline keeps us alive
  // when the bundler doesn't ship the .sql file (Turbopack quirks).
  // The disk read is a "nice to have" — INIT_SQL_INLINE is the runtime
  // source of truth. Turbopack will warn about NFT tracing process.cwd()
  // here; the warning is benign because we don't actually depend on the
  // file being bundled.
  const candidates = [
    path.join(process.cwd(), "lib", "supabase", "migrations", "0001_init.sql"),
  ];
  for (const candidate of candidates) {
    try {
      const text = await fs.readFile(candidate, "utf8");
      if (text.trim().length > 0) return text;
    } catch {
      // ignore; try the next candidate
    }
  }
  return INIT_SQL_INLINE;
}

function redact(message: string): string {
  // postgres://user:pass@host:port/db  →  postgres://***@host:port/db
  return message.replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, "postgres://***@");
}
