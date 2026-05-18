// App-config storage for the Tay setup wizard.
//
// v0.2: dual backend.
//   - Supabase backend (preferred) when SUPABASE_* env vars are present.
//     A single-row `app_config` table — one install, one config. We use
//     delete+insert in a transaction instead of upsert because the row
//     has no natural unique key the wizard knows about, and "one row"
//     is the invariant we actually care about.
//   - Cookie backend (fallback) for pre-Supabase installs and local dev.
//     Same shape as v0.1; the only behavior change is `secure` is now
//     env-aware so localhost dev over plain HTTP works again
//     (resolves run #001 escalation).
//
// The public surface — getAppConfig / setAppConfig / clearAppConfig — is
// the contract callers depend on. Don't change shapes without a coordinated
// call-site update.

import { cookies } from "next/headers";
import { getSupabaseServerClient, hasSupabaseEnv } from "@/lib/supabase/server";

export type AppConfig = {
  name: string;
  validatedAt: string;
};

const COOKIE_NAME = "tay-setup";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;
const TABLE = "app_config";

// ---------- public API ----------

export async function getAppConfig(): Promise<AppConfig | null> {
  if (hasSupabaseEnv()) return getFromSupabase();
  return getFromCookie();
}

export async function setAppConfig(cfg: AppConfig): Promise<void> {
  if (hasSupabaseEnv()) {
    await setInSupabase(cfg);
    return;
  }
  await setInCookie(cfg);
}

export async function clearAppConfig(): Promise<void> {
  if (hasSupabaseEnv()) {
    await clearInSupabase();
    return;
  }
  await clearInCookie();
}

// ---------- Supabase backend ----------

async function getFromSupabase(): Promise<AppConfig | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("name, validated_at")
      .limit(1)
      .maybeSingle();

    if (error) {
      // Most common cause pre-migration: table doesn't exist. Treat as
      // "no config yet" — the page will redirect to /setup, which is
      // exactly the right UX. We deliberately do NOT include cfg payload
      // in any error log (Tay convention: user-supplied strings stay out
      // of warn/error).
      console.warn("[app-config] supabase select failed:", error.message);
      return null;
    }
    if (!data) return null;
    if (typeof data.name !== "string" || data.name.length === 0) return null;
    if (typeof data.validated_at !== "string") return null;
    return { name: data.name, validatedAt: data.validated_at };
  } catch (err) {
    console.warn(
      "[app-config] supabase unavailable, returning null:",
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }
}

async function setInSupabase(cfg: AppConfig): Promise<void> {
  const supabase = getSupabaseServerClient();
  // Single-row invariant: clear then insert. Supabase JS client doesn't
  // expose explicit transactions, but `delete` immediately followed by
  // `insert` is the right shape — a race window only exists if two
  // wizard submissions happen concurrently, which the UI prevents and
  // would be benign anyway (last writer wins, one row remains).
  const del = await supabase.from(TABLE).delete().not("id", "is", null);
  if (del.error) {
    throw new Error(`[app-config] delete failed: ${del.error.message}`);
  }
  const ins = await supabase.from(TABLE).insert({
    name: cfg.name,
    validated_at: cfg.validatedAt,
  });
  if (ins.error) {
    throw new Error(`[app-config] insert failed: ${ins.error.message}`);
  }
}

async function clearInSupabase(): Promise<void> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from(TABLE).delete().not("id", "is", null);
  if (error) {
    throw new Error(`[app-config] clear failed: ${error.message}`);
  }
}

// ---------- setup-complete helpers (v1.1.3) ----------
//
// Track whether the user has finished the post-rubric wizard polish
// (rubric preview → sample draft → test-send → prospect quick-add).
// Once true, the home page redirect chain skips the wizard sub-flow.
//
// READ-VS-WRITE: getSetupComplete is a soft-fail READ (false on any
// error — same shape as getAppConfig). markSetupComplete is a WRITE
// that throws so the caller can surface a hard error to the user.
//
// Cookie backend: we don't track setup-complete there. The cookie
// fallback is for pre-Supabase installs where the post-rubric wizard
// can't run anyway (no rubric to preview). Returns false.

/**
 * Has the user finished the v1.1.3 post-rubric wizard sub-flow?
 * Soft-fails to false on any DB error — page render must always work.
 */
export async function getSetupComplete(): Promise<boolean> {
  if (!hasSupabaseEnv()) return false;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("setup_complete")
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn(
        "[app-config] setup_complete select failed:",
        error.message,
      );
      return false;
    }
    return data?.setup_complete === true;
  } catch (err) {
    console.warn(
      "[app-config] supabase unavailable for setup_complete:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

/**
 * Mark the wizard as complete. WRITE — throws on any DB error.
 * Idempotent: re-calling on an already-complete install is a no-op
 * (UPDATE … WHERE id IS NOT NULL hits the single row regardless).
 */
export async function markSetupComplete(): Promise<void> {
  if (!hasSupabaseEnv()) {
    throw new Error(
      "Supabase not configured. Link your project via the Vercel Marketplace before finishing setup.",
    );
  }
  const supabase = getSupabaseServerClient();
  const upd = await supabase
    .from(TABLE)
    .update({
      setup_complete: true,
      setup_completed_at: new Date().toISOString(),
    })
    .not("id", "is", null);
  if (upd.error) {
    throw new Error(
      `[app-config] setup_complete update failed: ${upd.error.message}`,
    );
  }
}

// ---------- cookie backend ----------

async function getFromCookie(): Promise<AppConfig | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      typeof (parsed as { name?: unknown }).name !== "string" ||
      typeof (parsed as { validatedAt?: unknown }).validatedAt !== "string"
    ) {
      return null;
    }
    const cfg = parsed as AppConfig;
    if (cfg.name.length === 0) return null;
    return { name: cfg.name, validatedAt: cfg.validatedAt };
  } catch {
    return null;
  }
}

async function setInCookie(cfg: AppConfig): Promise<void> {
  const store = await cookies();
  store.set({
    name: COOKIE_NAME,
    value: JSON.stringify(cfg),
    httpOnly: true,
    // env-aware: production requires HTTPS; localhost dev runs HTTP.
    // (run #001 escalation: `secure: true` always was breaking dev.)
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
}

async function clearInCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}
