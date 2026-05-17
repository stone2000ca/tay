// JOURNEY — gate E regression: send to suppressed prospect.
//
// This is the SOLE gate-E regression journey, so it must exercise the
// REAL orchestrator chokepoint — `lib/send/orchestrate.ts:sendDraft` —
// and prove that the suppression check actually short-circuits the
// Gmail send path.
//
// Strategy:
//   1. Program the full happy-path precondition surface for sendDraft:
//        - app config exists (provided by makeAppConfigMock default)
//        - voice rubric exists (provided by makeVoiceCalibrateModuleMock default)
//        - draft row exists in `drafts` table read
//        - prospect row exists in `prospects` table read with a real email
//        - no prior sent_messages row (idempotence check returns null)
//        - judge decision = "allow" (provided by makeJudgePersistMock default)
//        - ensureFreshAccessToken returns a fake token (default)
//   2. Program `isSuppressed` to return TRUE for the recipient — this is
//      the gate under test.
//   3. Call sendDraft("d1") from lib/send/orchestrate.
//   4. Assert:
//        - return is { ok: false, error: /suppression/i }
//        - sendEmail was NOT invoked (mockController.sendEmailCalls() empty)
//        - recordTrustEvent("send", "blocked_by_suppression", ...) WAS invoked

import type { Journey, JourneyResult } from "../types";
import { sendDraft } from "../../lib/send/orchestrate";

const DRAFT_ID = "d1";
const PROSPECT_ID = "p1";
const RECIPIENT = "blocked@example.com";

export const journey: Journey = {
  name: "send to suppressed prospect — orchestrator gate E",
  gate: "E",
  description:
    "Real sendDraft(): suppressed recipient must short-circuit BEFORE Gmail call and record blocked_by_suppression trust event.",
  setup: async (mc) => {
    // Program the Supabase reads the orchestrator performs, in order:
    //   1. drafts read (eq + maybeSingle)
    //   2. prospects read (eq + maybeSingle)
    //   3. sent_messages "already sent?" read (eq + limit + maybeSingle)
    // Each terminates on `.maybeSingle()` which pops via popDbResult.
    mc.pushDbResult(
      { table: "drafts", method: "maybeSingle" },
      {
        data: {
          id: DRAFT_ID,
          prospect_id: PROSPECT_ID,
          subject: "Quick thought",
          body: "Hi there\n\n— Written with AI assistance. Reply STOP to opt out.",
        },
        error: null,
      },
    );
    mc.pushDbResult(
      { table: "prospects", method: "maybeSingle" },
      {
        data: {
          id: PROSPECT_ID,
          email: RECIPIENT,
          full_name: "Blocked Person",
          company: "ACME",
        },
        error: null,
      },
    );
    mc.pushDbResult(
      { table: "sent_messages", method: "maybeSingle" },
      { data: null, error: null }, // not previously sent
    );

    // Suppression check returns TRUE — the gate under test.
    mc.pushDbResult(
      { table: "suppression", method: "isSuppressed" },
      { data: true, error: null },
    );

    // Intentionally do NOT push a sendEmail result. The orchestrator
    // must short-circuit before reaching sendEmail; if it doesn't, the
    // assertions will catch it via sendEmailCalls().length > 0.
  },
  run: async (): Promise<JourneyResult> => {
    const result = await sendDraft(DRAFT_ID);
    return {
      kind: "ok",
      data: { result: result as unknown as Record<string, unknown> },
    };
  },
  assertions: (result, mc) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got: ${(result as { message: string }).message}`);
    }
    const sendResult = result.data?.result as
      | { ok: false; error: string }
      | { ok: true };

    // 1. sendDraft must return ok:false with a suppression-y error message.
    if (sendResult.ok !== false) {
      throw new Error(
        `expected sendDraft ok:false (suppressed), got ${JSON.stringify(sendResult)}`,
      );
    }
    if (!/suppress/i.test((sendResult as { error: string }).error)) {
      throw new Error(
        `expected error to mention "suppression", got "${(sendResult as { error: string }).error}"`,
      );
    }

    // 2. Gmail sendEmail must NOT have been called. This is the load-bearing
    //    assertion — gate E regression means "we did not call the network".
    if (mc.sendEmailCalls().length !== 0) {
      throw new Error(
        `gate-E violation: sendEmail was called ${mc.sendEmailCalls().length} time(s) for a suppressed recipient`,
      );
    }

    // 3. A blocked_by_suppression trust event must have been recorded so
    //    the trust-tier math reflects the suppression gate firing.
    const trust = mc.trustEvents();
    const blocked = trust.filter(
      (t) => t.capability === "send" && t.eventType === "blocked_by_suppression",
    );
    if (blocked.length !== 1) {
      throw new Error(
        `expected exactly 1 send/blocked_by_suppression trust event, got ${blocked.length} (all events: ${JSON.stringify(trust)})`,
      );
    }
  },
};
