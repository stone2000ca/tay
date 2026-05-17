import { SupabaseWarning } from "@/components/supabase-warning";
import { DraftForm } from "./draft-form";

// Server component wrapper for /draft. Mounts the Supabase-warning
// banner (server-only — reads process.env via hasSupabaseEnv) above the
// client form. Same split-pattern as /setup/voice.

export default function DraftPage() {
  return (
    <>
      <SupabaseWarning />
      <DraftForm />
    </>
  );
}
