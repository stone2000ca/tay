// Tests for lib/voice/calibrate.ts and lib/voice/rubric-schema.ts.
//
// We mock the openai SDK so the LLM call returns whatever the test
// chooses (good JSON, malformed JSON, missing fields, thrown error).
// Storage paths (saveRubric / getRubric) are exercised indirectly here
// only to the extent the extractor doesn't need them — the focus is
// rubric parsing + the extractor's input/output contract.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let chatCompleteMock: any;

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

// Back-compat shim — tests still reference `createMock`. Wire it to the
// chatComplete mock so existing assertions keep working with the new
// response shape ({ ok, content, ... }).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createMock: any = {
  mockResolvedValueOnce(payload: { choices?: Array<{ message?: { content?: string } }> }) {
    const content = payload?.choices?.[0]?.message?.content ?? "";
    chatCompleteMock.mockResolvedValueOnce({
      ok: true,
      content,
      provider: "openrouter",
      modelUsed: "test/quality",
    });
    return createMock;
  },
  mockRejectedValueOnce(_err: unknown) {
    chatCompleteMock.mockResolvedValueOnce({
      ok: false,
      error: "Could not reach the LLM right now. Please try again.",
    });
    return createMock;
  },
  get mock() {
    return chatCompleteMock.mock;
  },
};

const validRubric = {
  opener_style: "personalized first-name + observation about their team",
  avg_sentence_length_words: 14,
  formality: "neutral",
  signature_pattern: "First name only, no title",
  common_phrases: ["quick thought", "would love to learn", "open to a chat?"],
  avoid_phrases: ["circle back", "synergy", "low-hanging fruit"],
  tone_notes: "Warm, concise, slightly informal. Asks questions instead of telling.",
};

function llmResponseWith(content: string) {
  return { choices: [{ message: { content } }] };
}

beforeEach(() => {
  chatCompleteMock = vi.fn();
  process.env.OPENROUTER_API_KEY = "sk-or-test";
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe("parseRubric", () => {
  test("accepts a valid rubric", async () => {
    const { parseRubric } = await import("./rubric-schema");
    const result = parseRubric(validRubric);
    expect(result).not.toBeNull();
    expect(result?.formality).toBe("neutral");
    expect(result?.common_phrases).toHaveLength(3);
  });

  test("rejects missing required fields", async () => {
    const { parseRubric } = await import("./rubric-schema");
    expect(parseRubric({ ...validRubric, opener_style: undefined })).toBeNull();
    expect(parseRubric({ ...validRubric, avg_sentence_length_words: "abc" })).toBeNull();
    expect(parseRubric({ ...validRubric, formality: "very-casual" })).toBeNull();
    expect(parseRubric({ ...validRubric, signature_pattern: "" })).toBeNull();
    expect(parseRubric({ ...validRubric, tone_notes: 42 })).toBeNull();
    expect(parseRubric(null)).toBeNull();
    expect(parseRubric("not an object")).toBeNull();
  });

  test("caps phrase lists at 10 and dedupes", async () => {
    const { parseRubric } = await import("./rubric-schema");
    const many = Array.from({ length: 20 }, (_, i) => `phrase-${i}`);
    const withDupes = ["hello", "Hello", "HELLO", "world"];
    const result = parseRubric({ ...validRubric, common_phrases: many, avoid_phrases: withDupes });
    expect(result?.common_phrases).toHaveLength(10);
    expect(result?.avoid_phrases).toEqual(["hello", "world"]);
  });

  test("strips extra fields silently", async () => {
    const { parseRubric } = await import("./rubric-schema");
    const result = parseRubric({
      ...validRubric,
      religion: "any",
      political_view: "any",
      health_notes: "any",
    });
    expect(result).not.toBeNull();
    expect(result as object).not.toHaveProperty("religion");
    expect(result as object).not.toHaveProperty("political_view");
    expect(result as object).not.toHaveProperty("health_notes");
  });
});

describe("extractVoiceRubric", () => {
  const samples = [
    "Hi Jordan, saw your team just shipped the analytics rewrite — congrats. Quick thought on top of it: want to chat?",
    "Hey Sam, your post about hiring junior PMs really resonated. Curious how you measure outcomes — open to a 15-min chat?",
    "Morning Casey, the founder note about cohort retention got me thinking. Would love to learn how you got there. Have 15?",
    "Hi Riley, congrats on the Series B. I work with a few teams at your stage on outbound — any interest in comparing notes?",
    "Hey Devon, your changelog from last week was a great read. Want to swap notes on developer outbound sometime soon?",
  ];

  test("returns rubric on a successful mocked LLM response", async () => {
    createMock.mockResolvedValueOnce(llmResponseWith(JSON.stringify(validRubric)));
    const { extractVoiceRubric } = await import("./calibrate");

    const result = await extractVoiceRubric(samples);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rubric.formality).toBe("neutral");
      expect(result.modelUsed).toMatch(/.+/);
    }

    // Verify the prompt actually wraps samples in <untrusted_source> blocks.
    const callArg = createMock.mock.calls[0][0];
    const userMessage = callArg.messages.find((m: { role: string }) => m.role === "user")?.content as string;
    expect(userMessage).toContain('<untrusted_source index="1">');
    expect(userMessage).toContain('<untrusted_source index="5">');
    // Verify the response_format hint went out.
    expect(callArg.response_format).toEqual({ type: "json_object" });
  });

  test("returns error on malformed LLM JSON", async () => {
    createMock.mockResolvedValueOnce(llmResponseWith("this is not json {"));
    const { extractVoiceRubric } = await import("./calibrate");

    const result = await extractVoiceRubric(samples);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/malformed/i);
    }
  });

  test("returns error when LLM returns rubric missing fields", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(JSON.stringify({ opener_style: "ok", formality: "neutral" })),
    );
    const { extractVoiceRubric } = await import("./calibrate");

    const result = await extractVoiceRubric(samples);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/malformed rubric/i);
    }
  });

  test("rejects too-few samples", async () => {
    const { extractVoiceRubric } = await import("./calibrate");
    const result = await extractVoiceRubric(samples.slice(0, 2));
    expect(result.ok).toBe(false);
    expect(chatCompleteMock).not.toHaveBeenCalled();
  });

  test("rejects too-many samples", async () => {
    const { extractVoiceRubric } = await import("./calibrate");
    const tooMany = Array.from({ length: 15 }, () => samples[0]);
    const result = await extractVoiceRubric(tooMany);
    expect(result.ok).toBe(false);
    expect(chatCompleteMock).not.toHaveBeenCalled();
  });

  test("rejects samples that are too short", async () => {
    const { extractVoiceRubric } = await import("./calibrate");
    const result = await extractVoiceRubric(["hi", "hello", "hey there"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/too short/i);
    }
    expect(chatCompleteMock).not.toHaveBeenCalled();
  });

  test("strips ```json fences if the model wraps output", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith("```json\n" + JSON.stringify(validRubric) + "\n```"),
    );
    const { extractVoiceRubric } = await import("./calibrate");
    const result = await extractVoiceRubric(samples);
    expect(result.ok).toBe(true);
  });
});
