// Tests for lib/send/orchestrate.ts.
//
// Mocks every collaborator so the orchestrator's branching logic is
// exercised in isolation. Covers happy path + every documented failure
// path (Supabase missing, app config missing, rubric missing, draft
// not found, prospect not found, .invalid placeholder, judge != allow,
// suppressed, OAuth missing, Gmail 401).
//
// v1.1.2: orchestrator is channel-aware. We test BOTH the oauth path
// (existing v0.7+ flow) AND the app_password / SMTP path. The gate-
// ordering test asserts suppression-BEFORE-network for BOTH channels.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// ---------- collaborator mocks ----------

const hasSupabaseEnvMock = vi.fn(() => true);
const getAppConfigMock = vi.fn();
const getRubricMock = vi.fn();
const getLatestDecisionForDraftMock = vi.fn();
const ensureFreshAccessTokenMock = vi.fn();
const sendEmailMock = vi.fn();
const sendEmailViaSmtpMock = vi.fn();
const isSuppressedMock = vi.fn();
const recordTrustEventMock = vi.fn();
const appendAuditMock = vi.fn();
const getMailboxCredentialsMock = vi.fn();

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
vi.mock("./smtp", () => ({
  sendEmailViaSmtp: (args: unknown) => sendEmailViaSmtpMock(args),
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
vi.mock("../mailbox/persist", () => ({
  getMailboxCredentials: () => getMailboxCredentialsMock(),
}));

// ---------- helpers ----------

function oauthMailbox() {
  return {
    kind: "oauth" as const,
    emailAddress: "alice@example.com",
    refreshToken: "rt",
    accessToken: "at",
    expiresAt: "2026-05-17T12:00:00Z",
    scopes: "gmail.send",
  };
}

function smtpMailbox() {
  return {
    kind: "app_password" as const,
    emailAddress: "alice@gmail.com",
    password: "app-pass",
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    imapHost: "imap.gmail.com",
    imapPort: 993,
  };
}

function happyPathSetup(channel: "oauth" | "app_password" = "oauth") {
  hasSupabaseEnvMock.mockReturnValue(true);
  getAppConfigMock.mockResolvedValue({ name: "Tay", validatedAt: "x" });
  getRubricMock.mockResolvedValue({ opener_style: "x" });
  getMailboxCredentialsMock.mockResolvedValue(
    channel === "oauth" ? oauthMailbox() : smtpMailbox(),
  );
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
  sendEmailViaSmtpMock.mockResolvedValue({
    ok: true,
    messageId: "<msg-1@example.com>",
    threadId: undefined,
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
  sendEmailViaSmtpMock.mockReset();
  isSuppressedMock.mockReset();
  recordTrustEventMock.mockReset();
  appendAuditMock.mockReset();
  getMailboxCredentialsMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- OAuth-channel tests (existing v0.7 path, preserved) -------

describe("sendDraft — happy path (oauth channel)", () => {
  test("returns ok and writes audit + trust events with channel='oauth'", async () => {
    happyPathSetup("oauth");
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out).toEqual({
      ok: true,
      gmailMessageId: "gm-1",
      gmailThreadId: "gt-1",
      recipient: "jane@example.com",
      channel: "oauth",
    });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(sendEmailViaSmtpMock).not.toHaveBeenCalled();
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "send.sent",
        payload: expect.objectContaining({ channel: "oauth" }),
      }),
    );
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "sent",
      expect.objectContaining({
        providerMessageId: "gm-1",
        draftId: "d1",
        channel: "oauth",
      }),
    );
  });

  test("OAUTH: calls isSuppressed BEFORE ensureFreshAccessToken (gate ordering)", async () => {
    happyPathSetup("oauth");
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

// ---------- SMTP-channel tests (new in v1.1.2) -----------------------

describe("sendDraft — happy path (app_password / smtp channel)", () => {
  test("returns ok and writes audit + trust events with channel='app_password'", async () => {
    happyPathSetup("app_password");
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out).toEqual({
      ok: true,
      gmailMessageId: "<msg-1@example.com>",
      gmailThreadId: "", // SMTP has no native thread id
      recipient: "jane@example.com",
      channel: "app_password",
    });
    expect(sendEmailViaSmtpMock).toHaveBeenCalledOnce();
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(ensureFreshAccessTokenMock).not.toHaveBeenCalled();
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "send.sent",
        payload: expect.objectContaining({ channel: "app_password" }),
      }),
    );
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "sent",
      expect.objectContaining({
        providerMessageId: "<msg-1@example.com>",
        draftId: "d1",
        channel: "app_password",
      }),
    );
  });

  test("SMTP: passes host/port/credentials + recipient/subject/body to nodemailer wrapper", async () => {
    happyPathSetup("app_password");
    const { sendDraft } = await import("./orchestrate");
    await sendDraft("d1");
    expect(sendEmailViaSmtpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        port: 587,
        username: "alice@gmail.com",
        password: "app-pass",
        fromAddress: "alice@gmail.com",
        to: "jane@example.com",
        subject: "Hi",
        body: "Hello",
      }),
    );
  });

  test("SMTP: calls isSuppressed BEFORE sendEmailViaSmtp (gate ordering — SAME invariant as oauth path)", async () => {
    happyPathSetup("app_password");
    const callOrder: string[] = [];
    isSuppressedMock.mockImplementation(async () => {
      callOrder.push("isSuppressed");
      return false;
    });
    sendEmailViaSmtpMock.mockImplementation(async () => {
      callOrder.push("sendEmailViaSmtp");
      return { ok: true, messageId: "<x@y>", threadId: undefined };
    });
    const { sendDraft } = await import("./orchestrate");
    await sendDraft("d1");
    expect(callOrder).toEqual(["isSuppressed", "sendEmailViaSmtp"]);
  });

  test("SMTP: send failure surfaces friendly error, no audit, no 'sent' trust event", async () => {
    happyPathSetup("app_password");
    sendEmailViaSmtpMock.mockResolvedValue({
      ok: false,
      error: "SMTP authentication failed. ...",
    });
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/SMTP authentication/i);
    expect(appendAuditMock).not.toHaveBeenCalled();
    const sentCalls = recordTrustEventMock.mock.calls.filter(
      (c) => c[1] === "sent",
    );
    expect(sentCalls.length).toBe(0);
  });

  test("SMTP: suppression check blocks send WITHOUT calling nodemailer", async () => {
    happyPathSetup("app_password");
    isSuppressedMock.mockResolvedValue(true);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/suppression/);
    expect(sendEmailViaSmtpMock).not.toHaveBeenCalled();
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "blocked_by_suppression",
      expect.objectContaining({ channel: "app_password" }),
    );
  });
});

// ---------- precondition failures (shared across channels) -----------

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
    expect(sendEmailViaSmtpMock).not.toHaveBeenCalled();
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

  test("mailbox not connected → friendly error, no draft load", async () => {
    hasSupabaseEnvMock.mockReturnValue(true);
    getAppConfigMock.mockResolvedValue({ name: "Tay", validatedAt: "x" });
    getRubricMock.mockResolvedValue({ opener_style: "x" });
    getMailboxCredentialsMock.mockResolvedValue(null);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/mailbox/i);
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sendEmailViaSmtpMock).not.toHaveBeenCalled();
  });

  test("draft not found", async () => {
    hasSupabaseEnvMock.mockReturnValue(true);
    getAppConfigMock.mockResolvedValue({ name: "Tay", validatedAt: "x" });
    getRubricMock.mockResolvedValue({ opener_style: "x" });
    getMailboxCredentialsMock.mockResolvedValue(oauthMailbox());
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
    getMailboxCredentialsMock.mockResolvedValue(oauthMailbox());
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
    getMailboxCredentialsMock.mockResolvedValue(oauthMailbox());
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
    happyPathSetup("oauth");
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
      expect.objectContaining({ channel: "oauth" }),
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("no judge decision → reject", async () => {
    happyPathSetup("oauth");
    getLatestDecisionForDraftMock.mockResolvedValue(null);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/Re-run the judge/);
  });

  test("suppressed → blocked_by_suppression trust event (oauth)", async () => {
    happyPathSetup("oauth");
    isSuppressedMock.mockResolvedValue(true);
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/suppression/);
    expect(recordTrustEventMock).toHaveBeenCalledWith(
      "send",
      "blocked_by_suppression",
      expect.objectContaining({ channel: "oauth" }),
    );
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("ensureFreshAccessToken throws (expired refresh) → translates", async () => {
    happyPathSetup("oauth");
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
    happyPathSetup("oauth");
    const sentQueue = tableQueues["sent_messages"] ?? [];
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
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(appendAuditMock).not.toHaveBeenCalled();
  });

  test("Gmail 401 → returns gmail error, no audit, no trust 'sent'", async () => {
    happyPathSetup("oauth");
    sendEmailMock.mockResolvedValue({
      ok: false,
      error: "Gmail authentication failed; reconnect under Settings.",
    });
    const { sendDraft } = await import("./orchestrate");
    const out = await sendDraft("d1");
    expect(out.ok).toBe(false);
    expect(appendAuditMock).not.toHaveBeenCalled();
    const sentCalls = recordTrustEventMock.mock.calls.filter(
      (c) => c[1] === "sent",
    );
    expect(sentCalls.length).toBe(0);
  });
});
