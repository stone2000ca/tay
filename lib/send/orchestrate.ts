// Send orchestrator — the SINGLE chokepoint for "send a draft" in Tay v0.7.
//
// No other code in the repo is allowed to call lib/send/gmail.ts directly.
// Going through this seam guarantees every send goes through:
//
//   1. App config exists (the user has finished setup)
//   2. Voice rubric exists (the drafter contract is in force) — Tay gate D
//      enforced UPSTREAM at draft time; orchestrator confirms via presence.
//   3. Supabase configured (we can record the send)
//   4. OAuth configured + not-expired-unrefreshably
//   5. Judge decision = "allow" — Tay gate C disclosure was verified
//      upstream by the v0.5 judge; revise/block/escalate never reach here.
//   6. isSuppressed(recipient) — Tay gate E
//   7. ensureFreshAccessToken — refresh if needed
//   8. sendEmail(...)
//   9. saveSentMessage(...)
//  10. appendAudit("send.sent", ...) — Tay gate F
//  11. recordTrustEvent("send", "sent", ...) — Tay gate I
//
// Each precondition failure returns a friendly { ok: false, error } so
// the LLM/Gmail calls are never burned for a known-bad request.
//
// READ-VS-WRITE: orchestrator is a WRITE chokepoint. It returns a
// discriminated union (never throws to caller) because the caller is a
// server action that needs to render an error message. Individual
// WRITE helpers throw; we catch + translate at this seam.

import { hasSupabaseEnv, getSupabaseServerClient } from "../supabase/server";
import { appendAudit } from "../audit/append";
import { getRubric } from "../voice/calibrate";
import { getAppConfig } from "../app-config";
import { getLatestDecisionForDraft } from "../judge/persist";
import { ensureFreshAccessToken } from "../oauth/persist";
import { sendEmail } from "./gmail";
import { isSuppressed } from "../suppression/check";
import { recordTrustEvent } from "../trust/record";

const DRAFTS_TABLE = "drafts";
const PROSPECTS_TABLE = "prospects";
const SENT_TABLE = "sent_messages";

export type SendDraftResult =
  | {
      ok: true;
      gmailMessageId: string;
      gmailThreadId: string;
      recipient: string;
    }
  | { ok: false; error: string };

export async function sendDraft(draftId: string): Promise<SendDraftResult> {
  if (!draftId || typeof draftId !== "string") {
    return { ok: false, error: "Missing draft id." };
  }

  // -- Preconditions in order ------------------------------------------

  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      error:
        "Supabase not configured. Link your project via the Vercel Marketplace.",
    };
  }

  const config = await getAppConfig();
  if (!config) {
    return {
      ok: false,
      error: "App not configured. Complete /setup before sending.",
    };
  }

  const rubric = await getRubric();
  if (!rubric) {
    return {
      ok: false,
      error:
        "Voice rubric missing. Complete voice calibration at /setup/voice before sending.",
    };
  }

  // -- Load the draft + prospect ---------------------------------------

  const supabase = getSupabaseServerClient();
  const draftQ = await supabase
    .from(DRAFTS_TABLE)
    .select("id, prospect_id, subject, body")
    .eq("id", draftId)
    .maybeSingle();
  if (draftQ.error) {
    return { ok: false, error: `Could not load draft: ${draftQ.error.message}` };
  }
  if (!draftQ.data) {
    return { ok: false, error: "Draft not found." };
  }
  const draft = draftQ.data as {
    id: string;
    prospect_id: string;
    subject: string;
    body: string;
  };

  const prospectQ = await supabase
    .from(PROSPECTS_TABLE)
    .select("id, email, full_name, company")
    .eq("id", draft.prospect_id)
    .maybeSingle();
  if (prospectQ.error) {
    return {
      ok: false,
      error: `Could not load prospect: ${prospectQ.error.message}`,
    };
  }
  if (!prospectQ.data) {
    return { ok: false, error: "Prospect not found." };
  }
  const prospect = prospectQ.data as { id: string; email: string };
  const recipient = prospect.email?.trim() ?? "";
  if (!recipient || recipient.endsWith(".invalid")) {
    // v0.4 synthesizer placeholder — never send to these.
    return {
      ok: false,
      error:
        "Prospect has no real email address (placeholder). Update the prospect record before sending.",
    };
  }

  // -- Already sent? (idempotence guard) -------------------------------

  const alreadyQ = await supabase
    .from(SENT_TABLE)
    .select("id")
    .eq("draft_id", draftId)
    .limit(1)
    .maybeSingle();
  if (alreadyQ.error) {
    return {
      ok: false,
      error: `Could not check send history: ${alreadyQ.error.message}`,
    };
  }
  if (alreadyQ.data) {
    return { ok: false, error: "This draft has already been sent." };
  }

  // -- Judge gate (decision must be "allow") ---------------------------

  const decision = await getLatestDecisionForDraft(draftId);
  if (!decision) {
    return {
      ok: false,
      error: "No judge decision for this draft. Re-run the judge before sending.",
    };
  }
  if (decision.decision !== "allow") {
    // Tay gate I — record the block.
    await recordTrustEvent("send", "blocked_by_judge", {
      draftId,
      decision: decision.decision,
    });
    return {
      ok: false,
      error: `Judge decision is "${decision.decision}". Only "allow" drafts are sendable.`,
    };
  }

  // -- Suppression gate (Tay gate E) ------------------------------------

  const suppressed = await isSuppressed(recipient);
  if (suppressed) {
    await recordTrustEvent("send", "blocked_by_suppression", {
      draftId,
      // Don't include the email in metadata — it'd leak into trust_events.
      // The orchestrator's job is to block; the suppression list is the
      // record of WHICH email is suppressed.
    });
    return {
      ok: false,
      error: "Recipient is on the suppression list.",
    };
  }

  // -- Refresh access token (throws on failure) ------------------------

  let accessToken: string;
  try {
    accessToken = await ensureFreshAccessToken();
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // -- Send -----------------------------------------------------------

  const sent = await sendEmail({
    accessToken,
    to: recipient,
    subject: draft.subject,
    body: draft.body,
  });
  if (!sent.ok) {
    // Gmail-side failure. Don't record as "sent" trust event — it wasn't.
    // v0.8+ may want a "send_attempt_failed" event type to power retries.
    return { ok: false, error: sent.error };
  }

  // -- Persist sent_message --------------------------------------------

  const insSent = await supabase.from(SENT_TABLE).insert({
    draft_id: draftId,
    prospect_id: prospect.id,
    gmail_message_id: sent.gmailMessageId,
    gmail_thread_id: sent.gmailThreadId,
    subject: draft.subject,
    body: draft.body,
    recipient_email: recipient,
  });
  if (insSent.error) {
    // Gmail did send. Don't unwind. Record audit anyway with a flag so
    // the user can see "send happened but local record failed".
    console.warn(
      "[send] sent_messages insert failed (Gmail send already happened):",
      insSent.error.message,
    );
  }

  // -- Audit (Tay gate F) ----------------------------------------------

  await appendAudit({
    action: "send.sent",
    payload: {
      draftId,
      prospectId: prospect.id,
      gmailMessageId: sent.gmailMessageId,
      // recipient_email is matched by the redactor's "email" key fragment
      // → appears as [redacted] in audit_log. We send it anyway because
      // the redactor is the source of truth for what's safe-at-rest.
      recipient_email: recipient,
      subject: draft.subject,
    },
  });

  // -- Trust event (Tay gate I) ----------------------------------------

  await recordTrustEvent("send", "sent", {
    gmailMessageId: sent.gmailMessageId,
    draftId,
  });

  return {
    ok: true,
    gmailMessageId: sent.gmailMessageId,
    gmailThreadId: sent.gmailThreadId,
    recipient,
  };
}
