-- v1.1.2.5: IMAP poll cursor (single-row, parallel to gmail_poll_cursor from v0.9).
-- Tracks the last IMAP UID we processed; next poll starts from UID+1.
--
-- IMAP UIDs are monotonically increasing per-mailbox (RFC 3501 §2.3.1.1).
-- A `last_uid = 0` value means "first poll — seed from current highest UID
-- without backfill" (same pattern as gmail_poll_cursor's first-poll seed).

CREATE TABLE IF NOT EXISTS imap_poll_cursor (
  lock_col integer NOT NULL DEFAULT 1 UNIQUE,
  last_uid bigint NOT NULL DEFAULT 0,
  mailbox_path text NOT NULL DEFAULT 'INBOX',
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
