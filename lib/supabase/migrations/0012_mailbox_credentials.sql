-- v1.1.2: unified mailbox credentials supporting both Gmail OAuth and SMTP
-- App Password. Replaces v0.7's google_oauth table as the new primary read
-- target; google_oauth stays as a backwards-compat fallback (lazy migration:
-- v1.1.2 callers read from mailbox_credentials first; on miss, fall back to
-- google_oauth so existing v0.7+ installs keep working until the user
-- reconnects).
--
-- Single-row per install (single-tenant) — same pattern as instance_secrets,
-- gmail_poll_cursor. `lock_col UNIQUE DEFAULT 1` makes any second insert
-- collide so we can't accidentally end up with two mailboxes.
--
-- We do NOT drop google_oauth here. A future v1.2+ consolidation migration
-- can remove it once the lazy-migration window has elapsed.

CREATE TABLE IF NOT EXISTS mailbox_credentials (
  lock_col integer NOT NULL DEFAULT 1 UNIQUE,
  kind text NOT NULL CHECK (kind IN ('oauth', 'app_password')),
  email_address text NOT NULL,
  -- For kind=oauth: encrypted refresh + access tokens (mirror of google_oauth)
  oauth_refresh_token_encrypted text,
  oauth_access_token_encrypted text,
  oauth_access_token_expires_at timestamptz,
  oauth_scopes text,
  -- For kind=app_password: encrypted SMTP password + SMTP/IMAP server hints
  smtp_password_encrypted text,
  smtp_host text,
  smtp_port integer,
  imap_host text,
  imap_port integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
