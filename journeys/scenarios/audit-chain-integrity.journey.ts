// JOURNEY — gate F: audit hash chain integrity.
//
// Builds a 3-row chain in memory using the REAL computeHash function,
// then tampers with row 2's payload and re-walks the chain. The
// verifier MUST report `ok: false` and identify the broken row.
//
// This exercises the load-bearing crypto — `appendAudit` and
// `verifyAuditChain` are mocked in the JOURNEYS test boundary, but the
// hash math itself is pure and re-used here.

import type { Journey, JourneyResult } from "../types";
import { computeHash } from "../../lib/audit/hash";

type Row = {
  id: number;
  occurred_at: string;
  action: string;
  payload: Record<string, unknown>;
  prev_hash: string | null;
  this_hash: string;
};

function buildChain(): Row[] {
  const rows: Row[] = [];
  let prev: string | null = null;
  const events = [
    { action: "draft.created", payload: { draftId: "d1" } },
    { action: "judge.decision", payload: { draftId: "d1", decision: "allow" } },
    { action: "send.sent", payload: { draftId: "d1" } },
  ];
  events.forEach((e, i) => {
    const occurred_at = `2026-05-17T10:0${i}:00.000Z`;
    const this_hash = computeHash({
      prev_hash: prev,
      payload: e.payload,
      occurred_at,
      action: e.action,
    });
    rows.push({
      id: i + 1,
      occurred_at,
      action: e.action,
      payload: e.payload,
      prev_hash: prev,
      this_hash,
    });
    prev = this_hash;
  });
  return rows;
}

function walkChain(
  rows: Row[],
): { ok: true } | { ok: false; brokenAt: number; reason: string } {
  let prev: string | null = null;
  for (const row of rows) {
    if (row.prev_hash !== prev) {
      return { ok: false, brokenAt: row.id, reason: "prev_hash_mismatch" };
    }
    const expected = computeHash({
      prev_hash: row.prev_hash,
      payload: row.payload,
      occurred_at: row.occurred_at,
      action: row.action,
    });
    if (expected !== row.this_hash) {
      return { ok: false, brokenAt: row.id, reason: "hash_mismatch" };
    }
    prev = row.this_hash;
  }
  return { ok: true };
}

export const journey: Journey = {
  name: "audit chain integrity",
  gate: "F",
  description:
    "Tamper with row 2's payload; verifyAuditChain returns ok:false brokenAt:2.",
  setup: async () => {
    /* no LLM, no DB — pure crypto */
  },
  run: async (): Promise<JourneyResult> => {
    const chain = buildChain();
    // First: an untampered walk must pass.
    const cleanWalk = walkChain(chain);
    if (!cleanWalk.ok) {
      return {
        kind: "error",
        message: `clean chain failed walk: ${cleanWalk.reason}`,
      };
    }
    // Tamper with row 2's payload (mutate the in-memory object).
    chain[1].payload = { draftId: "d1", decision: "block" };
    const tamperedWalk = walkChain(chain);
    return {
      kind: "ok",
      data: tamperedWalk,
    };
  },
  assertions: (result) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got: ${(result as { message: string }).message}`);
    }
    const d = result.data as Record<string, unknown>;
    if (d.ok !== false) {
      throw new Error("tampered chain unexpectedly passed walk");
    }
    if (d.brokenAt !== 2) {
      throw new Error(`expected brokenAt=2, got ${d.brokenAt}`);
    }
    if (d.reason !== "hash_mismatch") {
      throw new Error(`expected reason=hash_mismatch, got ${d.reason}`);
    }
  },
};
