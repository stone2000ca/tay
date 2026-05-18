// Notification preferences persistence — Tay v1.1.4.
//
// Single-row table (lock_col UNIQUE DEFAULT 1), same pattern as
// instance_secrets / mailbox_credentials / gmail_poll_cursor /
// imap_poll_cursor / reply_settings.
//
// READ-VS-WRITE ERROR CONTRACT:
//
//   - READ functions (getPreferences) SOFT-FAIL to defaults. The reply
//     dispatcher must always have *some* preferences to act on; an
//     unreachable DB or an empty row both resolve to the safe default
//     (channel: "email", enabledForIntents: ALL intents). Page renders
//     that depend on preferences also use the same defaults so the UI
//     never crashes on first visit before the user has saved anything.
//
//   - WRITE functions (setPreferences) THROW on Supabase failure OR on
//     encryption failure. The settings form's server action catches the
//     throw and surfaces a user-visible error rather than silently
//     persisting half-state that would confuse the next dispatch.
//
// Crypto: the Slack webhook URL is the only sensitive field — it's a
// bearer credential (anyone with the URL can POST to the user's Slack).
// We store it encrypted via the existing AES-256-GCM helper at
// lib/oauth/crypto.ts so the key is shared with the OAuth token store
// (HKDF-derived from SUPABASE_SERVICE_ROLE_KEY + instance_secrets.salt).
// The email_override field is plain (it's just an email address; no
// credential value) — same treatment as mailbox_credentials.email_address.

import {
  getSupabaseServerClient,
  hasSupabaseEnv,
} from "../supabase/server";
import { decryptToken, encryptToken, hasOAuthSecret } from "../oauth/crypto";
import type { ReplyIntent } from "../reply/classify";

const TABLE = "notification_preferences";
const LOCK_COL = 1;

export type NotificationChannel = "email" | "slack_webhook" | "none";

export type NotificationPreferences = {
  channel: NotificationChannel;
  /** Decrypted; only present when channel === "slack_webhook". */
  slackWebhookUrl?: string;
  /** Optional alternate destination for email notifications. */
  emailOverride?: string;
  /** Which reply intents trigger a notification. Default: all. */
  enabledForIntents: ReplyIntent[];
};

/**
 * Canonical default. Used when the table is empty, the read errors, or
 * the row is malformed.
 *
 * Default channel = "email" — the recommendation from the Sonnet review
 * pass: zero extra setup for non-tech users; the connected mailbox is
 * the obvious place a user will look for replies.
 *
 * Default intents = ALL — the user can narrow later under /settings.
 */
export const DEFAULT_PREFERENCES: NotificationPreferences = {
  channel: "email",
  enabledForIntents: [
    "interested",
    "not_interested",
    "out_of_office",
    "unsubscribe_request",
    "other",
  ],
};

const ALL_INTENTS: ReadonlyArray<ReplyIntent> = [
  "interested",
  "not_interested",
  "out_of_office",
  "unsubscribe_request",
  "other",
];

/**
 * Read the active notification preferences. SOFT-FAILS to defaults on
 * any error (no Supabase env, decryption failure, malformed row,
 * permissions). The reply dispatcher MUST always get something usable.
 */
export async function getPreferences(): Promise<NotificationPreferences> {
  if (!hasSupabaseEnv()) return DEFAULT_PREFERENCES;

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select(
        "channel, slack_webhook_url_encrypted, email_override, enabled_for_intents",
      )
      .eq("lock_col", LOCK_COL)
      .maybeSingle();
    if (error) {
      console.warn("[notify/preferences] read failed:", error.message);
      return DEFAULT_PREFERENCES;
    }
    if (!data) return DEFAULT_PREFERENCES;

    const row = data as {
      channel: string | null;
      slack_webhook_url_encrypted: string | null;
      email_override: string | null;
      enabled_for_intents: string | null;
    };

    const channel = parseChannel(row.channel);
    const enabledForIntents = parseIntents(row.enabled_for_intents);
    const emailOverride = (row.email_override ?? "").trim() || undefined;

    let slackWebhookUrl: string | undefined;
    if (channel === "slack_webhook" && row.slack_webhook_url_encrypted) {
      if (!(await hasOAuthSecret())) {
        console.warn(
          "[notify/preferences] crypto secret unreachable — Slack webhook URL cannot be decrypted; falling back to default channel.",
        );
        return DEFAULT_PREFERENCES;
      }
      try {
        slackWebhookUrl = await decryptToken(row.slack_webhook_url_encrypted);
      } catch (err) {
        console.warn(
          "[notify/preferences] webhook decrypt failed:",
          err instanceof Error ? err.message : String(err),
        );
        return DEFAULT_PREFERENCES;
      }
    }

    return {
      channel,
      slackWebhookUrl,
      emailOverride,
      enabledForIntents,
    };
  } catch (err) {
    console.warn(
      "[notify/preferences] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Persist notification preferences. Validates the webhook URL format
 * (must be https://hooks.slack.com/services/...) when channel ===
 * "slack_webhook" so we never store a stale or attacker-supplied URL
 * that POSTs somewhere else. Encrypts the webhook URL before write.
 *
 * WRITE function — throws on DB or encrypt error.
 */
export async function setPreferences(
  prefs: NotificationPreferences,
): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before saving notification preferences.",
    );
  }

  // Normalize + validate inputs ----------------------------------------

  const channel = parseChannel(prefs.channel);
  const intents = prefs.enabledForIntents.filter((i) =>
    ALL_INTENTS.includes(i),
  );
  const emailOverrideRaw = (prefs.emailOverride ?? "").trim();
  // Cheap sanity-check; defer rigorous validation to the eventual send.
  if (emailOverrideRaw && (!emailOverrideRaw.includes("@") || emailOverrideRaw.length > 320)) {
    throw new Error("Email override doesn't look like a valid email address.");
  }
  const emailOverride = emailOverrideRaw || null;

  let webhookCiphertext: string | null = null;
  if (channel === "slack_webhook") {
    const url = (prefs.slackWebhookUrl ?? "").trim();
    if (!isValidSlackWebhookUrl(url)) {
      throw new Error(
        "Slack webhook URL must start with https://hooks.slack.com/services/. Generate one at https://api.slack.com/messaging/webhooks.",
      );
    }
    if (!(await hasOAuthSecret())) {
      throw new Error(
        "Notification crypto secret unreachable. Configure SUPABASE_SERVICE_ROLE_KEY (or the legacy TAY_OAUTH_SECRET fallback) before saving Slack webhook preferences.",
      );
    }
    webhookCiphertext = await encryptToken(url);
  }

  // Persist -------------------------------------------------------------

  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();
  const row = {
    lock_col: LOCK_COL,
    channel,
    slack_webhook_url_encrypted: webhookCiphertext,
    email_override: emailOverride,
    enabled_for_intents: intents.join(","),
    updated_at: now,
  };
  const ups = await supabase.from(TABLE).upsert(row, { onConflict: "lock_col" });
  if (ups.error) {
    throw new Error(
      `[notify/preferences] upsert failed: ${ups.error.message}`,
    );
  }
}

/**
 * Slack incoming-webhook URL shape check. The canonical webhook URL is
 * always rooted at `https://hooks.slack.com/services/T.../B.../<token>`.
 * This is the same guard the UI applies, but we re-check server-side so
 * a bypass of the client form can't write an arbitrary outbound URL.
 *
 * Exported for the settings server action + tests.
 */
export function isValidSlackWebhookUrl(url: string): boolean {
  if (typeof url !== "string") return false;
  if (url.length === 0 || url.length > 512) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    if (u.hostname.toLowerCase() !== "hooks.slack.com") return false;
    if (!u.pathname.startsWith("/services/")) return false;
    // /services/T../B../<token> — at least three non-empty path segments
    // after /services/. We don't validate the segment contents (Slack's
    // ID schemes evolve).
    const rest = u.pathname.slice("/services/".length).split("/").filter(Boolean);
    if (rest.length < 3) return false;
    return true;
  } catch {
    return false;
  }
}

function parseChannel(input: unknown): NotificationChannel {
  if (input === "email" || input === "slack_webhook" || input === "none") {
    return input;
  }
  return "email";
}

function parseIntents(input: string | null | undefined): ReplyIntent[] {
  if (!input || typeof input !== "string") {
    return DEFAULT_PREFERENCES.enabledForIntents;
  }
  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .filter((p): p is ReplyIntent =>
      ALL_INTENTS.includes(p as ReplyIntent),
    );
  if (parts.length === 0) return DEFAULT_PREFERENCES.enabledForIntents;
  // De-dupe while preserving order.
  const seen = new Set<ReplyIntent>();
  const out: ReplyIntent[] = [];
  for (const p of parts) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}
