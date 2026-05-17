// Tests for lib/supabase/migrate.ts.
//
// We don't have a real Supabase project to run against, so these tests
// cover:
//   (a) the skip path when no POSTGRES_URL is configured, and
//   (b) the in-process dedupe — repeat calls return the same promise.
//
// Both paths are reachable without mocking `pg` itself, which keeps the
// test surface small.

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { ensureSchema, __resetMigrateCacheForTests } from "./migrate";

const ENV_KEYS = ["POSTGRES_URL_NON_POOLING", "POSTGRES_URL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  __resetMigrateCacheForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  __resetMigrateCacheForTests();
});

describe("ensureSchema", () => {
  test("returns skipped:true when no POSTGRES_URL_* env vars are set", async () => {
    const result = await ensureSchema();
    expect(result).toEqual({ ran: false, skipped: true });
  });

  test("memoizes: repeated calls share the same promise", async () => {
    const p1 = ensureSchema();
    const p2 = ensureSchema();
    expect(p1).toBe(p2);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual(r2);
  });

  test("after cache reset, a new promise is returned", async () => {
    const p1 = ensureSchema();
    await p1;
    __resetMigrateCacheForTests();
    const p2 = ensureSchema();
    expect(p1).not.toBe(p2);
    await p2;
  });
});
