"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import { saveRubric } from "@/lib/voice/calibrate";
import { extractRubricFromDescription } from "@/lib/voice/calibrate-from-description";
import { appendAudit } from "@/lib/audit/append";

export type CalibrationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function runDescribeCalibration(inputs: {
  anchorEmail: string;
  formality: "casual" | "neutral" | "formal";
  openerStyle: string;
  avoidPhrases: string;
  freeformNotes?: string;
}): Promise<CalibrationResult> {
  await ensureSchema();

  const extracted = await extractRubricFromDescription(inputs);
  if (!extracted.ok) {
    return { ok: false, error: extracted.error };
  }

  try {
    // sample_count = 1 (one anchor email — the Q&A isn't a sample).
    await saveRubric(extracted.rubric, extracted.modelUsed, 1);
    await appendAudit({
      action: "voice.calibrated",
      payload: {
        path: "describe",
        sample_count: 1,
        modelUsed: extracted.modelUsed,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save rubric: ${message}` };
  }

  return { ok: true };
}
