// Trust-tier promotion — Tay gate I (v1.0).
//
// Reads `trust_events` (recordTrustEvent writes them) and computes a
// per-capability tier. Cached in `trust_tiers` (one row per capability)
// so the read path is cheap (single-row PK lookup).
//
// TIER SEMANTICS:
//   tier_0 — always human-approved (default; queue requires explicit click)
//   tier_1 — auto on judge-allow (no per-send human approval needed)
//   tier_2 — auto with retroactive audit only (rare; long history of clean sends)
//   tier_3 — autonomous (reserved; not auto-promoted — manual only)
//
// Auto-promotion stops at tier_2. tier_3 is manual-only (toggle via the
// `manual_override` column on /settings/trust).
//
// Demotion: if 5+ incidents in the last 30 days → demote one tier on the
// next recompute. This is the brand-safety floor; recovering from a bad
// run requires regaining count clean sends.
//
// THRESHOLDS (documented in TIER_THRESHOLDS below):
//   - send: 25 clean → tier_1; 250 clean / ≤2 incidents → tier_2
//   - reply_send: 10 clean → tier_1; 100 clean / ≤1 incident → tier_2
//   - book: not active in v0.x; thresholds shipped but unused
//
// READ-VS-WRITE error contract:
//   - getTrustTier — READ; soft-fails to tier_0 (safest default).
//   - recomputeTrustTier — WRITE (audit + trust_events row); throws on
//     unrecoverable DB errors. Caller (server action) translates to a
//     friendly redirect.

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";
import { appendAudit } from "../audit/append";
import { recordTrustEvent, type TrustCapability } from "./record";

export type TrustTier = "tier_0" | "tier_1" | "tier_2" | "tier_3";

const TABLE = "trust_tiers";
const EVENTS_TABLE = "trust_events";

/**
 * Promotion thresholds per capability. Documented inline.
 *
 * `incidents` = bounced + complained + replied_negative (summed).
 */
export const TIER_THRESHOLDS: Record<
  TrustCapability,
  {
    tier_0_to_1: { minSent: number; maxIncidents: number };
    tier_1_to_2: { minSent: number; maxIncidents: number };
    tier_2_to_3: { minSent: number; maxIncidents: number } | null;
  }
> = {
  send: {
    tier_0_to_1: { minSent: 25, maxIncidents: 0 },
    tier_1_to_2: { minSent: 250, maxIncidents: 2 },
    // tier_3 is reserved — not auto-promoted. Documented for posterity.
    tier_2_to_3: null,
  },
  reply_send: {
    tier_0_to_1: { minSent: 10, maxIncidents: 0 },
    tier_1_to_2: { minSent: 100, maxIncidents: 1 },
    tier_2_to_3: null,
  },
  book: {
    // v1.0+ — not active in v0.x. Thresholds shipped so the surface
    // exists; no caller emits `book` trust events yet.
    tier_0_to_1: { minSent: 5, maxIncidents: 0 },
    tier_1_to_2: { minSent: 50, maxIncidents: 1 },
    tier_2_to_3: null,
  },
};

/** Demotion threshold — N incidents in the last 30 days. */
export const DEMOTION_INCIDENT_WINDOW_DAYS = 30;
export const DEMOTION_INCIDENT_THRESHOLD = 5;

export type TrustCounts = {
  sent: number;
  bounced: number;
  complained: number;
  replied_negative: number;
  replied_positive: number;
  blocked_by_judge: number;
  blocked_by_suppression: number;
  recent_incidents: number;
};

export type RecomputeResult = {
  capability: TrustCapability;
  previousTier: TrustTier;
  newTier: TrustTier;
  counts: TrustCounts;
  /** True if the tier strictly increased. */
  promoted: boolean;
  /** True if the tier strictly decreased. */
  demoted: boolean;
  /** True if manual_override is set — recompute is a no-op. */
  manualOverride: boolean;
};

export type TrustTierRow = {
  capability: TrustCapability;
  tier: TrustTier;
  promotedAt: string | null;
  manualOverride: boolean;
  updatedAt: string;
};

/**
 * Read the cached tier for a capability. Soft-fails to tier_0 (safest
 * default — keeps the human in the loop when state is uncertain).
 *
 * If the cache row is missing, returns tier_0. Callers wanting fresh
 * state call `recomputeTrustTier` explicitly.
 *
 * READ.
 */
export async function getTrustTier(
  capability: TrustCapability,
): Promise<TrustTier> {
  if (!hasSupabaseEnv()) return "tier_0";
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("tier")
      .eq("capability", capability)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[trust/tier] read failed:", error.message);
      return "tier_0";
    }
    if (!data) return "tier_0";
    const row = data as { tier: TrustTier };
    return isTier(row.tier) ? row.tier : "tier_0";
  } catch (err) {
    console.warn(
      "[trust/tier] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return "tier_0";
  }
}

/**
 * Read the full row (including manual_override + promoted_at) for the
 * /settings/trust UI. Soft-fails to a default row.
 *
 * READ.
 */
export async function getTrustTierRow(
  capability: TrustCapability,
): Promise<TrustTierRow> {
  const fallback: TrustTierRow = {
    capability,
    tier: "tier_0",
    promotedAt: null,
    manualOverride: false,
    updatedAt: new Date(0).toISOString(),
  };
  if (!hasSupabaseEnv()) return fallback;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("capability, tier, promoted_at, manual_override, updated_at")
      .eq("capability", capability)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[trust/tier] row read failed:", error.message);
      return fallback;
    }
    if (!data) return fallback;
    const row = data as {
      capability: TrustCapability;
      tier: TrustTier;
      promoted_at: string | null;
      manual_override: boolean;
      updated_at: string;
    };
    return {
      capability: row.capability,
      tier: isTier(row.tier) ? row.tier : "tier_0",
      promotedAt: row.promoted_at,
      manualOverride: Boolean(row.manual_override),
      updatedAt: row.updated_at,
    };
  } catch (err) {
    console.warn(
      "[trust/tier] row unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return fallback;
  }
}

/**
 * Read trust_events for a capability and bucket the counts.
 *
 * READ.
 */
export async function readTrustCounts(
  capability: TrustCapability,
): Promise<TrustCounts> {
  const empty: TrustCounts = {
    sent: 0,
    bounced: 0,
    complained: 0,
    replied_negative: 0,
    replied_positive: 0,
    blocked_by_judge: 0,
    blocked_by_suppression: 0,
    recent_incidents: 0,
  };
  if (!hasSupabaseEnv()) return empty;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(EVENTS_TABLE)
      .select("event_type, occurred_at")
      .eq("capability", capability);
    if (error) {
      console.warn("[trust/tier] counts read failed:", error.message);
      return empty;
    }
    const rows = (data ?? []) as Array<{
      event_type: string;
      occurred_at: string;
    }>;
    return bucketCounts(rows);
  } catch (err) {
    console.warn(
      "[trust/tier] counts unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return empty;
  }
}

/**
 * Pure helper — bucket trust_event rows into a counts shape.
 * Exported for testability.
 */
export function bucketCounts(
  rows: Array<{ event_type: string; occurred_at: string }>,
): TrustCounts {
  const counts: TrustCounts = {
    sent: 0,
    bounced: 0,
    complained: 0,
    replied_negative: 0,
    replied_positive: 0,
    blocked_by_judge: 0,
    blocked_by_suppression: 0,
    recent_incidents: 0,
  };
  const now = Date.now();
  const windowMs =
    DEMOTION_INCIDENT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  for (const row of rows) {
    switch (row.event_type) {
      case "sent":
        counts.sent++;
        break;
      case "bounced":
        counts.bounced++;
        if (isRecent(row.occurred_at, now, windowMs)) counts.recent_incidents++;
        break;
      case "complained":
        counts.complained++;
        if (isRecent(row.occurred_at, now, windowMs)) counts.recent_incidents++;
        break;
      case "replied_negative":
        counts.replied_negative++;
        if (isRecent(row.occurred_at, now, windowMs)) counts.recent_incidents++;
        break;
      case "replied_positive":
        counts.replied_positive++;
        break;
      case "blocked_by_judge":
        counts.blocked_by_judge++;
        break;
      case "blocked_by_suppression":
        counts.blocked_by_suppression++;
        break;
    }
  }
  return counts;
}

function isRecent(iso: string, nowMs: number, windowMs: number): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return nowMs - t <= windowMs;
}

/**
 * Pure helper — compute the tier from counts and the previous tier.
 * Exported for testability.
 *
 * Promotion (forward, monotone):
 *   - tier_0 → tier_1 when sent ≥ T.tier_0_to_1.minSent AND
 *     totalIncidents ≤ maxIncidents
 *   - tier_1 → tier_2 when sent ≥ T.tier_1_to_2.minSent AND
 *     totalIncidents ≤ maxIncidents
 *   - tier_2 → tier_3 only via manual override (auto stops at tier_2)
 *
 * Demotion: if recent_incidents ≥ DEMOTION_INCIDENT_THRESHOLD, drop one
 * tier from the previous tier (floor at tier_0).
 *
 * Manual override: caller checks `manual_override` and skips compute.
 */
export function computeTierFromCounts(
  capability: TrustCapability,
  counts: TrustCounts,
  previousTier: TrustTier,
): TrustTier {
  const thresholds = TIER_THRESHOLDS[capability];
  const totalIncidents =
    counts.bounced + counts.complained + counts.replied_negative;

  // Demotion gate first — overrides the upward path.
  if (counts.recent_incidents >= DEMOTION_INCIDENT_THRESHOLD) {
    return demoteOne(previousTier);
  }

  // Upward path. Strictly monotone — we never promote past tier_2 from
  // counts alone; tier_3 requires manual override.
  let target: TrustTier = "tier_0";
  if (
    counts.sent >= thresholds.tier_0_to_1.minSent &&
    totalIncidents <= thresholds.tier_0_to_1.maxIncidents
  ) {
    target = "tier_1";
  }
  if (
    counts.sent >= thresholds.tier_1_to_2.minSent &&
    totalIncidents <= thresholds.tier_1_to_2.maxIncidents
  ) {
    target = "tier_2";
  }
  // tier_2_to_3 intentionally not honored — manual-only.

  // If previous tier was higher than what counts now justify (and we
  // didn't hit demotion gate), preserve previous — don't silently demote
  // on transient threshold drift. Demotion only happens via the recent-
  // incidents gate.
  if (tierIndex(previousTier) > tierIndex(target)) return previousTier;
  return target;
}

function tierIndex(t: TrustTier): number {
  switch (t) {
    case "tier_0":
      return 0;
    case "tier_1":
      return 1;
    case "tier_2":
      return 2;
    case "tier_3":
      return 3;
  }
}

function demoteOne(t: TrustTier): TrustTier {
  switch (t) {
    case "tier_3":
      return "tier_2";
    case "tier_2":
      return "tier_1";
    case "tier_1":
      return "tier_0";
    case "tier_0":
      return "tier_0";
  }
}

function isTier(value: unknown): value is TrustTier {
  return (
    value === "tier_0" ||
    value === "tier_1" ||
    value === "tier_2" ||
    value === "tier_3"
  );
}

/**
 * Recompute the tier for a capability, persist if changed, audit on
 * change, and record a trust event on promotion/demotion.
 *
 * WRITE — throws on unrecoverable DB error. The server action wrapping
 * this translates to a redirect with ?error=.
 *
 * Manual-override behavior: if the cached row has `manual_override =
 * true`, we read counts but DO NOT change the tier. The returned
 * `newTier` equals `previousTier` and `manualOverride` is set so the UI
 * can surface "this is a manual setting; recompute is a no-op".
 */
export async function recomputeTrustTier(
  capability: TrustCapability,
): Promise<RecomputeResult> {
  const current = await getTrustTierRow(capability);
  const counts = await readTrustCounts(capability);

  if (current.manualOverride) {
    return {
      capability,
      previousTier: current.tier,
      newTier: current.tier,
      counts,
      promoted: false,
      demoted: false,
      manualOverride: true,
    };
  }

  const newTier = computeTierFromCounts(capability, counts, current.tier);

  if (newTier === current.tier) {
    // Touch the row anyway so updated_at reflects the recompute click
    // (best-effort; failures are warning-only). The /settings/trust UI
    // surfaces the timestamp so users can see "yes, I just recomputed".
    if (hasSupabaseEnv()) {
      try {
        const supabase = getSupabaseServerClient();
        await supabase.from(TABLE).upsert(
          {
            capability,
            tier: newTier,
            promoted_at: current.promotedAt,
            manual_override: false,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "capability" },
        );
      } catch (err) {
        console.warn(
          "[trust/tier] touch upsert failed:",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return {
      capability,
      previousTier: current.tier,
      newTier,
      counts,
      promoted: false,
      demoted: false,
      manualOverride: false,
    };
  }

  const promoted = tierIndex(newTier) > tierIndex(current.tier);
  const demoted = tierIndex(newTier) < tierIndex(current.tier);

  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Cannot persist trust-tier change.",
    );
  }

  const supabase = getSupabaseServerClient();
  const upsertPayload: Record<string, unknown> = {
    capability,
    tier: newTier,
    manual_override: false,
    updated_at: new Date().toISOString(),
  };
  if (promoted) {
    upsertPayload.promoted_at = new Date().toISOString();
  } else {
    // Demotion preserves the prior promoted_at — useful debugging signal.
    upsertPayload.promoted_at = current.promotedAt;
  }
  const ups = await supabase
    .from(TABLE)
    .upsert(upsertPayload, { onConflict: "capability" });
  if (ups.error) {
    throw new Error(`[trust/tier] upsert failed: ${ups.error.message}`);
  }

  // Audit the change (best-effort; appendAudit never throws).
  await appendAudit({
    action: "trust.tier_changed",
    payload: {
      capability,
      from: current.tier,
      to: newTier,
      promoted,
      demoted,
      // Counts are operational metadata; safe to include — no PII.
      counts,
    },
  });

  // Record an explicit trust event for the change (so the chain itself
  // is observable to future recomputes — promotion noise is a signal).
  await recordTrustEvent(capability, promoted ? "override_to_send" : "override_to_skip", {
    kind: "tier_change",
    from: current.tier,
    to: newTier,
  });

  return {
    capability,
    previousTier: current.tier,
    newTier,
    counts,
    promoted,
    demoted,
    manualOverride: false,
  };
}

/**
 * Toggle the manual_override flag for a capability. When ON, recompute
 * becomes a no-op and the cached tier is used as-is. Useful for either
 * pinning a capability at tier_0 (extra cautious user) or pinning at
 * tier_3 (operator vouched-for, accepts the risk).
 *
 * WRITE — throws on DB error.
 */
export async function setManualOverride(args: {
  capability: TrustCapability;
  manualOverride: boolean;
  tier?: TrustTier;
}): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Cannot toggle trust-tier override.",
    );
  }
  const current = await getTrustTierRow(args.capability);
  const tier = args.tier ?? current.tier;
  if (!isTier(tier)) {
    throw new Error(`setManualOverride: invalid tier '${tier}'.`);
  }
  const supabase = getSupabaseServerClient();
  const ups = await supabase.from(TABLE).upsert(
    {
      capability: args.capability,
      tier,
      promoted_at: current.promotedAt,
      manual_override: args.manualOverride,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "capability" },
  );
  if (ups.error) {
    throw new Error(`[trust/tier] manual-override upsert failed: ${ups.error.message}`);
  }
  await appendAudit({
    action: "trust.manual_override_set",
    payload: {
      capability: args.capability,
      manualOverride: args.manualOverride,
      tier,
    },
  });
}
