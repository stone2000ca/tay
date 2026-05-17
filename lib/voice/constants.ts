// Voice-calibration sample-count constants.
//
// One source of truth for both the UI (renders N textareas) and the
// extractor (validates that len is within [MIN, MAX]). Previously these
// numbers lived in two places — flagged by the v0.3 judge.

/** Number of sample-email textareas the wizard renders. Must be within [MIN, MAX]. */
export const SAMPLE_COUNT = 5;

/** Minimum samples the extractor accepts. */
export const SAMPLE_MIN_COUNT = 3;

/** Maximum samples the extractor accepts. */
export const SAMPLE_MAX_COUNT = 10;
