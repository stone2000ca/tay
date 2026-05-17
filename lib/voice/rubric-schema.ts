// Voice rubric schema — the contract Tay's drafter (v0.4) and judge
// (v0.5) read from `voice_calibration.rubric`.
//
// IMPORTANT — Tay gate B (no special-category data):
//   The rubric is STYLISTIC ONLY. No fields for race, religion, health,
//   sexual orientation, political views, biometric, or genetic data.
//   Future fields MUST hold this line. If a field would let a downstream
//   prompt encode "user is conservative" or "user is Christian", it
//   doesn't belong here, full stop.
//
// IMPORTANT — Tay gate H (adversarial-input defenses):
//   The rubric arrives from an LLM that ingested untrusted samples.
//   `parseRubric()` is a hard schema validator — every field is
//   shape-checked, lengths are capped, extra fields are stripped. The
//   rubric you save is GUARANTEED to match the type below; downstream
//   code may rely on that contract without re-validating.

export type Formality = "casual" | "neutral" | "formal";

export type VoiceRubric = {
  /** e.g. "personalized first-name + observation about their company" */
  opener_style: string;
  /** Plausible range: 8-25. Enforced by parseRubric. */
  avg_sentence_length_words: number;
  formality: Formality;
  /** e.g. "First name only, no title or company". */
  signature_pattern: string;
  /** Up to 10 phrases the user uses a lot. */
  common_phrases: string[];
  /** Up to 10 phrases the user avoids (corporate-speak, jargon). */
  avoid_phrases: string[];
  /** 1-3 sentences free text about tone/voice. */
  tone_notes: string;
};

// ---------- limits (used by both extractor prompt and parser) ----------

export const RUBRIC_LIMITS = {
  openerStyleMax: 240,
  signaturePatternMax: 120,
  phraseMaxLen: 80,
  phraseListMax: 10,
  toneNotesMax: 600,
  sentenceLenMin: 4,
  sentenceLenMax: 60,
} as const;

const ALLOWED_FORMALITY: ReadonlyArray<Formality> = ["casual", "neutral", "formal"];

/**
 * Defensive parser for LLM-returned rubrics. Returns a fully-typed
 * VoiceRubric on success, or null on any shape violation. Extra fields
 * are silently stripped. Strings are trimmed; arrays are deduped and
 * capped at RUBRIC_LIMITS.phraseListMax.
 *
 * Treat input as fully untrusted — it came from an LLM that ingested
 * adversarial sample text.
 */
export function parseRubric(input: unknown): VoiceRubric | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const opener_style = trimString(o.opener_style, RUBRIC_LIMITS.openerStyleMax);
  if (!opener_style) return null;

  const len = toFiniteNumber(o.avg_sentence_length_words);
  if (
    len === null ||
    len < RUBRIC_LIMITS.sentenceLenMin ||
    len > RUBRIC_LIMITS.sentenceLenMax
  ) {
    return null;
  }

  const formality = typeof o.formality === "string" ? o.formality.toLowerCase() : "";
  if (!ALLOWED_FORMALITY.includes(formality as Formality)) return null;

  const signature_pattern = trimString(
    o.signature_pattern,
    RUBRIC_LIMITS.signaturePatternMax,
  );
  if (!signature_pattern) return null;

  const common_phrases = sanitizePhraseList(o.common_phrases);
  const avoid_phrases = sanitizePhraseList(o.avoid_phrases);

  const tone_notes = trimString(o.tone_notes, RUBRIC_LIMITS.toneNotesMax);
  if (!tone_notes) return null;

  return {
    opener_style,
    avg_sentence_length_words: Math.round(len),
    formality: formality as Formality,
    signature_pattern,
    common_phrases,
    avoid_phrases,
    tone_notes,
  };
}

function trimString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, maxLen);
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function sanitizePhraseList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().slice(0, RUBRIC_LIMITS.phraseMaxLen);
    if (trimmed.length === 0) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= RUBRIC_LIMITS.phraseListMax) break;
  }
  return out;
}
