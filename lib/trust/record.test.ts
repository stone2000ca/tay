import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type ChainResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: { op?: string; payload?: unknown } = {};
  insert(row: unknown) {
    this.captured = { op: "insert", payload: row };
    return this;
  }
  then<TResult1 = ChainResult, TResult2 = never>(
    onfulfilled?:
      | ((value: ChainResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
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

const hasSupabaseEnvMock = vi.fn(() => true);

vi.mock("../supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
  hasSupabaseEnv: () => hasSupabaseEnvMock(),
}));

beforeEach(() => {
  queries.length = 0;
  nextQueryIndex = 0;
  fromMock.mockClear();
  hasSupabaseEnvMock.mockReturnValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("recordTrustEvent", () => {
  test("skips silently when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { recordTrustEvent } = await import("./record");
    await expect(
      recordTrustEvent("send", "sent", { x: 1 }),
    ).resolves.toBeUndefined();
    expect(fromMock).not.toHaveBeenCalled();
  });

  test("inserts capability, event_type, and metadata", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { recordTrustEvent } = await import("./record");
    await recordTrustEvent("send", "sent", {
      gmailMessageId: "abc",
      draftId: "d1",
    });
    expect(q.captured.op).toBe("insert");
    expect(q.captured.payload).toEqual({
      capability: "send",
      event_type: "sent",
      metadata: { gmailMessageId: "abc", draftId: "d1" },
    });
  });

  test("never throws on DB error", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "boom" } };
    const { recordTrustEvent } = await import("./record");
    await expect(
      recordTrustEvent("send", "blocked_by_suppression", {}),
    ).resolves.toBeUndefined();
  });
});
