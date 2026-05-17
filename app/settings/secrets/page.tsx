// /settings/secrets — Tay v1.1.1.
//
// Surfaces the active LLM provider + key fingerprint and lets the user
// rotate the key. The rotate button is a Link (not a server action) —
// it just navigates to /setup/llm-key?rotate=1, which reuses the wizard
// step's UI and audit-event wiring.
//
// Supabase rotation banner: rotating SUPABASE_SERVICE_ROLE_KEY changes
// the HKDF IKM, so every derived secret (oauth, unsubscribe, cron) and
// every encrypted token in the DB becomes unusable. The banner warns
// the user to disconnect Gmail BEFORE rotating, then reconnect after.

import Link from "next/link";
import { hasSupabaseEnv } from "@/lib/supabase/server";
import { ensureSchema } from "@/lib/supabase/migrate";
import { getLlmKeyMetadata } from "@/lib/secrets/llm-key";
import { SupabaseWarning } from "@/components/supabase-warning";

export const dynamic = "force-dynamic";

export default async function SecretsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ rotated?: string }>;
}) {
  const params = await searchParams;

  if (!hasSupabaseEnv()) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-12">
        <SupabaseWarning />
        <h1 className="mt-6 text-2xl font-semibold tracking-tight">Secrets</h1>
      </main>
    );
  }

  await ensureSchema();

  const metadata = await getLlmKeyMetadata();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">Secrets</h1>
      <p className="mt-1 text-sm text-gray-500">
        Manage your BYO LLM key and view the derived-secret status.
      </p>

      {params.rotated && (
        <div
          role="status"
          className="mt-6 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
        >
          LLM key rotated. The new fingerprint is shown below.
        </div>
      )}

      <section className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold tracking-tight">LLM key</h2>
        {metadata ? (
          <div className="mt-4 space-y-3 text-sm">
            <div>
              <span className="text-gray-500">Provider: </span>
              <span className="font-medium text-gray-900">
                {prettyProvider(metadata.provider)}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Fingerprint: </span>
              <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-mono text-gray-900">
                {metadata.fingerprint}
              </code>
              <span className="ml-2 text-xs text-gray-400">
                (first 8 chars of SHA-256; safe to share)
              </span>
            </div>
            <div>
              <span className="text-gray-500">Set: </span>
              <span className="text-gray-700">
                {new Date(metadata.setAt).toLocaleString()}
              </span>
            </div>
            <div className="pt-2">
              <Link
                href="/setup/llm-key?rotate=1"
                className="inline-block rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                Rotate key
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3 text-sm">
            <p className="text-gray-600">
              No LLM key configured yet. Complete the wizard before drafting.
            </p>
            <Link
              href="/setup/llm-key"
              className="inline-block rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
            >
              Add LLM key
            </Link>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-6">
        <h2 className="text-lg font-semibold tracking-tight text-amber-900">
          Supabase service-role key rotation
        </h2>
        <p className="mt-2 text-sm text-amber-900">
          Rotating your <code className="text-xs">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
          changes the input to every derived secret (OAuth crypto,
          unsubscribe HMAC, cron bearer). All stored Gmail OAuth tokens
          and the LLM ciphertext become unusable.
        </p>
        <p className="mt-2 text-sm text-amber-900">
          <strong>Before rotating:</strong> disconnect Gmail under{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>
          . After rotating + redeploying, reconnect Gmail and re-add your
          LLM key from this page.
        </p>
      </section>
    </main>
  );
}

function prettyProvider(p: "anthropic" | "openai" | "openrouter"): string {
  switch (p) {
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    case "openrouter":
      return "OpenRouter";
  }
}
