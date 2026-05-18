"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import { getMailboxCredentials } from "@/lib/mailbox/persist";
import { generateDraft } from "@/lib/draft/generate";
import { upsertProspect, saveDraft } from "@/lib/draft/persist";
import { judgeDraft } from "@/lib/judge/judge";
import { saveJudgeDecision } from "@/lib/judge/persist";
import { sendDraft } from "@/lib/send/orchestrate";

export type TestSendResult =
  | { ok: true; recipient: string }
  | { ok: false; error: string };

// Test-send recipient identity. Used for the synthetic prospect row so
// the orchestrator's prospect-lookup finds something to send to.
const TEST_PROSPECT_NAME = "Tay Setup Test";
const TEST_PROSPECT_COMPANY = "Self-test";
const TEST_PROSPECT_NOTES =
  "Test-send during voice calibration. You're sending this to yourself to confirm the full pipeline works.";

/**
 * Drive the FULL send pipeline against the user's own mailbox so every
 * gate fires (suppression check, judge, audit, trust event). No bypass
 * — the orchestrator chokepoint is the integration test.
 */
export async function sendTestEmailAction(): Promise<TestSendResult> {
  await ensureSchema();

  const mailbox = await getMailboxCredentials();
  if (!mailbox) {
    return {
      ok: false,
      error: "Connect a mailbox first (/setup/mailbox).",
    };
  }
  const recipient = mailbox.emailAddress;

  // 1. Generate the draft using the user's calibrated rubric. The
  //    drafter applies the disclosure footer (Tay gate C) and wraps
  //    prospect-supplied strings in <untrusted_source> (Tay gate H).
  const generated = await generateDraft({
    prospect: {
      full_name: TEST_PROSPECT_NAME,
      company: TEST_PROSPECT_COMPANY,
      notes: TEST_PROSPECT_NOTES,
      email: recipient,
    },
  });
  if (!generated.ok) {
    return { ok: false, error: generated.error };
  }

  // 2. Persist the prospect (with the REAL recipient email so the
  //    orchestrator doesn't bail on the .invalid placeholder) and the
  //    draft.
  let draftId: string;
  let prospectId: string;
  try {
    const prospect = await upsertProspect({
      full_name: TEST_PROSPECT_NAME,
      company: TEST_PROSPECT_COMPANY,
      notes: TEST_PROSPECT_NOTES,
      email: recipient,
    });
    prospectId = prospect.id;
    const saved = await saveDraft({
      prospectId,
      draft: generated.draft,
      rubric: generated.rubricUsed,
      promptInputs: {
        full_name: TEST_PROSPECT_NAME,
        company: TEST_PROSPECT_COMPANY,
        notes: TEST_PROSPECT_NOTES,
        email: recipient,
      },
      modelUsed: generated.modelUsed,
    });
    draftId = saved.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save test draft: ${message}` };
  }

  // 3. Run the judge. Same contract the production pipeline uses.
  // Judge's ProspectInputs doesn't take an email field (judge reasons
  // about content, not recipient routing) — so we omit it here even
  // though generate + persist pass one.
  const judged = await judgeDraft({
    draft: generated.draft,
    prospectInputs: {
      full_name: TEST_PROSPECT_NAME,
      company: TEST_PROSPECT_COMPANY,
      notes: TEST_PROSPECT_NOTES,
    },
    rubric: generated.rubricUsed,
  });
  if (!judged.ok) {
    return {
      ok: false,
      error: `Judge unavailable: ${judged.error}. Try again in a moment.`,
    };
  }
  try {
    await saveJudgeDecision({
      draftId,
      decision: judged.decision,
      modelUsed: judged.modelUsed,
      rubricSnapshot: judged.rubricUsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save judge decision: ${message}` };
  }

  if (judged.decision.decision !== "allow") {
    // Judge wants a revision on a test email Tay drafted for the user
    // themselves — unusual, but the gate fires identically for any
    // recipient. Surface the decision so the user understands.
    return {
      ok: false,
      error: `Judge returned "${judged.decision.decision}" — not "allow". Try recalibrating your voice rubric and re-sending.`,
    };
  }

  // 4. Send through the FULL orchestrator chokepoint. Suppression check
  //    fires (Tay gate E), trust event records on success (gate I),
  //    audit row written (gate F), channel-appropriate transport.
  const sent = await sendDraft(draftId);
  if (!sent.ok) {
    return { ok: false, error: sent.error };
  }

  return { ok: true, recipient };
}
