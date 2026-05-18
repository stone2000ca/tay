// Audit log surface — Tay gate F.
//
// v0.6: REAL implementation. Replaces the v0.5 no-op stub. Every call to
// `appendAudit` writes a row to `audit_log` with a tamper-evident sha256
// hash chain: `this_hash = sha256(prev_hash + canonical_json(payload) +
// occurred_at + action)`. Public API (`appendAudit({ action, payload })
// => Promise<void>`) is UNCHANGED from v0.5 so existing callers in
// app/draft/actions.ts keep working.
//
// READ-VS-WRITE error contract: `appendAudit` is the exception to the
// "WRITE throws, READ soft-fails" rule that applies elsewhere (see
// lib/judge/persist.ts header). Audit is BEST-EFFORT: an audit-write
// failure must never block the user's send path. The chain-break, if it
// happens, is surfaced by the verifier (lib/audit/verify.ts) on demand.
//
// REDACTOR POLICY DECISION (Approach A — wide matcher, v0.6, extended v0.8):
// The v0.5 stub's redactor had drift between its header doc ("redacts
// email/body/raw") and its matcher (only api_key/secret/token/password).
// v0.6 closes the drift by EXPANDING the matcher to cover the bodies
// and PII-shaped keys the doc claimed. This becomes load-bearing in
// v0.7 when send-event callers come online with `to`, `from`, `body`,
// `raw_message` payloads. Each protected key has a parameterized test
// asserting the redaction fires. Callers are still EXPECTED to
// pre-redact — this layer is belt-and-braces.
//
// v0.8 addition: `subject` joins the protected list. Subjects in cold-
// outbound can carry prospect-identifying info ("Quick question about
// your team at Acme") — same PII concern as bodies. The send.sent
// caller deliberately passes the subject knowing the redactor will
// mask it on the way to disk.
//
// Concurrency caveat: v0.6 is single-tenant single-user. Two parallel
// `appendAudit` calls could race on `prev_hash` (both read the same
// last-row hash, both insert with the same `prev_hash`). The verifier
// would flag this as a `prev_hash_mismatch`. Acceptable for v0.6;
// v1.0 candidate to upgrade to a row-level lock or SERIALIZABLE
// transaction. Documented here so the next engineer doesn't have to
// re-derive it from first principles.

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";
import { computeHash } from "./hash";

export type AuditAction =
  | "judge.decision"
  | "draft.created"
  | "send.sent"
  | "reply.sent"
  | "suppression.added"
  // v0.7 additions — OAuth connect/disconnect.
  | "oauth.connected"
  | "oauth.disconnected"
  // v0.8 additions — suppression list management + unsubscribe.
  | "suppression.removed"
  | "user.unsubscribed"
  // v0.9 additions — inbound reply pipeline.
  | "reply.received"
  | "reply.classified"
  | "reply.draft_generated"
  // v0.9 — explicit user toggle for auto-reply (trust-tier decision).
  | "reply.auto_reply_toggled"
  // v1.0 — trust-tier promotion/demotion events (Tay gate I).
  | "trust.tier_changed"
  | "trust.manual_override_set"
  // v1.1.1 — instance-secrets lifecycle (Tay gate F).
  | "secrets.salt_bootstrapped"
  | "secrets.llm_key_set"
  | "secrets.llm_key_rotated"
  // v1.1.2 — channel-agnostic mailbox lifecycle (Tay gate F).
  // The legacy oauth.connected / oauth.disconnected events from v0.7
  // stay (they were Google-OAuth-specific). New connect/disconnect
  // flows write mailbox.* — kind: "oauth" | "app_password".
  | "mailbox.connected"
  | "mailbox.disconnected"
  // v1.1.3 — voice calibration lifecycle (Tay gate F) + wizard
  // completion marker. voice.calibrated carries the path used
  // (emails / describe / url / zero) so the hash chain reflects HOW
  // the rubric was extracted; setup.completed marks the post-rubric
  // wizard sub-flow finished.
  | "voice.calibrated"
  | "setup.completed"
  // v1.1.4 — reply notification lifecycle (Tay gate F). reply.notified
  // is appended after every notifyReply() dispatch (success OR skip)
  // and carries operational metadata only (channel, intent, notified,
  // reason) — never the reply body or the Slack webhook URL.
  // notifications.configured records a user preference change.
  | "reply.notified"
  | "notifications.configured";

export type AuditEvent = {
  action: AuditAction;
  payload: Record<string, unknown>;
};

const TABLE = "audit_log";

/**
 * Append a Tier-3 event to the audit log with sha256 hash chain.
 *
 * Behavior:
 *   - Reads the latest row's `this_hash` from `audit_log` (single
 *     query). Uses it as `prev_hash`. Sets to null for the first row.
 *   - Redacts the payload via `redactPayload` BEFORE hashing — the
 *     on-disk record matches what was hashed.
 *   - Computes `occurred_at` (ISO string) BEFORE the DB write so the
 *     hash is deterministic.
 *   - Inserts (occurred_at, action, payload, prev_hash, this_hash).
 *   - Never throws — audit is best-effort.
 *
 * Cold-start safety: if Supabase env is missing, logs a [audit]
 * skipped line and returns. Same pattern as `ensureSchema()`.
 */
export async function appendAudit(event: AuditEvent): Promise<void> {
  try {
    if (!hasSupabaseEnv()) {
      console.log(
        `[audit] skipped — no Supabase (action=${event.action})`,
      );
      return;
    }

    const occurred_at = new Date().toISOString();
    const redactedPayload = redactPayload(event.payload);

    const supabase = getSupabaseServerClient();

    // Read the latest row's this_hash. Single query, indexed on
    // (occurred_at DESC, id DESC). Returns null for the first row.
    const latest = await supabase
      .from(TABLE)
      .select("this_hash")
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latest.error) {
      console.warn(
        "[audit] latest-row read failed:",
        latest.error.message,
      );
      return;
    }

    const prev_hash: string | null =
      (latest.data?.this_hash as string | undefined) ?? null;

    const this_hash = computeHash({
      prev_hash,
      payload: redactedPayload,
      occurred_at,
      action: event.action,
    });

    const ins = await supabase.from(TABLE).insert({
      occurred_at,
      action: event.action,
      payload: redactedPayload,
      prev_hash,
      this_hash,
    });

    if (ins.error) {
      console.warn(
        "[audit] write failed:",
        ins.error.message,
      );
      return;
    }
  } catch (err) {
    // Audit is best-effort. Never throw — the user's pipeline must
    // not break because the audit log is unreachable.
    console.warn(
      "[audit] write failed:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Defensive redaction (Approach A — wide matcher, v0.6).
 *
 * Matches any key whose lowercased name CONTAINS one of:
 *   - secret-shaped: api_key, apikey, secret, token, password
 *   - PII-shaped:    email, body, raw_body, raw, prospect_email
 *
 * For matched keys: replace with "[redacted]".
 * For unmatched string values >200 chars: truncate with marker.
 * Recurses into nested objects; maps over arrays.
 *
 * Callers MUST still pre-redact PII at the call site — this layer is
 * belt-and-braces and the per-key matcher cannot catch
 * differently-named-but-still-PII fields like `recipient` or `addr`.
 */
export function redactPayload(payload: unknown): Record<string, unknown> {
  const out = redactValue(payload);
  // Top-level always returns an object shape — callers pass objects.
  if (out && typeof out === "object" && !Array.isArray(out)) {
    return out as Record<string, unknown>;
  }
  // Defensive: if a non-object slipped in, wrap it.
  return { value: out };
}

const PROTECTED_KEY_FRAGMENTS = [
  "api_key",
  "apikey",
  "secret",
  "token",
  "password",
  "email",
  "body",
  "raw_body",
  "raw",
  "prospect_email",
  // v0.8: subjects carry prospect-identifying info (company names,
  // first names, deal context). Same PII concern as bodies.
  "subject",
] as const;

function isProtectedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return PROTECTED_KEY_FRAGMENTS.some((frag) => lower.includes(frag));
}

function redactValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactValue);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(obj)) {
      if (isProtectedKey(key)) {
        out[key] = "[redacted]";
        continue;
      }
      if (typeof v === "string" && v.length > 200) {
        out[key] = `${v.slice(0, 200)}<TRUNCATED:${v.length}>`;
        continue;
      }
      out[key] = redactValue(v);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 200) {
    return `${value.slice(0, 200)}<TRUNCATED:${value.length}>`;
  }
  return value;
}
