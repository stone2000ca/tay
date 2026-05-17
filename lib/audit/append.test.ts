// Tests for lib/audit/append.ts.
//
// Two test groups:
//   1. `redactPayload` — unit tests, no Supabase mocking required.
//   2. `appendAudit`   — integration with the Supabase mock; verifies
//      skip path, first-row case, continuation case, hash determinism
//      via the on-disk insert payload.

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
// Supabase mock — same FakeQuery pattern as lib/judge/persist.test.ts.
// -----------------------------------------------------------------------

type ChainResult = {
  data?: unknown;
  error?: { message: string } | null;
};

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  capturedInsert: unknown = null;
  select() {
    return this;
  }
  insert(row: unknown) {
    this.capturedInsert = row;
    return this;
  }
  eq() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    return this.result;
  }
  async single() {
    return this.result;
  }
  // Allow awaiting the chain directly (used by .insert() with no .select()).
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

const queries: FakeQuery[] = [];
let nextQueryIndex = 0;

function freshQuery(): FakeQuery {
  const q = new FakeQuery();
  queries.push(q);
  return q;
}

const fromMock = vi.fn(() => {
  if (nextQueryIndex < queries.length) {
    return queries[nextQueryIndex++];
  }
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
});

afterEach(() => {
  vi.clearAllMocks();
});

// -----------------------------------------------------------------------
// redactPayload
// -----------------------------------------------------------------------

describe("redactPayload", () => {
  // Parameterized test — every protected key gets redacted. If you add
  // a new key fragment to PROTECTED_KEY_FRAGMENTS, add it here too.
  const PROTECTED_KEYS = [
    "api_key",
    "apikey",
    "API_KEY",
    "anthropic_secret",
    "session_token",
    "user_password",
    "to_email",
    "prospect_email",
    "body",
    "raw_body",
    "raw",
  ];

  for (const key of PROTECTED_KEYS) {
    test(`redacts key '${key}'`, async () => {
      const { redactPayload } = await import("./append");
      const out = redactPayload({ [key]: "sensitive-value" });
      expect(out[key]).toBe("[redacted]");
    });
  }

  test("truncates strings longer than 200 chars with <TRUNCATED:N> marker", async () => {
    const { redactPayload } = await import("./append");
    const long = "x".repeat(500);
    const out = redactPayload({ note: long });
    expect(out.note).toBe(`${"x".repeat(200)}<TRUNCATED:500>`);
  });

  test("leaves short strings untouched", async () => {
    const { redactPayload } = await import("./append");
    const out = redactPayload({ note: "all good" });
    expect(out.note).toBe("all good");
  });

  test("recurses into nested objects", async () => {
    const { redactPayload } = await import("./append");
    const out = redactPayload({
      meta: { api_key: "secret123", innocuous: "ok" },
    });
    expect(out.meta).toEqual({ api_key: "[redacted]", innocuous: "ok" });
  });

  test("handles arrays — including arrays of objects", async () => {
    const { redactPayload } = await import("./append");
    const out = redactPayload({
      items: [
        { token: "t1", name: "a" },
        { token: "t2", name: "b" },
      ],
    });
    expect(out.items).toEqual([
      { token: "[redacted]", name: "a" },
      { token: "[redacted]", name: "b" },
    ]);
  });

  test("preserves null and booleans and numbers", async () => {
    const { redactPayload } = await import("./append");
    const out = redactPayload({
      n: 42,
      b: true,
      z: null,
      s: "hi",
    });
    expect(out).toEqual({ n: 42, b: true, z: null, s: "hi" });
  });
});

// -----------------------------------------------------------------------
// appendAudit — skip path
// -----------------------------------------------------------------------

describe("appendAudit — degraded modes", () => {
  test("skip path when no Supabase env (logs but does not write)", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const { appendAudit } = await import("./append");
    await appendAudit({
      action: "judge.decision",
      payload: { draftId: "d1" },
    });

    expect(fromMock).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[audit] skipped"),
    );
    logSpy.mockRestore();
  });

  test("never throws when latest-row read errors", async () => {
    const readQ = freshQuery();
    readQ.result = { data: null, error: { message: "DB down" } };
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const { appendAudit } = await import("./append");
    await expect(
      appendAudit({ action: "judge.decision", payload: { x: 1 } }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  test("never throws when insert errors", async () => {
    const readQ = freshQuery();
    readQ.result = { data: null, error: null };
    const insertQ = freshQuery();
    insertQ.result = { data: null, error: { message: "constraint X" } };
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});

    const { appendAudit } = await import("./append");
    await expect(
      appendAudit({ action: "judge.decision", payload: { x: 1 } }),
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

// -----------------------------------------------------------------------
// appendAudit — first-row case
// -----------------------------------------------------------------------

describe("appendAudit — first-row case", () => {
  test("inserts row with prev_hash=null and this_hash derived from 'NULL' sentinel", async () => {
    const readQ = freshQuery();
    readQ.result = { data: null, error: null }; // no prior row
    const insertQ = freshQuery();
    insertQ.result = { data: null, error: null };

    const { appendAudit } = await import("./append");
    await appendAudit({
      action: "judge.decision",
      payload: { draftId: "draft-1", decision: "allow" },
    });

    const captured = insertQ.capturedInsert as {
      occurred_at: string;
      action: string;
      payload: Record<string, unknown>;
      prev_hash: string | null;
      this_hash: string;
    };

    expect(captured.action).toBe("judge.decision");
    expect(captured.prev_hash).toBeNull();
    // Verify this_hash recomputes correctly using the captured fields —
    // this is the on-disk determinism guarantee.
    const expected = computeHash({
      prev_hash: null,
      payload: captured.payload,
      occurred_at: captured.occurred_at,
      action: captured.action,
    });
    expect(captured.this_hash).toBe(expected);
    expect(captured.this_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

// -----------------------------------------------------------------------
// appendAudit — continuation case
// -----------------------------------------------------------------------

describe("appendAudit — continuation case", () => {
  test("inserts row with prev_hash = last row's this_hash", async () => {
    const lastHash = "a".repeat(64);
    const readQ = freshQuery();
    readQ.result = { data: { this_hash: lastHash }, error: null };
    const insertQ = freshQuery();
    insertQ.result = { data: null, error: null };

    const { appendAudit } = await import("./append");
    await appendAudit({
      action: "judge.decision",
      payload: { draftId: "draft-2" },
    });

    const captured = insertQ.capturedInsert as {
      prev_hash: string | null;
      this_hash: string;
      occurred_at: string;
      action: string;
      payload: Record<string, unknown>;
    };
    expect(captured.prev_hash).toBe(lastHash);
    const expected = computeHash({
      prev_hash: lastHash,
      payload: captured.payload,
      occurred_at: captured.occurred_at,
      action: captured.action,
    });
    expect(captured.this_hash).toBe(expected);
  });

  test("inserted payload is the REDACTED payload (not the raw payload)", async () => {
    const readQ = freshQuery();
    readQ.result = { data: null, error: null };
    const insertQ = freshQuery();
    insertQ.result = { data: null, error: null };

    const { appendAudit } = await import("./append");
    await appendAudit({
      action: "send.sent",
      payload: { to_email: "alice@example.com", subject: "Hi" },
    });

    const captured = insertQ.capturedInsert as {
      payload: Record<string, unknown>;
    };
    expect(captured.payload.to_email).toBe("[redacted]");
    expect(captured.payload.subject).toBe("Hi");
  });
});
