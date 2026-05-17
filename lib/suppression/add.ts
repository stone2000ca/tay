// Suppression list — add / remove / list.
//
// READ-VS-WRITE error contract:
//   - WRITE (addSuppression, removeSuppression) THROWS on DB error or
//     missing Supabase env. The UI server-actions translate to a
//     friendly redirect with ?error=.
//   - READ (listSuppressions) soft-fails to [] so the /settings/suppression
//     page always renders, even if Supabase is unreachable.
//
// Idempotence: addSuppression uses upsert keyed on email_lower so calling
// it twice is a no-op for the second call (no UNIQUE violation). The
// upsert preserves the FIRST add — `reason` and `source` come from the
// first add, not the most recent one. Rationale: the original
// "user_unsubscribe" event is what matters historically; a later
// "manual_add" by the admin shouldn't overwrite the recipient's own
// opt-out reason.
//
// Always lowercases email before write — the table has a UNIQUE
// constraint on email_lower (see migration 0008).

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";

const TABLE = "suppression";

export type SuppressionReason =
  | "user_unsubscribe"
  | "bounce"
  | "complaint"
  | "manual_add";

const ALLOWED_REASONS: ReadonlyArray<SuppressionReason> = [
  "user_unsubscribe",
  "bounce",
  "complaint",
  "manual_add",
] as const;

export type SuppressionEntry = {
  email: string;
  reason: SuppressionReason;
  source: string;
  addedAt: string;
};

/**
 * Add an email to the suppression list. Idempotent on email_lower.
 *
 * WRITE function — throws on DB error or missing Supabase env.
 */
export async function addSuppression(args: {
  email: string;
  reason: SuppressionReason;
  source: string;
}): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before managing the suppression list.",
    );
  }
  const normalized = (args.email ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("addSuppression: email must be non-empty.");
  }
  if (!ALLOWED_REASONS.includes(args.reason)) {
    throw new Error(`addSuppression: invalid reason '${args.reason}'.`);
  }
  const source = (args.source ?? "").trim();
  if (!source) {
    throw new Error("addSuppression: source must be non-empty.");
  }

  const supabase = getSupabaseServerClient();
  // upsert with ignoreDuplicates:true — preserves first add. Re-clicking
  // an unsubscribe link doesn't change the original reason/source.
  const ins = await supabase
    .from(TABLE)
    .upsert(
      {
        email_lower: normalized,
        reason: args.reason,
        source,
      },
      { onConflict: "email_lower", ignoreDuplicates: true },
    );
  if (ins.error) {
    throw new Error(`[suppression] add failed: ${ins.error.message}`);
  }
}

/**
 * Remove an email from the suppression list. Idempotent — deleting a
 * non-existent row is success.
 *
 * WRITE function — throws on DB error or missing Supabase env.
 */
export async function removeSuppression(email: string): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before managing the suppression list.",
    );
  }
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("removeSuppression: email must be non-empty.");
  }
  const supabase = getSupabaseServerClient();
  const del = await supabase
    .from(TABLE)
    .delete()
    .eq("email_lower", normalized);
  if (del.error) {
    throw new Error(`[suppression] remove failed: ${del.error.message}`);
  }
}

/**
 * Look up a single suppression entry by email. Used by /u/[token] to
 * deterministically distinguish "first valid click" from "replay click"
 * BEFORE upserting — replaces the v0.8 5-second heuristic.
 *
 * READ function — soft-fails to null.
 */
export async function getSuppressionEntry(
  email: string,
): Promise<SuppressionEntry | null> {
  if (!hasSupabaseEnv()) return null;
  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) return null;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("email_lower, reason, source, added_at")
      .eq("email_lower", normalized)
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[suppression] entry lookup failed:", error.message);
      return null;
    }
    if (!data) return null;
    const row = data as {
      email_lower: string;
      reason: SuppressionReason;
      source: string;
      added_at: string;
    };
    return {
      email: row.email_lower,
      reason: row.reason,
      source: row.source,
      addedAt: row.added_at,
    };
  } catch (err) {
    console.warn(
      "[suppression] entry lookup unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * List the most recent suppression entries. Default 100.
 *
 * READ function — soft-fails to []. The settings page must always render.
 */
export async function listSuppressions(
  limit = 100,
): Promise<SuppressionEntry[]> {
  if (!hasSupabaseEnv()) return [];
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("email_lower, reason, source, added_at")
      .order("added_at", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn("[suppression] list failed:", error.message);
      return [];
    }
    if (!data) return [];
    return (
      data as Array<{
        email_lower: string;
        reason: SuppressionReason;
        source: string;
        added_at: string;
      }>
    ).map((row) => ({
      email: row.email_lower,
      reason: row.reason,
      source: row.source,
      addedAt: row.added_at,
    }));
  } catch (err) {
    console.warn(
      "[suppression] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
