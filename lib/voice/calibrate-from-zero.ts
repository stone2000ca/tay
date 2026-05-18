// Voice calibration — Path 0: zero-emails fallback.
//
// The user has never sent a cold email. The wizard prompts them to
// write a short sample on the spot ("Write a 3-4 sentence cold email
// to a [role] at a [company type] about your [product category]").
// That sample IS the anchor — we route it through the existing
// extractVoiceRubric() single-sample path.
//
// This is a thin wrapper, not a separate LLM seam. The only reason it
// exists at all is so the wizard's action layer can dispatch to one
// of four named modules ("path X → calibrate-from-X") without each
// one needing to know about the single-sample minimum or that Path 0
// is just "one synthesized sample".

import { extractVoiceRubric } from "./calibrate";
import type { ExtractResult } from "./calibrate";

export type ZeroInputs = {
  /** The sample the user wrote in response to Tay's prompt. */
  userWrittenSample: string;
};

export async function extractRubricFromZero(
  inputs: ZeroInputs,
  opts: { model?: string } = {},
): Promise<ExtractResult> {
  const sample = (inputs.userWrittenSample ?? "").trim();
  if (sample.length === 0) {
    return {
      ok: false,
      error: "Write a short sample email so Tay can learn your voice.",
    };
  }
  // Single-sample path — the relaxed SAMPLE_MIN_COUNT=1 (v1.1.3) makes
  // this legal. extractVoiceRubric already wraps the sample in
  // <untrusted_source> (Tay gate H) and validates the LLM output via
  // parseRubric (Tay gate D).
  return extractVoiceRubric([sample], opts);
}
