// Tests for the cron poll-gmail route — Tay v1.1.1.
//
// Lock the call ordering: ensureSchema MUST run BEFORE getInstanceSecret
// (which derives the cron bearer token), and BOTH MUST run BEFORE the
// Authorization header check. Failing this ordering would let a stale
// cold-start serve a 401 to a legitimate Vercel-Cron call (because the
// derived secret would be unreachable).

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ensureSchemaMock = vi.fn();
const getInstanceSecretMock = vi.fn();
const pollGmailMock = vi.fn();
const callOrder: string[] = [];

vi.mock("@/lib/supabase/migrate", () => ({
  ensureSchema: async () => {
    callOrder.push("ensureSchema");
    return ensureSchemaMock();
  },
}));

vi.mock("@/lib/secrets/derive", () => ({
  getInstanceSecret: async (purpose: string) => {
    callOrder.push(`getInstanceSecret:${purpose}`);
    return getInstanceSecretMock(purpose);
  },
}));

vi.mock("@/lib/reply/poll", () => ({
  pollGmail: async () => {
    callOrder.push("pollGmail");
    return pollGmailMock();
  },
}));

beforeEach(() => {
  callOrder.length = 0;
  ensureSchemaMock.mockReset();
  getInstanceSecretMock.mockReset();
  pollGmailMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/cron/poll-gmail", () => {
  test("ensureSchema is called BEFORE getInstanceSecret, which is BEFORE auth check", async () => {
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    getInstanceSecretMock.mockReturnValue("derived-bearer");
    pollGmailMock.mockReturnValue({ inserted: 0, skipped: 0, errors: 0 });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail", {
      headers: { authorization: "Bearer derived-bearer" },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    // Strict ordering invariant.
    expect(callOrder).toEqual([
      "ensureSchema",
      "getInstanceSecret:cron",
      "pollGmail",
    ]);
  });

  test("returns 503 when ensureSchema reports an error", async () => {
    ensureSchemaMock.mockReturnValue({
      ran: false,
      skipped: false,
      error: "boom",
    });
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail", {
      headers: { authorization: "Bearer anything" },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error).toBe("schema_unavailable");
    // pollGmail must NOT have been called.
    expect(callOrder).not.toContain("pollGmail");
  });

  test("returns 503 when getInstanceSecret throws", async () => {
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    getInstanceSecretMock.mockImplementation(() => {
      throw new Error("no service role");
    });
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail", {
      headers: { authorization: "Bearer anything" },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error).toBe("secret_unavailable");
  });

  test("returns 401 when Authorization mismatches", async () => {
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    getInstanceSecretMock.mockReturnValue("derived-bearer");
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail", {
      headers: { authorization: "Bearer wrong-bearer" },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe("unauthorized");
    expect(callOrder).not.toContain("pollGmail");
  });

  test("returns 401 when Authorization header missing entirely", async () => {
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    getInstanceSecretMock.mockReturnValue("derived-bearer");
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail");
    const resp = await GET(req);
    expect(resp.status).toBe(401);
  });
});
