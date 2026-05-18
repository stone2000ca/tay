"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runDescribeCalibration } from "./actions";

type Formality = "casual" | "neutral" | "formal";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string };

export function DescribeForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const inputs = {
      anchorEmail: String(formData.get("anchorEmail") ?? ""),
      formality: String(formData.get("formality") ?? "neutral") as Formality,
      openerStyle: String(formData.get("openerStyle") ?? ""),
      avoidPhrases: String(formData.get("avoidPhrases") ?? ""),
      freeformNotes: String(formData.get("freeformNotes") ?? ""),
    };
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await runDescribeCalibration(inputs);
      if (result.ok) {
        router.push("/setup/voice/preview");
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-12">
      <div className="max-w-2xl w-full">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            One email + 3 questions
          </h1>
          <p className="mt-4 text-sm text-gray-600">
            Paste one real email you sent (your anchor) and answer three quick
            questions. Tay fuses both into your voice rubric.
          </p>
        </div>

        <form
          action={onSubmit}
          className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-6"
        >
          <div>
            <label htmlFor="anchorEmail" className="block text-sm font-medium text-gray-900">
              Anchor email <span className="text-red-600">*</span>
            </label>
            <textarea
              id="anchorEmail"
              name="anchorEmail"
              required
              rows={6}
              placeholder="Paste one real cold email you've sent."
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div>
            <label htmlFor="formality" className="block text-sm font-medium text-gray-900">
              How formal is your style?
            </label>
            <select
              id="formality"
              name="formality"
              defaultValue="neutral"
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            >
              <option value="casual">Casual — "Hey Sarah,"</option>
              <option value="neutral">Neutral — "Hi Sarah,"</option>
              <option value="formal">Formal — "Dear Ms. Chen,"</option>
            </select>
          </div>

          <div>
            <label htmlFor="openerStyle" className="block text-sm font-medium text-gray-900">
              How do you usually open a cold email? <span className="text-red-600">*</span>
            </label>
            <textarea
              id="openerStyle"
              name="openerStyle"
              required
              rows={3}
              placeholder="e.g. First name + one observation about their recent work."
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div>
            <label htmlFor="avoidPhrases" className="block text-sm font-medium text-gray-900">
              Phrases you want Tay to never use?
            </label>
            <textarea
              id="avoidPhrases"
              name="avoidPhrases"
              rows={2}
              placeholder='e.g. "circle back", "synergy", "hope you’re well"'
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div>
            <label htmlFor="freeformNotes" className="block text-sm font-medium text-gray-900">
              Anything else about your style?
            </label>
            <textarea
              id="freeformNotes"
              name="freeformNotes"
              rows={2}
              placeholder="Optional. Anything you'd tell a new junior teammate about how you write."
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          {status.kind === "error" && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              {status.message}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <Link href="/setup/voice" className="text-sm text-gray-600 hover:text-gray-900">
              ← Back
            </Link>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Extracting voice..." : "Extract voice"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
