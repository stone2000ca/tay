-- v0.5: judge decisions on drafts.
--
-- Tay gate B (no special-category data): this table stores OPERATIONAL
-- metadata only. `reasons` is structured prose from the judge LLM; the
-- system prompt forbids the judge from emitting protected attributes,
-- but we never index/query on `reasons` so an accidental mention can't
-- become a covert special-category column.
--
-- Tay gate F (audit log, partial): every row here is a Tier-3 event.
-- v0.5 wires `appendAudit` as a no-op stub on judge decisions; v0.6
-- wires the real hash chain into the `audit_log` table created by 0001.

CREATE TABLE IF NOT EXISTS judge_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('allow','block','revise','escalate')),
  reasons jsonb NOT NULL,
  rewrite jsonb,
  model_used text NOT NULL,
  rubric_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS judge_decisions_draft_id_idx
  ON judge_decisions (draft_id);

CREATE INDEX IF NOT EXISTS judge_decisions_decision_created_at_idx
  ON judge_decisions (decision, created_at DESC);
