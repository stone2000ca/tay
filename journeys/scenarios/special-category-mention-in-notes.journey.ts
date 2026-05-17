// JOURNEY — gate B regression: special-category mention triggers judge block.

import type { Journey, JourneyResult } from "../types";
import { fixtureRubric, judgeBlockJson } from "../mocks/fixtures";
import { judgeDraft } from "../../lib/judge/judge";

export const journey: Journey = {
  name: "special-category mention in notes",
  gate: "B",
  description:
    "Notes mention religion/politics; judge returns block with 'special-category' in reasons.",
  setup: async (mc) => {
    // Judge LLM returns a block decision naming the violation.
    mc.pushLlmResponse(judgeBlockJson("special-category mention in notes"));
  },
  run: async (): Promise<JourneyResult> => {
    const result = await judgeDraft({
      draft: {
        subject: "Hi",
        body:
          "Hi Alice,\n\nNice work.\n\nJames\n\n— Written with AI assistance. Reply STOP to opt out.",
      },
      prospectInputs: {
        full_name: "Alice",
        company: "Acme",
        notes: "she's a [religion] practitioner who supports [politics]",
      },
      rubric: fixtureRubric,
    });
    if (!result.ok) return { kind: "error", message: result.error };
    return {
      kind: "ok",
      data: {
        decision: result.decision.decision,
        reasons: result.decision.reasons,
      },
    };
  },
  assertions: (result) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got: ${(result as { message: string }).message}`);
    }
    if (result.data?.decision !== "block") {
      throw new Error(`expected decision=block, got ${result.data?.decision}`);
    }
    const reasons = (result.data?.reasons as string[]) ?? [];
    if (!reasons.some((r) => /special-category/i.test(r))) {
      throw new Error(
        `reasons missing special-category mention: ${JSON.stringify(reasons)}`,
      );
    }
  },
};
