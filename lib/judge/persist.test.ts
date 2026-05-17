// Tests for lib/judge/persist.ts.
//
// Mock the Supabase server client. Same FakeQuery pattern as the
// lib/draft/persist tests.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { VoiceRubric } from "../voice/rubric-schema";

type ChainResult = {
  data?: unknown;
  error?: { message: string } | null;
};

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  capturedInsert: unknown = null;
  select() {
    return this;
  }
  insert(row: unknown) {
    this.capturedInsert = row;
    return this;
  }
  eq() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    return this.result;
  }
  async single() {
    return this.result;
  }
}

const queries: FakeQuery[] = [];
let nextQueryIndex = 0;

function freshQuery(): FakeQuery {
  const q = new FakeQuery();
  queries.push(q);
  return q;
}

const fromMock = vi.fn(() => {
  if (nextQueryIndex < queries.length) {
    return queries[nextQueryIndex++];
  }
  return freshQuery();
});

vi.mock("../supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
  hasSupabaseEnv: () => true,
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

beforeEach(() => {
  queries.length = 0;
  nextQueryIndex = 0;
  fromMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("saveJudgeDecision", () => {
  test("builds correct row for allow decision", async () => {
    const q = freshQuery();
    q.result = { data: { id: "decision-id-1" }, error: null };

    const { saveJudgeDecision } = await import("./persist");
    const result = await saveJudgeDecision({
      draftId: "draft-1",
      decision: { decision: "allow", reasons: ["clean"] },
      modelUsed: "anthropic/claude-3.5-sonnet",
      rubricSnapshot: rubric,
    });

    expect(result.id).toBe("decision-id-1");
    expect(q.capturedInsert).toEqual({
      draft_id: "draft-1",
      decision: "allow",
      reasons: ["clean"],
      rewrite: null,
      model_used: "anthropic/claude-3.5-sonnet",
      rubric_snapshot: rubric,
    });
  });

  test("stores rewrite when decision is revise", async () => {
    const q = freshQuery();
    q.result = { data: { id: "decision-id-2" }, error: null };

    const rewrite = { subject: "Quick thought", body: "Hi Jordan, ..." };
    const { saveJudgeDecision } = await import("./persist");
    await saveJudgeDecision({
      draftId: "draft-2",
      decision: {
        decision: "revise",
        reasons: ["disclosure missing"],
        rewrite,
      },
      modelUsed: "anthropic/claude-3.5-sonnet",
      rubricSnapshot: rubric,
    });

    expect((q.capturedInsert as { rewrite: unknown }).rewrite).toEqual(rewrite);
  });

  test("rewrite is null for non-revise decisions", async () => {
    const q = freshQuery();
    q.result = { data: { id: "decision-id-3" }, error: null };

    const { saveJudgeDecision } = await import("./persist");
    await saveJudgeDecision({
      draftId: "draft-3",
      decision: { decision: "block", reasons: ["protected attribute"] },
      modelUsed: "anthropic/claude-3.5-sonnet",
      rubricSnapshot: rubric,
    });

    expect((q.capturedInsert as { rewrite: unknown }).rewrite).toBeNull();
  });

  test("throws on DB error (write contract)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "fk violation" } };

    const { saveJudgeDecision } = await import("./persist");
    await expect(
      saveJudgeDecision({
        draftId: "ghost-draft",
        decision: { decision: "allow", reasons: ["x"] },
        modelUsed: "m",
        rubricSnapshot: rubric,
      }),
    ).rejects.toThrow(/fk violation/);
  });
});

describe("getLatestDecisionForDraft", () => {
  test("returns parsed decision on success", async () => {
    const q = freshQuery();
    q.result = {
      data: { decision: "allow", reasons: ["ok"], rewrite: null },
      error: null,
    };

    const { getLatestDecisionForDraft } = await import("./persist");
    const out = await getLatestDecisionForDraft("draft-1");
    expect(out?.decision).toBe("allow");
    expect(out?.reasons).toEqual(["ok"]);
  });

  test("soft-fails to null on DB error (read contract)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "connection refused" } };

    const { getLatestDecisionForDraft } = await import("./persist");
    const out = await getLatestDecisionForDraft("draft-1");
    expect(out).toBeNull();
  });

  test("returns null when no rows", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };

    const { getLatestDecisionForDraft } = await import("./persist");
    const out = await getLatestDecisionForDraft("draft-1");
    expect(out).toBeNull();
  });

  test("returns null when stored row fails schema validation", async () => {
    const q = freshQuery();
    q.result = {
      data: { decision: "invalid-value", reasons: ["x"], rewrite: null },
      error: null,
    };

    const { getLatestDecisionForDraft } = await import("./persist");
    const out = await getLatestDecisionForDraft("draft-1");
    expect(out).toBeNull();
  });
});
