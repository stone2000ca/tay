// App-level OAuth token encryption — Tay v0.7.
//
// Tay rule: NEVER store raw OAuth tokens. The Tay-the-author never sees a
// byte promise extends to anyone who later gets a snapshot of the user's
// Supabase database — refresh tokens are bearer credentials and must be
// useless without the encryption key.
//
// Algorithm: AES-256-GCM (authenticated encryption — integrity + secrecy).
// Output format: base64(iv || ciphertext || authTag). iv is 12 bytes (GCM
// standard), authTag is 16 bytes. Caller-provided key is `TAY_OAUTH_SECRET`,
// 64 hex chars (32 bytes) — checked via strict regex.
//
// v1.0 candidate: swap for Supabase Vault when it's GA. Until then,
// app-level encryption with a user-managed env-var key is the most
// portable "tokens are useless without the key" we can build.
//
// READ-VS-WRITE contract: these are PURE functions. encryptToken throws
// if the secret is missing OR malformed (a write that can't be decrypted
// is a silent data-loss bug). decryptToken throws if the secret is
// missing, malformed, OR the ciphertext fails authentication (tampering
// detection). Callers in lib/oauth/persist.ts are WRITE-throwing.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;
const SECRET_REGEX = /^[0-9a-fA-F]{64}$/;

export function hasOAuthSecret(): boolean {
  const secret = process.env.TAY_OAUTH_SECRET;
  return typeof secret === "string" && SECRET_REGEX.test(secret);
}

function loadKey(): Buffer {
  const secret = process.env.TAY_OAUTH_SECRET;
  if (!secret) {
    throw new Error(
      "TAY_OAUTH_SECRET missing. Set a 64-character hex string (32 bytes) in your Vercel env before connecting OAuth.",
    );
  }
  if (!SECRET_REGEX.test(secret)) {
    throw new Error(
      "TAY_OAUTH_SECRET malformed. Must be exactly 64 hex characters (32 bytes).",
    );
  }
  return Buffer.from(secret, "hex");
}

/**
 * Encrypt a plaintext token. Output: base64(iv || ciphertext || authTag).
 * Throws if TAY_OAUTH_SECRET is missing or malformed.
 *
 * Each call produces a fresh random IV — same plaintext encrypts to a
 * different ciphertext every time. This is the right property for tokens
 * (an attacker can't tell when the user rotated their refresh token by
 * watching ciphertext bytes change).
 */
export function encryptToken(plaintext: string): string {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: plaintext must be a non-empty string.");
  }
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString("base64");
}

/**
 * Decrypt a ciphertext produced by `encryptToken`. Throws if:
 *   - TAY_OAUTH_SECRET is missing or malformed
 *   - the input is not valid base64 / too short to contain iv + tag
 *   - the auth tag fails (tampering or wrong key)
 *
 * The "throws on malformed" contract is deliberate: a silently-empty
 * token would be passed to Gmail and produce confusing 401s. Better to
 * surface "this row was encrypted under a different key" up the stack.
 */
export function decryptToken(ciphertextB64: string): string {
  if (typeof ciphertextB64 !== "string" || ciphertextB64.length === 0) {
    throw new Error("decryptToken: ciphertext must be a non-empty string.");
  }
  const key = loadKey();
  let raw: Buffer;
  try {
    raw = Buffer.from(ciphertextB64, "base64");
  } catch {
    throw new Error("decryptToken: ciphertext is not valid base64.");
  }
  if (raw.length < IV_LEN + TAG_LEN + 1) {
    throw new Error("decryptToken: ciphertext too short.");
  }
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const ct = raw.subarray(IV_LEN, raw.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error(
      "decryptToken: auth tag mismatch (tampered ciphertext or wrong TAY_OAUTH_SECRET).",
    );
  }
}
