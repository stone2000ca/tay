// Tests for lib/reply/poll.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mock the OAuth + Gmail helpers.
const ensureFreshAccessTokenMock = vi.fn(async () => "test-access-token");
vi.mock("../oauth/persist", () => ({
  ensureFreshAccessToken: () => ensureFreshAccessTokenMock(),
}));

const getProfileMock = vi.fn();
const getRecentMessagesWithHistoryIdMock = vi.fn();
const getRecentMessagesMock = vi.fn();
const getMessageMock = vi.fn();
vi.mock("../oauth/google", () => ({
  getProfile: (...a: unknown[]) => getProfileMock(...a),
  getRecentMessages: (...a: unknown[]) => getRecentMessagesMock(...a),
  getRecentMessagesWithHistoryId: (...a: unknown[]) =>
    getRecentMessagesWithHistoryIdMock(...a),
  getMessage: (...a: unknown[]) => getMessageMock(...a),
}));

// Mock handleReply.
const handleReplyMock = vi.fn();
vi.mock("./handle", () => ({
  handleReply: (...a: unknown[]) => handleReplyMock(...a),
}));

// v1.1.2.5 — pollReplies dispatcher depends on getMailboxKind + the IMAP
// poller. We mock both at this seam so the OAuth-side tests above still
// exercise the real pollGmail() body.
const getMailboxKindMock = vi.fn();
vi.mock("../mailbox/persist", () => ({
  getMailboxKind: () => getMailboxKindMock(),
}));

const pollImapMailboxMock = vi.fn();
vi.mock("./imap-poll", () => ({
  pollImapMailbox: () => pollImapMailboxMock(),
}));

// Supabase mock — programmable per-call queries.
type ChainResult = { data?: unknown; error?: { message: string } | null };
class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: { method: string; args: unknown[] }[] = [];
  select() { this.captured.push({ method: "select", args: [] }); return this; }
  insert(row: unknown) { this.captured.push({ method: "insert", args: [row] }); return this; }
  update(row: unknown) { this.captured.push({ method: "update", args: [row] }); return this; }
  upsert(row: unknown, opts?: unknown) {
    this.captured.push({ method: "upsert", args: [row, opts] });
    return this;
  }
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
  getRecentMessagesWithHistoryIdMock.mockReset();
  getMessageMock.mockReset();
  handleReplyMock.mockReset();
  hasSupabaseEnvMock.mockReturnValue(true);
  getMailboxKindMock.mockReset();
  pollImapMailboxMock.mockReset();
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

  test("first poll: cursor null → seed cursor via upsert(onConflict=lock_col) and bail (no backfill)", async () => {
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: null, error: null };
    const cursorUpsertQ = freshQuery();
    cursorUpsertQ.result = { data: null, error: null };
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "1000",
    });

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out).toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(getRecentMessagesWithHistoryIdMock).not.toHaveBeenCalled();
    const upsertCall = cursorUpsertQ.captured.find((c) => c.method === "upsert");
    expect(upsertCall?.args?.[0]).toMatchObject({
      last_history_id: "1000",
      lock_col: 1,
    });
    expect(upsertCall?.args?.[1]).toEqual({ onConflict: "lock_col" });
  });

  test("with cursor + no new messages → still advances cursor when historyId moved", async () => {
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_history_id: "500" }, error: null };
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "501",
    });
    getRecentMessagesWithHistoryIdMock.mockResolvedValueOnce({
      refs: [],
      historyId: "510", // Gmail bumped historyId even with no new mail
    });
    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out).toEqual({ processed: 0, skipped: 0, errors: 0 });
    const upsertCall = advanceQ.captured.find((c) => c.method === "upsert");
    expect(upsertCall?.args?.[0]).toMatchObject({
      last_history_id: "510",
      lock_col: 1,
    });
  });

  test("cursor advances using historyId from History API response (NOT a second getProfile)", async () => {
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_history_id: "500" }, error: null };
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "500", // unused for advance
    });
    getRecentMessagesWithHistoryIdMock.mockResolvedValueOnce({
      refs: [{ id: "msg-1", threadId: "thread-A" }],
      historyId: "777",
    });
    const filterQ = freshQuery();
    filterQ.result = {
      data: [{ gmail_thread_id: "thread-A" }],
      error: null,
    };
    getMessageMock.mockResolvedValueOnce({
      id: "msg-1",
      threadId: "thread-A",
      from: "alice@example.com",
      subject: "Re: hi",
      body: "thanks",
      internalDate: "2026-05-17T10:00:00.000Z",
    });
    handleReplyMock.mockResolvedValue({ ok: true, intent: "interested", replyDrafted: false });
    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out.processed).toBe(1);
    expect(getProfileMock).toHaveBeenCalledTimes(1); // pre-poll, NOT for advance
    const advanceCall = advanceQ.captured.find((c) => c.method === "upsert");
    expect(advanceCall?.args?.[0]).toMatchObject({
      last_history_id: "777",
      lock_col: 1,
    });
  });

  test("self-email short-circuits (skips classifier)", async () => {
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_history_id: "500" }, error: null };
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "500",
    });
    getRecentMessagesWithHistoryIdMock.mockResolvedValueOnce({
      refs: [{ id: "msg-self", threadId: "thread-A" }],
      historyId: "777",
    });
    const filterQ = freshQuery();
    filterQ.result = {
      data: [{ gmail_thread_id: "thread-A" }],
      error: null,
    };
    getMessageMock.mockResolvedValueOnce({
      id: "msg-self",
      threadId: "thread-A",
      from: "Me <me@example.com>",
      subject: "Re: hi",
      body: "our outbound message",
      internalDate: "2026-05-17T10:00:00.000Z",
    });
    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out.skipped).toBe(1);
    expect(handleReplyMock).not.toHaveBeenCalled();
  });

  test("with cursor + new messages → filters to OUR threads + invokes handleReply", async () => {
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_history_id: "500" }, error: null };
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "501",
    });
    getRecentMessagesWithHistoryIdMock.mockResolvedValueOnce({
      refs: [
        { id: "msg-1", threadId: "thread-A" }, // ours
        { id: "msg-2", threadId: "thread-B" }, // not ours
        { id: "msg-3", threadId: "thread-A" }, // ours
      ],
      historyId: "888",
    });
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
    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

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
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "500",
    });
    getRecentMessagesWithHistoryIdMock.mockResolvedValueOnce({
      refs: [{ id: "msg-1", threadId: "thread-A" }],
      historyId: "501",
    });
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
    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

    const { pollGmail } = await import("./poll");
    const out = await pollGmail();
    expect(out.errors).toBe(1);
    expect(out.processed).toBe(0);
  });
});

describe("pollReplies (v1.1.2.5 channel dispatcher)", () => {
  test("oauth kind → delegates to pollGmail, tags channel='oauth'", async () => {
    getMailboxKindMock.mockResolvedValueOnce("oauth");
    // Drive the inner pollGmail() down its no-cursor seed path (lightest
    // possible) by returning a null cursor and giving getProfile a value.
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: null, error: null };
    const cursorUpsertQ = freshQuery();
    cursorUpsertQ.result = { data: null, error: null };
    getProfileMock.mockResolvedValueOnce({
      emailAddress: "me@example.com",
      historyId: "1000",
    });

    const { pollReplies } = await import("./poll");
    const out = await pollReplies();
    expect(out.channel).toBe("oauth");
    expect(out.processed).toBe(0);
    expect(pollImapMailboxMock).not.toHaveBeenCalled();
  });

  test("app_password kind → delegates to pollImapMailbox, tags channel='app_password'", async () => {
    getMailboxKindMock.mockResolvedValueOnce("app_password");
    pollImapMailboxMock.mockResolvedValueOnce({
      processed: 3,
      skipped: 1,
      errors: 0,
    });
    const { pollReplies } = await import("./poll");
    const out = await pollReplies();
    expect(out).toEqual({
      channel: "app_password",
      processed: 3,
      skipped: 1,
      errors: 0,
    });
    expect(pollImapMailboxMock).toHaveBeenCalledOnce();
  });

  test("app_password kind: pollImapMailbox reason is forwarded", async () => {
    getMailboxKindMock.mockResolvedValueOnce("app_password");
    pollImapMailboxMock.mockResolvedValueOnce({
      processed: 0,
      skipped: 0,
      errors: 0,
      reason: "auth_failed",
    });
    const { pollReplies } = await import("./poll");
    const out = await pollReplies();
    expect(out.reason).toBe("auth_failed");
    expect(out.channel).toBe("app_password");
  });

  test("no mailbox kind → channel='none', reason='no_mailbox', no poller called", async () => {
    getMailboxKindMock.mockResolvedValueOnce(null);
    const { pollReplies } = await import("./poll");
    const out = await pollReplies();
    expect(out).toEqual({
      channel: "none",
      processed: 0,
      skipped: 0,
      errors: 0,
      reason: "no_mailbox",
    });
    expect(pollImapMailboxMock).not.toHaveBeenCalled();
    expect(ensureFreshAccessTokenMock).not.toHaveBeenCalled();
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
