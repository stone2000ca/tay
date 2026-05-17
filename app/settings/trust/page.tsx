// /settings/trust — per-capability trust-tier promotion state (Tay gate I).
//
// v1.0: shows the cached tier per capability + the counts that justify it +
// a "Recompute" button (server action) + manual-override toggle.
//
// Degraded states:
//   - Supabase missing → SupabaseWarning + tier_0 placeholders rendered.
//     Recompute action will surface ?error= on submit.
//   - Trust table empty (first install) → all rows render as tier_0.

import Link from "next/link";
import { SupabaseWarning } from "@/components/supabase-warning";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { ensureSchema } from "@/lib/supabase/migrate";
import {
  getTrustTierRow,
  readTrustCounts,
  TIER_THRESHOLDS,
  type TrustTier,
} from "@/lib/trust/tier";
import type { TrustCapability } from "@/lib/trust/record";
import {
  recomputeAction,
  setManualOverrideAction,
} from "./actions";

export const dynamic = "force-dynamic";

const CAPABILITIES: ReadonlyArray<TrustCapability> = [
  "send",
  "reply_send",
  "book",
];

type Row = {
  capability: TrustCapability;
  tier: TrustTier;
  promotedAt: string | null;
  manualOverride: boolean;
  updatedAt: string;
  counts: Awaited<ReturnType<typeof readTrustCounts>>;
};

export default async function TrustPage({
  searchParams,
}: {
  searchParams: Promise<{
    capability?: string;
    result?: string;
    error?: string;
  }>;
}) {
  const params = await searchParams;

  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <SupabaseWarning />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Trust tiers
        </h1>
        <p className="mt-2 text-sm text-gray-500">
          Trust-tier state is stored in Supabase. Link your project via the
          Vercel Marketplace and reload.
        </p>
      </main>
    );
  }

  await ensureSchema();
  const rows: Row[] = await Promise.all(
    CAPABILITIES.map(async (cap) => {
      const [row, counts] = await Promise.all([
        getTrustTierRow(cap),
        readTrustCounts(cap),
      ]);
      return { ...row, counts };
    }),
  );

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Trust tiers</h1>
        <p className="mt-1 text-sm text-gray-500">
          Per-capability auto-promotion state.{" "}
          <Link href="/settings" className="underline">
            ← back to Settings
          </Link>
        </p>
      </header>

      {params.error && <Banner kind="red">{describeError(params.error)}</Banner>}
      {params.result && (
        <Banner kind="green">{describeResult(params.result, params.capability)}</Banner>
      )}

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 text-sm shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">How this works</h2>
        <ul className="mt-3 list-disc space-y-1 pl-5 text-gray-700">
          <li>
            <strong>tier_0</strong> — every action requires explicit human
            approval (default).
          </li>
          <li>
            <strong>tier_1</strong> — auto on judge-allow (no per-action click
            needed).
          </li>
          <li>
            <strong>tier_2</strong> — auto with retroactive audit only (long
            clean history).
          </li>
          <li>
            <strong>tier_3</strong> — autonomous (reserved; manual-only
            promotion).
          </li>
        </ul>
        <p className="mt-3 text-xs text-gray-500">
          Auto-promotion stops at tier_2. Five or more incidents (bounce /
          complaint / negative reply) in the last 30 days demote one tier.
        </p>
      </section>

      <div className="mt-8 space-y-6">
        {rows.map((row) => (
          <CapabilityCard key={row.capability} row={row} />
        ))}
      </div>
    </main>
  );
}

function CapabilityCard({ row }: { row: Row }) {
  const thresholds = TIER_THRESHOLDS[row.capability];
  const totalIncidents =
    row.counts.bounced + row.counts.complained + row.counts.replied_negative;
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {capabilityLabel(row.capability)}
          </h2>
          <p className="mt-1 text-xs text-gray-500">
            Current tier:{" "}
            <span className="font-medium text-gray-900">{row.tier}</span>
            {row.manualOverride && (
              <span className="ml-2 inline-block rounded bg-amber-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-900">
                manual override
              </span>
            )}
          </p>
        </div>
        <form action={recomputeAction}>
          <input type="hidden" name="capability" value={row.capability} />
          <button
            type="submit"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Recompute
          </button>
        </form>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Stat label="Sent" value={row.counts.sent} />
        <Stat label="Bounced" value={row.counts.bounced} />
        <Stat label="Complained" value={row.counts.complained} />
        <Stat label="Negative replies" value={row.counts.replied_negative} />
        <Stat label="Positive replies" value={row.counts.replied_positive} />
        <Stat label="Blocked by judge" value={row.counts.blocked_by_judge} />
        <Stat
          label="Blocked by suppression"
          value={row.counts.blocked_by_suppression}
        />
        <Stat
          label="Recent incidents (30d)"
          value={row.counts.recent_incidents}
        />
      </dl>

      <p className="mt-4 text-xs text-gray-500">
        Threshold to tier_1: ≥{thresholds.tier_0_to_1.minSent} sent /{" "}
        ≤{thresholds.tier_0_to_1.maxIncidents} incidents. Threshold to
        tier_2: ≥{thresholds.tier_1_to_2.minSent} sent /{" "}
        ≤{thresholds.tier_1_to_2.maxIncidents} incidents. Current incidents:{" "}
        {totalIncidents}.
      </p>

      <details className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-gray-600">
          Manual override
        </summary>
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-xs text-gray-500">
            When ON, Recompute is a no-op and the tier below is used as-is.
            Useful for pinning a cautious tier_0 or vouched-for tier_3.
          </p>
          <form action={setManualOverrideAction} className="space-y-2">
            <input type="hidden" name="capability" value={row.capability} />
            <label className="block text-xs text-gray-700">
              Tier
              <select
                name="tier"
                defaultValue={row.tier}
                className="ml-2 rounded-md border border-gray-300 px-2 py-1 text-xs"
              >
                <option value="tier_0">tier_0</option>
                <option value="tier_1">tier_1</option>
                <option value="tier_2">tier_2</option>
                <option value="tier_3">tier_3</option>
              </select>
            </label>
            <div className="flex gap-2">
              <button
                type="submit"
                name="manualOverride"
                value="true"
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Pin (manual ON)
              </button>
              <button
                type="submit"
                name="manualOverride"
                value="false"
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Release (manual OFF)
              </button>
            </div>
          </form>
        </div>
      </details>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-500">
        {label}
      </dt>
      <dd className="text-lg font-semibold text-gray-900">{value}</dd>
    </div>
  );
}

function capabilityLabel(cap: TrustCapability): string {
  switch (cap) {
    case "send":
      return "Send (cold outbound)";
    case "reply_send":
      return "Reply send (mid-thread)";
    case "book":
      return "Book (reserved — v1.x)";
  }
}

function describeError(code: string): string {
  switch (code) {
    case "invalid_capability":
      return "Invalid capability submitted.";
    case "invalid_input":
      return "Invalid input submitted.";
    case "recompute_failed":
      return "Recompute failed. Check the server logs and try again.";
    case "manual_override_failed":
      return "Could not update manual-override. Try again.";
    default:
      return `Error: ${code}`;
  }
}

function describeResult(result: string, capability?: string): string {
  const cap = capability ? ` for ${capability}` : "";
  switch (result) {
    case "promoted":
      return `Tier promoted${cap}.`;
    case "demoted":
      return `Tier demoted${cap}.`;
    case "noop":
      return `Recompute complete${cap}; no change.`;
    case "noop_manual":
      return `Manual override is ON${cap} — recompute was a no-op.`;
    case "manual_on":
      return `Manual override ON${cap}.`;
    case "manual_off":
      return `Manual override OFF${cap}.`;
    default:
      return result;
  }
}

function Banner({
  kind,
  children,
}: {
  kind: "green" | "amber" | "red";
  children: React.ReactNode;
}) {
  const cls =
    kind === "green"
      ? "border-green-300 bg-green-50 text-green-900"
      : kind === "amber"
        ? "border-amber-300 bg-amber-50 text-amber-900"
        : "border-red-300 bg-red-50 text-red-900";
  return (
    <div
      role="status"
      className={`mt-6 rounded-lg border px-4 py-3 text-sm ${cls}`}
    >
      {children}
    </div>
  );
}
