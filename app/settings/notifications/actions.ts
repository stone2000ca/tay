"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { appendAudit } from "@/lib/audit/append";
import {
  isValidSlackWebhookUrl,
  setPreferences,
  type NotificationChannel,
  type NotificationPreferences,
} from "@/lib/notify/preferences";
import { notifyReply } from "@/lib/notify/dispatch";
import type { ReplyIntent } from "@/lib/reply/classify";

const ALL_INTENTS: ReadonlyArray<ReplyIntent> = [
  "interested",
  "not_interested",
  "out_of_office",
  "unsubscribe_request",
  "other",
];

/**
 * Save the user's notification preferences.
 *
 * Server action posted from the /settings/notifications form. Validates
 * the webhook URL server-side (defense in depth — the client field has
 * the same check but a determined user could bypass it), writes via
 * lib/notify/preferences.setPreferences, and appends a
 * `notifications.configured` audit event (gate F).
 */
export async function saveNotificationPreferencesAction(
  formData: FormData,
): Promise<void> {
  const channelRaw = String(formData.get("channel") ?? "").trim();
  const channel = parseChannel(channelRaw);

  const slackWebhookUrl = String(formData.get("slack_webhook_url") ?? "").trim();
  const emailOverrideRaw = String(formData.get("email_override") ?? "").trim();

  // Multi-select: form posts repeated `intents` entries.
  const intentsRaw = formData.getAll("intents").map((v) => String(v));
  const enabledForIntents = intentsRaw.filter((i): i is ReplyIntent =>
    ALL_INTENTS.includes(i as ReplyIntent),
  );

  // Edge case: user disabled ALL intents. Treat as "notify on all" rather
  // than silently saving an unusable config. Mirror the get-defaults path.
  const finalIntents: ReplyIntent[] =
    enabledForIntents.length > 0 ? enabledForIntents : [...ALL_INTENTS];

  if (channel === "slack_webhook" && !isValidSlackWebhookUrl(slackWebhookUrl)) {
    redirect(
      "/settings/notifications?error=" +
        encodeURIComponent(
          "Slack webhook URL must start with https://hooks.slack.com/services/.",
        ),
    );
  }

  const prefs: NotificationPreferences = {
    channel,
    slackWebhookUrl: channel === "slack_webhook" ? slackWebhookUrl : undefined,
    emailOverride: emailOverrideRaw || undefined,
    enabledForIntents: finalIntents,
  };

  try {
    await setPreferences(prefs);
    await appendAudit({
      action: "notifications.configured",
      payload: {
        channel,
        // Operational only — no webhook URL, no email override.
        intents_count: finalIntents.length,
        has_email_override: Boolean(emailOverrideRaw),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[settings.notifications] save failed:", message);
    redirect(
      "/settings/notifications?error=" + encodeURIComponent(message),
    );
  }
  revalidatePath("/settings/notifications");
  redirect("/settings/notifications?saved=1");
}

/**
 * Send a synthetic reply notification so the user can verify their
 * configured channel works end-to-end. Same dispatcher path as a real
 * reply; the only difference is the fixture payload.
 */
export async function sendTestNotificationAction(): Promise<void> {
  try {
    const result = await notifyReply({
      reply: {
        from: "tay-test@example.com",
        subject: "Test notification",
        receivedAt: new Date().toISOString(),
      },
      classification: {
        intent: "interested",
        confidence: 1,
        reasons: [
          "This is a test notification from /settings/notifications.",
          "If you can read this, your channel is configured correctly.",
        ],
      },
      matchedSendId: null,
    });
    if (result.notified) {
      redirect("/settings/notifications?test=sent");
    }
    redirect(
      "/settings/notifications?test=failed&reason=" +
        encodeURIComponent(result.reason ?? "unknown"),
    );
  } catch (err) {
    // notifyReply doesn't throw normally, but if redirect() throws (Next's
    // expected NEXT_REDIRECT signal), let it bubble.
    if (err && typeof err === "object" && "digest" in (err as object)) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    redirect(
      "/settings/notifications?test=failed&reason=" + encodeURIComponent(message),
    );
  }
}

function parseChannel(input: string): NotificationChannel {
  if (input === "email" || input === "slack_webhook" || input === "none") {
    return input;
  }
  return "email";
}
