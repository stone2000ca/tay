// Gmail poller — Tay v0.9 (v1.0 cursor robustness).
//
// Strategy: every 5 minutes (Vercel Cron → /api/cron/poll-gmail), we
//   1. Read the latest `gmail_poll_cursor`.last_history_id.
//   2. If absent → first poll. Call getProfile() to fetch the current
//      historyId and seed the cursor. NO BACKFILL — re-processing old
//      replies as new would fire trust events for inbound messages we
//      already handled (or never wanted to).
//   3. If present → list new message IDs since cursor via History API
//      AND capture the History API response's top-level `historyId`
//      (v1.0 fix — no more second getProfile() call which raced).
//   4. For each new message: getMessage(), filter to "in a thread we
//      sent", short-circuit on Tay's own outbound (self-email),
//      call handleReply().
//   5. Advance the cursor to the historyId returned by the History API
//      response (NOT a fresh getProfile() call — that races) using
//      the SINGLE_ROW_ID + lock_col upsert pattern.
//
// CURSOR ADVANCE HONESTY: the cursor advance happens after the for-loop
// UNCONDITIONALLY — it does NOT wait for each message to succeed before
// moving past it. This is safe because each message is dedupe-INSERTed
// (gmail_message_id UNIQUE) inside handleReply BEFORE the classifier is
// invoked. A mid-batch handler error therefore can't "lose" the message:
// either the dedupe insert already landed (next poll skips it on the
// duplicate-key path) or it didn't (next poll re-processes it cleanly).
// The cursor advance is independent of any single message's outcome.
//
// READ-VS-WRITE: poller is a SCHEDULED WRITE pipeline. NEVER throws.
// Errors return in the result counts. The cron route fires-and-forgets
// from the user's perspective.
//
// Logging policy: operational counts only. NEVER log message bodies,
// subjects, recipient addresses, or anything PII.

import {
  getSupabaseServerClient,
  hasSupabaseEnv,
} from "../supabase/server";
import {
  getMessage,
  getProfile,
  getRecentMessagesWithHistoryId,
} from "../oauth/google";
import { ensureFreshAccessToken } from "../oauth/persist";
import { getMailboxKind } from "../mailbox/persist";
import { handleReply } from "./handle";
import { pollImapMailbox } from "./imap-poll";

const CURSOR_TABLE = "gmail_poll_cursor";
const SENT_TABLE = "sent_messages";

/**
 * Deterministic single-row id for gmail_poll_cursor. Combined with the
 * `lock_col` UNIQUE constraint added in migration 0010, this guarantees
 * the table has at most one row. v0.9 used random UUIDs + .neq("id","");
 * v1.0 swaps to upsert(onConflict=lock_col) for a cleaner contract.
 */
export const POLL_CURSOR_SINGLE_ROW_ID =
  "00000000-0000-0000-0000-000000000001";
const POLL_CURSOR_LOCK_VALUE = 1;

export type PollResult = {
  processed: number;
  skipped: number;
  errors: number;
};

export async function pollGmail(): Promise<PollResult> {
  const result: PollResult = { processed: 0, skipped: 0, errors: 0 };

  if (!hasSupabaseEnv()) {
    console.log("[poll] skipped — Supabase not configured");
    return result;
  }

  let accessToken: string;
  try {
    accessToken = await ensureFreshAccessToken();
  } catch (err) {
    console.warn(
      "[poll] no fresh access token (Gmail likely not connected or read scope missing):",
      err instanceof Error ? err.message : String(err),
    );
    result.errors++;
    return result;
  }

  const supabase = getSupabaseServerClient();

  // -- Read cursor --------------------------------------------------------
  const cursorQ = await supabase
    .from(CURSOR_TABLE)
    .select("last_history_id")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (cursorQ.error) {
    console.warn("[poll] cursor read failed:", cursorQ.error.message);
    result.errors++;
    return result;
  }
  const cursor =
    (cursorQ.data as { last_history_id: string } | null) ?? null;

  // -- First poll → seed and bail ----------------------------------------
  if (!cursor) {
    try {
      const profile = await getProfile({ accessToken });
      // v1.0: seed with the SINGLE_ROW_ID + lock_col upsert so any
      // pre-v1.0 leftover rows get coalesced into the canonical one.
      const ups = await upsertCursorRow(supabase, profile.historyId);
      if (ups.error) {
        console.warn("[poll] cursor seed failed:", ups.error.message);
        result.errors++;
      } else {
        console.log(
          `[poll] cursor seeded (no backfill) historyId=${profile.historyId}`,
        );
      }
    } catch (err) {
      console.warn(
        "[poll] cursor seed exception:",
        err instanceof Error ? err.message : String(err),
      );
      result.errors++;
    }
    return result;
  }

  // -- v1.0: capture the connected email ONCE per poll for self-filter
  let connectedEmail = "";
  try {
    const profile = await getProfile({ accessToken });
    connectedEmail = (profile.emailAddress ?? "").toLowerCase();
  } catch (err) {
    // Soft-fail: if we can't fetch the profile, we skip the self-filter
    // optimization but the handleReply dedupe still protects correctness.
    console.warn(
      "[poll] profile fetch failed (self-filter disabled this run):",
      err instanceof Error ? err.message : String(err),
    );
  }

  // -- Delta listing (and capture latest historyId from response) -------
  let historyResult: Awaited<ReturnType<typeof getRecentMessagesWithHistoryId>>;
  try {
    historyResult = await getRecentMessagesWithHistoryId({
      accessToken,
      after: cursor.last_history_id,
    });
  } catch (err) {
    console.warn(
      "[poll] history list failed:",
      err instanceof Error ? err.message : String(err),
    );
    result.errors++;
    return result;
  }
  const refs = historyResult.refs;

  if (refs.length === 0) {
    // Still advance the cursor if Google reported a newer historyId
    // (Gmail bumps historyId on labels/reads/etc., not only inbound
    // mail; we want to skip past those next time so we don't re-list).
    if (historyResult.historyId && historyResult.historyId !== cursor.last_history_id) {
      const ups = await upsertCursorRow(supabase, historyResult.historyId);
      if (ups.error) {
        console.warn("[poll] cursor advance (empty) failed:", ups.error.message);
        result.errors++;
      }
    }
    console.log("[poll] no new messages");
    return result;
  }

  // -- Pre-filter: which threadIds are ours? -----------------------------
  // Avoid a getMessage() call for every message; first batch-query
  // sent_messages by thread_id to find the intersection. The remaining
  // threads aren't ours — skip them outright.
  const threadIds = Array.from(new Set(refs.map((r) => r.threadId)));
  const sentQ = await supabase
    .from(SENT_TABLE)
    .select("gmail_thread_id")
    .in("gmail_thread_id", threadIds);
  if (sentQ.error) {
    console.warn("[poll] sent_messages thread filter failed:", sentQ.error.message);
    result.errors++;
    // Conservative: don't process anything if we can't tell which threads
    // are ours. The next poll will retry from the same cursor.
    return result;
  }
  const ourThreads = new Set(
    ((sentQ.data ?? []) as Array<{ gmail_thread_id: string }>).map(
      (r) => r.gmail_thread_id,
    ),
  );

  // -- Per-message processing -------------------------------------------
  for (const ref of refs) {
    if (!ourThreads.has(ref.threadId)) {
      result.skipped++;
      continue;
    }
    try {
      const msg = await getMessage({ accessToken, id: ref.id });
      const fromLower = parseFromAddress(msg.from).toLowerCase();

      // v1.0 carry-forward: short-circuit on Tay's own outbound. The
      // History API returns ALL added messages including our own SENT
      // messages. Without this filter, every send would also trigger a
      // classifier LLM call against our own message (wasted spend +
      // potential dedupe-key collision in handleReply).
      if (connectedEmail && fromLower === connectedEmail) {
        result.skipped++;
        continue;
      }

      const r = await handleReply({
        gmailMessageId: msg.id,
        gmailThreadId: msg.threadId,
        fromEmail: parseFromAddress(msg.from),
        subject: msg.subject || undefined,
        body: msg.body,
        receivedAt: msg.internalDate,
      });
      if (r.ok) {
        result.processed++;
      } else {
        result.errors++;
        console.warn("[poll] handleReply error (counts only):", r.error);
      }
    } catch (err) {
      result.errors++;
      console.warn(
        "[poll] handleReply exception:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // -- Advance cursor ----------------------------------------------------
  // v1.0: use the historyId from the History API response itself (no
  // second getProfile() call — eliminates the race window where a
  // message could land between our list call and the profile fetch and
  // get marked "already processed" forever).
  const nextHistoryId =
    historyResult.historyId ?? cursor.last_history_id;
  try {
    const ups = await upsertCursorRow(supabase, nextHistoryId);
    if (ups.error) {
      console.warn("[poll] cursor advance failed:", ups.error.message);
      result.errors++;
    }
  } catch (err) {
    console.warn(
      "[poll] cursor advance exception:",
      err instanceof Error ? err.message : String(err),
    );
    result.errors++;
  }

  console.log(
    `[poll] processed=${result.processed} skipped=${result.skipped} errors=${result.errors}`,
  );
  return result;
}

/**
 * Upsert the (one and only) gmail_poll_cursor row. Keyed on `lock_col`
 * (UNIQUE per migration 0010) — guarantees at most one row exists.
 *
 * Returns the supabase chain result so callers can read `error`.
 */
async function upsertCursorRow(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  historyId: string,
): Promise<{ error: { message: string } | null }> {
  const result = await supabase.from(CURSOR_TABLE).upsert(
    {
      id: POLL_CURSOR_SINGLE_ROW_ID,
      lock_col: POLL_CURSOR_LOCK_VALUE,
      last_history_id: historyId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "lock_col" },
  );
  return { error: result.error ?? null };
}

/**
 * v1.1.2.5 channel dispatcher. The cron route (`/api/cron/poll-gmail`)
 * calls this instead of `pollGmail()` directly so SMTP-mode installs
 * also get reply polling.
 *
 * Dispatch:
 *   - kind === "oauth"        → delegate to pollGmail() (v0.9 path)
 *   - kind === "app_password" → delegate to pollImapMailbox() (v1.1.2.5)
 *   - kind === null           → return early; no mailbox connected
 *
 * Both delegated functions soft-fail; this wrapper never throws. The
 * returned `channel` tag lets the cron route log which path ran without
 * needing to re-read the mailbox kind.
 */
export type PollRepliesResult = {
  channel: "oauth" | "app_password" | "none";
  processed: number;
  skipped: number;
  errors: number;
  reason?: string;
};

export async function pollReplies(): Promise<PollRepliesResult> {
  const kind = await getMailboxKind();
  if (kind === "oauth") {
    const r = await pollGmail();
    return { channel: "oauth", ...r };
  }
  if (kind === "app_password") {
    const r = await pollImapMailbox();
    return { channel: "app_password", ...r };
  }
  return {
    channel: "none",
    processed: 0,
    skipped: 0,
    errors: 0,
    reason: "no_mailbox",
  };
}

/**
 * Pull the bare email address out of an RFC 5322 From header. Accepts:
 *   "Alice <alice@example.com>"  →  "alice@example.com"
 *   "alice@example.com"          →  "alice@example.com"
 *   ""                           →  ""
 *
 * Exported for testability.
 */
export function parseFromAddress(from: string): string {
  if (!from) return "";
  const angle = from.match(/<([^>]+)>/);
  if (angle && angle[1]) return angle[1].trim();
  return from.trim();
}
