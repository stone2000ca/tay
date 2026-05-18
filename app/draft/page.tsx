import { SupabaseWarning } from "@/components/supabase-warning";
import { DraftForm } from "./draft-form";
import { getProspect } from "@/lib/draft/persist";

// Server component wrapper for /draft. Mounts the Supabase-warning
// banner (server-only — reads process.env via hasSupabaseEnv) above the
// client form. Same split-pattern as /setup/voice.
//
// v1.1.4 carry-forward (from v1.1.3 judge):
// /draft?prospectId=<uuid> pre-fills the form so the prospect-quickadd
// flow can hand off directly into a "now draft to this person" page
// without making the user retype name/company/notes.

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<{ prospectId?: string }>;
}) {
  const params = await searchParams;
  const prospectId = (params.prospectId ?? "").trim();
  const prospect = prospectId ? await getProspect(prospectId) : null;

  const prefill = prospect
    ? {
        full_name: prospect.full_name,
        company: prospect.company,
        notes: prospect.notes ?? "",
        // Skip the .invalid placeholder synthesizer; the form will
        // happily accept an empty email and the drafter doesn't need it.
        email:
          prospect.email && !prospect.email.endsWith(".invalid")
            ? prospect.email
            : "",
      }
    : undefined;

  return (
    <>
      <SupabaseWarning />
      <DraftForm prefill={prefill} />
    </>
  );
}
