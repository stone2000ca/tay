// Tests for lib/oauth/google.ts.
//
// Mock global fetch — these are pure HTTP wrappers.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const originalFetch = globalThis.fetch;

function mockFetchOnce(response: {
  ok: boolean;
  status?: number;
  json?: unknown;
}) {
  const fn = vi.fn(async () =>
    ({
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.json ?? {},
    }) as Response,
  );
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

describe("buildAuthUrl", () => {
  test("includes required params and both gmail.send and gmail.readonly scopes (v0.9)", async () => {
    const { buildAuthUrl, GMAIL_SEND_SCOPE, GMAIL_READONLY_SCOPE } =
      await import("./google");
    const url = buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://example.com/cb",
      state: "csrf-token",
    });
    expect(url).toContain("client_id=cid");
    expect(url).toContain(encodeURIComponent(GMAIL_SEND_SCOPE));
    expect(url).toContain(encodeURIComponent(GMAIL_READONLY_SCOPE));
    expect(url).toContain(encodeURIComponent("https://example.com/cb"));
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("state=csrf-token");
    expect(url).toContain("response_type=code");
  });
});

describe("hasReadScope", () => {
  test("true when scope string includes gmail.readonly", async () => {
    const { hasReadScope, GMAIL_READONLY_SCOPE } = await import("./google");
    expect(
      hasReadScope(
        `https://www.googleapis.com/auth/gmail.send ${GMAIL_READONLY_SCOPE}`,
      ),
    ).toBe(true);
  });
  test("false when scope string only has gmail.send (pre-v0.9 connections)", async () => {
    const { hasReadScope } = await import("./google");
    expect(hasReadScope("https://www.googleapis.com/auth/gmail.send")).toBe(
      false,
    );
  });
  test("false on null/empty input", async () => {
    const { hasReadScope } = await import("./google");
    expect(hasReadScope(null)).toBe(false);
    expect(hasReadScope("")).toBe(false);
    expect(hasReadScope(undefined)).toBe(false);
  });
});

describe("exchangeCodeForTokens", () => {
  test("returns parsed tokens on 200", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        access_token: "at-1",
        refresh_token: "rt-1",
        expires_in: 3600,
        scope: "https://www.googleapis.com/auth/gmail.send",
      },
    });
    const { exchangeCodeForTokens } = await import("./google");
    const out = await exchangeCodeForTokens({
      clientId: "cid",
      clientSecret: "csec",
      code: "abc",
      redirectUri: "https://example.com/cb",
    });
    expect(out).toEqual({
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresIn: 3600,
      scope: "https://www.googleapis.com/auth/gmail.send",
    });
  });

  test("throws on non-200", async () => {
    mockFetchOnce({ ok: false, status: 400 });
    const { exchangeCodeForTokens } = await import("./google");
    await expect(
      exchangeCodeForTokens({
        clientId: "c",
        clientSecret: "s",
        code: "bad",
        redirectUri: "https://x/cb",
      }),
    ).rejects.toThrow(/HTTP 400/);
  });

  test("throws when refresh_token is missing", async () => {
    mockFetchOnce({
      ok: true,
      json: { access_token: "at", expires_in: 3600 },
    });
    const { exchangeCodeForTokens } = await import("./google");
    await expect(
      exchangeCodeForTokens({
        clientId: "c",
        clientSecret: "s",
        code: "abc",
        redirectUri: "https://x/cb",
      }),
    ).rejects.toThrow(/unexpected shape/);
  });

  test("does NOT log the code or response body on failure", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    mockFetchOnce({ ok: false, status: 401 });
    const { exchangeCodeForTokens } = await import("./google");
    await expect(
      exchangeCodeForTokens({
        clientId: "c",
        clientSecret: "s",
        code: "SECRET-CODE-123",
        redirectUri: "https://x/cb",
      }),
    ).rejects.toThrow();
    // None of the warn calls should contain the code.
    for (const call of warnSpy.mock.calls) {
      for (const arg of call) {
        expect(String(arg)).not.toContain("SECRET-CODE-123");
      }
    }
  });
});

describe("refreshAccessToken", () => {
  test("returns new access token on 200", async () => {
    mockFetchOnce({
      ok: true,
      json: { access_token: "at-2", expires_in: 1800 },
    });
    const { refreshAccessToken } = await import("./google");
    const out = await refreshAccessToken({
      clientId: "c",
      clientSecret: "s",
      refreshToken: "rt",
    });
    expect(out).toEqual({ accessToken: "at-2", expiresIn: 1800 });
  });

  test("throws on non-200", async () => {
    mockFetchOnce({ ok: false, status: 400 });
    const { refreshAccessToken } = await import("./google");
    await expect(
      refreshAccessToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "rt-bad",
      }),
    ).rejects.toThrow(/HTTP 400/);
  });

  test("throws when access_token is missing", async () => {
    mockFetchOnce({ ok: true, json: { expires_in: 3600 } });
    const { refreshAccessToken } = await import("./google");
    await expect(
      refreshAccessToken({
        clientId: "c",
        clientSecret: "s",
        refreshToken: "rt",
      }),
    ).rejects.toThrow(/unexpected shape/);
  });
});

describe("getProfile (v0.9)", () => {
  test("returns emailAddress + historyId on 200", async () => {
    mockFetchOnce({
      ok: true,
      json: { emailAddress: "jane@example.com", historyId: "12345" },
    });
    const { getProfile } = await import("./google");
    const out = await getProfile({ accessToken: "at" });
    expect(out).toEqual({ emailAddress: "jane@example.com", historyId: "12345" });
  });

  test("normalizes numeric historyId to string", async () => {
    mockFetchOnce({
      ok: true,
      json: { emailAddress: "jane@example.com", historyId: 999 },
    });
    const { getProfile } = await import("./google");
    const out = await getProfile({ accessToken: "at" });
    expect(out.historyId).toBe("999");
  });

  test("throws on non-200", async () => {
    mockFetchOnce({ ok: false, status: 403 });
    const { getProfile } = await import("./google");
    await expect(getProfile({ accessToken: "at" })).rejects.toThrow(
      /HTTP 403/,
    );
  });

  test("throws on missing fields", async () => {
    mockFetchOnce({ ok: true, json: { emailAddress: "jane@example.com" } });
    const { getProfile } = await import("./google");
    await expect(getProfile({ accessToken: "at" })).rejects.toThrow(
      /unexpected shape/,
    );
  });
});

describe("getRecentMessages (v0.9)", () => {
  test("no cursor → calls messages.list endpoint and returns refs", async () => {
    const fn = mockFetchOnce({
      ok: true,
      json: {
        messages: [
          { id: "m1", threadId: "t1" },
          { id: "m2", threadId: "t2" },
        ],
      },
    });
    const { getRecentMessages } = await import("./google");
    const out = await getRecentMessages({ accessToken: "at" });
    expect(out).toEqual([
      { id: "m1", threadId: "t1" },
      { id: "m2", threadId: "t2" },
    ]);
    // Hit the messages.list endpoint, not history.
    const callUrl = (fn.mock.calls as unknown as unknown[][])[0]?.[0];
    expect(String(callUrl)).toContain("/messages");
    expect(String(callUrl)).not.toContain("/history");
  });

  test("with cursor → uses history.list endpoint and unpacks messagesAdded", async () => {
    const fn = mockFetchOnce({
      ok: true,
      json: {
        history: [
          {
            messagesAdded: [
              { message: { id: "m3", threadId: "t3" } },
              { message: { id: "m4", threadId: "t4" } },
            ],
          },
          {
            messagesAdded: [{ message: { id: "m3", threadId: "t3" } }], // dupe
          },
        ],
      },
    });
    const { getRecentMessages } = await import("./google");
    const out = await getRecentMessages({
      accessToken: "at",
      after: "100",
    });
    expect(out).toEqual([
      { id: "m3", threadId: "t3" },
      { id: "m4", threadId: "t4" },
    ]);
    const callUrl = (fn.mock.calls as unknown as unknown[][])[0]?.[0];
    expect(String(callUrl)).toContain("/history");
    expect(String(callUrl)).toContain("startHistoryId=100");
    expect(String(callUrl)).toContain("messageAdded");
  });

  test("empty history result returns []", async () => {
    mockFetchOnce({ ok: true, json: {} });
    const { getRecentMessages } = await import("./google");
    const out = await getRecentMessages({ accessToken: "at", after: "1" });
    expect(out).toEqual([]);
  });

  test("throws on non-200", async () => {
    mockFetchOnce({ ok: false, status: 500 });
    const { getRecentMessages } = await import("./google");
    await expect(
      getRecentMessages({ accessToken: "at" }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("getMessage (v0.9)", () => {
  function encodeBody(s: string): string {
    return Buffer.from(s, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  }

  test("decodes a single text/plain part and pulls headers", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        id: "mid",
        threadId: "tid",
        internalDate: "1700000000000",
        payload: {
          mimeType: "text/plain",
          headers: [
            { name: "From", value: "alice@example.com" },
            { name: "Subject", value: "Re: hello" },
          ],
          body: { data: encodeBody("hi back\n") },
        },
      },
    });
    const { getMessage } = await import("./google");
    const out = await getMessage({ accessToken: "at", id: "mid" });
    expect(out.id).toBe("mid");
    expect(out.threadId).toBe("tid");
    expect(out.from).toBe("alice@example.com");
    expect(out.subject).toBe("Re: hello");
    expect(out.body).toBe("hi back\n");
    expect(out.internalDate).toBe(new Date(1700000000000).toISOString());
  });

  test("prefers text/plain over text/html when both present", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        id: "mid",
        threadId: "tid",
        internalDate: "1700000000000",
        payload: {
          mimeType: "multipart/alternative",
          headers: [
            { name: "From", value: "a@b.co" },
            { name: "Subject", value: "S" },
          ],
          parts: [
            {
              mimeType: "text/html",
              body: { data: encodeBody("<p>html</p>") },
            },
            {
              mimeType: "text/plain",
              body: { data: encodeBody("plain text") },
            },
          ],
        },
      },
    });
    const { getMessage } = await import("./google");
    const out = await getMessage({ accessToken: "at", id: "mid" });
    expect(out.body).toBe("plain text");
  });

  test("returns empty body when no text/plain part exists", async () => {
    mockFetchOnce({
      ok: true,
      json: {
        id: "mid",
        threadId: "tid",
        internalDate: "1700000000000",
        payload: {
          mimeType: "text/html",
          headers: [
            { name: "From", value: "a@b.co" },
            { name: "Subject", value: "S" },
          ],
          body: { data: encodeBody("<p>only html</p>") },
        },
      },
    });
    const { getMessage } = await import("./google");
    const out = await getMessage({ accessToken: "at", id: "mid" });
    expect(out.body).toBe("");
  });

  test("throws on non-200", async () => {
    mockFetchOnce({ ok: false, status: 404 });
    const { getMessage } = await import("./google");
    await expect(
      getMessage({ accessToken: "at", id: "missing" }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("getProfileEmail", () => {
  test("returns email on 200", async () => {
    mockFetchOnce({ ok: true, json: { email: "jane@example.com" } });
    const { getProfileEmail } = await import("./google");
    const out = await getProfileEmail({ accessToken: "at" });
    expect(out).toBe("jane@example.com");
  });

  test("throws on non-200", async () => {
    mockFetchOnce({ ok: false, status: 401 });
    const { getProfileEmail } = await import("./google");
    await expect(getProfileEmail({ accessToken: "at" })).rejects.toThrow(
      /HTTP 401/,
    );
  });

  test("throws when email is missing", async () => {
    mockFetchOnce({ ok: true, json: {} });
    const { getProfileEmail } = await import("./google");
    await expect(getProfileEmail({ accessToken: "at" })).rejects.toThrow(
      /no email field/,
    );
  });
});
