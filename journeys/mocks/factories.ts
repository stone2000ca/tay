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
