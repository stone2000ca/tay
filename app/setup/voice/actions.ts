"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import {
  extractVoiceRubric,
  saveRubric,
  type VoiceRubric,
} from "@/lib/voice/calibrate";

export type CalibrationResult =
  | { ok: true; rubric: VoiceRubric; modelUsed: string }
  | { ok: false; error: string };

/**
 * Server action behind the /setup/voice form.
 *
 * Pipeline: ensureSchema (cold-start guard — same pattern as the wizard
 * step 1) → extract → save. Errors at any step bubble up as a string
 * that the UI renders verbatim. We deliberately do not echo the user's
 * sample emails back in error messages (they could be sensitive).
 */
export async function runVoiceCalibration(
  samples: string[],
): Promise<CalibrationResult> {
  // Cold-start guard: same justification as app/setup/actions.ts.
  // Without this, a fresh Vercel function instance landing on a POST
  // could hit `saveRubric` before any GET triggered the bootstrap, and
  // the underlying voice_calibration table wouldn't exist yet.
  await ensureSchema();

  const extracted = await extractVoiceRubric(samples);
  if (!extracted.ok) {
    return { ok: false, error: extracted.error };
  }

  try {
    await saveRubric(extracted.rubric, extracted.modelUsed, samples.length);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save rubric: ${message}` };
  }

  return {
    ok: true,
    rubric: extracted.rubric,
    modelUsed: extracted.modelUsed,
  };
}
