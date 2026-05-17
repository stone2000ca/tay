// Tests for the cron poll-gmail route — Tay v1.1.2.5.
//
// v1.1.2.5: route delegates to pollReplies() (channel-aware) instead of
// pollGmail() directly. The route name "poll-gmail" is preserved so the
// vercel.json cron config doesn't have to change.
//
// Lock the call ordering: ensureSchema MUST run BEFORE the
// Authorization header check. The cron bearer is read directly from
// process.env.CRON_SECRET (Vercel auto-sets this for cron-enabled
// projects) — it is NOT derived via HKDF. A derived value would never
// match what Vercel Cron sends.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const ensureSchemaMock = vi.fn();
const pollRepliesMock = vi.fn();
const callOrder: string[] = [];

vi.mock("@/lib/supabase/migrate", () => ({
  ensureSchema: async () => {
    callOrder.push("ensureSchema");
    return ensureSchemaMock();
  },
}));

vi.mock("@/lib/reply/poll", () => ({
  pollReplies: async () => {
    callOrder.push("pollReplies");
    return pollRepliesMock();
  },
}));

const TEST_SECRET = "test-cron-bearer";

let originalCronSecret: string | undefined;

beforeEach(() => {
  callOrder.length = 0;
  ensureSchemaMock.mockReset();
  pollRepliesMock.mockReset();
  originalCronSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
  vi.restoreAllMocks();
});

describe("GET /api/cron/poll-gmail", () => {
  test("ensureSchema runs BEFORE auth check; pollGmail runs after success", async () => {
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    pollRepliesMock.mockReturnValue({ inserted: 0, skipped: 0, errors: 0 });

    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail", {
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(200);

    // Strict ordering invariant — schema bootstrap precedes the poller.
    expect(callOrder).toEqual(["ensureSchema", "pollReplies"]);
  });

  test("returns 503 when ensureSchema reports an error", async () => {
    ensureSchemaMock.mockReturnValue({
      ran: false,
      skipped: false,
      error: "boom",
    });
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail", {
      headers: { authorization: `Bearer ${TEST_SECRET}` },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error).toBe("schema_unavailable");
    // pollGmail must NOT have been called.
    expect(callOrder).not.toContain("pollReplies");
  });

  test("returns 503 cron_secret_not_configured when env var missing AND no auth header", async () => {
    delete process.env.CRON_SECRET;
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail");
    const resp = await GET(req);
    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.error).toBe("cron_secret_not_configured");
    expect(body.hint).toMatch(/Vercel/i);
    expect(callOrder).not.toContain("pollReplies");
  });

  test("returns 401 when env var missing but caller sent an Authorization header", async () => {
    // Env unset, but caller did send something — treat as bad auth,
    // not as our-side misconfig. Otherwise we'd 503 on rogue requests.
    delete process.env.CRON_SECRET;
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail", {
      headers: { authorization: "Bearer something" },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(401);
    expect(callOrder).not.toContain("pollReplies");
  });

  test("returns 401 when Authorization mismatches", async () => {
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail", {
      headers: { authorization: "Bearer wrong-bearer" },
    });
    const resp = await GET(req);
    expect(resp.status).toBe(401);
    const body = await resp.json();
    expect(body.error).toBe("unauthorized");
    expect(callOrder).not.toContain("pollReplies");
  });

  test("returns 401 when Authorization header missing entirely (env IS set)", async () => {
    ensureSchemaMock.mockReturnValue({ ran: false, skipped: true });
    const { GET } = await import("./route");
    const req = new Request("http://localhost/api/cron/poll-gmail");
    const resp = await GET(req);
    expect(resp.status).toBe(401);
  });
});
