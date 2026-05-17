// Tests for lib/send/smtp.ts. Mock nodemailer's createTransport.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const sendMailMock = vi.fn();
const closeMock = vi.fn();
const createTransportMock = vi.fn(() => ({
  sendMail: sendMailMock,
  close: closeMock,
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

beforeEach(() => {
  sendMailMock.mockReset();
  closeMock.mockReset();
  createTransportMock.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseInput = {
  host: "smtp.gmail.com",
  port: 587,
  username: "alice@example.com",
  password: "app-password-1234",
  fromAddress: "alice@example.com",
  to: "bob@example.com",
  subject: "Hi",
  body: "Hello there",
};

describe("generateMessageId", () => {
  test("returns angle-bracketed local@host with host from sender", async () => {
    const { generateMessageId } = await import("./smtp");
    const id = generateMessageId("alice@example.com");
    expect(id).toMatch(/^<[0-9a-f]{32}@example\.com>$/);
  });

  test("falls back to tay.local when address has no @", async () => {
    const { generateMessageId } = await import("./smtp");
    const id = generateMessageId("not-an-email");
    expect(id).toMatch(/^<[0-9a-f]{32}@tay\.local>$/);
  });

  test("each call returns a different id", async () => {
    const { generateMessageId } = await import("./smtp");
    const a = generateMessageId("alice@example.com");
    const b = generateMessageId("alice@example.com");
    expect(a).not.toEqual(b);
  });
});

describe("sendEmailViaSmtp — happy path", () => {
  test("returns ok with generated messageId, no threadId", async () => {
    sendMailMock.mockResolvedValue({ messageId: "ignored-from-server" });
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp(baseInput);
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.messageId).toMatch(/^<[0-9a-f]{32}@example\.com>$/);
      expect(out.threadId).toBeUndefined();
    }
    expect(createTransportMock).toHaveBeenCalledOnce();
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.gmail.com",
        port: 587,
        secure: false,
        auth: { user: "alice@example.com", pass: "app-password-1234" },
      }),
    );
  });

  test("port 465 uses implicit TLS (secure=true)", async () => {
    sendMailMock.mockResolvedValue({ messageId: "x" });
    const { sendEmailViaSmtp } = await import("./smtp");
    await sendEmailViaSmtp({ ...baseInput, port: 465 });
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({ port: 465, secure: true }),
    );
  });

  test("sets Message-ID header on the outgoing mail", async () => {
    sendMailMock.mockResolvedValue({ messageId: "x" });
    const { sendEmailViaSmtp } = await import("./smtp");
    await sendEmailViaSmtp(baseInput);
    const opts = sendMailMock.mock.calls[0]?.[0];
    expect(opts.messageId).toMatch(/^<[0-9a-f]{32}@example\.com>$/);
    expect(opts.from).toBe("alice@example.com");
    expect(opts.to).toBe("bob@example.com");
    expect(opts.subject).toBe("Hi");
    expect(opts.text).toBe("Hello there");
  });

  test("reply send sets In-Reply-To + References to the parent Message-ID", async () => {
    sendMailMock.mockResolvedValue({ messageId: "x" });
    const { sendEmailViaSmtp } = await import("./smtp");
    await sendEmailViaSmtp({
      ...baseInput,
      inReplyToMessageId: "<parent-abcdef@example.com>",
    });
    const opts = sendMailMock.mock.calls[0]?.[0];
    expect(opts.inReplyTo).toBe("<parent-abcdef@example.com>");
    expect(opts.references).toBe("<parent-abcdef@example.com>");
  });

  test("close() is called after send (idempotent)", async () => {
    sendMailMock.mockResolvedValue({ messageId: "x" });
    const { sendEmailViaSmtp } = await import("./smtp");
    await sendEmailViaSmtp(baseInput);
    expect(closeMock).toHaveBeenCalledOnce();
  });
});

describe("sendEmailViaSmtp — input validation", () => {
  test("missing host", async () => {
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp({ ...baseInput, host: "" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/host/);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  test("missing password", async () => {
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp({ ...baseInput, password: "" });
    expect(out.ok).toBe(false);
  });

  test("missing recipient", async () => {
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp({ ...baseInput, to: "" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/fromAddress|to|subject|body/);
  });
});

describe("sendEmailViaSmtp — error mapping", () => {
  test("EAUTH → friendly auth-failed message mentioning App Password + 2FA", async () => {
    sendMailMock.mockRejectedValue(
      Object.assign(new Error("Invalid login"), { code: "EAUTH" }),
    );
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/authentication failed/i);
      expect(out.error).toMatch(/App Password/i);
      expect(out.error).toMatch(/2-Step Verification/i);
    }
    expect(closeMock).toHaveBeenCalledOnce();
  });

  test("535 responseCode → auth-failed branch", async () => {
    sendMailMock.mockRejectedValue(
      Object.assign(new Error("auth rejected"), { responseCode: 535 }),
    );
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/authentication failed/i);
  });

  test("ECONNREFUSED → friendly connection error", async () => {
    sendMailMock.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), {
        code: "ECONNREFUSED",
      }),
    );
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/connect to your SMTP server/i);
  });

  test("ETLS → friendly TLS error", async () => {
    sendMailMock.mockRejectedValue(
      Object.assign(new Error("tls handshake"), { code: "ETLS" }),
    );
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/TLS handshake failed/i);
  });

  test("ETIMEDOUT → friendly timeout error", async () => {
    sendMailMock.mockRejectedValue(
      Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
    );
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/timed out/i);
  });

  test("unknown error → generic friendly message", async () => {
    sendMailMock.mockRejectedValue(new Error("ugh"));
    const { sendEmailViaSmtp } = await import("./smtp");
    const out = await sendEmailViaSmtp(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/SMTP send failed/i);
  });
});

describe("sendEmailViaSmtp — Tay rule: secrets never leak to logs", () => {
  test("error logs do NOT contain body, recipient, subject, or password", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    sendMailMock.mockRejectedValue(
      Object.assign(
        new Error(
          "SMTP server said: 550 No such user victim@example.com SUBJECT-LEAK BODY-LEAK PASSWORD-LEAK",
        ),
        { code: "ESOCKET" },
      ),
    );
    const { sendEmailViaSmtp } = await import("./smtp");
    await sendEmailViaSmtp({
      ...baseInput,
      to: "victim@example.com",
      subject: "SUBJECT-LEAK",
      body: "BODY-LEAK",
      password: "PASSWORD-LEAK",
    });
    for (const call of warnSpy.mock.calls) {
      for (const arg of call) {
        const s = String(arg);
        expect(s).not.toContain("victim@example.com");
        expect(s).not.toContain("SUBJECT-LEAK");
        expect(s).not.toContain("BODY-LEAK");
        expect(s).not.toContain("PASSWORD-LEAK");
      }
    }
  });
});
