// Unified mailbox credentials persistence — Tay v1.1.2.
//
// READ-VS-WRITE error contract (same convention as lib/oauth/persist.ts):
//
//   - WRITE functions (saveMailboxCredentials, clearMailboxCredentials)
//     THROW on Supabase failure OR encryption failure. The wizard's
//     server action catches and translates to a user-facing { ok: false,
//     error } so the user sees a clean message at connect time rather
//     than a silent half-state that 401s at first send.
//
//   - READ functions (getMailboxCredentials, getMailboxKind) SOFT-FAIL
//     to null. The /queue and /replies pages must always render; null
//     means "no mailbox connected" and the UI shows the connect prompt.
//
// Single-row pattern: the mailbox_credentials table has `lock_col UNIQUE
// DEFAULT 1` (per migration 0012), and we upsert keyed on lock_col=1 so
// at most one row exists per install. Same pattern as instance_secrets
// and gmail_poll_cursor.
//
// Backwards compatibility (v0.7 → v1.1.2 lazy migration):
//   - getMailboxCredentials() reads from mailbox_credentials first.
//   - If empty AND the legacy google_oauth table has a row, it returns
//     that row as { kind: "oauth", ... } — existing v0.7+ installs keep
//     working WITHOUT requiring the user to reconnect.
//   - The first call to saveMailboxCredentials writes to the new table,
//     after which the new table wins on subsequent reads.
//   - clearMailboxCredentials deletes from BOTH tables so "disconnect"
//     is a clean slate regardless of which path the user originally took.

import {
  getSupabaseServerClient,
  hasSupabaseEnv,
} from "../supabase/server";
import { decryptToken, encryptToken, hasOAuthSecret } from "../oauth/crypto";
import { getGoogleOAuth } from "../oauth/persist";

const TABLE = "mailbox_credentials";
const LEGACY_TABLE = "google_oauth";
const LOCK_COL = 1;

export type MailboxCredentials =
  | {
      kind: "oauth";
      emailAddress: string;
      refreshToken: string;
      accessToken: string;
      /** ISO 8601 timestamp; null if we don't have one yet. */
      expiresAt: string | null;
      scopes: string;
    }
  | {
      kind: "app_password";
      emailAddress: string;
      password: string;
      smtpHost: string;
      smtpPort: number;
      imapHost: string;
      imapPort: number;
    };

/**
 * Persist mailbox credentials. Encrypts the password / refresh token
 * before writing. WRITE function — throws on DB or encrypt error.
 *
 * Upserts on lock_col=1 so the row is unique; any previous mailbox
 * connection (different kind, different email) is overwritten in a
 * single atomic statement.
 */
export async function saveMailboxCredentials(
  creds: MailboxCredentials,
): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before connecting a mailbox.",
    );
  }
  if (!(await hasOAuthSecret())) {
    throw new Error(
      "Mailbox encryption secret unreachable. Configure SUPABASE_SERVICE_ROLE_KEY (or the legacy TAY_OAUTH_SECRET fallback) before connecting a mailbox.",
    );
  }

  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();

  // Build the row shape. NULL out columns that don't apply to this kind
  // so the row's shape is unambiguous on read.
  let row: Record<string, unknown>;
  if (creds.kind === "oauth") {
    if (!creds.refreshToken) {
      throw new Error("OAuth credentials missing refreshToken.");
    }
    row = {
      lock_col: LOCK_COL,
      kind: "oauth",
      email_address: creds.emailAddress,
      oauth_refresh_token_encrypted: await encryptToken(creds.refreshToken),
      oauth_access_token_encrypted: creds.accessToken
        ? await encryptToken(creds.accessToken)
        : null,
      oauth_access_token_expires_at: creds.expiresAt,
      oauth_scopes: creds.scopes,
      smtp_password_encrypted: null,
      smtp_host: null,
      smtp_port: null,
      imap_host: null,
      imap_port: null,
      updated_at: now,
    };
  } else {
    if (!creds.password) {
      throw new Error("App Password credentials missing password.");
    }
    row = {
      lock_col: LOCK_COL,
      kind: "app_password",
      email_address: creds.emailAddress,
      oauth_refresh_token_encrypted: null,
      oauth_access_token_encrypted: null,
      oauth_access_token_expires_at: null,
      oauth_scopes: null,
      smtp_password_encrypted: await encryptToken(creds.password),
      smtp_host: creds.smtpHost,
      smtp_port: creds.smtpPort,
      imap_host: creds.imapHost,
      imap_port: creds.imapPort,
      updated_at: now,
    };
  }

  const ups = await supabase.from(TABLE).upsert(row, { onConflict: "lock_col" });
  if (ups.error) {
    throw new Error(`[mailbox persist] upsert failed: ${ups.error.message}`);
  }
}

/**
 * Read the active mailbox credentials. SOFT-FAILS to null.
 *
 * Lookup order:
 *   1. mailbox_credentials (the new v1.1.2 primary)
 *   2. legacy google_oauth (only if 1 was empty) — backwards-compat for
 *      v0.7+ installs that haven't reconnected since deploying v1.1.2.
 *
 * Decryption failures fall through to null so the caller renders the
 * "connect a mailbox" prompt rather than crashing.
 */
export async function getMailboxCredentials(): Promise<MailboxCredentials | null> {
  if (!hasSupabaseEnv()) return null;
  if (!(await hasOAuthSecret())) return null;

  // Step 1 — new table.
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select(
        "kind, email_address, oauth_refresh_token_encrypted, oauth_access_token_encrypted, oauth_access_token_expires_at, oauth_scopes, smtp_password_encrypted, smtp_host, smtp_port, imap_host, imap_port",
      )
      .eq("lock_col", LOCK_COL)
      .maybeSingle();
    if (error) {
      console.warn("[mailbox persist] read failed:", error.message);
      // Fall through to legacy lookup so a transient new-table error
      // doesn't blind us to existing oauth row.
    } else if (data) {
      const row = data as {
        kind: string;
        email_address: string;
        oauth_refresh_token_encrypted: string | null;
        oauth_access_token_encrypted: string | null;
        oauth_access_token_expires_at: string | null;
        oauth_scopes: string | null;
        smtp_password_encrypted: string | null;
        smtp_host: string | null;
        smtp_port: number | null;
        imap_host: string | null;
        imap_port: number | null;
      };
      if (row.kind === "oauth") {
        if (!row.oauth_refresh_token_encrypted) return null;
        try {
          const refreshToken = await decryptToken(
            row.oauth_refresh_token_encrypted,
          );
          const accessToken = row.oauth_access_token_encrypted
            ? await decryptToken(row.oauth_access_token_encrypted)
            : "";
          return {
            kind: "oauth",
            emailAddress: row.email_address,
            refreshToken,
            accessToken,
            expiresAt: row.oauth_access_token_expires_at,
            scopes: row.oauth_scopes ?? "",
          };
        } catch (err) {
          console.warn(
            "[mailbox persist] oauth decrypt failed:",
            err instanceof Error ? err.message : String(err),
          );
          return null;
        }
      }
      if (row.kind === "app_password") {
        if (
          !row.smtp_password_encrypted ||
          !row.smtp_host ||
          !row.smtp_port ||
          !row.imap_host ||
          !row.imap_port
        ) {
          return null;
        }
        try {
          const password = await decryptToken(row.smtp_password_encrypted);
          return {
            kind: "app_password",
            emailAddress: row.email_address,
            password,
            smtpHost: row.smtp_host,
            smtpPort: row.smtp_port,
            imapHost: row.imap_host,
            imapPort: row.imap_port,
          };
        } catch (err) {
          console.warn(
            "[mailbox persist] app_password decrypt failed:",
            err instanceof Error ? err.message : String(err),
          );
          return null;
        }
      }
      // Unknown kind — treat as no-record and try legacy fallback.
    }
  } catch (err) {
    console.warn(
      "[mailbox persist] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    // fall through
  }

  // Step 2 — legacy google_oauth fallback (lazy migration window).
  try {
    const legacy = await getGoogleOAuth();
    if (!legacy) return null;
    return {
      kind: "oauth",
      emailAddress: legacy.emailAddress,
      refreshToken: legacy.refreshToken,
      accessToken: legacy.accessToken,
      expiresAt: legacy.expiresAt,
      scopes: legacy.scope,
    };
  } catch (err) {
    console.warn(
      "[mailbox persist] legacy oauth read failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Cheap "what kind of mailbox is connected?" probe — used by the
 * /queue and /replies banners to decide whether to show the SMTP-mode
 * interim-state notice. SOFT-FAILS to null.
 *
 * Implementation: piggy-back on getMailboxCredentials so we share the
 * lookup-with-fallback logic.
 */
export async function getMailboxKind(): Promise<
  "oauth" | "app_password" | null
> {
  const creds = await getMailboxCredentials();
  return creds?.kind ?? null;
}

/**
 * Disconnect — delete from BOTH the new table and the legacy table so
 * the user is in a clean "no mailbox" state regardless of which path
 * they originally used.
 *
 * WRITE function — throws on DB error.
 */
export async function clearMailboxCredentials(): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error("Supabase not configured.");
  }
  const supabase = getSupabaseServerClient();
  // Delete from the new table — single-row, so a broad delete is safe.
  const delNew = await supabase.from(TABLE).delete().eq("lock_col", LOCK_COL);
  if (delNew.error) {
    throw new Error(
      `[mailbox persist] delete (new) failed: ${delNew.error.message}`,
    );
  }
  // Also wipe the legacy table so a re-connect doesn't accidentally fall
  // back through to a stale oauth row. .neq("id","") deletes all rows.
  const delLegacy = await supabase
    .from(LEGACY_TABLE)
    .delete()
    .neq("id", "");
  if (delLegacy.error) {
    // Don't throw on legacy delete failure — the new-table delete succeeded;
    // this is best-effort cleanup. Log only.
    console.warn(
      "[mailbox persist] legacy delete failed (non-fatal):",
      delLegacy.error.message,
    );
  }
}
