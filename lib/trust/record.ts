// Trust-tier events — Tay gate I.
//
// v0.7: writes events to the `trust_events` table. v1.0 wires the
// tier-promotion logic (read recent events, compute capability tier,
// gate Tier-3 actions).
//
// READ-VS-WRITE: BEST-EFFORT WRITE — same contract as appendAudit.
// Never throws. A trust-event write failure must NOT block the user's
// send path. If we lose a trust event, the tier-promotion math is
// fractionally less accurate; we'd rather lose precision than block
// real-world sends on transient DB failures.
//
// EVERY Tier-3 action completion (send, reply_send, book) MUST call
// this on success AND on failure paths (blocked_by_judge,
// blocked_by_suppression, override_to_*, bounced, complained,
// replied_*). The orchestrator wires the success path for v0.7.

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";

export type TrustCapability = "send" | "reply_send" | "book";

export type TrustEventType =
  | "sent"
  | "blocked_by_judge"
  | "blocked_by_suppression"
  | "override_to_send"
  | "override_to_skip"
  | "bounced"
  | "complained"
  | "replied_positive"
  | "replied_negative";

const TABLE = "trust_events";

export async function recordTrustEvent(
  capability: TrustCapability,
  eventType: TrustEventType,
  metadata: Record<string, unknown>,
): Promise<void> {
  try {
    if (!hasSupabaseEnv()) {
      console.log(
        `[trust] skipped — no Supabase (capability=${capability} type=${eventType})`,
      );
      return;
    }
    const supabase = getSupabaseServerClient();
    const ins = await supabase.from(TABLE).insert({
      capability,
      event_type: eventType,
      metadata,
    });
    if (ins.error) {
      console.warn("[trust] write failed:", ins.error.message);
    }
  } catch (err) {
    console.warn(
      "[trust] write failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
