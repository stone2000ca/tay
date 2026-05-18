// Voice-calibration sample-count constants.
//
// One source of truth for both the UI (renders N textareas) and the
// extractor (validates that len is within [MIN, MAX]). Previously these
// numbers lived in two places — flagged by the v0.3 judge.
//
// v1.1.3 relaxation (P5): the minimum drops from 3 → 1. The wizard's
// "Paste 1+ sample emails" path accepts a single email as the rubric
// anchor (more is still better, capped at 10). The other 3 voice-cal
// paths (Q&A, URL bootstrap, zero-emails) fuse the single anchor with
// other inputs at the prompt level and still call extractVoiceRubric
// with a single-element samples array.

/** Default number of sample-email textareas the wizard renders. The
 *  /setup/voice/emails sub-page renders this many initial textareas
 *  even though the minimum is 1; gives the user room to paste more
 *  without re-clicking "add another".
 */
export const SAMPLE_COUNT = 3;

/** Minimum samples the extractor accepts. v1.1.3: relaxed to 1. */
export const SAMPLE_MIN_COUNT = 1;

/** Maximum samples the extractor accepts. */
export const SAMPLE_MAX_COUNT = 10;
