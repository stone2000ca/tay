"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { validateAndSaveSetup } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string };

/**
 * v1.1.1 wizard step 1: name your instance. The LLM-key step (formerly
 * also here) moved to /setup/llm-key. On success we route the user there.
 */
export default function SetupPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const name = String(formData.get("name") ?? "");
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await validateAndSaveSetup({ name });
      if (result.ok) {
        router.push("/setup/llm-key");
        return;
      }
      setStatus({ kind: "error", message: result.error });
    });
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-12">
      <div className="max-w-xl w-full">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Set up Tay</h1>
          <p className="mt-2 text-sm text-gray-500">Step 1 of 3 — name your instance</p>
        </div>

        <form
          action={onSubmit}
          className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-6"
        >
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-900">
              What do you want to call this instance?
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              maxLength={60}
              placeholder="My Tay"
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            <p className="mt-1 text-xs text-gray-500">
              Shown at the top of your dashboard. ASCII letters, numbers, and punctuation only.
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

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Saving..." : "Continue"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Up next: paste your LLM API key (Anthropic, OpenAI, or OpenRouter).
        </p>
      </div>
    </main>
  );
}
