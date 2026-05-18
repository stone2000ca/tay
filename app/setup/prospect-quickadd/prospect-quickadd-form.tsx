"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ExtractedProspect } from "@/lib/prospect/extract";
import { extractProspectAction, saveProspectAction } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "extracted"; prospect: ExtractedProspect };

export function ProspectQuickAddForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onExtract(formData: FormData) {
    const description = String(formData.get("description") ?? "");
    setErrorMsg(null);
    startTransition(async () => {
      const result = await extractProspectAction({ description });
      if (result.ok) {
        setStatus({ kind: "extracted", prospect: result.prospect });
      } else {
        setErrorMsg(result.error);
      }
    });
  }

  function onSave(formData: FormData) {
    const full_name = String(formData.get("full_name") ?? "").trim();
    const company = String(formData.get("company") ?? "").trim();
    const email = String(formData.get("email") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim();
    setErrorMsg(null);
    startTransition(async () => {
      const result = await saveProspectAction({ full_name, company, email, notes });
      if (result.ok) {
        // After save, the wizard is complete — head to /draft so the
        // user can immediately compose against this prospect.
        router.push(`/draft?prospectId=${encodeURIComponent(result.prospectId)}`);
      } else {
        setErrorMsg(result.error);
      }
    });
  }

  if (status.kind === "extracted") {
    const p = status.prospect;
    return (
      <form
        action={onSave}
        className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5"
      >
        <div className="text-sm text-gray-600">
          Here&rsquo;s what Tay extracted. Confirm or edit before saving.
        </div>

        <div>
          <label htmlFor="full_name" className="block text-sm font-medium text-gray-900">
            Full name <span className="text-red-600">*</span>
          </label>
          <input
            id="full_name"
            name="full_name"
            type="text"
            required
            defaultValue={p.full_name === "<unknown>" ? "" : p.full_name}
            placeholder="e.g. Sarah Lin"
            maxLength={200}
            className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        <div>
          <label htmlFor="company" className="block text-sm font-medium text-gray-900">
            Company <span className="text-red-600">*</span>
          </label>
          <input
            id="company"
            name="company"
            type="text"
            required
            defaultValue={p.company === "<unknown>" ? "" : p.company}
            placeholder="e.g. Acme Corp"
            maxLength={200}
            className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-900">
            Email <span className="text-gray-400">(optional — fill later if you don&rsquo;t have it)</span>
          </label>
          <input
            id="email"
            name="email"
            type="email"
            placeholder="sarah@acme.example"
            maxLength={320}
            className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        <div>
          <label htmlFor="notes" className="block text-sm font-medium text-gray-900">
            Notes
          </label>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            defaultValue={p.notes}
            maxLength={2000}
            className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
          />
        </div>

        {errorMsg ? (
          <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {errorMsg}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={() => {
              setStatus({ kind: "idle" });
              setErrorMsg(null);
            }}
            disabled={pending}
            className="text-sm text-gray-600 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            ← Try a different description
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save and start drafting"}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form
      action={onExtract}
      className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-5"
    >
      <div>
        <label htmlFor="description" className="block text-sm font-medium text-gray-900">
          Who are you writing to? <span className="text-red-600">*</span>
        </label>
        <textarea
          id="description"
          name="description"
          required
          rows={4}
          placeholder='e.g. "I met Sarah at the Stripe event — she runs ops at a fintech in NYC."'
          className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
      </div>

      {errorMsg ? (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {errorMsg}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Extracting..." : "Extract details"}
        </button>
      </div>
    </form>
  );
}
