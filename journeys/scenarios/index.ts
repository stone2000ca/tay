// Scenario registry — keep this list in lexicographic order so output
// is deterministic across runs.

import { journey as coldDraftHappyPath } from "./cold-draft-happy-path.journey";
import { journey as prospectNotesPromptInjection } from "./prospect-notes-prompt-injection.journey";
import { journey as specialCategoryMentionInNotes } from "./special-category-mention-in-notes.journey";
import { journey as disclosureFooterRegression } from "./disclosure-footer-regression.journey";
import { journey as rubricDriftFormality } from "./rubric-drift-formality.journey";
import { journey as sendToSuppressedProspect } from "./send-to-suppressed-prospect.journey";
import { journey as auditChainIntegrity } from "./audit-chain-integrity.journey";
import { journey as adversarialReplyIgnoreInstructions } from "./adversarial-reply-ignore-instructions.journey";
import { journey as adversarialReplyTagInjection } from "./adversarial-reply-tag-injection.journey";
import { journey as autoReplyTierPromotionPath } from "./auto-reply-tier-promotion-path.journey";

import type { Journey } from "../types";

export const scenarios: ReadonlyArray<Journey> = [
  coldDraftHappyPath,
  prospectNotesPromptInjection,
  specialCategoryMentionInNotes,
  disclosureFooterRegression,
  rubricDriftFormality,
  sendToSuppressedProspect,
  auditChainIntegrity,
  adversarialReplyIgnoreInstructions,
  adversarialReplyTagInjection,
  autoReplyTierPromotionPath,
];
