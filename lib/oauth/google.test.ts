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
  test("includes required params and gmail.send scope", async () => {
    const { buildAuthUrl, GMAIL_SEND_SCOPE } = await import("./google");
    const url = buildAuthUrl({
      clientId: "cid",
      redirectUri: "https://example.com/cb",
      state: "csrf-token",
    });
    expect(url).toContain("client_id=cid");
    expect(url).toContain(encodeURIComponent(GMAIL_SEND_SCOPE));
    expect(url).toContain(encodeURIComponent("https://example.com/cb"));
    expect(url).toContain("access_type=offline");
    expect(url).toContain("prompt=consent");
    expect(url).toContain("state=csrf-token");
    expect(url).toContain("response_type=code");
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
