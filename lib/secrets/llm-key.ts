// Tay v1.1.1 — BYO LLM key storage.
//
// The user pastes their LLM API key once during the setup wizard. We
// detect the provider from the key prefix (`sk-ant-`, `sk-or-`, plain
// `sk-`), validate it via lib/llm.ts, then store it here — encrypted at
// rest with AES-256-GCM via lib/oauth/crypto.ts (which now uses a
// derived secret, not a user-managed env var).
//
// Surface:
//   - setLlmKey({ provider, plaintext }): upsert into instance_secrets.
//     WRITE — throws on DB / encrypt / Supabase-missing.
//   - getLlmKey(): read + decrypt. READ — soft-fails to null so any
//     caller in a degraded-mode UI path (cold-start before wizard) can
//     branch cleanly.
//   - computeFingerprint(plaintext): first 8 hex chars of sha256. Used
//     by /settings/secrets to display "which key is active" without
//     leaking the key itself. SERVER-SIDE ONLY — never serialize to the
//     client.

import { createHash } from "node:crypto";
import { decryptToken, encryptToken } from "../oauth/crypto";
import {
  getSupabaseServerClient,
  hasSupabaseEnv,
} from "../supabase/server";

export type LlmProvider = "anthropic" | "openai" | "openrouter";

export type StoredLlmKey = {
  provider: LlmProvider;
  plaintext: string;
};

const TABLE = "instance_secrets";

/**
 * Persist the user's LLM key. Encrypts before writing. Updates fingerprint
 * + set-at timestamp atomically with the ciphertext (single upsert).
 *
 * Idempotent on `lock_col = 1` — calling setLlmKey twice in a row just
 * overwrites the prior row (no duplicates can exist).
 *
 * Throws on:
 *   - missing Supabase env
 *   - encryptToken throwing (cascades from getInstanceSecret("oauth"))
 *   - DB upsert error
 */
export async function setLlmKey(input: {
  provider: LlmProvider;
  plaintext: string;
}): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before saving the LLM key.",
    );
  }
  const plaintext = (input.plaintext ?? "").trim();
  if (plaintext.length === 0) {
    throw new Error("setLlmKey: plaintext key must be non-empty.");
  }
  const ciphertext = await encryptToken(plaintext);
  const fingerprint = computeFingerprint(plaintext);

  const supabase = getSupabaseServerClient();
  const ups = await supabase.from(TABLE).upsert(
    {
      lock_col: 1,
      llm_provider: input.provider,
      llm_key_ciphertext: ciphertext,
      llm_key_fingerprint: fingerprint,
      llm_key_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "lock_col" },
  );
  if (ups.error) {
    throw new Error(`[llm-key] upsert failed: ${ups.error.message}`);
  }
}

/**
 * Read + decrypt the stored LLM key, if any.
 *
 * Returns null on:
 *   - Supabase env missing
 *   - row missing (wizard not yet completed)
 *   - missing ciphertext / provider columns
 *   - decrypt failure (key rotated; row stale)
 *   - any DB error
 *
 * Cold-start safety: the cron route + draft action + judge + reply
 * pipeline all call this. Returning null lets them surface a friendly
 * "configure your LLM key" error instead of crashing.
 */
export async function getLlmKey(): Promise<StoredLlmKey | null> {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("llm_provider, llm_key_ciphertext")
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[llm-key] read failed:", error.message);
      return null;
    }
    if (!data) return null;
    const provider = data.llm_provider as LlmProvider | null;
    const ciphertext = data.llm_key_ciphertext as string | null;
    if (!provider || !ciphertext) return null;
    let plaintext: string;
    try {
      plaintext = await decryptToken(ciphertext);
    } catch (err) {
      console.warn(
        "[llm-key] decrypt failed (rotated key or stale row):",
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
    return { provider, plaintext };
  } catch (err) {
    console.warn(
      "[llm-key] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Read just the public-safe fingerprint metadata (provider + 8-char
 * fingerprint + set-at). For /settings/secrets surfaces. Does NOT
 * read or decrypt the ciphertext — cheap.
 */
export async function getLlmKeyMetadata(): Promise<{
  provider: LlmProvider;
  fingerprint: string;
  setAt: string;
} | null> {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("llm_provider, llm_key_fingerprint, llm_key_set_at")
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const provider = data.llm_provider as LlmProvider | null;
    const fingerprint = data.llm_key_fingerprint as string | null;
    const setAt = data.llm_key_set_at as string | null;
    if (!provider || !fingerprint || !setAt) return null;
    return { provider, fingerprint, setAt };
  } catch {
    return null;
  }
}

/**
 * First 8 lowercase hex chars of sha256(plaintext). Stable for a given
 * key — calling twice with the same plaintext returns the same string.
 *
 * SERVER-SIDE ONLY. Don't ship to the client; even 8 chars of a
 * cryptographic hash is enough to confirm "yes, this is THE key" if
 * the attacker also has a candidate plaintext.
 */
export function computeFingerprint(plaintext: string): string {
  return createHash("sha256").update(plaintext, "utf8").digest("hex").slice(0, 8);
}
