// Tests for lib/trust/tier.ts.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// --- mock collaborators -------------------------------------------------
const appendAuditMock = vi.fn<(a: unknown) => Promise<void>>(async () => {});
vi.mock("../audit/append", () => ({
  appendAudit: (a: unknown) => appendAuditMock(a),
}));

const recordTrustEventMock = vi.fn<(...a: unknown[]) => Promise<void>>(
  async () => {},
);
vi.mock("./record", async () => {
  const actual = await vi.importActual<typeof import("./record")>("./record");
  return {
    ...actual,
    recordTrustEvent: (...a: unknown[]) => recordTrustEventMock(...a),
  };
});

// --- supabase fake ------------------------------------------------------
type ChainResult = { data?: unknown; error?: { message: string } | null };
class FakeQuery {
  result: ChainResult = { data: null, error: null };
  captured: { method: string; args: unknown[] }[] = [];
  table = "";
  select() { this.captured.push({ method: "select", args: [] }); return this; }
  insert(row: unknown) { this.captured.push({ method: "insert", args: [row] }); return this; }
  upsert(row: unknown, opts?: unknown) {
    this.captured.push({ method: "upsert", args: [row, opts] });
    return this;
  }
  update(row: unknown) { this.captured.push({ method: "update", args: [row] }); return this; }
  eq() { return this; }
  limit() { return this; }
  order() { return this; }
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
function freshQuery(table = ""): FakeQuery {
  const q = new FakeQuery();
  q.table = table;
  queries.push(q);
  return q;
}
const fromMock = vi.fn((t: string) => {
  if (nextQueryIndex < queries.length) {
    const q = queries[nextQueryIndex++];
    q.table = t;
    return q;
  }
  return freshQuery(t);
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
  appendAuditMock.mockClear();
  recordTrustEventMock.mockClear();
  hasSupabaseEnvMock.mockReturnValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("bucketCounts (pure)", () => {
  test("buckets each event_type", async () => {
    const { bucketCounts } = await import("./tier");
    const counts = bucketCounts([
      { event_type: "sent", occurred_at: "2026-05-17T00:00:00Z" },
      { event_type: "sent", occurred_at: "2026-05-17T00:00:00Z" },
      { event_type: "bounced", occurred_at: "2026-05-17T00:00:00Z" },
      { event_type: "replied_negative", occurred_at: "2026-05-17T00:00:00Z" },
      { event_type: "replied_positive", occurred_at: "2026-05-17T00:00:00Z" },
      { event_type: "blocked_by_judge", occurred_at: "2026-05-17T00:00:00Z" },
    ]);
    expect(counts.sent).toBe(2);
    expect(counts.bounced).toBe(1);
    expect(counts.replied_negative).toBe(1);
    expect(counts.replied_positive).toBe(1);
    expect(counts.blocked_by_judge).toBe(1);
  });

  test("recent_incidents only counts events in the last 30 days", async () => {
    const { bucketCounts } = await import("./tier");
    const ancient = "1990-01-01T00:00:00Z";
    const recent = new Date().toISOString();
    const counts = bucketCounts([
      { event_type: "bounced", occurred_at: ancient },
      { event_type: "bounced", occurred_at: recent },
      { event_type: "replied_negative", occurred_at: recent },
    ]);
    expect(counts.bounced).toBe(2);
    expect(counts.recent_incidents).toBe(2);
  });
});

describe("computeTierFromCounts (pure)", () => {
  test("send: 25 clean → tier_1", async () => {
    const { computeTierFromCounts } = await import("./tier");
    expect(
      computeTierFromCounts(
        "send",
        {
          sent: 25,
          bounced: 0,
          complained: 0,
          replied_negative: 0,
          replied_positive: 5,
          blocked_by_judge: 0,
          blocked_by_suppression: 0,
          recent_incidents: 0,
        },
        "tier_0",
      ),
    ).toBe("tier_1");
  });

  test("send: 24 clean → tier_0 (one short)", async () => {
    const { computeTierFromCounts } = await import("./tier");
    expect(
      computeTierFromCounts(
        "send",
        {
          sent: 24,
          bounced: 0,
          complained: 0,
          replied_negative: 0,
          replied_positive: 0,
          blocked_by_judge: 0,
          blocked_by_suppression: 0,
          recent_incidents: 0,
        },
        "tier_0",
      ),
    ).toBe("tier_0");
  });

  test("send: 25 clean + 1 incident → tier_0 (maxIncidents=0 strict)", async () => {
    const { computeTierFromCounts } = await import("./tier");
    expect(
      computeTierFromCounts(
        "send",
        {
          sent: 25,
          bounced: 1,
          complained: 0,
          replied_negative: 0,
          replied_positive: 0,
          blocked_by_judge: 0,
          blocked_by_suppression: 0,
          recent_incidents: 0,
        },
        "tier_0",
      ),
    ).toBe("tier_0");
  });

  test("send: 250 clean + 2 incidents → tier_2", async () => {
    const { computeTierFromCounts } = await import("./tier");
    expect(
      computeTierFromCounts(
        "send",
        {
          sent: 250,
          bounced: 1,
          complained: 0,
          replied_negative: 1,
          replied_positive: 50,
          blocked_by_judge: 0,
          blocked_by_suppression: 0,
          recent_incidents: 0,
        },
        "tier_1",
      ),
    ).toBe("tier_2");
  });

  test("send: 1000 clean cannot auto-promote past tier_2", async () => {
    const { computeTierFromCounts } = await import("./tier");
    expect(
      computeTierFromCounts(
        "send",
        {
          sent: 5000,
          bounced: 0,
          complained: 0,
          replied_negative: 0,
          replied_positive: 100,
          blocked_by_judge: 0,
          blocked_by_suppression: 0,
          recent_incidents: 0,
        },
        "tier_2",
      ),
    ).toBe("tier_2");
  });

  test("demotion: 5+ recent incidents demote one step", async () => {
    const { computeTierFromCounts } = await import("./tier");
    expect(
      computeTierFromCounts(
        "send",
        {
          sent: 300,
          bounced: 3,
          complained: 1,
          replied_negative: 2,
          replied_positive: 0,
          blocked_by_judge: 0,
          blocked_by_suppression: 0,
          recent_incidents: 6,
        },
        "tier_2",
      ),
    ).toBe("tier_1");
  });

  test("transient threshold drift does NOT silently demote", async () => {
    // previous tier was tier_2; counts no longer support tier_2 (e.g. a
    // backfilled dataset) but recent_incidents is fine. We should
    // preserve tier_2.
    const { computeTierFromCounts } = await import("./tier");
    expect(
      computeTierFromCounts(
        "send",
        {
          sent: 30,
          bounced: 0,
          complained: 0,
          replied_negative: 0,
          replied_positive: 0,
          blocked_by_judge: 0,
          blocked_by_suppression: 0,
          recent_incidents: 0,
        },
        "tier_2",
      ),
    ).toBe("tier_2");
  });

  test("reply_send thresholds (10 → tier_1)", async () => {
    const { computeTierFromCounts } = await import("./tier");
    expect(
      computeTierFromCounts(
        "reply_send",
        {
          sent: 10,
          bounced: 0,
          complained: 0,
          replied_negative: 0,
          replied_positive: 0,
          blocked_by_judge: 0,
          blocked_by_suppression: 0,
          recent_incidents: 0,
        },
        "tier_0",
      ),
    ).toBe("tier_1");
  });
});

describe("getTrustTier", () => {
  test("soft-fails to tier_0 when Supabase env missing", async () => {
    hasSupabaseEnvMock.mockReturnValue(false);
    const { getTrustTier } = await import("./tier");
    expect(await getTrustTier("send")).toBe("tier_0");
  });

  test("returns cached tier from row", async () => {
    const q = freshQuery("trust_tiers");
    q.result = { data: { tier: "tier_1" }, error: null };
    const { getTrustTier } = await import("./tier");
    expect(await getTrustTier("send")).toBe("tier_1");
  });

  test("soft-fails to tier_0 on row read error", async () => {
    const q = freshQuery("trust_tiers");
    q.result = { data: null, error: { message: "boom" } };
    const { getTrustTier } = await import("./tier");
    expect(await getTrustTier("send")).toBe("tier_0");
  });
});

describe("recomputeTrustTier", () => {
  test("manual_override blocks recompute, returns previousTier == newTier", async () => {
    const rowQ = freshQuery("trust_tiers");
    rowQ.result = {
      data: {
        capability: "send",
        tier: "tier_1",
        promoted_at: null,
        manual_override: true,
        updated_at: "2026-05-17T00:00:00Z",
      },
      error: null,
    };
    const eventsQ = freshQuery("trust_events");
    eventsQ.result = { data: [], error: null };
    const { recomputeTrustTier } = await import("./tier");
    const r = await recomputeTrustTier("send");
    expect(r.manualOverride).toBe(true);
    expect(r.newTier).toBe("tier_1");
    expect(r.promoted).toBe(false);
    expect(appendAuditMock).not.toHaveBeenCalled();
  });

  test("promotes tier_0 → tier_1 on 25 clean sends; writes audit + trust event", async () => {
    const rowQ = freshQuery("trust_tiers");
    rowQ.result = {
      data: null, // first compute, no cached row
      error: null,
    };
    const eventsQ = freshQuery("trust_events");
    eventsQ.result = {
      data: Array.from({ length: 30 }, () => ({
        event_type: "sent",
        occurred_at: new Date().toISOString(),
      })),
      error: null,
    };
    const upsertQ = freshQuery("trust_tiers");
    upsertQ.result = { data: null, error: null };

    const { recomputeTrustTier } = await import("./tier");
    const r = await recomputeTrustTier("send");
    expect(r.previousTier).toBe("tier_0");
    expect(r.newTier).toBe("tier_1");
    expect(r.promoted).toBe(true);
    expect(r.counts.sent).toBe(30);
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "trust.tier_changed" }),
    );
    const auditPayload = (appendAuditMock.mock.calls[0][0] as {
      payload: Record<string, unknown>;
    }).payload;
    expect(auditPayload).toMatchObject({
      capability: "send",
      from: "tier_0",
      to: "tier_1",
      promoted: true,
    });
    expect(recordTrustEventMock).toHaveBeenCalled();
  });

  test("no-op when newTier equals previousTier (touch upsert only)", async () => {
    const rowQ = freshQuery("trust_tiers");
    rowQ.result = {
      data: {
        capability: "send",
        tier: "tier_0",
        promoted_at: null,
        manual_override: false,
        updated_at: "2026-05-17T00:00:00Z",
      },
      error: null,
    };
    const eventsQ = freshQuery("trust_events");
    eventsQ.result = { data: [], error: null }; // no sends
    const touchQ = freshQuery("trust_tiers");
    touchQ.result = { data: null, error: null };

    const { recomputeTrustTier } = await import("./tier");
    const r = await recomputeTrustTier("send");
    expect(r.newTier).toBe("tier_0");
    expect(r.previousTier).toBe("tier_0");
    expect(r.promoted).toBe(false);
    expect(r.demoted).toBe(false);
    expect(appendAuditMock).not.toHaveBeenCalled();
    expect(recordTrustEventMock).not.toHaveBeenCalled();
  });
});

describe("setManualOverride", () => {
  test("upserts row with manual_override=true and audits", async () => {
    const rowQ = freshQuery("trust_tiers");
    rowQ.result = {
      data: {
        capability: "send",
        tier: "tier_1",
        promoted_at: null,
        manual_override: false,
        updated_at: "2026-05-17T00:00:00Z",
      },
      error: null,
    };
    const upsQ = freshQuery("trust_tiers");
    upsQ.result = { data: null, error: null };
    const { setManualOverride } = await import("./tier");
    await setManualOverride({
      capability: "send",
      manualOverride: true,
      tier: "tier_3",
    });
    const upsCall = upsQ.captured.find((c) => c.method === "upsert");
    expect(upsCall?.args?.[0]).toMatchObject({
      capability: "send",
      tier: "tier_3",
      manual_override: true,
    });
    expect(appendAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "trust.manual_override_set" }),
    );
  });
});
