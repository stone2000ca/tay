// Suppression check — Tay gate E (NOW LOAD-BEARING in v0.8).
//
// EVERY send path MUST call this BEFORE invoking the Gmail API. The
// orchestrator (lib/send/orchestrate.ts) is the single chokepoint that
// guarantees this — no other code is allowed to call Gmail directly.
//
// READ-VS-WRITE error contract:
//   - READ function — but it returns TRUE on uncertainty (the SAFER
//     default for brand safety). Returning FALSE on a read error would
//     mean "go ahead and send" when we can't actually verify the list,
//     which is the wrong way to fail for a single-tenant cold-outbound
//     tool. We'd rather under-send than over-send to a possibly-
//     suppressed prospect.
//
//   - If Supabase env is missing → TRUE (we can't check; play safe).
//   - If the DB read errors → TRUE (we can't check; play safe).
//   - If the lookup returns a row → TRUE (suppressed).
//   - If the lookup returns no row → FALSE (clear to send).
//
// Lookup is case-insensitive: the email is lowercased before query and
// the table stores lowercased emails (email_lower column).

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";

const TABLE = "suppression";

export async function isSuppressed(email: string): Promise<boolean> {
  if (!hasSupabaseEnv()) {
    // Safer default: pretend "yes, suppressed" when we can't check.
    // Documented in module header.
    console.warn(
      "[suppression] Supabase not configured — defaulting to SUPPRESSED (safe).",
    );
    return true;
  }

  const normalized = (email ?? "").trim().toLowerCase();
  if (!normalized) {
    // Empty/garbage input: treat as suppressed. The orchestrator should
    // never get here, but if it does, refuse to send.
    return true;
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("id")
      .eq("email_lower", normalized)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(
        "[suppression] read failed — defaulting to SUPPRESSED (safe):",
        error.message,
      );
      return true;
    }
    return Boolean(data);
  } catch (err) {
    console.warn(
      "[suppression] supabase unavailable — defaulting to SUPPRESSED (safe):",
      err instanceof Error ? err.message : String(err),
    );
    return true;
  }
}
