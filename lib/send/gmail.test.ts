// Tests for lib/send/gmail.ts. Mock global fetch.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const originalFetch = globalThis.fetch;

function mockFetchOnce(response: {
  ok: boolean;
  status?: number;
  json?: unknown;
  throwsNetwork?: boolean;
}) {
  const fn = vi.fn(async () => {
    if (response.throwsNetwork) {
      throw new Error("ECONNRESET");
    }
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.json ?? {},
    } as Response;
  });
  globalThis.fetch = fn as typeof fetch;
  return fn;
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("encodeRfc5322Message", () => {
  test("produces base64url with no padding", async () => {
    const { encodeRfc5322Message } = await import("./gmail");
    const raw = encodeRfc5322Message({
      to: "a@b.co",
      subject: "Hi",
      body: "Hello",
    });
    expect(raw).not.toMatch(/[+/=]/);
    const decoded = Buffer.from(
      raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    expect(decoded).toContain("To: a@b.co");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Hello");
  });

  test("encodes non-ASCII subject as RFC 2047", async () => {
    const { encodeRfc5322Message } = await import("./gmail");
    const raw = encodeRfc5322Message({
      to: "a@b.co",
      subject: "Hé!",
      body: "x",
    });
    const decoded = Buffer.from(
      raw.replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString("utf8");
    expect(decoded).toContain("=?UTF-8?B?");
  });
});

describe("sendEmail", () => {
  const args = {
    accessToken: "at",
    to: "a@b.co",
    subject: "Hi",
    body: "Hello",
  };

  test("returns ok with ids on 200", async () => {
    mockFetchOnce({
      ok: true,
      json: { id: "msg-1", threadId: "th-1" },
    });
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail(args);
    expect(out).toEqual({
      ok: true,
      gmailMessageId: "msg-1",
      gmailThreadId: "th-1",
    });
  });

  test("401 → reconnect error", async () => {
    mockFetchOnce({ ok: false, status: 401 });
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail(args);
    expect(out).toEqual({
      ok: false,
      error: "Gmail authentication failed; reconnect under Settings.",
    });
  });

  test("403 → scope error", async () => {
    mockFetchOnce({ ok: false, status: 403 });
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail(args);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/forbidden/);
  });

  test("429 → rate-limit error", async () => {
    mockFetchOnce({ ok: false, status: 429 });
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail(args);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/rate-limited/);
  });

  test("500 → generic with status", async () => {
    mockFetchOnce({ ok: false, status: 500 });
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail(args);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/HTTP 500/);
  });

  test("network error", async () => {
    mockFetchOnce({ ok: false, throwsNetwork: true });
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail(args);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/network error/);
  });

  test("missing access token", async () => {
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail({ ...args, accessToken: "" });
    expect(out.ok).toBe(false);
  });

  test("missing recipient", async () => {
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail({ ...args, to: "" });
    expect(out.ok).toBe(false);
  });

  test("error logs do NOT contain recipient, subject, or body", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mockFetchOnce({ ok: false, status: 500 });
    const { sendEmail } = await import("./gmail");
    await sendEmail({
      accessToken: "secret-token",
      to: "victim@example.com",
      subject: "SUBJECT-LEAK",
      body: "BODY-LEAK",
    });
    for (const call of warnSpy.mock.calls) {
      for (const arg of call) {
        const s = String(arg);
        expect(s).not.toContain("victim@example.com");
        expect(s).not.toContain("SUBJECT-LEAK");
        expect(s).not.toContain("BODY-LEAK");
        expect(s).not.toContain("secret-token");
      }
    }
  });

  test("response missing id is treated as failure", async () => {
    mockFetchOnce({ ok: true, json: { threadId: "x" } });
    const { sendEmail } = await import("./gmail");
    const out = await sendEmail(args);
    expect(out.ok).toBe(false);
  });
});
