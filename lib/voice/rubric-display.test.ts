// Tests for lib/voice/rubric-display.ts.

import { describe, expect, test } from "vitest";
import { formatRubricInPlainEnglish } from "./rubric-display";
import type { VoiceRubric } from "./rubric-schema";

function r(overrides: Partial<VoiceRubric> = {}): VoiceRubric {
  return {
    opener_style: "First-name greeting plus one observation about their team",
    avg_sentence_length_words: 14,
    formality: "neutral",
    signature_pattern: "First name only",
    common_phrases: ["quick thought", "would love to chat"],
    avoid_phrases: ["circle back", "synergy"],
    tone_notes: "Warm and concise.",
    ...overrides,
  };
}

describe("formatRubricInPlainEnglish", () => {
  test("includes sentence-length bucket + formality phrase", () => {
    const out = formatRubricInPlainEnglish(r({ avg_sentence_length_words: 8, formality: "casual" }));
    expect(out).toContain("short, punchy");
    expect(out).toContain("casually");
  });

  test("renders medium-length + neutral correctly", () => {
    const out = formatRubricInPlainEnglish(r({ avg_sentence_length_words: 20, formality: "neutral" }));
    expect(out).toContain("medium-length");
    expect(out).toContain("neutral");
  });

  test("renders long + formal correctly", () => {
    const out = formatRubricInPlainEnglish(r({ avg_sentence_length_words: 30, formality: "formal" }));
    expect(out).toContain("longer, more flowing");
    expect(out).toContain("formally");
  });

  test("quotes opener_style + signature_pattern", () => {
    const out = formatRubricInPlainEnglish(r());
    expect(out).toContain("First name only");
    expect(out.toLowerCase()).toContain("first-name greeting");
  });

  test("lists up to 5 common phrases in quotes", () => {
    const out = formatRubricInPlainEnglish(
      r({
        common_phrases: ["a", "b", "c", "d", "e", "f", "g"],
      }),
    );
    expect(out).toContain('"a"');
    expect(out).toContain('"e"');
    expect(out).not.toContain('"f"');
  });

  test("handles empty phrase lists gracefully", () => {
    const out = formatRubricInPlainEnglish(r({ common_phrases: [], avoid_phrases: [] }));
    expect(out).toContain("No recurring phrases");
    expect(out).toContain("No phrases marked off-limits");
  });

  test("includes the tone_notes verbatim", () => {
    const out = formatRubricInPlainEnglish(r({ tone_notes: "Direct. No fluff. Asks questions." }));
    expect(out).toContain("Direct. No fluff. Asks questions.");
  });
});
