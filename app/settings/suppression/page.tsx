// /settings/suppression — manage the suppression list (Tay gate E).
//
// Server component. Shows the 100 most-recent entries + a manual-add
// form + a per-row Remove button. Every change writes an audit event
// (handled in actions.ts via appendAudit).
//
// Degraded states:
//   - Supabase missing → empty list rendered, the form still appears
//     but the server action will redirect with ?error= when it tries
//     to write.

import Link from "next/link";
import { SupabaseWarning } from "@/components/supabase-warning";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { listSuppressions } from "@/lib/suppression/add";
import { ensureSchema } from "@/lib/supabase/migrate";
import {
  addSuppressionAction,
  removeSuppressionAction,
} from "./actions";

export const dynamic = "force-dynamic";

export default async function SuppressionPage({
  searchParams,
}: {
  searchParams: Promise<{
    error?: string;
    added?: string;
    removed?: string;
  }>;
}) {
  const params = await searchParams;

  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <SupabaseWarning />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Suppression
        </h1>
      </main>
    );
  }

  await ensureSchema();
  const entries = await listSuppressions(100);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Suppression</h1>
        <p className="mt-1 text-sm text-gray-500">
          Emails on this list will never receive sends. The orchestrator
          checks this list before every Gmail call.{" "}
          <Link href="/settings" className="underline">
            ← back to Settings
          </Link>
        </p>
      </header>

      {params.error && (
        <Banner kind="red">{params.error}</Banner>
      )}
      {params.added && (
        <Banner kind="green">Added {params.added} to the suppression list.</Banner>
      )}
      {params.removed && (
        <Banner kind="amber">Removed {params.removed} from the suppression list.</Banner>
      )}

      <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">Add manually</h2>
        <form action={addSuppressionAction} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="email"
              className="block text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="off"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="someone@example.com"
            />
          </div>
          <div>
            <label
              htmlFor="source"
              className="block text-xs font-medium uppercase tracking-wide text-gray-500"
            >
              Source (optional)
            </label>
            <input
              id="source"
              name="source"
              type="text"
              autoComplete="off"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="admin-ui:manual-add"
            />
            <p className="mt-1 text-xs text-gray-500">
              Free-text label for where this opt-out came from. Defaults
              to <code>admin-ui:manual-add</code>.
            </p>
          </div>
          <button
            type="submit"
            className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
          >
            Add to suppression list
          </button>
        </form>
      </section>

      <section className="mt-8 rounded-2xl border border-gray-200 bg-white shadow-sm">
        <header className="border-b border-gray-100 px-6 py-3">
          <h2 className="text-lg font-semibold tracking-tight">
            Current list ({entries.length})
          </h2>
        </header>
        {entries.length === 0 ? (
          <div className="px-6 py-10 text-sm text-gray-500">
            No emails on the suppression list yet.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-6 py-2 font-medium">Email</th>
                <th className="px-6 py-2 font-medium">Reason</th>
                <th className="px-6 py-2 font-medium">Source</th>
                <th className="px-6 py-2 font-medium">Added</th>
                <th className="px-6 py-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {entries.map((e) => (
                <tr key={e.email}>
                  <td className="px-6 py-3 text-gray-900">{e.email}</td>
                  <td className="px-6 py-3 text-gray-700">{e.reason}</td>
                  <td className="px-6 py-3 text-xs text-gray-500">{e.source}</td>
                  <td className="px-6 py-3 text-xs text-gray-500">
                    {formatDate(e.addedAt)}
                  </td>
                  <td className="px-6 py-3 text-right">
                    <form action={removeSuppressionAction}>
                      <input type="hidden" name="email" value={e.email} />
                      <button
                        type="submit"
                        className="rounded-md border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return iso;
  }
}
