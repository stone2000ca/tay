// Server-only Supabase client (service-role).
//
// Use this for privileged server-side reads/writes that bypass RLS. Tay is
// single-tenant — RLS isn't doing tenant isolation — but service-role is
// still the right call for anything the user themselves never sees the SQL of
// (migrations, audit log, internal config row).
//
// Lazy: we don't construct a client until something actually asks for one,
// so importing this file in a route that never runs server-side (or on a
// cold-start without env vars) doesn't blow up. `hasSupabaseEnv()` is a
// cheap probe for "should I use Supabase or fall back to the cookie?"

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function hasSupabaseEnv(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function getSupabaseServerClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    // Deliberately do NOT include the values in the message — keys are
    // sensitive and `url` is fine but pointless without `key`.
    throw new Error(
      "Supabase server client unavailable: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  cached = createClient(url, key, {
    auth: {
      // Server-only client — no session persistence, no auto-refresh.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return cached;
}
