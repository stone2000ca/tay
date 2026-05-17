// AI disclosure footer — Tay gate C.
//
// v0.4: constant disclosure footer.
// v0.8: per-recipient unsubscribe link injected when we know the recipient
//       AND the TAY_OAUTH_SECRET is configured (needed to sign the
//       unsubscribe token). Older drafts that landed before v0.8 still
//       carry the constant "Reply STOP" footer — that's by design.
//
// EVERY new draft body MUST run through withDisclosure(). The drafter
// (lib/draft/generate.ts) calls it; the orchestrator does not double-call
// (idempotent via the substring check).

import { generateUnsubscribeToken } from "../unsubscribe/token";

export const AI_DISCLOSURE_FOOTER =
  "\n\n— Written with AI assistance. Reply STOP to opt out.";

const DISCLOSURE_MARKER = "Written with AI assistance";

/**
 * Append the AI disclosure footer to a draft body.
 *
 * If `opts.recipientEmail` is provided AND `TAY_OAUTH_SECRET` is set,
 * the footer includes a per-recipient unsubscribe link of the form
 * `${NEXT_PUBLIC_SITE_URL}/u/<token>`. If either is missing, we fall
 * back to the constant "Reply STOP" footer. Either footer satisfies
 * Tay gate C.
 *
 * Idempotent — if the body already contains the disclosure marker
 * "Written with AI assistance" (any variation including the v0.4
 * constant footer), the body is returned unchanged. This means an
 * old v0.4 draft re-displayed through withDisclosure won't suddenly
 * pick up an unsubscribe link — the body it stored to disk is what
 * was sent.
 */
export function withDisclosure(
  body: string,
  opts?: { recipientEmail?: string },
): string {
  if (body.includes(DISCLOSURE_MARKER)) return body;

  const footer = buildFooter(opts?.recipientEmail);
  return body.trimEnd() + footer;
}

function buildFooter(recipientEmail: string | undefined): string {
  if (!recipientEmail) return AI_DISCLOSURE_FOOTER;
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return AI_DISCLOSURE_FOOTER;
  let token: string;
  try {
    token = generateUnsubscribeToken(recipientEmail);
  } catch (err) {
    // TAY_OAUTH_SECRET missing or malformed — fall back. We never want
    // a missing-secret to break drafting. The send path will still be
    // blocked upstream (the orchestrator and OAuth flow both require
    // the same secret), but at minimum the user can preview the draft.
    //
    // v0.9 addition: warn so operators see the misconfiguration. Without
    // this, the only visible signal is "no link in the footer" — easy to
    // miss in a green-on-green deployment. Never log the recipient (Tay
    // logging rule).
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
