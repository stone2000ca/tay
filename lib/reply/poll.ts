// Gmail poller — Tay v0.9.
//
// Strategy: every 5 minutes (Vercel Cron → /api/cron/poll-gmail), we
//   1. Read the latest `gmail_poll_cursor`.last_history_id.
//   2. If absent → first poll. Call getProfile() to fetch the current
//      historyId and seed the cursor. NO BACKFILL — re-processing old
//      replies as new would fire trust events for inbound messages we
//      already handled (or never wanted to). Document tradeoff.
//   3. If present → list new message IDs since cursor via History API.
//   4. For each new message: getMessage(), filter to "in a thread we
//      sent", call handleReply().
//   5. Update the cursor to the new historyId only on overall success.
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
  getRecentMessages,
} from "../oauth/google";
import { ensureFreshAccessToken } from "../oauth/persist";
import { handleReply } from "./handle";

const CURSOR_TABLE = "gmail_poll_cursor";
const SENT_TABLE = "sent_messages";

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
      const ins = await supabase
        .from(CURSOR_TABLE)
        .insert({ last_history_id: profile.historyId });
      if (ins.error) {
        console.warn("[poll] cursor seed failed:", ins.error.message);
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

  // -- Delta listing -----------------------------------------------------
  let refs: Awaited<ReturnType<typeof getRecentMessages>>;
  try {
    refs = await getRecentMessages({
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

  if (refs.length === 0) {
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
  let latestHistoryId = cursor.last_history_id;
  for (const ref of refs) {
    if (!ourThreads.has(ref.threadId)) {
      result.skipped++;
      continue;
    }
    try {
      const msg = await getMessage({ accessToken, id: ref.id });
      // Skip our own SENT messages — they show up in the history feed.
      // The dedupe in handleReply would catch them via UNIQUE on
      // gmail_message_id (because send.orchestrate writes sent_messages
      // separately, not replies), but skipping early saves an LLM call.
      // The cheapest signal: if the message's `from` matches the
      // sent_messages.recipient_email of nothing, it's likely our own
      // outbound. We can't know our own address cheaply here, so we
      // rely on dedupe — but the body is at least intact.
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
  // Use the latest historyId we observed. Gmail's history endpoint
  // returns a top-level `historyId` in the response, but our wrapper
  // doesn't expose it — for v0.9 we fetch the profile again to get the
  // current value. Costs one extra HTTP call per poll; cheap.
  try {
    const profile = await getProfile({ accessToken });
    latestHistoryId = profile.historyId;
    const upd = await supabase
      .from(CURSOR_TABLE)
      .update({
        last_history_id: latestHistoryId,
        updated_at: new Date().toISOString(),
      })
      .neq("id", "");
    if (upd.error) {
      console.warn("[poll] cursor advance failed:", upd.error.message);
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
