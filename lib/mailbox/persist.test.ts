// Tests for lib/mailbox/persist.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const hasSupabaseEnvMock = vi.fn(() => true);
const hasOAuthSecretMock = vi.fn(async () => true);
const encryptTokenMock = vi.fn(async (s: string) => `enc(${s})`);
const decryptTokenMock = vi.fn(async (s: string) =>
  s.startsWith("enc(") ? s.slice(4, -1) : "DECRYPT_OK",
);
const getGoogleOAuthMock = vi.fn();

vi.mock("../oauth/crypto", () => ({
  hasOAuthSecret: () => hasOAuthSecretMock(),
  encryptToken: (s: string) => encryptTokenMock(s),
  decryptToken: (s: string) => decryptTokenMock(s),
}));

vi.mock("../oauth/persist", () => ({
  getGoogleOAuth: () => getGoogleOAuthMock(),
}));

// Fake Supabase chain — supports .from(table).select().eq().maybeSingle(),
// .from(table).upsert(row, opts), .from(table).delete().eq() / .neq().
type Result = { data?: unknown; error?: { message: string } | null };

class FakeChain {
  result: Result = { data: null, error: null };
  captured: { op?: string; payload?: unknown; opts?: unknown } = {};
  select() {
    return this;
  }
  upsert(row: unknown, opts?: unknown) {
    this.captured = { op: "upsert", payload: row, opts };
    return Promise.resolve(this.result);
  }
  insert(row: unknown) {
    this.captured = { op: "insert", payload: row };
    return Promise.resolve(this.result);
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
  async maybeSingle() {
    return this.result;
  }
  then<T>(
    onfulfilled?: (v: Result) => T | PromiseLike<T>,
    onrejected?: (e: unknown) => T | PromiseLike<T>,
  ): Promise<T> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

const tableQueues: Record<string, FakeChain[]> = {};
function enqueue(table: string, result: Result): FakeChain {
  const c = new FakeChain();
  c.result = result;
  (tableQueues[table] ??= []).push(c);
  return c;
}
const fromMock = vi.fn((table: string) => {
  const queue = tableQueues[table];
  if (queue && queue.length > 0) return queue.shift() as FakeChain;
  return new FakeChain();
});

vi.mock("../supabase/server", () => ({
  hasSupabaseEnv: () => hasSupabaseEnvMock(),
  getSupabaseServerClient: () => ({ from: fromMock }),
}));

beforeEach(() => {
  for (const k of Object.keys(tableQueues)) delete tableQueues[k];
  fromMock.mockClear();
  hasSupabaseEnvMock.mockReset().mockReturnValue(true);
  hasOAuthSecretMock.mockReset().mockResolvedValue(true);
  encryptTokenMock.mockReset().mockImplementation(async (s: string) => `enc(${s})`);
  decryptTokenMock
    .mockReset()
    .mockImplementation(async (s: string) =>
      s.startsWith("enc(") ? s.slice(4, -1) : "DECRYPT_OK",
    );
  getGoogleOAuthMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("saveMailboxCredentials — oauth kind", () => {
  test("encrypts tokens, upserts on lock_col=1, NULLs SMTP columns", async () => {
    const cap = enqueue("mailbox_credentials", { data: null, error: null });
    const { saveMailboxCredentials } = await import("./persist");
    await saveMailboxCredentials({
      kind: "oauth",
      emailAddress: "alice@example.com",
      refreshToken: "rt",
      accessToken: "at",
      expiresAt: "2026-05-17T12:00:00Z",
      scopes: "gmail.send gmail.readonly",
    });
    expect(cap.captured.op).toBe("upsert");
    expect(cap.captured.opts).toEqual({ onConflict: "lock_col" });
    const payload = cap.captured.payload as Record<string, unknown>;
    expect(payload.lock_col).toBe(1);
    expect(payload.kind).toBe("oauth");
    expect(payload.email_address).toBe("alice@example.com");
    expect(payload.oauth_refresh_token_encrypted).toBe("enc(rt)");
    expect(payload.oauth_access_token_encrypted).toBe("enc(at)");
    expect(payload.smtp_password_encrypted).toBeNull();
    expect(payload.smtp_host).toBeNull();
  });
});

describe("saveMailboxCredentials — app_password kind", () => {
  test("encrypts password, NULLs OAuth columns, writes host/port", async () => {
    const cap = enqueue("mailbox_credentials", { data: null, error: null });
    const { saveMailboxCredentials } = await import("./persist");
    await saveMailboxCredentials({
      kind: "app_password",
      emailAddress: "alice@gmail.com",
      password: "appp-pass",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      imapHost: "imap.gmail.com",
      imapPort: 993,
    });
    const payload = cap.captured.payload as Record<string, unknown>;
    expect(payload.kind).toBe("app_password");
    expect(payload.smtp_password_encrypted).toBe("enc(appp-pass)");
    expect(payload.smtp_host).toBe("smtp.gmail.com");
    expect(payload.smtp_port).toBe(587);
    expect(payload.imap_host).toBe("imap.gmail.com");
    expect(payload.imap_port).toBe(993);
    expect(payload.oauth_refresh_token_encrypted).toBeNull();
    expect(payload.oauth_access_token_encrypted).toBeNull();
  });

  test("throws if Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { saveMailboxCredentials } = await import("./persist");
    await expect(
      saveMailboxCredentials({
        kind: "app_password",
        emailAddress: "a@b.c",
        password: "p",
        smtpHost: "h",
        smtpPort: 1,
        imapHost: "i",
        imapPort: 2,
      }),
    ).rejects.toThrow(/Supabase/);
  });

  test("throws if oauth secret unavailable", async () => {
    hasOAuthSecretMock.mockResolvedValue(false);
    const { saveMailboxCredentials } = await import("./persist");
    await expect(
      saveMailboxCredentials({
        kind: "app_password",
        emailAddress: "a@b.c",
        password: "p",
        smtpHost: "h",
        smtpPort: 1,
        imapHost: "i",
        imapPort: 2,
      }),
    ).rejects.toThrow(/encryption secret/i);
  });

  test("throws if DB upsert errors", async () => {
    enqueue("mailbox_credentials", {
      data: null,
      error: { message: "row-level-security" },
    });
    const { saveMailboxCredentials } = await import("./persist");
    await expect(
      saveMailboxCredentials({
        kind: "app_password",
        emailAddress: "a@b.c",
        password: "p",
        smtpHost: "h",
        smtpPort: 1,
        imapHost: "i",
        imapPort: 2,
      }),
    ).rejects.toThrow(/upsert failed/);
  });
});

describe("getMailboxCredentials — new table read", () => {
  test("returns app_password row decrypted", async () => {
    enqueue("mailbox_credentials", {
      data: {
        kind: "app_password",
        email_address: "alice@gmail.com",
        oauth_refresh_token_encrypted: null,
        oauth_access_token_encrypted: null,
        oauth_access_token_expires_at: null,
        oauth_scopes: null,
        smtp_password_encrypted: "enc(secret-pw)",
        smtp_host: "smtp.gmail.com",
        smtp_port: 587,
        imap_host: "imap.gmail.com",
        imap_port: 993,
      },
      error: null,
    });
    const { getMailboxCredentials } = await import("./persist");
    const out = await getMailboxCredentials();
    expect(out).toEqual({
      kind: "app_password",
      emailAddress: "alice@gmail.com",
      password: "secret-pw",
      smtpHost: "smtp.gmail.com",
      smtpPort: 587,
      imapHost: "imap.gmail.com",
      imapPort: 993,
    });
  });

  test("returns oauth row decrypted", async () => {
    enqueue("mailbox_credentials", {
      data: {
        kind: "oauth",
        email_address: "alice@gmail.com",
        oauth_refresh_token_encrypted: "enc(rt)",
        oauth_access_token_encrypted: "enc(at)",
        oauth_access_token_expires_at: "2026-05-17T12:00:00Z",
        oauth_scopes: "gmail.send",
        smtp_password_encrypted: null,
        smtp_host: null,
        smtp_port: null,
        imap_host: null,
        imap_port: null,
      },
      error: null,
    });
    const { getMailboxCredentials } = await import("./persist");
    const out = await getMailboxCredentials();
    expect(out).toEqual({
      kind: "oauth",
      emailAddress: "alice@gmail.com",
      refreshToken: "rt",
      accessToken: "at",
      expiresAt: "2026-05-17T12:00:00Z",
      scopes: "gmail.send",
    });
  });

  test("returns null when decrypt fails", async () => {
    enqueue("mailbox_credentials", {
      data: {
        kind: "app_password",
        email_address: "alice@gmail.com",
        smtp_password_encrypted: "enc(secret-pw)",
        smtp_host: "smtp.gmail.com",
        smtp_port: 587,
        imap_host: "imap.gmail.com",
        imap_port: 993,
      },
      error: null,
    });
    decryptTokenMock.mockRejectedValueOnce(new Error("bad tag"));
    const { getMailboxCredentials } = await import("./persist");
    const out = await getMailboxCredentials();
    expect(out).toBeNull();
  });
});

describe("getMailboxCredentials — backwards-compat fallback", () => {
  test("returns legacy google_oauth row as kind=oauth when new table is empty", async () => {
    enqueue("mailbox_credentials", { data: null, error: null });
    getGoogleOAuthMock.mockResolvedValue({
      emailAddress: "legacy@gmail.com",
      refreshToken: "rt-legacy",
      accessToken: "at-legacy",
      expiresAt: "2026-05-17T11:00:00Z",
      scope: "gmail.send gmail.readonly",
    });
    const { getMailboxCredentials } = await import("./persist");
    const out = await getMailboxCredentials();
    expect(out).toEqual({
      kind: "oauth",
      emailAddress: "legacy@gmail.com",
      refreshToken: "rt-legacy",
      accessToken: "at-legacy",
      expiresAt: "2026-05-17T11:00:00Z",
      scopes: "gmail.send gmail.readonly",
    });
  });

  test("returns null when BOTH new table and legacy table are empty", async () => {
    enqueue("mailbox_credentials", { data: null, error: null });
    getGoogleOAuthMock.mockResolvedValue(null);
    const { getMailboxCredentials } = await import("./persist");
    const out = await getMailboxCredentials();
    expect(out).toBeNull();
  });

  test("returns null when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { getMailboxCredentials } = await import("./persist");
    const out = await getMailboxCredentials();
    expect(out).toBeNull();
  });

  test("returns null when oauth secret unavailable", async () => {
    hasOAuthSecretMock.mockResolvedValue(false);
    const { getMailboxCredentials } = await import("./persist");
    const out = await getMailboxCredentials();
    expect(out).toBeNull();
  });
});

describe("getMailboxKind", () => {
  test("returns 'app_password' for SMTP install", async () => {
    enqueue("mailbox_credentials", {
      data: {
        kind: "app_password",
        email_address: "a@b.c",
        smtp_password_encrypted: "enc(p)",
        smtp_host: "h",
        smtp_port: 1,
        imap_host: "i",
        imap_port: 2,
      },
      error: null,
    });
    const { getMailboxKind } = await import("./persist");
    expect(await getMailboxKind()).toBe("app_password");
  });

  test("returns 'oauth' for legacy install", async () => {
    enqueue("mailbox_credentials", { data: null, error: null });
    getGoogleOAuthMock.mockResolvedValue({
      emailAddress: "a@b.c",
      refreshToken: "rt",
      accessToken: "at",
      expiresAt: null,
      scope: "gmail.send",
    });
    const { getMailboxKind } = await import("./persist");
    expect(await getMailboxKind()).toBe("oauth");
  });

  test("returns null when not connected", async () => {
    enqueue("mailbox_credentials", { data: null, error: null });
    getGoogleOAuthMock.mockResolvedValue(null);
    const { getMailboxKind } = await import("./persist");
    expect(await getMailboxKind()).toBeNull();
  });
});

describe("clearMailboxCredentials", () => {
  test("deletes from both new and legacy tables", async () => {
    const newCap = enqueue("mailbox_credentials", { data: null, error: null });
    const legacyCap = enqueue("google_oauth", { data: null, error: null });
    const { clearMailboxCredentials } = await import("./persist");
    await clearMailboxCredentials();
    expect(newCap.captured.op).toBe("delete");
    expect(legacyCap.captured.op).toBe("delete");
  });

  test("throws if Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { clearMailboxCredentials } = await import("./persist");
    await expect(clearMailboxCredentials()).rejects.toThrow(/Supabase/);
  });

  test("throws on new-table delete error", async () => {
    enqueue("mailbox_credentials", {
      data: null,
      error: { message: "boom" },
    });
    const { clearMailboxCredentials } = await import("./persist");
    await expect(clearMailboxCredentials()).rejects.toThrow(/delete \(new\)/);
  });

  test("legacy delete failure is non-fatal", async () => {
    enqueue("mailbox_credentials", { data: null, error: null });
    enqueue("google_oauth", { data: null, error: { message: "legacy boom" } });
    const { clearMailboxCredentials } = await import("./persist");
    // No throw expected.
    await clearMailboxCredentials();
  });
});
