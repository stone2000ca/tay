// Tests for lib/unsubscribe/token.ts.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

const TEST_SECRET = "a".repeat(64);

let originalSecret: string | undefined;

beforeEach(() => {
  originalSecret = process.env.TAY_OAUTH_SECRET;
  process.env.TAY_OAUTH_SECRET = TEST_SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TAY_OAUTH_SECRET;
  else process.env.TAY_OAUTH_SECRET = originalSecret;
});

describe("generateUnsubscribeToken + verifyUnsubscribeToken", () => {
  test("round-trip: a freshly generated token verifies and returns the email", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = generateUnsubscribeToken("alice@example.com");
    const out = verifyUnsubscribeToken(token);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.email).toBe("alice@example.com");
  });

  test("token has two base64url segments separated by '.'", async () => {
    const { generateUnsubscribeToken } = await import("./token");
    const token = generateUnsubscribeToken("alice@example.com");
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
    const token = generateUnsubscribeToken("alice@example.com", -1);
    const out = verifyUnsubscribeToken(token);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("expired");
  });

  test("tampered signature is rejected with reason 'bad_signature'", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = generateUnsubscribeToken("alice@example.com");
    const [payload, sig] = token.split(".");
    // Flip a char in the MIDDLE of the signature. (Flipping the last
    // char of an unpadded base64url string can be a no-op if the byte
    // only uses the high bits of that char position.)
    const midIdx = Math.floor(sig.length / 2);
    const orig = sig[midIdx];
    const swap = orig === "A" ? "B" : "A";
    const flipped = sig.slice(0, midIdx) + swap + sig.slice(midIdx + 1);
    const tampered = `${payload}.${flipped}`;
    const out = verifyUnsubscribeToken(tampered);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("bad_signature");
  });

  test("tampered payload (different email) is rejected (signature won't match)", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = generateUnsubscribeToken("alice@example.com");
    const [, sig] = token.split(".");
    // Craft a payload-replacement using attacker-chosen email but the
    // original signature.
    const fakePayload = Buffer.from(
      JSON.stringify({ email: "victim@example.com", exp: 9999999999, kind: "unsubscribe" }),
      "utf8",
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const out = verifyUnsubscribeToken(`${fakePayload}.${sig}`);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("bad_signature");
  });

  test("malformed token (no dot) is rejected with 'malformed'", async () => {
    const { verifyUnsubscribeToken } = await import("./token");
    expect(verifyUnsubscribeToken("not-a-token")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  test("empty token is rejected with 'malformed'", async () => {
    const { verifyUnsubscribeToken } = await import("./token");
    expect(verifyUnsubscribeToken("")).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  test("token signed with different secret is rejected", async () => {
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = generateUnsubscribeToken("alice@example.com");
    process.env.TAY_OAUTH_SECRET = "b".repeat(64);
    const out = verifyUnsubscribeToken(token);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe("bad_signature");
  });

  test("generateUnsubscribeToken throws on empty email", async () => {
    const { generateUnsubscribeToken } = await import("./token");
    expect(() => generateUnsubscribeToken("")).toThrow(/email/);
  });

  test("generateUnsubscribeToken throws when secret missing", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    const { generateUnsubscribeToken } = await import("./token");
    expect(() => generateUnsubscribeToken("a@b.co")).toThrow(/TAY_OAUTH_SECRET/);
  });

  test("generateUnsubscribeToken throws on malformed secret", async () => {
    process.env.TAY_OAUTH_SECRET = "not-hex";
    const { generateUnsubscribeToken } = await import("./token");
    expect(() => generateUnsubscribeToken("a@b.co")).toThrow(/malformed/);
  });

  test("verifyUnsubscribeToken throws when secret missing (route catches it)", async () => {
    // generate first (with secret set), then drop the secret to simulate
    // deploy-time misconfig at verify time.
    const { generateUnsubscribeToken, verifyUnsubscribeToken } = await import(
      "./token"
    );
    const token = generateUnsubscribeToken("a@b.co");
    delete process.env.TAY_OAUTH_SECRET;
    expect(() => verifyUnsubscribeToken(token)).toThrow(/TAY_OAUTH_SECRET/);
  });
});
