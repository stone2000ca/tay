// App-level OAuth token encryption — Tay v0.7 → v1.1.1.
//
// Tay rule: NEVER store raw OAuth tokens. The Tay-the-author never sees a
// byte promise extends to anyone who later gets a snapshot of the user's
// Supabase database — refresh tokens are bearer credentials and must be
// useless without the encryption key.
//
// Algorithm: AES-256-GCM (authenticated encryption — integrity + secrecy).
// Output format: base64(iv || ciphertext || authTag). iv is 12 bytes (GCM
// standard), authTag is 16 bytes.
//
// v1.1.1: key now comes from getInstanceSecret("oauth") — HKDF-derived
// from SUPABASE_SERVICE_ROLE_KEY + instance_secrets.salt — instead of a
// user-managed TAY_OAUTH_SECRET env var. The 64-hex output of HKDF
// matches the prior env-var shape so the AES wiring below is unchanged.
//
// v0.x compatibility: lib/secrets/derive.ts contains an env-var fallback
// for TAY_OAUTH_SECRET, so existing v0.x installs (with the env var
// already set) keep working until they're re-deployed against a Supabase
// project that's wired through the Marketplace.
//
// READ-VS-WRITE contract: these are PURE-ish functions (now async because
// the key fetch may go to the DB). encryptToken throws if the secret is
// unreachable (a write that can't be decrypted is a silent data-loss
// bug). decryptToken throws if the secret is unreachable, ciphertext is
// malformed, OR the auth tag fails (tampering detection).

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getInstanceSecret } from "../secrets/derive";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16;
const SECRET_REGEX = /^[0-9a-fA-F]{64}$/;

/**
 * Cheap probe — "is the OAuth crypto secret reachable?". Async because
 * the derive path may need to hit the DB to bootstrap the salt.
 *
 * Returns false (never throws) so cold-start UIs can branch cleanly.
 */
export async function hasOAuthSecret(): Promise<boolean> {
  try {
    const secret = await getInstanceSecret("oauth");
    return SECRET_REGEX.test(secret);
  } catch {
    return false;
  }
}

async function loadKey(): Promise<Buffer> {
  let secret: string;
  try {
    secret = await getInstanceSecret("oauth");
  } catch (err) {
    throw new Error(
      `OAuth secret unreachable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!SECRET_REGEX.test(secret)) {
    throw new Error(
      "OAuth secret malformed (expected 64 hex characters). This shouldn't happen with the HKDF derive path; check your env-var fallback.",
    );
  }
  return Buffer.from(secret, "hex");
}

/**
 * Encrypt a plaintext token. Output: base64(iv || ciphertext || authTag).
 * Throws if the derived secret is unreachable or malformed.
 *
 * Each call produces a fresh random IV — same plaintext encrypts to a
 * different ciphertext every time. This is the right property for tokens
 * (an attacker can't tell when the user rotated their refresh token by
 * watching ciphertext bytes change).
 */
export async function encryptToken(plaintext: string): Promise<string> {
  if (typeof plaintext !== "string" || plaintext.length === 0) {
    throw new Error("encryptToken: plaintext must be a non-empty string.");
  }
  const key = await loadKey();
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
 *   - the derived secret is unreachable or malformed
 *   - the input is not valid base64 / too short to contain iv + tag
 *   - the auth tag fails (tampering or wrong key)
 *
 * The "throws on malformed" contract is deliberate: a silently-empty
 * token would be passed to Gmail and produce confusing 401s. Better to
 * surface "this row was encrypted under a different key" up the stack.
 */
export async function decryptToken(ciphertextB64: string): Promise<string> {
  if (typeof ciphertextB64 !== "string" || ciphertextB64.length === 0) {
    throw new Error("decryptToken: ciphertext must be a non-empty string.");
  }
  const key = await loadKey();
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
      "decryptToken: auth tag mismatch (tampered ciphertext or rotated secret).",
    );
  }
}
