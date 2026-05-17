// /replies — v0.9 inbound-reply review surface.
//
// Server component. Lists the most-recent 50 `replies` rows with their
// classified intent + linked thread, plus a column noting whether Tay
// auto-drafted a reply.
//
// Wizard degraded-state matrix:
//   - Supabase not configured → render SupabaseWarning + empty list.
//   - Gmail not connected → amber banner pointing at Settings.
//   - Gmail connected but read scope missing (pre-v0.9 connection) →
//     amber banner pointing at Settings ("Reconnect Gmail for reply
//     handling").
//   - Voice rubric missing → amber banner (auto-drafts can't run).
//   - CRON_SECRET missing → red banner (poller will never fire).
//   - No replies yet → empty-state message.
//
// All degraded states RENDER the page; none redirect-loop.

import Link from "next/link";
import { SupabaseWarning } from "@/components/supabase-warning";
import { hasSupabaseEnv, getSupabaseServerClient } from "@/lib/supabase/server";
import { ensureSchema } from "@/lib/supabase/migrate";
import { getGoogleOAuth } from "@/lib/oauth/persist";
import { hasReadScope } from "@/lib/oauth/google";
import { hasOAuthSecret } from "@/lib/oauth/crypto";
import { getRubric } from "@/lib/voice/calibrate";
import { getReplySettings } from "@/lib/reply/settings";

export const dynamic = "force-dynamic";

type ReplyRow = {
  id: string;
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
  subject: string | null;
  bodyPreview: string;
  receivedAt: string;
  intent: string | null;
  hasAutoDraft: boolean;
};

export default async function RepliesPage() {
  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <SupabaseWarning />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Replies</h1>
      </main>
    );
  }

  await ensureSchema();

  const oauthSecretOk = await hasOAuthSecret();
  const [oauth, rubric, settings, rows] = await Promise.all([
    oauthSecretOk ? getGoogleOAuth() : Promise.resolve(null),
    getRubric(),
    getReplySettings(),
    loadReplyRows(),
  ]);

  const cronOk = Boolean(process.env.CRON_SECRET);
  const readScopeOk = oauth ? hasReadScope(oauth.scope) : false;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Replies</h1>
          <p className="mt-1 text-sm text-gray-500">
            Inbound replies Tay polled from Gmail and classified by intent.
            {settings.autoReplyEnabled
              ? " Auto-drafting is ON for 'interested' replies."
              : " Auto-drafting is OFF (toggle in Settings)."}
          </p>
        </div>
        <Link
          href="/queue"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Go to queue →
        </Link>
      </header>

      {!oauthSecretOk && (
        <Banner kind="red">
          <strong>OAuth crypto secret unreachable.</strong>{" "}
          Configure SUPABASE_SERVICE_ROLE_KEY (or the legacy TAY_OAUTH_SECRET fallback), redeploy, and reconnect Gmail.
        </Banner>
      )}
      {oauthSecretOk && !oauth && (
        <Banner kind="amber">
          <strong>Gmail not connected.</strong>{" "}
          <Link href="/settings" className="underline">
            Connect under Settings
          </Link>{" "}
          to start ingesting replies.
        </Banner>
      )}
      {oauth && !readScopeOk && (
        <Banner kind="amber">
          <strong>Reconnect Gmail for reply handling.</strong>{" "}
          Your current OAuth grant is send-only (pre-v0.9). v0.9 needs
          read access to poll for replies.{" "}
          <Link href="/settings" className="underline">
            Reconnect under Settings
          </Link>.
        </Banner>
      )}
      {!rubric && (
        <Banner kind="amber">
          <strong>Voice rubric missing.</strong>{" "}
          <Link href="/setup/voice" className="underline">
            Complete voice calibration
          </Link>
          {" "}— auto-drafting can't run without the voice contract.
        </Banner>
      )}
      {!cronOk && (
        <Banner kind="red">
          <strong>CRON_SECRET missing.</strong>{" "}
          The Vercel Cron trigger will be rejected as unauthorized. Set
          CRON_SECRET in your Vercel env and redeploy.
        </Banner>
      )}

      <section className="mt-6 rounded-2xl border border-gray-200 bg-white shadow-sm">
        {rows.length === 0 ? (
          <div className="px-6 py-10 text-sm text-gray-500">
            No replies yet. The poller runs every 5 minutes once Gmail is
            connected with read scope.
          </div>
        ) : (
          <RepliesTable rows={rows} />
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
    <div role="alert" className={`mt-6 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {children}
    </div>
  );
}

function RepliesTable({ rows }: { rows: ReplyRow[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
        <tr>
          <th className="px-6 py-2 font-medium">From</th>
          <th className="px-6 py-2 font-medium">Subject</th>
          <th className="px-6 py-2 font-medium">Body preview</th>
          <th className="px-6 py-2 font-medium">Intent</th>
          <th className="px-6 py-2 font-medium">Auto-drafted</th>
          <th className="px-6 py-2 font-medium">Received</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {rows.map((r) => (
          <tr key={r.id} className="align-top">
            <td className="px-6 py-3 text-gray-900">{r.fromEmail}</td>
            <td className="px-6 py-3 text-gray-900">{r.subject ?? ""}</td>
            <td className="px-6 py-3 text-gray-700">{r.bodyPreview}</td>
            <td className="px-6 py-3">
              <IntentBadge intent={r.intent} />
            </td>
            <td className="px-6 py-3 text-xs">
              {r.hasAutoDraft ? (
                <Link href="/queue" className="text-gray-900 underline">
                  Yes — see queue
                </Link>
              ) : (
                <span className="text-gray-400">No</span>
              )}
            </td>
            <td className="px-6 py-3 text-xs text-gray-500">
              {new Date(r.receivedAt).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function IntentBadge({ intent }: { intent: string | null }) {
  if (!intent) {
    return <span className="text-xs text-gray-400">unclassified</span>;
  }
  const color =
    intent === "interested"
      ? "bg-green-100 text-green-800"
      : intent === "unsubscribe_request"
        ? "bg-red-100 text-red-800"
        : intent === "out_of_office"
          ? "bg-blue-100 text-blue-800"
          : intent === "not_interested"
            ? "bg-amber-100 text-amber-900"
            : "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${color}`}
    >
      {intent.replace(/_/g, " ")}
    </span>
  );
}

async function loadReplyRows(): Promise<ReplyRow[]> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("replies")
      .select(
        "id, gmail_message_id, gmail_thread_id, from_email, subject, body, received_at, classified_intent",
      )
      .order("received_at", { ascending: false })
      .limit(50);
    if (error || !data) {
      console.warn(
        "[replies] load failed:",
        error?.message ?? "no data",
      );
      return [];
    }
    const rows = data as Array<{
      id: string;
      gmail_message_id: string;
      gmail_thread_id: string;
      from_email: string;
      subject: string | null;
      body: string;
      received_at: string;
      classified_intent: string | null;
    }>;
    if (rows.length === 0) return [];

    // Which of these replies have an auto-drafted reply? Look up drafts
    // by reply_to_id.
    const replyIds = rows.map((r) => r.id);
    const draftsQ = await supabase
      .from("drafts")
      .select("reply_to_id")
      .in("reply_to_id", replyIds);
    const withDraft = new Set(
      ((draftsQ.data ?? []) as Array<{ reply_to_id: string | null }>)
        .map((d) => d.reply_to_id)
        .filter((id): id is string => !!id),
    );

    return rows.map((r) => ({
      id: r.id,
      gmailMessageId: r.gmail_message_id,
      gmailThreadId: r.gmail_thread_id,
      fromEmail: r.from_email,
      subject: r.subject,
      bodyPreview:
        r.body.length > 160 ? `${r.body.slice(0, 160).trim()}…` : r.body,
      receivedAt: r.received_at,
      intent: r.classified_intent,
      hasAutoDraft: withDraft.has(r.id),
    }));
  } catch (err) {
    console.warn(
      "[replies] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
