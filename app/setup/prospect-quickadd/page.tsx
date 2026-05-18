// /setup/prospect-quickadd — last wizard step before the dashboard.
//
// User describes their first prospect in 1-2 sentences; a cheap LLM
// extracts full_name + company + notes; the user reviews + saves.
// After save we mark the wizard complete and redirect to /draft so
// the user can immediately compose against this prospect.

import { SupabaseWarning } from "@/components/supabase-warning";
import { ProspectQuickAddForm } from "./prospect-quickadd-form";

export default function ProspectQuickAddPage() {
  return (
    <>
      <SupabaseWarning />
      <main className="min-h-dvh flex items-start justify-center px-6 py-12">
        <div className="max-w-2xl w-full">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Add your first prospect
            </h1>
            <p className="mt-4 text-sm text-gray-600">
              Describe one person you&rsquo;d like to write to. Tay extracts
              their name, company, and the relevant context. You confirm
              before saving.
            </p>
          </div>
          <ProspectQuickAddForm />
        </div>
      </main>
    </>
  );
}
