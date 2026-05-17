"use server";

import { setAppConfig } from "@/lib/app-config";
import { validateLlmKey } from "@/lib/llm";
import { ensureSchema } from "@/lib/supabase/migrate";

const NAME_MAX = 60;
// ASCII printable (0x20-0x7E) only — no control chars, no smart quotes that
// could break in CLI/env-var contexts later, no exotic Unicode that the user
// might not be able to retype. Tay-gate B: collect ONLY name + key — no other
// metadata about the user.
const NAME_ALLOWED = /^[\x20-\x7E]+$/;

export type SetupResult = { ok: true } | { ok: false; error: string };

export async function validateAndSaveSetup(input: {
  apiKey: string;
  name: string;
}): Promise<SetupResult> {
  // Cold-start guard: server actions POST to a fresh Vercel function instance
  // may land here before any GET has triggered `ensureSchema()`. Without this,
  // the Supabase `setAppConfig` write below (DELETE+INSERT on `app_config`)
  // would fail with "relation does not exist" on the very first wizard submit.
  // ensureSchema is idempotent and never throws by contract; if migration
  // genuinely fails, the subsequent setAppConfig call will surface a clear
  // error to the user.
  await ensureSchema();

  const apiKey = (input.apiKey ?? "").trim();
  const name = (input.name ?? "").trim();

  if (apiKey.length === 0) {
    return { ok: false, error: "API key is required." };
  }
  if (!apiKey.startsWith("sk-or-")) {
    return {
      ok: false,
      error: "That doesn't look like an OpenRouter key (should start with sk-or-).",
    };
  }
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

  const result = await validateLlmKey(apiKey);
  if (!result.ok) {
    return { ok: false, error: result.message };
  }

  await setAppConfig({ name, validatedAt: new Date().toISOString() });
  return { ok: true };
}
