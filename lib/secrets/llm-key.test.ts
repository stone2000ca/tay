// Tests for lib/secrets/llm-key.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const TEST_SECRET = "a".repeat(64);

type ChainResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: { op?: string; payload?: unknown; opts?: unknown } = {};
  select() {
    return this;
  }
  upsert(row: unknown, opts?: unknown) {
    this.captured = { op: "upsert", payload: row, opts };
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    return this.result;
  }
  then<T1 = ChainResult, T2 = never>(
    onfulfilled?:
      | ((value: ChainResult) => T1 | PromiseLike<T1>)
      | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return Promise.resolve(this.result).then(
      onfulfilled as (v: ChainResult) => T1,
      onrejected as (r: unknown) => T2,
    );
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

let originalServiceRole: string | undefined;
let originalSecret: string | undefined;

beforeEach(() => {
  queries.length = 0;
  nextQueryIndex = 0;
  fromMock.mockClear();
  hasSupabaseEnvMock.mockReturnValue(true);
  originalServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  originalSecret = process.env.TAY_OAUTH_SECRET;
  // Force env-var fallback in derive.ts so crypto works without a DB.
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.TAY_OAUTH_SECRET = TEST_SECRET;
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (originalServiceRole === undefined)
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRole;
  if (originalSecret === undefined) delete process.env.TAY_OAUTH_SECRET;
  else process.env.TAY_OAUTH_SECRET = originalSecret;
  vi.restoreAllMocks();
});

describe("computeFingerprint", () => {
  test("stable for same input", async () => {
    const { computeFingerprint } = await import("./llm-key");
    expect(computeFingerprint("hello")).toBe(computeFingerprint("hello"));
  });

  test("returns 8 lowercase hex chars", async () => {
    const { computeFingerprint } = await import("./llm-key");
    expect(computeFingerprint("anything")).toMatch(/^[0-9a-f]{8}$/);
  });

  test("different inputs → different fingerprints", async () => {
    const { computeFingerprint } = await import("./llm-key");
    expect(computeFingerprint("a")).not.toBe(computeFingerprint("b"));
  });
});

describe("setLlmKey", () => {
  test("encrypts plaintext + upserts on lock_col", async () => {
    const upQ = freshQuery();
    upQ.result = { data: null, error: null };
    const { setLlmKey } = await import("./llm-key");
    await setLlmKey({ provider: "anthropic", plaintext: "sk-ant-secret-xyz" });
    expect(upQ.captured.op).toBe("upsert");
    const row = upQ.captured.payload as Record<string, unknown>;
    expect(row.lock_col).toBe(1);
    expect(row.llm_provider).toBe("anthropic");
    expect(row.llm_key_fingerprint).toMatch(/^[0-9a-f]{8}$/);
    // Ciphertext MUST NOT contain plaintext.
    expect(String(row.llm_key_ciphertext)).not.toContain("sk-ant-secret-xyz");
    expect(upQ.captured.opts).toEqual({ onConflict: "lock_col" });
  });

  test("throws when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { setLlmKey } = await import("./llm-key");
    await expect(
      setLlmKey({ provider: "anthropic", plaintext: "sk-ant-x" }),
    ).rejects.toThrow(/Supabase/);
  });

  test("throws on empty plaintext", async () => {
    const { setLlmKey } = await import("./llm-key");
    await expect(
      setLlmKey({ provider: "anthropic", plaintext: "" }),
    ).rejects.toThrow(/non-empty/);
  });

  test("throws on upsert DB error", async () => {
    const upQ = freshQuery();
    upQ.result = { data: null, error: { message: "duplicate" } };
    const { setLlmKey } = await import("./llm-key");
    await expect(
      setLlmKey({ provider: "openai", plaintext: "sk-x" }),
    ).rejects.toThrow(/duplicate/);
  });
});

describe("getLlmKey", () => {
  test("round-trips set + get", async () => {
    const { encryptToken } = await import("../oauth/crypto");
    const ciphertext = await encryptToken("sk-ant-roundtrip");
    const q = freshQuery();
    q.result = {
      data: { llm_provider: "anthropic", llm_key_ciphertext: ciphertext },
      error: null,
    };
    const { getLlmKey } = await import("./llm-key");
    const out = await getLlmKey();
    expect(out).toEqual({ provider: "anthropic", plaintext: "sk-ant-roundtrip" });
  });

  test("returns null when row absent", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { getLlmKey } = await import("./llm-key");
    expect(await getLlmKey()).toBeNull();
  });

  test("returns null when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { getLlmKey } = await import("./llm-key");
    expect(await getLlmKey()).toBeNull();
  });

  test("returns null on decrypt failure (rotated secret)", async () => {
    const q = freshQuery();
    q.result = {
      data: { llm_provider: "anthropic", llm_key_ciphertext: "garbage" },
      error: null,
    };
    const { getLlmKey } = await import("./llm-key");
    expect(await getLlmKey()).toBeNull();
  });
});

describe("getLlmKeyMetadata", () => {
  test("returns metadata without decrypting", async () => {
    const q = freshQuery();
    q.result = {
      data: {
        llm_provider: "openrouter",
        llm_key_fingerprint: "deadbeef",
        llm_key_set_at: "2026-05-17T00:00:00.000Z",
      },
      error: null,
    };
    const { getLlmKeyMetadata } = await import("./llm-key");
    expect(await getLlmKeyMetadata()).toEqual({
      provider: "openrouter",
      fingerprint: "deadbeef",
      setAt: "2026-05-17T00:00:00.000Z",
    });
  });

  test("returns null when row absent", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { getLlmKeyMetadata } = await import("./llm-key");
    expect(await getLlmKeyMetadata()).toBeNull();
  });
});
