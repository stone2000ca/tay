// SMTP credential verification — Tay v1.1.2 wizard support.
//
// Lightweight pre-save check used by the /setup/mailbox wizard step.
// nodemailer's `verify()` opens an SMTP connection, attempts STARTTLS +
// auth, then closes — NO actual send. We use this to catch wrong-password
// / wrong-host / passkey-only-account cases at the wizard step, before
// the credentials are persisted.
//
// Returns a discriminated union so the wizard can branch on `reason` to
// surface the "try Power mode" suggestion when auth fails (App Password
// is not available for Google passkey-only accounts).
//
// Tay rule: NEVER log the password or the raw SMTP server response (which
// can echo username). We log a one-word category only.

import nodemailer from "nodemailer";
import { friendlySmtpError } from "./smtp";

export type VerifyReason =
  | "auth_failed"
  | "connection_refused"
  | "tls_failed"
  | "timeout"
  | "unknown";

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: VerifyReason; message: string };

export type VerifyInput = {
  host: string;
  port: number;
  username: string;
  password: string;
};

export async function verifySmtpCredentials(
  input: VerifyInput,
): Promise<VerifyResult> {
  if (!input.host || !input.port || !input.username || !input.password) {
    return {
      ok: false,
      reason: "unknown",
      message: "Missing host / port / username / password.",
    };
  }

  const secure = input.port === 465;
  const transporter = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure,
    auth: { user: input.username, pass: input.password },
  });

  try {
    await transporter.verify();
    return { ok: true };
  } catch (err) {
    const reason = classifyReason(err);
    return { ok: false, reason, message: friendlySmtpError(err) };
  } finally {
    try {
      transporter.close();
    } catch {
      /* swallow */
    }
  }
}

function classifyReason(err: unknown): VerifyReason {
  const code = extractCode(err);
  if (code === "EAUTH" || code === "EAUTHFAILED" || code === "535") {
    return "auth_failed";
  }
  if (
    code === "ECONNECTION" ||
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND"
  ) {
    return "connection_refused";
  }
  if (code === "ETLS" || code === "ESOCKET" || code === "EPROTOCOL") {
    return "tls_failed";
  }
  if (code === "ETIMEDOUT") return "timeout";
  return "unknown";
}

function extractCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") return code;
  const responseCode = (err as { responseCode?: unknown }).responseCode;
  if (typeof responseCode === "number") return String(responseCode);
  return "";
}
