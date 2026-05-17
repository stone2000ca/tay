"use server";

// Server actions for /setup/mailbox — Tay v1.1.2.
//
// Two surfaces:
//   - verifyAndSaveSmtp: STARTTLS-verify the App Password, then persist
//     via lib/mailbox/persist + audit. Used by the Easy column.
//   - disconnectMailboxAction: wipe both new and legacy mailbox rows
//     (the wizard "Reconnect" button + the Settings disconnect button
//     share this).
//
// READ-VS-WRITE: WRITE actions — translate throws into a discriminated
// union { ok: false, error } the client can render. NEVER log the
// App Password or the user's email content.

import { redirect } from "next/navigation";
import { ensureSchema } from "@/lib/supabase/migrate";
import { verifySmtpCredentials } from "@/lib/send/smtp-verify";
import {
  clearMailboxCredentials,
  saveMailboxCredentials,
} from "@/lib/mailbox/persist";
import { appendAudit } from "@/lib/audit/append";

// Gmail's documented Easy-mode endpoints. v1.1.2 only auto-configures
// Gmail; future generic-SMTP support would expose these as form fields.
const GMAIL_SMTP_HOST = "smtp.gmail.com";
const GMAIL_SMTP_PORT = 587;
const GMAIL_IMAP_HOST = "imap.gmail.com";
const GMAIL_IMAP_PORT = 993;

export type SmtpConnectResult =
  | { ok: true }
  | { ok: false; error: string; reason?: string };

/**
 * Validate + save a Gmail App Password.
 *
 *   1. Cold-start: ensureSchema (creates mailbox_credentials if missing).
 *   2. Light input validation (non-empty email + password).
 *   3. STARTTLS handshake via verifySmtpCredentials (no actual send).
 *   4. On success: save credentials + audit "mailbox.connected".
 *
 * Returns the failure reason (auth_failed | connection_refused | tls_failed
 * | timeout | unknown) so the wizard can branch on it to surface the
 * "try Power mode" suggestion when the App Password is rejected.
 */
export async function verifyAndSaveSmtp(input: {
  email: string;
  appPassword: string;
}): Promise<SmtpConnectResult> {
  await ensureSchema();

  const email = (input.email ?? "").trim();
  const appPassword = (input.appPassword ?? "").trim();

  if (!email || !email.includes("@")) {
    return { ok: false, error: "Enter the Gmail address the App Password belongs to." };
  }
  if (!appPassword || appPassword.length < 8) {
    return {
      ok: false,
      error: "Paste the App Password. It looks like 16 letters with spaces — paste it as Google shows it.",
    };
  }

  const verify = await verifySmtpCredentials({
    host: GMAIL_SMTP_HOST,
    port: GMAIL_SMTP_PORT,
    username: email,
    // Google App Passwords are commonly displayed with spaces every 4
    // characters; strip them so the user can paste-as-shown.
    password: appPassword.replace(/\s+/g, ""),
  });

  if (!verify.ok) {
    return { ok: false, error: verify.message, reason: verify.reason };
  }

  try {
    await saveMailboxCredentials({
      kind: "app_password",
      emailAddress: email,
      password: appPassword.replace(/\s+/g, ""),
      smtpHost: GMAIL_SMTP_HOST,
      smtpPort: GMAIL_SMTP_PORT,
      imapHost: GMAIL_IMAP_HOST,
      imapPort: GMAIL_IMAP_PORT,
    });
  } catch (err) {
    return {
      ok: false,
      error: `Could not save mailbox credentials: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  await appendAudit({
    action: "mailbox.connected",
    payload: {
      kind: "app_password",
      // Matched by the redactor's "email" fragment → "[redacted]" at
      // rest. We pass it anyway so the redactor is the source of truth.
      email_address: email,
    },
  });

  return { ok: true };
}

/**
 * Disconnect the current mailbox (both new + legacy tables). Used by
 * the wizard "Reconnect" button and the Settings page disconnect button.
 *
 * Invoked via `<form action={disconnectMailboxAction}>`, so the runtime
 * passes a FormData. The caller can include a `redirectTo` hidden field
 * to control where the user lands after disconnect — Settings keeps the
 * user on Settings, the wizard sends them back to the wizard step.
 *
 * Defaults to /setup/mailbox?disconnected=1 (wizard behavior) when no
 * redirectTo is provided.
 */
export async function disconnectMailboxAction(
  formData?: FormData,
): Promise<void> {
  const rawTarget =
    typeof formData?.get === "function"
      ? formData.get("redirectTo")
      : null;
  // Only honor same-origin relative paths — never let the form smuggle
  // an external URL into the redirect.
  const target =
    typeof rawTarget === "string" && rawTarget.startsWith("/")
      ? rawTarget
      : "/setup/mailbox?disconnected=1";
  const errorTarget = target.includes("?")
    ? `${target.split("?")[0]}?error=disconnect_failed`
    : `${target}?error=disconnect_failed`;

  try {
    await clearMailboxCredentials();
    await appendAudit({
      action: "mailbox.disconnected",
      payload: {},
    });
  } catch (err) {
    console.warn(
      "[mailbox actions] disconnect failed:",
      err instanceof Error ? err.message : String(err),
    );
    redirect(errorTarget);
  }
  redirect(target);
}
