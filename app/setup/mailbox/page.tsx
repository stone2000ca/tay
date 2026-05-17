// v1.1.2 wizard step 3 — connect a mailbox (Easy SMTP or Power OAuth).
//
// Inserted between /setup/llm-key and /setup/voice. The redirect chain
// in app/page.tsx routes here when LLM key is set but no mailbox is.
//
// Degraded-state matrix:
//   | State                          | Behavior                                      |
//   |--------------------------------|-----------------------------------------------|
//   | No mailbox connected           | Both columns rendered side-by-side            |
//   | App Password rejected (auth)   | Amber banner + "try Power mode" suggestion    |
//   | SMTP server unreachable        | Red banner explaining host/port/TLS issue     |
//   | SMTP server times out          | Red banner explaining timeout                 |
//   | Mailbox already connected      | Status banner + Reconnect button + skip-link  |
//   | mailbox.disconnected param     | Green flash banner                            |

import Link from "next/link";
import { getMailboxCredentials } from "@/lib/mailbox/persist";
import { ensureSchema } from "@/lib/supabase/migrate";
import { disconnectMailboxAction } from "./actions";
import { SmtpForm } from "./smtp-form";
import { OAuthCard } from "./oauth-card";

export const dynamic = "force-dynamic";

export default async function MailboxSetupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; disconnected?: string }>;
}) {
  await ensureSchema();
  const params = await searchParams;
  const current = await getMailboxCredentials();

  return (
    <main className="min-h-dvh px-6 py-12">
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight">
            Connect a mailbox
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Step 3 of 4 — Tay sends from your real Gmail.
          </p>
        </div>

        {params.disconnected && (
          <div
            role="status"
            className="mt-6 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
          >
            Mailbox disconnected.
          </div>
        )}
        {params.error === "disconnect_failed" && (
          <div
            role="alert"
            className="mt-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
          >
            Could not disconnect mailbox. Try again.
          </div>
        )}

        {current && (
          <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Currently connected
                </div>
                <div className="mt-1 text-sm text-gray-900">
                  <strong>
                    {current.kind === "oauth"
                      ? "Gmail (OAuth)"
                      : "SMTP (App Password)"}
                  </strong>{" "}
                  · {current.emailAddress}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Continue to the next step, or reconnect with a different
                  mailbox below.
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Link
                  href="/setup/voice"
                  className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
                >
                  Continue to voice cal →
                </Link>
                <form action={disconnectMailboxAction}>
                  <button
                    type="submit"
                    className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    Disconnect & re-pick
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          {/* Easy column */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                Easy
              </h2>
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                Recommended for personal Gmail
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Takes ~2 minutes. Requires 2-Step Verification on your Google
              account.
            </p>
            <p className="mt-2 text-xs text-amber-700">
              Heads-up: reply polling for this mode activates in v1.1.2.5
              (an upcoming update). You can send now; replies will appear in{" "}
              <code>/replies</code> once polling lands.
            </p>
            <div className="mt-4">
              <SmtpForm />
            </div>
          </section>

          {/* Power column */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-baseline justify-between">
              <h2 className="text-lg font-semibold tracking-tight">
                Power
              </h2>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                Workspace / passkey-only
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              Required for Google Workspace and passkey-only Google accounts.
              Reply polling works immediately (Gmail Push).
            </p>
            <div className="mt-4">
              <OAuthCard />
            </div>
          </section>
        </div>

        <p className="mt-10 text-center text-xs text-gray-500">
          Your credentials are encrypted at rest in your own Supabase project.
          Tay-the-author never sees them.
          <br />
          <Link href="/setup/llm-key" className="underline hover:text-gray-700">
            ← Back to LLM key
          </Link>
        </p>
      </div>
    </main>
  );
}
