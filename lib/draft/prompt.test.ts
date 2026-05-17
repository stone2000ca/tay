// Tests for lib/draft/prompt.ts.
//
// Focus: the system prompt is the rubric contract (Tay gate D). Every
// rubric field must appear verbatim. The user prompt must wrap prospect
// inputs in <untrusted_source> blocks (Tay gate H). System prompt must
// also carry the special-category defense-in-depth rule (Tay gate B).

import { describe, expect, test } from "vitest";
import { buildDraftMessages } from "./prompt";
import type { VoiceRubric } from "../voice/rubric-schema";

const rubric: VoiceRubric = {
  opener_style: "personalized first-name + observation about their team",
  avg_sentence_length_words: 14,
  formality: "neutral",
  signature_pattern: "First name only, no title",
  common_phrases: ["quick thought", "would love to learn", "open to a chat?"],
  avoid_phrases: ["circle back", "synergy", "low-hanging fruit"],
  tone_notes: "Warm, concise, slightly informal. Asks questions instead of telling.",
};

describe("buildDraftMessages", () => {
  test("system prompt includes every rubric field verbatim", () => {
    const { system } = buildDraftMessages({
      rubric,
      prospect: { full_name: "Jordan", company: "Acme" },
    });

    // Each field of the rubric should appear somewhere in the system
    // prompt — it's the contract, not a hint.
    expect(system).toContain(rubric.opener_style);
    expect(system).toContain(String(rubric.avg_sentence_length_words));
    expect(system).toContain(rubric.formality);
    expect(system).toContain(rubric.signature_pattern);
    expect(system).toContain(rubric.tone_notes);
    for (const phrase of rubric.common_phrases) {
      expect(system).toContain(phrase);
    }
    for (const phrase of rubric.avoid_phrases) {
      expect(system).toContain(phrase);
    }
  });

  test("system prompt forbids special-category inference (Tay gate B)", () => {
    const { system } = buildDraftMessages({
      rubric,
      prospect: { full_name: "Jordan", company: "Acme" },
    });
    // The exact wording can change; the protected categories must be named.
    expect(system).toMatch(/race/i);
    expect(system).toMatch(/religion/i);
    expect(system).toMatch(/health/i);
    expect(system).toMatch(/sexual orientation/i);
    expect(system).toMatch(/political/i);
    expect(system).toMatch(/biometric/i);
    expect(system).toMatch(/genetic/i);
  });

  test("system prompt instructs JSON-only output with subject + body keys", () => {
    const { system } = buildDraftMessages({
      rubric,
      prospect: { full_name: "Jordan", company: "Acme" },
    });
    expect(system).toMatch(/JSON/);
    expect(system).toContain("subject");
    expect(system).toContain("body");
  });

  test("user prompt wraps prospect inputs in <untrusted_source> blocks", () => {
    const { user } = buildDraftMessages({
      rubric,
      prospect: {
        full_name: "Jordan Riley",
        company: "Acme Robotics",
        notes: "Just shipped their analytics rewrite.",
      },
    });

    // Each field should appear inside an <untrusted_source> wrapper.
    expect(user).toContain('<untrusted_source field="full_name">');
    expect(user).toContain("Jordan Riley");
    expect(user).toContain('<untrusted_source field="company">');
    expect(user).toContain("Acme Robotics");
    expect(user).toContain('<untrusted_source field="notes">');
    expect(user).toContain("Just shipped their analytics rewrite.");
  });

  test("user prompt omits notes block when notes is empty", () => {
    const { user } = buildDraftMessages({
      rubric,
      prospect: { full_name: "Jordan", company: "Acme" },
    });
    expect(user).not.toContain('field="notes"');
  });

  test("system prompt does NOT include the AI disclosure footer (appended post-gen)", () => {
    const { system } = buildDraftMessages({
      rubric,
      prospect: { full_name: "Jordan", company: "Acme" },
    });
    // The footer is post-generation; if we asked the model to include it,
    // the idempotency check in withDisclosure would still hold, but we'd
    // muddy the contract. Just assert the model is told NOT to add one.
    expect(system).toMatch(/do not include.*disclosure/i);
  });
});
