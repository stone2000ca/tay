// AI disclosure footer — Tay gate C.
//
// v0.4: constant disclosure footer.
// v0.8: per-recipient unsubscribe link injected when we know the recipient
//       AND the unsubscribe HMAC secret is reachable. Older drafts that
//       landed before v0.8 still carry the constant "Reply STOP" footer
//       — that's by design.
// v1.1.1: site URL comes from getSiteUrl() (which falls through Vercel's
//       auto-set env vars when NEXT_PUBLIC_SITE_URL is unset).
//
// EVERY new draft body MUST run through withDisclosure(). The drafter
// (lib/draft/generate.ts) calls it; the orchestrator does not double-call
// (idempotent via the substring check).

import { generateUnsubscribeToken } from "../unsubscribe/token";
import { getSiteUrl } from "../site-url";

export const AI_DISCLOSURE_FOOTER =
  "\n\n— Written with AI assistance. Reply STOP to opt out.";

const DISCLOSURE_MARKER = "Written with AI assistance";

/**
 * Append the AI disclosure footer to a draft body.
 *
 * If `opts.recipientEmail` is provided AND the HMAC secret + site URL
 * can be resolved, the footer includes a per-recipient unsubscribe link
 * of the form `${siteUrl}/u/<token>`. If either is unavailable, we fall
 * back to the constant "Reply STOP" footer. Either footer satisfies
 * Tay gate C.
 *
 * Idempotent — if the body already contains the disclosure marker
 * "Written with AI assistance" (any variation including the v0.4
 * constant footer), the body is returned unchanged. This means an
 * old v0.4 draft re-displayed through withDisclosure won't suddenly
 * pick up an unsubscribe link — the body it stored to disk is what
 * was sent.
 *
 * NOW ASYNC: generateUnsubscribeToken became async in v1.1.1 (secret
 * may go through the derive path which hits the DB).
 */
export async function withDisclosure(
  body: string,
  opts?: { recipientEmail?: string },
): Promise<string> {
  if (body.includes(DISCLOSURE_MARKER)) return body;

  const footer = await buildFooter(opts?.recipientEmail);
  return body.trimEnd() + footer;
}

async function buildFooter(recipientEmail: string | undefined): Promise<string> {
  if (!recipientEmail) return AI_DISCLOSURE_FOOTER;
  const siteUrl = getSiteUrl();
  // getSiteUrl always returns a non-empty string; we still guard for the
  // dev-fallback localhost case where shipping the link to a recipient
  // wouldn't be useful. If the user is running against localhost, fall
  // back to the constant footer.
  if (siteUrl.startsWith("http://localhost")) return AI_DISCLOSURE_FOOTER;
  let token: string;
  try {
    token = await generateUnsubscribeToken(recipientEmail);
  } catch (err) {
    // Unsubscribe secret unreachable — fall back. We never want a
    // missing-secret to break drafting. The send path will still be
    // blocked upstream (the orchestrator and OAuth flow both require
    // the same secret), but at minimum the user can preview the draft.
    console.warn(
      "[disclosure] token generation failed:",
      err instanceof Error ? err.message : "unknown",
    );
    return AI_DISCLOSURE_FOOTER;
  }
  const base = siteUrl.replace(/\/+$/, "");
  const link = `${base}/u/${token}`;
  return (
    "\n\n— Written with AI assistance. " +
    `Unsubscribe: ${link}` +
    "\n(Or reply STOP and we'll take you off the list.)"
  );
}
