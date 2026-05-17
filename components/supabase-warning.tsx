// Server component — renders a top-of-page warning banner when Supabase
// isn't linked yet. Mounted on pages whose actions depend on Supabase
// being configured (/setup/voice, /draft) so the user sees the gap
// before submitting a form that would fail downstream.
//
// Paper cut from v0.3 judge: /setup/voice used to wedge in a redirect
// loop on a fresh install with no Supabase wired. This banner short-
// circuits the confusion.

import { hasSupabaseEnv } from "@/lib/supabase/server";

export function SupabaseWarning() {
  if (hasSupabaseEnv()) return null;
  return (
    <div
      role="alert"
      className="mx-auto mt-6 max-w-2xl rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <strong className="font-medium">Supabase not configured.</strong>{" "}
      Link the Supabase integration via the Vercel Marketplace and set{" "}
      <code className="text-xs">NEXT_PUBLIC_SUPABASE_URL</code> +{" "}
      <code className="text-xs">SUPABASE_SERVICE_ROLE_KEY</code>. Until
      then, anything that needs to persist will fail at submit time.
    </div>
  );
}
