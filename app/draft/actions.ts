"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { generateDraft } from "@/lib/draft/generate";
import { upsertProspect, saveDraft } from "@/lib/draft/persist";
import { judgeDraft } from "@/lib/judge/judge";
import { saveJudgeDecision } from "@/lib/judge/persist";
import type { JudgeDecision } from "@/lib/judge/decision-schema";
import { appendAudit } from "@/lib/audit/append";

const NAME_MAX = 200;
const COMPANY_MAX = 200;
const NOTES_MAX = 2000;

export type DraftActionResult =
  | {
      ok: true;
      draft: { subject: string; body: string };
      draftId: string;
      decision?: JudgeDecision;
      judgeError?: string;
    }
  | { ok: false; error: string };

/**
 * Server action behind /draft.
 *
 * Pipeline:
 *   pre-flight env check (avoid wasted LLM call)
 *     → ensureSchema (cold-start guard)
 *       → input validation
 *         → generateDraft (LLM)
 *           → upsertProspect + saveDraft (WRITE — throws on failure)
 *             → judgeDraft (LLM; degraded-mode visibility if it fails)
 *               → saveJudgeDecision + appendAudit on success
 *                 → return draft + decision to UI
 *
 * Read-vs-write error contract: this action sits at the seam between the
 * "soft-fail to UI" READ world and the "throw + translate" WRITE world.
 * generateDraft and judgeDraft return discriminated unions (LLM calls);
 * the persist calls throw, which we catch here and translate.
 *
 * Degraded-mode note: a JUDGE failure does NOT block the user from
 * seeing the draft. We return the draft with a `judgeError` so the UI
 * can render a soft warning. Rationale: judge is critical for SEND
 * (v0.7+), not for display. v0.5 favors visibility over hard failure
 * here — easier to debug "judge LLM throttled" than a blank page.
 */
export async function generateAndSaveDraft(inputs: {
  full_name: string;
  company: string;
  notes?: string;
}): Promise<DraftActionResult> {
  // Pre-flight: if Supabase isn't wired, fail fast BEFORE the OpenRouter
  // call. Otherwise we burn money on a draft we can't persist.
  // (Paper cut from v0.4 judge.)
  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      error:
        "Supabase not configured. Link your project via the Vercel Marketplace before drafting.",
    };
  }

  // Cold-start guard — same justification as app/setup/voice/actions.ts.
  await ensureSchema();

  // Input validation. Keep strings sane and ASCII-printable so we don't
  // open subtle bidi/control-char attacks against the LLM. (Notes is
  // free-text and may include unicode — only length-bound that.)
  const full_name = inputs.full_name?.trim() ?? "";
  const company = inputs.company?.trim() ?? "";
  const notes = inputs.notes?.trim();

  if (full_name.length === 0 || full_name.length > NAME_MAX) {
    return { ok: false, error: `Prospect name is required (≤${NAME_MAX} chars).` };
  }
  if (!isAsciiPrintable(full_name)) {
    return {
      ok: false,
      error: "Prospect name must contain only printable ASCII characters.",
    };
  }
  if (company.length === 0 || company.length > COMPANY_MAX) {
    return { ok: false, error: `Company is required (≤${COMPANY_MAX} chars).` };
  }
  if (!isAsciiPrintable(company)) {
    return {
      ok: false,
      error: "Company must contain only printable ASCII characters.",
    };
  }
  if (notes && notes.length > NOTES_MAX) {
    return { ok: false, error: `Notes must be ≤${NOTES_MAX} chars.` };
  }

  // Generate.
  const generated = await generateDraft({
    prospect: { full_name, company, notes },
  });
  if (!generated.ok) {
    return { ok: false, error: generated.error };
  }

  // Persist draft. WRITE functions throw — catch and translate.
  let draftId: string;
  try {
    const { id: prospectId } = await upsertProspect({
      full_name,
      company,
      notes,
    });
    const saved = await saveDraft({
      prospectId,
      draft: generated.draft,
      rubric: generated.rubricUsed,
      promptInputs: { full_name, company, notes },
      modelUsed: generated.modelUsed,
    });
    draftId = saved.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save draft: ${message}` };
  }

  // Judge. Pass the rubric the drafter used so the judge enforces the
  // same contract that was generated against (no re-fetch drift).
  const judged = await judgeDraft({
    draft: generated.draft,
    prospectInputs: { full_name, company, notes },
    rubric: generated.rubricUsed,
  });

  if (!judged.ok) {
    // Degraded-mode visibility: surface the draft + judge error. v0.5
    // prefers debug-ability over hard failure here.
    console.warn("[draft] judge failed:", judged.error);
    return {
      ok: true,
      draft: generated.draft,
      draftId,
      judgeError: judged.error,
    };
  }

  // Persist judge decision. WRITE — throws. Catch + degrade-mode so the
  // user still sees the draft + decision (the decision is in-memory).
  try {
    await saveJudgeDecision({
      draftId,
      decision: judged.decision,
      modelUsed: judged.modelUsed,
      rubricSnapshot: judged.rubricUsed,
    });
  } catch (err) {
    console.warn(
      "[draft] judge decision persist failed:",
      err instanceof Error ? err.message : String(err),
    );
    // Still return the decision — caller benefits from seeing it even
    // if we couldn't save it. v0.6 audit-chain will detect the gap.
  }

  // Audit log — v0.5 stub. v0.6 wires the real hash chain.
  // Redact-by-default payload: only operational metadata, never the
  // body or reasons text (reasons can contain quoted draft fragments).
  await appendAudit({
    action: "judge.decision",
    payload: {
      draftId,
      decision: judged.decision.decision,
      modelUsed: judged.modelUsed,
    },
  });

  return {
    ok: true,
    draft: generated.draft,
    draftId,
    decision: judged.decision,
  };
}

function isAsciiPrintable(s: string): boolean {
  // 0x20 (space) through 0x7e (~). Excludes control chars and unicode.
  return /^[\x20-\x7e]+$/.test(s);
}
