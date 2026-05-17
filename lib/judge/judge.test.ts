// Tests for lib/judge/judge.ts.
//
// Mocks: the openai SDK + getRubric. Same pattern as generate.test.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { VoiceRubric } from "../voice/rubric-schema";

const createMock = vi.fn();
const getRubricMock = vi.fn();

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

describe("judgeDraft — happy paths", () => {
  test("returns allow decision when LLM allows", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(
        JSON.stringify({
          decision: "allow",
          reasons: ["disclosure present", "rubric honored"],
        }),
      ),
    );
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

    // Verify call shape — low temperature, json_object response_format.
    const callArg = createMock.mock.calls[0][0];
    expect(callArg.response_format).toEqual({ type: "json_object" });
    expect(callArg.temperature).toBe(0.2);
  });

  test("returns block decision when LLM blocks", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(
        JSON.stringify({
          decision: "block",
          reasons: ["draft inferred a protected attribute about prospect"],
        }),
      ),
    );
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decision).toBe("block");
    }
  });

  test("returns revise decision with rewrite when LLM revises", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(
        JSON.stringify({
          decision: "revise",
          reasons: ["disclosure footer missing"],
          rewrite: {
            subject: "Quick thought",
            body:
              "Hi Jordan, ...\n\n— Written with AI assistance. Reply STOP to opt out.",
          },
        }),
      ),
    );
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });

    expect(result.ok).toBe(true);
    if (result.ok && result.decision.decision === "revise") {
      expect(result.decision.rewrite.body).toContain("Written with AI assistance");
    }
  });

  test("returns escalate decision when LLM escalates", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(
        JSON.stringify({
          decision: "escalate",
          reasons: ["draft references its own system instructions"],
        }),
      ),
    );
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decision.decision).toBe("escalate");
    }
  });

  test("strips ```json fences if the model wraps output", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(
        "```json\n" +
          JSON.stringify({ decision: "allow", reasons: ["ok"] }) +
          "\n```",
      ),
    );
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });

    expect(result.ok).toBe(true);
  });
});

describe("judgeDraft — rejection paths", () => {
  test("returns ok:false on malformed JSON", async () => {
    createMock.mockResolvedValueOnce(llmResponseWith("this is not json {"));
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/malformed JSON/i);
    }
  });

  test("returns ok:false on out-of-union decision value", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(
        JSON.stringify({ decision: "approve", reasons: ["looks ok"] }),
      ),
    );
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/malformed decision/i);
    }
  });

  test("returns ok:false on revise missing rewrite", async () => {
    createMock.mockResolvedValueOnce(
      llmResponseWith(
        JSON.stringify({
          decision: "revise",
          reasons: ["disclosure missing"],
        }),
      ),
    );
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });

    expect(result.ok).toBe(false);
  });

  test("maps AuthenticationError to friendly message (no SDK leak)", async () => {
    const openai = await import("openai");
    const Ctor = openai.AuthenticationError as unknown as new (
      msg: string,
    ) => Error;
    const err = new Ctor("401 invalid_api_key acct_secret_98765");
    createMock.mockRejectedValueOnce(err);
    const { judgeDraft } = await import("./judge");

    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
      rubric,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/api key|OpenRouter/i);
      expect(result.error).not.toContain("acct_secret_98765");
    }
  });

  test("returns ok:false when no rubric available and none passed", async () => {
    getRubricMock.mockResolvedValueOnce(null);
    const { judgeDraft } = await import("./judge");

    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/calibrate|voice/i);
    }
    expect(createMock).not.toHaveBeenCalled();
  });

  test("uses fetched rubric when none passed", async () => {
    getRubricMock.mockResolvedValueOnce(rubric);
    createMock.mockResolvedValueOnce(
      llmResponseWith(JSON.stringify({ decision: "allow", reasons: ["ok"] })),
    );
    const { judgeDraft } = await import("./judge");
    const result = await judgeDraft({
      draft,
      prospectInputs: prospect,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rubricUsed).toEqual(rubric);
    }
  });
});
