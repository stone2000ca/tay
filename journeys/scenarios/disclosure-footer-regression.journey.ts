// JOURNEY — gate C regression: missing disclosure → judge revise.

import type { Journey, JourneyResult } from "../types";
import { fixtureRubric, judgeReviseJson } from "../mocks/fixtures";
import { judgeDraft } from "../../lib/judge/judge";

export const journey: Journey = {
  name: "disclosure footer regression",
  gate: "C",
  description:
    "Body without disclosure marker; judge returns revise + rewrite with footer.",
  setup: async (mc) => {
    mc.pushLlmResponse(
      judgeReviseJson("disclosure footer missing from body"),
    );
  },
  run: async (): Promise<JourneyResult> => {
    const result = await judgeDraft({
      draft: {
        subject: "Hi",
        body: "Hi Alice,\n\nNice work.\n\nJames",
      },
      prospectInputs: { full_name: "Alice", company: "Acme" },
      rubric: fixtureRubric,
    });
    if (!result.ok) return { kind: "error", message: result.error };
    if (result.decision.decision !== "revise") {
      return {
        kind: "error",
        message: `expected revise, got ${result.decision.decision}`,
      };
    }
    return {
      kind: "ok",
      data: {
        rewriteBody: result.decision.rewrite.body,
        reasons: result.decision.reasons,
      },
    };
  },
  assertions: (result) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got: ${(result as { message: string }).message}`);
    }
    const rewriteBody = (result.data?.rewriteBody as string) ?? "";
    if (!rewriteBody.includes("Written with AI assistance")) {
      throw new Error("judge rewrite body missing disclosure marker");
    }
    const reasons = (result.data?.reasons as string[]) ?? [];
    if (!reasons.some((r) => /disclosure/i.test(r))) {
      throw new Error("reasons missing 'disclosure'");
    }
  },
};
