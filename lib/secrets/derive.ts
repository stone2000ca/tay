// Tay v1.1.1 — instance secret derivation (HKDF-SHA256).
//
// The user no longer pastes TAY_OAUTH_SECRET / CRON_SECRET into their
// hosting env. Instead, every per-purpose secret is DERIVED from two
// things they already manage:
//
//   IKM  (input keying material) = SUPABASE_SERVICE_ROLE_KEY
//   salt                         = 32 random bytes stored in
//                                  instance_secrets.salt (single row;
//                                  generated on first cold start)
//   info                         = `tay-${purpose}-secret-v1`
//
// Output: 64-char lowercase hex string — matches the existing SECRET_REGEX
// in lib/oauth/crypto.ts + lib/unsubscribe/token.ts, so the AES-GCM /
// HMAC code below stays byte-compatible.
//
// Why HKDF, why this shape:
//   - Per-purpose `info` strings give each consumer a key that's
//     cryptographically independent of the others. If someone learns
//     the unsubscribe HMAC secret they don't learn the OAuth AES key.
//   - The salt lives in the DB (not the env) so re-deploying the same
//     code against the same Supabase project converges on the same
//     derived secrets — no "lost the env var, all tokens dead" failure
//     mode that bit v0.x users.
//   - Rotating the SUPABASE_SERVICE_ROLE_KEY rotates every derived
//     secret (intentional — surfaced as a banner on /settings/secrets).
//
// READ-VS-WRITE contract:
//   - getInstanceSecret(): READ-ish. Throws if neither IKM nor env-var
//     fallback is available — callers in lib/oauth/crypto.ts etc.
//     re-throw with a friendly message. Soft-fail isn't safe here:
//     returning an empty key would silently mis-encrypt.
//   - ensureSalt(): WRITE on first call; READ on subsequent calls.
//     Race-safe via INSERT ... ON CONFLICT DO NOTHING + re-read.
//
// Backwards-compat env-var fallback:
//   For developers on v0.x who set TAY_OAUTH_SECRET / CRON_SECRET in
//   .env.local, we fall back to those values when the Supabase
//   service-role key is absent. Logs a deprecation warning so the
//   misconfig is visible. Disappears in v1.2.

import { hkdfSync, randomBytes } from "node:crypto";
import { Client } from "pg";

export type SecretPurpose = "oauth" | "unsubscribe" | "cron";

const TABLE = "instance_secrets";
const HKDF_HASH = "sha256";
const HKDF_KEY_LEN = 32; // 32 bytes → 64 hex chars
const SALT_BYTES = 32;

// Module-scoped cache: the salt is read once per cold start. The Promise
// is cached so concurrent callers dedupe to one DB round-trip.
let saltCache: Promise<Buffer> | null = null;

/**
 * Derive a 64-char lowercase hex secret for a given purpose.
 *
 * Format invariant: the returned string matches `/^[0-9a-f]{64}$/`,
 * which is what lib/oauth/crypto.ts and lib/unsubscribe/token.ts
 * accept (SECRET_REGEX is case-insensitive but our derive output
 * is lowercase by convention).
 */
export async function getInstanceSecret(
  purpose: SecretPurpose,
): Promise<string> {
  const ikm = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

  // -- Backwards-compat env-var fallback (v0.x → v1.x bridge).
  // If the service-role key is missing AND the user has the v0.x env
  // var set, honor it. Logs once per derived value so the misconfig
  // is visible in server logs.
  if (ikm.length === 0) {
    const fallback = envFallback(purpose);
    if (fallback) {
      console.warn(
        `[secrets] Using env-var fallback for ${purpose}; will switch to derived once SUPABASE_SERVICE_ROLE_KEY is set.`,
      );
      return fallback;
    }
    throw new Error(
      "Cannot derive instance secret: SUPABASE_SERVICE_ROLE_KEY is not set and no env-var fallback found. Link Supabase via the Vercel Marketplace.",
    );
  }

  const salt = await ensureSalt();
  const info = Buffer.from(`tay-${purpose}-secret-v1`, "utf8");
  const derived = hkdfSync(
    HKDF_HASH,
    Buffer.from(ikm, "utf8"),
    salt,
    info,
    HKDF_KEY_LEN,
  );
  return Buffer.from(derived).toString("hex");
}

/**
 * Return the IKM-less env-var fallback for a purpose, if one exists.
 * Only `oauth` and `cron` had dedicated env vars in v0.x — `unsubscribe`
 * piggybacked on TAY_OAUTH_SECRET, so its fallback also reads that var.
 *
 * Validates the fallback against the same 64-hex shape we'd produce
 * ourselves. A malformed env-var is treated as "no fallback" — we'd
 * rather throw than encrypt with garbage.
 */
function envFallback(purpose: SecretPurpose): string | null {
  let raw: string | undefined;
  if (purpose === "cron") {
    raw = process.env.CRON_SECRET;
  } else {
    // oauth + unsubscribe shared the same secret in v0.x.
    raw = process.env.TAY_OAUTH_SECRET;
  }
  if (!raw) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) return null;
  return raw.toLowerCase();
}

/**
 * Lazily fetch the 32-byte instance salt. Bootstraps it on first call.
 *
 * Race-safe: two concurrent boots may both miss-read and try to insert.
 * The unique `lock_col` constraint guarantees only one row exists —
 * the loser's INSERT no-ops (`ON CONFLICT DO NOTHING`), and we
 * re-read to pick up the winner's salt.
 */
export async function ensureSalt(): Promise<Buffer> {
  if (saltCache) return saltCache;
  saltCache = bootstrapSalt();
  try {
    return await saltCache;
  } catch (err) {
    // Don't cache a failure — let the next caller retry.
    saltCache = null;
    throw err;
  }
}

/** Test-only: drop the module-scoped salt cache so the next call re-reads. */
export function __resetSaltCacheForTests(): void {
  saltCache = null;
}

async function bootstrapSalt(): Promise<Buffer> {
  const connectionString =
    process.env.POSTGRES_URL_NON_POOLING ?? process.env.POSTGRES_URL;
  if (!connectionString) {
    throw new Error(
      "[secrets] Cannot bootstrap salt: POSTGRES_URL{_NON_POOLING} is not set.",
    );
  }
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  let didBootstrap = false;
  let salt: Buffer;
  try {
    // First read — common case once bootstrapped.
    const existing = await client.query<{ salt: Buffer }>(
      `SELECT salt FROM ${TABLE} WHERE lock_col = 1 LIMIT 1`,
    );
    if (existing.rows[0]?.salt) {
      return toBuffer(existing.rows[0].salt);
    }
    // Bootstrap path. Generate fresh salt; INSERT ... ON CONFLICT DO NOTHING
    // so a concurrent boot can't double-write.
    const fresh = randomBytes(SALT_BYTES);
    const ins = await client.query(
      `INSERT INTO ${TABLE} (lock_col, salt) VALUES (1, $1) ON CONFLICT (lock_col) DO NOTHING`,
      [fresh],
    );
    // pg returns rowCount=1 if WE inserted; 0 if the conflict no-op'd.
    didBootstrap = (ins.rowCount ?? 0) > 0;
    // Re-read: if we won the race, this returns our salt; if we lost, it
    // returns the winner's.
    const after = await client.query<{ salt: Buffer }>(
      `SELECT salt FROM ${TABLE} WHERE lock_col = 1 LIMIT 1`,
    );
    if (!after.rows[0]?.salt) {
      throw new Error(
        "[secrets] salt bootstrap inserted but re-read returned no row",
      );
    }
    salt = toBuffer(after.rows[0].salt);
  } finally {
    await client.end().catch(() => {
      /* swallow */
    });
  }

  if (didBootstrap) {
    // Fire-and-forget audit (Tay gate F). Done OUT-OF-BAND because
    // appendAudit imports supabase/server which would create an import
    // cycle if pulled at module load. Loaded lazily via dynamic import,
    // and any failure is swallowed — the audit is best-effort and the
    // salt bootstrap must succeed regardless.
    import("../audit/append")
      .then(({ appendAudit }) =>
        appendAudit({
          action: "secrets.salt_bootstrapped",
          payload: {
            // Don't log the salt bytes themselves; just that it happened.
            note: "first cold start; instance_secrets.salt minted",
          },
        }),
      )
      .catch(() => {
        /* audit is best-effort */
      });
  }

  return salt;
}

/**
 * pg returns bytea as Buffer in node-postgres, but some test doubles
 * hand back a Uint8Array or hex string. Normalize.
 */
function toBuffer(input: unknown): Buffer {
  if (Buffer.isBuffer(input)) return input;
  if (input instanceof Uint8Array) return Buffer.from(input);
  if (typeof input === "string") {
    if (input.startsWith("\\x")) {
      return Buffer.from(input.slice(2), "hex");
    }
    return Buffer.from(input, "hex");
  }
  throw new Error("[secrets] unexpected salt type from db");
}
