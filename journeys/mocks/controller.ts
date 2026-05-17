// Shared mock controller for JOURNEYS.
//
// Holds two stacks:
//   - LLM responses (programmed via pushLlmResponse; popped FIFO)
//   - Per-table+method query results (programmed via pushDbResult)
//
// Also captures:
//   - llmCalls(): what the code actually sent to the LLM
//   - dbWrites(): what the code actually wrote to "DB"
//   - audits(): what the code passed to appendAudit()
//   - trustEvents(): what the code passed to recordTrustEvent()
//
// Reset between scenarios via reset().

export type LlmCall = {
  model: string;
  temperature?: number;
  response_format?: unknown;
  system: string;
  user: string;
};

export type LlmResponseInput = string | Error;

export type DbResultMatcher = {
  table?: string;
  /**
   * Either a real query method (insert/upsert/maybeSingle/...) OR a
   * synthetic key like "isSuppressed" — used by `factories.ts` mocks
   * to gate on a per-call result without going through a real query
   * chain. Free-form string by design.
   */
  method?: string;
};

export type DbResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
};

export type DbWrite = {
  table: string;
  method: string;
  args: unknown[];
};

export type AuditEntry = {
  action: string;
  payload: Record<string, unknown>;
};

export type TrustEntry = {
  capability: string;
  eventType: string;
  metadata: Record<string, unknown>;
};

export class MockController {
  // -- LLM ----------------------------------------------------------------
  private llmResponses: LlmResponseInput[] = [];
  private _llmCalls: LlmCall[] = [];

  pushLlmResponse(r: LlmResponseInput): void {
    this.llmResponses.push(r);
  }

  pushLlmJson(obj: Record<string, unknown>): void {
    this.llmResponses.push(JSON.stringify(obj));
  }

  takeLlmResponse(): LlmResponseInput | undefined {
    return this.llmResponses.shift();
  }

  recordLlmCall(call: LlmCall): void {
    this._llmCalls.push(call);
  }

  llmCalls(): ReadonlyArray<LlmCall> {
    return this._llmCalls;
  }

  // -- DB queries ---------------------------------------------------------
  // Each match-with-results entry serves once per `pop`; matching is FIFO
  // within a table+method bucket. If multiple matchers fit a query, the
  // first programmed wins.
  private dbResults: Array<{ matcher: DbResultMatcher; result: DbResult }> = [];
  private _dbWrites: DbWrite[] = [];

  pushDbResult(matcher: DbResultMatcher, result: DbResult): void {
    this.dbResults.push({ matcher, result });
  }

  /**
   * Pop a result for a (table, method) query, FIFO. Returns null when no
   * matcher fits — the FakeQuery returns the default { data: null,
   * error: null } in that case (matches Supabase's "no row" semantics).
   */
  popDbResult(table: string, method: string): DbResult | null {
    for (let i = 0; i < this.dbResults.length; i++) {
      const m = this.dbResults[i].matcher;
      const tableMatch = !m.table || m.table === table;
      const methodMatch = !m.method || m.method === method;
      if (tableMatch && methodMatch) {
        const [entry] = this.dbResults.splice(i, 1);
        return entry.result;
      }
    }
    return null;
  }

  recordDbWrite(write: DbWrite): void {
    this._dbWrites.push(write);
  }

  dbWrites(): ReadonlyArray<DbWrite> {
    return this._dbWrites;
  }

  // -- Audits + trust events ---------------------------------------------
  private _audits: AuditEntry[] = [];
  private _trustEvents: TrustEntry[] = [];

  recordAudit(entry: AuditEntry): void {
    this._audits.push(entry);
  }

  audits(): ReadonlyArray<AuditEntry> {
    return this._audits;
  }

  recordTrustEvent(entry: TrustEntry): void {
    this._trustEvents.push(entry);
  }

  trustEvents(): ReadonlyArray<TrustEntry> {
    return this._trustEvents;
  }

  // -- Reset --------------------------------------------------------------
  reset(): void {
    this.llmResponses.length = 0;
    this._llmCalls.length = 0;
    this.dbResults.length = 0;
    this._dbWrites.length = 0;
    this._audits.length = 0;
    this._trustEvents.length = 0;
  }
}

// Singleton — vi.mock targets resolve against this one instance so
// scenarios can program it via `setup` and inspect via `assertions`.
export const mockController = new MockController();
