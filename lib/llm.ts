// Thin wrapper around the OpenAI SDK pointed at OpenRouter.
//
// OpenRouter (https://openrouter.ai) is a unified gateway to ~100 models
// with a single API key, speaking the OpenAI HTTP protocol. We pivot from
// the Anthropic SDK to this so Tay's user can pick *any* model — Claude,
// GPT, Gemini, Llama, etc. — without code changes. Just swap the env-var.
//
// Module surface:
//   - getLlmClient(apiKey?): construct an OpenAI client pointed at
//     openrouter. If `apiKey` is provided we use it (for the validate
//     path during setup); otherwise we read OPENROUTER_API_KEY from env.
//   - validateLlmKey(apiKey): smallest-possible round-trip to confirm a
//     pasted key works. Returns a discriminated union — NEVER leak raw
//     SDK error text (can include account ids, request ids, etc.).
//   - MODELS: symbolic names downstream code uses ("cheap" / "quality")
//     so model swaps don't require editing call-sites — just env vars.

import OpenAI, {
  AuthenticationError,
  RateLimitError,
  APIConnectionError,
} from "openai";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Validation model: cheap, fast, near-universally available on OpenRouter.
// Haiku is ~$0.80/1M input — a 1-token round-trip costs effectively zero
// and the model exists on every OpenRouter account by default. If this
// model ever gets pulled, swap to "openai/gpt-4o-mini" — same price tier.
const VALIDATION_MODEL = "anthropic/claude-3.5-haiku";

export const MODELS = {
  cheap: process.env.OPENROUTER_MODEL_CHEAP ?? "anthropic/claude-3.5-haiku",
  quality: process.env.OPENROUTER_MODEL_QUALITY ?? "anthropic/claude-3.5-sonnet",
} as const;

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      error: "invalid-key" | "rate-limited" | "network-error" | "unknown";
      message: string;
    };

/**
 * Build an OpenAI client pointed at OpenRouter.
 *
 * When `apiKey` is provided we use it directly (used by the setup wizard
 * to validate a key the user just pasted, *before* it lands in env). When
 * omitted we read `OPENROUTER_API_KEY` from process.env and throw with a
 * clear message if it's unset. Callers in non-setup paths should let the
 * throw propagate — the alternative is a silent misroute to "missing key".
 */
export function getLlmClient(apiKey?: string): OpenAI {
  const key = apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to your Vercel env vars (or .env.local) and restart.",
    );
  }
  return new OpenAI({
    apiKey: key,
    baseURL: OPENROUTER_BASE_URL,
  });
}

/**
 * Validate that a pasted API key actually works against OpenRouter.
 *
 * Implementation: one-token chat-completion request against the cheapest
 * universally-available model. Maps known SDK error classes to a stable
 * discriminated union; anything unknown lands in `"unknown"` with a
 * generic message. We deliberately do not echo raw SDK errors back to the
 * user — they can leak account state.
 */
export async function validateLlmKey(apiKey: string): Promise<ValidationResult> {
  const client = getLlmClient(apiKey);

  try {
    await client.chat.completions.create({
      model: VALIDATION_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      return {
        ok: false,
        error: "invalid-key",
        message: "Invalid API key. Double-check the key and try again.",
      };
    }
    if (err instanceof RateLimitError) {
      return {
        ok: false,
        error: "rate-limited",
        message: "Rate limited by OpenRouter. Wait a moment and try again.",
      };
    }
    if (err instanceof APIConnectionError) {
      return {
        ok: false,
        error: "network-error",
        message: "Network error talking to OpenRouter. Check your connection and retry.",
      };
    }
    return {
      ok: false,
      error: "unknown",
      message: "Could not validate the key right now. Please try again.",
    };
  }
}
