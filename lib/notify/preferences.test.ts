// Tests for lib/notify/preferences.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// -----------------------------------------------------------------------
// Supabase mock — FakeQuery pattern (same shape as lib/audit/append.test).
// -----------------------------------------------------------------------

type ChainResult = {
  data?: unknown;
  error?: { message: string } | null;
};

class FakeQuery {
  result: ChainResult = { data: null, error: null };
  capturedUpsert: unknown = null;
  select() {
    return this;
  }
  upsert(row: unknown) {
    this.capturedUpsert = row;
    return this;
  }
  eq() {
    return this;
  }
  async maybeSingle() {
    return this.result;
  }
  then<T1 = ChainResult, T2 = never>(
    onfulfilled?: ((v: ChainResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((r: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
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

// Mock crypto layer.
const encryptTokenMock = vi.fn<(p: string) => Promise<string>>(
  async (p) => `ENC(${p})`,
);
const decryptTokenMock = vi.fn<(c: string) => Promise<string>>(
  async (c) => c.replace(/^ENC\((.*)\)$/, "$1"),
);
const hasOAuthSecretMock = vi.fn<() => Promise<boolean>>(async () => true);
vi.mock("../oauth/crypto", () => ({
  encryptToken: (p: string) => encryptTokenMock(p),
  decryptToken: (c: string) => decryptTokenMock(c),
  hasOAuthSecret: () => hasOAuthSecretMock(),
}));

beforeEach(() => {
  queries.length = 0;
  nextQueryIndex = 0;
  fromMock.mockClear();
  hasSupabaseEnvMock.mockReturnValue(true);
  encryptTokenMock.mockClear();
  decryptTokenMock.mockClear();
  hasOAuthSecretMock.mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID_WEBHOOK =
  "https://hooks.slack.com/services/T0001/B0002/abcdefghij1234567890";

describe("isValidSlackWebhookUrl", () => {
  test("accepts canonical Slack webhook URL", async () => {
    const { isValidSlackWebhookUrl } = await import("./preferences");
    expect(isValidSlackWebhookUrl(VALID_WEBHOOK)).toBe(true);
  });

  test("rejects http (non-https)", async () => {
    const { isValidSlackWebhookUrl } = await import("./preferences");
    expect(
      isValidSlackWebhookUrl(VALID_WEBHOOK.replace("https://", "http://")),
    ).toBe(false);
  });

  test("rejects wrong host", async () => {
    const { isValidSlackWebhookUrl } = await import("./preferences");
    expect(
      isValidSlackWebhookUrl(
        "https://attacker.example.com/services/T1/B2/x".padEnd(60, "x"),
      ),
    ).toBe(false);
  });

  test("rejects missing /services prefix", async () => {
    const { isValidSlackWebhookUrl } = await import("./preferences");
    expect(
      isValidSlackWebhookUrl("https://hooks.slack.com/foo/T1/B2/x"),
    ).toBe(false);
  });

  test("rejects truncated path (only 1 segment after /services/)", async () => {
    const { isValidSlackWebhookUrl } = await import("./preferences");
    expect(
      isValidSlackWebhookUrl("https://hooks.slack.com/services/T1"),
    ).toBe(false);
  });

  test("rejects empty and malformed strings", async () => {
    const { isValidSlackWebhookUrl } = await import("./preferences");
    expect(isValidSlackWebhookUrl("")).toBe(false);
    expect(isValidSlackWebhookUrl("not-a-url")).toBe(false);
  });
});

describe("getPreferences — defaults", () => {
  test("returns defaults when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { getPreferences, DEFAULT_PREFERENCES } = await import("./preferences");
    const out = await getPreferences();
    expect(out).toEqual(DEFAULT_PREFERENCES);
    expect(out.channel).toBe("email");
    expect(out.enabledForIntents.length).toBeGreaterThan(0);
  });

  test("returns defaults when row is empty (first-visit)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { getPreferences, DEFAULT_PREFERENCES } = await import("./preferences");
    const out = await getPreferences();
    expect(out).toEqual(DEFAULT_PREFERENCES);
  });

  test("returns defaults when read errors", async () => {
    const q = freshQuery();
    q.result = { data: null, error: { message: "DB down" } };
    const { getPreferences, DEFAULT_PREFERENCES } = await import("./preferences");
    const out = await getPreferences();
    expect(out).toEqual(DEFAULT_PREFERENCES);
  });
});

describe("getPreferences — round trip", () => {
  test("loads email channel + email_override + custom intents", async () => {
    const q = freshQuery();
    q.result = {
      data: {
        channel: "email",
        slack_webhook_url_encrypted: null,
        email_override: "alt@example.com",
        enabled_for_intents: "interested,unsubscribe_request",
      },
      error: null,
    };
    const { getPreferences } = await import("./preferences");
    const out = await getPreferences();
    expect(out.channel).toBe("email");
    expect(out.emailOverride).toBe("alt@example.com");
    expect(out.enabledForIntents).toEqual(["interested", "unsubscribe_request"]);
    expect(out.slackWebhookUrl).toBeUndefined();
  });

  test("decrypts Slack webhook URL when channel === slack_webhook", async () => {
    const q = freshQuery();
    q.result = {
      data: {
        channel: "slack_webhook",
        slack_webhook_url_encrypted: `ENC(${VALID_WEBHOOK})`,
        email_override: null,
        enabled_for_intents: "interested",
      },
      error: null,
    };
    const { getPreferences } = await import("./preferences");
    const out = await getPreferences();
    expect(out.channel).toBe("slack_webhook");
    expect(out.slackWebhookUrl).toBe(VALID_WEBHOOK);
    expect(decryptTokenMock).toHaveBeenCalledWith(`ENC(${VALID_WEBHOOK})`);
  });

  test("falls back to defaults when webhook decrypt fails", async () => {
    const q = freshQuery();
    q.result = {
      data: {
        channel: "slack_webhook",
        slack_webhook_url_encrypted: "BAD-CIPHERTEXT",
        email_override: null,
        enabled_for_intents: "interested",
      },
      error: null,
    };
    decryptTokenMock.mockRejectedValueOnce(new Error("auth tag mismatch"));
    const { getPreferences, DEFAULT_PREFERENCES } = await import("./preferences");
    const out = await getPreferences();
    expect(out).toEqual(DEFAULT_PREFERENCES);
  });

  test("falls back to defaults when crypto secret is unreachable", async () => {
    const q = freshQuery();
    q.result = {
      data: {
        channel: "slack_webhook",
        slack_webhook_url_encrypted: `ENC(${VALID_WEBHOOK})`,
        email_override: null,
        enabled_for_intents: "interested",
      },
      error: null,
    };
    hasOAuthSecretMock.mockResolvedValueOnce(false);
    const { getPreferences, DEFAULT_PREFERENCES } = await import("./preferences");
    const out = await getPreferences();
    expect(out).toEqual(DEFAULT_PREFERENCES);
  });

  test("malformed intents list resolves to all-intents default", async () => {
    const q = freshQuery();
    q.result = {
      data: {
        channel: "email",
        slack_webhook_url_encrypted: null,
        email_override: null,
        enabled_for_intents: "garbage,not_a_real_intent,,,",
      },
      error: null,
    };
    const { getPreferences, DEFAULT_PREFERENCES } = await import("./preferences");
    const out = await getPreferences();
    expect(out.enabledForIntents).toEqual(DEFAULT_PREFERENCES.enabledForIntents);
  });

  test("intents list de-dupes while preserving order", async () => {
    const q = freshQuery();
    q.result = {
      data: {
        channel: "email",
        slack_webhook_url_encrypted: null,
        email_override: null,
        enabled_for_intents: "interested,interested,not_interested",
      },
      error: null,
    };
    const { getPreferences } = await import("./preferences");
    const out = await getPreferences();
    expect(out.enabledForIntents).toEqual(["interested", "not_interested"]);
  });
});

describe("setPreferences", () => {
  test("throws when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { setPreferences } = await import("./preferences");
    await expect(
      setPreferences({ channel: "none", enabledForIntents: [] }),
    ).rejects.toThrow(/Supabase not configured/);
  });

  test("email channel: upserts without encrypting (no webhook)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { setPreferences } = await import("./preferences");
    await setPreferences({
      channel: "email",
      emailOverride: "alt@example.com",
      enabledForIntents: ["interested", "unsubscribe_request"],
    });
    expect(encryptTokenMock).not.toHaveBeenCalled();
    expect(q.capturedUpsert).toMatchObject({
      lock_col: 1,
      channel: "email",
      slack_webhook_url_encrypted: null,
      email_override: "alt@example.com",
      enabled_for_intents: "interested,unsubscribe_request",
    });
  });

  test("slack_webhook channel: encrypts webhook URL", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { setPreferences } = await import("./preferences");
    await setPreferences({
      channel: "slack_webhook",
      slackWebhookUrl: VALID_WEBHOOK,
      enabledForIntents: ["interested"],
    });
    expect(encryptTokenMock).toHaveBeenCalledWith(VALID_WEBHOOK);
    expect(q.capturedUpsert).toMatchObject({
      channel: "slack_webhook",
      slack_webhook_url_encrypted: `ENC(${VALID_WEBHOOK})`,
    });
  });

  test("slack_webhook channel: throws on invalid webhook URL", async () => {
    const { setPreferences } = await import("./preferences");
    await expect(
      setPreferences({
        channel: "slack_webhook",
        slackWebhookUrl: "https://attacker.example.com/x",
        enabledForIntents: ["interested"],
      }),
    ).rejects.toThrow(/hooks\.slack\.com/);
  });

  test("throws on invalid email_override", async () => {
    const { setPreferences } = await import("./preferences");
    await expect(
      setPreferences({
        channel: "email",
        emailOverride: "no-at-sign",
        enabledForIntents: ["interested"],
      }),
    ).rejects.toThrow(/email/i);
  });

  test("filters unknown intents on write (defense in depth)", async () => {
    const q = freshQuery();
    q.result = { data: null, error: null };
    const { setPreferences } = await import("./preferences");
    await setPreferences({
      channel: "email",
      enabledForIntents: [
        "interested",
        // @ts-expect-error — intentionally invalid for test
        "no_such_intent",
      ],
    });
    expect(q.capturedUpsert).toMatchObject({
      enabled_for_intents: "interested",
    });
  });
});
