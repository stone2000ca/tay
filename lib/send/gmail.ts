// Gmail send wrapper — Tay v0.7.
//
// We POST to gmail.googleapis.com directly rather than pulling in the
// googleapis SDK (multi-MB dep for one endpoint).
//
// Tay rule: NEVER log the body or recipient. Error paths log HTTP
// status + a generic message — NEVER the request body, NEVER the
// recipient address, NEVER the access token.
//
// MIME: text/plain; charset=utf-8 only for v0.7. HTML / multipart land
// when the drafter starts emitting HTML (no current plan).

const GMAIL_SEND_URL =
  "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";

export type SendResult =
  | { ok: true; gmailMessageId: string; gmailThreadId: string }
  | { ok: false; error: string };

export async function sendEmail(args: {
  accessToken: string;
  to: string;
  subject: string;
  body: string;
}): Promise<SendResult> {
  if (!args.accessToken) {
    return { ok: false, error: "Gmail send: missing access token." };
  }
  if (!args.to || !args.subject || !args.body) {
    return { ok: false, error: "Gmail send: missing to / subject / body." };
  }

  const raw = encodeRfc5322Message({
    to: args.to,
    subject: args.subject,
    body: args.body,
  });

  let res: Response;
  try {
    res = await fetch(GMAIL_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${args.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    });
  } catch (err) {
    // Network-level — generic message, log nothing identifying.
    console.warn(
      "[gmail] network error:",
      err instanceof Error ? err.message : "unknown",
    );
    return { ok: false, error: "Gmail send failed (network error)." };
  }

  if (!res.ok) {
    // Log status code ONLY. NEVER the body (could echo recipient/subject).
    console.warn(`[gmail] send failed: HTTP ${res.status}`);
    if (res.status === 401) {
      return {
        ok: false,
        error: "Gmail authentication failed; reconnect under Settings.",
      };
    }
    if (res.status === 403) {
      return {
        ok: false,
        error: "Gmail send forbidden — check the account has send scope.",
      };
    }
    if (res.status === 429) {
      return {
        ok: false,
        error: "Gmail rate-limited; try again in a moment.",
      };
    }
    return { ok: false, error: `Gmail send failed (HTTP ${res.status}).` };
  }

  let json: Record<string, unknown>;
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Gmail send: unparseable response." };
  }
  const gmailMessageId = typeof json.id === "string" ? json.id : "";
  const gmailThreadId =
    typeof json.threadId === "string" ? json.threadId : "";
  if (!gmailMessageId || !gmailThreadId) {
    return {
      ok: false,
      error: "Gmail send: response missing id / threadId.",
    };
  }
  return { ok: true, gmailMessageId, gmailThreadId };
}

/**
 * Build a minimal RFC 5322 message and base64url-encode it for Gmail's
 * `raw` field. We omit From — Gmail infers it from the authenticated
 * account. Subject is RFC 2047-encoded ONLY if it contains non-ASCII;
 * for now we keep subjects ASCII-only (the drafter enforces this in
 * v0.4) but encode defensively when non-ASCII slips through.
 *
 * Exported for test visibility.
 */
export function encodeRfc5322Message(args: {
  to: string;
  subject: string;
  body: string;
}): string {
  const subject = isAsciiPrintable(args.subject)
    ? args.subject
    : `=?UTF-8?B?${Buffer.from(args.subject, "utf8").toString("base64")}?=`;

  // Normalize line endings to CRLF per RFC. Body is UTF-8; declare it.
  const bodyLines = args.body.replace(/\r?\n/g, "\r\n");
  const headers = [
    `To: ${args.to}`,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
  ].join("\r\n");
  const message = `${headers}\r\n\r\n${bodyLines}`;
  return base64Url(Buffer.from(message, "utf8"));
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function isAsciiPrintable(s: string): boolean {
  return /^[\x20-\x7e]+$/.test(s);
}
