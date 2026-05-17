// Judge decision schema — the strict contract for the v0.5 judge.
//
// The judge LLM returns JSON; we never trust shape until parseJudgeDecision
// validates it. This is Tay gate H (adversarial-input defense): even if
// the LLM is prompt-injected into emitting a malformed decision, the
// caller gets `null` and short-circuits to a degraded-mode UX instead of
// trusting attacker-shaped data.
//
// The four decisions:
//   - allow:    meets all gates; ship as-is
//   - block:    do not show; reasons enumerate which gate failed hard
//   - revise:   show with rewrite alongside; rewrite is the corrected draft
//   - escalate: human review needed; reasons describe what's ambiguous

export type JudgeAllow = { decision: "allow"; reasons: string[] };
export type JudgeBlock = { decision: "block"; reasons: string[] };
export type JudgeRevise = {
  decision: "revise";
  reasons: string[];
  rewrite: { subject: string; body: string };
};
export type JudgeEscalate = { decision: "escalate"; reasons: string[] };

export type JudgeDecision =
  | JudgeAllow
  | JudgeBlock
  | JudgeRevise
  | JudgeEscalate;

// Limits — sanity caps. The judge has no business emitting a 100-line
// reasons list or a 10kB rewrite.
export const JUDGE_LIMITS = {
  reasonMaxLen: 500,
  reasonsListMax: 10,
  rewriteSubjectMax: 200,
  rewriteBodyMax: 5000,
} as const;

/**
 * Hard validator for the LLM's JSON output. Returns null on any shape
 * violation. Extra fields are silently stripped. Strings are trimmed.
 *
 * Treat input as fully untrusted — it came from an LLM whose system
 * prompt instructs JSON output, but adversarial prospect notes may have
 * tried to derail it.
 */
export function parseJudgeDecision(input: unknown): JudgeDecision | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const decision = typeof o.decision === "string" ? o.decision : "";
  if (
    decision !== "allow" &&
    decision !== "block" &&
    decision !== "revise" &&
    decision !== "escalate"
  ) {
    return null;
  }

  const reasons = sanitizeReasons(o.reasons);
  if (reasons.length === 0) return null;

  if (decision === "revise") {
    const rewrite = sanitizeRewrite(o.rewrite);
    if (!rewrite) return null;
    return { decision: "revise", reasons, rewrite };
  }

  if (decision === "allow") return { decision: "allow", reasons };
  if (decision === "block") return { decision: "block", reasons };
  return { decision: "escalate", reasons };
}

function sanitizeReasons(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed.slice(0, JUDGE_LIMITS.reasonMaxLen));
    if (out.length >= JUDGE_LIMITS.reasonsListMax) break;
  }
  return out;
}

function sanitizeRewrite(
  value: unknown,
): { subject: string; body: string } | null {
  if (!value || typeof value !== "object") return null;
  const r = value as Record<string, unknown>;
  const subject = typeof r.subject === "string" ? r.subject.trim() : "";
  const body = typeof r.body === "string" ? r.body : "";
  if (subject.length === 0 || subject.length > JUDGE_LIMITS.rewriteSubjectMax) {
    return null;
  }
  if (body.trim().length === 0 || body.length > JUDGE_LIMITS.rewriteBodyMax) {
    return null;
  }
  return { subject, body };
}
