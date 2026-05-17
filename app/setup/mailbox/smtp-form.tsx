"use client";

// Easy-mode (SMTP App Password) form. Client component because we need
// useTransition for inline pending state + branching on the discriminated
// `reason` returned by verifyAndSaveSmtp.
//
// Tay rule: App Password is rendered with type="password" + autocomplete="off"
// so the browser doesn't autofill it elsewhere and password managers don't
// save it as the user's primary password.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { verifyAndSaveSmtp } from "./actions";

type Status =
  | { kind: "idle" }
  | { kind: "auth_failed"; message: string }
  | { kind: "error"; message: string };

export function SmtpForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    const e = String(formData.get("email") ?? "");
    const p = String(formData.get("appPassword") ?? "");
    setStatus({ kind: "idle" });
    startTransition(async () => {
      const result = await verifyAndSaveSmtp({ email: e, appPassword: p });
      if (result.ok) {
        router.push("/setup/voice");
        return;
      }
      if (result.reason === "auth_failed") {
        setStatus({ kind: "auth_failed", message: result.error });
      } else {
        setStatus({ kind: "error", message: result.error });
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      <div>
        <label
          htmlFor="smtp-email"
          className="block text-sm font-medium text-gray-900"
        >
          Your Gmail address
        </label>
        <input
          id="smtp-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@gmail.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
      </div>

      <div>
        <label
          htmlFor="smtp-app-password"
          className="block text-sm font-medium text-gray-900"
        >
          App Password
        </label>
        <input
          id="smtp-app-password"
          name="appPassword"
          type="password"
          autoComplete="off"
          required
          placeholder="xxxx xxxx xxxx xxxx"
          value={appPassword}
          onChange={(e) => setAppPassword(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        <p className="mt-1 text-xs text-gray-500">
          Generate one at{" "}
          <a
            href="https://myaccount.google.com/apppasswords"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-gray-700"
          >
            myaccount.google.com/apppasswords
          </a>
          . You need 2-Step Verification enabled first.
        </p>
      </div>

      {status.kind === "auth_failed" && (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
        >
          <strong>App Password rejected.</strong> Either the password is
          wrong, OR your Google account uses passkey-only sign-in (Google
          removes the App Password option for those accounts).
          <div className="mt-2 text-xs">
            If you don&rsquo;t see an &ldquo;App passwords&rdquo; option on
            the link above, switch to <strong>Power mode</strong> (Google
            OAuth) on the right.
          </div>
        </div>
      )}
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
        disabled={
          pending || email.trim().length === 0 || appPassword.trim().length === 0
        }
        className="w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Verifying..." : "Verify & connect"}
      </button>
    </form>
  );
}
