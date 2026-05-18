// Reply notification dispatcher — Tay v1.1.4.
//
// THIS IS THE FINAL STEP in the reply pipeline. After the orchestrator
// at lib/reply/handle.ts has classified the reply, written the audit
// entry, and (when relevant) updated trust and auto-drafted, it calls
// notifyReply() to fan out a heads-up to the user via their preferred
// channel.
//
// Channels (default: email, per the Sonnet review pass):
//   - email          → composed via the connected mailbox transport
//     (Gmail OAuth or SMTP App Password — same channel-aware dispatch
//     as the send orchestrator). Defaults to sending to the connected
//     mailbox's own address; the user can set an emailOverride to send
//     somewhere else (a separate inbox, an alias, etc.).
//   - slack_webhook  → HTTP POST to the user's incoming-webhook URL.
//     "Advanced" tab in /settings — non-tech users default to email.
//   - none           → suppressed; the audit entry still records the
//     dispatch attempt with reason="disabled" so the chain reflects
//     that we considered notifying and chose not to.
//
// ---------------------------------------------------------------------
// JUDGE/DISCLOSURE BYPASS — INTENTIONAL AND DOCUMENTED
// ---------------------------------------------------------------------
// Notifications are OPERATOR-BOUND (the recipient is the user themselves
// or their own configured webhook), NOT PROSPECT-BOUND. The Tay gates
// that govern prospect-bound sends DO NOT apply to operator-bound
// notifications:
//
//   - Gate C (AI disclosure footer): N/A. The user knows they're
//     getting an automated Tay notification — they configured Tay to
//     send it. A disclosure footer "this is AI-generated" would be
//     noise.
//   - Gate D (voice rubric): N/A. The notification is operational
//     text, not voice-matched outbound.
//   - Gate E (suppression check): bypassed. The user can't be on their
//     own suppression list in any meaningful way; if they ever did add
//     themselves, the intent is for cold-outbound, not heads-up
//     notifications they explicitly configured.
//   - Gate I (trust event): N/A. Notifications aren't a Tier-3 action
//     — they're a side-channel heads-up about a Tier-3 action that
//     already happened (the original cold send + the inbound reply).
//
// What we DO write:
//   - Gate F audit entry: every dispatch attempt (success OR skip) is
//     appended as `reply.notified` with operational metadata only — no
//     reply body, no Slack webhook URL, no PII beyond the redactor-
//     masked from-email.
//   - Gate H: the reply body is NEVER included in the notification
//     payload. The classification intent + sender + thread link are
//     the only fields. This is both privacy (the user can read the
//     body in /replies on their own terms) and spam/bait defense (an
//     attacker who wedges injection into a reply body shouldn't get
//     it forwarded into Slack or another inbox).
//
// READ-VS-WRITE: notifyReply NEVER THROWS — same convention as
// appendAudit and recordTrustEvent. Network or transport failures
// log a warning and return { notified: false, reason: "send_failed" }.
// The caller (reply/handle.ts) treats notification as the LAST step,
// not a gate: a failed notification doesn't break the reply pipeline.

import { appendAudit } from "../audit/append";
import { getPreferences, type NotificationChannel } from "./preferences";
import { getMailboxCredentials } from "../mailbox/persist";
import { ensureFreshAccessToken } from "../oauth/persist";
import { sendEmail } from "../send/gmail";
import { sendEmailViaSmtp } from "../send/smtp";
import { getSiteUrl } from "../site-url";
import type { ReplyClassification, ReplyIntent } from "../reply/classify";

const SLACK_TIMEOUT_MS = 5_000;

export type NotifyReplyInput = {
  reply: {
    from: string;
    subject?: string;
    receivedAt: string;
  };
  classification: ReplyClassification;
  /** Null when the reply didn't match a sent thread (skip path). */
  matchedSendId: string | null;
};

export type NotifyReplyResult = {
  notified: boolean;
  channel: NotificationChannel;
  reason?:
    | "disabled"
    | "intent_disabled"
    | "no_mailbox"
    | "no_recipient"
    | "send_failed"
    | "webhook_missing";
};

/**
 * Fan out a notification for an inbound reply. Best-effort: never
 * throws, never blocks the reply pipeline.
 *
 * Writes a `reply.notified` audit entry on EVERY dispatch attempt
 * (including skips and failures) so the gate-F chain reflects exactly
 * which replies the user was notified about.
 */
export async function notifyReply(
  input: NotifyReplyInput,
): Promise<NotifyReplyResult> {
  let result: NotifyReplyResult;

  try {
    const prefs = await getPreferences();
    const intent = input.classification.intent;

    if (prefs.channel === "none") {
      result = { notified: false, channel: "none", reason: "disabled" };
    } else if (!prefs.enabledForIntents.includes(intent)) {
      result = {
        notified: false,
        channel: prefs.channel,
        reason: "intent_disabled",
      };
    } else if (prefs.channel === "email") {
      result = await dispatchEmail(input, prefs.emailOverride);
    } else {
      result = await dispatchSlack(input, prefs.slackWebhookUrl);
    }
  } catch (err) {
    // Defense in depth — getPreferences soft-fails to defaults, but if
    // anything else slips through, never throw to the caller.
    console.warn(
      "[notify/dispatch] unexpected failure (best-effort, swallowed):",
      err instanceof Error ? err.message : "unknown",
    );
    result = { notified: false, channel: "email", reason: "send_failed" };
  }

  // Gate F: audit the dispatch attempt regardless of outcome.
  try {
    await appendAudit({
      action: "reply.notified",
      payload: {
        channel: result.channel,
        intent: input.classification.intent,
        notified: result.notified,
        reason: result.reason ?? null,
        // from_email_lower is masked by the audit redactor (key contains
        // "email") so the on-disk row never carries the sender address.
        from_email_lower: input.reply.from.toLowerCase(),
        matched: input.matchedSendId !== null,
      },
    });
  } catch (err) {
    console.warn(
      "[notify/dispatch] audit append failed (non-fatal):",
      err instanceof Error ? err.message : "unknown",
    );
  }

  return result;
}

// ---------- email channel ----------------------------------------------

async function dispatchEmail(
  input: NotifyReplyInput,
  emailOverride: string | undefined,
): Promise<NotifyReplyResult> {
  const mailbox = await getMailboxCredentials();
  if (!mailbox) {
    return { notified: false, channel: "email", reason: "no_mailbox" };
  }
  const recipient = (emailOverride ?? mailbox.emailAddress ?? "").trim();
  if (!recipient || !recipient.includes("@")) {
    return { notified: false, channel: "email", reason: "no_recipient" };
  }

  const subject = composeEmailSubject({
    intent: input.classification.intent,
    from: input.reply.from,
  });
  const body = composeEmailBody({
    classification: input.classification,
    from: input.reply.from,
    receivedAt: input.reply.receivedAt,
  });

  try {
    if (mailbox.kind === "oauth") {
      let accessToken: string;
      try {
        accessToken = await ensureFreshAccessToken();
      } catch (err) {
        console.warn(
          "[notify/dispatch] oauth refresh failed:",
          err instanceof Error ? err.message : "unknown",
        );
        return { notified: false, channel: "email", reason: "send_failed" };
      }
      const sent = await sendEmail({
        accessToken,
        to: recipient,
        subject,
        body,
      });
      if (!sent.ok) {
        console.warn("[notify/dispatch] gmail send failed");
        return { notified: false, channel: "email", reason: "send_failed" };
      }
      return { notified: true, channel: "email" };
    }
    // app_password
    const sent = await sendEmailViaSmtp({
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      username: mailbox.emailAddress,
      password: mailbox.password,
      fromAddress: mailbox.emailAddress,
      to: recipient,
      subject,
      body,
    });
    if (!sent.ok) {
      console.warn("[notify/dispatch] smtp send failed");
      return { notified: false, channel: "email", reason: "send_failed" };
    }
    return { notified: true, channel: "email" };
  } catch (err) {
    console.warn(
      "[notify/dispatch] email dispatch threw:",
      err instanceof Error ? err.message : "unknown",
    );
    return { notified: false, channel: "email", reason: "send_failed" };
  }
}

// ---------- slack channel ----------------------------------------------

async function dispatchSlack(
  input: NotifyReplyInput,
  webhookUrl: string | undefined,
): Promise<NotifyReplyResult> {
  if (!webhookUrl) {
    return {
      notified: false,
      channel: "slack_webhook",
      reason: "webhook_missing",
    };
  }

  const sanitizedFrom = sanitizeFromAddress(input.reply.from);
  const payload = {
    text: `[Tay] ${input.classification.intent} reply from ${sanitizedFrom}`,
    attachments: [
      {
        fallback: `Reply classified as ${input.classification.intent}. Open Tay → ${repliesUrl()}`,
        title: "Open in Tay",
        title_link: repliesUrl(),
        fields: [
          {
            title: "Intent",
            value: input.classification.intent,
            short: true,
          },
          {
            title: "Confidence",
            value: input.classification.confidence.toFixed(2),
            short: true,
          },
        ],
      },
    ],
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), SLACK_TIMEOUT_MS);
  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    if (!resp.ok) {
      // NEVER log webhookUrl — bearer credential.
      console.warn("[notify/dispatch] slack webhook non-2xx");
      return {
        notified: false,
        channel: "slack_webhook",
        reason: "send_failed",
      };
    }
    return { notified: true, channel: "slack_webhook" };
  } catch (err) {
    console.warn(
      "[notify/dispatch] slack webhook failed:",
      err instanceof Error ? err.name : "unknown",
    );
    return {
      notified: false,
      channel: "slack_webhook",
      reason: "send_failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- composition helpers ----------------------------------------

/**
 * Build a concise notification subject. Format:
 *   [Tay] <intent> reply from <sanitized-from>
 *
 * The from address is sanitized via sanitizeFromAddress() so a hostile
 * sender can't smuggle newlines or quote-escapes into the subject (some
 * mail clients render headers loosely).
 *
 * Exported for tests.
 */
export function composeEmailSubject(args: {
  intent: ReplyIntent;
  from: string;
}): string {
  return `[Tay] ${args.intent} reply from ${sanitizeFromAddress(args.from)}`;
}

/**
 * Build a short plain-text notification body. Includes:
 *   - intent + confidence
 *   - 1-2 classifier reasons (already-neutered by the classifier)
 *   - link to /replies in your Tay instance
 *
 * Deliberately does NOT include the reply body — privacy + spam-bait
 * defense. The user can read the body in /replies on their own terms.
 *
 * Exported for tests.
 */
export function composeEmailBody(args: {
  classification: ReplyClassification;
  from: string;
  receivedAt: string;
}): string {
  const c = args.classification;
  const reasons = c.reasons
    .slice(0, 2)
    .map((r) => `- ${r}`)
    .join("\n");
  const lines = [
    `A new reply came in and Tay classified it as: ${c.intent} (confidence ${c.confidence.toFixed(2)}).`,
    `From: ${sanitizeFromAddress(args.from)}`,
    `Received: ${args.receivedAt}`,
    "",
    "Why Tay classified it this way:",
    reasons || "- (no reasons provided)",
    "",
    `Open the thread in Tay: ${repliesUrl()}`,
  ];
  return lines.join("\n");
}

/**
 * Sanitize a from-address for inclusion in operator-facing text.
 *
 * Defense rationale: an attacker who controls a reply From address can
 * smuggle CRLF or control sequences ("evil@example.com\r\nBcc: x").
 * Reply From comes from IMAP/Gmail-parsed headers that should already
 * be sanitized, but we re-sanitize for any text we put in subject/body
 * — same belt-and-braces as the audit redactor.
 *
 * Exported for tests.
 */
export function sanitizeFromAddress(from: string): string {
  if (!from) return "<unknown sender>";
  // Strip ASCII control chars (U+0000–U+001F + U+007F); collapse whitespace.
  // eslint-disable-next-line no-control-regex
  const noControls = from.replace(/[ -]/g, " ");
  const cleaned = noControls.replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 200) || "<unknown sender>";
}

function repliesUrl(): string {
  return `${getSiteUrl()}/replies`;
}
