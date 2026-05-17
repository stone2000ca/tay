// Send orchestrator — the SINGLE chokepoint for "send a draft" in Tay.
//
// v1.1.2: channel-aware. The orchestrator dispatches to either the
// Gmail OAuth transport (lib/send/gmail.ts) OR the SMTP transport
// (lib/send/smtp.ts) based on what kind of mailbox the user connected.
// The chokepoint property is preserved — no caller is allowed to invoke
// the channel modules directly. Going through this seam guarantees
// every send goes through:
//
//   1. App config exists (the user has finished setup)
//   2. Voice rubric exists (the drafter contract is in force) — Tay
//      gate D enforced UPSTREAM at draft time; orchestrator confirms
//      via presence.
//   3. Supabase configured (we can record the send)
//   4. Mailbox connected (kind: oauth | app_password) — Tay gate E's
//      precondition; without it we have nowhere to send.
//   5. Judge decision = "allow" — Tay gate C disclosure was verified
//      upstream by the v0.5 judge; revise/block/escalate never reach
//      here. Tay gate I trust event for blocks lives here.
//   6. isSuppressed(recipient) — Tay gate E. Called BEFORE the channel
//      branch so suppression-respect is identical across both
//      transports. (Asserted by gate-ordering test for BOTH channels.)
//   7. Channel branch:
//        - oauth → ensureFreshAccessToken + sendEmail (gmail.ts)
//        - app_password → sendEmailViaSmtp (smtp.ts) — no token refresh
//   8. Persist sent_messages row (column name gmail_message_id is
//      legacy; v1.1.2 stores the provider's message-id there
//      regardless of channel — rename out of scope).
//   9. appendAudit("send.sent", channel) — Tay gate F.
//  10. recordTrustEvent("send", "sent", channel) — Tay gate I.
//
// Each precondition failure returns a friendly { ok: false, error } so
// the network calls are never burned for a known-bad request.
//
// Tay gate C reminder: disclosure footer is applied at draft generation
// (drafter wraps with withDisclosure). SMTP/Gmail transports BOTH carry
// the body unchanged, so the gate-C invariant is preserved across both
// channels by construction.
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
import { sendEmailViaSmtp } from "./smtp";
import { isSuppressed } from "../suppression/check";
import { recordTrustEvent } from "../trust/record";
import { getMailboxCredentials } from "../mailbox/persist";

const DRAFTS_TABLE = "drafts";
const PROSPECTS_TABLE = "prospects";
const SENT_TABLE = "sent_messages";

export type SendDraftResult =
  | {
      ok: true;
      /** Legacy field name; populated regardless of channel. */
      gmailMessageId: string;
      /** Gmail-only. SMTP has no native thread id; empty string in that case. */
      gmailThreadId: string;
      recipient: string;
      channel: "oauth" | "app_password";
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

  // v1.1.2: channel-agnostic mailbox precondition. Soft-fails to null
  // when no mailbox is connected; we need to surface a friendly error
  // BEFORE any of the per-draft loads run.
  const mailbox = await getMailboxCredentials();
  if (!mailbox) {
    return {
      ok: false,
      error:
        "Connect a mailbox in Settings before sending (Gmail OAuth or SMTP App Password).",
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
      channel: mailbox.kind,
    });
    return {
      ok: false,
      error: `Judge decision is "${decision.decision}". Only "allow" drafts are sendable.`,
    };
  }

  // -- Suppression gate (Tay gate E) ------------------------------------
  //
  // Placed BEFORE the channel branch so it applies uniformly to both
  // OAuth and SMTP transports. The gate-ordering test asserts this for
  // both channels — moving the check inside one branch would break the
  // invariant.

  const suppressed = await isSuppressed(recipient);
  if (suppressed) {
    await recordTrustEvent("send", "blocked_by_suppression", {
      draftId,
      channel: mailbox.kind,
      // Don't include the email in metadata — it'd leak into trust_events.
      // The orchestrator's job is to block; the suppression list is the
      // record of WHICH email is suppressed.
    });
    return {
      ok: false,
      error: "Recipient is on the suppression list.",
    };
  }

  // -- Channel branch --------------------------------------------------
  //
  // SHAPES:
  //   - oauth path returns { gmailMessageId, gmailThreadId }
  //   - smtp path returns { messageId, threadId? } (threadId undefined)
  // Normalize at the seam so the persist + audit + trust paths below
  // see a single shape.

  type Sent =
    | { ok: true; providerMessageId: string; providerThreadId: string }
    | { ok: false; error: string };

  let sent: Sent;
  if (mailbox.kind === "oauth") {
    let accessToken: string;
    try {
      accessToken = await ensureFreshAccessToken();
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
    const result = await sendEmail({
      accessToken,
      to: recipient,
      subject: draft.subject,
      body: draft.body,
    });
    sent = result.ok
      ? {
          ok: true,
          providerMessageId: result.gmailMessageId,
          providerThreadId: result.gmailThreadId,
        }
      : { ok: false, error: result.error };
  } else {
    // app_password
    const result = await sendEmailViaSmtp({
      host: mailbox.smtpHost,
      port: mailbox.smtpPort,
      username: mailbox.emailAddress,
      password: mailbox.password,
      fromAddress: mailbox.emailAddress,
      to: recipient,
      subject: draft.subject,
      body: draft.body,
    });
    sent = result.ok
      ? {
          ok: true,
          providerMessageId: result.messageId,
          providerThreadId: result.threadId ?? "",
        }
      : { ok: false, error: result.error };
  }
  if (!sent.ok) {
    // Channel-side failure. Don't record as "sent" trust event — it wasn't.
    return { ok: false, error: sent.error };
  }

  // -- Persist sent_message --------------------------------------------
  //
  // Same row already-attempted-by-a-concurrent-caller? The v0.8 UNIQUE
  // constraint on sent_messages.draft_id (migration 0008) will reject
  // the insert with a duplicate-key error. The read-then-write check
  // above (already-sent guard) covers the SEQUENTIAL case nicely; this
  // catches the CONCURRENT case where two callers both got past the
  // read. The provider was called (we can't undo it), but at least we
  // surface a clear error and don't double-record.

  const insSent = await supabase.from(SENT_TABLE).insert({
    draft_id: draftId,
    prospect_id: prospect.id,
    gmail_message_id: sent.providerMessageId,
    gmail_thread_id: sent.providerThreadId,
    subject: draft.subject,
    body: draft.body,
    recipient_email: recipient,
  });
  if (insSent.error) {
    if (isUniqueViolation(insSent.error)) {
      console.warn(
        "[send] sent_messages UNIQUE violation — concurrent send detected for draft",
        draftId,
      );
      // Friendly error matching the sequential-case message so the UI
      // behaves identically. Don't audit (the winner of the race will).
      return {
        ok: false,
        error: "This draft has already been sent.",
      };
    }
    // Send did happen. Don't unwind. Record audit anyway with a flag so
    // the user can see "send happened but local record failed".
    console.warn(
      "[send] sent_messages insert failed (provider send already happened):",
      insSent.error.message,
    );
  }

  // -- Audit (Tay gate F) ----------------------------------------------

  await appendAudit({
    action: "send.sent",
    payload: {
      draftId,
      prospectId: prospect.id,
      // v1.1.2: channel field — distinguishes oauth vs app_password sends
      // in the audit log so the hash chain reflects which transport.
      channel: mailbox.kind,
      // Legacy field name kept for log-stream compat; populated for both
      // channels (SMTP uses the generated Message-ID).
      providerMessageId: sent.providerMessageId,
      // recipient_email is matched by the redactor's "email" key fragment
      // → appears as [redacted] in audit_log. We send it anyway because
      // the redactor is the source of truth for what's safe-at-rest.
      recipient_email: recipient,
      subject: draft.subject,
    },
  });

  // -- Trust event (Tay gate I) ----------------------------------------

  await recordTrustEvent("send", "sent", {
    providerMessageId: sent.providerMessageId,
    draftId,
    channel: mailbox.kind,
  });

  return {
    ok: true,
    gmailMessageId: sent.providerMessageId,
    gmailThreadId: sent.providerThreadId,
    recipient,
    channel: mailbox.kind,
  };
}

/**
 * Detect a Postgres unique-constraint violation on the sent_messages
 * UNIQUE index added in migration 0008. Supabase surfaces the pg error
 * code (23505) as `error.code` and the constraint name in `message`.
 * We sniff both so the detection survives small Supabase JS upgrades.
 */
function isUniqueViolation(error: {
  code?: string;
  message?: string;
}): boolean {
  if (error.code === "23505") return true;
  const msg = (error.message ?? "").toLowerCase();
  return (
    msg.includes("duplicate key") ||
    msg.includes("sent_messages_draft_id_unique") ||
    msg.includes("unique constraint")
  );
}
