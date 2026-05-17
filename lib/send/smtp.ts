// SMTP send wrapper — Tay v1.1.2 Easy-mode channel.
//
// Lives alongside lib/send/gmail.ts; the orchestrator picks one based on
// mailbox_credentials.kind. Same shape contract (SendResult discriminated
// union) so the orchestrator's success path is symmetric.
//
// We use nodemailer because the SMTP protocol + STARTTLS upgrade + auth
// dance is non-trivial and nodemailer is the boringly-correct choice.
// Single-purpose dep; we never use its transport features beyond
// transporter.sendMail().
//
// Tay rule: NEVER log the body, recipient, subject, or password. Error
// paths log a friendly category only — NEVER the underlying SMTP server
// response (it can echo recipient + body fragments).
//
// MIME: text/plain; charset=utf-8 only for v1.1.2. We set the Message-ID
// explicitly (rather than letting nodemailer pick one) so we have a
// stable handle for v1.1.2.5's IMAP reply-matching.
//
// Threading: SMTP itself has no notion of threads. We return the
// Message-ID as the canonical handle; the orchestrator stores it in
// `sent_messages.gmail_message_id` (legacy column name preserved
// per write-scope manifest). When a reply arrives, IMAP polling matches
// it via the `In-Reply-To` header pointing at our generated Message-ID.

import nodemailer from "nodemailer";
import { randomBytes } from "node:crypto";

export type SendResult =
  | {
      ok: true;
      messageId: string;
      /** SMTP has no native thread id; orchestrator handles undefined. */
      threadId?: string;
    }
  | { ok: false; error: string };

export type SmtpSendInput = {
  host: string;
  port: number;
  username: string;
  password: string;
  fromAddress: string;
  to: string;
  subject: string;
  body: string;
  /** If set, sets In-Reply-To + References for a reply send. */
  inReplyToMessageId?: string;
};

/**
 * Generate a fresh RFC-5322 Message-ID. Format: `<random-hex@host>`.
 * Host part defaults to `tay.local` (purely cosmetic — doesn't have to
 * be resolvable) when we can't extract it from the sender address.
 */
export function generateMessageId(fromAddress: string): string {
  const local = randomBytes(16).toString("hex");
  const at = fromAddress.lastIndexOf("@");
  const host =
    at >= 0 && at < fromAddress.length - 1
      ? fromAddress.slice(at + 1).trim()
      : "tay.local";
  // Strip anything that's not host-shaped to avoid Message-ID parser woes.
  const safeHost = host.replace(/[^A-Za-z0-9.\-]/g, "") || "tay.local";
  return `<${local}@${safeHost}>`;
}

/**
 * Send via SMTP+STARTTLS. Returns a discriminated union; never throws.
 *
 * Caller contract: orchestrator passes the recipient. We trust this. Any
 * "is this recipient suppressed?" check happens UPSTREAM in the
 * orchestrator (Tay gate E); SMTP layer does NOT re-check.
 */
export async function sendEmailViaSmtp(
  input: SmtpSendInput,
): Promise<SendResult> {
  if (!input.host || !input.port || !input.username || !input.password) {
    return {
      ok: false,
      error: "SMTP send: missing host / port / username / password.",
    };
  }
  if (!input.fromAddress || !input.to || !input.subject || !input.body) {
    return {
      ok: false,
      error: "SMTP send: missing fromAddress / to / subject / body.",
    };
  }

  // port 465 = implicit TLS; everything else = STARTTLS upgrade.
  // Gmail's SMTP is 587/STARTTLS; we don't expose `secure` to the caller
  // because v1.1.2 only auto-configures Gmail (smtp.gmail.com:587).
  const secure = input.port === 465;

  const transporter = nodemailer.createTransport({
    host: input.host,
    port: input.port,
    secure,
    auth: { user: input.username, pass: input.password },
  });

  const messageId = generateMessageId(input.fromAddress);

  const mailOptions: nodemailer.SendMailOptions = {
    from: input.fromAddress,
    to: input.to,
    subject: input.subject,
    text: input.body,
    messageId,
    headers: {} as Record<string, string>,
  };
  if (input.inReplyToMessageId) {
    mailOptions.inReplyTo = input.inReplyToMessageId;
    mailOptions.references = input.inReplyToMessageId;
  }

  try {
    await transporter.sendMail(mailOptions);
    return { ok: true, messageId, threadId: undefined };
  } catch (err) {
    return { ok: false, error: friendlySmtpError(err) };
  } finally {
    // Idempotent close — connection pool is one-shot per send.
    try {
      transporter.close();
    } catch {
      /* swallow */
    }
  }
}

/**
 * Map nodemailer/SMTP error shapes to friendly messages. Never includes
 * the raw server response (could echo recipient/body fragments). Logs
 * only a short category to console.warn.
 */
export function friendlySmtpError(err: unknown): string {
  const code = extractErrCode(err);
  const command = extractErrCommand(err);

  if (code === "EAUTH" || code === "EAUTHFAILED" || code === "535") {
    console.warn("[smtp] auth failure");
    return "SMTP authentication failed. If you're using a Gmail App Password, double-check it. If you have 2-Step Verification disabled, you need to enable it before generating an App Password.";
  }
  if (code === "ECONNECTION" || code === "ECONNREFUSED" || code === "ENOTFOUND") {
    console.warn("[smtp] connection refused / unreachable");
    return "Couldn't connect to your SMTP server. Check the host and port.";
  }
  if (code === "ETLS" || code === "ESOCKET" || code === "EPROTOCOL") {
    console.warn("[smtp] TLS handshake failed");
    return "TLS handshake failed. Your SMTP server may not support STARTTLS on this port.";
  }
  if (code === "ETIMEDOUT" || command === "CONN") {
    console.warn("[smtp] timed out");
    return "SMTP connection timed out. Try again, or check the server is reachable.";
  }
  console.warn("[smtp] send failed (other)");
  return "SMTP send failed. Please try again.";
}

function extractErrCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const code = (err as { code?: unknown }).code;
  if (typeof code === "string") return code;
  const responseCode = (err as { responseCode?: unknown }).responseCode;
  if (typeof responseCode === "number") return String(responseCode);
  return "";
}

function extractErrCommand(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const command = (err as { command?: unknown }).command;
  return typeof command === "string" ? command : "";
}
