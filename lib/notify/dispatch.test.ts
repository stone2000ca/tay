// Tests for lib/notify/dispatch.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ReplyClassification } from "../reply/classify";

// ---------- mocks ------------------------------------------------------

const getPreferencesMock = vi.fn();
vi.mock("./preferences", async () => {
  const actual = await vi.importActual<typeof import("./preferences")>(
    "./preferences",
  );
  return {
    ...actual,
    getPreferences: () => getPreferencesMock(),
  };
});

const getMailboxCredentialsMock = vi.fn();
vi.mock("../mailbox/persist", () => ({
  getMailboxCredentials: () => getMailboxCredentialsMock(),
}));

const ensureFreshAccessTokenMock = vi.fn<() => Promise<string>>(
  async () => "fake-access-token",
);
vi.mock("../oauth/persist", () => ({
  ensureFreshAccessToken: () => ensureFreshAccessTokenMock(),
}));

const sendEmailMock = vi.fn<(a: unknown) => Promise<{ ok: boolean; error?: string; gmailMessageId?: string; gmailThreadId?: string }>>();
vi.mock("../send/gmail", () => ({
  sendEmail: (a: unknown) => sendEmailMock(a),
}));

const sendEmailViaSmtpMock = vi.fn<(a: unknown) => Promise<{ ok: boolean; error?: string; messageId?: string }>>();
vi.mock("../send/smtp", () => ({
  sendEmailViaSmtp: (a: unknown) => sendEmailViaSmtpMock(a),
}));

const appendAuditMock = vi.fn<(a: unknown) => Promise<void>>(async () => {});
vi.mock("../audit/append", () => ({
  appendAudit: (a: unknown) => appendAuditMock(a),
}));

vi.mock("../site-url", () => ({
  getSiteUrl: () => "https://tay.example.com",
}));

const fetchMock = vi.fn();
beforeEach(() => {
  getPreferencesMock.mockReset();
  getMailboxCredentialsMock.mockReset();
  ensureFreshAccessTokenMock.mockReset();
  ensureFreshAccessTokenMock.mockResolvedValue("fake-access-token");
  sendEmailMock.mockReset();
  sendEmailViaSmtpMock.mockReset();
  appendAuditMock.mockClear();
  fetchMock.mockReset();
  (globalThis as unknown as { fetch: typeof fetch }).fetch =
    fetchMock as unknown as typeof fetch;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------- fixtures ---------------------------------------------------

const baseClassification: ReplyClassification = {
  intent: "interested",
  confidence: 0.87,
  reasons: ["explicit 'yes'", "asks for a meeting next week"],
};

const baseInput = {
  reply: {
    from: "sarah@fintech.example",
    subject: "Re: quick question",
    receivedAt: "2026-05-17T10:00:00.000Z",
  },
  classification: baseClassification,
  matchedSendId: "sent-1",
};

const oauthMailbox = {
  kind: "oauth" as const,
  emailAddress: "me@example.com",
  refreshToken: "r",
  accessToken: "a",
  expiresAt: null,
  scopes: "gmail.send gmail.readonly",
};

const smtpMailbox = {
  kind: "app_password" as const,
  emailAddress: "me@example.com",
  password: "pw",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  imapHost: "imap.example.com",
  imapPort: 993,
};

const VALID_WEBHOOK =
  "https://hooks.slack.com/services/T0001/B0002/abcdefghij1234567890";

// ---------- channel = "none" -------------------------------------------

describe("notifyReply — channel = none", () => {
  test("never sends; audits with reason='disabled'", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "none",
      enabledForIntents: ["interested"],
    });
    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out).toEqual({
      notified: false,
      channel: "none",
      reason: "disabled",
    });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(sendEmailViaSmtpMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "reply.notified",
        payload: expect.objectContaining({
          channel: "none",
          notified: false,
          reason: "disabled",
        }),
      }),
    );
  });
});

// ---------- intent filtering -------------------------------------------

describe("notifyReply — intent filtering", () => {
  test("intent not in enabledForIntents → skipped with reason='intent_disabled'", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "email",
      enabledForIntents: ["interested"], // other intent excluded
    });
    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply({
      ...baseInput,
      classification: { ...baseClassification, intent: "other" },
    });
    expect(out).toEqual({
      notified: false,
      channel: "email",
      reason: "intent_disabled",
    });
    expect(getMailboxCredentialsMock).not.toHaveBeenCalled();
  });
});

// ---------- channel = "email" ------------------------------------------

describe("notifyReply — channel = email", () => {
  test("oauth mailbox: composes + sends via Gmail", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "email",
      enabledForIntents: ["interested"],
    });
    getMailboxCredentialsMock.mockResolvedValue(oauthMailbox);
    sendEmailMock.mockResolvedValue({
      ok: true,
      gmailMessageId: "m1",
      gmailThreadId: "t1",
    });

    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out).toEqual({ notified: true, channel: "email" });

    expect(ensureFreshAccessTokenMock).toHaveBeenCalled();
    const sendCall = sendEmailMock.mock.calls[0][0] as {
      to: string;
      subject: string;
      body: string;
    };
    expect(sendCall.to).toBe("me@example.com");
    expect(sendCall.subject).toContain("[Tay]");
    expect(sendCall.subject).toContain("interested");
    expect(sendCall.subject).toContain("sarah@fintech.example");
    // Body must NOT contain the reply body itself.
    expect(sendCall.body).not.toContain("Re: quick question");
    expect(sendCall.body).toContain("https://tay.example.com/replies");
  });

  test("smtp mailbox: composes + sends via SMTP", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "email",
      enabledForIntents: ["interested"],
    });
    getMailboxCredentialsMock.mockResolvedValue(smtpMailbox);
    sendEmailViaSmtpMock.mockResolvedValue({ ok: true, messageId: "<m@x>" });

    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out).toEqual({ notified: true, channel: "email" });
    expect(sendEmailViaSmtpMock).toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("emailOverride routes to alternate inbox", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "email",
      emailOverride: "notifications@example.com",
      enabledForIntents: ["interested"],
    });
    getMailboxCredentialsMock.mockResolvedValue(oauthMailbox);
    sendEmailMock.mockResolvedValue({
      ok: true,
      gmailMessageId: "m1",
      gmailThreadId: "t1",
    });

    const { notifyReply } = await import("./dispatch");
    await notifyReply(baseInput);
    const sendCall = sendEmailMock.mock.calls[0][0] as { to: string };
    expect(sendCall.to).toBe("notifications@example.com");
  });

  test("no mailbox connected → skipped with reason='no_mailbox'", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "email",
      enabledForIntents: ["interested"],
    });
    getMailboxCredentialsMock.mockResolvedValue(null);

    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out.notified).toBe(false);
    expect(out.reason).toBe("no_mailbox");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  test("send failure → reason='send_failed'; never throws", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "email",
      enabledForIntents: ["interested"],
    });
    getMailboxCredentialsMock.mockResolvedValue(oauthMailbox);
    sendEmailMock.mockResolvedValue({ ok: false, error: "Gmail 401" });

    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out.notified).toBe(false);
    expect(out.reason).toBe("send_failed");
  });

  test("oauth refresh failure → reason='send_failed'; never throws", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "email",
      enabledForIntents: ["interested"],
    });
    getMailboxCredentialsMock.mockResolvedValue(oauthMailbox);
    ensureFreshAccessTokenMock.mockRejectedValueOnce(new Error("refresh blew up"));

    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out.notified).toBe(false);
    expect(out.reason).toBe("send_failed");
  });
});

// ---------- channel = "slack_webhook" ----------------------------------

describe("notifyReply — channel = slack_webhook", () => {
  test("posts JSON to webhook; returns notified=true on 200", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "slack_webhook",
      slackWebhookUrl: VALID_WEBHOOK,
      enabledForIntents: ["interested"],
    });
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out).toEqual({ notified: true, channel: "slack_webhook" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(VALID_WEBHOOK);
    expect((init as RequestInit).method).toBe("POST");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.text).toContain("interested reply from sarah@fintech.example");
    // Slack payload must NOT include the reply body content.
    expect(JSON.stringify(body)).not.toContain("Re: quick question");
  });

  test("non-2xx response → reason='send_failed'", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "slack_webhook",
      slackWebhookUrl: VALID_WEBHOOK,
      enabledForIntents: ["interested"],
    });
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));

    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out.notified).toBe(false);
    expect(out.reason).toBe("send_failed");
  });

  test("missing webhook URL → reason='webhook_missing'", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "slack_webhook",
      slackWebhookUrl: undefined,
      enabledForIntents: ["interested"],
    });
    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out.notified).toBe(false);
    expect(out.reason).toBe("webhook_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("fetch throws → reason='send_failed'; never throws to caller", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "slack_webhook",
      slackWebhookUrl: VALID_WEBHOOK,
      enabledForIntents: ["interested"],
    });
    fetchMock.mockRejectedValue(new Error("network down"));

    const { notifyReply } = await import("./dispatch");
    const out = await notifyReply(baseInput);
    expect(out.notified).toBe(false);
    expect(out.reason).toBe("send_failed");
  });
});

// ---------- audit + PII --------------------------------------------------

describe("notifyReply — audit + PII", () => {
  test("audit payload carries channel + intent + notified + reason; no reply body", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "none",
      enabledForIntents: ["interested"],
    });
    const { notifyReply } = await import("./dispatch");
    await notifyReply({
      ...baseInput,
      reply: { ...baseInput.reply, subject: "TOPSECRET-SUBJ" },
    });
    const auditCall = appendAuditMock.mock.calls[0][0] as {
      payload: Record<string, unknown>;
    };
    expect(auditCall.payload.channel).toBe("none");
    expect(auditCall.payload.intent).toBe("interested");
    expect(auditCall.payload.notified).toBe(false);
    expect(JSON.stringify(auditCall.payload)).not.toContain("TOPSECRET-SUBJ");
  });

  test("Slack webhook URL NEVER appears in console.warn on non-2xx", async () => {
    getPreferencesMock.mockResolvedValue({
      channel: "slack_webhook",
      slackWebhookUrl: VALID_WEBHOOK,
      enabledForIntents: ["interested"],
    });
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { notifyReply } = await import("./dispatch");
    await notifyReply(baseInput);

    for (const call of warnSpy.mock.calls) {
      for (const arg of call) {
        if (typeof arg === "string") {
          expect(arg).not.toContain("hooks.slack.com");
          expect(arg).not.toContain("abcdefghij1234567890");
        }
      }
    }
  });
});

// ---------- helpers ----------------------------------------------------

describe("composeEmailSubject / composeEmailBody / sanitizeFromAddress", () => {
  test("composeEmailSubject sanitizes CRLF in from address", async () => {
    const { composeEmailSubject } = await import("./dispatch");
    const subject = composeEmailSubject({
      intent: "interested",
      from: "evil@example.com\r\nBcc: attacker@bad.com",
    });
    // CRLF + control chars are the load-bearing defense — header
    // injection requires a real \r or \n. The "Bcc:" string surviving as
    // plain text inside the subject is harmless (the mail client renders
    // it as part of the Subject value, not as a new header).
    expect(subject).not.toContain("\r");
    expect(subject).not.toContain("\n");
  });

  test("composeEmailBody includes intent + confidence + replies link", async () => {
    const { composeEmailBody } = await import("./dispatch");
    const body = composeEmailBody({
      classification: baseClassification,
      from: "sarah@fintech.example",
      receivedAt: "2026-05-17T10:00:00.000Z",
    });
    expect(body).toContain("interested");
    expect(body).toContain("0.87");
    expect(body).toContain("https://tay.example.com/replies");
    // Reasons are present.
    expect(body).toContain("explicit 'yes'");
  });

  test("sanitizeFromAddress collapses whitespace and clamps length", async () => {
    const { sanitizeFromAddress } = await import("./dispatch");
    expect(sanitizeFromAddress("  foo \t bar  ")).toBe("foo bar");
    expect(sanitizeFromAddress("")).toBe("<unknown sender>");
    const long = "x".repeat(500);
    expect(sanitizeFromAddress(long).length).toBeLessThanOrEqual(200);
  });
});
