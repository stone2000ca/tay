-- v0.4 drafts
-- Tay gate B: prospects holds operational fields only (no race/religion/health/SO/political/
-- biometric/genetic). `notes` is free-text user-entered context; UI copy MUST NOT push toward
-- special-category data.

ALTER TABLE prospects
  ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  subject text NOT NULL,
  body text NOT NULL,
  model_used text NOT NULL,
  rubric_snapshot jsonb NOT NULL,
  prompt_inputs jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS drafts_prospect_id_created_at_idx
  ON drafts (prospect_id, created_at DESC);
