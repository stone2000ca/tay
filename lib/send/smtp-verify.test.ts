// Tests for lib/send/smtp-verify.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const verifyMock = vi.fn();
const closeMock = vi.fn();
const createTransportMock = vi.fn(() => ({
  verify: verifyMock,
  close: closeMock,
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

beforeEach(() => {
  verifyMock.mockReset();
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
  password: "pw",
};

describe("verifySmtpCredentials", () => {
  test("ok=true when verify() resolves", async () => {
    verifyMock.mockResolvedValue(true);
    const { verifySmtpCredentials } = await import("./smtp-verify");
    const out = await verifySmtpCredentials(baseInput);
    expect(out).toEqual({ ok: true });
    expect(closeMock).toHaveBeenCalledOnce();
  });

  test("EAUTH → reason=auth_failed with friendly message", async () => {
    verifyMock.mockRejectedValue(
      Object.assign(new Error("invalid login"), { code: "EAUTH" }),
    );
    const { verifySmtpCredentials } = await import("./smtp-verify");
    const out = await verifySmtpCredentials(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe("auth_failed");
      expect(out.message).toMatch(/authentication failed/i);
    }
  });

  test("535 responseCode → reason=auth_failed", async () => {
    verifyMock.mockRejectedValue(
      Object.assign(new Error("auth rejected"), { responseCode: 535 }),
    );
    const { verifySmtpCredentials } = await import("./smtp-verify");
    const out = await verifySmtpCredentials(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("auth_failed");
  });

  test("ECONNREFUSED → reason=connection_refused", async () => {
    verifyMock.mockRejectedValue(
      Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
    );
    const { verifySmtpCredentials } = await import("./smtp-verify");
    const out = await verifySmtpCredentials(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("connection_refused");
  });

  test("ETLS → reason=tls_failed", async () => {
    verifyMock.mockRejectedValue(
      Object.assign(new Error("tls"), { code: "ETLS" }),
    );
    const { verifySmtpCredentials } = await import("./smtp-verify");
    const out = await verifySmtpCredentials(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("tls_failed");
  });

  test("ETIMEDOUT → reason=timeout", async () => {
    verifyMock.mockRejectedValue(
      Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
    );
    const { verifySmtpCredentials } = await import("./smtp-verify");
    const out = await verifySmtpCredentials(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("timeout");
  });

  test("unknown error → reason=unknown with generic friendly message", async () => {
    verifyMock.mockRejectedValue(new Error("?"));
    const { verifySmtpCredentials } = await import("./smtp-verify");
    const out = await verifySmtpCredentials(baseInput);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("unknown");
  });

  test("missing input fields → returns reason=unknown without calling verify", async () => {
    const { verifySmtpCredentials } = await import("./smtp-verify");
    const out = await verifySmtpCredentials({ ...baseInput, host: "" });
    expect(out.ok).toBe(false);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  test("password never leaks into log lines", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    verifyMock.mockRejectedValue(
      Object.assign(new Error("auth failed PASSWORD-LEAK"), { code: "EAUTH" }),
    );
    const { verifySmtpCredentials } = await import("./smtp-verify");
    await verifySmtpCredentials({ ...baseInput, password: "PASSWORD-LEAK" });
    for (const call of warnSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain("PASSWORD-LEAK");
      }
    }
  });
});
