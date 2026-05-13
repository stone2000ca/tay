// Thin wrapper around the Anthropic SDK for Tay's setup wizard.
//
// At v0.1 we only need to verify that a pasted API key is valid before
// telling the user to drop it into their Vercel env vars. We do that with
// the smallest possible round-trip: a 1-message ping at max_tokens=4
// against the cheapest current Haiku model.
//
// Errors are normalized to a discriminated union so callers can show a
// user-friendly message without leaking raw SDK error text (which can
// include account ids, request ids, etc.).

import Anthropic, { AuthenticationError, RateLimitError, APIConnectionError } from "@anthropic-ai/sdk";

const VALIDATION_MODEL = "claude-haiku-4-5-20251001";

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      kind: "invalid-key" | "rate-limited" | "network-error" | "unknown";
      message: string;
    };

export async function validateApiKey(apiKey: string): Promise<ValidationResult> {
  const client = new Anthropic({ apiKey });

  try {
    await client.messages.create({
      model: VALIDATION_MODEL,
      max_tokens: 4,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true };
  } catch (err: unknown) {
    if (err instanceof AuthenticationError) {
      return {
        ok: false,
        kind: "invalid-key",
        message: "Invalid API key. Double-check the key and try again.",
      };
    }
    if (err instanceof RateLimitError) {
      return {
        ok: false,
        kind: "rate-limited",
        message: "Rate limited by Anthropic. Wait a moment and try again.",
      };
    }
    if (err instanceof APIConnectionError) {
      return {
        ok: false,
        kind: "network-error",
        message: "Network error talking to Anthropic. Check your connection and retry.",
      };
    }
    return {
      ok: false,
      kind: "unknown",
      message: "Could not validate the key right now. Please try again.",
    };
  }
}
