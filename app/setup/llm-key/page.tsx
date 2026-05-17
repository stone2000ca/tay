"use client";

// v1.1.1 wizard step 2 — paste your LLM API key.
//
// Wrapped in Suspense so useSearchParams() doesn't trip prerender bailout
// (CSR-only hook — Next requires the boundary or `force-dynamic`).
//
// One field. Provider auto-detection runs both client-side (for the
// helpful "Detected: Anthropic" hint) and server-side (the trust
// boundary; client detection is informational only).
//
// Degraded-state matrix:
//   | State                  | Behavior                                  |
//   |------------------------|-------------------------------------------|
//   | Provider unknown       | Friendly inline error; no LLM call made   |
//   | Network down           | "Network error talking to the provider"   |
//   | SDK error              | Generic "Could not validate the key"      |
//   | Key invalid            | "Invalid API key. Double-check..."        |
//   | Key valid + save fails | "Could not save the LLM key: <reason>"    |
//   | Key valid + save ok    | Redirect to /setup/voice                  |

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, useTransition } from "react";
import { validateAndSaveLlmKey } from "../actions";

type ClientProvider = "anthropic" | "openai" | "openrouter" | "unknown";

function detectProviderClientSide(key: string): ClientProvider {
  const trimmed = (key ?? "").trim();
  if (trimmed.startsWith("sk-ant-")) return "anthropic";
  if (trimmed.startsWith("sk-or-")) return "openrouter";
  if (trimmed.startsWith("sk-")) return "openai";
  return "unknown";
}

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string };

export default function LlmKeyPage() {
  return (
    <Suspense fallback={null}>
      <LlmKeyForm />
    </Suspense>
  );
}

function LlmKeyForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isRotation = searchParams.get("rotate") === "1";
  const [keyValue, setKeyValue] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  const detected = detectProviderClientSide(keyValue);

  function onSubmit(formData: FormData) {
    const apiKey = String(formData.get("apiKey") ?? "");
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await validateAndSaveLlmKey({ apiKey });
      if (result.ok) {
        router.push(isRotation ? "/settings/secrets?rotated=1" : "/setup/voice");
        return;
      }
      setStatus({ kind: "error", message: result.error });
    });
  }

  return (
    <main className="min-h-dvh flex items-center justify-center px-6 py-12">
      <div className="max-w-xl w-full">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            {isRotation ? "Rotate your LLM key" : "Add your LLM key"}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {isRotation ? "Replaces the active key" : "Step 2 of 3 — bring your own key"}
          </p>
        </div>

        <form
          action={onSubmit}
          className="mt-8 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm space-y-6"
        >
          <div>
            <label htmlFor="apiKey" className="block text-sm font-medium text-gray-900">
              API key
            </label>
            <input
              id="apiKey"
              name="apiKey"
              type="password"
              autoComplete="off"
              required
              placeholder="sk-ant-... / sk-or-... / sk-..."
              value={keyValue}
              onChange={(e) => setKeyValue(e.target.value)}
              className="mt-2 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
            />
            <p className="mt-2 text-xs text-gray-500">
              Bring your own key — Tay supports{" "}
              <a
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
              >
                Anthropic
              </a>{" "}
              (<code>sk-ant-...</code>),{" "}
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
              >
                OpenAI
              </a>{" "}
              (<code>sk-...</code>), or{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-gray-700"
              >
                OpenRouter
              </a>{" "}
              (<code>sk-or-...</code>). Set a spending limit at your provider before pasting your key.
            </p>
            {detected !== "unknown" && keyValue.length > 0 && (
              <p className="mt-2 text-xs text-gray-700">
                Detected: <strong>{prettyProvider(detected)}</strong>
              </p>
            )}
            {detected === "unknown" && keyValue.length > 0 && (
              <p className="mt-2 text-xs text-amber-700">
                Unrecognized prefix — expected sk-ant-, sk-or-, or sk-.
              </p>
            )}
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
            disabled={pending || keyValue.trim().length === 0}
            className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? "Validating..." : isRotation ? "Rotate key" : "Validate & continue"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-gray-500">
          Your key is encrypted at rest in your own Supabase project. Tay-the-author never sees it.
          <br />
          <Link href="/setup" className="underline hover:text-gray-700">
            ← Back to step 1
          </Link>
        </p>
      </div>
    </main>
  );
}

function prettyProvider(p: ClientProvider): string {
  switch (p) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
    default:
      return "Unknown";
  }
}
