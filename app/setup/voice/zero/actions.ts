"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import { saveRubric } from "@/lib/voice/calibrate";
import { extractRubricFromZero } from "@/lib/voice/calibrate-from-zero";
import { appendAudit } from "@/lib/audit/append";

export type CalibrationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function runZeroCalibration(inputs: {
  userWrittenSample: string;
}): Promise<CalibrationResult> {
  await ensureSchema();

  const extracted = await extractRubricFromZero(inputs);
  if (!extracted.ok) {
    return { ok: false, error: extracted.error };
  }
  try {
    await saveRubric(extracted.rubric, extracted.modelUsed, 1);
    await appendAudit({
      action: "voice.calibrated",
      payload: {
        path: "zero",
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
