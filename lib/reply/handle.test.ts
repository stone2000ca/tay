// Tests for lib/reply/handle.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Mocks for collaborators.
const classifyMock = vi.fn();
vi.mock("./classify", async () => {
  const actual = await vi.importActual<typeof import("./classify")>("./classify");
  return { ...actual, classifyReply: (...a: unknown[]) => classifyMock(...a) };
});

const generateReplyDraftMock = vi.fn();
vi.mock("./draft", () => ({
  generateReplyDraft: (...a: unknown[]) => generateReplyDraftMock(...a),
}));

const getRubricMock = vi.fn<() => Promise<unknown>>(async () => null);
vi.mock("../voice/calibrate", () => ({
  getRubric: () => getRubricMock(),
}));

const getReplySettingsMock = vi.fn<() => Promise<{ autoReplyEnabled: boolean }>>(
  async () => ({ autoReplyEnabled: false }),
);
vi.mock("./settings", () => ({
  getReplySettings: () => getReplySettingsMock(),
}));

const isSuppressedMock = vi.fn<(e: string) => Promise<boolean>>(
  async () => false,
);
vi.mock("../suppression/check", () => ({
  isSuppressed: (e: string) => isSuppressedMock(e),
}));

const addSuppressionMock = vi.fn<(a: unknown) => Promise<void>>(
  async () => {},
);
vi.mock("../suppression/add", () => ({
  addSuppression: (a: unknown) => addSuppressionMock(a),
}));

const appendAuditMock = vi.fn<(a: unknown) => Promise<void>>(
  async () => {},
);
vi.mock("../audit/append", () => ({
  appendAudit: (a: unknown) => appendAuditMock(a),
}));

const recordTrustEventMock = vi.fn<(...a: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("../trust/record", () => ({
  recordTrustEvent: (...a: unknown[]) => recordTrustEventMock(...a),
}));

// Supabase mock with programmable per-query results.
type ChainResult = { data?: unknown; error?: { message?: string; code?: string } | null };
class FakeQuery {
  result: ChainResult = { data: null, error: null };
  capturedInsert: unknown = null;
  capturedUpdate: unknown = null;
  select() { return this; }
  insert(row: unknown) { this.capturedInsert = row; return this; }
  update(row: unknown) { this.capturedUpdate = row; return this; }
  eq() { return this; }
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
  classifyMock.mockReset();
  generateReplyDraftMock.mockReset();
  getRubricMock.mockResolvedValue(null);
  getReplySettingsMock.mockResolvedValue({ autoReplyEnabled: false });
  isSuppressedMock.mockResolvedValue(false);
  addSuppressionMock.mockClear();
  appendAuditMock.mockClear();
  recordTrustEventMock.mockClear();
  hasSupabaseEnvMock.mockReturnValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseArgs = {
  gmailMessageId: "m1",
  gmailThreadId: "t1",
  fromEmail: "alice@example.com",
  subject: "Re: hi",
  body: "thanks for reaching out",
  receivedAt: "2026-05-17T10:00:00.000Z",
};

describe("handleReply — gating", () => {
  test("returns error when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(false);
  });

  test("23505 dedupe → ok:true intent='duplicate'", async () => {
    // sent_messages lookup → null (skip path), but dedupe path triggers first.
    const sentQ = freshQuery();
    sentQ.result = { data: null, error: null };
    const insQ = freshQuery();
    insQ.result = {
      data: null,
      error: { code: "23505", message: "duplicate key value violates" },
    };
    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.intent).toBe("duplicate");
  });

  test("no thread match → skip, record reply row, audit only", async () => {
    const sentQ = freshQuery();
    sentQ.result = { data: null, error: null };
    const insQ = freshQuery();
    insQ.result = { data: { id: "reply-1" }, error: null };

    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.intent).toBe("skipped");
      expect(out.replyDrafted).toBe(false);
    }
    expect(classifyMock).not.toHaveBeenCalled();
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reply.received" }),
    );
  });
});

describe("handleReply — branches", () => {
  function setupMatchedFlow(intent: string) {
    const sentQ = freshQuery();
    sentQ.result = {
      data: {
        id: "sent-1",
        draft_id: "draft-1",
        prospect_id: "prospect-1",
        subject: "Hi Alice",
        body: "original outbound body",
      },
      error: null,
    };
    const insQ = freshQuery();
    insQ.result = { data: { id: "reply-1" }, error: null };
    const updQ = freshQuery();
    updQ.result = { data: null, error: null };
    classifyMock.mockResolvedValue({
      ok: true,
      classification: { intent, confidence: 0.9, reasons: ["x"] },
      modelUsed: "test/cheap",
    });
  }

  test("unsubscribe_request → addSuppression + user.unsubscribed audit + trust replied_negative", async () => {
    setupMatchedFlow("unsubscribe_request");
    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.intent).toBe("unsubscribe_request");
    expect(addSuppressionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "alice@example.com",
        reason: "user_unsubscribe",
        source: "reply-classifier",
      }),
    );
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.unsubscribed" }),
    );
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "replied_negative",
      expect.any(Object),
    );
  });

  test("out_of_office → trust replied_negative; no suppression", async () => {
    setupMatchedFlow("out_of_office");
    const { handleReply } = await import("./handle");
    await handleReply(baseArgs);
    expect(addSuppressionMock).not.toHaveBeenCalled();
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "replied_negative",
      expect.any(Object),
    );
  });

  test("not_interested → trust replied_negative; no suppression", async () => {
    setupMatchedFlow("not_interested");
    const { handleReply } = await import("./handle");
    await handleReply(baseArgs);
    expect(addSuppressionMock).not.toHaveBeenCalled();
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "replied_negative",
      expect.any(Object),
    );
  });

  test("interested + auto-reply OFF → trust replied_positive, no draft", async () => {
    setupMatchedFlow("interested");
    getReplySettingsMock.mockResolvedValue({ autoReplyEnabled: false });
    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.replyDrafted).toBe(false);
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "replied_positive",
      expect.any(Object),
    );
    expect(generateReplyDraftMock).not.toHaveBeenCalled();
  });

  test("interested + auto-reply ON + not suppressed → drafts reply", async () => {
    setupMatchedFlow("interested");
    getReplySettingsMock.mockResolvedValue({ autoReplyEnabled: true });
    isSuppressedMock.mockResolvedValue(false);
    generateReplyDraftMock.mockResolvedValue({
      ok: true,
      draftId: "new-reply-draft",
      judgeDecision: "allow",
      modelUsed: "test/quality",
    });
    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.replyDrafted).toBe(true);
    expect(generateReplyDraftMock).toHaveBeenCalled();
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reply.draft_generated" }),
    );
  });

  test("interested + auto-reply ON + suppressed → no draft (Tay gate E defense)", async () => {
    setupMatchedFlow("interested");
    getReplySettingsMock.mockResolvedValue({ autoReplyEnabled: true });
    isSuppressedMock.mockResolvedValue(true);
    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.replyDrafted).toBe(false);
    expect(generateReplyDraftMock).not.toHaveBeenCalled();
  });

  test("'other' intent → no trust event, no draft", async () => {
    setupMatchedFlow("other");
    const { handleReply } = await import("./handle");
    await handleReply(baseArgs);
    expect(recordTrustEventMock).not.toHaveBeenCalled();
    expect(generateReplyDraftMock).not.toHaveBeenCalled();
  });

  test("classifier failure → ok:false but reply row stays persisted", async () => {
    const sentQ = freshQuery();
    sentQ.result = {
      data: {
        id: "sent-1",
        draft_id: "draft-1",
        prospect_id: "prospect-1",
        subject: "Hi",
        body: "body",
      },
      error: null,
    };
    const insQ = freshQuery();
    insQ.result = { data: { id: "reply-1" }, error: null };
    classifyMock.mockResolvedValue({ ok: false, error: "LLM down" });

    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/LLM down/);
  });
});

describe("handleReply — audit payload shape", () => {
  test("reply.received payload contains operational fields only (no body)", async () => {
    const sentQ = freshQuery();
    sentQ.result = {
      data: {
        id: "sent-1",
        draft_id: "draft-1",
        prospect_id: "prospect-1",
        subject: "Hi",
        body: "original body",
      },
      error: null,
    };
    const insQ = freshQuery();
    insQ.result = { data: { id: "reply-1" }, error: null };
    const updQ = freshQuery();
    updQ.result = { data: null, error: null };
    classifyMock.mockResolvedValue({
      ok: true,
      classification: { intent: "interested", confidence: 0.9, reasons: ["x"] },
      modelUsed: "m",
    });

    const { handleReply } = await import("./handle");
    await handleReply(baseArgs);

    const receivedCalls = appendAuditMock.mock.calls.filter(
      ([a]) => (a as { action: string }).action === "reply.received",
    );
    expect(receivedCalls.length).toBeGreaterThanOrEqual(1);
    const payload = (receivedCalls[0][0] as { payload: Record<string, unknown> })
      .payload;
    expect(payload).not.toHaveProperty("body");
    expect(payload).toHaveProperty("intent");
    expect(payload).toHaveProperty("gmailMessageId");
  });
});
