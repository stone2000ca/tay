"use server";

import { setAppConfig } from "@/lib/app-config";
import { detectProvider, validateLlmKey } from "@/lib/llm";
import { setLlmKey } from "@/lib/secrets/llm-key";
import { ensureSchema } from "@/lib/supabase/migrate";
import { appendAudit } from "@/lib/audit/append";
import { computeFingerprint } from "@/lib/secrets/llm-key";

const NAME_MAX = 60;
// ASCII printable (0x20-0x7E) only — no control chars, no smart quotes that
// could break in CLI/env-var contexts later, no exotic Unicode that the user
// might not be able to retype. Tay-gate B: collect ONLY name + key — no other
// metadata about the user.
const NAME_ALLOWED = /^[\x20-\x7E]+$/;

export type SetupResult = { ok: true } | { ok: false; error: string };

/**
 * v1.1.1: this action now ONLY validates + saves the instance name. The LLM
 * key has moved to its own wizard step (/setup/llm-key) — pre-v1.1.1 it
 * lived here, but that coupled "give yourself a name" with "pick an LLM
 * provider" which the new flow splits so non-tech users see one decision
 * at a time.
 */
export async function validateAndSaveSetup(input: {
  name: string;
}): Promise<SetupResult> {
  // Cold-start guard: server actions POST to a fresh Vercel function instance
  // may land here before any GET has triggered `ensureSchema()`. Without this,
  // the Supabase `setAppConfig` write below (DELETE+INSERT on `app_config`)
  // would fail with "relation does not exist" on the very first wizard submit.
  await ensureSchema();

  const name = (input.name ?? "").trim();
  if (name.length === 0) {
    return { ok: false, error: "Instance name is required." };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, error: `Instance name must be ${NAME_MAX} characters or fewer.` };
  }
  if (!NAME_ALLOWED.test(name)) {
    return {
      ok: false,
      error: "Instance name can only contain plain ASCII letters, numbers, and punctuation.",
    };
  }

  await setAppConfig({ name, validatedAt: new Date().toISOString() });
  return { ok: true };
}

export type LlmKeyResult =
  | { ok: true; provider: "anthropic" | "openai" | "openrouter" }
  | { ok: false; error: string };

/**
 * v1.1.1: validate + save the user's BYO LLM key.
 *
 *   1. Cold-start: ensureSchema (creates instance_secrets if missing).
 *   2. Provider-detect from the key prefix server-side (don't trust the
 *      client's detect).
 *   3. Round-trip via validateLlmKey (one-token call per provider).
 *   4. On success, encrypt + store via setLlmKey.
 *   5. Audit (Tay gate F): secrets.llm_key_set on a fresh save;
 *      secrets.llm_key_rotated when overwriting (a fingerprint already
 *      exists in instance_secrets).
 */
export async function validateAndSaveLlmKey(input: {
  apiKey: string;
}): Promise<LlmKeyResult> {
  await ensureSchema();

  const apiKey = (input.apiKey ?? "").trim();
  if (apiKey.length === 0) {
    return { ok: false, error: "API key is required." };
  }

  const provider = detectProvider(apiKey);
  if (provider === "unknown") {
    return {
      ok: false,
      error:
        "Could not detect provider from the key prefix. Use sk-ant-... (Anthropic), sk-or-... (OpenRouter), or sk-... (OpenAI).",
    };
  }

  const validation = await validateLlmKey(apiKey);
  if (!validation.ok) {
    return { ok: false, error: validation.message };
  }

  // Detect rotation vs first-set BEFORE the write so we audit the right
  // event type. The metadata fetch is best-effort; on failure we fall
  // back to "set" (semantically harmless — the chain shows both events
  // are valid).
  let isRotation = false;
  let oldFingerprint: string | null = null;
  try {
    const { getLlmKeyMetadata } = await import("@/lib/secrets/llm-key");
    const existing = await getLlmKeyMetadata();
    if (existing) {
      isRotation = true;
      oldFingerprint = existing.fingerprint;
    }
  } catch {
    /* best-effort */
  }

  try {
    await setLlmKey({ provider: validation.provider, plaintext: apiKey });
  } catch (err) {
    return {
      ok: false,
      error: `Could not save the LLM key: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const newFingerprint = computeFingerprint(apiKey);
  await appendAudit({
    action: isRotation ? "secrets.llm_key_rotated" : "secrets.llm_key_set",
    payload: {
      provider: validation.provider,
      // 8-char fingerprint is safe to log (not enough to reconstruct
      // the key; lets the user correlate dashboard activity).
      fingerprint: newFingerprint,
      old_fingerprint: oldFingerprint,
    },
  });

  return { ok: true, provider: validation.provider };
}
