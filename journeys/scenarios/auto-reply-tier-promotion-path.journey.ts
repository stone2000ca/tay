// JOURNEY — gate I: trust-tier promotion path.
//
// Seed 30 `sent` events + 0 incidents for the `send` capability.
// recomputeTrustTier MUST transition tier_0 → tier_1 and write an audit
// row "trust.tier_changed".

import type { Journey, JourneyResult } from "../types";
import { recomputeTrustTier } from "../../lib/trust/tier";

export const journey: Journey = {
  name: "auto-reply tier promotion path",
  gate: "I",
  description:
    "30 sent / 0 incidents → tier_0 → tier_1; audit row trust.tier_changed written.",
  setup: async (mc) => {
    // First read: trust_tiers row for `send` — none (first compute).
    mc.pushDbResult(
      { table: "trust_tiers", method: "maybeSingle" },
      { data: null, error: null },
    );
    // Second read: trust_events list — 30 sent events.
    mc.pushDbResult(
      { table: "trust_events" },
      {
        data: Array.from({ length: 30 }, (_, i) => ({
          event_type: "sent",
          occurred_at: `2026-05-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`,
        })),
        error: null,
      },
    );
    // Third write: trust_tiers upsert succeeds.
    mc.pushDbResult(
      { table: "trust_tiers", method: "upsert" },
      { data: null, error: null },
    );
  },
  run: async (): Promise<JourneyResult> => {
    const result = await recomputeTrustTier("send");
    return {
      kind: "ok",
      data: {
        previous: result.previousTier,
        next: result.newTier,
        promoted: result.promoted,
      },
    };
  },
  assertions: (result, mc) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got: ${(result as { message: string }).message}`);
    }
    if (result.data?.previous !== "tier_0") {
      throw new Error(`expected previous=tier_0, got ${result.data?.previous}`);
    }
    if (result.data?.next !== "tier_1") {
      throw new Error(`expected next=tier_1, got ${result.data?.next}`);
    }
    if (result.data?.promoted !== true) {
      throw new Error(`expected promoted=true, got ${result.data?.promoted}`);
    }
    const audits = mc.audits();
    if (!audits.some((a) => a.action === "trust.tier_changed")) {
      throw new Error(
        `expected audit action 'trust.tier_changed', got ${audits.map((a) => a.action).join(",")}`,
      );
    }
  },
};
