// Pure hash + canonical JSON helpers for the audit chain.
//
// Split out from append.ts so the load-bearing crypto is independently
// testable WITHOUT touching Supabase, mocks, or env probing. This is the
// part of Tay's "prove what we did" promise that has to be deterministic
// across processes — same inputs anywhere in the world produce the same
// hex string. No Date.now(), no Math.random(), no locale-dependent
// formatting, no library deps.
//
// Determinism guarantees:
//   - sha256 via Node's built-in `crypto` module (FIPS-standard digest)
//   - canonicalJson sorts object keys lexicographically (recursively) so
//     `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` produce the same string
//   - prev_hash for the very first row is the literal string "NULL" (5
//     chars) — picked so that the first-row hash domain is well-defined
//     and trivially distinguishable from later "abcd1234..." prev values
//     (which are 64-char lowercase hex)
//   - All inputs are concatenated as strings before hashing; no
//     length-prefix framing because the canonical JSON shape is
//     unambiguous (we hash sorted-key JSON, not arbitrary bytes)

import { createHash } from "node:crypto";

/**
 * Sentinel used for the very first row's prev_hash. Picked so that:
 *   - it's a valid string (so concatenation never breaks)
 *   - it's not a 64-char hex (so it's distinguishable from real chains)
 *   - it's the same across processes and timezones (deterministic)
 */
export const NULL_PREV_HASH_SENTINEL = "NULL";

/**
 * Canonical JSON: JSON.stringify with recursively-sorted object keys.
 * Arrays preserve order (order is semantic). Primitives serialize as
 * JSON.stringify does. Inline, no dep, ~20 lines.
 *
 * NOTE: we do NOT handle BigInt or Date — payloads at this layer are
 * already plain JSON-shaped (the redactor in append.ts only emits
 * strings/numbers/booleans/objects/arrays/null).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (typeof value !== "object") return value;
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

export type HashInputs = {
  /** Previous row's this_hash. Pass `null` for the very first row. */
  prev_hash: string | null;
  /** REDACTED payload (the on-disk record matches what was hashed). */
  payload: Record<string, unknown>;
  /** ISO 8601 timestamp, decided BEFORE the insert for determinism. */
  occurred_at: string;
  /** Action name (e.g. "judge.decision"). */
  action: string;
};

/**
 * Compute the lowercase-hex sha256 over (prev_hash || canonicalJson(payload) || occurred_at || action).
 *
 * `prev_hash === null` is treated as the literal string "NULL" (see
 * NULL_PREV_HASH_SENTINEL above). This means a one-row chain has a
 * well-defined first hash; the verifier reproduces the exact same
 * concatenation when walking the chain forward.
 *
 * Pure: same inputs → same output. Always 64 lowercase hex chars.
 */
export function computeHash(inputs: HashInputs): string {
  const prev = inputs.prev_hash ?? NULL_PREV_HASH_SENTINEL;
  const payloadJson = canonicalJson(inputs.payload);
  const input = prev + payloadJson + inputs.occurred_at + inputs.action;
  return createHash("sha256").update(input, "utf8").digest("hex");
}
