// /setup/voice/preview — show the extracted rubric in plain English
// with inline editing. After save, advance to /setup/voice/sample.

import { redirect } from "next/navigation";
import { SupabaseWarning } from "@/components/supabase-warning";
import { getRubric } from "@/lib/voice/calibrate";
import { formatRubricInPlainEnglish } from "@/lib/voice/rubric-display";
import { PreviewForm } from "./preview-form";

export default async function VoicePreviewPage() {
  const rubric = await getRubric();
  if (!rubric) {
    // No rubric yet — bounce back to picker. Avoids the user landing
    // here via a stale browser tab and seeing a blank/erroring screen.
    redirect("/setup/voice");
  }

  const summary = formatRubricInPlainEnglish(rubric);

  return (
    <>
      <SupabaseWarning />
      <main className="min-h-dvh flex items-start justify-center px-6 py-12">
        <div className="max-w-2xl w-full">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Here&rsquo;s what Tay learned
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Review and tweak before continuing
            </p>
          </div>

          <section
            aria-label="Voice rubric summary"
            className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">
              In plain English
            </h2>
            <p className="mt-2 text-base text-gray-900">{summary}</p>
          </section>

          <PreviewForm rubric={rubric} />
        </div>
      </main>
    </>
  );
}
