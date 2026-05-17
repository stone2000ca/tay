// Tests for lib/suppression/check.ts.
//
// Validates the safer-default semantics: TRUE on uncertainty (no env,
// DB error, exception); FALSE only on a confirmed no-match.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type ChainResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  capturedEq: { col?: string; val?: unknown } = {};
  select() {
    return this;
  }
  eq(col: string, val: unknown) {
    this.capturedEq = { col, val };
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    return this.result;
  }
}

const queries: FakeQuery[] = [];
let nextQueryIndex = 0;
function freshQuery(): FakeQuery {
  const q = new FakeQuery();
  queries.push(q);
  return q;
}

const fromMock = vi.fn(() => {
  if (nextQueryIndex < queries.length) return queries[nextQueryIndex++];
  return freshQuery();
});

const hasSupabaseEnvMock = vi.fn(() => true);

vi.mock("../supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
  hasSupabaseEnv: () => hasSupabaseEnvMock(),
}));

beforeEach(() => {
  queries.length = 0;
  nextQueryIndex = 0;
  fromMock.mockClear();
  hasSupabaseEnvMock.mockReturnValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isSuppressed", () => {
  test("returns TRUE (safe default) when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { isSuppressed } = await import("./check");
    expect(await isSuppressed("foo@bar.com")).toBe(true);
  });

  test("returns TRUE on empty email input", async () => {
    const { isSuppressed } = await import("./check");
    expect(await isSuppressed("")).toBe(true);
    expect(await isSuppressed("   ")).toBe(true);
  });

  test("returns TRUE (safe default) on DB read error", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "DB down" } };
    const { isSuppressed } = await import("./check");
    expect(await isSuppressed("foo@bar.com")).toBe(true);
  });

  test("returns TRUE (safe default) when supabase client throws", async () => {
    fromMock.mockImplementationOnce(() => {
      throw new Error("supabase unavailable");
    });
    const { isSuppressed } = await import("./check");
    expect(await isSuppressed("foo@bar.com")).toBe(true);
  });

  test("returns FALSE on no match (clear to send)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { isSuppressed } = await import("./check");
    expect(await isSuppressed("clean@example.com")).toBe(false);
  });

  test("returns TRUE on match", async () => {
    const q = freshQuery();
    q.result = { data: { id: "abc" }, error: null };
    const { isSuppressed } = await import("./check");
    expect(await isSuppressed("opted-out@example.com")).toBe(true);
  });

  test("lookup is case-insensitive (lowercases before query)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { isSuppressed } = await import("./check");
    await isSuppressed("MixedCase@Example.COM");
    expect(q.capturedEq.col).toBe("email_lower");
    expect(q.capturedEq.val).toBe("mixedcase@example.com");
  });

  test("trims whitespace before lowercasing", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { isSuppressed } = await import("./check");
    await isSuppressed("  TRIM@me.com  ");
    expect(q.capturedEq.val).toBe("trim@me.com");
  });
});
