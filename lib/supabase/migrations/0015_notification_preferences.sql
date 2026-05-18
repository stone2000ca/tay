-- v1.1.4: reply notification preferences (single-row, single-tenant).
-- Channel = email (default — Sonnet recommendation, zero extra setup), or
-- slack_webhook (Advanced — user pastes their Slack incoming-webhook URL),
-- or none (suppress notifications entirely). The Slack webhook URL is
-- stored encrypted (reuse lib/oauth/crypto.ts AES-256-GCM); email_override
-- is optional and lets the user send notifications to a different inbox
-- than their connected mailbox. enabled_for_intents is a comma-separated
-- list of ReplyIntent values to notify on (default: ALL).
CREATE TABLE IF NOT EXISTS notification_preferences (
  lock_col integer NOT NULL DEFAULT 1 UNIQUE,
  channel text NOT NULL CHECK (channel IN ('email', 'slack_webhook', 'none')) DEFAULT 'email',
  slack_webhook_url_encrypted text,
  email_override text,
  enabled_for_intents text NOT NULL DEFAULT 'interested,not_interested,unsubscribe_request,out_of_office,other',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
