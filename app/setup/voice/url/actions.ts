"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import { saveRubric } from "@/lib/voice/calibrate";
import { extractRubricFromUrl } from "@/lib/voice/calibrate-from-url";
import { appendAudit } from "@/lib/audit/append";

export type CalibrationResult =
  | { ok: true }
  | { ok: false; error: string };

export async function runUrlCalibration(inputs: {
  anchorEmail: string;
  companyUrl: string;
}): Promise<CalibrationResult> {
  await ensureSchema();

  const extracted = await extractRubricFromUrl(inputs);
  if (!extracted.ok) {
    return { ok: false, error: extracted.error };
  }

  try {
    await saveRubric(extracted.rubric, extracted.modelUsed, 1);
    await appendAudit({
      action: "voice.calibrated",
      payload: {
        path: "url",
        sample_count: 1,
        modelUsed: extracted.modelUsed,
        // Don't store the URL in the audit payload — could leak via
        // log streams. The wizard step that ran this lives in the
        // user's session memory; we don't need it server-side.
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save rubric: ${message}` };
  }

  return { ok: true };
}
