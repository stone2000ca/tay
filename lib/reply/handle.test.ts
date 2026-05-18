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

const notifyReplyMock = vi.fn<(a: unknown) => Promise<{ notified: boolean; channel: string }>>(
  async () => ({ notified: true, channel: "email" }),
);
vi.mock("../notify/dispatch", () => ({
  notifyReply: (a: unknown) => notifyReplyMock(a),
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
  notifyReplyMock.mockClear();
  notifyReplyMock.mockResolvedValue({ notified: true, channel: "email" });
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

  test("interested + auto-reply ON + not suppressed → drafts reply (hydrates prospect)", async () => {
    setupMatchedFlow("interested");
    // The hydrateProspect query (FROM prospects) comes after the update
    // and before generateReplyDraft. Pre-load a fresh query slot.
    const prospectQ = freshQuery();
    prospectQ.result = {
      data: {
        full_name: "Alice Real",
        company: "Acme Co",
        notes: "Founder of Acme",
        email: "alice@example.com",
      },
      error: null,
    };
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
    // v1.0 carry-forward: prompt_inputs comes from the hydrated prospect,
    // not empty strings.
    const draftCall = generateReplyDraftMock.mock.calls[0]?.[0] as {
      promptInputs: Record<string, unknown>;
    };
    expect(draftCall?.promptInputs).toMatchObject({
      full_name: "Alice Real",
      company: "Acme Co",
    });
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reply.draft_generated" }),
    );
  });

  test("no thread match → reply row persists with <unmatched-thread> sentinel body (LOW carry-forward)", async () => {
    const sentQ = freshQuery();
    sentQ.result = { data: null, error: null };
    const insQ = freshQuery();
    insQ.result = { data: { id: "reply-1" }, error: null };
    const { handleReply } = await import("./handle");
    await handleReply(baseArgs);
    expect(insQ.capturedInsert).toMatchObject({
      body: "<unmatched-thread>",
    });
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

describe("handleReply — v1.1.2.5 dual thread anchor + channel tag", () => {
  test("SMTP path: empty gmailThreadId + inReplyToMessageId → matches via gmail_message_id fallback", async () => {
    // First query (gmail_thread_id lookup) — skipped when gmailThreadId
    // is empty. But our FakeQuery layer doesn't know that; the
    // implementation guard is the `if (args.gmailThreadId)` branch in
    // handle.ts. So the FIRST query in our queue is the fallback
    // (gmail_message_id eq) lookup, which should return the match.
    const fallbackQ = freshQuery();
    fallbackQ.result = {
      data: {
        id: "sent-1",
        draft_id: "draft-1",
        prospect_id: "prospect-1",
        subject: "Hi Alice",
        body: "original",
      },
      error: null,
    };
    const insQ = freshQuery();
    insQ.result = { data: { id: "reply-1" }, error: null };
    const updQ = freshQuery();
    updQ.result = { data: null, error: null };
    classifyMock.mockResolvedValue({
      ok: true,
      classification: {
        intent: "interested",
        confidence: 0.9,
        reasons: ["x"],
      },
      modelUsed: "m",
    });

    const { handleReply } = await import("./handle");
    const out = await handleReply({
      ...baseArgs,
      gmailThreadId: "", // SMTP has no thread id
      inReplyToMessageId: "<sent-1@tay.local>",
      channel: "app_password",
    });
    expect(out.ok).toBe(true);
    // The reply row should persist the full body (not the unmatched
    // sentinel) because we DID find a match via the fallback anchor.
    expect(insQ.capturedInsert).toMatchObject({
      sent_message_id: "sent-1",
      body: "thanks for reaching out",
    });
  });

  test("audit payload carries channel tag (app_password) when provided", async () => {
    const sentQ = freshQuery();
    sentQ.result = {
      data: {
        id: "sent-1",
        draft_id: "draft-1",
        prospect_id: "prospect-1",
        subject: "Hi",
        body: "original",
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
    await handleReply({ ...baseArgs, channel: "app_password" });

    const receivedCalls = appendAuditMock.mock.calls.filter(
      ([a]) => (a as { action: string }).action === "reply.received",
    );
    const payload = (receivedCalls[0][0] as { payload: Record<string, unknown> })
      .payload;
    expect(payload).toHaveProperty("channel", "app_password");
  });

  test("audit payload defaults channel='oauth' when caller omits it (v0.9 caller compat)", async () => {
    const sentQ = freshQuery();
    sentQ.result = { data: null, error: null };
    const insQ = freshQuery();
    insQ.result = { data: { id: "reply-1" }, error: null };

    const { handleReply } = await import("./handle");
    await handleReply(baseArgs);

    const receivedCalls = appendAuditMock.mock.calls.filter(
      ([a]) => (a as { action: string }).action === "reply.received",
    );
    const payload = (receivedCalls[0][0] as { payload: Record<string, unknown> })
      .payload;
    expect(payload).toHaveProperty("channel", "oauth");
  });
});

describe("handleReply — v1.1.4 notifyReply integration", () => {
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

  test("matched flow → notifyReply called with classification + matchedSendId", async () => {
    setupMatchedFlow("interested");
    const { handleReply } = await import("./handle");
    await handleReply(baseArgs);
    expect(notifyReplyMock).toHaveBeenCalledTimes(1);
    const arg = notifyReplyMock.mock.calls[0][0] as {
      reply: { from: string };
      classification: { intent: string };
      matchedSendId: string | null;
    };
    expect(arg.reply.from).toBe("alice@example.com");
    expect(arg.classification.intent).toBe("interested");
    expect(arg.matchedSendId).toBe("sent-1");
  });

  test("notifyReply throws → handler swallows and still finishes (audit reply.received still fires)", async () => {
    setupMatchedFlow("interested");
    notifyReplyMock.mockRejectedValueOnce(new Error("notify blew up"));
    const { handleReply } = await import("./handle");
    const out = await handleReply(baseArgs);
    expect(out.ok).toBe(true);
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "reply.received" }),
    );
  });

  test("notifyReply NOT called on skip path (no thread match)", async () => {
    const sentQ = freshQuery();
    sentQ.result = { data: null, error: null };
    const insQ = freshQuery();
    insQ.result = { data: { id: "reply-1" }, error: null };
    const { handleReply } = await import("./handle");
    await handleReply(baseArgs);
    expect(notifyReplyMock).not.toHaveBeenCalled();
  });

  test("notifyReply NOT called on classifier failure", async () => {
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
    await handleReply(baseArgs);
    expect(notifyReplyMock).not.toHaveBeenCalled();
  });
});
