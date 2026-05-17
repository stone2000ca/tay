// Tests for lib/oauth/persist.ts. Mocks Supabase + google fetch wrappers.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const TEST_SECRET = "a".repeat(64);

type ChainResult = { data?: unknown; error?: { message: string } | null };

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: { op?: string; payload?: unknown } = {};
  select() {
    return this;
  }
  insert(row: unknown) {
    this.captured = { op: "insert", payload: row };
    return this;
  }
  update(row: unknown) {
    this.captured = { op: "update", payload: row };
    return this;
  }
  delete() {
    this.captured = { op: "delete" };
    return this;
  }
  eq() {
    return this;
  }
  neq() {
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

const refreshAccessTokenMock = vi.fn();
vi.mock("./google", () => ({
  refreshAccessToken: (a: unknown) => refreshAccessTokenMock(a),
}));

let originalSecret: string | undefined;
let originalGoogleId: string | undefined;
let originalGoogleSecret: string | undefined;

beforeEach(() => {
  queries.length = 0;
  nextQueryIndex = 0;
  fromMock.mockClear();
  refreshAccessTokenMock.mockReset();
  hasSupabaseEnvMock.mockReturnValue(true);
  originalSecret = process.env.TAY_OAUTH_SECRET;
  originalGoogleId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  originalGoogleSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  process.env.TAY_OAUTH_SECRET = TEST_SECRET;
  process.env.GOOGLE_OAUTH_CLIENT_ID = "cid";
  process.env.GOOGLE_OAUTH_CLIENT_SECRET = "csec";
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.TAY_OAUTH_SECRET;
  else process.env.TAY_OAUTH_SECRET = originalSecret;
  if (originalGoogleId === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  else process.env.GOOGLE_OAUTH_CLIENT_ID = originalGoogleId;
  if (originalGoogleSecret === undefined)
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  else process.env.GOOGLE_OAUTH_CLIENT_SECRET = originalGoogleSecret;
  vi.restoreAllMocks();
});

describe("saveGoogleOAuth", () => {
  test("encrypts both tokens and inserts", async () => {
    const delQ = freshQuery();
    delQ.result = { data: null, error: null };
    const insQ = freshQuery();
    insQ.result = { data: null, error: null };

    const { saveGoogleOAuth } = await import("./persist");
    await saveGoogleOAuth({
      emailAddress: "jane@example.com",
      accessToken: "at-plain",
      refreshToken: "rt-plain",
      expiresIn: 3600,
      scope: "https://www.googleapis.com/auth/gmail.send",
    });

    expect(delQ.captured.op).toBe("delete");
    expect(insQ.captured.op).toBe("insert");
    const row = insQ.captured.payload as Record<string, unknown>;
    expect(row.email_address).toBe("jane@example.com");
    expect(row.scopes).toBe("https://www.googleapis.com/auth/gmail.send");
    // Ciphertext MUST NOT contain the plaintext substrings.
    expect(String(row.refresh_token_encrypted)).not.toContain("rt-plain");
    expect(String(row.access_token_encrypted)).not.toContain("at-plain");
    expect(typeof row.access_token_expires_at).toBe("string");
  });

  test("throws when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { saveGoogleOAuth } = await import("./persist");
    await expect(
      saveGoogleOAuth({
        emailAddress: "j",
        accessToken: "a",
        refreshToken: "r",
        expiresIn: 60,
        scope: "x",
      }),
    ).rejects.toThrow(/Supabase not configured/);
  });

  test("throws when TAY_OAUTH_SECRET missing", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    const { saveGoogleOAuth } = await import("./persist");
    await expect(
      saveGoogleOAuth({
        emailAddress: "j",
        accessToken: "a",
        refreshToken: "r",
        expiresIn: 60,
        scope: "x",
      }),
    ).rejects.toThrow(/TAY_OAUTH_SECRET/);
  });
});

describe("getGoogleOAuth", () => {
  test("decrypts and returns the record", async () => {
    // First, save so we get real ciphertexts.
    const { encryptToken } = await import("./crypto");
    const refresh_token_encrypted = encryptToken("rt-real");
    const access_token_encrypted = encryptToken("at-real");
    const expiresAt = new Date(Date.now() + 3600_000).toISOString();

    const q = freshQuery();
    q.result = {
      data: {
        email_address: "jane@example.com",
        refresh_token_encrypted,
        access_token_encrypted,
        access_token_expires_at: expiresAt,
        scopes: "https://www.googleapis.com/auth/gmail.send",
      },
      error: null,
    };

    const { getGoogleOAuth } = await import("./persist");
    const out = await getGoogleOAuth();
    expect(out).toMatchObject({
      emailAddress: "jane@example.com",
      accessToken: "at-real",
      refreshToken: "rt-real",
      expiresAt,
      scope: "https://www.googleapis.com/auth/gmail.send",
    });
  });

  test("returns null when no row", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { getGoogleOAuth } = await import("./persist");
    expect(await getGoogleOAuth()).toBeNull();
  });

  test("returns null when Supabase unwired", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { getGoogleOAuth } = await import("./persist");
    expect(await getGoogleOAuth()).toBeNull();
  });

  test("returns null when TAY_OAUTH_SECRET missing", async () => {
    delete process.env.TAY_OAUTH_SECRET;
    const { getGoogleOAuth } = await import("./persist");
    expect(await getGoogleOAuth()).toBeNull();
  });

  test("returns null when decryption fails", async () => {
    const q = freshQuery();
    q.result = {
      data: {
        email_address: "x",
        refresh_token_encrypted: "garbage-not-base64-decryptable!",
        access_token_encrypted: null,
        access_token_expires_at: null,
        scopes: "s",
      },
      error: null,
    };
    const { getGoogleOAuth } = await import("./persist");
    expect(await getGoogleOAuth()).toBeNull();
  });

  test("returns null on DB error", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "boom" } };
    const { getGoogleOAuth } = await import("./persist");
    expect(await getGoogleOAuth()).toBeNull();
  });
});

describe("ensureFreshAccessToken", () => {
  test("returns existing token when expiry > 60s out", async () => {
    const { encryptToken } = await import("./crypto");
    const q = freshQuery();
    q.result = {
      data: {
        email_address: "j",
        refresh_token_encrypted: encryptToken("rt"),
        access_token_encrypted: encryptToken("at-existing"),
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
        scopes: "s",
      },
      error: null,
    };

    const { ensureFreshAccessToken } = await import("./persist");
    const token = await ensureFreshAccessToken();
    expect(token).toBe("at-existing");
    expect(refreshAccessTokenMock).not.toHaveBeenCalled();
  });

  test("refreshes when expiry < 60s out", async () => {
    const { encryptToken } = await import("./crypto");
    const readQ = freshQuery();
    readQ.result = {
      data: {
        email_address: "j",
        refresh_token_encrypted: encryptToken("rt"),
        access_token_encrypted: encryptToken("at-old"),
        access_token_expires_at: new Date(Date.now() + 10_000).toISOString(),
        scopes: "s",
      },
      error: null,
    };
    const updateQ = freshQuery();
    updateQ.result = { data: null, error: null };
    refreshAccessTokenMock.mockResolvedValue({
      accessToken: "at-new",
      expiresIn: 3600,
    });

    const { ensureFreshAccessToken } = await import("./persist");
    const token = await ensureFreshAccessToken();
    expect(token).toBe("at-new");
    expect(refreshAccessTokenMock).toHaveBeenCalledOnce();
    expect(updateQ.captured.op).toBe("update");
  });

  test("throws when no OAuth row", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { ensureFreshAccessToken } = await import("./persist");
    await expect(ensureFreshAccessToken()).rejects.toThrow(
      /Gmail is not connected/,
    );
  });

  test("throws when GOOGLE_OAUTH_CLIENT_ID missing on refresh", async () => {
    const { encryptToken } = await import("./crypto");
    const q = freshQuery();
    q.result = {
      data: {
        email_address: "j",
        refresh_token_encrypted: encryptToken("rt"),
        access_token_encrypted: encryptToken("at-old"),
        access_token_expires_at: new Date(Date.now() + 10_000).toISOString(),
        scopes: "s",
      },
      error: null,
    };
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const { ensureFreshAccessToken } = await import("./persist");
    await expect(ensureFreshAccessToken()).rejects.toThrow(
      /GOOGLE_OAUTH_CLIENT_ID/,
    );
  });

  test("propagates refresh failure", async () => {
    const { encryptToken } = await import("./crypto");
    const q = freshQuery();
    q.result = {
      data: {
        email_address: "j",
        refresh_token_encrypted: encryptToken("rt"),
        access_token_encrypted: encryptToken("at-old"),
        access_token_expires_at: new Date(Date.now() - 10_000).toISOString(),
        scopes: "s",
      },
      error: null,
    };
    refreshAccessTokenMock.mockRejectedValue(new Error("HTTP 400"));
    const { ensureFreshAccessToken } = await import("./persist");
    await expect(ensureFreshAccessToken()).rejects.toThrow(/HTTP 400/);
  });
});

describe("deleteGoogleOAuth", () => {
  test("issues a delete", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { deleteGoogleOAuth } = await import("./persist");
    await deleteGoogleOAuth();
    expect(q.captured.op).toBe("delete");
  });

  test("throws when Supabase missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { deleteGoogleOAuth } = await import("./persist");
    await expect(deleteGoogleOAuth()).rejects.toThrow(/Supabase/);
  });

  test("throws on DB error", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "boom" } };
    const { deleteGoogleOAuth } = await import("./persist");
    await expect(deleteGoogleOAuth()).rejects.toThrow(/boom/);
  });
});
