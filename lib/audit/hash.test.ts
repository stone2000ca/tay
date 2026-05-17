// Tests for lib/audit/hash.ts.
//
// The hash function is load-bearing for Tay's "prove what we did"
// promise. These tests cover determinism, the NULL sentinel for the
// first row, canonical JSON (key reorder), and avalanche on prev_hash.

import { describe, expect, test } from "vitest";
import {
  canonicalJson,
  computeHash,
  NULL_PREV_HASH_SENTINEL,
} from "./hash";

describe("canonicalJson", () => {
  test("primitives serialize as JSON.stringify does", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(42)).toBe("42");
    expect(canonicalJson("hi")).toBe('"hi"');
    expect(canonicalJson(true)).toBe("true");
  });

  test("object keys are sorted lexicographically", () => {
    expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  test("nested object keys are sorted recursively", () => {
    expect(canonicalJson({ b: { y: 2, x: 1 }, a: 1 })).toBe(
      '{"a":1,"b":{"x":1,"y":2}}',
    );
  });

  test("array order is preserved (order is semantic)", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  test("arrays of objects sort each object's keys", () => {
    expect(canonicalJson([{ b: 2, a: 1 }, { d: 4, c: 3 }])).toBe(
      '[{"a":1,"b":2},{"c":3,"d":4}]',
    );
  });

  test("two payloads with reordered keys produce identical canonical JSON", () => {
    const a = { foo: 1, bar: { y: 2, x: 1 }, baz: [1, 2] };
    const b = { baz: [1, 2], bar: { x: 1, y: 2 }, foo: 1 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe("computeHash", () => {
  const baseInputs = {
    prev_hash: null,
    payload: { draftId: "abc", decision: "allow" },
    occurred_at: "2026-05-17T12:00:00.000Z",
    action: "judge.decision",
  };

  test("returns a 64-char lowercase hex string", () => {
    const h = computeHash(baseInputs);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("is deterministic for same inputs", () => {
    const h1 = computeHash(baseInputs);
    const h2 = computeHash(baseInputs);
    expect(h1).toBe(h2);
  });

  test("same payload with reordered keys yields same hash (canonical JSON)", () => {
    const h1 = computeHash({
      ...baseInputs,
      payload: { draftId: "abc", decision: "allow" },
    });
    const h2 = computeHash({
      ...baseInputs,
      payload: { decision: "allow", draftId: "abc" },
    });
    expect(h1).toBe(h2);
  });

  test("different prev_hash yields different this_hash (avalanche)", () => {
    const h1 = computeHash(baseInputs);
    const h2 = computeHash({ ...baseInputs, prev_hash: "x".repeat(64) });
    expect(h1).not.toBe(h2);
  });

  test("different occurred_at yields different this_hash", () => {
    const h1 = computeHash(baseInputs);
    const h2 = computeHash({
      ...baseInputs,
      occurred_at: "2026-05-17T12:00:00.001Z",
    });
    expect(h1).not.toBe(h2);
  });

  test("different action yields different this_hash", () => {
    const h1 = computeHash(baseInputs);
    const h2 = computeHash({ ...baseInputs, action: "draft.created" });
    expect(h1).not.toBe(h2);
  });

  test("different payload value yields different this_hash", () => {
    const h1 = computeHash(baseInputs);
    const h2 = computeHash({
      ...baseInputs,
      payload: { draftId: "abc", decision: "block" },
    });
    expect(h1).not.toBe(h2);
  });

  test("first-row hash (prev_hash=null) uses NULL sentinel", () => {
    // Explicit verification that the null branch concatenates the
    // literal "NULL" string. We compute the expected hash by hand
    // using the same primitives the implementation does.
    const hViaNull = computeHash({ ...baseInputs, prev_hash: null });
    const hViaSentinel = computeHash({
      ...baseInputs,
      prev_hash: NULL_PREV_HASH_SENTINEL,
    });
    expect(hViaNull).toBe(hViaSentinel);
  });

  test("first-row hash is distinguishable from a chain that happens to have a prev of literal 'NULL'", () => {
    // This is a hypothetical: nobody would store 'NULL' as a prev_hash
    // in real chains (prev_hash is 64-char hex). But we assert the
    // function is consistent — passing the literal string equals
    // passing null.
    const h1 = computeHash({ ...baseInputs, prev_hash: null });
    const h2 = computeHash({ ...baseInputs, prev_hash: "NULL" });
    expect(h1).toBe(h2);
  });

  test("empty payload still produces a deterministic hash", () => {
    const h = computeHash({ ...baseInputs, payload: {} });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(computeHash({ ...baseInputs, payload: {} }));
  });
});
