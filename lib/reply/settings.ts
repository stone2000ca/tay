// Reply settings — single-row toggle for auto-reply drafting (v0.9).
//
// Auto-reply is OFF by default. The user explicitly flips it on; that
// toggle is a TRUST-TIER decision (Tay gate I) and is audited via
// "reply.auto_reply_toggled" + trust event "override_to_send" when ON.
//
// READ-VS-WRITE error contract:
//   - READ (getReplySettings) SOFT-FAILS to the OFF state. Page render
//     must always work; an unreachable DB renders "auto-reply OFF" which
//     is the safer default. The handler also defaults to OFF when read
//     returns null.
//   - WRITE (setAutoReplyEnabled) THROWS on DB error. The caller is a
//     server action that translates throws into a friendly redirect.
//
// Single-row pattern: deterministic SINGLE_ROW_ID — same approach as
// lib/oauth/persist.ts. Upsert keyed on id; never get more than one row.

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";

const TABLE = "reply_settings";
const SINGLE_ROW_ID = "00000000-0000-0000-0000-000000000001";

export type ReplySettings = {
  autoReplyEnabled: boolean;
};

/**
 * Read the (one and only) reply_settings row.
 *
 * READ — soft-fails to OFF.
 */
export async function getReplySettings(): Promise<ReplySettings> {
  if (!hasSupabaseEnv()) return { autoReplyEnabled: false };
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("auto_reply_enabled")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn("[reply/settings] read failed:", error.message);
      return { autoReplyEnabled: false };
    }
    if (!data) return { autoReplyEnabled: false };
    const v = (data as { auto_reply_enabled: boolean }).auto_reply_enabled;
    return { autoReplyEnabled: Boolean(v) };
  } catch (err) {
    console.warn(
      "[reply/settings] supabase unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return { autoReplyEnabled: false };
  }
}

/**
 * Set the toggle. Upserts on the deterministic SINGLE_ROW_ID so callers
 * never accumulate rows.
 *
 * WRITE — throws on DB error.
 */
export async function setAutoReplyEnabled(enabled: boolean): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before changing reply settings.",
    );
  }
  const supabase = getSupabaseServerClient();
  const ups = await supabase.from(TABLE).upsert(
    {
      id: SINGLE_ROW_ID,
      auto_reply_enabled: enabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (ups.error) {
    throw new Error(`[reply/settings] upsert failed: ${ups.error.message}`);
  }
}
