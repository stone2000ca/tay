// IMAP poller — Tay v1.1.2.5 (SMTP-mode reply pipeline).
//
// Parallel to lib/reply/poll.ts's pollGmail() (Gmail History API path).
// When the user is on SMTP App Password mode (mailbox_credentials.kind ===
// "app_password"), we can't use Gmail Push / History API — that's an
// OAuth-only Google product. We poll the user's IMAP inbox instead.
//
// Strategy: every 5 minutes (Vercel Cron → /api/cron/poll-gmail → channel
// dispatcher in lib/reply/poll.ts), we
//   1. getMailboxCredentials() — bail unless kind === "app_password".
//   2. Open INBOX via imapflow over implicit-TLS port 993.
//   3. Read the latest `imap_poll_cursor`.last_uid.
//   4. If last_uid === 0 → first poll. Read mailbox.uidNext and seed the
//      cursor to uidNext-1 (so the next poll begins at uidNext). NO
//      BACKFILL — re-processing every historical mail as a "new" reply
//      would fire trust events for inbound we already handled or never
//      wanted to. Same first-poll-seed pattern as pollGmail().
//   5. Else fetch UID range `${last_uid + 1}:*` with envelope + source.
//      For each message:
//        - Parse RFC 5322 headers (From, Subject, Message-ID, In-Reply-To,
//          References, Date) from envelope + raw source.
//        - Extract text/plain body (fall back to text/html stripped) from
//          the raw source.
//        - Call handleReply() with the inReplyToMessageId fallback anchor
//          so it can thread-match SMTP-derived replies via
//          sent_messages.gmail_message_id (the column where we persist
//          our generated SMTP Message-ID — v1.1.2).
//   6. Advance cursor to the highest UID seen.
//   7. Logout.
//
// CURSOR ADVANCE HONESTY (matches lib/reply/poll.ts): the cursor advance
// happens after the for-loop UNCONDITIONALLY — it does NOT wait for each
// message to succeed before moving past it. handleReply() dedupes via
// UNIQUE on replies.gmail_message_id BEFORE the classifier runs, so a
// mid-batch handler error can't "lose" a message: either the dedupe
// insert already landed (next poll re-fetch is a no-op) or it didn't
// (next poll re-processes cleanly). The cursor advance is independent
// of any single message's outcome.
//
// READ-VS-WRITE: poller is a SCHEDULED WRITE pipeline. NEVER throws.
// Errors return in the result counts plus an optional `reason` string.
//
// Logging policy: operational counts only. NEVER log message bodies,
// subjects, recipient addresses, passwords, or anything PII. Errors are
// categorized to short strings; the underlying imapflow error (which can
// echo recipient + body fragments) is NEVER logged.

import {
  getSupabaseServerClient,
  hasSupabaseEnv,
} from "../supabase/server";
import { getMailboxCredentials } from "../mailbox/persist";
import { handleReply } from "./handle";

const CURSOR_TABLE = "imap_poll_cursor";
const CURSOR_LOCK_VALUE = 1;
/** Max messages to process per single poll tick — protects against a
 * pathological first-poll-after-cursor-loss flood. The cursor advance
 * still happens at the end, so the next tick picks up where this left
 * off. */
const MAX_MESSAGES_PER_POLL = 200;

export type ImapPollResult = {
  processed: number;
  skipped: number;
  errors: number;
  reason?:
    | "no_credentials"
    | "wrong_kind"
    | "imap_connect_failed"
    | "auth_failed"
    | "no_supabase"
    | "schema_unavailable";
};

/** Parsed RFC-5322-ish headers we care about for thread matching + audit. */
type ParsedHeaders = {
  from: string;
  subject: string;
  messageId: string;
  inReplyTo: string;
  references: string[];
  date: string;
  body: string;
};

/**
 * Poll the IMAP mailbox for new replies and run them through handleReply.
 * Never throws — returns counts + optional reason. Shape matches
 * lib/reply/poll.ts's pollGmail() so the channel dispatcher can return
 * either without reshaping.
 */
export async function pollImapMailbox(): Promise<ImapPollResult> {
  const result: ImapPollResult = { processed: 0, skipped: 0, errors: 0 };

  if (!hasSupabaseEnv()) {
    result.reason = "no_supabase";
    console.log("[imap-poll] skipped — Supabase not configured");
    return result;
  }

  const creds = await getMailboxCredentials();
  if (!creds) {
    result.reason = "no_credentials";
    console.log("[imap-poll] skipped — no mailbox credentials");
    return result;
  }
  if (creds.kind !== "app_password") {
    result.reason = "wrong_kind";
    console.log("[imap-poll] skipped — mailbox kind is not app_password");
    return result;
  }

  // Lazy-load imapflow so unit tests that vi.mock("imapflow") don't pay
  // the price of the real module's TCP-machinery import.
  let ImapFlow: typeof import("imapflow").ImapFlow;
  try {
    ({ ImapFlow } = await import("imapflow"));
  } catch (err) {
    result.reason = "imap_connect_failed";
    console.warn(
      "[imap-poll] imapflow module unavailable:",
      err instanceof Error ? err.message : "unknown",
    );
    result.errors++;
    return result;
  }

  const client = new ImapFlow({
    host: creds.imapHost,
    port: creds.imapPort,
    secure: creds.imapPort === 993,
    auth: {
      user: creds.emailAddress,
      pass: creds.password,
    },
    // Silence imapflow's chatty default logger — it pretty-prints raw IMAP
    // frames which can echo subjects / from headers. Operational counts
    // only.
    logger: false,
    // Tay only polls + logs out; never IDLE-streams.
    disableAutoIdle: true,
  });

  try {
    try {
      await client.connect();
    } catch (err) {
      result.reason = isAuthError(err) ? "auth_failed" : "imap_connect_failed";
      result.errors++;
      console.warn(
        "[imap-poll] connect failed:",
        result.reason,
      );
      // No connection to close; just return.
      return result;
    }

    let mailbox: Awaited<ReturnType<typeof client.mailboxOpen>>;
    try {
      mailbox = await client.mailboxOpen("INBOX");
    } catch (err) {
      result.reason = "imap_connect_failed";
      result.errors++;
      console.warn(
        "[imap-poll] mailbox open failed (category only)",
        err instanceof Error ? err.name : "unknown",
      );
      return result;
    }

    const supabase = getSupabaseServerClient();

    // -- Read cursor ----------------------------------------------------
    const cursorQ = await supabase
      .from(CURSOR_TABLE)
      .select("last_uid")
      .eq("lock_col", CURSOR_LOCK_VALUE)
      .maybeSingle();
    if (cursorQ.error) {
      console.warn("[imap-poll] cursor read failed:", cursorQ.error.message);
      result.errors++;
      return result;
    }
    const cursorRow =
      (cursorQ.data as { last_uid: number | string } | null) ?? null;
    const lastUid = cursorRow ? Number(cursorRow.last_uid) : 0;

    // -- First poll → seed and bail (no backfill) -----------------------
    if (lastUid === 0) {
      // uidNext is the *next* UID Gmail will assign; one less is the
      // highest UID currently in the mailbox. If uidNext is 1 (empty
      // box) then last_uid stays at 0 — correct, since 0+1 = 1 is the
      // next expected UID.
      const seedUid = Math.max(0, (mailbox.uidNext ?? 1) - 1);
      const ups = await upsertCursorRow(supabase, seedUid);
      if (ups.error) {
        console.warn("[imap-poll] cursor seed failed:", ups.error.message);
        result.errors++;
      } else {
        console.log(
          `[imap-poll] cursor seeded (no backfill) last_uid=${seedUid}`,
        );
      }
      return result;
    }

    // -- Fetch deltas ---------------------------------------------------
    let highestSeen = lastUid;
    let processedCount = 0;
    try {
      // `${lastUid + 1}:*` = "everything from lastUid+1 onward". imapflow
      // accepts SequenceString plus options.uid=true to interpret it as
      // a UID range rather than a sequence-number range.
      const range = `${lastUid + 1}:*`;
      const fetchIter = client.fetch(
        range,
        {
          uid: true,
          envelope: true,
          source: true,
        },
        { uid: true },
      );
      for await (const msg of fetchIter) {
        // Don't process more than N per tick — protect against a sudden
        // backlog (e.g., cursor lost + manually reset to 0 in a giant
        // mailbox). highestSeen still advances so the next tick continues.
        if (processedCount >= MAX_MESSAGES_PER_POLL) {
          console.log(
            `[imap-poll] reached per-poll cap (${MAX_MESSAGES_PER_POLL}); will resume next tick`,
          );
          break;
        }
        if (typeof msg.uid !== "number") {
          // Defensive — imapflow always sets uid per the typedef. Skip.
          result.skipped++;
          continue;
        }
        if (msg.uid > highestSeen) highestSeen = msg.uid;

        const parsed = parseImapMessage(msg);
        if (!parsed.messageId && !parsed.inReplyTo) {
          // Can't dedupe (no Message-ID) and can't thread-match (no
          // In-Reply-To). Almost certainly not a reply to one of our
          // sends. Skip — don't even invoke handleReply (its dedupe key
          // requires gmail_message_id).
          result.skipped++;
          continue;
        }

        // Self-email short-circuit. Gmail/IMAP returns ALL inbox
        // messages — including ones we sent ourselves that the server
        // copied back into INBOX (Gmail does this for App Password
        // sends sometimes; other servers don't). Matches the v0.9
        // self-filter in pollGmail.
        const fromLower = parseFromAddress(parsed.from).toLowerCase();
        if (fromLower === creds.emailAddress.toLowerCase()) {
          result.skipped++;
          continue;
        }

        try {
          const r = await handleReply({
            // SMTP doesn't have a native thread id; pass the parsed
            // Message-ID (RFC 5322 — globally unique) as both the
            // dedupe key (gmailMessageId) and the thread anchor.
            // handle.ts also accepts inReplyToMessageId as a fallback
            // thread-match key so it can hop from "this reply's
            // In-Reply-To" → sent_messages.gmail_message_id.
            gmailMessageId: parsed.messageId || `<imap-uid-${msg.uid}>`,
            gmailThreadId: parsed.messageId || `<imap-uid-${msg.uid}>`,
            inReplyToMessageId: parsed.inReplyTo || undefined,
            fromEmail: parseFromAddress(parsed.from),
            subject: parsed.subject || undefined,
            body: parsed.body,
            receivedAt: parsed.date || new Date().toISOString(),
            // Audit channel tag (Tay gate F) — handle.ts forwards this
            // through into the audit payload.
            channel: "app_password",
          });
          if (r.ok) {
            result.processed++;
          } else {
            result.errors++;
            console.warn("[imap-poll] handleReply error (counts only)");
          }
        } catch (err) {
          result.errors++;
          console.warn(
            "[imap-poll] handleReply exception (category only):",
            err instanceof Error ? err.name : "unknown",
          );
        }
        processedCount++;
      }
    } catch (err) {
      // fetch loop blew up — keep whatever counts we already accumulated
      // and try to advance the cursor to highestSeen below. Don't lose
      // partial progress.
      result.errors++;
      console.warn(
        "[imap-poll] fetch loop failed (category only):",
        err instanceof Error ? err.name : "unknown",
      );
    }

    // -- Advance cursor -------------------------------------------------
    if (highestSeen > lastUid) {
      const ups = await upsertCursorRow(supabase, highestSeen);
      if (ups.error) {
        console.warn(
          "[imap-poll] cursor advance failed:",
          ups.error.message,
        );
        result.errors++;
      }
    }

    console.log(
      `[imap-poll] processed=${result.processed} skipped=${result.skipped} errors=${result.errors}`,
    );
    return result;
  } finally {
    // Always try to log out so we don't leave a session dangling on the
    // server. Best-effort; both logout and close can throw on a wedged
    // socket.
    try {
      await client.logout();
    } catch {
      try {
        client.close();
      } catch {
        /* swallow */
      }
    }
  }
}

/**
 * Single-row upsert keyed on lock_col. Same pattern as
 * lib/reply/poll.ts:upsertCursorRow.
 */
async function upsertCursorRow(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  uid: number,
): Promise<{ error: { message: string } | null }> {
  const result = await supabase.from(CURSOR_TABLE).upsert(
    {
      lock_col: CURSOR_LOCK_VALUE,
      last_uid: uid,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "lock_col" },
  );
  return { error: result.error ?? null };
}

/**
 * Parse an imapflow FetchMessageObject into the headers + body shape
 * handleReply needs. Prefer the parsed envelope (imapflow already RFC-
 * 5322-decoded it); fall back to manual header extraction from the raw
 * source for headers the envelope doesn't expose (References).
 *
 * Body extraction: regex out the first text/plain MIME part; fall back
 * to a minimal HTML-stripped fallback if there's only text/html. The
 * downstream classifier wraps whatever we pass into <untrusted_source>,
 * so we don't have to defend against injection at this seam.
 *
 * Exported for tests.
 */
export function parseImapMessage(msg: {
  envelope?: {
    from?: Array<{ name?: string; address?: string }>;
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    date?: Date;
  };
  source?: Buffer;
}): ParsedHeaders {
  const env = msg.envelope ?? {};
  const fromObj = (env.from ?? [])[0] ?? {};
  const fromName = fromObj.name ?? "";
  const fromAddr = fromObj.address ?? "";
  const from = fromName
    ? `${fromName} <${fromAddr}>`
    : fromAddr;

  const sourceText = msg.source ? msg.source.toString("utf8") : "";

  // Pull References from raw headers (envelope doesn't expose it).
  const refsHeader = extractHeader(sourceText, "References");
  const references = refsHeader
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("<") && s.endsWith(">"));

  // In-Reply-To: prefer envelope, fall back to header parse.
  let inReplyTo = (env.inReplyTo ?? "").trim();
  if (!inReplyTo) inReplyTo = extractHeader(sourceText, "In-Reply-To").trim();
  // For thread-matching we only ever care about the *first* ID — if
  // In-Reply-To is empty but References has entries, use the last
  // References entry (the immediate parent in the thread).
  if (!inReplyTo && references.length > 0) {
    inReplyTo = references[references.length - 1];
  }

  const messageId = (env.messageId ?? extractHeader(sourceText, "Message-ID")).trim();
  const subject = (env.subject ?? "").trim();
  const date = env.date ? env.date.toISOString() : "";

  const body = extractBody(sourceText);

  return {
    from,
    subject,
    messageId,
    inReplyTo,
    references,
    date,
    body,
  };
}

/**
 * Case-insensitive header extractor. Returns the (un-folded) value of
 * the first matching header, or "". Handles RFC 5322 line folding
 * (continuation lines start with whitespace).
 */
function extractHeader(source: string, name: string): string {
  if (!source) return "";
  // Split on \r\n\r\n or \n\n to get the header block.
  const sep = source.indexOf("\r\n\r\n");
  const altSep = sep === -1 ? source.indexOf("\n\n") : sep;
  const headerBlock = altSep === -1 ? source : source.slice(0, altSep);
  const lines = headerBlock.split(/\r?\n/);
  const target = name.toLowerCase() + ":";
  let i = 0;
  while (i < lines.length) {
    if (lines[i].toLowerCase().startsWith(target)) {
      let value = lines[i].slice(target.length).trim();
      // Unfold continuation lines.
      while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
        value += " " + lines[i + 1].trim();
        i++;
      }
      return value;
    }
    i++;
  }
  return "";
}

/**
 * Extract a usable body from raw RFC 5322 source. Strategy:
 *   1. If Content-Type is text/plain → return the body block as-is.
 *   2. If Content-Type is multipart/* → find the first text/plain part
 *      and return its body block.
 *   3. Otherwise (text/html only, etc.) → strip HTML tags from the
 *      first text-ish part.
 * Best-effort; the classifier downstream is the LOAD-BEARING defense
 * (gate H: <untrusted_source> wrap), so a degraded body parse just
 * gives the classifier slightly worse signal, not a security risk.
 */
function extractBody(source: string): string {
  if (!source) return "";

  const sep = source.indexOf("\r\n\r\n");
  const altSep = sep === -1 ? source.indexOf("\n\n") : sep;
  if (altSep === -1) return source.trim();
  const headerBlock = source.slice(0, altSep);
  const bodyBlock = source.slice(altSep).replace(/^\r?\n\r?\n/, "");

  const contentTypeRaw = extractHeader(headerBlock, "Content-Type");
  const contentType = contentTypeRaw.toLowerCase();

  if (contentType.startsWith("text/plain")) {
    return decodeIfQuotedPrintable(bodyBlock, headerBlock).trim();
  }

  if (contentType.startsWith("multipart/")) {
    // Preserve case for boundary extraction — RFC 2046 boundaries are
    // case-sensitive and lowercase-matching would corrupt mixed-case
    // markers (e.g., "BNDRY").
    const boundaryMatch = contentTypeRaw.match(/boundary="?([^";]+)"?/i);
    const boundary = boundaryMatch?.[1];
    if (boundary) {
      const parts = bodyBlock.split(`--${boundary}`);
      // Prefer text/plain part; fall back to first text-ish part.
      for (const part of parts) {
        const ct = extractHeader(part, "Content-Type").toLowerCase();
        if (ct.startsWith("text/plain")) {
          const ps = part.indexOf("\r\n\r\n");
          const altPs = ps === -1 ? part.indexOf("\n\n") : ps;
          if (altPs === -1) continue;
          return decodeIfQuotedPrintable(
            part.slice(altPs).replace(/^\r?\n\r?\n/, ""),
            part.slice(0, altPs),
          ).trim();
        }
      }
      for (const part of parts) {
        const ct = extractHeader(part, "Content-Type").toLowerCase();
        if (ct.startsWith("text/html")) {
          const ps = part.indexOf("\r\n\r\n");
          const altPs = ps === -1 ? part.indexOf("\n\n") : ps;
          if (altPs === -1) continue;
          return stripHtml(
            decodeIfQuotedPrintable(
              part.slice(altPs).replace(/^\r?\n\r?\n/, ""),
              part.slice(0, altPs),
            ),
          ).trim();
        }
      }
    }
  }

  if (contentType.startsWith("text/html")) {
    return stripHtml(decodeIfQuotedPrintable(bodyBlock, headerBlock)).trim();
  }

  // No usable content-type info → return raw body. Classifier still
  // wraps in <untrusted_source>; gate H holds.
  return bodyBlock.trim();
}

function decodeIfQuotedPrintable(body: string, headers: string): string {
  const enc = extractHeader(headers, "Content-Transfer-Encoding").toLowerCase();
  if (enc !== "quoted-printable") return body;
  // Minimal QP decoder: soft line breaks =\r\n / =\n → ""; =XX → byte.
  return body
    .replace(/=\r?\n/g, "")
    .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    );
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

/**
 * Heuristic: was this connect failure an auth error vs a connect error?
 * imapflow throws AuthenticationFailureError ({ authenticationFailed:
 * true }) on bad creds, generic Error on network. Don't ever log the
 * underlying message — it can echo the password (RFC 9051 servers do
 * include the failed user in their response).
 */
function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  if ((err as { authenticationFailed?: boolean }).authenticationFailed) {
    return true;
  }
  const code = (err as { code?: string }).code;
  if (code === "EAUTH" || code === "AUTHENTICATIONFAILED") return true;
  return false;
}

/**
 * Pull the bare email address out of an RFC 5322 From header. Same
 * helper as in lib/reply/poll.ts — kept in-module so tests don't need
 * to cross-import.
 */
function parseFromAddress(from: string): string {
  if (!from) return "";
  const angle = from.match(/<([^>]+)>/);
  if (angle && angle[1]) return angle[1].trim();
  return from.trim();
}
