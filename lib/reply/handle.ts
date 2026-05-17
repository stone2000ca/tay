// Reply handler orchestrator — Tay v0.9 (LOAD-BEARING).
//
// THIS IS THE SINGLE CHOKEPOINT for "we got an inbound reply, do the
// right thing." The poller calls it once per new Gmail message; the
// orchestrator owns the rest. No other code is allowed to write to the
// `replies` table or fan out to trust / suppression on reply events.
//
// Numbered pipeline (each step is a numbered branch below; this comment
// is the canonical contract):
//
//   1. DEDUPE: INSERT into `replies` with UNIQUE on gmail_message_id.
//      On 23505 → "already processed", return ok:true (idempotent).
//   2. MATCH THREAD: look up `sent_messages` by gmail_thread_id. If no
//      match: reply to a thread we didn't initiate (cold inbound or
//      wrong tenant). Skip — recorded but not classified, not trust-
//      evented. Return ok:true.
//   3. CLASSIFY: call lib/reply/classify.ts. Body wrapped in
//      <untrusted_source>; classifier defenses are Tay gate H.
//   4. PERSIST CLASSIFICATION: UPDATE the `replies` row with the
//      intent + model + classified_at.
//   5. BRANCH ON INTENT:
//      - unsubscribe_request → addSuppression + audit + trust event
//        (replied_negative).
//      - out_of_office       → trust event replied_negative; no
//        further action (OOO is not a positive signal).
//      - not_interested      → trust event replied_negative.
//      - interested          → trust event replied_positive; if AND
//        reply_settings.auto_reply_enabled AND !isSuppressed(from)
//        AND we matched a sent_message → draft reply via
//        lib/reply/draft.ts. Otherwise end here.
//      - other               → no trust event; no auto-reply.
//   6. AUDIT: appendAudit("reply.received", ...) with operational
//      fields only (no bodies, no PII beyond the email — which the
//      redactor masks).
//
// READ-VS-WRITE: handleReply is a WRITE chokepoint. Returns a
// discriminated union (never throws to caller) — same convention as
// sendDraft. Helpers throw; we catch and translate at this seam.

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";
import { appendAudit } from "../audit/append";
import { recordTrustEvent } from "../trust/record";
import { addSuppression } from "../suppression/add";
import { isSuppressed } from "../suppression/check";
import { getRubric } from "../voice/calibrate";
import { getReplySettings } from "./settings";
import { classifyReply, type ReplyIntent } from "./classify";
import { generateReplyDraft } from "./draft";

const REPLIES_TABLE = "replies";
const SENT_TABLE = "sent_messages";

export type HandleReplyResult =
  | { ok: true; intent: ReplyIntent | "skipped" | "duplicate"; replyDrafted: boolean }
  | { ok: false; error: string };

export async function handleReply(args: {
  gmailMessageId: string;
  gmailThreadId: string;
  fromEmail: string;
  subject?: string;
  body: string;
  receivedAt: string;
}): Promise<HandleReplyResult> {
  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      error:
        "Supabase not configured. Link your project via the Vercel Marketplace before handling replies.",
    };
  }

  const supabase = getSupabaseServerClient();

  // -- 2 PRE-EMPTIVE THREAD MATCH ---------------------------------------
  // We do the thread match BEFORE the dedupe insert so we can attach the
  // sent_message_id when we write the row (instead of a follow-up UPDATE).
  const sentQ = await supabase
    .from(SENT_TABLE)
    .select("id, draft_id, prospect_id, subject, body")
    .eq("gmail_thread_id", args.gmailThreadId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (sentQ.error) {
    console.warn(
      "[reply/handle] sent_messages lookup failed:",
      sentQ.error.message,
    );
  }
  const matched =
    (sentQ.data as
      | {
          id: string;
          draft_id: string;
          prospect_id: string;
          subject: string;
          body: string;
        }
      | null) ?? null;

  // -- 1 DEDUPE -----------------------------------------------------------
  const ins = await supabase
    .from(REPLIES_TABLE)
    .insert({
      gmail_message_id: args.gmailMessageId,
      gmail_thread_id: args.gmailThreadId,
      sent_message_id: matched?.id ?? null,
      from_email: args.fromEmail,
      subject: args.subject ?? null,
      body: args.body,
      received_at: args.receivedAt,
    })
    .select("id")
    .single();
  if (ins.error) {
    if (isUniqueViolation(ins.error)) {
      // Already processed — idempotent return.
      return { ok: true, intent: "duplicate", replyDrafted: false };
    }
    return {
      ok: false,
      error: `[reply/handle] insert failed: ${ins.error.message}`,
    };
  }
  const replyId = (ins.data as { id: string } | null)?.id ?? "";

  // -- 2b SKIP IF NO MATCH -----------------------------------------------
  if (!matched) {
    await appendAudit({
      action: "reply.received",
      payload: {
        gmailMessageId: args.gmailMessageId,
        gmailThreadId: args.gmailThreadId,
        // email_lower is masked by the redactor (substring "email"). We
        // pass it anyway because the redactor is the source of truth.
        from_email_lower: args.fromEmail.toLowerCase(),
        matched: false,
        intent: "skipped",
        hasReplyDraft: false,
      },
    });
    return { ok: true, intent: "skipped", replyDrafted: false };
  }

  // -- 3 CLASSIFY --------------------------------------------------------
  const rubric = await getRubric();
  const classification = await classifyReply({
    reply: {
      from: args.fromEmail,
      subject: args.subject,
      body: args.body,
    },
    originalDraft: { subject: matched.subject, body: matched.body },
    rubric: rubric ?? undefined,
  });

  if (!classification.ok) {
    // Classification failed but the reply row is persisted. Audit and
    // return — we'd rather see the row in /replies than lose it.
    await appendAudit({
      action: "reply.received",
      payload: {
        gmailMessageId: args.gmailMessageId,
        gmailThreadId: args.gmailThreadId,
        matched: true,
        intent: "error",
        classifierError: classification.error,
        hasReplyDraft: false,
      },
    });
    return { ok: false, error: classification.error };
  }
  const intent = classification.classification.intent;

  // -- 4 PERSIST CLASSIFICATION -----------------------------------------
  const upd = await supabase
    .from(REPLIES_TABLE)
    .update({
      classified_intent: intent,
      classification_model: classification.modelUsed,
      classified_at: new Date().toISOString(),
    })
    .eq("id", replyId);
  if (upd.error) {
    console.warn(
      "[reply/handle] classification persist failed:",
      upd.error.message,
    );
  }

  // Audit the classification step on its own — the chain captures
  // intent decision-points cleanly when reviewing the log.
  await appendAudit({
    action: "reply.classified",
    payload: {
      gmailMessageId: args.gmailMessageId,
      intent,
      confidence: classification.classification.confidence,
      model: classification.modelUsed,
    },
  });

  // -- 5 BRANCH ON INTENT ------------------------------------------------
  let replyDrafted = false;

  if (intent === "unsubscribe_request") {
    try {
      await addSuppression({
        email: args.fromEmail,
        reason: "user_unsubscribe",
        source: "reply-classifier",
      });
    } catch (err) {
      console.warn(
        "[reply/handle] addSuppression failed:",
        err instanceof Error ? err.message : String(err),
      );
    }
    await appendAudit({
      action: "user.unsubscribed",
      payload: {
        email_lower: args.fromEmail.toLowerCase(),
        source: "reply-classifier",
        gmailMessageId: args.gmailMessageId,
      },
    });
    await recordTrustEvent("send", "replied_negative", {
      gmailMessageId: args.gmailMessageId,
      intent,
      draftId: matched.draft_id,
    });
  } else if (intent === "out_of_office" || intent === "not_interested") {
    await recordTrustEvent("send", "replied_negative", {
      gmailMessageId: args.gmailMessageId,
      intent,
      draftId: matched.draft_id,
    });
  } else if (intent === "interested") {
    await recordTrustEvent("send", "replied_positive", {
      gmailMessageId: args.gmailMessageId,
      intent,
      draftId: matched.draft_id,
    });

    const settings = await getReplySettings();
    if (settings.autoReplyEnabled) {
      // Tay gate E (defense in depth) — even though the unsubscribe
      // branch already covers explicit opt-outs, we recheck here. The
      // user might have manually added this prospect to the suppression
      // list between the original send and the reply.
      const suppressed = await isSuppressed(args.fromEmail);
      if (!suppressed) {
        try {
          const drafted = await generateReplyDraft({
            reply: {
              from: args.fromEmail,
              subject: args.subject ?? "",
              body: args.body,
            },
            originalDraft: { subject: matched.subject, body: matched.body },
            rubric: rubric ?? undefined,
            replyId,
            prospectId: matched.prospect_id,
            promptInputs: {
              full_name: "",
              company: "",
              notes: undefined,
            },
          });
          if (drafted.ok) {
            replyDrafted = true;
            await appendAudit({
              action: "reply.draft_generated",
              payload: {
                gmailMessageId: args.gmailMessageId,
                replyId,
                draftId: drafted.draftId,
                judgeDecision: drafted.judgeDecision,
                model: drafted.modelUsed,
              },
            });
          } else {
            console.warn(
              "[reply/handle] auto-draft failed:",
              drafted.error,
            );
          }
        } catch (err) {
          console.warn(
            "[reply/handle] auto-draft threw:",
            err instanceof Error ? err.message : String(err),
          );
        }
      }
    }
  }
  // intent === "other" → no trust event; no auto-reply.

  // -- 6 AUDIT (received) ------------------------------------------------
  await appendAudit({
    action: "reply.received",
    payload: {
      gmailMessageId: args.gmailMessageId,
      gmailThreadId: args.gmailThreadId,
      matched: true,
      intent,
      hasReplyDraft: replyDrafted,
    },
  });

  return { ok: true, intent, replyDrafted };
}

/**
 * Detect Postgres unique-constraint violation (23505) — the dedupe path.
 * Same pattern as lib/send/orchestrate.ts:isUniqueViolation.
 */
function isUniqueViolation(error: {
  code?: string;
  message?: string;
}): boolean {
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("duplicate key") ||
    msg.includes("replies_gmail_message_id_key") ||
    msg.includes("unique constraint")
  );
}
