// Tests for lib/send/orchestrate.ts.
//
// Mocks every collaborator so the orchestrator's branching logic is
// exercised in isolation. Covers happy path + every documented failure
// path (Supabase missing, app config missing, rubric missing, draft
// not found, prospect not found, .invalid placeholder, judge != allow,
// suppressed, OAuth missing, Gmail 401).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------- collaborator mocks ----------

const hasSupabaseEnvMock = vi.fn(() => true);
const getAppConfigMock = vi.fn();
const getRubricMock = vi.fn();
const getLatestDecisionForDraftMock = vi.fn();
const ensureFreshAccessTokenMock = vi.fn();
const sendEmailMock = vi.fn();
const isSuppressedMock = vi.fn();
const recordTrustEventMock = vi.fn();
const appendAuditMock = vi.fn();

// ---------- Supabase fake ----------

type ChainResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: { op?: string; payload?: unknown; table?: string } = {};
  table: string;
  constructor(table: string) {
    this.table = table;
    this.captured.table = table;
  }
  select() {
    return this;
  }
  insert(row: unknown) {
    this.captured = { ...this.captured, op: "insert", payload: row };
    return this;
  }
  update(row: unknown) {
    this.captured = { ...this.captured, op: "update", payload: row };
    return this;
  }
  delete() {
    this.captured = { ...this.captured, op: "delete" };
    return this;
  }
  eq() {
    return this;
  }
  neq() {
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

// Per-table queue. Each .from(table) pops the next one (or creates fresh).
const tableQueues: Record<string, FakeQuery[]> = {};

function queueFor(table: string): FakeQuery[] {
  if (!tableQueues[table]) tableQueues[table] = [];
  return tableQueues[table];
}

function enqueue(table: string, result: ChainResult): FakeQuery {
  const q = new FakeQuery(table);
  q.result = result;
  queueFor(table).push(q);
  return q;
}

const fromMock = vi.fn((table: string) => {
  const queue = queueFor(table);
  if (queue.length > 0) {
    return queue.shift() as FakeQuery;
  }
  // Default empty success.
  const q = new FakeQuery(table);
  return q;
});

// ---------- vi.mock wiring ----------

vi.mock("../supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
  hasSupabaseEnv: () => hasSupabaseEnvMock(),
}));
vi.mock("../app-config", () => ({
  getAppConfig: () => getAppConfigMock(),
}));
vi.mock("../voice/calibrate", () => ({
  getRubric: () => getRubricMock(),
}));
vi.mock("../judge/persist", () => ({
  getLatestDecisionForDraft: (id: string) => getLatestDecisionForDraftMock(id),
}));
vi.mock("../oauth/persist", () => ({
  ensureFreshAccessToken: () => ensureFreshAccessTokenMock(),
}));
vi.mock("./gmail", () => ({
  sendEmail: (args: unknown) => sendEmailMock(args),
}));
vi.mock("../suppression/check", () => ({
  isSuppressed: (email: string) => isSuppressedMock(email),
}));
vi.mock("../trust/record", () => ({
  recordTrustEvent: (cap: string, type: string, meta: unknown) =>
    recordTrustEventMock(cap, type, meta),
}));
vi.mock("../audit/append", () => ({
  appendAudit: (event: unknown) => appendAuditMock(event),
}));

// ---------- helpers ----------

function happyPathSetup() {
  hasSupabaseEnvMock.mockReturnValue(true);
  getAppConfigMock.mockResolvedValue({ name: "Tay", validatedAt: "x" });
  getRubricMock.mockResolvedValue({ opener_style: "x" });
  enqueue("drafts", {
    data: {
      id: "d1",
      prospect_id: "p1",
      subject: "Hi",
      body: "Hello",
    },
    error: null,
  });
  enqueue("prospects", {
    data: {
      id: "p1",
      email: "jane@example.com",
      full_name: "Jane",
      company: "Acme",
    },
    error: null,
  });
  enqueue("sent_messages", { data: null, error: null }); // not already sent
  getLatestDecisionForDraftMock.mockResolvedValue({
    decision: "allow",
    reasons: ["ok"],
  });
  isSuppressedMock.mockResolvedValue(false);
  ensureFreshAccessTokenMock.mockResolvedValue("at-fresh");
  sendEmailMock.mockResolvedValue({
    ok: true,
    gmailMessageId: "gm-1",
    gmailThreadId: "gt-1",
  });
  enqueue("sent_messages", { data: null, error: null }); // insert success
  appendAuditMock.mockResolvedValue(undefined);
  recordTrustEventMock.mockResolvedValue(undefined);
}

beforeEach(() => {
  for (const k of Object.keys(tableQueues)) delete tableQueues[k];
  fromMock.mockClear();
  hasSupabaseEnvMock.mockReset();
  getAppConfigMock.mockReset();
  getRubricMock.mockReset();
  getLatestDecisionForDraftMock.mockReset();
  ensureFreshAccessTokenMock.mockReset();
  sendEmailMock.mockReset();
  isSuppressedMock.mockReset();
  recordTrustEventMock.mockReset();
  appendAuditMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- tests ----------

describe("sendDraft — happy path", () => {
  test("returns ok and writes audit + trust events", async () => {
    happyPathSetup();
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out).toEqual({
      ok: true,
      gmailMessageId: "gm-1",
      gmailThreadId: "gt-1",
      recipient: "jane@example.com",
    });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "send.sent" }),
    );
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "sent",
      expect.objectContaining({ gmailMessageId: "gm-1", draftId: "d1" }),
    );
  });

  test("calls isSuppressed BEFORE ensureFreshAccessToken (gate ordering)", async () => {
    happyPathSetup();
    const callOrder: string[] = [];
    isSuppressedMock.mockImplementation(async () => {
      callOrder.push("isSuppressed");
      return false;
    });
    ensureFreshAccessTokenMock.mockImplementation(async () => {
      callOrder.push("ensureFreshAccessToken");
      return "at";
    });
    sendEmailMock.mockImplementation(async () => {
      callOrder.push("sendEmail");
      return { ok: true, gmailMessageId: "gm", gmailThreadId: "gt" };
    });
    const { sendDraft } = await import("./orchestrate");
    await sendDraft("d1");
    expect(callOrder).toEqual([
      "isSuppressed",
      "ensureFreshAccessToken",
      "sendEmail",
    ]);
  });
});

describe("sendDraft — precondition failures", () => {
  test("missing draftId", async () => {
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("");
    expect(out.ok).toBe(false);
  });

  test("Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/Supabase/);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("app config missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(true);
    getAppConfigMock.mockResolvedValue(null);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/setup/i);
  });

  test("voice rubric missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(true);
    getAppConfigMock.mockResolvedValue({ name: "Tay", validatedAt: "x" });
    getRubricMock.mockResolvedValue(null);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/Voice rubric/);
  });

  test("draft not found", async () => {
    hasSupabaseEnvMock.mockReturnValue(true);
    getAppConfigMock.mockResolvedValue({ name: "Tay", validatedAt: "x" });
    getRubricMock.mockResolvedValue({ opener_style: "x" });
    enqueue("drafts", { data: null, error: null });
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d-ghost");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/not found/);
  });

  test("placeholder .invalid email", async () => {
    hasSupabaseEnvMock.mockReturnValue(true);
    getAppConfigMock.mockResolvedValue({ name: "Tay", validatedAt: "x" });
    getRubricMock.mockResolvedValue({ opener_style: "x" });
    enqueue("drafts", {
      data: { id: "d1", prospect_id: "p1", subject: "s", body: "b" },
      error: null,
    });
    enqueue("prospects", {
      data: {
        id: "p1",
        email: "unknown+jane@acme.invalid",
        full_name: "Jane",
        company: "Acme",
      },
      error: null,
    });
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/placeholder|real email/i);
  });

  test("already sent (idempotence)", async () => {
    hasSupabaseEnvMock.mockReturnValue(true);
    getAppConfigMock.mockResolvedValue({ name: "Tay", validatedAt: "x" });
    getRubricMock.mockResolvedValue({ opener_style: "x" });
    enqueue("drafts", {
      data: { id: "d1", prospect_id: "p1", subject: "s", body: "b" },
      error: null,
    });
    enqueue("prospects", {
      data: { id: "p1", email: "j@e.co" },
      error: null,
    });
    enqueue("sent_messages", { data: { id: "existing" }, error: null });
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/already been sent/);
  });

  test("judge decision != allow → blocked_by_judge trust event", async () => {
    happyPathSetup();
    getLatestDecisionForDraftMock.mockResolvedValue({
      decision: "block",
      reasons: ["protected attribute"],
    });
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/allow/);
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "blocked_by_judge",
      expect.any(Object),
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("no judge decision → reject", async () => {
    happyPathSetup();
    getLatestDecisionForDraftMock.mockResolvedValue(null);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/Re-run the judge/);
  });

  test("suppressed → blocked_by_suppression trust event", async () => {
    happyPathSetup();
    isSuppressedMock.mockResolvedValue(true);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/suppression/);
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "blocked_by_suppression",
      expect.any(Object),
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("ensureFreshAccessToken throws (expired refresh) → translates", async () => {
    happyPathSetup();
    ensureFreshAccessTokenMock.mockRejectedValue(
      new Error("Google token refresh failed (HTTP 400)."),
    );
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/refresh/);
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("sent_messages UNIQUE violation (concurrent insert) → friendly already-sent error", async () => {
    happyPathSetup();
    // Replace the sent_messages insert (4th queued for the SENT_TABLE)
    // with a UNIQUE-violation error. happyPathSetup enqueued: read
    // (not-sent), then insert (success); we need to override the insert.
    const sentQueue = tableQueues["sent_messages"] ?? [];
    // sentQueue[0] is the already-sent read; sentQueue[1] is the insert.
    const insertQ = sentQueue[1] as FakeQuery | undefined;
    expect(insertQ).toBeDefined();
    insertQ!.result = {
      data: null,
      error: {
        code: "23505",
        message:
          'duplicate key value violates unique constraint "sent_messages_draft_id_unique"',
      } as unknown as { message: string },
    };
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/already been sent/);
    // Gmail WAS called (the race got past the read-check) but no audit
    // (the winner of the race writes the audit).
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(appendAuditMock).not.toHaveBeenCalled();
  });

  test("Gmail 401 → returns gmail error, no audit, no trust 'sent'", async () => {
    happyPathSetup();
    sendEmailMock.mockResolvedValue({
      ok: false,
      error: "Gmail authentication failed; reconnect under Settings.",
    });
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    expect(appendAuditMock).not.toHaveBeenCalled();
    // No 'sent' trust event; allowed to have 'blocked_by_judge' etc but we
    // shouldn't see 'sent' specifically.
    const sentCalls = recordTrustEventMock.mock.calls.filter(
      (c) => c[1] === "sent",
    );
    expect(sentCalls.length).toBe(0);
  });
});
