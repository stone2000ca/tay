// Draft + prospect persistence for v0.4.
//
// READ-VS-WRITE ERROR CONTRACT (judge improvement carried from runs
// #002/#003 — applied here as a convention for the whole lib/draft tree):
//
//   - WRITE functions (upsertProspect, saveDraft) THROW on DB failure.
//     Callers are server actions; they catch and translate into a
//     user-facing { ok: false, error } shape. A silent "looked saved
//     but wasn't" would be a Tay correctness bug.
//
//   - READ functions (NOT shipped this milestone — a future getDraft(id)
//     belongs here) SOFT-FAIL to null. Page renders that depend on them
//     must always work. This is the same convention as getRubric() in
//     lib/voice/calibrate.ts and getAppConfig() in lib/app-config.ts.
//
// Single-tenant note: there is intentionally NO RLS here. Tay's service-
// role client bypasses RLS; tenant isolation isn't a concern in this
// architecture.

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";
import type { VoiceRubric } from "../voice/rubric-schema";
import type { ProspectInputs } from "./prompt";

const PROSPECTS_TABLE = "prospects";
const DRAFTS_TABLE = "drafts";

/**
 * Look up a prospect by (full_name, company); insert if not found.
 * Updates `notes` if the caller supplied one. Returns the prospect id.
 *
 * v0.4 caveat: schema requires `email` (NOT NULL from 0001_init.sql) but
 * the v0.4 UI doesn't collect it. We synthesize a placeholder of the
 * form `unknown+<full_name>@<company>.invalid` so the insert succeeds.
 * v0.5 introduces a proper email field on the form.
 *
 * WRITE function — throws on DB error.
 */
export async function upsertProspect(
  inputs: ProspectInputs,
): Promise<{ id: string }> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before saving drafts.",
    );
  }
  const supabase = getSupabaseServerClient();
  const full_name = inputs.full_name.trim();
  const company = inputs.company.trim();
  const notes = inputs.notes?.trim() ?? null;
  // v1.1.3: callers may now pass a real email (test-send + prospect
  // quick-add). When absent we fall back to the v0.4 synthesizer.
  const realEmail = inputs.email?.trim();

  const existing = await supabase
    .from(PROSPECTS_TABLE)
    .select("id")
    .eq("full_name", full_name)
    .eq("company", company)
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    throw new Error(`[persist] prospect select failed: ${existing.error.message}`);
  }

  if (existing.data?.id) {
    // If we now have a real email and the existing row is a v0.4
    // placeholder, upgrade it so future sends work without requiring
    // the user to re-add the prospect. (Same shape as notes upgrade.)
    const updates: { notes?: string; email?: string } = {};
    if (notes !== null) updates.notes = notes;
    if (realEmail) updates.email = realEmail;
    if (Object.keys(updates).length > 0) {
      const upd = await supabase
        .from(PROSPECTS_TABLE)
        .update(updates)
        .eq("id", existing.data.id);
      if (upd.error) {
        throw new Error(
          `[persist] prospect update failed: ${upd.error.message}`,
        );
      }
    }
    return { id: existing.data.id as string };
  }

  const ins = await supabase
    .from(PROSPECTS_TABLE)
    .insert({
      email: realEmail && realEmail.length > 0
        ? realEmail
        : synthesizePlaceholderEmail(full_name, company),
      full_name,
      company,
      notes,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data?.id) {
    throw new Error(
      `[persist] prospect insert failed: ${ins.error?.message ?? "no id returned"}`,
    );
  }
  return { id: ins.data.id as string };
}

/**
 * Insert a row into `drafts`. `rubric_snapshot` is the rubric used to
 * generate this draft (so v0.5+ can re-judge old drafts against the
 * voice contract in force AT generation time, not the current rubric).
 * `prompt_inputs` is the raw form input (so we can repro generation).
 *
 * WRITE function — throws on DB error.
 */
export async function saveDraft(args: {
  prospectId: string;
  draft: { subject: string; body: string };
  rubric: VoiceRubric;
  promptInputs: ProspectInputs;
  modelUsed: string;
}): Promise<{ id: string }> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before saving drafts.",
    );
  }
  const supabase = getSupabaseServerClient();
  const ins = await supabase
    .from(DRAFTS_TABLE)
    .insert({
      prospect_id: args.prospectId,
      subject: args.draft.subject,
      body: args.draft.body,
      model_used: args.modelUsed,
      rubric_snapshot: args.rubric,
      prompt_inputs: args.promptInputs,
    })
    .select("id")
    .single();
  if (ins.error || !ins.data?.id) {
    throw new Error(
      `[persist] draft insert failed: ${ins.error?.message ?? "no id returned"}`,
    );
  }
  return { id: ins.data.id as string };
}

/**
 * Read a single prospect by id. Used by the /draft?prospectId=... prefill
 * (v1.1.4 carry-forward from the v1.1.3 judge): the prospect-quickadd
 * step writes the prospect, then redirects to /draft so the user can
 * generate a real email — pre-fill the form fields with the prospect's
 * existing data so the user isn't asked to retype.
 *
 * READ function — soft-fails to null. Page render must always work.
 */
export async function getProspect(id: string): Promise<{
  id: string;
  full_name: string;
  company: string;
  notes: string | null;
  email: string;
} | null> {
  if (!hasSupabaseEnv() || !id) return null;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(PROSPECTS_TABLE)
      .select("id, full_name, company, notes, email")
      .eq("id", id)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as {
      id: string;
      full_name: string | null;
      company: string | null;
      notes: string | null;
      email: string | null;
    };
    return {
      id: row.id,
      full_name: row.full_name ?? "",
      company: row.company ?? "",
      notes: row.notes,
      email: row.email ?? "",
    };
  } catch (err) {
    console.warn(
      "[persist] getProspect failed:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

/**
 * Cheap count of all drafts. Used by the dashboard. Soft-fails to null
 * if Supabase isn't available — page render must always work.
 *
 * READ function — soft-fail to null.
 */
export async function getDraftCount(): Promise<number | null> {
  if (!hasSupabaseEnv()) return null;
  try {
    const supabase = getSupabaseServerClient();
    const { count, error } = await supabase
      .from(DRAFTS_TABLE)
      .select("*", { count: "exact", head: true });
    if (error) {
      console.warn("[persist] draft count failed:", error.message);
      return null;
    }
    return count ?? 0;
  } catch (err) {
    console.warn(
      "[persist] supabase unavailable for draft count:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

// ---------- internals ----------

function synthesizePlaceholderEmail(full_name: string, company: string): string {
  // The v0.1 schema declares prospects.email NOT NULL. v0.4 doesn't
  // collect email yet (v0.5 will add it to the form). Synthesize a
  // `.invalid` TLD placeholder — RFC 2606 reserved, guaranteed never to
  // route, makes "this is fake" obvious at a glance in the DB.
  const safeName = full_name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "unknown";
  const safeCompany = company.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "unknown";
  return `unknown+${safeName}@${safeCompany}.invalid`;
}
