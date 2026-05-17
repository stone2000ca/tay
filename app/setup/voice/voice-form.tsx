"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { runVoiceCalibration } from "./actions";
import type { VoiceRubric } from "@/lib/voice/rubric-schema";
import { SAMPLE_COUNT } from "@/lib/voice/constants";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; rubric: VoiceRubric; modelUsed: string };

export function VoiceCalibrationForm() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const samples: string[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      samples.push(String(formData.get(`sample-${i}`) ?? ""));
    }
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await runVoiceCalibration(samples);
      if (result.ok) {
        setStatus({
          kind: "success",
          rubric: result.rubric,
          modelUsed: result.modelUsed,
        });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  if (status.kind === "success") {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6 py-12">
        <div className="max-w-2xl w-full">
          <div className="text-center">
            <h1 className="text-3xl font-semibold tracking-tight">Voice saved</h1>
            <p className="mt-2 text-sm text-gray-500">
              Extracted by <code className="text-xs">{status.modelUsed}</code>
            </p>
          </div>
          <RubricViewer rubric={status.rubric} />
          <div className="mt-6 flex justify-end">
            <Link
              href="/"
              className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Calibrate your voice</h1>
          <p className="mt-2 text-sm text-gray-500">Step 4 of 4 — calibrate your voice</p>
          <p className="mt-4 text-sm text-gray-600">
            Paste {SAMPLE_COUNT} of your own outbound emails. Tay reads them and
            extracts a stylistic rubric — opener style, sentence length,
            formality, signature, common phrases — that the drafter and judge
            will enforce on every future email.
          </p>
          <p className="mt-2 text-xs text-gray-500">
            Stylistic features only. Tay does not extract or store personal
            content from these samples.
          </p>
        </div>

        <form
          action={onSubmit}
          className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-6"
        >
          {Array.from({ length: SAMPLE_COUNT }, (_, i) => (
            <div key={i}>
              <label
                htmlFor={`sample-${i}`}
                className="block text-sm font-medium text-gray-900"
              >
                Sample email {i + 1}
              </label>
              <textarea
                id={`sample-${i}`}
                name={`sample-${i}`}
                required
                rows={5}
                placeholder="Paste a real email you sent — opener, body, signature."
                className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
              />
            </div>
          ))}

          {status.kind === "error" && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {status.message}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Extracting voice..." : "Extract voice"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          The rubric is stored in your Supabase, not Tay&rsquo;s — and you can
          recalibrate any time by revisiting this page.
        </p>
      </div>
    </main>
  );
}

function RubricViewer({ rubric }: { rubric: VoiceRubric }) {
  return (
    <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-5 text-sm">
      <Field label="Opener style" value={rubric.opener_style} />
      <Field
        label="Avg. sentence length"
        value={`${rubric.avg_sentence_length_words} words`}
      />
      <Field label="Formality" value={rubric.formality} />
      <Field label="Signature pattern" value={rubric.signature_pattern} />
      <Field label="Tone notes" value={rubric.tone_notes} />
      <PhraseList label="Common phrases" items={rubric.common_phrases} />
      <PhraseList label="Avoid phrases" items={rubric.avoid_phrases} />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      <div className="mt-1 text-gray-900">{value}</div>
    </div>
  );
}

function PhraseList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </div>
      {items.length === 0 ? (
        <div className="mt-1 text-gray-400">(none extracted)</div>
      ) : (
        <ul className="mt-1 flex flex-wrap gap-2">
          {items.map((p) => (
            <li
              key={p}
              className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
            >
              {p}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
