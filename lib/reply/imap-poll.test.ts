// Tests for lib/reply/imap-poll.ts — Tay v1.1.2.5.
//
// We mock:
//   - lib/mailbox/persist::getMailboxCredentials
//   - lib/supabase/server  (programmable per-call queries; same shape as
//     lib/reply/poll.test.ts so the two test files stay isomorphic)
//   - ./handle::handleReply
//   - imapflow (the ImapFlow class)
//
// Coverage:
//   (a) no-credentials skip
//   (b) wrong-kind skip (oauth)
//   (c) first-poll-seeds-no-backfill (last_uid=0)
//   (d) subsequent poll fetches deltas + advances cursor
//   (e) handleReply per-message error doesn't crash the loop
//   (f) IMAP connect failure → friendly counts + imap_connect_failed
//   (g) auth failure → friendly counts + auth_failed
//   (h) log-probe asserts password never appears in any console.* call
//   (i) parseImapMessage extracts envelope + body + In-Reply-To

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// -- Mocks --------------------------------------------------------------
const getMailboxCredentialsMock = vi.fn();
vi.mock("../mailbox/persist", () => ({
  getMailboxCredentials: () => getMailboxCredentialsMock(),
}));

const handleReplyMock = vi.fn();
vi.mock("./handle", () => ({
  handleReply: (...a: unknown[]) => handleReplyMock(...a),
}));

type ChainResult = { data?: unknown; error?: { message: string } | null };
class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: { method: string; args: unknown[] }[] = [];
  select() { this.captured.push({ method: "select", args: [] }); return this; }
  insert(row: unknown) { this.captured.push({ method: "insert", args: [row] }); return this; }
  update(row: unknown) { this.captured.push({ method: "update", args: [row] }); return this; }
  upsert(row: unknown, opts?: unknown) {
    this.captured.push({ method: "upsert", args: [row, opts] });
    return this;
  }
  in() { this.captured.push({ method: "in", args: [] }); return this; }
  eq() { this.captured.push({ method: "eq", args: [] }); return this; }
  neq() { return this; }
  order() { return this; }
  limit() { return this; }
  async maybeSingle() { return this.result; }
  async single() { return this.result; }
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

// ImapFlow mock — instantiable + per-test-controllable.
type FetchedMsg = {
  uid: number;
  envelope?: {
    from?: Array<{ name?: string; address?: string }>;
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    date?: Date;
  };
  source?: Buffer;
};
type FakeMailbox = { uidNext: number; exists: number };
type FakeImapInstance = {
  connect: () => Promise<void>;
  logout: () => Promise<void>;
  close: () => void;
  mailboxOpen: (path: string) => Promise<FakeMailbox>;
  fetch: (
    range: unknown,
    query: unknown,
    options: unknown,
  ) => AsyncIterableIterator<FetchedMsg>;
};
const imapFactory = vi.fn();
class FakeImapFlow {
  options: unknown;
  // delegate to whatever the factory returns
  inner: FakeImapInstance;
  constructor(options: unknown) {
    this.options = options;
    this.inner = imapFactory(options);
  }
  connect() { return this.inner.connect(); }
  logout() { return this.inner.logout(); }
  close() { return this.inner.close(); }
  mailboxOpen(path: string) { return this.inner.mailboxOpen(path); }
  fetch(range: unknown, query: unknown, options: unknown) {
    return this.inner.fetch(range, query, options);
  }
}
vi.mock("imapflow", () => ({ ImapFlow: FakeImapFlow }));

const TEST_PASSWORD = "super-secret-app-password-xyz";
const TEST_EMAIL = "me@example.com";

function defaultCreds() {
  return {
    kind: "app_password" as const,
    emailAddress: TEST_EMAIL,
    password: TEST_PASSWORD,
    smtpHost: "smtp.gmail.com",
    smtpPort: 587,
    imapHost: "imap.gmail.com",
    imapPort: 993,
  };
}

function makeFakeImap({
  uidNext = 1,
  messages = [] as FetchedMsg[],
  connectError = null as unknown,
  mailboxOpenError = null as unknown,
}): FakeImapInstance {
  return {
    connect: connectError
      ? () => Promise.reject(connectError)
      : () => Promise.resolve(),
    logout: () => Promise.resolve(),
    close: () => {},
    mailboxOpen: mailboxOpenError
      ? () => Promise.reject(mailboxOpenError)
      : () => Promise.resolve({ uidNext, exists: 0 }),
    // eslint-disable-next-line @typescript-eslint/require-await
    fetch: async function* () {
      for (const m of messages) yield m;
    } as FakeImapInstance["fetch"],
  };
}

// Log-probe: collect every console.warn/log arg across the test so we
// can scan for password leakage.
const consoleArgs: unknown[][] = [];

beforeEach(() => {
  queries.length = 0;
  nextQueryIndex = 0;
  fromMock.mockClear();
  getMailboxCredentialsMock.mockReset();
  handleReplyMock.mockReset();
  imapFactory.mockReset();
  hasSupabaseEnvMock.mockReturnValue(true);
  consoleArgs.length = 0;
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => {
    consoleArgs.push(a);
  });
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
    consoleArgs.push(a);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("pollImapMailbox", () => {
  test("(a) skips with no_credentials when getMailboxCredentials returns null", async () => {
    getMailboxCredentialsMock.mockResolvedValue(null);
    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out).toEqual({
      processed: 0,
      skipped: 0,
      errors: 0,
      reason: "no_credentials",
    });
    expect(imapFactory).not.toHaveBeenCalled();
  });

  test("(b) skips with wrong_kind when credentials.kind === 'oauth'", async () => {
    getMailboxCredentialsMock.mockResolvedValue({
      kind: "oauth",
      emailAddress: TEST_EMAIL,
      refreshToken: "x",
      accessToken: "y",
      expiresAt: null,
      scopes: "",
    });
    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.reason).toBe("wrong_kind");
    expect(imapFactory).not.toHaveBeenCalled();
  });

  test("skips with no_supabase when env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.reason).toBe("no_supabase");
    expect(getMailboxCredentialsMock).not.toHaveBeenCalled();
  });

  test("(c) first poll (last_uid=0) seeds cursor from uidNext-1 with NO backfill", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    // cursor read returns { last_uid: 0 }
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_uid: 0 }, error: null };
    // seed upsert
    const seedUpsertQ = freshQuery();
    seedUpsertQ.result = { data: null, error: null };
    imapFactory.mockReturnValue(
      makeFakeImap({ uidNext: 42, messages: [] }),
    );

    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();

    expect(out).toEqual({ processed: 0, skipped: 0, errors: 0 });
    expect(handleReplyMock).not.toHaveBeenCalled();
    const upsertCall = seedUpsertQ.captured.find((c) => c.method === "upsert");
    expect(upsertCall?.args?.[0]).toMatchObject({
      last_uid: 41, // uidNext - 1
      lock_col: 1,
    });
    expect(upsertCall?.args?.[1]).toEqual({ onConflict: "lock_col" });
  });

  test("(c2) first poll on empty mailbox (uidNext=1) seeds last_uid=0 cleanly", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_uid: 0 }, error: null };
    const seedUpsertQ = freshQuery();
    seedUpsertQ.result = { data: null, error: null };
    imapFactory.mockReturnValue(makeFakeImap({ uidNext: 1, messages: [] }));

    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out).toEqual({ processed: 0, skipped: 0, errors: 0 });
    const upsertCall = seedUpsertQ.captured.find((c) => c.method === "upsert");
    // Max(0, 1-1) = 0
    expect(upsertCall?.args?.[0]).toMatchObject({ last_uid: 0 });
  });

  test("(d) subsequent poll: fetches UIDs > last_uid, calls handleReply, advances cursor", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_uid: 100 }, error: null };

    imapFactory.mockReturnValue(
      makeFakeImap({
        uidNext: 999,
        messages: [
          {
            uid: 101,
            envelope: {
              from: [{ name: "Alice", address: "alice@example.com" }],
              subject: "Re: hi",
              messageId: "<reply-1@example.com>",
              inReplyTo: "<sent-1@tay.local>",
              date: new Date("2026-05-17T10:00:00.000Z"),
            },
            source: Buffer.from(
              "From: Alice <alice@example.com>\r\n" +
                "Subject: Re: hi\r\n" +
                "Message-ID: <reply-1@example.com>\r\n" +
                "In-Reply-To: <sent-1@tay.local>\r\n" +
                "Content-Type: text/plain; charset=utf-8\r\n" +
                "\r\n" +
                "Thanks for reaching out!",
            ),
          },
          {
            uid: 102,
            envelope: {
              from: [{ name: "Bob", address: "bob@example.com" }],
              subject: "Re: hi 2",
              messageId: "<reply-2@example.com>",
              inReplyTo: "<sent-2@tay.local>",
              date: new Date("2026-05-17T11:00:00.000Z"),
            },
            source: Buffer.from(
              "From: Bob <bob@example.com>\r\n" +
                "Subject: Re: hi 2\r\n" +
                "Message-ID: <reply-2@example.com>\r\n" +
                "In-Reply-To: <sent-2@tay.local>\r\n" +
                "Content-Type: text/plain; charset=utf-8\r\n" +
                "\r\n" +
                "Sounds good.",
            ),
          },
        ],
      }),
    );
    handleReplyMock.mockResolvedValue({
      ok: true,
      intent: "interested",
      replyDrafted: false,
    });

    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.processed).toBe(2);
    expect(out.errors).toBe(0);
    expect(handleReplyMock).toHaveBeenCalledTimes(2);
    // Verify channel + inReplyToMessageId forwarded.
    const firstCall = handleReplyMock.mock.calls[0][0] as Record<string, unknown>;
    expect(firstCall.channel).toBe("app_password");
    expect(firstCall.inReplyToMessageId).toBe("<sent-1@tay.local>");
    expect(firstCall.gmailMessageId).toBe("<reply-1@example.com>");
    // Cursor advanced to highest UID seen.
    const advanceCall = advanceQ.captured.find((c) => c.method === "upsert");
    expect(advanceCall?.args?.[0]).toMatchObject({ last_uid: 102 });
  });

  test("(e) handleReply per-message error counts as error, NOT crash", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_uid: 50 }, error: null };
    imapFactory.mockReturnValue(
      makeFakeImap({
        uidNext: 100,
        messages: [
          {
            uid: 51,
            envelope: {
              from: [{ address: "alice@example.com" }],
              subject: "Re",
              messageId: "<r51@example.com>",
              inReplyTo: "<sent-x@tay.local>",
              date: new Date(),
            },
            source: Buffer.from(
              "Message-ID: <r51@example.com>\r\nFrom: alice@example.com\r\n\r\nbody",
            ),
          },
          {
            uid: 52,
            envelope: {
              from: [{ address: "bob@example.com" }],
              subject: "Re",
              messageId: "<r52@example.com>",
              inReplyTo: "<sent-y@tay.local>",
              date: new Date(),
            },
            source: Buffer.from(
              "Message-ID: <r52@example.com>\r\nFrom: bob@example.com\r\n\r\nbody",
            ),
          },
        ],
      }),
    );
    handleReplyMock
      .mockResolvedValueOnce({ ok: false, error: "boom" })
      .mockResolvedValueOnce({
        ok: true,
        intent: "interested",
        replyDrafted: false,
      });
    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.errors).toBe(1);
    expect(out.processed).toBe(1);
    // cursor still advanced past both
    const advanceCall = advanceQ.captured.find((c) => c.method === "upsert");
    expect(advanceCall?.args?.[0]).toMatchObject({ last_uid: 52 });
  });

  test("(f) IMAP connect failure → counts + imap_connect_failed reason", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    imapFactory.mockReturnValue(
      makeFakeImap({ connectError: new Error("ECONNREFUSED") }),
    );
    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.reason).toBe("imap_connect_failed");
    expect(out.errors).toBe(1);
    expect(handleReplyMock).not.toHaveBeenCalled();
  });

  test("(g) IMAP auth failure → counts + auth_failed reason", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    const authErr = Object.assign(new Error("auth failed"), {
      authenticationFailed: true,
    });
    imapFactory.mockReturnValue(makeFakeImap({ connectError: authErr }));
    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.reason).toBe("auth_failed");
    expect(out.errors).toBe(1);
  });

  test("(h) password never appears in console.warn/log args across any path", async () => {
    // Run the auth-failure path which is the most-likely to leak.
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    const authErr = Object.assign(new Error("auth failed"), {
      authenticationFailed: true,
      response: TEST_PASSWORD, // simulate hostile server echoing the password
    });
    imapFactory.mockReturnValue(makeFakeImap({ connectError: authErr }));
    const { pollImapMailbox } = await import("./imap-poll");
    await pollImapMailbox();
    // Scan every captured arg for the password substring.
    const stringified = JSON.stringify(consoleArgs);
    expect(stringified).not.toContain(TEST_PASSWORD);
  });

  test("self-email short-circuits (skips classifier, no handleReply)", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_uid: 10 }, error: null };
    imapFactory.mockReturnValue(
      makeFakeImap({
        uidNext: 100,
        messages: [
          {
            uid: 11,
            envelope: {
              from: [{ address: TEST_EMAIL }], // ← us
              subject: "self",
              messageId: "<self@example.com>",
              inReplyTo: "<orig@tay.local>",
              date: new Date(),
            },
            source: Buffer.from(
              `Message-ID: <self@example.com>\r\nFrom: ${TEST_EMAIL}\r\n\r\nb`,
            ),
          },
        ],
      }),
    );
    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.skipped).toBe(1);
    expect(handleReplyMock).not.toHaveBeenCalled();
  });

  test("messages with no Message-ID AND no In-Reply-To are skipped (not invocable)", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    const cursorReadQ = freshQuery();
    cursorReadQ.result = { data: { last_uid: 10 }, error: null };
    imapFactory.mockReturnValue(
      makeFakeImap({
        uidNext: 100,
        messages: [
          {
            uid: 11,
            envelope: {
              from: [{ address: "stranger@example.com" }],
              subject: "spam",
              // no messageId, no inReplyTo
              date: new Date(),
            },
            source: Buffer.from(
              "From: stranger@example.com\r\nSubject: spam\r\n\r\nhi",
            ),
          },
        ],
      }),
    );
    const advanceQ = freshQuery();
    advanceQ.result = { data: null, error: null };

    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.skipped).toBe(1);
    expect(handleReplyMock).not.toHaveBeenCalled();
  });

  test("cursor read error → counts as error, no fetch", async () => {
    getMailboxCredentialsMock.mockResolvedValue(defaultCreds());
    const cursorReadQ = freshQuery();
    cursorReadQ.result = {
      data: null,
      error: { message: "schema not ready" },
    };
    imapFactory.mockReturnValue(makeFakeImap({ uidNext: 1 }));
    const { pollImapMailbox } = await import("./imap-poll");
    const out = await pollImapMailbox();
    expect(out.errors).toBe(1);
    expect(handleReplyMock).not.toHaveBeenCalled();
  });
});

describe("parseImapMessage (header + body extraction)", () => {
  test("extracts from/subject/messageId/inReplyTo from envelope", async () => {
    const { parseImapMessage } = await import("./imap-poll");
    const parsed = parseImapMessage({
      envelope: {
        from: [{ name: "Alice", address: "alice@example.com" }],
        subject: "Re: hello",
        messageId: "<r@example.com>",
        inReplyTo: "<orig@tay.local>",
        date: new Date("2026-05-17T10:00:00.000Z"),
      },
      source: Buffer.from(
        "Content-Type: text/plain; charset=utf-8\r\n\r\nthanks",
      ),
    });
    expect(parsed.from).toBe("Alice <alice@example.com>");
    expect(parsed.subject).toBe("Re: hello");
    expect(parsed.messageId).toBe("<r@example.com>");
    expect(parsed.inReplyTo).toBe("<orig@tay.local>");
    expect(parsed.body).toBe("thanks");
  });

  test("falls back to References last entry when In-Reply-To is empty", async () => {
    const { parseImapMessage } = await import("./imap-poll");
    const parsed = parseImapMessage({
      envelope: {
        from: [{ address: "x@example.com" }],
        subject: "Re",
        messageId: "<r@example.com>",
        // no inReplyTo
        date: new Date(),
      },
      source: Buffer.from(
        "Message-ID: <r@example.com>\r\n" +
          "References: <a@x> <b@x> <c@x>\r\n" +
          "Content-Type: text/plain\r\n\r\nbody",
      ),
    });
    expect(parsed.inReplyTo).toBe("<c@x>");
    expect(parsed.references).toEqual(["<a@x>", "<b@x>", "<c@x>"]);
  });

  test("multipart/alternative → prefers text/plain part", async () => {
    const { parseImapMessage } = await import("./imap-poll");
    const src =
      "From: x@example.com\r\n" +
      "Content-Type: multipart/alternative; boundary=BNDRY\r\n" +
      "\r\n" +
      "--BNDRY\r\n" +
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "\r\n" +
      "PLAIN BODY HERE\r\n" +
      "--BNDRY\r\n" +
      "Content-Type: text/html; charset=utf-8\r\n" +
      "\r\n" +
      "<p>HTML BODY HERE</p>\r\n" +
      "--BNDRY--\r\n";
    const parsed = parseImapMessage({
      envelope: {
        from: [{ address: "x@example.com" }],
        messageId: "<m@x>",
        date: new Date(),
      },
      source: Buffer.from(src),
    });
    expect(parsed.body).toBe("PLAIN BODY HERE");
  });

  test("text/html-only → strips tags", async () => {
    const { parseImapMessage } = await import("./imap-poll");
    const src =
      "From: x@example.com\r\n" +
      "Content-Type: text/html; charset=utf-8\r\n" +
      "\r\n" +
      "<p>Hello <b>world</b></p>";
    const parsed = parseImapMessage({
      envelope: {
        from: [{ address: "x@example.com" }],
        messageId: "<m@x>",
        date: new Date(),
      },
      source: Buffer.from(src),
    });
    expect(parsed.body).toContain("Hello");
    expect(parsed.body).toContain("world");
    expect(parsed.body).not.toContain("<b>");
  });

  test("quoted-printable decoding", async () => {
    const { parseImapMessage } = await import("./imap-poll");
    const src =
      "Content-Type: text/plain; charset=utf-8\r\n" +
      "Content-Transfer-Encoding: quoted-printable\r\n" +
      "\r\n" +
      "Hello =3D world";
    const parsed = parseImapMessage({
      envelope: {
        from: [{ address: "x@example.com" }],
        messageId: "<m@x>",
        date: new Date(),
      },
      source: Buffer.from(src),
    });
    expect(parsed.body).toContain("Hello = world");
  });

  test("bare email (no name) renders without angle brackets", async () => {
    const { parseImapMessage } = await import("./imap-poll");
    const parsed = parseImapMessage({
      envelope: {
        from: [{ address: "x@example.com" }],
        messageId: "<m@x>",
        date: new Date(),
      },
      source: Buffer.from("\r\nbody"),
    });
    expect(parsed.from).toBe("x@example.com");
  });
});
