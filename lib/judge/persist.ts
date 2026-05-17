// Judge decision persistence for v0.5.
//
// READ-VS-WRITE ERROR CONTRACT (same convention as lib/draft/persist.ts):
//
//   - WRITE functions (saveJudgeDecision) THROW on DB failure. Callers
//     are server actions; they catch and translate into a user-facing
//     { ok: false, error } shape. A silent "looked saved but wasn't"
//     would be a Tay correctness bug — judge decisions are first-class
//     audit evidence; we cannot lose them silently.
//
//   - READ functions (getLatestDecisionForDraft) SOFT-FAIL to null.
//     Page renders that depend on them must always work. Same convention
//     as getRubric() in lib/voice/calibrate.ts and getAppConfig() in
//     lib/app-config.ts.
//
// Single-tenant note: no RLS; service-role client bypasses it anyway.

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";
import type { VoiceRubric } from "../voice/rubric-schema";
import {
  parseJudgeDecision,
  type JudgeDecision,
} from "./decision-schema";

const TABLE = "judge_decisions";

/**
 * Insert a row into `judge_decisions`. The rubric_snapshot is the rubric
 * the judge USED (carried from the drafter call so we don't re-fetch and
 * risk drift). `rewrite` is JSON-null when decision != "revise".
 *
 * WRITE function — throws on DB error.
 */
export async function saveJudgeDecision(args: {
  draftId: string;
  decision: JudgeDecision;
  modelUsed: string;
  rubricSnapshot: VoiceRubric;
}): Promise<{ id: string }> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before saving judge decisions.",
    );
  }
  const supabase = getSupabaseServerClient();
  const rewrite =
    args.decision.decision === "revise" ? args.decision.rewrite : null;

  const ins = await supabase
    .from(TABLE)
    .insert({
      draft_id: args.draftId,
      decision: args.decision.decision,
      reasons: args.decision.reasons,
      rewrite,
      model_used: args.modelUsed,
      rubric_snapshot: args.rubricSnapshot,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data?.id) {
    throw new Error(
      `[judge persist] decision insert failed: ${ins.error?.message ?? "no id returned"}`,
    );
  }
  return { id: ins.data.id as string };
}

/**
 * Read the most-recent decision for a draft. Soft-fails to null —
 * page render must always work. Returns null when Supabase isn't wired,
 * the table doesn't exist yet, no decision has been written for this
 * draft, or the stored row fails schema validation (corrupted).
 *
 * READ function — soft-fail to null.
 */
export async function getLatestDecisionForDraft(
  draftId: string,
): Promise<JudgeDecision | null> {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("decision, reasons, rewrite")
      .eq("draft_id", draftId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[judge persist] supabase select failed:", error.message);
      return null;
    }
    if (!data) return null;
    return parseJudgeDecision({
      decision: data.decision,
      reasons: data.reasons,
      rewrite: data.rewrite,
    });
  } catch (err) {
    console.warn(
      "[judge persist] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}
