-- v0.7 Sent messages + trust events

-- prospects.email NOTE (v0.4 carry-over): the column was declared NOT NULL
-- in 0001 and v0.4's drafter synthesizes an `unknown+<name>@<co>.invalid`
-- placeholder when the UI doesn't collect a real address. v0.7 needs a real
-- recipient address to actually send via Gmail. We DELIBERATELY do NOT
-- change the NOT NULL constraint here — that would be a breaking change to
-- v0.4 callers and v0.7's queue UI does not require a schema change. New
-- prospects entering the queue via v0.7+ flows are expected to carry a real
-- email; old prospects with synthesized .invalid addresses can be deleted
-- or back-filled by the user before they appear in /queue.

CREATE TABLE IF NOT EXISTS sent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  prospect_id uuid NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  gmail_message_id text NOT NULL,
  gmail_thread_id text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  recipient_email text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sent_messages_prospect_id_sent_at_idx
  ON sent_messages (prospect_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS trust_events (
  id bigserial PRIMARY KEY,
  capability text NOT NULL CHECK (capability IN ('send','reply_send','book')),
  event_type text NOT NULL CHECK (event_type IN ('sent','blocked_by_judge','blocked_by_suppression','override_to_send','override_to_skip','bounced','complained','replied_positive','replied_negative')),
  metadata jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trust_events_capability_event_type_idx
  ON trust_events (capability, event_type);
