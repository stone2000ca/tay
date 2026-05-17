// Tests for lib/draft/persist.ts.
//
// Mock the Supabase server client so we can assert what rows we'd write
// without hitting a real database. We rebuild a fresh chain for each
// test so the previous test's mocks don't bleed in.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { VoiceRubric } from "../voice/rubric-schema";

type ChainResult = {
  data?: unknown;
  error?: { message: string } | null;
  count?: number | null;
};

// Per-test programmable chain. Each method returns `this` so the
// supabase-style fluent API works, and `maybeSingle`/`single` resolve
// with whatever the test queued.
class FakeQuery {
  result: ChainResult = { data: null, error: null };
  capturedInsert: unknown = null;
  capturedUpdate: unknown = null;
  select() {
    return this;
  }
  insert(row: unknown) {
    this.capturedInsert = row;
    return this;
  }
  update(row: unknown) {
    this.capturedUpdate = row;
    return this;
  }
  delete() {
    return this;
  }
  eq() {
    return this;
  }
  not() {
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
  then(onFulfilled: (r: ChainResult) => unknown) {
    // Allows `await supabase.from(...).update(...).eq(...)` style.
    return Promise.resolve(this.result).then(onFulfilled);
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
  // Return the next-queued query, falling back to a fresh empty one.
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

describe("upsertProspect", () => {
  test("inserts a new prospect when none exists", async () => {
    // Query 1: select existing → returns null
    const selectQ = freshQuery();
    selectQ.result = { data: null, error: null };
    // Query 2: insert → returns new id
    const insertQ = freshQuery();
    insertQ.result = { data: { id: "new-prospect-id" }, error: null };

    const { upsertProspect } = await import("./persist");
    const result = await upsertProspect({
      full_name: "Jordan",
      company: "Acme",
      notes: "Just shipped analytics",
    });

    expect(result.id).toBe("new-prospect-id");
    expect(insertQ.capturedInsert).toMatchObject({
      full_name: "Jordan",
      company: "Acme",
      notes: "Just shipped analytics",
    });
    // Synthesized email placeholder should be invalid TLD.
    expect((insertQ.capturedInsert as { email: string }).email).toMatch(
      /\.invalid$/,
    );
  });

  test("updates notes when prospect already exists", async () => {
    // Query 1: select returns an existing id
    const selectQ = freshQuery();
    selectQ.result = { data: { id: "existing-id" }, error: null };
    // Query 2: update
    const updateQ = freshQuery();
    updateQ.result = { data: null, error: null };

    const { upsertProspect } = await import("./persist");
    const result = await upsertProspect({
      full_name: "Jordan",
      company: "Acme",
      notes: "New context",
    });

    expect(result.id).toBe("existing-id");
    expect(updateQ.capturedUpdate).toEqual({ notes: "New context" });
  });

  test("throws on DB error (write contract)", async () => {
    const selectQ = freshQuery();
    selectQ.result = { data: null, error: { message: "connection refused" } };

    const { upsertProspect } = await import("./persist");
    await expect(
      upsertProspect({ full_name: "Jordan", company: "Acme" }),
    ).rejects.toThrow(/connection refused/);
  });
});

describe("saveDraft", () => {
  test("inserts the draft row with rubric_snapshot and prompt_inputs", async () => {
    const insertQ = freshQuery();
    insertQ.result = { data: { id: "draft-id-1" }, error: null };

    const { saveDraft } = await import("./persist");
    const result = await saveDraft({
      prospectId: "prospect-id-1",
      draft: { subject: "Quick thought", body: "Hi Jordan,\n\n..." },
      rubric,
      promptInputs: {
        full_name: "Jordan",
        company: "Acme",
        notes: "Just shipped",
      },
      modelUsed: "anthropic/claude-3.5-sonnet",
    });

    expect(result.id).toBe("draft-id-1");
    expect(insertQ.capturedInsert).toEqual({
      prospect_id: "prospect-id-1",
      subject: "Quick thought",
      body: "Hi Jordan,\n\n...",
      model_used: "anthropic/claude-3.5-sonnet",
      rubric_snapshot: rubric,
      prompt_inputs: {
        full_name: "Jordan",
        company: "Acme",
        notes: "Just shipped",
      },
    });
  });

  test("throws on insert error (write contract)", async () => {
    const insertQ = freshQuery();
    insertQ.result = { data: null, error: { message: "fk violation" } };

    const { saveDraft } = await import("./persist");
    await expect(
      saveDraft({
        prospectId: "missing-prospect",
        draft: { subject: "s", body: "b" },
        rubric,
        promptInputs: { full_name: "x", company: "y" },
        modelUsed: "m",
      }),
    ).rejects.toThrow(/fk violation/);
  });
});
