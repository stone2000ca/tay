// Drafter v0.4 — prospect + rubric → generated email.
//
// Pipeline:
//   getRubric() (if not passed in)
//     → buildDraftMessages() (rubric becomes binding system-prompt contract)
//       → OpenRouter chat.completions.create() with response_format=json_object
//         → defensive JSON parse + shape validation (subject, body)
//           → withDisclosure() injects the AI footer (Tay gate C)
//
// READ-VS-WRITE ERROR CONTRACT (run #002/#003 learning):
//   generateDraft is an LLM CALL — it returns a discriminated union
//   ({ ok: true, ... } | { ok: false, error }) and never throws on
//   normal error paths. It does NOT write to the DB.
//   - SDK errors (auth/rate-limit/network/unknown) are mapped to friendly
//     strings; raw SDK text is NEVER returned to the caller.
//   - Malformed model output (bad JSON, missing keys, sanity-cap
//     violations) returns ok: false too.

import { getLlmClient, MODELS } from "../llm";
import { getRubric } from "../voice/calibrate";
import type { VoiceRubric } from "../voice/rubric-schema";
import { buildDraftMessages, type ProspectInputs } from "./prompt";
import { withDisclosure } from "./disclosure";
import {
  AuthenticationError,
  RateLimitError,
  APIConnectionError,
} from "openai";

// Sanity bounds — these aren't user-facing limits, they're "the LLM did
// something obviously wrong" trips. The system prompt asks for ≤80-char
// subjects and 3-5-sentence bodies; these caps are generous on top.
const MAX_SUBJECT_LEN = 200;
const MAX_BODY_LEN = 5000;

export type GenerateResult =
  | {
      ok: true;
      draft: { subject: string; body: string };
      modelUsed: string;
      rubricUsed: VoiceRubric;
    }
  | { ok: false; error: string };

export async function generateDraft(args: {
  prospect: ProspectInputs;
  rubric?: VoiceRubric;
  model?: string;
  apiKey?: string;
}): Promise<GenerateResult> {
  // Resolve rubric: caller may pass one (tests, future re-generate-with-X
  // flows), otherwise we read the calibrated rubric. If neither exists,
  // bail early with a guidance message — Tay gate D requires a rubric.
  let rubric = args.rubric;
  if (!rubric) {
    const fetched = await getRubric();
    if (!fetched) {
      return {
        ok: false,
        error: "Voice not yet calibrated. Complete /setup/voice first.",
      };
    }
    rubric = fetched;
  }

  const model = args.model ?? MODELS.quality;
  const messages = buildDraftMessages({ rubric, prospect: args.prospect });

  let raw: string | null = null;
  try {
    const client = getLlmClient(args.apiKey);
    const response = await client.chat.completions.create({
      model,
      temperature: 0.7,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
    });
    raw = response.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    return { ok: false, error: mapSdkError(err) };
  }

  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "Drafter returned an empty response." };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsonFences(raw));
  } catch {
    return { ok: false, error: "Drafter returned malformed JSON." };
  }

  const draft = validateDraftShape(parsedJson);
  if (!draft) {
    return {
      ok: false,
      error: "Drafter returned an invalid draft shape.",
    };
  }

  return {
    ok: true,
    draft: {
      subject: draft.subject,
      // v0.8: pass the prospect's email so the disclosure footer can
      // include a per-recipient unsubscribe link. Falls back to the
      // constant "Reply STOP" footer when no real email (e.g. the v0.4
      // /draft flow's synthesized `.invalid` placeholders — which can't
      // be sent anyway) or when TAY_OAUTH_SECRET is missing.
      body: withDisclosure(draft.body, {
        recipientEmail: realRecipient(args.prospect.email),
      }),
    },
    modelUsed: model,
    rubricUsed: rubric,
  };
}

function realRecipient(email: string | undefined): string | undefined {
  const trimmed = email?.trim();
  if (!trimmed) return undefined;
  // Don't mint unsubscribe tokens for synthesizer placeholders — they
  // can never be sent and the .invalid token would just be noise.
  if (trimmed.endsWith(".invalid")) return undefined;
  return trimmed;
}

function validateDraftShape(
  input: unknown,
): { subject: string; body: string } | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const subject = typeof o.subject === "string" ? o.subject.trim() : "";
  const body = typeof o.body === "string" ? o.body : "";
  if (subject.length === 0 || subject.length > MAX_SUBJECT_LEN) return null;
  if (body.trim().length === 0 || body.length > MAX_BODY_LEN) return null;
  return { subject, body };
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/, "")
      .trim();
  }
  return trimmed;
}

/**
 * Map SDK error classes to friendly user-facing strings. NEVER return raw
 * SDK error text — it can include account ids, request ids, key fragments.
 * Same convention as validateLlmKey in lib/llm.ts.
 */
function mapSdkError(err: unknown): string {
  if (err instanceof AuthenticationError) {
    return "OpenRouter rejected the API key. Re-check OPENROUTER_API_KEY.";
  }
  if (err instanceof RateLimitError) {
    return "Rate limited by OpenRouter. Wait a moment and try again.";
  }
  if (err instanceof APIConnectionError) {
    return "Network error talking to OpenRouter. Check your connection and retry.";
  }
  // Log to server for debugging but return generic message to caller.
  console.warn(
    "[draft] LLM call failed:",
    err instanceof Error ? err.message : String(err),
  );
  return "Could not reach the drafter right now. Please try again.";
}
