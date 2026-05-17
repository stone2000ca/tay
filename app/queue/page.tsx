// /queue — the v0.7 review-and-send surface.
//
// Server component. Lists drafts where:
//   - latest judge_decisions row has decision = 'allow'
//   - no sent_messages row exists for the draft
//   - prospect has a non-placeholder email
//
// Each row: prospect + subject + body preview + "Send" button. Send is
// a server-action POST per row (no client JS).
//
// Wizard degraded-state matrix:
//   - Supabase not configured → render SupabaseWarning + empty list.
//   - TAY_OAUTH_SECRET missing → red banner "encryption secret missing".
//   - Gmail not connected → orange banner "connect Gmail under Settings".
//   - Voice rubric missing → orange banner.
//   - No allow-able drafts → empty-state message.
//
// All degraded states render the page; none redirect-loop.

import Link from "next/link";
import { SupabaseWarning } from "@/components/supabase-warning";
import { hasSupabaseEnv, getSupabaseServerClient } from "@/lib/supabase/server";
import { ensureSchema } from "@/lib/supabase/migrate";
import { hasOAuthSecret } from "@/lib/oauth/crypto";
import { getGoogleOAuth } from "@/lib/oauth/persist";
import { getMailboxKind } from "@/lib/mailbox/persist";
import { getRubric } from "@/lib/voice/calibrate";
import { sendDraftAction } from "./actions";

export const dynamic = "force-dynamic";

type QueueRow = {
  draftId: string;
  prospectId: string;
  fullName: string | null;
  company: string | null;
  email: string;
  subject: string;
  bodyPreview: string;
};

export default async function QueuePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;

  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <SupabaseWarning />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Queue</h1>
      </main>
    );
  }

  await ensureSchema();

  const [oauth, rubric, rows, oauthSecretOk, mailboxKind] = await Promise.all([
    getGoogleOAuth(),
    getRubric(),
    loadQueueRows(),
    hasOAuthSecret(),
    getMailboxKind(),
  ]);

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="mt-1 text-sm text-gray-500">
            Drafts the judge approved. Click Send to deliver via your Gmail.
          </p>
        </div>
        <Link
          href="/draft"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Generate another →
        </Link>
      </header>

      {params.error && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          {params.error}
        </div>
      )}

      {!oauthSecretOk && (
        <Banner kind="red">
          <strong>OAuth crypto secret unreachable.</strong>{" "}
          Configure SUPABASE_SERVICE_ROLE_KEY (or the legacy TAY_OAUTH_SECRET fallback), redeploy, and reconnect Gmail before sending.
        </Banner>
      )}
      {oauthSecretOk && !oauth && (
        <Banner kind="amber">
          <strong>Gmail not connected.</strong>{" "}
          <Link href="/settings" className="underline">
            Connect under Settings
          </Link>{" "}
          before sending.
        </Banner>
      )}
      {!rubric && (
        <Banner kind="amber">
          <strong>Voice rubric missing.</strong>{" "}
          <Link href="/setup/voice" className="underline">
            Complete voice calibration
          </Link>{" "}
          — the orchestrator refuses to send without one.
        </Banner>
      )}
      {mailboxKind === "app_password" && (
        <Banner kind="amber">
          <strong>Reply polling activates in the next update (v1.1.2.5).</strong>{" "}
          You can send now; replies will appear here once we add IMAP polling.
          For now, check your Gmail inbox manually for replies.
        </Banner>
      )}

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-sm text-gray-500">
            No drafts in the queue. Generate one at{" "}
            <Link href="/draft" className="text-gray-900 underline">
              /draft
            </Link>
            .
          </div>
        ) : (
          <QueueTable rows={rows} canSend={!!oauth && !!rubric && oauthSecretOk} />
        )}
      </section>
    </main>
  );
}

function Banner({
  kind,
  children,
}: {
  kind: "amber" | "red";
  children: React.ReactNode;
}) {
  const cls =
    kind === "red"
      ? "border-red-300 bg-red-50 text-red-800"
      : "border-amber-300 bg-amber-50 text-amber-900";
  return (
    <div
      role="alert"
      className={`mt-6 rounded-lg border px-4 py-3 text-sm ${cls}`}
    >
      {children}
    </div>
  );
}

function QueueTable({
  rows,
  canSend,
}: {
  rows: QueueRow[];
  canSend: boolean;
}) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-6 py-2 font-medium">Prospect</th>
          <th className="px-6 py-2 font-medium">Subject</th>
          <th className="px-6 py-2 font-medium">Body preview</th>
          <th className="px-6 py-2 font-medium text-right"></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => (
          <tr key={r.draftId} className="align-top">
            <td className="px-6 py-3">
              <div className="font-medium text-gray-900">
                {r.fullName ?? "(no name)"}
              </div>
              <div className="text-xs text-gray-500">{r.company ?? ""}</div>
              <div className="text-xs text-gray-400">{r.email}</div>
            </td>
            <td className="px-6 py-3 text-gray-900">{r.subject}</td>
            <td className="px-6 py-3 text-gray-700">{r.bodyPreview}</td>
            <td className="px-6 py-3 text-right">
              <form action={sendDraftAction}>
                <input type="hidden" name="draftId" value={r.draftId} />
                <button
                  type="submit"
                  disabled={!canSend}
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  Send
                </button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function loadQueueRows(): Promise<QueueRow[]> {
  try {
    const supabase = getSupabaseServerClient();
    // Pull latest 100 drafts. We filter to "judge.allow + not yet sent"
    // in JS — the dataset is small at v0.7 and we don't want to invent
    // SQL views or RPCs.
    const draftsQ = await supabase
      .from("drafts")
      .select(
        "id, prospect_id, subject, body, created_at, prospects(full_name, company, email)",
      )
      .order("created_at", { ascending: false })
      .limit(100);
    if (draftsQ.error || !draftsQ.data) {
      console.warn(
        "[queue] drafts load failed:",
        draftsQ.error?.message ?? "no data",
      );
      return [];
    }

    type DraftRow = {
      id: string;
      prospect_id: string;
      subject: string;
      body: string;
      created_at: string;
      prospects: {
        full_name: string | null;
        company: string | null;
        email: string;
      } | null;
    };
    const drafts = draftsQ.data as unknown as DraftRow[];

    if (drafts.length === 0) return [];

    const draftIds = drafts.map((d) => d.id);

    // Latest decision per draft. Order by created_at desc; we'll
    // dedupe in JS keeping the first per draft.
    const decisionsQ = await supabase
      .from("judge_decisions")
      .select("draft_id, decision, created_at")
      .in("draft_id", draftIds)
      .order("created_at", { ascending: false });
    if (decisionsQ.error) {
      console.warn(
        "[queue] decisions load failed:",
        decisionsQ.error.message,
      );
      return [];
    }
    const latestDecision = new Map<string, string>();
    for (const d of (decisionsQ.data ?? []) as Array<{
      draft_id: string;
      decision: string;
    }>) {
      if (!latestDecision.has(d.draft_id)) {
        latestDecision.set(d.draft_id, d.decision);
      }
    }

    // Sent message lookup.
    const sentQ = await supabase
      .from("sent_messages")
      .select("draft_id")
      .in("draft_id", draftIds);
    if (sentQ.error) {
      console.warn("[queue] sent load failed:", sentQ.error.message);
      return [];
    }
    const sentIds = new Set(
      ((sentQ.data ?? []) as Array<{ draft_id: string }>).map(
        (s) => s.draft_id,
      ),
    );

    const out: QueueRow[] = [];
    for (const d of drafts) {
      if (sentIds.has(d.id)) continue;
      if (latestDecision.get(d.id) !== "allow") continue;
      const email = d.prospects?.email ?? "";
      if (!email || email.endsWith(".invalid")) continue;
      out.push({
        draftId: d.id,
        prospectId: d.prospect_id,
        fullName: d.prospects?.full_name ?? null,
        company: d.prospects?.company ?? null,
        email,
        subject: d.subject,
        bodyPreview: d.body.length > 200 ? `${d.body.slice(0, 200)}…` : d.body,
      });
    }
    return out;
  } catch (err) {
    console.warn(
      "[queue] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
