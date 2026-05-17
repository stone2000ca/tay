// Mock factories — pure functions returning module shapes that the
// `index.test.ts` vi.mock calls return. Kept here (vs inline in
// index.test.ts) to keep that file readable.
//
// Wiring goes:
//   index.test.ts → vi.mock("openai", () => makeOpenAiMock())
//                 → vi.mock("@/lib/supabase/server", () => makeSupabaseMock())
//                 ...
// Each factory closes over `mockController` so journeys can program it
// indirectly via setup().

import { mockController } from "./controller";

// -- openai SDK ---------------------------------------------------------
export function makeOpenAiMock(): Record<string, unknown> {
  class FakeOpenAI {
    chat = {
      completions: {
        create: async (req: {
          model: string;
          temperature?: number;
          response_format?: unknown;
          messages: Array<{ role: string; content: string }>;
        }) => {
          const system =
            req.messages.find((m) => m.role === "system")?.content ?? "";
          const user =
            req.messages.find((m) => m.role === "user")?.content ?? "";
          mockController.recordLlmCall({
            model: req.model,
            temperature: req.temperature,
            response_format: req.response_format,
            system,
            user,
          });
          const next = mockController.takeLlmResponse();
          if (next === undefined) {
            throw new Error(
              `[journeys/openai-mock] no LLM response programmed for model=${req.model}`,
            );
          }
          if (next instanceof Error) {
            throw next;
          }
          return { choices: [{ message: { content: next } }] };
        },
      },
    };
    constructor(_opts: unknown) {
      /* noop */
    }
  }
  class AuthenticationError extends Error {}
  class RateLimitError extends Error {}
  class APIConnectionError extends Error {}
  return {
    default: FakeOpenAI,
    AuthenticationError,
    RateLimitError,
    APIConnectionError,
  };
}

// -- supabase server ----------------------------------------------------
class FakeChain {
  private table: string;
  private opChain: string[] = [];
  private lastWriteRow: unknown = undefined;
  private lastWriteOpts: unknown = undefined;
  private lastWriteOp: string = "";

  constructor(table: string) {
    this.table = table;
  }

  private capture(op: string, args: unknown[] = []) {
    this.opChain.push(op);
    mockController.recordDbWrite({ table: this.table, method: op, args });
  }

  select(_cols?: string) {
    this.capture("select", [_cols ?? "*"]);
    return this;
  }
  insert(row: unknown) {
    this.lastWriteOp = "insert";
    this.lastWriteRow = row;
    this.capture("insert", [row]);
    return this;
  }
  update(row: unknown) {
    this.lastWriteOp = "update";
    this.lastWriteRow = row;
    this.capture("update", [row]);
    return this;
  }
  upsert(row: unknown, opts?: unknown) {
    this.lastWriteOp = "upsert";
    this.lastWriteRow = row;
    this.lastWriteOpts = opts;
    this.capture("upsert", [row, opts]);
    return this;
  }
  delete() {
    this.lastWriteOp = "delete";
    this.capture("delete", []);
    return this;
  }
  eq() {
    return this;
  }
  neq() {
    return this;
  }
  in() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  async maybeSingle() {
    const r = mockController.popDbResult(this.table, "maybeSingle");
    return r ?? { data: null, error: null };
  }
  async single() {
    const r = mockController.popDbResult(this.table, "single");
    return r ?? { data: null, error: null };
  }
  then<T1 = unknown, T2 = never>(
    onfulfilled?:
      | ((value: { data?: unknown; error?: { message: string } | null }) => T1 | PromiseLike<T1>)
      | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    // For non-terminating chains (insert/update/upsert without .select),
    // pop a result keyed on the write op. If none programmed, default to
    // "success, no data".
    const op = this.lastWriteOp || this.opChain[this.opChain.length - 1] || "";
    const r =
      mockController.popDbResult(this.table, op) ?? { data: null, error: null };
    void this.lastWriteRow;
    void this.lastWriteOpts;
    return Promise.resolve(r).then(
      onfulfilled as (v: { data?: unknown; error?: { message: string } | null }) => T1,
      onrejected as (r: unknown) => T2,
    );
  }
}

export function makeSupabaseMock(): Record<string, unknown> {
  return {
    getSupabaseServerClient: () => ({
      from: (table: string) => new FakeChain(table),
    }),
    hasSupabaseEnv: () => true,
  };
}

// -- audit append -------------------------------------------------------
// We mock the appendAudit module so scenarios can inspect the audit
// trail without needing the underlying hash chain to actually work
// against the FakeChain. Hash-chain correctness is exercised in the
// audit-chain-integrity journey via the REAL appendAudit (which is
// covered by lib/audit/append.test.ts + verify.test.ts already).
export function makeAuditMock(): Record<string, unknown> {
  return {
    appendAudit: async (event: {
      action: string;
      payload: Record<string, unknown>;
    }) => {
      mockController.recordAudit(event);
    },
    redactPayload: (p: Record<string, unknown>) => p,
  };
}

// -- trust record -------------------------------------------------------
export function makeTrustRecordMock(): Record<string, unknown> {
  return {
    recordTrustEvent: async (
      capability: string,
      eventType: string,
      metadata: Record<string, unknown>,
    ) => {
      mockController.recordTrustEvent({ capability, eventType, metadata });
    },
  };
}

// -- suppression check / add -------------------------------------------
// Scenarios that want to control suppression state push a result into
// the controller (see send-to-suppressed-prospect journey).
export function makeSuppressionCheckMock(): Record<string, unknown> {
  return {
    isSuppressed: async (email: string) => {
      // Stack a per-call boolean via mockController.dbResults keyed on
      // table "suppression" + method "isSuppressed". Scenarios push via
      // pushDbResult({ table: "suppression", method: "isSuppressed" }, ...).
      const r = mockController.popDbResult("suppression", "isSuppressed");
      const v = r?.data;
      return Boolean(v ?? false);
    },
  };
}

// -- voice rubric -------------------------------------------------------
export function makeVoiceCalibrateMock(rubric: unknown): Record<string, unknown> {
  return {
    getRubric: async () => rubric,
  };
}

// -- send orchestrator collaborators -----------------------------------
//
// The send-to-suppressed-prospect journey exercises the REAL
// `lib/send/orchestrate.ts:sendDraft` to verify the gate-E suppression
// short-circuit. That requires stubs for every collaborator the
// orchestrator pulls in. Scenarios that don't touch sendDraft can ignore
// these — the journey is the only caller that programs them.
//
// All stubs are pop-from-controller so the same singleton controller
// stays the source of programmed truth across scenarios.

// app-config — always returns a valid AppConfig so the precondition passes.
export function makeAppConfigMock(): Record<string, unknown> {
  return {
    getAppConfig: async () => ({
      name: "Tay",
      validatedAt: "2026-05-17T00:00:00.000Z",
    }),
  };
}

// voice/calibrate — always returns a fixture rubric so the precondition
// passes. Tests that want a missing rubric should mock at scenario level
// (none currently do; voice rubric is exercised in rubric-drift-formality
// via the drafter LLM, not via getRubric).
export function makeVoiceCalibrateModuleMock(): Record<string, unknown> {
  return {
    getRubric: async () => ({
      opener_style: "personalized first-name + observation",
      avg_sentence_length_words: 14,
      formality: "casual",
      signature_pattern: "First name only",
      common_phrases: [],
      avoid_phrases: [],
      tone_notes: "",
    }),
  };
}

// judge/persist — returns the most recent decision the scenario pushed
// via mockController.pushDbResult({ table: "judge_decisions", method: "getLatestDecisionForDraft" }, ...).
// Defaults to a clean "allow" so suppression/oauth/gmail gates are the
// ones exercised (rather than the orchestrator short-circuiting on judge).
export function makeJudgePersistMock(): Record<string, unknown> {
  return {
    getLatestDecisionForDraft: async (draftId: string) => {
      void draftId;
      const r = mockController.popDbResult(
        "judge_decisions",
        "getLatestDecisionForDraft",
      );
      if (r && r.data !== undefined) return r.data;
      return { decision: "allow", reasons: ["ok"] };
    },
  };
}

// oauth/persist — fakes ensureFreshAccessToken. By default returns a
// dummy token; scenarios can pushDbResult({ table: "oauth", method: "ensureFreshAccessToken" }, { data: <token-string-or-error> })
// to override. Throws on `error` to mirror the real contract.
export function makeOAuthPersistMock(): Record<string, unknown> {
  return {
    ensureFreshAccessToken: async () => {
      const r = mockController.popDbResult("oauth", "ensureFreshAccessToken");
      if (r?.error) {
        throw new Error(r.error.message);
      }
      return (r?.data as string | undefined) ?? "fake-access-token";
    },
  };
}

// send/gmail — captures every call and pops a programmed result. If no
// result programmed, returns a default success — but scenarios that
// expect Gmail to NEVER be called (e.g. suppression) can assert via
// mockController.sendEmailCalls().length === 0.
export function makeGmailSendMock(): Record<string, unknown> {
  return {
    sendEmail: async (args: {
      accessToken: string;
      to: string;
      subject: string;
      body: string;
    }) => {
      mockController.recordSendEmailCall({
        to: args.to,
        subject: args.subject,
        body: args.body,
        accessToken: args.accessToken,
      });
      const programmed = mockController.takeSendEmailResult();
      return (
        programmed ?? {
          ok: true,
          gmailMessageId: "gm-fake-1",
          gmailThreadId: "gt-fake-1",
        }
      );
    },
  };
}

// send/smtp — v1.1.2 second channel. Mirrors gmail mock; tracks via the
// same sendEmailCalls() so gate-E (suppression) assertions are
// channel-agnostic. SMTP path returns { ok: true, messageId, threadId? }
// (no threadId — orchestrator handles undefined → "").
export function makeSmtpSendMock(): Record<string, unknown> {
  return {
    sendEmailViaSmtp: async (input: {
      host: string;
      port: number;
      username: string;
      password: string;
      fromAddress: string;
      to: string;
      subject: string;
      body: string;
    }) => {
      mockController.recordSendEmailCall({
        to: input.to,
        subject: input.subject,
        body: input.body,
      });
      const programmed = mockController.takeSendEmailResult();
      if (programmed && programmed.ok) {
        return {
          ok: true,
          messageId: programmed.gmailMessageId,
          threadId: programmed.gmailThreadId || undefined,
        };
      }
      if (programmed && !programmed.ok) {
        return { ok: false, error: programmed.error };
      }
      return {
        ok: true,
        messageId: "<smtp-fake-1@example.com>",
        threadId: undefined,
      };
    },
  };
}

// mailbox/persist — defaults to a connected oauth mailbox (matches
// the v0.7-style happy-path the journeys were originally written
// against). Scenarios that want SMTP mode can pushDbResult({ table:
// "mailbox", method: "getMailboxCredentials" }, { data: <creds>, ... })
// to override.
export function makeMailboxPersistMock(): Record<string, unknown> {
  return {
    getMailboxCredentials: async () => {
      const r = mockController.popDbResult("mailbox", "getMailboxCredentials");
      if (r && r.data !== undefined) return r.data;
      return {
        kind: "oauth",
        emailAddress: "tay-tester@example.com",
        refreshToken: "rt-fake",
        accessToken: "at-fake",
        expiresAt: new Date(Date.now() + 3600_000).toISOString(),
        scopes: "gmail.send gmail.readonly",
      };
    },
    getMailboxKind: async () => {
      const r = mockController.popDbResult("mailbox", "getMailboxKind");
      if (r && r.data !== undefined) return r.data;
      return "oauth";
    },
    saveMailboxCredentials: async () => {},
    clearMailboxCredentials: async () => {},
  };
}
