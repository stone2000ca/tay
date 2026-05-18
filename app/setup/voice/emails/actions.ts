"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import {
  extractVoiceRubric,
  saveRubric,
} from "@/lib/voice/calibrate";
import { appendAudit } from "@/lib/audit/append";

export type CalibrationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function runEmailsCalibration(
  samples: string[],
): Promise<CalibrationResult> {
  await ensureSchema();

  const extracted = await extractVoiceRubric(samples);
  if (!extracted.ok) {
    return { ok: false, error: extracted.error };
  }

  try {
    await saveRubric(extracted.rubric, extracted.modelUsed, samples.length);
    // Tay gate F: rubric writes are auditable. Only operational
    // metadata (no rubric contents) — the rubric itself lives in
    // voice_calibration where it can be re-read.
    await appendAudit({
      action: "voice.calibrated",
      payload: {
        path: "emails",
        sample_count: samples.length,
        modelUsed: extracted.modelUsed,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save rubric: ${message}` };
  }

  return { ok: true };
}
