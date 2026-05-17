-- v0.7 Google OAuth tokens. Single-tenant: one row per install.
-- Tay rule: NEVER log raw OAuth tokens. Redact at the seam.
-- v1.0 candidate: encrypt at rest via Supabase Vault (when GA) or pgcrypto.

CREATE TABLE IF NOT EXISTS google_oauth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_address text NOT NULL,
  refresh_token_encrypted text NOT NULL,
  access_token_encrypted text,
  access_token_expires_at timestamptz,
  scopes text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
