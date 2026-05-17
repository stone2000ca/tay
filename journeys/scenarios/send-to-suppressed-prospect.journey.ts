// JOURNEY — gate E regression: send to suppressed prospect.
//
// The orchestrator's full path requires many mocked collaborators
// (OAuth, send-email, judge decisions, etc.). For a regression journey,
// the LOAD-BEARING assertion is "the suppression check correctly says
// SUPPRESSED for an email on the list" — exercise lib/suppression/check
// directly and validate the return.

import type { Journey, JourneyResult } from "../types";
import { isSuppressed } from "../../lib/suppression/check";

export const journey: Journey = {
  name: "send to suppressed prospect",
  gate: "E",
  description:
    "Suppression check returns TRUE for an email on the list; orchestrator MUST gate on this.",
  setup: async (mc) => {
    // The harness mocks `lib/suppression/check.isSuppressed` to pop a
    // controller-programmed result keyed on table="suppression",
    // method="isSuppressed". Push `true` to simulate "this email IS on
    // the list".
    mc.pushDbResult(
      { table: "suppression", method: "isSuppressed" },
      { data: true, error: null },
    );
  },
  run: async (): Promise<JourneyResult> => {
    const result = await isSuppressed("blocked@example.com");
    return { kind: "ok", data: { suppressed: result } };
  },
  assertions: (result) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got: ${(result as { message: string }).message}`);
    }
    if (result.data?.suppressed !== true) {
      throw new Error(
        `expected suppressed=true for email on the list, got ${result.data?.suppressed}`,
      );
    }
  },
};
