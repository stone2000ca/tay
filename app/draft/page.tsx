"use client";

import { useState, useTransition } from "react";
import { generateAndSaveDraft } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; draft: { subject: string; body: string } };

export default function DraftPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const full_name = String(formData.get("full_name") ?? "").trim();
    const company = String(formData.get("company") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();

    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await generateAndSaveDraft({
        full_name,
        company,
        notes: notes.length > 0 ? notes : undefined,
      });
      if (result.ok) {
        setStatus({ kind: "success", draft: result.draft });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <main className="min-h-dvh px-6 py-12">
      <div className="mx-auto max-w-2xl">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Draft an email</h1>
          <p className="mt-2 text-sm text-gray-600">
            Tay drafts in your voice (calibrated at{" "}
            <code className="text-xs">/setup/voice</code>) using OpenRouter.
          </p>
        </div>

        <form
          action={onSubmit}
          className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-5"
        >
          <div>
            <label
              htmlFor="full_name"
              className="block text-sm font-medium text-gray-900"
            >
              Prospect full name
            </label>
            <input
              id="full_name"
              name="full_name"
              type="text"
              required
              maxLength={200}
              placeholder="Jordan Riley"
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div>
            <label
              htmlFor="company"
              className="block text-sm font-medium text-gray-900"
            >
              Company
            </label>
            <input
              id="company"
              name="company"
              type="text"
              required
              maxLength={200}
              placeholder="Acme Robotics"
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

          <div>
            <label
              htmlFor="notes"
              className="block text-sm font-medium text-gray-900"
            >
              Notes <span className="text-gray-400">(optional)</span>
            </label>
            <textarea
              id="notes"
              name="notes"
              rows={3}
              maxLength={2000}
              placeholder="Anything specific you want Tay to mention?"
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

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? "Drafting..."
              : status.kind === "success"
                ? "Generate again"
                : "Generate draft"}
          </button>
        </form>

        {status.kind === "success" && (
          <DraftCard subject={status.draft.subject} body={status.draft.body} />
        )}
      </div>
    </main>
  );
}

function DraftCard({ subject, body }: { subject: string; body: string }) {
  return (
    <div className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
        Subject
      </div>
      <div className="mt-1 text-base font-medium text-gray-900">{subject}</div>

      <div className="mt-6 text-xs font-medium uppercase tracking-wide text-gray-500">
        Body
      </div>
      <pre className="mt-1 whitespace-pre-wrap font-sans text-sm text-gray-900">
        {body}
      </pre>
    </div>
  );
}
