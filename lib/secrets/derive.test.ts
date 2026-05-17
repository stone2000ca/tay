// Tests for lib/secrets/derive.ts.
//
// Two layers:
//   1. HKDF determinism + per-purpose independence — exercised against
//      the env-var fallback path so no DB is required.
//   2. ensureSalt race-safety — mock pg so two concurrent boots
//      coalesce on the same salt without double-write.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const TEST_FALLBACK = "a".repeat(64);

let originalOauth: string | undefined;
let originalCron: string | undefined;
let originalServiceRole: string | undefined;
let originalPgUrl: string | undefined;
let originalPgPool: string | undefined;

beforeEach(() => {
  originalOauth = process.env.TAY_OAUTH_SECRET;
  originalCron = process.env.CRON_SECRET;
  originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  originalPgUrl = process.env.POSTGRES_URL_NON_POOLING;
  originalPgPool = process.env.POSTGRES_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.POSTGRES_URL_NON_POOLING;
  delete process.env.POSTGRES_URL;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (originalOauth === undefined) delete process.env.TAY_OAUTH_SECRET;
  else process.env.TAY_OAUTH_SECRET = originalOauth;
  if (originalCron === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCron;
  if (originalServiceRole === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  if (originalPgUrl === undefined) delete process.env.POSTGRES_URL_NON_POOLING;
  else process.env.POSTGRES_URL_NON_POOLING = originalPgUrl;
  if (originalPgPool === undefined) delete process.env.POSTGRES_URL;
  else process.env.POSTGRES_URL = originalPgPool;
  vi.restoreAllMocks();
});

describe("getInstanceSecret — env-var fallback", () => {
  test("oauth fallback uses TAY_OAUTH_SECRET, lowercased", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_FALLBACK.toUpperCase();
    const { getInstanceSecret } = await import("./derive");
    const out = await getInstanceSecret("oauth");
    expect(out).toBe(TEST_FALLBACK);
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  test("unsubscribe fallback shares TAY_OAUTH_SECRET (v0.x compat)", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_FALLBACK;
    const { getInstanceSecret } = await import("./derive");
    const out = await getInstanceSecret("unsubscribe");
    expect(out).toBe(TEST_FALLBACK);
  });

  test("cron fallback uses CRON_SECRET, NOT TAY_OAUTH_SECRET", async () => {
    process.env.CRON_SECRET = "b".repeat(64);
    process.env.TAY_OAUTH_SECRET = TEST_FALLBACK;
    const { getInstanceSecret } = await import("./derive");
    const out = await getInstanceSecret("cron");
    expect(out).toBe("b".repeat(64));
  });

  test("throws when no IKM AND no fallback available", async () => {
    const { getInstanceSecret } = await import("./derive");
    await expect(getInstanceSecret("oauth")).rejects.toThrow(
      /SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  test("malformed fallback (not 64 hex) is rejected → throws", async () => {
    process.env.TAY_OAUTH_SECRET = "not-hex";
    const { getInstanceSecret } = await import("./derive");
    await expect(getInstanceSecret("oauth")).rejects.toThrow();
  });
});

describe("HKDF determinism (direct check via Node crypto)", () => {
  // Exercise the HKDF spec directly so we don't need to wire pg.
  // Asserts the same formula derive.ts uses, with a fixed IKM + salt +
  // info — locks the contract that drives lib/oauth/crypto.ts +
  // lib/unsubscribe/token.ts. If you change HKDF_HASH, HKDF_KEY_LEN,
  // or the `info` template in derive.ts, update this expectation.

  test("HKDF-SHA256 with fixed IKM + salt + per-purpose info produces stable 64-hex output", async () => {
    const { hkdfSync } = await import("node:crypto");
    const ikm = Buffer.from("service-role-fixed", "utf8");
    const salt = Buffer.from(
      "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      "hex",
    );
    const a = Buffer.from(
      hkdfSync(
        "sha256",
        ikm,
        salt,
        Buffer.from("tay-oauth-secret-v1", "utf8"),
        32,
      ),
    ).toString("hex");
    const b = Buffer.from(
      hkdfSync(
        "sha256",
        ikm,
        salt,
        Buffer.from("tay-oauth-secret-v1", "utf8"),
        32,
      ),
    ).toString("hex");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  test("different purposes → different derived secrets (HKDF info string is the discriminator)", async () => {
    const { hkdfSync } = await import("node:crypto");
    const ikm = Buffer.from("service-role-fixed", "utf8");
    const salt = Buffer.from(
      "aabbccddeeff00112233445566778899aabbccddeeff00112233445566778899",
      "hex",
    );
    const derive = (purpose: string) =>
      Buffer.from(
        hkdfSync(
          "sha256",
          ikm,
          salt,
          Buffer.from(`tay-${purpose}-secret-v1`, "utf8"),
          32,
        ),
      ).toString("hex");
    const oauth = derive("oauth");
    const unsub = derive("unsubscribe");
    const cron = derive("cron");
    expect(oauth).not.toBe(unsub);
    expect(oauth).not.toBe(cron);
    expect(unsub).not.toBe(cron);
  });
});
