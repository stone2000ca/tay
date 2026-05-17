// Judge v0.5 — strict reviewer over generated drafts.
//
// THE JUDGE IS THE LOAD-BEARING DEFENSE for v0.x. The drafter generates;
// the judge enforces every Tay gate as VERIFICATION. If the judge is
// tricked into "allow" on a bad draft, brand-damage ensues.
//
// Pipeline:
//   getRubric() (if not passed in)
//     → buildJudgeMessages() (rubric verbatim + decision schema + gate
//       criteria; draft + prospect inputs wrapped in <untrusted_source>
//       blocks AND closing-tag neutered)
//       → OpenRouter chat.completions.create with
//         response_format=json_object, temperature=0.2 (low — we want
//         deterministic judging, not creativity)
//         → defensive JSON parse + parseJudgeDecision hard validator
//           → return decision
//
// READ-VS-WRITE ERROR CONTRACT:
//   judgeDraft is an LLM CALL — returns a discriminated union
//   ({ ok: true, decision, ... } | { ok: false, error }), never throws
//   on normal error paths. Does NOT write to the DB (persist is its own
//   module). Same convention as generateDraft.

import { chatComplete, getLlmClient, getModel } from "../llm";
import { getRubric } from "../voice/calibrate";
import type { VoiceRubric } from "../voice/rubric-schema";
import { buildJudgeMessages, type Draft, type ProspectInputs } from "./prompt";
import { parseJudgeDecision, type JudgeDecision } from "./decision-schema";

export type JudgeResult =
  | {
      ok: true;
      decision: JudgeDecision;
      modelUsed: string;
      rubricUsed: VoiceRubric;
    }
  | { ok: false; error: string };

export async function judgeDraft(args: {
  draft: Draft;
  prospectInputs: ProspectInputs;
  rubric?: VoiceRubric;
  model?: string;
  apiKey?: string;
}): Promise<JudgeResult> {
  // Resolve rubric. The judge needs the rubric to verify Gate D — if
  // none is calibrated yet, bail early. In practice the drafter would
  // already have failed for the same reason, but keep the guard local.
  let rubric = args.rubric;
  if (!rubric) {
    const fetched = await getRubric();
    if (!fetched) {
      return {
        ok: false,
        error: "Voice not yet calibrated. Complete /setup/voice first.",
      };
    }
    rubric = fetched;
  }

  const probe = await getLlmClient(args.apiKey);
  if (!probe.ok) {
    return {
      ok: false,
      error:
        "LLM not configured. Complete the setup wizard (/setup/llm-key) before judging.",
    };
  }
  const model = args.model ?? getModel("quality", probe.provider);
  const messages = buildJudgeMessages({
    rubric,
    draft: args.draft,
    prospectInputs: args.prospectInputs,
  });

  const completion = await chatComplete(
    {
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
    },
    args.apiKey,
  );
  if (!completion.ok) {
    return { ok: false, error: completion.error };
  }
  const raw = completion.content;
  if (!raw || raw.trim().length === 0) {
    return { ok: false, error: "Judge returned an empty response." };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(stripJsonFences(raw));
  } catch {
    return { ok: false, error: "Judge returned malformed JSON." };
  }

  const decision = parseJudgeDecision(parsedJson);
  if (!decision) {
    return { ok: false, error: "Judge returned malformed decision." };
  }

  return { ok: true, decision, modelUsed: model, rubricUsed: rubric };
}

function stripJsonFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith("```")) {
    return trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/```$/, "")
      .trim();
  }
  return trimmed;
}
