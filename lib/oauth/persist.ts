// Google OAuth token persistence — Tay v0.7.
//
// READ-VS-WRITE error contract (same convention as lib/draft/persist.ts):
//
//   - WRITE functions (saveGoogleOAuth, deleteGoogleOAuth) THROW on
//     DB failure OR on encryption failure. Callers are server actions
//     that translate to user-facing { ok: false, error }. Silent failure
//     here means the OAuth flow looked successful but the next send
//     would 401 — a worse UX than a clean error at the connect step.
//
//   - READ function (getGoogleOAuth) SOFT-FAILS to null. The /queue
//     page must always render; a null result is "not connected" and
//     the UI shows the "Connect Gmail" prompt.
//
//   - The HYBRID function (ensureFreshAccessToken) THROWS — it's a
//     synchronous precondition for send orchestration. The orchestrator
//     catches and translates to a friendly error.
//
// Single-row pattern: Tay is single-tenant; there is at most one
// google_oauth row per install.
//
// v0.8 refactor: was previously delete-then-insert (two non-transactional
// operations — if the deploy crashed between them, the user lost their
// connection). Now uses an upsert keyed on a DETERMINISTIC ROW ID
// (SINGLE_ROW_ID below). The single-row pattern is expressed in the ID,
// not by deleting siblings:
//   - INSERT path: upsert with the fixed id → row gets created with
//     that id and the new token fields.
//   - UPDATE path: upsert with the fixed id → conflict on `id`, fields
//     get overwritten in a single statement (atomic — no half-state).
//
// Re-connecting a different Gmail account just rewrites the row's
// `email_address` field. This is intentional: a single-tenant install
// has ONE sender at a time. If the user wants both accounts, they
// install Tay twice.

import {
  getSupabaseServerClient,
  hasSupabaseEnv,
} from "../supabase/server";
import { decryptToken, encryptToken, hasOAuthSecret } from "./crypto";
import { refreshAccessToken } from "./google";

const TABLE = "google_oauth";

/**
 * Deterministic single-row id. The google_oauth table has a uuid PK; we
 * just always use this one value so upserts converge to a single row.
 * Any value-shaped-as-a-uuid works; the actual bytes are arbitrary.
 */
const SINGLE_ROW_ID = "00000000-0000-0000-0000-000000000001";

/** Refresh access tokens this many seconds BEFORE their actual expiry. */
const REFRESH_BUFFER_SECONDS = 60;

export type GoogleOAuthRecord = {
  emailAddress: string;
  accessToken: string;
  refreshToken: string;
  /** ISO 8601 timestamp; null if we don't have one yet. */
  expiresAt: string | null;
  scope: string;
};

/**
 * Persist a freshly-issued token pair. Encrypts before writing.
 *
 * WRITE function — throws on DB error, on missing Supabase env, or on
 * missing/malformed TAY_OAUTH_SECRET.
 */
export async function saveGoogleOAuth(args: {
  emailAddress: string;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope: string;
}): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before connecting Gmail.",
    );
  }
  if (!(await hasOAuthSecret())) {
    throw new Error(
      "OAuth crypto secret unreachable. Configure SUPABASE_SERVICE_ROLE_KEY (or set the legacy TAY_OAUTH_SECRET fallback) before connecting Gmail.",
    );
  }
  const supabase = getSupabaseServerClient();
  const refresh_token_encrypted = await encryptToken(args.refreshToken);
  const access_token_encrypted = await encryptToken(args.accessToken);
  const access_token_expires_at = new Date(
    Date.now() + args.expiresIn * 1000,
  ).toISOString();

  // v0.8: single-statement upsert on the deterministic SINGLE_ROW_ID.
  // Atomic — no half-state between "old creds gone" and "new creds in".
  const ups = await supabase.from(TABLE).upsert(
    {
      id: SINGLE_ROW_ID,
      email_address: args.emailAddress,
      refresh_token_encrypted,
      access_token_encrypted,
      access_token_expires_at,
      scopes: args.scope,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (ups.error) {
    throw new Error(`[oauth persist] upsert failed: ${ups.error.message}`);
  }
}

/**
 * Read the (one and only) stored OAuth row, decrypted.
 *
 * READ function — soft-fails to null. Returns null when Supabase is
 * unwired, the table is empty, the row decrypt-fails (key rotation
 * without re-consent), or any other read error.
 */
export async function getGoogleOAuth(): Promise<GoogleOAuthRecord | null> {
  if (!hasSupabaseEnv()) return null;
  if (!(await hasOAuthSecret())) return null;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select(
        "email_address, refresh_token_encrypted, access_token_encrypted, access_token_expires_at, scopes",
      )
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[oauth persist] read failed:", error.message);
      return null;
    }
    if (!data) return null;
    const refresh = data.refresh_token_encrypted as string | null;
    const access = data.access_token_encrypted as string | null;
    if (!refresh) return null;
    let refreshToken: string;
    let accessToken: string;
    try {
      refreshToken = await decryptToken(refresh);
      accessToken = access ? await decryptToken(access) : "";
    } catch (err) {
      // Don't log the ciphertext; do log the failure mode.
      console.warn(
        "[oauth persist] decrypt failed (key rotated or row corrupted):",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
    return {
      emailAddress: data.email_address as string,
      accessToken,
      refreshToken,
      expiresAt: (data.access_token_expires_at as string | null) ?? null,
      scope: data.scopes as string,
    };
  } catch (err) {
    console.warn(
      "[oauth persist] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Delete the stored OAuth row (user clicked "Disconnect").
 *
 * WRITE function — throws on DB error. Returns silently if there was
 * no row (deleting nothing is success).
 */
export async function deleteGoogleOAuth(): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error("Supabase not configured.");
  }
  const supabase = getSupabaseServerClient();
  // v0.8: target the deterministic SINGLE_ROW_ID instead of the
  // .neq("id","") trick (which depended on every row having an id).
  // Belt-and-braces: also delete any rows lingering from the old
  // delete-then-insert era (uses the same .neq trick for breadth).
  const del = await supabase.from(TABLE).delete().neq("id", "");
  if (del.error) {
    throw new Error(`[oauth persist] delete failed: ${del.error.message}`);
  }
}

/**
 * Ensure we have a fresh access token. If the stored one is within
 * REFRESH_BUFFER_SECONDS of expiry (or already expired), refresh via
 * Google's token endpoint and persist the new value.
 *
 * Returns the PLAINTEXT access token. Caller must NEVER log it.
 *
 * Throws if:
 *   - Supabase not configured
 *   - TAY_OAUTH_SECRET missing
 *   - No OAuth row exists
 *   - Refresh fails (network or 401 = refresh_token revoked)
 *   - GOOGLE_OAUTH_CLIENT_ID / _SECRET env vars missing
 */
export async function ensureFreshAccessToken(): Promise<string> {
  const record = await getGoogleOAuth();
  if (!record) {
    throw new Error(
      "Gmail is not connected. Connect under Settings before sending.",
    );
  }

  const now = Date.now();
  const expiresAtMs = record.expiresAt
    ? new Date(record.expiresAt).getTime()
    : 0;
  const needsRefresh =
    !record.accessToken ||
    !expiresAtMs ||
    expiresAtMs - now < REFRESH_BUFFER_SECONDS * 1000;

  if (!needsRefresh) {
    return record.accessToken;
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET missing.",
    );
  }

  const refreshed = await refreshAccessToken({
    clientId,
    clientSecret,
    refreshToken: record.refreshToken,
  });

  // Persist the new access token + expiry. Refresh token stays the same.
  if (!hasSupabaseEnv() || !(await hasOAuthSecret())) {
    // Shouldn't happen — we got here via getGoogleOAuth which passed
    // both checks — but be defensive.
    throw new Error(
      "Cannot persist refreshed token: Supabase or OAuth secret unavailable.",
    );
  }
  const supabase = getSupabaseServerClient();
  const upd = await supabase
    .from(TABLE)
    .update({
      access_token_encrypted: await encryptToken(refreshed.accessToken),
      access_token_expires_at: new Date(
        Date.now() + refreshed.expiresIn * 1000,
      ).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .neq("id", "");
  if (upd.error) {
    // Refresh succeeded but persist failed. Return the fresh token anyway
    // — the send can still proceed — but warn so the next call also
    // refreshes (until we manage to persist).
    console.warn(
      "[oauth persist] refresh token persist failed:",
      upd.error.message,
    );
  }
  return refreshed.accessToken;
}
