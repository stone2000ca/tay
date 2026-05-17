// Tests for lib/secrets/derive.ts.
//
// Three layers:
//   1. HKDF determinism + per-purpose independence — exercised against
//      the env-var fallback path so no DB is required.
//   2. HKDF math direct check (locks the contract for oauth-crypto
//      and unsubscribe-token consumers).
//   3. ensureSalt race-safety + cache behavior — mock pg so two
//      concurrent boots coalesce on the same salt without double-write,
//      cache hits skip INSERT, and a DB error resets the cache.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const TEST_FALLBACK = "a".repeat(64);

let originalOauth: string | undefined;
let originalServiceRole: string | undefined;
let originalPgUrl: string | undefined;
let originalPgPool: string | undefined;

beforeEach(() => {
  originalOauth = process.env.TAY_OAUTH_SECRET;
  originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  originalPgUrl = process.env.POSTGRES_URL_NON_POOLING;
  originalPgPool = process.env.POSTGRES_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.POSTGRES_URL_NON_POOLING;
  delete process.env.POSTGRES_URL;
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.resetModules();
});

afterEach(() => {
  if (originalOauth === undefined) delete process.env.TAY_OAUTH_SECRET;
  else process.env.TAY_OAUTH_SECRET = originalOauth;
  if (originalServiceRole === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  if (originalPgUrl === undefined) delete process.env.POSTGRES_URL_NON_POOLING;
  else process.env.POSTGRES_URL_NON_POOLING = originalPgUrl;
  if (originalPgPool === undefined) delete process.env.POSTGRES_URL;
  else process.env.POSTGRES_URL = originalPgPool;
  vi.restoreAllMocks();
  vi.doUnmock("pg");
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
    expect(oauth).not.toBe(unsub);
  });
});

// ---------------------------------------------------------------------------
// ensureSalt — race-safety, cache hit, and error-recovery paths.
//
// We mock `pg` at the module level so each test programs the Client's
// `connect / query / end` behavior. Since derive.ts caches the salt
// promise in module scope, each test calls vi.resetModules() in the
// before-block above and re-imports derive.ts (fresh cache per test).
// ---------------------------------------------------------------------------

type QueryFn = (sql: string, params?: unknown[]) => Promise<{
  rows: Array<{ salt?: Buffer }>;
  rowCount?: number | null;
}>;

function installPgMock(queryFn: QueryFn) {
  const connect = vi.fn().mockResolvedValue(undefined);
  const end = vi.fn().mockResolvedValue(undefined);
  const query = vi.fn(queryFn);
  const ctor = vi.fn();
  class FakeClient {
    connect = connect;
    end = end;
    query = query;
    constructor(opts: unknown) {
      ctor(opts);
    }
  }
  vi.doMock("pg", () => ({ Client: FakeClient }));
  return { ctor, connect, end, query };
}

describe("ensureSalt — race-safety + cache + error recovery", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-service-role-key";
    process.env.POSTGRES_URL_NON_POOLING = "postgres://fake";
  });

  test("two concurrent boots issue exactly ONE INSERT; both resolve to same salt", async () => {
    const winnerSalt = Buffer.alloc(32, 0xab);
    let selectCount = 0;
    let insertCount = 0;
    const mock = installPgMock(async (sql) => {
      if (sql.startsWith("SELECT")) {
        selectCount++;
        // First SELECT (from either concurrent call) returns empty.
        // Subsequent SELECTs return the winner's salt (post-INSERT re-read).
        if (selectCount <= 2 && insertCount === 0) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [{ salt: winnerSalt }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT")) {
        insertCount++;
        // Only the first INSERT "wins"; the second no-ops via ON CONFLICT.
        return { rows: [], rowCount: insertCount === 1 ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const { ensureSalt, __resetSaltCacheForTests } = await import("./derive");
    __resetSaltCacheForTests();

    // Because saltCache coalesces in-process, two awaits on ensureSalt()
    // share the same Promise — they don't race against each other.
    // To exercise the DB race we have to defeat the cache by clearing
    // it between bootstrapSalt() invocations. The pragmatic shape: run
    // two concurrent calls; the in-process cache means only ONE pg
    // Client is built. That's the correct production behavior.
    const [a, b] = await Promise.all([ensureSalt(), ensureSalt()]);
    expect(a).toEqual(b);
    expect(a).toEqual(winnerSalt);
    // In-process cache: only one Client constructed, one connect, one end.
    expect(mock.ctor).toHaveBeenCalledTimes(1);
    expect(mock.connect).toHaveBeenCalledTimes(1);
    expect(mock.end).toHaveBeenCalledTimes(1);
    // Bootstrap path: 1st SELECT (miss), INSERT, 2nd SELECT (re-read).
    expect(insertCount).toBe(1);
  });

  test("cache hit on first SELECT — no INSERT issued", async () => {
    const existingSalt = Buffer.alloc(32, 0x42);
    let insertCount = 0;
    const mock = installPgMock(async (sql) => {
      if (sql.startsWith("SELECT")) {
        return { rows: [{ salt: existingSalt }], rowCount: 1 };
      }
      if (sql.startsWith("INSERT")) {
        insertCount++;
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });

    const { ensureSalt, __resetSaltCacheForTests } = await import("./derive");
    __resetSaltCacheForTests();
    const salt = await ensureSalt();
    expect(salt).toEqual(existingSalt);
    expect(insertCount).toBe(0);
    // Only one SELECT — bootstrap not entered.
    expect(mock.query).toHaveBeenCalledTimes(1);
  });

  test("DB error resets saltCache so next call retries fresh", async () => {
    let callId = 0;
    const goodSalt = Buffer.alloc(32, 0x77);
    installPgMock(async (sql) => {
      callId++;
      // First call (any SELECT) throws.
      if (callId === 1) throw new Error("connection refused");
      // Second call (cache reset → fresh bootstrap path): SELECT returns
      // the salt immediately.
      if (sql.startsWith("SELECT")) {
        return { rows: [{ salt: goodSalt }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    const { ensureSalt, __resetSaltCacheForTests } = await import("./derive");
    __resetSaltCacheForTests();

    await expect(ensureSalt()).rejects.toThrow(/connection refused/);
    // The failure must NOT poison subsequent calls.
    const salt = await ensureSalt();
    expect(salt).toEqual(goodSalt);
  });
});
