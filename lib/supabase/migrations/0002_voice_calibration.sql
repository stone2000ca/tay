-- Tay v0.3 voice calibration migration.
--
-- Single-row table — one install, one voice rubric. Same pattern as
-- `app_config`: writes are DELETE+INSERT in a transaction so the
-- single-row invariant is enforced by construction, not by upsert dance.
--
-- Tay gate B (no special-category data): the `rubric` jsonb is STYLISTIC
-- ONLY — opener style, sentence length, formality, signature pattern,
-- common/avoid phrases, tone notes. ZERO fields for race, religion,
-- health, sexual orientation, political views, biometric, or genetic
-- data. The schema enforced by lib/voice/rubric-schema.ts is the contract
-- the v0.4 drafter and v0.5 judge will read from this column.

CREATE TABLE IF NOT EXISTS voice_calibration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rubric jsonb NOT NULL,
  sample_count integer NOT NULL,
  model_used text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
