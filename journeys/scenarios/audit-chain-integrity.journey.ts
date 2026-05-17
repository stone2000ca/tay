// JOURNEY — gate F: audit hash chain integrity via verifyAuditChain.
//
// This is the SOLE gate-F regression journey, so it must exercise the
// REAL `verifyAuditChain` against a programmed Supabase result set.
// Anything less and the gate has no actual regression coverage.
//
// Strategy:
//   1. Build a 3-row chain in memory using the REAL `computeHash` —
//      identical to how `appendAudit` would write it.
//   2. Program the mocked Supabase client (FakeChain in factories.ts)
//      to return those rows from `.from("audit_log").select(...)`.
//   3. Call the REAL `verifyAuditChain` from lib/audit/verify.ts.
//      Assert { ok: true, totalRows: 3, lastHash: <row3.this_hash> }.
//   4. TAMPER with row 2's payload WITHOUT recomputing its this_hash.
//      Call verifyAuditChain again — must report
//      { ok: false, brokenAt: { id: 2, reason: "hash_mismatch" } }.
//   5. Also exercise the prev_hash_mismatch path: break row 3's prev_hash
//      and assert reason="prev_hash_mismatch", brokenAt.id=3.
//
// The journey runs three verifyAuditChain calls in `run()` and the
// assertions check all three outcomes.

import type { Journey, JourneyResult } from "../types";
import { computeHash } from "../../lib/audit/hash";
import { verifyAuditChain } from "../../lib/audit/verify";

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

export const journey: Journey = {
  name: "audit chain integrity via verifyAuditChain",
  gate: "F",
  description:
    "Real verifyAuditChain on a programmed Supabase result set: clean chain ok; tampered payload → hash_mismatch; broken prev_hash → prev_hash_mismatch.",
  setup: async (mc) => {
    // We program THREE distinct Supabase reads — one per verifyAuditChain
    // invocation in run(). Each pops a fresh result keyed on the
    // audit_log table. The FakeChain's terminating `.then()` matches by
    // table (method optional in popDbResult), so we push table-only.
    const cleanChain = buildChain();

    // Result 1: untampered chain → verifier returns ok:true.
    mc.pushDbResult(
      { table: "audit_log" },
      { data: cleanChain, error: null },
    );

    // Result 2: same chain but row 2's payload tampered with (this_hash
    // left as the original). Verifier MUST flag hash_mismatch on id=2.
    const tamperedChain = buildChain();
    tamperedChain[1] = {
      ...tamperedChain[1],
      payload: { draftId: "d1", decision: "block" }, // changed from allow
    };
    mc.pushDbResult(
      { table: "audit_log" },
      { data: tamperedChain, error: null },
    );

    // Result 3: chain where row 3's prev_hash is wrong. Verifier MUST
    // flag prev_hash_mismatch on id=3.
    const brokenLinkChain = buildChain();
    brokenLinkChain[2] = {
      ...brokenLinkChain[2],
      prev_hash: "0".repeat(64),
    };
    mc.pushDbResult(
      { table: "audit_log" },
      { data: brokenLinkChain, error: null },
    );
  },
  run: async (): Promise<JourneyResult> => {
    const cleanChain = buildChain();
    const expectedLastHash = cleanChain[2].this_hash;

    const r1 = await verifyAuditChain();
    const r2 = await verifyAuditChain();
    const r3 = await verifyAuditChain();

    return {
      kind: "ok",
      data: {
        clean: r1 as unknown as Record<string, unknown>,
        tampered: r2 as unknown as Record<string, unknown>,
        brokenLink: r3 as unknown as Record<string, unknown>,
        expectedLastHash,
      },
    };
  },
  assertions: (result) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got: ${(result as { message: string }).message}`);
    }
    const data = result.data as Record<string, unknown>;
    const clean = data.clean as { ok: boolean; totalRows: number; lastHash: string };
    const tampered = data.tampered as {
      ok: boolean;
      brokenAt?: { id: number; reason: string };
    };
    const brokenLink = data.brokenLink as {
      ok: boolean;
      brokenAt?: { id: number; reason: string };
    };
    const expectedLastHash = data.expectedLastHash as string;

    // Clean chain assertions
    if (clean.ok !== true) {
      throw new Error(`clean chain expected ok:true, got ${JSON.stringify(clean)}`);
    }
    if (clean.totalRows !== 3) {
      throw new Error(`clean chain expected totalRows=3, got ${clean.totalRows}`);
    }
    if (clean.lastHash !== expectedLastHash) {
      throw new Error(
        `clean chain lastHash mismatch: expected ${expectedLastHash}, got ${clean.lastHash}`,
      );
    }

    // Tampered chain assertions
    if (tampered.ok !== false) {
      throw new Error("tampered chain unexpectedly passed verifier");
    }
    if (tampered.brokenAt?.id !== 2) {
      throw new Error(
        `tampered chain expected brokenAt.id=2, got ${tampered.brokenAt?.id}`,
      );
    }
    if (tampered.brokenAt?.reason !== "hash_mismatch") {
      throw new Error(
        `tampered chain expected reason=hash_mismatch, got ${tampered.brokenAt?.reason}`,
      );
    }

    // Broken-link chain assertions
    if (brokenLink.ok !== false) {
      throw new Error("broken-link chain unexpectedly passed verifier");
    }
    if (brokenLink.brokenAt?.id !== 3) {
      throw new Error(
        `broken-link chain expected brokenAt.id=3, got ${brokenLink.brokenAt?.id}`,
      );
    }
    if (brokenLink.brokenAt?.reason !== "prev_hash_mismatch") {
      throw new Error(
        `broken-link chain expected reason=prev_hash_mismatch, got ${brokenLink.brokenAt?.reason}`,
      );
    }
  },
};
