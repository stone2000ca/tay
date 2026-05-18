"use server";

import { ensureSchema } from "@/lib/supabase/migrate";
import { getSupabaseServerClient, hasSupabaseEnv } from "@/lib/supabase/server";
import { parseRubric, type VoiceRubric } from "@/lib/voice/rubric-schema";
import { saveRubric } from "@/lib/voice/calibrate";
import { appendAudit } from "@/lib/audit/append";

export type SaveResult = { ok: true } | { ok: false; error: string };

type EditableInputs = {
  opener_style: string;
  avg_sentence_length_words: number;
  formality: string;
  signature_pattern: string;
  tone_notes: string;
  common_phrases: string[];
  avoid_phrases: string[];
};

/**
 * Persist a user-edited rubric. Re-runs the same parseRubric validator
 * the LLM-extraction path uses — gate D contract is identical whether
 * the rubric came from the LLM or the preview form. Malformed inputs
 * get a friendly error rather than a 500.
 */
export async function updateRubricAction(inputs: EditableInputs): Promise<SaveResult> {
  await ensureSchema();

  const candidate: unknown = {
    opener_style: inputs.opener_style,
    avg_sentence_length_words: inputs.avg_sentence_length_words,
    formality: typeof inputs.formality === "string" ? inputs.formality.toLowerCase() : inputs.formality,
    signature_pattern: inputs.signature_pattern,
    tone_notes: inputs.tone_notes,
    common_phrases: Array.isArray(inputs.common_phrases) ? inputs.common_phrases : [],
    avoid_phrases: Array.isArray(inputs.avoid_phrases) ? inputs.avoid_phrases : [],
  };

  const parsed: VoiceRubric | null = parseRubric(candidate);
  if (!parsed) {
    return {
      ok: false,
      error: "Some fields are invalid (check formality, sentence length, and required text fields).",
    };
  }

  try {
    // model_used="user-edited" so the audit chain reflects the edit
    // origin. sample_count carries 0 because the edit isn't a fresh
    // extraction — it's a manual override of an existing row.
    await saveRubric(parsed, "user-edited", 0);
    await appendAudit({
      action: "voice.calibrated",
      payload: { path: "preview-edit", sample_count: 0, modelUsed: "user-edited" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not save rubric: ${message}` };
  }
  return { ok: true };
}

/**
 * Wipe the calibrated rubric so the picker reads as "no rubric" on the
 * next /setup/voice visit. The user is then routed through one of the
 * four extraction paths from scratch.
 */
export async function recalibrateAction(): Promise<SaveResult> {
  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      error: "Supabase not configured. Link your project via the Vercel Marketplace.",
    };
  }
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase
      .from("voice_calibration")
      .delete()
      .not("id", "is", null);
    if (error) {
      return { ok: false, error: `Could not reset rubric: ${error.message}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Could not reset rubric: ${message}` };
  }
  return { ok: true };
}
