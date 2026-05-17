// Anon-key Supabase client (browser-safe, RLS-bound).
//
// Not used by v0.2 — defined for v0.3+ when we need non-privileged reads
// (e.g. user-facing dashboard fetches that should respect future RLS
// policies). Kept in the v0.2 PR so the import surface is stable.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function hasSupabaseAnonEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

export function getSupabaseAnonClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase anon client unavailable: missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  cached = createClient(url, key);
  return cached;
}
