"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import { generateDraft } from "@/lib/draft/generate";
import { upsertProspect, saveDraft } from "@/lib/draft/persist";

const NAME_MAX = 200;
const COMPANY_MAX = 200;
const NOTES_MAX = 2000;

export type DraftActionResult =
  | { ok: true; draft: { subject: string; body: string } }
  | { ok: false; error: string };

/**
 * Server action behind /draft.
 *
 * Pipeline: ensureSchema (cold-start guard) → input validation →
 * generateDraft (LLM) → upsertProspect + saveDraft.
 *
 * Read-vs-write error contract: this action sits at the seam between the
 * "soft-fail to UI" READ world and the "throw + translate" WRITE world.
 * generateDraft itself returns a discriminated union (LLM call); the
 * persist calls throw, which we catch here and translate.
 */
export async function generateAndSaveDraft(inputs: {
  full_name: string;
  company: string;
  notes?: string;
}): Promise<DraftActionResult> {
  // Cold-start guard — same justification as app/setup/voice/actions.ts.
  // A fresh Vercel function instance hitting this POST first (no prior
  // GET to /) needs the schema bootstrap to have run before saveDraft.
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

  // Persist. WRITE functions throw — catch and translate.
  try {
    const { id: prospectId } = await upsertProspect({
      full_name,
      company,
      notes,
    });
    await saveDraft({
      prospectId,
      draft: generated.draft,
      rubric: generated.rubricUsed,
      promptInputs: { full_name, company, notes },
      modelUsed: generated.modelUsed,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save draft: ${message}` };
  }

  return { ok: true, draft: generated.draft };
}

function isAsciiPrintable(s: string): boolean {
  // 0x20 (space) through 0x7e (~). Excludes control chars and unicode.
  return /^[\x20-\x7e]+$/.test(s);
}
