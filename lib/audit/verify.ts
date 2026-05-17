// Audit chain verifier.
//
// READ function — soft-fails to a discriminated `{ ok: false, ... }`
// result rather than throwing. Same convention as the rest of Tay's
// read surfaces (getLatestDecisionForDraft, getRubric, getAppConfig).
//
// The verifier is what makes the hash chain MEAN something: it walks
// the chain in (occurred_at ASC, id ASC) order and recomputes each
// row's expected hash from the stored prev_hash, payload, occurred_at,
// and action. Two failure modes:
//   - hash_mismatch:    the stored this_hash doesn't match the recompute
//                       (someone tampered with the row's payload, or
//                       there's a bug in the writer)
//   - prev_hash_mismatch: the stored prev_hash doesn't equal the
//                       previous row's this_hash (someone deleted a
//                       row or inserted out of order)
//
// v0.6 loads the whole chain into memory. Single-tenant rows in the
// low thousands at v1.0 — acceptable. v1.0+ candidate: paginate via
// range() if rows > 10000.

import { getSupabaseServerClient, hasSupabaseEnv } from "../supabase/server";
import { computeHash } from "./hash";

const TABLE = "audit_log";

export type AuditVerifyOk = {
  ok: true;
  totalRows: number;
  lastHash: string | null;
};

export type AuditVerifyBroken = {
  ok: false;
  totalRows: number;
  brokenAt: {
    id: number;
    expectedHash: string;
    storedHash: string;
    reason:
      | "hash_mismatch"
      | "prev_hash_mismatch"
      | "supabase_unavailable"
      | "read_error";
  };
};

export type AuditVerifyResult = AuditVerifyOk | AuditVerifyBroken;

type AuditRow = {
  id: number;
  occurred_at: string;
  action: string;
  payload: Record<string, unknown>;
  prev_hash: string | null;
  this_hash: string;
};

/**
 * Walk the audit chain and recompute each row's hash.
 *
 * Soft-fails:
 *   - Supabase env missing → `{ ok: false, brokenAt: { reason: "supabase_unavailable" }, totalRows: 0 }`
 *   - DB read error        → `{ ok: false, brokenAt: { reason: "read_error" }, totalRows: 0 }`
 *
 * Hard-fails (chain actually broken):
 *   - row.this_hash !== expected     → reason: "hash_mismatch"
 *   - row.prev_hash !== previous.this_hash → reason: "prev_hash_mismatch"
 *
 * Returns the discriminated result; never throws.
 */
export async function verifyAuditChain(): Promise<AuditVerifyResult> {
  if (!hasSupabaseEnv()) {
    return {
      ok: false,
      totalRows: 0,
      brokenAt: {
        id: 0,
        expectedHash: "",
        storedHash: "",
        reason: "supabase_unavailable",
      },
    };
  }

  let rows: AuditRow[];
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, occurred_at, action, payload, prev_hash, this_hash")
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      return {
        ok: false,
        totalRows: 0,
        brokenAt: {
          id: 0,
          expectedHash: "",
          storedHash: "",
          reason: "read_error",
        },
      };
    }
    rows = (data ?? []) as AuditRow[];
  } catch {
    return {
      ok: false,
      totalRows: 0,
      brokenAt: {
        id: 0,
        expectedHash: "",
        storedHash: "",
        reason: "read_error",
      },
    };
  }

  if (rows.length === 0) {
    return { ok: true, totalRows: 0, lastHash: null };
  }

  let previousThisHash: string | null = null;
  for (const row of rows) {
    // Check 1: prev_hash on this row must match the prior row's this_hash.
    // For the very first row, both should be null.
    if (row.prev_hash !== previousThisHash) {
      return {
        ok: false,
        totalRows: rows.length,
        brokenAt: {
          id: row.id,
          expectedHash: previousThisHash ?? "",
          storedHash: row.prev_hash ?? "",
          reason: "prev_hash_mismatch",
        },
      };
    }

    // Check 2: recompute this row's hash and compare to stored.
    const expected = computeHash({
      prev_hash: row.prev_hash,
      payload: row.payload,
      occurred_at: row.occurred_at,
      action: row.action,
    });
    if (expected !== row.this_hash) {
      return {
        ok: false,
        totalRows: rows.length,
        brokenAt: {
          id: row.id,
          expectedHash: expected,
          storedHash: row.this_hash,
          reason: "hash_mismatch",
        },
      };
    }

    previousThisHash = row.this_hash;
  }

  return {
    ok: true,
    totalRows: rows.length,
    lastHash: previousThisHash,
  };
}

export type AuditEventRow = {
  id: number;
  occurred_at: string;
  action: string;
  payload: Record<string, unknown>;
};

/**
 * Read the most-recent N audit events (newest first). Soft-fails to
 * an empty array when Supabase is unavailable or the read errors —
 * the /audit page must always render.
 *
 * READ function — soft-fail.
 */
export async function getRecentAuditEvents(
  limit = 50,
): Promise<AuditEventRow[]> {
  if (!hasSupabaseEnv()) return [];
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from(TABLE)
      .select("id, occurred_at, action, payload")
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit);
    if (error) {
      console.warn(
        "[audit verify] recent-events read failed:",
        error.message,
      );
      return [];
    }
    return (data ?? []) as AuditEventRow[];
  } catch (err) {
    console.warn(
      "[audit verify] recent-events unavailable:",
      err instanceof Error ? err.message : String(err),
    );
    return [];
  }
}
