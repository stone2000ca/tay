// Tests for lib/reply/settings.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type ChainResult = {
  data?: unknown;
  error?: { message: string } | null;
};

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  capturedUpsert: unknown = null;
  capturedOnConflict: unknown = null;
  select() { return this; }
  upsert(row: unknown, opts?: unknown) {
    this.capturedUpsert = row;
    this.capturedOnConflict = opts;
    return this;
  }
  order() { return this; }
  limit() { return this; }
  async maybeSingle() { return this.result; }
  then<T1 = ChainResult, T2 = never>(
    onfulfilled?: ((v: ChainResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
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
  if (nextQueryIndex < queries.length) return queries[nextQueryIndex++];
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
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("getReplySettings", () => {
  test("returns OFF when no row exists", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { getReplySettings } = await import("./settings");
    const out = await getReplySettings();
    expect(out).toEqual({ autoReplyEnabled: false });
  });
  test("returns ON when row says so", async () => {
    const q = freshQuery();
    q.result = { data: { auto_reply_enabled: true }, error: null };
    const { getReplySettings } = await import("./settings");
    const out = await getReplySettings();
    expect(out).toEqual({ autoReplyEnabled: true });
  });
  test("soft-fails to OFF on DB error", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "DB down" } };
    const { getReplySettings } = await import("./settings");
    const out = await getReplySettings();
    expect(out).toEqual({ autoReplyEnabled: false });
  });
  test("returns OFF when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { getReplySettings } = await import("./settings");
    const out = await getReplySettings();
    expect(out).toEqual({ autoReplyEnabled: false });
  });
});

describe("setAutoReplyEnabled", () => {
  test("upserts with deterministic single-row id", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { setAutoReplyEnabled } = await import("./settings");
    await setAutoReplyEnabled(true);
    expect(q.capturedUpsert).toMatchObject({
      id: "00000000-0000-0000-0000-000000000001",
      auto_reply_enabled: true,
    });
    expect(q.capturedOnConflict).toEqual({ onConflict: "id" });
  });
  test("throws on DB error (write contract)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "fk violation" } };
    const { setAutoReplyEnabled } = await import("./settings");
    await expect(setAutoReplyEnabled(true)).rejects.toThrow(/fk violation/);
  });
  test("throws when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { setAutoReplyEnabled } = await import("./settings");
    await expect(setAutoReplyEnabled(true)).rejects.toThrow(/Supabase/);
  });
});
