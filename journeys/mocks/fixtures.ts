// Shared test fixtures used across scenarios.

import type { VoiceRubric } from "../../lib/voice/rubric-schema";

export const fixtureRubric: VoiceRubric = {
  opener_style: "personalized first-name + observation",
  avg_sentence_length_words: 14,
  formality: "casual",
  signature_pattern: "First name only",
  common_phrases: ["quick thought", "what do you think"],
  avoid_phrases: ["circle back", "synergy"],
  tone_notes: "Warm, direct, never salesy.",
};

export const fixtureProspect = {
  id: "prospect-1",
  email: "alice@example.com",
  full_name: "Alice Founder",
  company: "Acme Co",
  notes: "Met at conference; runs ops.",
};

export function benignDraftJson(): string {
  return JSON.stringify({
    subject: "Quick thought on your ops process",
    body: "Hi Alice,\n\nNice work at Acme — wanted to send a quick thought on ops scaling.\n\nJames",
  });
}

export function judgeAllowJson(): string {
  return JSON.stringify({
    decision: "allow",
    reasons: ["disclosure present", "rubric formality honored", "no PII inferred"],
  });
}

export function judgeBlockJson(reason: string): string {
  return JSON.stringify({
    decision: "block",
    reasons: [reason, "policy violation"],
  });
}

export function judgeReviseJson(reason: string): string {
  return JSON.stringify({
    decision: "revise",
    reasons: [reason],
    rewrite: {
      subject: "Quick thought on your ops process",
      body:
        "Hi Alice,\n\nNice work at Acme — wanted to share a quick thought on ops scaling.\n\nJames\n\n— Written with AI assistance. Reply STOP to opt out.",
    },
  });
}
