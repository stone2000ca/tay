// Tests for lib/draft/generate.ts (v1.1.1).
//
// generateDraft now goes through chatComplete + getLlmClient from
// lib/llm. We mock those so tests stay focused on drafter behavior
// (no SDK shape dependencies).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { VoiceRubric } from "../voice/rubric-schema";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chatCompleteMock: any;
const getRubricMock = vi.fn();

vi.mock("../llm", async () => {
  const actual = await vi.importActual<typeof import("../llm")>("../llm");
  return {
    ...actual,
    getLlmClient: async () => ({
      ok: true,
      provider: "openrouter",
      client: {} as unknown,
      apiKey: "sk-or-test",
    }),
    chatComplete: (...args: unknown[]) => chatCompleteMock(...args),
    getModel: (tier: "cheap" | "quality") =>
      tier === "cheap" ? "test/cheap" : "test/quality",
    MODELS: { cheap: "test/cheap", quality: "test/quality" },
  };
});

vi.mock("../voice/calibrate", () => ({
  getRubric: getRubricMock,
}));

const validRubric: VoiceRubric = {
  opener_style: "personalized first-name + observation about their team",
  avg_sentence_length_words: 14,
  formality: "neutral",
  signature_pattern: "First name only, no title",
  common_phrases: ["quick thought", "would love to learn"],
  avoid_phrases: ["circle back", "synergy"],
  tone_notes: "Warm, concise, slightly informal.",
};

const validDraft = {
  subject: "Quick thought on your analytics work",
  body:
    "Hi Jordan,\n\nSaw the analytics rewrite ship — congrats. Quick thought: " +
    "want to compare notes on outbound for teams at your stage?\n\nJames",
};

function llmJson(obj: unknown) {
  chatCompleteMock.mockResolvedValueOnce({
    ok: true,
    content: JSON.stringify(obj),
    provider: "openrouter",
    modelUsed: "test/quality",
  });
}

function llmRaw(raw: string) {
  chatCompleteMock.mockResolvedValueOnce({
    ok: true,
    content: raw,
    provider: "openrouter",
    modelUsed: "test/quality",
  });
}

beforeEach(() => {
  chatCompleteMock = vi.fn();
  getRubricMock.mockReset();
  process.env.OPENROUTER_API_KEY = "sk-or-test";
  process.env.TAY_OAUTH_SECRET = "a".repeat(64);
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe("generateDraft", () => {
  test("returns draft with disclosure footer appended on success", async () => {
    llmJson(validDraft);
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.subject).toBe(validDraft.subject);
      expect(result.draft.body).toContain("Written with AI assistance");
      expect(result.draft.body).toContain("Reply STOP to opt out");
      expect(result.modelUsed).toMatch(/.+/);
      expect(result.rubricUsed).toEqual(validRubric);
    }

    // Verify chatComplete call shape.
    const callArg = chatCompleteMock.mock.calls[0][0];
    expect(callArg.response_format).toEqual({ type: "json_object" });
    expect(callArg.temperature).toBe(0.7);
    const systemMessage = callArg.messages.find(
      (m: { role: string }) => m.role === "system",
    )?.content as string;
    expect(systemMessage).toContain(validRubric.opener_style);
    expect(systemMessage).toContain(validRubric.signature_pattern);
  });

  test("does NOT double-append the disclosure if the model already included it", async () => {
    const draftWithFooter = {
      subject: "Hi",
      body:
        "Hi Jordan — quick thought on your launch. Want to chat?\n\n— Written with AI assistance. Reply STOP to opt out.",
    };
    llmJson(draftWithFooter);
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const matches = result.draft.body.match(/Written with AI assistance/g);
      expect(matches).toHaveLength(1);
    }
  });

  test("returns error on malformed JSON", async () => {
    llmRaw("this is not json {");
    const { generateDraft } = await import("./generate");
    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/malformed/i);
  });

  test("returns error when JSON is missing required keys", async () => {
    llmJson({ subject: "Only subject, no body" });
    const { generateDraft } = await import("./generate");
    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid|shape/i);
  });

  test("returns error when subject is too long (sanity cap)", async () => {
    llmJson({ subject: "x".repeat(500), body: "Hi there." });
    const { generateDraft } = await import("./generate");
    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });
    expect(result.ok).toBe(false);
  });

  test("forwards chatComplete error to caller (no SDK leak)", async () => {
    chatCompleteMock.mockResolvedValueOnce({
      ok: false,
      error: "Invalid API key. Double-check the key and try again.",
    });
    const { generateDraft } = await import("./generate");
    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/api key/i);
  });

  test("errors when getRubric returns null and no rubric arg is passed", async () => {
    getRubricMock.mockResolvedValueOnce(null);
    const { generateDraft } = await import("./generate");
    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/calibrate|voice/i);
    expect(chatCompleteMock).not.toHaveBeenCalled();
  });

  test("uses fetched rubric when no rubric arg is passed and getRubric returns one", async () => {
    getRubricMock.mockResolvedValueOnce(validRubric);
    llmJson(validDraft);
    const { generateDraft } = await import("./generate");
    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rubricUsed).toEqual(validRubric);
  });

  test("strips ```json fences if the model wraps output", async () => {
    llmRaw("```json\n" + JSON.stringify(validDraft) + "\n```");
    const { generateDraft } = await import("./generate");
    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });
    expect(result.ok).toBe(true);
  });
});
