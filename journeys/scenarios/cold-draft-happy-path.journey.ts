// JOURNEY — cold-draft happy path.
//
// Gate H + C + D (in aggregate): the standard pipeline shouldn't trip
// any rail when given a benign prospect + benign LLM output.

import type { Journey, JourneyResult } from "../types";
import { fixtureProspect, fixtureRubric, benignDraftJson } from "../mocks/fixtures";
import { generateDraft } from "../../lib/draft/generate";

export const journey: Journey = {
  name: "cold-draft happy path",
  gate: "C",
  description:
    "Drafter returns valid JSON, disclosure injected, shape passes — no rails trip.",
  setup: async (mc) => {
    mc.pushLlmResponse(benignDraftJson());
  },
  run: async (): Promise<JourneyResult> => {
    const result = await generateDraft({
      prospect: {
        full_name: fixtureProspect.full_name,
        company: fixtureProspect.company,
        email: fixtureProspect.email,
        notes: fixtureProspect.notes,
      },
      rubric: fixtureRubric,
    });
    if (!result.ok) {
      return { kind: "error", message: result.error };
    }
    return {
      kind: "ok",
      data: {
        subject: result.draft.subject,
        body: result.draft.body,
      },
    };
  },
  assertions: (result, mc) => {
    if (result.kind !== "ok") {
      throw new Error(`expected ok, got error: ${(result as { message: string }).message}`);
    }
    const body = result.data?.body as string;
    if (!body.includes("Written with AI assistance")) {
      throw new Error("disclosure marker missing from body");
    }
    if (mc.llmCalls().length !== 1) {
      throw new Error(`expected 1 LLM call, got ${mc.llmCalls().length}`);
    }
  },
};
