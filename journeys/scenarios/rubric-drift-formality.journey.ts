// JOURNEY — gate D regression: rubric drift (ultra-formal vs casual rubric).

import type { Journey, JourneyResult } from "../types";
import { fixtureRubric, judgeReviseJson } from "../mocks/fixtures";
import { judgeDraft } from "../../lib/judge/judge";

export const journey: Journey = {
  name: "rubric drift — formality",
  gate: "D",
  description:
    "Rubric formality=casual; draft uses 'Dear Sir/Madam'. Judge returns revise with formality reason.",
  setup: async (mc) => {
    mc.pushLlmResponse(
      judgeReviseJson("formality drift — draft is formal but rubric is casual"),
    );
  },
  run: async (): Promise<JourneyResult> => {
    const result = await judgeDraft({
      draft: {
        subject: "Regarding our potential business relationship",
        body:
          "Dear Sir/Madam,\n\nI am writing to formally introduce our esteemed services.\n\nKind regards,\nJames Shi, Esq.\n\n— Written with AI assistance. Reply STOP to opt out.",
      },
      prospectInputs: { full_name: "Alice", company: "Acme" },
      rubric: fixtureRubric, // casual
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
      data: { reasons: result.decision.reasons },
    };
  },
  assertions: (result) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got: ${(result as { message: string }).message}`);
    }
    const reasons = (result.data?.reasons as string[]) ?? [];
    if (!reasons.some((r) => /formality/i.test(r))) {
      throw new Error("reasons missing 'formality'");
    }
  },
};
