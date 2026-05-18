"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runZeroCalibration } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string };

export function ZeroForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const sample = String(formData.get("sample") ?? "");
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await runZeroCalibration({ userWrittenSample: sample });
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
            Write a sample now
          </h1>
          <p className="mt-4 text-sm text-gray-600">
            Imagine the role you sell to most, the kind of company you sell
            into, and the product you sell. Write a 3-4 sentence cold email
            to that person — just like you would in real life. Tay learns
            from how you write.
          </p>
        </div>

        <form
          action={onSubmit}
          className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-6"
        >
          <div>
            <label htmlFor="sample" className="block text-sm font-medium text-gray-900">
              Your sample cold email <span className="text-red-600">*</span>
            </label>
            <textarea
              id="sample"
              name="sample"
              required
              rows={8}
              placeholder={"Hi [name] — I noticed your team [observation]. We help [type of company] with [problem]. Want to chat for 15 minutes about [topic]?\n\n— [your first name]"}
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              Use placeholders like [name] / [company] where you'd normally
              insert a real prospect's details. Tay extracts your sentence
              patterns and tone — not the placeholders.
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
              {pending ? "Extracting voice..." : "Extract voice"}
            </button>
          </div>
        </form>
      </div>
    </main>
  );
}
