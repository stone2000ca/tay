// Tests for lib/suppression/add.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

type ChainResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: {
    op?: string;
    payload?: unknown;
    onConflict?: unknown;
    eqCol?: string;
    eqVal?: unknown;
  } = {};
  select() {
    return this;
  }
  upsert(payload: unknown, opts?: unknown) {
    this.captured = { op: "upsert", payload, onConflict: opts };
    return this;
  }
  delete() {
    this.captured = { ...this.captured, op: "delete" };
    return this;
  }
  eq(col: string, val: unknown) {
    this.captured = { ...this.captured, eqCol: col, eqVal: val };
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

describe("addSuppression", () => {
  test("upserts a row lowercased on email_lower with ignoreDuplicates", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { addSuppression } = await import("./add");
    await addSuppression({
      email: "  Opted-Out@Example.COM ",
      reason: "user_unsubscribe",
      source: "unsubscribe-link",
    });
    expect(q.captured.op).toBe("upsert");
    const payload = q.captured.payload as Record<string, unknown>;
    expect(payload.email_lower).toBe("opted-out@example.com");
    expect(payload.reason).toBe("user_unsubscribe");
    expect(payload.source).toBe("unsubscribe-link");
    expect(q.captured.onConflict).toEqual({
      onConflict: "email_lower",
      ignoreDuplicates: true,
    });
  });

  test("throws when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { addSuppression } = await import("./add");
    await expect(
      addSuppression({
        email: "x@y.co",
        reason: "manual_add",
        source: "test",
      }),
    ).rejects.toThrow(/Supabase/);
  });

  test("throws on empty email", async () => {
    const { addSuppression } = await import("./add");
    await expect(
      addSuppression({ email: "", reason: "manual_add", source: "t" }),
    ).rejects.toThrow(/email/);
  });

  test("throws on invalid reason", async () => {
    const { addSuppression } = await import("./add");
    await expect(
      addSuppression({
        email: "x@y.co",
        // @ts-expect-error — testing runtime guard
        reason: "garbage",
        source: "t",
      }),
    ).rejects.toThrow(/reason/);
  });

  test("throws on empty source", async () => {
    const { addSuppression } = await import("./add");
    await expect(
      addSuppression({
        email: "x@y.co",
        reason: "manual_add",
        source: "   ",
      }),
    ).rejects.toThrow(/source/);
  });

  test("throws on DB error", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "constraint X" } };
    const { addSuppression } = await import("./add");
    await expect(
      addSuppression({
        email: "x@y.co",
        reason: "manual_add",
        source: "t",
      }),
    ).rejects.toThrow(/constraint X/);
  });

  test("idempotent: a duplicate-add upsert resolves successfully (no throw)", async () => {
    // Supabase upsert with ignoreDuplicates returns success even when row
    // already existed; we just have to not throw on the same call shape.
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { addSuppression } = await import("./add");
    await addSuppression({
      email: "dup@example.com",
      reason: "manual_add",
      source: "t1",
    });
    const q2 = freshQuery();
    q2.result = { data: null, error: null };
    await expect(
      addSuppression({
        email: "dup@example.com",
        reason: "manual_add",
        source: "t2",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("removeSuppression", () => {
  test("deletes by lowercased email_lower", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { removeSuppression } = await import("./add");
    await removeSuppression("ToRemove@Example.COM");
    expect(q.captured.op).toBe("delete");
    expect(q.captured.eqCol).toBe("email_lower");
    expect(q.captured.eqVal).toBe("toremove@example.com");
  });

  test("throws when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { removeSuppression } = await import("./add");
    await expect(removeSuppression("x@y.co")).rejects.toThrow(/Supabase/);
  });

  test("throws on empty email", async () => {
    const { removeSuppression } = await import("./add");
    await expect(removeSuppression("  ")).rejects.toThrow(/email/);
  });

  test("throws on DB error", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "boom" } };
    const { removeSuppression } = await import("./add");
    await expect(removeSuppression("x@y.co")).rejects.toThrow(/boom/);
  });
});

describe("listSuppressions", () => {
  test("returns mapped entries on success", async () => {
    const q = freshQuery();
    q.result = {
      data: [
        {
          email_lower: "a@x.co",
          reason: "user_unsubscribe",
          source: "unsubscribe-link",
          added_at: "2026-05-17T12:00:00Z",
        },
        {
          email_lower: "b@x.co",
          reason: "manual_add",
          source: "admin-ui:manual-add",
          added_at: "2026-05-17T11:00:00Z",
        },
      ],
      error: null,
    };
    const { listSuppressions } = await import("./add");
    const out = await listSuppressions(50);
    expect(out).toEqual([
      {
        email: "a@x.co",
        reason: "user_unsubscribe",
        source: "unsubscribe-link",
        addedAt: "2026-05-17T12:00:00Z",
      },
      {
        email: "b@x.co",
        reason: "manual_add",
        source: "admin-ui:manual-add",
        addedAt: "2026-05-17T11:00:00Z",
      },
    ]);
  });

  test("returns [] when Supabase env missing (soft-fail)", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { listSuppressions } = await import("./add");
    expect(await listSuppressions()).toEqual([]);
  });

  test("returns [] on DB error (soft-fail)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "boom" } };
    const { listSuppressions } = await import("./add");
    expect(await listSuppressions()).toEqual([]);
  });

  test("returns [] on supabase throw (soft-fail)", async () => {
    fromMock.mockImplementationOnce(() => {
      throw new Error("supabase unavailable");
    });
    const { listSuppressions } = await import("./add");
    expect(await listSuppressions()).toEqual([]);
  });
});
