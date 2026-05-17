// Tests for lib/oauth/crypto.ts (v1.1.1 async).
//
// Crypto secret now goes through getInstanceSecret("oauth"); we use the
// env-var fallback (TAY_OAUTH_SECRET set, SUPABASE_SERVICE_ROLE_KEY
// cleared) so these tests run without touching the DB. The HKDF derive
// path is exercised in lib/secrets/derive.test.ts.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

const TEST_SECRET = "a".repeat(64);
const BAD_SECRET_SHORT = "abcd";
const BAD_SECRET_NONHEX = "z".repeat(64);

let originalSecret: string | undefined;
let originalServiceRole: string | undefined;

beforeEach(() => {
  originalSecret = process.env.TAY_OAUTH_SECRET;
  originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.TAY_OAUTH_SECRET;
  } else {
    process.env.TAY_OAUTH_SECRET = originalSecret;
  }
  if (originalServiceRole === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  }
});

describe("hasOAuthSecret", () => {
  test("true for 64-char hex via env-var fallback", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { hasOAuthSecret } = await import("./crypto");
    expect(await hasOAuthSecret()).toBe(true);
  });

  test("false when missing", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    const { hasOAuthSecret } = await import("./crypto");
    expect(await hasOAuthSecret()).toBe(false);
  });

  test("false when too short", async () => {
    process.env.TAY_OAUTH_SECRET = BAD_SECRET_SHORT;
    const { hasOAuthSecret } = await import("./crypto");
    expect(await hasOAuthSecret()).toBe(false);
  });

  test("false when contains non-hex characters", async () => {
    process.env.TAY_OAUTH_SECRET = BAD_SECRET_NONHEX;
    const { hasOAuthSecret } = await import("./crypto");
    expect(await hasOAuthSecret()).toBe(false);
  });
});

describe("encryptToken / decryptToken round-trip", () => {
  test("round-trips a short token", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken, decryptToken } = await import("./crypto");
    const plaintext = "1//abc-refresh-token";
    const ct = await encryptToken(plaintext);
    expect(ct).not.toContain(plaintext);
    expect(await decryptToken(ct)).toBe(plaintext);
  });

  test("round-trips a long token (>200 chars)", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken, decryptToken } = await import("./crypto");
    const plaintext = "x".repeat(2048);
    const ct = await encryptToken(plaintext);
    expect(await decryptToken(ct)).toBe(plaintext);
  });

  test("two encryptions of the same plaintext produce different ciphertexts (fresh IV)", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken } = await import("./crypto");
    const a = await encryptToken("identical");
    const b = await encryptToken("identical");
    expect(a).not.toBe(b);
  });
});

describe("encryptToken — error paths", () => {
  test("throws when the secret is unreachable", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    const { encryptToken } = await import("./crypto");
    await expect(encryptToken("x")).rejects.toThrow();
  });

  test("throws when fallback secret is malformed", async () => {
    process.env.TAY_OAUTH_SECRET = BAD_SECRET_SHORT;
    const { encryptToken } = await import("./crypto");
    await expect(encryptToken("x")).rejects.toThrow();
  });

  test("throws when plaintext is empty", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken } = await import("./crypto");
    await expect(encryptToken("")).rejects.toThrow(/non-empty/);
  });
});

describe("decryptToken — error paths", () => {
  test("throws when the secret becomes unreachable after encrypt", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken } = await import("./crypto");
    const ct = await encryptToken("hi");
    delete process.env.TAY_OAUTH_SECRET;
    const { decryptToken } = await import("./crypto");
    await expect(decryptToken(ct)).rejects.toThrow();
  });

  test("throws on tampered ciphertext (auth tag mismatch)", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken, decryptToken } = await import("./crypto");
    const ct = await encryptToken("hello");
    const tampered = ct.slice(0, -2) + (ct.endsWith("A==") ? "B==" : "A==");
    await expect(decryptToken(tampered)).rejects.toThrow();
  });

  test("throws on ciphertext that is too short", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { decryptToken } = await import("./crypto");
    await expect(decryptToken("YWFh")).rejects.toThrow(/too short/);
  });

  test("throws on empty ciphertext", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { decryptToken } = await import("./crypto");
    await expect(decryptToken("")).rejects.toThrow(/non-empty/);
  });

  test("throws when decrypted with a different key", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken } = await import("./crypto");
    const ct = await encryptToken("secret-data");
    process.env.TAY_OAUTH_SECRET = "b".repeat(64);
    const { decryptToken } = await import("./crypto");
    await expect(decryptToken(ct)).rejects.toThrow();
  });
});
