// /settings/notifications — Tay v1.1.4.
//
// Reply notifications: pick channel (email recommended; Slack webhook is
// "Advanced"; or none), optionally route email to a different inbox, and
// pick which classified intents trigger a notification.

import Link from "next/link";
import { SupabaseWarning } from "@/components/supabase-warning";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { ensureSchema } from "@/lib/supabase/migrate";
import { getPreferences } from "@/lib/notify/preferences";
import { getMailboxCredentials } from "@/lib/mailbox/persist";
import type { ReplyIntent } from "@/lib/reply/classify";
import {
  saveNotificationPreferencesAction,
  sendTestNotificationAction,
} from "./actions";

export const dynamic = "force-dynamic";

const ALL_INTENTS: ReadonlyArray<{ id: ReplyIntent; label: string }> = [
  { id: "interested", label: "Interested" },
  { id: "not_interested", label: "Not interested" },
  { id: "out_of_office", label: "Out of office" },
  { id: "unsubscribe_request", label: "Unsubscribe request" },
  { id: "other", label: "Other" },
];

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    saved?: string;
    error?: string;
    test?: string;
    reason?: string;
  }>;
}) {
  const params = await searchParams;

  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <SupabaseWarning />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">
          Notifications
        </h1>
      </main>
    );
  }

  await ensureSchema();
  const prefs = await getPreferences();
  const mailbox = await getMailboxCredentials();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          Notifications
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          When an inbound reply lands, Tay can ping you so you don&apos;t
          have to keep refreshing <code className="text-xs">/replies</code>.{" "}
          <Link href="/settings" className="underline">
            ← back to Settings
          </Link>
        </p>
      </header>

      {params.saved && (
        <Banner kind="green">Notification preferences saved.</Banner>
      )}
      {params.test === "sent" && (
        <Banner kind="green">
          Test notification sent. Check your configured channel.
        </Banner>
      )}
      {params.test === "failed" && (
        <Banner kind="amber">
          Test notification did not send (reason: {params.reason ?? "unknown"}).
          Double-check your channel configuration.
        </Banner>
      )}
      {params.error && <Banner kind="red">{params.error}</Banner>}

      <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <form action={saveNotificationPreferencesAction} className="space-y-6">
          <fieldset>
            <legend className="text-sm font-medium text-gray-900">
              Channel
            </legend>
            <p className="mt-1 text-xs text-gray-500">
              Pick how Tay should ping you. Email is the default — works
              with the mailbox you already connected.
            </p>

            <div className="mt-4 space-y-3">
              <Radio
                name="channel"
                value="email"
                checked={prefs.channel === "email"}
                label="Email (recommended)"
                description={
                  mailbox
                    ? `Sends via your connected ${mailbox.kind === "oauth" ? "Gmail" : "SMTP"} mailbox (${mailbox.emailAddress}).`
                    : "Connect a mailbox first under Settings → Mailbox."
                }
              />
              <Radio
                name="channel"
                value="slack_webhook"
                checked={prefs.channel === "slack_webhook"}
                label="Slack webhook (advanced)"
                description={
                  <>
                    Paste an incoming-webhook URL.{" "}
                    <a
                      href="https://api.slack.com/messaging/webhooks"
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      Slack&apos;s setup guide ↗
                    </a>
                  </>
                }
              />
              <Radio
                name="channel"
                value="none"
                checked={prefs.channel === "none"}
                label="None"
                description="Suppress all reply notifications. The replies still surface in /replies."
              />
            </div>
          </fieldset>

          <div>
            <label
              htmlFor="email_override"
              className="block text-sm font-medium text-gray-900"
            >
              Email destination override{" "}
              <span className="text-xs font-normal text-gray-500">
                (optional, email channel only)
              </span>
            </label>
            <p className="mt-1 text-xs text-gray-500">
              Send notifications to a different address than your
              connected mailbox. Useful if you want them landing in a
              personal inbox instead.
            </p>
            <input
              id="email_override"
              name="email_override"
              type="email"
              defaultValue={prefs.emailOverride ?? ""}
              autoComplete="off"
              className="mt-2 block w-full max-w-md rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="notifications@example.com"
            />
          </div>

          <div>
            <label
              htmlFor="slack_webhook_url"
              className="block text-sm font-medium text-gray-900"
            >
              Slack webhook URL{" "}
              <span className="text-xs font-normal text-gray-500">
                (Slack channel only)
              </span>
            </label>
            <input
              id="slack_webhook_url"
              name="slack_webhook_url"
              type="url"
              defaultValue={prefs.slackWebhookUrl ?? ""}
              autoComplete="off"
              className="mt-2 block w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm font-mono shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              placeholder="https://hooks.slack.com/services/T.../B.../..."
            />
            <p className="mt-1 text-xs text-gray-500">
              Stored encrypted at rest. Never logged or echoed back.
            </p>
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-gray-900">
              Notify me when a reply is classified as
            </legend>
            <p className="mt-1 text-xs text-gray-500">
              Default: all intents. Narrow to e.g. only{" "}
              <strong>interested</strong> for higher-signal pings.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {ALL_INTENTS.map((i) => (
                <label
                  key={i.id}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs hover:bg-gray-50"
                >
                  <input
                    type="checkbox"
                    name="intents"
                    value={i.id}
                    defaultChecked={prefs.enabledForIntents.includes(i.id)}
                    className="h-3 w-3"
                  />
                  {i.label}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
            >
              Save preferences
            </button>
          </div>
        </form>
      </section>

      <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">
          Test notification
        </h2>
        <p className="mt-1 text-sm text-gray-600">
          Send a synthetic notification through your configured channel.
          Same dispatcher path as a real reply — the only difference is
          the fixture payload.
        </p>
        <form action={sendTestNotificationAction} className="mt-4">
          <button
            type="submit"
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            Send test notification
          </button>
        </form>
      </section>
    </main>
  );
}

function Radio({
  name,
  value,
  checked,
  label,
  description,
}: {
  name: string;
  value: string;
  checked: boolean;
  label: string;
  description: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer gap-3 rounded-md border border-gray-200 bg-white p-3 hover:bg-gray-50">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={checked}
        className="mt-1"
      />
      <span className="text-sm">
        <span className="font-medium text-gray-900">{label}</span>
        <span className="block text-xs text-gray-500">{description}</span>
      </span>
    </label>
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
