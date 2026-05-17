// AI disclosure footer — Tay gate C.
//
// v0.4: constant disclosure footer. v0.5/v0.7 swap to a per-jurisdiction
// lookup (US-CAN-EU defaults vary; user setting overrides). Until then,
// EVERY generated draft body includes this footer.

export const AI_DISCLOSURE_FOOTER =
  "\n\n— Written with AI assistance. Reply STOP to opt out.";

/**
 * Append the AI disclosure footer to a draft body. Idempotent — if the
 * model already inserted the footer (or any variation that includes
 * "Written with AI assistance"), we return the body unchanged. Trims
 * trailing whitespace before appending so the spacing is predictable.
 */
export function withDisclosure(body: string): string {
  if (body.includes("Written with AI assistance")) return body;
  return body.trimEnd() + AI_DISCLOSURE_FOOTER;
}
