"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { validateAndSaveSetup } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; name: string };

export default function SetupPage() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const apiKey = String(formData.get("apiKey") ?? "");
    const name = String(formData.get("name") ?? "");
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await validateAndSaveSetup({ apiKey, name });
      if (result.ok) {
        setStatus({ kind: "success", name: name.trim() });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  if (status.kind === "success") {
    return (
      <main className="min-h-dvh flex items-center justify-center px-6">
        <div className="max-w-xl w-full">
          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <h1 className="text-2xl font-semibold tracking-tight">
              {status.name} is ready
            </h1>
            <p className="mt-3 text-sm text-gray-600">
              Your OpenRouter API key checks out. One last manual step before Tay can
              actually talk to an LLM on your behalf:
            </p>
            <p className="mt-4 rounded-lg bg-gray-50 p-4 text-sm text-gray-700">
              Add <code className="rounded bg-gray-200 px-1 py-0.5 text-xs">OPENROUTER_API_KEY</code>{" "}
              to your Vercel env vars (or <code className="rounded bg-gray-200 px-1 py-0.5 text-xs">.env.local</code>{" "}
              for local dev) using the same key you just validated. Restart the app
              to continue setup.
            </p>
            <div className="mt-6 flex justify-end">
              <Link
                href="/"
                className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                Go home
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-12">
      <div className="max-w-xl w-full">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Set up Tay</h1>
          <p className="mt-2 text-sm text-gray-500">Step 1 of the wizard</p>
        </div>

        <form
          action={onSubmit}
          className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-6"
        >
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-900">
              OpenRouter API key
            </label>
            <input
              id="apiKey"
              name="apiKey"
              type="password"
              autoComplete="off"
              required
              placeholder="sk-or-..."
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
          </div>

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
            {pending ? "Validating..." : "Validate & continue"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          What is this? Tay uses{" "}
          <a
            href="https://openrouter.ai/keys"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700"
          >
            OpenRouter
          </a>{" "}
          — one key, any model (Claude, GPT, Gemini, Llama, etc.). The key is
          stored in your hosting env, not in Tay&rsquo;s database.
        </p>
      </div>
    </main>
  );
}
