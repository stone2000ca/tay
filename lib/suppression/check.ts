// Suppression check — Tay gate E.
//
// v0.7: STUB. Always returns false. v0.8 will wire the real list
// (unsubscribe header, manual entries, bounce-driven adds, complaint-
// driven adds).
//
// Contract: EVERY send-path call MUST invoke this BEFORE the Gmail API
// call. The orchestrator (lib/send/orchestrate.ts) is the single
// chokepoint that guarantees this — no other code is allowed to call
// Gmail directly.
//
// READ function — soft-fail to `false` is the WRONG default in a future
// world where the list is non-empty (false = "go ahead and send"). The
// v0.8 implementation should default to `true` on read error so a
// crashed DB never causes a spam-burst. v0.7 stub's `false` is safe
// only because the list is logically empty.

export async function isSuppressed(_email: string): Promise<boolean> {
  return false;
}
