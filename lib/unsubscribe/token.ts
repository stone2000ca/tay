// HMAC-signed unsubscribe tokens — Tay v0.8 (gate H — input/output integrity).
//
// Format:
//   base64url(payload).base64url(signature)
//   where payload = JSON({ email, exp, kind: "unsubscribe" })
//         signature = HMAC-SHA256(TAY_OAUTH_SECRET, payload_b64url)
//
// SECRET REUSE: we use TAY_OAUTH_SECRET (introduced in v0.7 for AES
// token encryption) rather than introducing a new env var. Two reasons:
//   1. Operators already manage it. One fewer thing to forget.
//   2. The secret has the right length / hex format for HMAC use.
// Trade-off documented: if the secret leaks, BOTH stored OAuth tokens
// AND outstanding unsubscribe links become forgeable. The mitigation is
// the same in both cases: rotate TAY_OAUTH_SECRET, which invalidates
// outstanding tokens AND requires re-consent on the OAuth side.
//
// DEFAULT TTL: 90 days. Long enough that a recipient who reads an email
// weeks later can still click; short enough that a leaked link from
// years ago doesn't unsubscribe someone today.
//
// READ-VS-WRITE error contract: these are PURE functions. generate
// throws if TAY_OAUTH_SECRET missing. verify NEVER throws (the
// unsubscribe route renders a friendly "expired or invalid" message
// for any rejection) — returns a discriminated union { ok, ... }.

import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET_REGEX = /^[0-9a-fA-F]{64}$/;
const DEFAULT_TTL_DAYS = 90;
const KIND = "unsubscribe" as const;

type Payload = {
  email: string;
  exp: number; // unix seconds
  kind: typeof KIND;
};

function loadKey(): Buffer {
  const secret = process.env.TAY_OAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "TAY_OAUTH_SECRET missing. Cannot generate or verify unsubscribe tokens. Set a 64-character hex string in your Vercel env.",
    );
  }
  if (!SECRET_REGEX.test(secret)) {
    throw new Error(
      "TAY_OAUTH_SECRET malformed. Must be exactly 64 hex characters (32 bytes).",
    );
  }
  return Buffer.from(secret, "hex");
}

function base64urlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(s: string): Buffer {
  // Pad to multiple of 4 with "=" then map back to standard base64.
  const padLen = (4 - (s.length % 4)) % 4;
  const padded = s + "=".repeat(padLen);
  const std = padded.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(std, "base64");
}

/**
 * Mint a token that proves "this recipient asked to unsubscribe".
 *
 * Throws if TAY_OAUTH_SECRET is missing or malformed.
 */
export function generateUnsubscribeToken(
  email: string,
  ttlDaysOpt?: number,
): string {
  const normalized = (email ?? "").trim();
  if (!normalized) {
    throw new Error("generateUnsubscribeToken: email must be non-empty.");
  }
  const key = loadKey();
  const ttlDays = ttlDaysOpt ?? DEFAULT_TTL_DAYS;
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + ttlDays * 24 * 60 * 60;
  const payload: Payload = { email: normalized, exp, kind: KIND };
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload), "utf8"));
  const sig = createHmac("sha256", key).update(payloadB64).digest();
  const sigB64 = base64urlEncode(sig);
  return `${payloadB64}.${sigB64}`;
}

/**
 * Verify a token. Returns { ok: true, email } iff:
 *   - the token parses as two base64url segments
 *   - the signature matches (constant-time compare via timingSafeEqual)
 *   - kind === "unsubscribe"
 *   - exp > now
 *   - email is a non-empty string
 *
 * Otherwise returns { ok: false, reason } with a stable code. Never
 * throws on invalid input — only the secret-missing path throws.
 */
export function verifyUnsubscribeToken(
  token: string,
):
  | { ok: true; email: string }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "bad_kind" } {
  if (typeof token !== "string" || token.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) {
    return { ok: false, reason: "malformed" };
  }
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  // Compute the expected signature. If the secret is missing, the throw
  // here is correct behaviour — the unsubscribe route catches it and
  // surfaces a friendly error to the recipient (no token-secret
  // disclosure).
  const key = loadKey();
  const expectedSig = createHmac("sha256", key).update(payloadB64).digest();

  let providedSig: Buffer;
  try {
    providedSig = base64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (providedSig.length !== expectedSig.length) {
    return { ok: false, reason: "bad_signature" };
  }
  // Constant-time comparison — defeats timing attacks even though our
  // surface area is small.
  if (!timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, reason: "bad_signature" };
  }

  // Signature good — now check the payload contents.
  let payload: Partial<Payload>;
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (payload.kind !== KIND) {
    return { ok: false, reason: "bad_kind" };
  }
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    return { ok: false, reason: "malformed" };
  }
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: "malformed" };
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec >= payload.exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, email: payload.email };
}
