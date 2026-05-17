// Tests for lib/unsubscribe/token.ts (v1.1.1 async).
//
// The unsubscribe HMAC secret is now derived from `getInstanceSecret(
// "unsubscribe")`. For these tests we force the env-var fallback path
// (set TAY_OAUTH_SECRET, clear SUPABASE_SERVICE_ROLE_KEY) so no DB hit
// is required. The HKDF derive path against a real DB is covered by
// lib/secrets/derive.test.ts integration-style.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

const TEST_SECRET = "a".repeat(64);

let originalSecret: string | undefined;
let originalServiceRole: string | undefined;

beforeEach(() => {
  originalSecret = process.env.TAY_OAUTH_SECRET;
  originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.TAY_OAUTH_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TAY_OAUTH_SECRET;
  else process.env.TAY_OAUTH_SECRET = originalSecret;
  if (originalServiceRole === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
});

describe("generateUnsubscribeToken + verifyUnsubscribeToken", () => {
  test("round-trip: a freshly generated token verifies and returns the email", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = await generateUnsubscribeToken("alice@example.com");
    const out = await verifyUnsubscribeToken(token);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.email).toBe("alice@example.com");
  });

  test("token has two base64url segments separated by '.'", async () => {
    const { generateUnsubscribeToken } = await import("./token");
    const token = await generateUnsubscribeToken("alice@example.com");
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    // base64url alphabet: A-Z a-z 0-9 - _
    expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(parts[1]).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("expired token is rejected with reason 'expired'", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    // TTL of -1 days = already expired
    const token = await generateUnsubscribeToken("alice@example.com", -1);
    const out = await verifyUnsubscribeToken(token);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("expired");
  });

  test("tampered signature is rejected with reason 'bad_signature'", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = await generateUnsubscribeToken("alice@example.com");
    const [payload, sig] = token.split(".");
    const midIdx = Math.floor(sig.length / 2);
    const orig = sig[midIdx];
    const swap = orig === "A" ? "B" : "A";
    const flipped = sig.slice(0, midIdx) + swap + sig.slice(midIdx + 1);
    const tampered = `${payload}.${flipped}`;
    const out = await verifyUnsubscribeToken(tampered);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("bad_signature");
  });

  test("tampered payload (different email) is rejected (signature won't match)", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = await generateUnsubscribeToken("alice@example.com");
    const [, sig] = token.split(".");
    const fakePayload = Buffer.from(
      JSON.stringify({ email: "victim@example.com", exp: 9999999999, kind: "unsubscribe" }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const out = await verifyUnsubscribeToken(`${fakePayload}.${sig}`);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("bad_signature");
  });

  test("malformed token (no dot) is rejected with 'malformed'", async () => {
    const { verifyUnsubscribeToken } = await import("./token");
    expect(await verifyUnsubscribeToken("not-a-token")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  test("empty token is rejected with 'malformed'", async () => {
    const { verifyUnsubscribeToken } = await import("./token");
    expect(await verifyUnsubscribeToken("")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  test("token signed with different secret is rejected", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = await generateUnsubscribeToken("alice@example.com");
    process.env.TAY_OAUTH_SECRET = "b".repeat(64);
    const out = await verifyUnsubscribeToken(token);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("bad_signature");
  });

  test("generateUnsubscribeToken throws on empty email", async () => {
    const { generateUnsubscribeToken } = await import("./token");
    await expect(generateUnsubscribeToken("")).rejects.toThrow(/email/);
  });

  test("generateUnsubscribeToken throws when secret missing", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    const { generateUnsubscribeToken } = await import("./token");
    await expect(generateUnsubscribeToken("a@b.co")).rejects.toThrow();
  });

  test("token with a non-unsubscribe kind is rejected with 'bad_kind'", async () => {
    const { createHmac } = await import("node:crypto");
    const { verifyUnsubscribeToken } = await import("./token");
    const payload = {
      email: "alice@example.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      kind: "password_reset",
    };
    const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const key = Buffer.from(TEST_SECRET, "hex");
    const sig = createHmac("sha256", key)
      .update(payloadB64)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const token = `${payloadB64}.${sig}`;
    const out = await verifyUnsubscribeToken(token);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("bad_kind");
  });

  test("verifyUnsubscribeToken throws when secret missing (route catches it)", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = await generateUnsubscribeToken("a@b.co");
    delete process.env.TAY_OAUTH_SECRET;
    await expect(verifyUnsubscribeToken(token)).rejects.toThrow();
  });
});
