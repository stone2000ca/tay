// Provider-agnostic LLM client — Tay v1.1.1.
//
// v0.3 pivot was: "Anthropic-only → OpenRouter-only via the OpenAI SDK,
// pointed at openrouter.ai". That gave us one key, any model. But it
// also meant the wizard could only collect OpenRouter keys, and users
// who already had a direct Anthropic / OpenAI key had to first sign up
// for OpenRouter.
//
// v1.1.1 surface:
//   - detectProvider(apiKey): prefix-string check → "anthropic" |
//     "openai" | "openrouter" | "unknown". Pure; no I/O.
//   - getLlmClient(apiKey?): returns a discriminated union with the
//     active provider + a client instance. Uses the stored LLM key
//     (lib/secrets/llm-key.ts) when no override is passed; uses the
//     override (wizard validation path) when one is.
//   - validateLlmKey(apiKey): one-token round-trip per provider; maps
//     SDK errors to a stable shape.
//   - chatComplete({...}): thin adapter so downstream code (draft /
//     judge / reply / voice) doesn't branch per provider. Takes the
//     OpenAI-shaped { role, content } message array; dispatches to
//     the appropriate SDK. Returns the plain-string response.
//   - getModel(tier, provider): symbolic-tier → provider-specific
//     model id. Lets the env-var override still work for OpenRouter
//     installs while baking in sane defaults for the direct paths.
//
// READ-VS-WRITE: getLlmClient is async-READ (may hit DB to fetch the
// stored key). validateLlmKey is async-CALL (pure LLM round-trip).
// chatComplete is async-CALL. Provider detection is pure.
//
// Tay gate H: no change. The Anthropic SDK is just a transport; the
// adversarial-input wrap (<untrusted_source> + neuter()) lives in
// lib/draft/prompt.ts, lib/judge/prompt.ts, etc., NOT here.

import OpenAI, {
  AuthenticationError as OpenAiAuthError,
  RateLimitError as OpenAiRateError,
  APIConnectionError as OpenAiConnError,
} from "openai";
import Anthropic, {
  AuthenticationError as AnthropicAuthError,
  RateLimitError as AnthropicRateError,
  APIConnectionError as AnthropicConnError,
} from "@anthropic-ai/sdk";
import { getLlmKey } from "./secrets/llm-key";

export type LlmProvider = "anthropic" | "openai" | "openrouter";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

// Default models per provider. The env-var overrides preserve the v0.x
// behavior for OpenRouter operators who want to point at a different
// Claude/GPT/Gemini/Llama tier without a code change.
const DEFAULT_MODELS = {
  anthropic: {
    cheap: "claude-3-5-haiku-latest",
    quality: "claude-3-7-sonnet-latest",
  },
  openai: {
    cheap: "gpt-4o-mini",
    quality: "gpt-4o",
  },
  openrouter: {
    cheap: "anthropic/claude-3.5-haiku",
    quality: "anthropic/claude-3.5-sonnet",
  },
} as const;

/**
 * Backwards-compatible top-level constant — `lib/draft/generate.ts`
 * and `lib/judge/judge.ts` still reference `MODELS.cheap` / `MODELS.quality`
 * as defaults when no explicit model is passed. Resolves at READ time
 * from the env-override pattern; defaults to the OpenRouter shape (the
 * shape these constants had in v0.x), since at module-load time we
 * don't yet know which provider the user picked.
 *
 * Callers that need provider-specific resolution should use
 * `getModel(tier, provider)` instead.
 */
export const MODELS = {
  cheap:
    process.env.OPENROUTER_MODEL_CHEAP ?? DEFAULT_MODELS.openrouter.cheap,
  quality:
    process.env.OPENROUTER_MODEL_QUALITY ?? DEFAULT_MODELS.openrouter.quality,
} as const;

export type ValidationResult =
  | { ok: true; provider: LlmProvider }
  | {
      ok: false;
      error: "invalid-key" | "rate-limited" | "network-error" | "unknown-provider" | "unknown";
      message: string;
    };

export type LlmClientResult =
  | {
      ok: true;
      provider: LlmProvider;
      client: OpenAI | Anthropic;
      /** The key in plaintext — never log this. */
      apiKey: string;
    }
  | { ok: false; reason: "llm_not_configured" };

/**
 * Prefix-only provider detection. Order matters: `sk-or-` MUST be
 * checked before `sk-` so OpenRouter doesn't get mis-tagged as OpenAI.
 *
 * Returns "unknown" on anything that doesn't match. Callers should
 * treat "unknown" as a user-facing validation failure ("we couldn't
 * tell which provider this key is for").
 */
export function detectProvider(apiKey: string): LlmProvider | "unknown" {
  const trimmed = (apiKey ?? "").trim();
  if (trimmed.length === 0) return "unknown";
  if (trimmed.startsWith("sk-ant-")) return "anthropic";
  if (trimmed.startsWith("sk-or-")) return "openrouter";
  if (trimmed.startsWith("sk-")) return "openai";
  return "unknown";
}

/**
 * Resolve a model id for a (tier, provider) tuple.
 *
 * Env overrides are honored for the OpenRouter branch only — that
 * preserves the v0.x escape hatch. Direct Anthropic / OpenAI use the
 * baked-in defaults; if you want different models there, edit
 * DEFAULT_MODELS at the top of this file.
 */
export function getModel(
  tier: "cheap" | "quality",
  provider: LlmProvider,
): string {
  if (provider === "openrouter") {
    return tier === "cheap"
      ? process.env.OPENROUTER_MODEL_CHEAP ?? DEFAULT_MODELS.openrouter.cheap
      : process.env.OPENROUTER_MODEL_QUALITY ??
          DEFAULT_MODELS.openrouter.quality;
  }
  return DEFAULT_MODELS[provider][tier];
}

/**
 * Build an LLM client.
 *
 * If `apiKeyOverride` is passed (the wizard validation path), we use
 * it directly + auto-detect the provider from its prefix. Otherwise
 * we fetch the stored key from instance_secrets via getLlmKey().
 *
 * Returns a discriminated union — NEVER throws. Cold-start callers
 * (drafter, judge, reply classifier, reply drafter, voice calibrator)
 * branch on `ok` and surface a friendly "configure your LLM key"
 * error.
 */
export async function getLlmClient(
  apiKeyOverride?: string,
): Promise<LlmClientResult> {
  let apiKey: string;
  let provider: LlmProvider;
  if (apiKeyOverride && apiKeyOverride.trim().length > 0) {
    apiKey = apiKeyOverride.trim();
    const detected = detectProvider(apiKey);
    if (detected === "unknown") {
      return { ok: false, reason: "llm_not_configured" };
    }
    provider = detected;
  } else {
    const stored = await getLlmKey();
    if (!stored) {
      return { ok: false, reason: "llm_not_configured" };
    }
    apiKey = stored.plaintext;
    provider = stored.provider;
  }

  if (provider === "anthropic") {
    return { ok: true, provider, apiKey, client: new Anthropic({ apiKey }) };
  }
  if (provider === "openrouter") {
    return {
      ok: true,
      provider,
      apiKey,
      client: new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL }),
    };
  }
  return {
    ok: true,
    provider,
    apiKey,
    client: new OpenAI({ apiKey }),
  };
}

/**
 * Validate that a pasted API key actually works.
 *
 * One-token round-trip per provider; we detect the provider first then
 * call the appropriate SDK. Maps SDK error classes to a stable
 * discriminated union; anything unknown lands in `"unknown"` with a
 * generic message. We deliberately don't echo raw SDK error text — it
 * can leak account state.
 */
export async function validateLlmKey(
  apiKey: string,
): Promise<ValidationResult> {
  const provider = detectProvider(apiKey);
  if (provider === "unknown") {
    return {
      ok: false,
      error: "unknown-provider",
      message:
        "Could not detect provider from the key prefix. Use `sk-ant-...` (Anthropic), `sk-or-...` (OpenRouter), or `sk-...` (OpenAI).",
    };
  }
  try {
    if (provider === "anthropic") {
      const client = new Anthropic({ apiKey });
      await client.messages.create({
        model: getModel("cheap", "anthropic"),
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
    } else if (provider === "openrouter") {
      const client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
      await client.chat.completions.create({
        model: getModel("cheap", "openrouter"),
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
    } else {
      const client = new OpenAI({ apiKey });
      await client.chat.completions.create({
        model: getModel("cheap", "openai"),
        max_tokens: 1,
        messages: [{ role: "user", content: "ping" }],
      });
    }
    return { ok: true, provider };
  } catch (err: unknown) {
    return mapValidationError(err);
  }
}

function mapValidationError(err: unknown): ValidationResult {
  if (err instanceof OpenAiAuthError || err instanceof AnthropicAuthError) {
    return {
      ok: false,
      error: "invalid-key",
      message: "Invalid API key. Double-check the key and try again.",
    };
  }
  if (err instanceof OpenAiRateError || err instanceof AnthropicRateError) {
    return {
      ok: false,
      error: "rate-limited",
      message: "Rate limited by the provider. Wait a moment and try again.",
    };
  }
  if (err instanceof OpenAiConnError || err instanceof AnthropicConnError) {
    return {
      ok: false,
      error: "network-error",
      message:
        "Network error talking to the provider. Check your connection and retry.",
    };
  }
  return {
    ok: false,
    error: "unknown",
    message: "Could not validate the key right now. Please try again.",
  };
}

// ---- chatComplete adapter -------------------------------------------------

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompleteArgs = {
  messages: ChatMessage[];
  model: string;
  /** Hard upper bound; provider-specific defaults if omitted. */
  max_tokens?: number;
  temperature?: number;
  /** OpenAI-shape JSON-mode hint. Translated to provider semantics. */
  response_format?: { type: "json_object" };
};

export type ChatCompleteResult =
  | { ok: true; content: string; provider: LlmProvider; modelUsed: string }
  | { ok: false; error: string };

/**
 * Provider-neutral chat completion. Takes the OpenAI message-array
 * shape and dispatches to either SDK. Returns the plain string body
 * (no SDK envelopes).
 *
 * For Anthropic + JSON mode: we don't have tool-use yet (v1.x roadmap).
 * For now, callers that ask for response_format=json_object get the
 * plain text back; the JSON parser already in place in
 * lib/draft/generate.ts / lib/judge/judge.ts / lib/reply/classify.ts
 * strips fences and validates the shape. Combined with the system-
 * prompt instruction "Output ONLY a single JSON object" this gives us
 * the same effective contract on both branches.
 *
 * NEVER throws. Returns { ok: false, error } on SDK error.
 */
export async function chatComplete(
  args: ChatCompleteArgs,
  apiKeyOverride?: string,
): Promise<ChatCompleteResult> {
  const got = await getLlmClient(apiKeyOverride);
  if (!got.ok) {
    return { ok: false, error: "LLM not configured. Complete the setup wizard first." };
  }
  try {
    if (got.provider === "anthropic") {
      const client = got.client as Anthropic;
      const system = args.messages
        .filter((m) => m.role === "system")
        .map((m) => m.content)
        .join("\n\n");
      const nonSystem = args.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }));
      const resp = await client.messages.create({
        model: args.model,
        max_tokens: args.max_tokens ?? 1024,
        temperature: args.temperature,
        system: system.length > 0 ? system : undefined,
        messages: nonSystem.length > 0 ? nonSystem : [{ role: "user", content: "" }],
      });
      // The Anthropic SDK returns a content array; we take the first
      // text block. Tool-use is not used here (v1.x).
      const text = resp.content
        .map((b) => ("text" in b ? b.text : ""))
        .join("");
      return { ok: true, content: text, provider: got.provider, modelUsed: args.model };
    }
    // openai + openrouter share the same SDK path.
    const client = got.client as OpenAI;
    const resp = await client.chat.completions.create({
      model: args.model,
      max_tokens: args.max_tokens,
      temperature: args.temperature,
      response_format: args.response_format,
      messages: args.messages,
    });
    const text = resp.choices?.[0]?.message?.content ?? "";
    return { ok: true, content: text, provider: got.provider, modelUsed: args.model };
  } catch (err) {
    const mapped = mapValidationError(err);
    if (mapped.ok === false) return { ok: false, error: mapped.message };
    return {
      ok: false,
      error: "Could not reach the LLM right now. Please try again.",
    };
  }
}
