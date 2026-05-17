// Tests for lib/draft/generate.ts.
//
// Mocks: the openai SDK (so we control the LLM output) and getRubric
// (so we can exercise both the "rubric passed in" and "rubric fetched
// from DB" paths). We never hit a network or DB.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { VoiceRubric } from "../voice/rubric-schema";

const createMock = vi.fn();
const getRubricMock = vi.fn();

// Mock the openai SDK — same shape as in calibrate.test.ts so error
// classes the SDK exports are recognizable via instanceof checks.
vi.mock("openai", () => {
  class FakeOpenAI {
    chat = { completions: { create: createMock } };
    constructor(_opts: unknown) {
      /* noop */
    }
  }
  class AuthenticationError extends Error {}
  class RateLimitError extends Error {}
  class APIConnectionError extends Error {}
  return {
    default: FakeOpenAI,
    AuthenticationError,
    RateLimitError,
    APIConnectionError,
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

function llmResponseWith(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  createMock.mockReset();
  getRubricMock.mockReset();
  process.env.OPENROUTER_API_KEY = "sk-or-test";
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe("generateDraft", () => {
  test("returns draft with disclosure footer appended on success", async () => {
    createMock.mockResolvedValueOnce(llmResponseWith(JSON.stringify(validDraft)));
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

    // Verify the LLM call shape — json_object response_format, temperature.
    const callArg = createMock.mock.calls[0][0];
    expect(callArg.response_format).toEqual({ type: "json_object" });
    expect(callArg.temperature).toBe(0.7);
    // Verify rubric leaked into system prompt (Tay gate D).
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
    createMock.mockResolvedValueOnce(
      llmResponseWith(JSON.stringify(draftWithFooter)),
    );
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // The "Written with AI assistance" substring should appear ONCE.
      const matches = result.draft.body.match(/Written with AI assistance/g);
      expect(matches).toHaveLength(1);
    }
  });

  test("returns error on malformed JSON", async () => {
    createMock.mockResolvedValueOnce(llmResponseWith("this is not json {"));
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/malformed/i);
    }
  });

  test("returns error when JSON is missing required keys", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(JSON.stringify({ subject: "Only subject, no body" })),
    );
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/invalid|shape/i);
    }
  });

  test("returns error when subject is too long (sanity cap)", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(
        JSON.stringify({
          subject: "x".repeat(500),
          body: "Hi there.",
        }),
      ),
    );
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });

    expect(result.ok).toBe(false);
  });

  test("maps AuthenticationError to friendly message (no SDK leak)", async () => {
    const openai = await import("openai");
    // Mocked AuthenticationError above is a plain Error subclass; the real
    // SDK constructor takes 4 args, but our mock accepts just a message.
    // Cast to bypass the real-SDK type signature.
    const Ctor = openai.AuthenticationError as unknown as new (
      msg: string,
    ) => Error;
    const err = new Ctor("401 invalid_api_key acct_secret_12345");
    createMock.mockRejectedValueOnce(err);
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/api key|OpenRouter/i);
      // The raw SDK string with account fragment must NOT leak.
      expect(result.error).not.toContain("acct_secret_12345");
    }
  });

  test("errors when getRubric returns null and no rubric arg is passed", async () => {
    getRubricMock.mockResolvedValueOnce(null);
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/calibrate|voice/i);
    }
    // No LLM call should have been made.
    expect(createMock).not.toHaveBeenCalled();
  });

  test("uses fetched rubric when no rubric arg is passed and getRubric returns one", async () => {
    getRubricMock.mockResolvedValueOnce(validRubric);
    createMock.mockResolvedValueOnce(llmResponseWith(JSON.stringify(validDraft)));
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rubricUsed).toEqual(validRubric);
    }
  });

  test("strips ```json fences if the model wraps output", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith("```json\n" + JSON.stringify(validDraft) + "\n```"),
    );
    const { generateDraft } = await import("./generate");

    const result = await generateDraft({
      prospect: { full_name: "Jordan", company: "Acme" },
      rubric: validRubric,
    });

    expect(result.ok).toBe(true);
  });
});
