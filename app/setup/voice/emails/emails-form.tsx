"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { runEmailsCalibration } from "./actions";
import { SAMPLE_COUNT } from "@/lib/voice/constants";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string };

export function EmailsForm() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const samples: string[] = [];
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const s = String(formData.get(`sample-${i}`) ?? "").trim();
      if (s.length > 0) samples.push(s);
    }
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await runEmailsCalibration(samples);
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
            Paste your sample emails
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Voice calibration — paste real emails
          </p>
          <p className="mt-4 text-sm text-gray-600">
            Paste 1 to {SAMPLE_COUNT} of your own outbound emails. Tay reads
            them and extracts a stylistic rubric that the drafter and judge
            will enforce on every future email. Even one email works; more
            samples give a sharper rubric.
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
                Sample email {i + 1}{" "}
                {i === 0 ? (
                  <span className="text-red-600">*</span>
                ) : (
                  <span className="text-gray-400">(optional)</span>
                )}
              </label>
              <textarea
                id={`sample-${i}`}
                name={`sample-${i}`}
                required={i === 0}
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

          <div className="flex items-center justify-between gap-3">
            <Link
              href="/setup/voice"
              className="text-sm text-gray-600 hover:text-gray-900"
            >
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
