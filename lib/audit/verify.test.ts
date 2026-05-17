// Tests for lib/audit/verify.ts.
//
// Build the chain by computing valid hashes in test setup, then mock
// the Supabase select() to return the rows. Verifier walks them and
// reports ok/brokenAt.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";
import { computeHash } from "./hash";

// -----------------------------------------------------------------------
// Supabase mock — select-only flow for the verifier.
// -----------------------------------------------------------------------

type ChainResult = {
  data?: unknown;
  error?: { message: string } | null;
};

class FakeSelectQuery {
  result: ChainResult = { data: [], error: null };
  select() {
    return this;
  }
  order() {
    return this;
  }
  // Awaitable directly (verifier awaits the chain, no maybeSingle).
  then<TResult1 = ChainResult, TResult2 = never>(
    onfulfilled?:
      | ((value: ChainResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?:
      | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
      | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

let currentQuery: FakeSelectQuery = new FakeSelectQuery();
const fromMock = vi.fn(() => currentQuery);
const hasSupabaseEnvMock = vi.fn(() => true);

vi.mock("../supabase/server", () => ({
  getSupabaseServerClient: () => ({ from: fromMock }),
  hasSupabaseEnv: () => hasSupabaseEnvMock(),
}));

function setRows(rows: unknown[]) {
  currentQuery = new FakeSelectQuery();
  currentQuery.result = { data: rows, error: null };
}

function setError(message: string) {
  currentQuery = new FakeSelectQuery();
  currentQuery.result = { data: null, error: { message } };
}

beforeEach(() => {
  currentQuery = new FakeSelectQuery();
  fromMock.mockClear();
  hasSupabaseEnvMock.mockReturnValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------
// Helpers — build a valid chain.
// -----------------------------------------------------------------------

function buildChain(
  events: Array<{
    action: string;
    payload: Record<string, unknown>;
    occurred_at: string;
  }>,
): Array<{
  id: number;
  occurred_at: string;
  action: string;
  payload: Record<string, unknown>;
  prev_hash: string | null;
  this_hash: string;
}> {
  const rows: Array<{
    id: number;
    occurred_at: string;
    action: string;
    payload: Record<string, unknown>;
    prev_hash: string | null;
    this_hash: string;
  }> = [];
  let prev: string | null = null;
  events.forEach((e, idx) => {
    const this_hash = computeHash({
      prev_hash: prev,
      payload: e.payload,
      occurred_at: e.occurred_at,
      action: e.action,
    });
    rows.push({
      id: idx + 1,
      occurred_at: e.occurred_at,
      action: e.action,
      payload: e.payload,
      prev_hash: prev,
      this_hash,
    });
    prev = this_hash;
  });
  return rows;
}

// -----------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------

describe("verifyAuditChain", () => {
  test("0 rows → ok=true, lastHash=null", async () => {
    setRows([]);
    const { verifyAuditChain } = await import("./verify");
    const result = await verifyAuditChain();
    expect(result).toEqual({ ok: true, totalRows: 0, lastHash: null });
  });

  test("happy path 3 rows → ok=true, lastHash matches last row", async () => {
    const rows = buildChain([
      {
        action: "judge.decision",
        payload: { draftId: "1" },
        occurred_at: "2026-05-17T10:00:00.000Z",
      },
      {
        action: "judge.decision",
        payload: { draftId: "2" },
        occurred_at: "2026-05-17T10:01:00.000Z",
      },
      {
        action: "judge.decision",
        payload: { draftId: "3" },
        occurred_at: "2026-05-17T10:02:00.000Z",
      },
    ]);
    setRows(rows);

    const { verifyAuditChain } = await import("./verify");
    const result = await verifyAuditChain();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.totalRows).toBe(3);
      expect(result.lastHash).toBe(rows[2].this_hash);
    }
  });

  test("tampered payload in middle row → ok=false with hash_mismatch", async () => {
    const rows = buildChain([
      {
        action: "judge.decision",
        payload: { draftId: "1" },
        occurred_at: "2026-05-17T10:00:00.000Z",
      },
      {
        action: "judge.decision",
        payload: { draftId: "2" },
        occurred_at: "2026-05-17T10:01:00.000Z",
      },
      {
        action: "judge.decision",
        payload: { draftId: "3" },
        occurred_at: "2026-05-17T10:02:00.000Z",
      },
    ]);
    // Tamper: change payload of middle row but leave stored this_hash.
    rows[1].payload = { draftId: "EVIL" };
    setRows(rows);

    const { verifyAuditChain } = await import("./verify");
    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAt.id).toBe(2);
      expect(result.brokenAt.reason).toBe("hash_mismatch");
      expect(result.brokenAt.storedHash).toBe(rows[1].this_hash);
      expect(result.brokenAt.expectedHash).not.toBe(rows[1].this_hash);
    }
  });

  test("prev_hash mismatch (broken link) → ok=false with prev_hash_mismatch", async () => {
    const rows = buildChain([
      {
        action: "judge.decision",
        payload: { draftId: "1" },
        occurred_at: "2026-05-17T10:00:00.000Z",
      },
      {
        action: "judge.decision",
        payload: { draftId: "2" },
        occurred_at: "2026-05-17T10:01:00.000Z",
      },
    ]);
    // Break the link: row 2's prev_hash no longer matches row 1's this_hash.
    rows[1].prev_hash = "f".repeat(64);
    setRows(rows);

    const { verifyAuditChain } = await import("./verify");
    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAt.id).toBe(2);
      expect(result.brokenAt.reason).toBe("prev_hash_mismatch");
    }
  });

  test("first row with non-null prev_hash → ok=false with prev_hash_mismatch", async () => {
    const rows = buildChain([
      {
        action: "judge.decision",
        payload: { draftId: "1" },
        occurred_at: "2026-05-17T10:00:00.000Z",
      },
    ]);
    rows[0].prev_hash = "a".repeat(64);
    setRows(rows);

    const { verifyAuditChain } = await import("./verify");
    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAt.id).toBe(1);
      expect(result.brokenAt.reason).toBe("prev_hash_mismatch");
    }
  });

  test("soft-fails when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { verifyAuditChain } = await import("./verify");
    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAt.reason).toBe("supabase_unavailable");
    }
  });

  test("soft-fails on DB read error", async () => {
    setError("connection refused");
    const { verifyAuditChain } = await import("./verify");
    const result = await verifyAuditChain();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAt.reason).toBe("read_error");
    }
  });
});
