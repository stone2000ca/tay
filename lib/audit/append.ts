// Audit log surface — Tay gate F.
//
// v0.5: this is a NO-OP STUB. We wire `appendAudit` at every Tier-3 call
// site now (judge decisions in v0.5, send in v0.7, reply-send in v0.9,
// suppression updates in v0.8) so v0.6 can swap the real hash-chain
// implementation in WITHOUT touching the call sites.
//
// v0.6 will:
//   - Read the previous row's `this_hash` from `audit_log`
//   - Compute `this_hash = sha256(prev_hash || canonicalJson(payload))`
//   - INSERT (occurred_at, action, payload, prev_hash, this_hash)
//   - Make the chain verifiable via a separate reader
//
// Redaction policy (v0.5 + v0.6): callers must pass payloads that have
// ALREADY been redacted — never include raw PII, never include the full
// email body, never include the OpenRouter key. The v0.5 stub also
// defensively trims known-large fields below as belt-and-braces.

export type AuditAction =
  | "judge.decision"
  | "draft.created"
  | "send.sent"
  | "reply.sent"
  | "suppression.added";

export type AuditEvent = {
  action: AuditAction;
  payload: Record<string, unknown>;
};

/**
 * Append a Tier-3 event to the audit log.
 *
 * v0.5: prints a redacted line to the server log. Never throws.
 * v0.6: writes to `audit_log` with hash chain. Will still never throw
 *       (audit failure must not block the user's send path; the chain
 *       break will be flagged by the verifier instead).
 */
export async function appendAudit(event: AuditEvent): Promise<void> {
  try {
    const safePayload = redactPayload(event.payload);
    console.log(
      `[audit:stub] action=${event.action} payload=${JSON.stringify(safePayload)}`,
    );
  } catch {
    // Never propagate — audit is best-effort even in v0.5.
  }
}

/**
 * Defensive redaction. Callers SHOULD pre-redact; this is belt-and-
 * braces for known-large or known-sensitive keys. Anything called
 * "body", "email", "api_key", "raw" gets either truncated or replaced.
 */
function redactPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("api_key") ||
      lower.includes("apikey") ||
      lower.includes("secret") ||
      lower.includes("token") ||
      lower.includes("password")
    ) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > 200) {
      out[key] = value.slice(0, 200) + "…[truncated]";
      continue;
    }
    out[key] = value;
  }
  return out;
}
