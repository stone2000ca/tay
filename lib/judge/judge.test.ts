// Tests for lib/judge/judge.ts (v1.1.1).
//
// judge now goes through chatComplete + getLlmClient from lib/llm.
// Same mock pattern as generate.test.ts.

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

const rubric: VoiceRubric = {
  opener_style: "personalized first-name + observation",
  avg_sentence_length_words: 14,
  formality: "neutral",
  signature_pattern: "First name only",
  common_phrases: ["quick thought"],
  avoid_phrases: ["circle back"],
  tone_notes: "Warm, concise.",
};

const draft = {
  subject: "Quick thought on your analytics",
  body:
    "Hi Jordan,\n\nNice work on the analytics rewrite.\n\nJames\n\n— Written with AI assistance. Reply STOP to opt out.",
};

const prospect = { full_name: "Jordan", company: "Acme" };

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
});

afterEach(() => {
  delete process.env.OPENROUTER_API_KEY;
});

describe("judgeDraft — happy paths", () => {
  test("returns allow decision when LLM allows", async () => {
    llmJson({
      decision: "allow",
      reasons: ["disclosure present", "rubric honored"],
    });
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decision).toBe("allow");
      expect(result.decision.reasons.length).toBeGreaterThan(0);
      expect(result.rubricUsed).toEqual(rubric);
    }
    const callArg = chatCompleteMock.mock.calls[0][0];
    expect(callArg.response_format).toEqual({ type: "json_object" });
    expect(callArg.temperature).toBe(0.2);
  });

  test("returns block decision when LLM blocks", async () => {
    llmJson({
      decision: "block",
      reasons: ["draft inferred a protected attribute about prospect"],
    });
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect, rubric });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.decision).toBe("block");
  });

  test("returns revise decision with rewrite when LLM revises", async () => {
    llmJson({
      decision: "revise",
      reasons: ["disclosure footer missing"],
      rewrite: {
        subject: "Quick thought",
        body:
          "Hi Jordan, ...\n\n— Written with AI assistance. Reply STOP to opt out.",
      },
    });
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect, rubric });
    expect(result.ok).toBe(true);
    if (result.ok && result.decision.decision === "revise") {
      expect(result.decision.rewrite.body).toContain("Written with AI assistance");
    }
  });

  test("returns escalate decision when LLM escalates", async () => {
    llmJson({
      decision: "escalate",
      reasons: ["draft references its own system instructions"],
    });
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect, rubric });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.decision.decision).toBe("escalate");
  });

  test("strips ```json fences if the model wraps output", async () => {
    llmRaw(
      "```json\n" + JSON.stringify({ decision: "allow", reasons: ["ok"] }) + "\n```",
    );
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect, rubric });
    expect(result.ok).toBe(true);
  });
});

describe("judgeDraft — rejection paths", () => {
  test("returns ok:false on malformed JSON", async () => {
    llmRaw("this is not json {");
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect, rubric });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/malformed JSON/i);
  });

  test("returns ok:false on out-of-union decision value", async () => {
    llmJson({ decision: "approve", reasons: ["looks ok"] });
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect, rubric });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/malformed decision/i);
  });

  test("returns ok:false on revise missing rewrite", async () => {
    llmJson({ decision: "revise", reasons: ["disclosure missing"] });
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect, rubric });
    expect(result.ok).toBe(false);
  });

  test("forwards chatComplete error to caller (no SDK leak)", async () => {
    chatCompleteMock.mockResolvedValueOnce({
      ok: false,
      error: "Invalid API key. Double-check the key and try again.",
    });
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect, rubric });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/api key/i);
      expect(result.error).not.toContain("acct_");
    }
  });

  test("returns ok:false when no rubric available and none passed", async () => {
    getRubricMock.mockResolvedValueOnce(null);
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/calibrate|voice/i);
    expect(chatCompleteMock).not.toHaveBeenCalled();
  });

  test("uses fetched rubric when none passed", async () => {
    getRubricMock.mockResolvedValueOnce(rubric);
    llmJson({ decision: "allow", reasons: ["ok"] });
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({ draft, prospectInputs: prospect });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rubricUsed).toEqual(rubric);
  });
});
