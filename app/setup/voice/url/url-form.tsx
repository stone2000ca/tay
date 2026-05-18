"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runUrlCalibration } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string };

export function UrlForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const inputs = {
      anchorEmail: String(formData.get("anchorEmail") ?? ""),
      companyUrl: String(formData.get("companyUrl") ?? ""),
    };
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await runUrlCalibration(inputs);
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
            One email + your company URL
          </h1>
          <p className="mt-4 text-sm text-gray-600">
            Paste one real email plus your company URL. Tay reads your public
            site for brand voice and fuses it with the email anchor.
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
            <label htmlFor="companyUrl" className="block text-sm font-medium text-gray-900">
              Your company URL <span className="text-red-600">*</span>
            </label>
            <input
              id="companyUrl"
              name="companyUrl"
              type="url"
              required
              placeholder="https://example.com"
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              Tay fetches the page once. Must be publicly accessible (no login wall).
            </p>
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
              {pending ? "Fetching + extracting..." : "Extract voice"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
