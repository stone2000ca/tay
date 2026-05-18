// Thin tests for the zero-emails path. Confirms the wrapper rejects
// empty input and delegates a real sample to extractVoiceRubric (which
// has its own test coverage).

import { beforeEach, describe, expect, test, vi } from "vitest";

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
    getModel: () => "test/quality",
  };
});

const validRubric = {
  opener_style: "first-name + observation",
  avg_sentence_length_words: 12,
  formality: "casual",
  signature_pattern: "First name only",
  common_phrases: ["quick thought"],
  avoid_phrases: ["circle back"],
  tone_notes: "Concise.",
};

beforeEach(() => {
  chatCompleteMock = vi.fn().mockResolvedValue({
    ok: true,
    content: JSON.stringify(validRubric),
    provider: "openrouter",
    modelUsed: "test/quality",
  });
});

describe("extractRubricFromZero", () => {
  test("rejects empty sample without calling LLM", async () => {
    const { extractRubricFromZero } = await import("./calibrate-from-zero");
    const result = await extractRubricFromZero({ userWrittenSample: "  " });
    expect(result.ok).toBe(false);
    expect(chatCompleteMock).not.toHaveBeenCalled();
  });

  test("delegates a real sample to extractVoiceRubric (single-sample path)", async () => {
    const { extractRubricFromZero } = await import("./calibrate-from-zero");
    const result = await extractRubricFromZero({
      userWrittenSample:
        "Hey Jordan — saw your launch yesterday. Loved the design polish. Quick thought on the onboarding flow.",
    });
    expect(result.ok).toBe(true);
    // Verify one LLM call, with the sample inside an <untrusted_source>
    // block (the existing extractVoiceRubric path wraps it).
    expect(chatCompleteMock).toHaveBeenCalledTimes(1);
    const userMessage = chatCompleteMock.mock.calls[0][0].messages.find(
      (m: { role: string }) => m.role === "user",
    )?.content as string;
    expect(userMessage).toContain('<untrusted_source index="1">');
  });
});
