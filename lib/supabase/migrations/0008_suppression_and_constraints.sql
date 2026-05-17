-- v0.8 suppression list (Tay gate E load-bearing)
CREATE TABLE IF NOT EXISTS suppression (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_lower text NOT NULL UNIQUE,
  reason text NOT NULL CHECK (reason IN ('user_unsubscribe','bounce','complaint','manual_add')),
  source text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS suppression_added_at_idx ON suppression (added_at DESC);

-- v0.7 carry-forward #1: backstop the orchestrator's already-sent race
-- with a DB-level UNIQUE constraint on sent_messages.draft_id. The
-- orchestrator's read-then-write check is still good UX (it returns a
-- friendly error without a DB exception), but this constraint guarantees
-- correctness even under concurrent inserts.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sent_messages_draft_id_unique'
  ) THEN
    ALTER TABLE sent_messages
      ADD CONSTRAINT sent_messages_draft_id_unique UNIQUE (draft_id);
  END IF;
END$$;
