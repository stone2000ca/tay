// /setup/voice/sample — show Tay drafting an email against a canned
// fake prospect (Alex Chen, VP Sales, Acme Corp) using the user's
// just-calibrated rubric. This is the "see Tay actually work" moment.
//
// Real LLM call. Real disclosure footer. Real rubric. Fake prospect
// (no persistence — the draft never enters /queue).
//
// Server component: calls generateDraft() server-side so the page
// streams the result. If the LLM fails we render a friendly "try
// again" CTA without disturbing the saved rubric.

import Link from "next/link";
import { redirect } from "next/navigation";
import { SupabaseWarning } from "@/components/supabase-warning";
import { getRubric } from "@/lib/voice/calibrate";
import { generateDraft } from "@/lib/draft/generate";

const CANNED_PROSPECT = {
  full_name: "Alex Chen",
  company: "Acme Corp",
  notes:
    "VP Sales at Acme Corp (a mid-market B2B SaaS company). You met briefly at a recent industry meetup.",
};

export default async function VoiceSamplePage() {
  const rubric = await getRubric();
  if (!rubric) {
    redirect("/setup/voice");
  }

  const generated = await generateDraft({
    rubric,
    prospect: CANNED_PROSPECT,
  });

  return (
    <>
      <SupabaseWarning />
      <main className="min-h-dvh flex items-start justify-center px-6 py-12">
        <div className="max-w-2xl w-full">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight">
              Here&rsquo;s Tay writing in your voice
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              A sample draft for a fake prospect (Alex Chen, VP Sales at Acme
              Corp) using the rubric you just confirmed.
            </p>
          </div>

          {generated.ok ? (
            <section
              aria-label="Sample draft"
              className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4"
            >
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Subject
                </div>
                <div className="mt-1 text-base font-medium text-gray-900">
                  {generated.draft.subject}
                </div>
              </div>
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Body
                </div>
                <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-gray-900">
                  {generated.draft.body}
                </pre>
              </div>
              <p className="text-xs text-gray-500">
                The footer above is Tay&rsquo;s AI-disclosure line — it goes on
                every real send too (and stays auditable).
              </p>
            </section>
          ) : (
            <section
              role="alert"
              className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900"
            >
              <strong className="block text-base">
                Couldn&rsquo;t draft a sample right now.
              </strong>
              <p className="mt-2">{generated.error}</p>
              <p className="mt-3 text-xs">
                You can continue and try again later, or recalibrate your voice.
              </p>
            </section>
          )}

          <div className="mt-8 flex items-center justify-between gap-3">
            <Link
              href="/setup/voice/preview"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
              ← Tweak the rubric
            </Link>
            <Link
              href="/setup/voice/test-send"
              className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
            >
              Looks good — continue
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
