// Audit log viewer — server component, read-only.
//
// Two concerns:
//   1. Top: verifier badge — green "Chain intact, N rows" or red
//      "Chain broken at row X (<reason>)".
//   2. Below: latest 50 events as a table. Payload preview is JSON
//      truncated to 100 chars per cell so a giant nested object
//      doesn't blow the layout.
//
// Degraded modes (Wizard matrix):
//   - Supabase env missing → render a single "Audit log requires
//     Supabase" panel. Don't render the table or call the verifier;
//     both would just be empty.
//   - Verifier soft-fails to read_error → red badge with the reason.
//   - getRecentAuditEvents soft-fails to [] → render "No events yet."
//
// No interactivity. No client JS. The verifier endpoint is at
// /api/audit/verify for scripting.

import { hasSupabaseEnv } from "@/lib/supabase/server";
import { ensureSchema } from "@/lib/supabase/migrate";
import {
  verifyAuditChain,
  getRecentAuditEvents,
  type AuditVerifyResult,
  type AuditEventRow,
} from "@/lib/audit/verify";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <div className="mt-6 rounded-2xl border border-yellow-200 bg-yellow-50 p-6 text-sm text-yellow-900">
          Audit log requires Supabase. Configure your project to enable.
        </div>
      </main>
    );
  }

  // Cold-start guard — same justification as the home page.
  await ensureSchema();

  // Both reads soft-fail; we render whatever we get.
  const [verifyResult, events] = await Promise.all([
    verifyAuditChain(),
    getRecentAuditEvents(50),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
          <p className="mt-1 text-sm text-gray-500">
            Tamper-evident sha256 hash chain over every Tier-3 action.
          </p>
        </div>
        <VerifierBadge result={verifyResult} />
      </header>

      <section className="mt-8 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-6 py-3 text-xs font-medium uppercase tracking-wide text-gray-500">
          Latest 50 events (newest first)
        </div>
        {events.length === 0 ? (
          <div className="px-6 py-8 text-sm text-gray-500">
            No events yet. Audit rows are appended when the judge runs on a draft.
          </div>
        ) : (
          <EventsTable events={events} />
        )}
      </section>

      <p className="mt-6 text-xs text-gray-400">
        Verifier endpoint:{" "}
        <code className="rounded bg-gray-100 px-1 py-0.5 text-[11px]">
          GET /api/audit/verify
        </code>
      </p>
    </main>
  );
}

function VerifierBadge({ result }: { result: AuditVerifyResult }) {
  if (result.ok) {
    return (
      <div className="rounded-full border border-green-300 bg-green-50 px-3 py-1 text-xs font-medium text-green-800">
        Chain intact · {result.totalRows} row
        {result.totalRows === 1 ? "" : "s"}
      </div>
    );
  }
  const label =
    result.brokenAt.reason === "supabase_unavailable"
      ? "Supabase unavailable"
      : result.brokenAt.reason === "read_error"
        ? "Read error"
        : `Chain broken at row ${result.brokenAt.id} (${result.brokenAt.reason})`;
  return (
    <div className="rounded-full border border-red-300 bg-red-50 px-3 py-1 text-xs font-medium text-red-800">
      {label}
    </div>
  );
}

function EventsTable({ events }: { events: AuditEventRow[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-6 py-2 font-medium">When</th>
          <th className="px-6 py-2 font-medium">Action</th>
          <th className="px-6 py-2 font-medium">Payload</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {events.map((e) => (
          <tr key={e.id} className="align-top">
            <td className="px-6 py-3 text-gray-600 whitespace-nowrap">
              {formatWhen(e.occurred_at)}
            </td>
            <td className="px-6 py-3 font-mono text-xs text-gray-900">
              {e.action}
            </td>
            <td className="px-6 py-3 font-mono text-xs text-gray-700">
              {truncate(safeJson(e.payload), 100)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return iso;
  }
}
