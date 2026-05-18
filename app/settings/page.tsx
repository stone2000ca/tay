// Settings — Tay v0.7 makes this real.
//
// Sections:
//   - Gmail (connected email + Disconnect, or Connect button)
//   - OAuth secret status (green if TAY_OAUTH_SECRET set, red otherwise)
//   - Supabase status (green/red)
//   - OpenRouter status (green/red)
//
// Read-only EXCEPT the Disconnect button, which is a server action that
// deletes the google_oauth row + appendAudit + redirects.

import Link from "next/link";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { hasOAuthSecret } from "@/lib/oauth/crypto";
import { getGoogleOAuth } from "@/lib/oauth/persist";
import { getMailboxCredentials } from "@/lib/mailbox/persist";
import { hasReadScope } from "@/lib/oauth/google";
import { getReplySettings } from "@/lib/reply/settings";
import { getSiteUrl } from "@/lib/site-url";
import { disconnectGmailAction, setAutoReplyAction } from "./actions";
import { disconnectMailboxAction } from "../setup/mailbox/actions";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{
    connected?: string;
    error?: string;
    disconnected?: string;
    auto_reply?: string;
  }>;
}) {
  const params = await searchParams;
  const oauthSecretOk = await hasOAuthSecret();
  const mailbox =
    hasSupabaseEnv() && oauthSecretOk ? await getMailboxCredentials() : null;
  // Keep the legacy oauth read for the legacy Gmail subsection so users
  // mid-migration see consistent UI. v1.1.2 read path is `mailbox`.
  const oauth = hasSupabaseEnv() && oauthSecretOk ? await getGoogleOAuth() : null;
  const readScopeOk = oauth ? hasReadScope(oauth.scope) : false;
  const replySettings = await getReplySettings();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-gray-500">
        Configuration and integration status for your Tay instance.
      </p>

      {params.connected && (
        <FlashBanner kind="green">Mailbox connected successfully.</FlashBanner>
      )}
      {params.disconnected && (
        <FlashBanner kind="amber">Mailbox disconnected.</FlashBanner>
      )}
      {params.auto_reply === "on" && (
        <FlashBanner kind="green">Auto-reply drafting is now ON.</FlashBanner>
      )}
      {params.auto_reply === "off" && (
        <FlashBanner kind="amber">Auto-reply drafting is OFF.</FlashBanner>
      )}
      {params.error && (
        <FlashBanner kind="red">{describeError(params.error)}</FlashBanner>
      )}

      <Section title="Mailbox (v1.1.2)">
        {mailbox ? (
          <div className="space-y-3">
            <div>
              <span className="text-sm text-gray-500">Connected via: </span>
              <span className="text-sm font-medium text-gray-900">
                {mailbox.kind === "oauth"
                  ? "Gmail OAuth (Power mode)"
                  : "SMTP App Password (Easy mode)"}
              </span>
            </div>
            <div>
              <span className="text-sm text-gray-500">Email: </span>
              <span className="text-sm font-medium text-gray-900">
                {mailbox.emailAddress}
              </span>
            </div>
            {mailbox.kind === "app_password" && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Reply polling (IMAP) activates in v1.1.2.5. Sends work now;
                check your Gmail inbox manually for replies until then.
              </div>
            )}
            <div className="flex gap-2">
              <Link
                href="/setup/mailbox"
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Reconnect / switch mode
              </Link>
              <form action={disconnectMailboxAction}>
                <input
                  type="hidden"
                  name="redirectTo"
                  value="/settings?disconnected=1"
                />
                <button
                  type="submit"
                  className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                >
                  Disconnect mailbox
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              No mailbox connected. Pick Easy (SMTP App Password) or Power
              (Google OAuth).
            </p>
            <Link
              href="/setup/mailbox"
              className="inline-block rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
            >
              Connect mailbox →
            </Link>
          </div>
        )}
      </Section>

      <Section title="Gmail (legacy OAuth path)">
        {oauth ? (
          <div className="space-y-3">
            <div>
              <span className="text-sm text-gray-500">Connected as: </span>
              <span className="text-sm font-medium text-gray-900">
                {oauth.emailAddress}
              </span>
            </div>
            {!readScopeOk && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <strong>Reconnect Gmail for reply handling.</strong>{" "}
                Your current OAuth grant is send-only. v0.9 needs the
                additional <code>gmail.readonly</code> scope to poll for
                replies.{" "}
                <a href="/api/auth/google/start" className="underline">
                  Reconnect now
                </a>
                .
              </div>
            )}
            <form action={disconnectGmailAction}>
              <button
                type="submit"
                className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                Disconnect Gmail
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Tay needs Gmail send + read access. Scopes:{" "}
              <code className="text-xs">gmail.send</code> and{" "}
              <code className="text-xs">gmail.readonly</code> (read used
              only for inbound-reply polling; v0.9).
            </p>
            <a
              href="/api/auth/google/start"
              className="inline-block rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
            >
              Connect Gmail
            </a>
          </div>
        )}
      </Section>

      <Section title="Reply auto-drafting (v0.9)">
        <p className="text-sm text-gray-600">
          When ON, Tay auto-drafts a reply for inbound messages classified
          as &quot;interested&quot;. Drafts still go through the judge and
          land in the queue for your review before sending — auto-reply
          NEVER sends without your click. Default: OFF (this is a
          trust-tier decision).
        </p>
        <form action={setAutoReplyAction} className="mt-3">
          <input
            type="hidden"
            name="enabled"
            value={replySettings.autoReplyEnabled ? "false" : "true"}
          />
          <button
            type="submit"
            className={
              replySettings.autoReplyEnabled
                ? "rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100"
                : "rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
            }
          >
            {replySettings.autoReplyEnabled
              ? "Turn auto-reply OFF"
              : "Turn auto-reply ON"}
          </button>
          <span className="ml-3 text-xs text-gray-500">
            Currently:{" "}
            <strong>{replySettings.autoReplyEnabled ? "ON" : "OFF"}</strong>
          </span>
        </form>
      </Section>

      <Section title="Notifications (v1.1.4)">
        <p className="text-sm text-gray-600">
          When an inbound reply arrives, Tay can ping you via email
          (default) or a Slack webhook. You can also narrow by intent so
          only high-signal replies (e.g. &quot;interested&quot;) reach you.
        </p>
        <Link
          href="/settings/notifications"
          className="mt-3 inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Manage notification preferences →
        </Link>
      </Section>

      <Section title="Suppression list">
        <p className="text-sm text-gray-600">
          Emails on the suppression list never receive sends. The
          orchestrator checks this list before every Gmail call.
        </p>
        <Link
          href="/settings/suppression"
          className="mt-3 inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Manage suppression list →
        </Link>
      </Section>

      <Section title="Secrets (v1.1.1)">
        <p className="text-sm text-gray-600">
          Manage your BYO LLM key + view derived-secret status. Rotation banner included.
        </p>
        <Link
          href="/settings/secrets"
          className="mt-3 inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          Manage secrets →
        </Link>
      </Section>

      <Section title="Trust tiers (v1.0)">
        <p className="text-sm text-gray-600">
          Per-capability auto-promotion state. tier_0 keeps humans in the
          loop for every action; tier_1 auto-acts on judge-allow; tier_2 is
          audit-only; tier_3 is reserved for manual promotion.
        </p>
        <Link
          href="/settings/trust"
          className="mt-3 inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          View trust tiers →
        </Link>
      </Section>

      <Section title="Integration status">
        <ul className="space-y-2 text-sm">
          <StatusRow
            ok={oauthSecretOk}
            label="OAuth crypto secret"
            help="Derived from SUPABASE_SERVICE_ROLE_KEY (v1.1.1) or falls back to TAY_OAUTH_SECRET. Encrypts OAuth tokens at rest."
          />
          <StatusRow
            ok={hasSupabaseEnv()}
            label="Supabase"
            help="Link via Vercel Marketplace. Stores drafts, decisions, audit log, and OAuth tokens."
          />
          <StatusRow
            ok={Boolean(process.env.OPENROUTER_API_KEY)}
            label="OpenRouter API key"
            help="Required for drafting, judging, and voice calibration."
          />
          <StatusRow
            ok={Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID)}
            label="GOOGLE_OAUTH_CLIENT_ID"
            help="From console.cloud.google.com/apis/credentials."
          />
          <StatusRow
            ok={Boolean(process.env.GOOGLE_OAUTH_CLIENT_SECRET)}
            label="GOOGLE_OAUTH_CLIENT_SECRET"
            help="From the same Google Cloud OAuth client as the ID."
          />
          <InfoRow
            label="Site URL"
            value={getSiteUrl()}
            help="Auto-detected via NEXT_PUBLIC_SITE_URL, then VERCEL_PROJECT_PRODUCTION_URL, then VERCEL_URL, then localhost. Override NEXT_PUBLIC_SITE_URL only if you're on a custom domain."
          />
          <InfoRow
            label="Cron secret"
            value={
              process.env.CRON_SECRET
                ? "Vercel-managed (auto-set on deploy)"
                : "missing — set CRON_SECRET in your env if you're not on Vercel"
            }
            help="Used by Vercel Cron to call /api/cron/poll-gmail. Vercel auto-sets this for any project with a vercel.json cron config."
            ok={Boolean(process.env.CRON_SECRET)}
          />
        </ul>
      </Section>
    </main>
  );
}

function InfoRow({
  label,
  value,
  help,
  ok = true,
}: {
  label: string;
  value: string;
  help: string;
  ok?: boolean;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-label={ok ? "configured" : "missing"}
        className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${
          ok ? "bg-green-500" : "bg-amber-500"
        }`}
      />
      <div>
        <div className="font-medium text-gray-900">
          {label}{" "}
          <span className="text-xs text-gray-500">{value}</span>
        </div>
        <div className="text-xs text-gray-500">{help}</div>
      </div>
    </li>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function StatusRow({
  ok,
  label,
  help,
}: {
  ok: boolean;
  label: string;
  help: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-label={ok ? "configured" : "missing"}
        className={`mt-1 inline-block h-2.5 w-2.5 rounded-full ${
          ok ? "bg-green-500" : "bg-red-500"
        }`}
      />
      <div>
        <div className="font-medium text-gray-900">
          {label}{" "}
          <span className="text-xs text-gray-400">
            ({ok ? "configured" : "missing"})
          </span>
        </div>
        <div className="text-xs text-gray-500">{help}</div>
      </div>
    </li>
  );
}

function FlashBanner({
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

function describeError(code: string): string {
  switch (code) {
    case "no_oauth_secret":
      return "OAuth crypto secret unreachable. Configure SUPABASE_SERVICE_ROLE_KEY (or set the legacy TAY_OAUTH_SECRET fallback) and redeploy.";
    case "no_google_client_id":
      return "GOOGLE_OAUTH_CLIENT_ID is missing. Create an OAuth client in Google Cloud and set both ID and secret in Vercel env.";
    case "no_site_url":
      return "NEXT_PUBLIC_SITE_URL is missing. Set it to your Vercel deployment URL.";
    case "consent_declined":
      return "Gmail consent was declined or cancelled.";
    case "missing_code":
      return "Google did not return an authorization code.";
    case "state_mismatch":
      return "CSRF state mismatch — the connect link may have been tampered with. Try again.";
    case "server_misconfigured":
      return "Server is missing OAuth env vars. Check Settings → Integration status.";
    case "connect_failed":
      return "Could not exchange the authorization code with Google. Try again, or check that your OAuth client is configured correctly.";
    case "disconnect_failed":
      return "Could not disconnect Gmail. Try again.";
    case "auto_reply_toggle_failed":
      return "Could not change auto-reply setting. Try again.";
    default:
      return `Error: ${code}`;
  }
}
