"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { sendTestEmailAction } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "error"; message: string }
  | { kind: "success"; recipient: string };

export function TestSendForm({ recipientEmail }: { recipientEmail: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit() {
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await sendTestEmailAction();
      if (result.ok) {
        setStatus({ kind: "success", recipient: result.recipient });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  if (status.kind === "success") {
    return (
      <section
        className="mt-8 rounded-2xl border border-green-200 bg-green-50 p-6 text-sm text-green-900 space-y-3"
        aria-live="polite"
      >
        <strong className="block text-base">Sent.</strong>
        <p>
          Check the inbox for <code className="text-xs">{status.recipient}</code>{" "}
          — it&rsquo;ll show up shortly. (Look in spam if you don&rsquo;t see
          it in a minute.)
        </p>
        <div className="pt-2 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push("/setup/prospect-quickadd")}
            className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add your first prospect →
          </button>
        </div>
      </section>
    );
  }

  return (
    <form
      action={onSubmit}
      className="mt-8 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4"
    >
      <div>
        <div className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Recipient
        </div>
        <div className="mt-1 text-gray-900">{recipientEmail} (you)</div>
      </div>

      {status.kind === "error" && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {status.message}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 pt-2">
        <Link href="/setup/voice/sample" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to sample
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Sending..." : "Send the test email"}
        </button>
      </div>
    </form>
  );
}
