// Tests for lib/reply/poll.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the OAuth + Gmail helpers.
const ensureFreshAccessTokenMock = vi.fn(async () => "test-access-token");
vi.mock("../oauth/persist", () => ({
  ensureFreshAccessToken: () => ensureFreshAccessTokenMock(),
}));

const getProfileMock = vi.fn();
const getRecentMessagesMock = vi.fn();
const getMessageMock = vi.fn();
vi.mock("../oauth/google", () => ({
  getProfile: (...a: unknown[]) => getProfileMock(...a),
  getRecentMessages: (...a: unknown[]) => getRecentMessagesMock(...a),
  getMessage: (...a: unknown[]) => getMessageMock(...a),
}));

// Mock handleReply.
const handleReplyMock = vi.fn();
vi.mock("./handle", () => ({
  handleReply: (...a: unknown[]) => handleReplyMock(...a),
}));

// Supabase mock — programmable per-call queries.
type ChainResult = { data?: unknown; error?: { message: string } | null };
class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: { method: string; args: unknown[] }[] = [];
  select() { this.captured.push({ method: "select", args: [] }); return this; }
  insert(row: unknown) { this.captured.push({ method: "insert", args: [row] }); return this; }
  update(row: unknown) { this.captured.push({ method: "update", args: [row] }); return this; }
  in() { this.captured.push({ method: "in", args: [] }); return this; }
  eq() { return this; }
  neq() { return this; }
  order() { return this; }
  limit() { return this; }
  async maybeSingle() { return this.result; }
  async single() { return this.result; }
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
  ensureFreshAccessTokenMock.mockClear();
  getProfileMock.mockReset();
  getRecentMessagesMock.mockReset();
  getMessageMock.mockReset();
  handleReplyMock.mockReset();
  hasSupabaseEnvMock.mockReturnValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollGmail", () => {
  test("skips entirely when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out).toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(ensureFreshAccessTokenMock).not.toHaveBeenCalled();
  });

  test("errors when access token unavailable", async () => {
    ensureFreshAccessTokenMock.mockRejectedValueOnce(new Error("not connected"));
    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out.errors).toBe(1);
  });

  test("first poll: cursor null → seed cursor and bail (no backfill)", async () => {
    // cursor read returns null
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: null, error: null };
    // cursor insert
    const cursorInsertQ = freshQuery();
    cursorInsertQ.result = { data: null, error: null };
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "1000",
    });

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out).toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(getRecentMessagesMock).not.toHaveBeenCalled();
    // Captured insert payload has the seed historyId.
    const insertCall = cursorInsertQ.captured.find((c) => c.method === "insert");
    expect(insertCall?.args?.[0]).toMatchObject({ last_history_id: "1000" });
  });

  test("with cursor + no new messages → no work", async () => {
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_history_id: "500" }, error: null };
    getRecentMessagesMock.mockResolvedValueOnce([]);

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out).toEqual({ processed: 0, skipped: 0, errors: 0 });
  });

  test("with cursor + new messages → filters to OUR threads + invokes handleReply", async () => {
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_history_id: "500" }, error: null };
    getRecentMessagesMock.mockResolvedValueOnce([
      { id: "msg-1", threadId: "thread-A" }, // ours
      { id: "msg-2", threadId: "thread-B" }, // not ours
      { id: "msg-3", threadId: "thread-A" }, // ours
    ]);
    // sent_messages thread filter
    const filterQ = freshQuery();
    filterQ.result = {
      data: [{ gmail_thread_id: "thread-A" }],
      error: null,
    };
    getMessageMock.mockImplementation(async (args: { id: string }) => ({
      id: args.id,
      threadId: "thread-A",
      from: "alice@example.com",
      subject: "Re: hi",
      body: "thanks",
      internalDate: "2026-05-17T10:00:00.000Z",
    }));
    handleReplyMock.mockResolvedValue({ ok: true, intent: "interested", replyDrafted: false });

    // cursor advance: profile + update
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "501",
    });
    const updateQ = freshQuery();
    updateQ.result = { data: null, error: null };

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out.processed).toBe(2);
    expect(out.skipped).toBe(1);
    expect(out.errors).toBe(0);
    expect(handleReplyMock).toHaveBeenCalledTimes(2);
  });

  test("handleReply error per-message counts as error, not crash", async () => {
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_history_id: "500" }, error: null };
    getRecentMessagesMock.mockResolvedValueOnce([
      { id: "msg-1", threadId: "thread-A" },
    ]);
    const filterQ = freshQuery();
    filterQ.result = { data: [{ gmail_thread_id: "thread-A" }], error: null };
    getMessageMock.mockResolvedValueOnce({
      id: "msg-1",
      threadId: "thread-A",
      from: "alice@example.com",
      subject: "S",
      body: "b",
      internalDate: "2026-05-17T10:00:00.000Z",
    });
    handleReplyMock.mockResolvedValue({ ok: false, error: "boom" });
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "501",
    });
    const updateQ = freshQuery();
    updateQ.result = { data: null, error: null };

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out.errors).toBe(1);
    expect(out.processed).toBe(0);
  });
});

describe("parseFromAddress", () => {
  test("strips name + angle brackets", async () => {
    const { parseFromAddress } = await import("./poll");
    expect(parseFromAddress("Alice <alice@example.com>")).toBe("alice@example.com");
  });
  test("returns bare email untouched", async () => {
    const { parseFromAddress } = await import("./poll");
    expect(parseFromAddress("alice@example.com")).toBe("alice@example.com");
  });
  test("empty input → empty string", async () => {
    const { parseFromAddress } = await import("./poll");
    expect(parseFromAddress("")).toBe("");
  });
});
