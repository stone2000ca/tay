// Format a VoiceRubric as a plain-English summary for the preview UI.
//
// The /setup/voice/preview page renders this summary so users can read
// what Tay learned and confirm/tweak before the sample-draft step.
// Each rubric field maps to a sentence-or-fragment; the function joins
// them into a 4-6 sentence paragraph.
//
// Pure function — no IO. UI is responsible for capitalization tweaks
// or escape concerns (it renders the string into a <p>; nothing here
// is HTML).

import type { VoiceRubric } from "./rubric-schema";

const FORMALITY_PHRASE: Record<VoiceRubric["formality"], string> = {
  casual: "casually",
  neutral: "with a neutral, professional tone",
  formal: "formally",
};

function sentenceLengthBucket(words: number): string {
  if (words <= 10) return "short, punchy sentences (about " + words + " words each)";
  if (words <= 16) return "tight sentences (about " + words + " words each)";
  if (words <= 22) return "medium-length sentences (about " + words + " words each)";
  return "longer, more flowing sentences (about " + words + " words each)";
}

function joinPhrases(items: string[], max: number): string {
  const slice = items.slice(0, max);
  if (slice.length === 0) return "";
  if (slice.length === 1) return `"${slice[0]}"`;
  if (slice.length === 2) return `"${slice[0]}" and "${slice[1]}"`;
  return slice.map((p, i) => (i === slice.length - 1 ? `and "${p}"` : `"${p}"`)).join(", ");
}

/**
 * Returns a 4-6 sentence plain-English summary of the rubric. Suitable
 * for rendering inside a single <p> in the preview UI. Always succeeds
 * — the rubric is contract-validated upstream.
 */
export function formatRubricInPlainEnglish(rubric: VoiceRubric): string {
  const parts: string[] = [];

  parts.push(
    `You write ${sentenceLengthBucket(rubric.avg_sentence_length_words)}, ${FORMALITY_PHRASE[rubric.formality]}.`,
  );

  // Opener style + signature pattern combined into one sentence —
  // they're closely related ("how do you start / how do you end").
  parts.push(
    `Openers tend to be ${lowercaseFirst(rubric.opener_style)}; sign-offs follow the pattern "${rubric.signature_pattern}".`,
  );

  if (rubric.common_phrases.length > 0) {
    parts.push(`Common phrases you reach for: ${joinPhrases(rubric.common_phrases, 5)}.`);
  } else {
    parts.push("No recurring phrases were extracted.");
  }

  if (rubric.avoid_phrases.length > 0) {
    parts.push(`Phrases to avoid: ${joinPhrases(rubric.avoid_phrases, 5)}.`);
  } else {
    parts.push("No phrases marked off-limits.");
  }

  // Tone notes already 1-3 sentences from the rubric — quote verbatim
  // since the rubric validator already capped its length and trimmed.
  parts.push(`Tone: ${rubric.tone_notes}`);

  return parts.join(" ");
}

function lowercaseFirst(s: string): string {
  if (s.length === 0) return s;
  return s[0].toLowerCase() + s.slice(1);
}
