// Tests for lib/oauth/crypto.ts.
//
// Use a deterministic test secret. Encryption uses a random IV, so we
// can't pin the ciphertext byte-for-byte — we test the round-trip
// invariant + tampering detection.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

const TEST_SECRET = "a".repeat(64); // 64 hex chars; valid by regex
const BAD_SECRET_SHORT = "abcd";
const BAD_SECRET_NONHEX = "z".repeat(64);

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.TAY_OAUTH_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.TAY_OAUTH_SECRET;
  } else {
    process.env.TAY_OAUTH_SECRET = originalSecret;
  }
});

describe("hasOAuthSecret", () => {
  test("true for 64-char hex", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { hasOAuthSecret } = await import("./crypto");
    expect(hasOAuthSecret()).toBe(true);
  });

  test("false when missing", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    const { hasOAuthSecret } = await import("./crypto");
    expect(hasOAuthSecret()).toBe(false);
  });

  test("false when too short", async () => {
    process.env.TAY_OAUTH_SECRET = BAD_SECRET_SHORT;
    const { hasOAuthSecret } = await import("./crypto");
    expect(hasOAuthSecret()).toBe(false);
  });

  test("false when contains non-hex characters", async () => {
    process.env.TAY_OAUTH_SECRET = BAD_SECRET_NONHEX;
    const { hasOAuthSecret } = await import("./crypto");
    expect(hasOAuthSecret()).toBe(false);
  });
});

describe("encryptToken / decryptToken round-trip", () => {
  test("round-trips a short token", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken, decryptToken } = await import("./crypto");
    const plaintext = "1//abc-refresh-token";
    const ct = encryptToken(plaintext);
    expect(ct).not.toContain(plaintext);
    expect(decryptToken(ct)).toBe(plaintext);
  });

  test("round-trips a long token (>200 chars)", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken, decryptToken } = await import("./crypto");
    const plaintext = "x".repeat(2048);
    const ct = encryptToken(plaintext);
    expect(decryptToken(ct)).toBe(plaintext);
  });

  test("two encryptions of the same plaintext produce different ciphertexts (fresh IV)", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken } = await import("./crypto");
    const a = encryptToken("identical");
    const b = encryptToken("identical");
    expect(a).not.toBe(b);
  });
});

describe("encryptToken — error paths", () => {
  test("throws when TAY_OAUTH_SECRET is missing", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    const { encryptToken } = await import("./crypto");
    expect(() => encryptToken("x")).toThrow(/TAY_OAUTH_SECRET missing/);
  });

  test("throws when TAY_OAUTH_SECRET is malformed", async () => {
    process.env.TAY_OAUTH_SECRET = BAD_SECRET_SHORT;
    const { encryptToken } = await import("./crypto");
    expect(() => encryptToken("x")).toThrow(/malformed/);
  });

  test("throws when plaintext is empty", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken } = await import("./crypto");
    expect(() => encryptToken("")).toThrow(/non-empty/);
  });
});

describe("decryptToken — error paths", () => {
  test("throws when TAY_OAUTH_SECRET is missing", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken } = await import("./crypto");
    const ct = encryptToken("hi");
    delete process.env.TAY_OAUTH_SECRET;
    const { decryptToken } = await import("./crypto");
    expect(() => decryptToken(ct)).toThrow(/TAY_OAUTH_SECRET missing/);
  });

  test("throws on tampered ciphertext (auth tag mismatch)", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken, decryptToken } = await import("./crypto");
    const ct = encryptToken("hello");
    // Flip the last byte (in the auth tag) — base64 last char tweak.
    const tampered = ct.slice(0, -2) + (ct.endsWith("A==") ? "B==" : "A==");
    expect(() => decryptToken(tampered)).toThrow();
  });

  test("throws on ciphertext that is too short", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { decryptToken } = await import("./crypto");
    expect(() => decryptToken("YWFh")).toThrow(/too short/);
  });

  test("throws on empty ciphertext", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { decryptToken } = await import("./crypto");
    expect(() => decryptToken("")).toThrow(/non-empty/);
  });

  test("throws when decrypted with a different key", async () => {
    process.env.TAY_OAUTH_SECRET = TEST_SECRET;
    const { encryptToken } = await import("./crypto");
    const ct = encryptToken("secret-data");
    process.env.TAY_OAUTH_SECRET = "b".repeat(64);
    const { decryptToken } = await import("./crypto");
    expect(() => decryptToken(ct)).toThrow();
  });
});
