-- v1.1.1: instance secrets — single-row table holding the HKDF salt and
-- the user's BYO LLM provider key (encrypted via the derived oauth secret).
--
-- Single-row pattern: `lock_col UNIQUE DEFAULT 1` mirrors gmail_poll_cursor
-- and trust_tiers — every upsert/insert targets lock_col=1, so the table
-- physically cannot hold more than one row.
--
-- Columns:
--   salt                  — 32-byte HKDF salt; minted on first cold start.
--                           Lost = every encrypted token must be re-issued.
--   llm_provider          — which BYO LLM the wizard collected.
--   llm_key_ciphertext    — encryptToken(plaintext) — AES-256-GCM via the
--                           derived oauth secret. NEVER stored plaintext.
--   llm_key_fingerprint   — first 8 chars of sha256(plaintext). Surfaced
--                           in /settings/secrets so the user can confirm
--                           which key is active without seeing it.
--   llm_key_set_at        — timestamp of last set/rotation. Operational.
CREATE TABLE IF NOT EXISTS instance_secrets (
  lock_col integer NOT NULL DEFAULT 1 UNIQUE,
  salt bytea NOT NULL,
  llm_provider text CHECK (llm_provider IN ('anthropic','openai','openrouter')),
  llm_key_ciphertext text,
  llm_key_fingerprint text,
  llm_key_set_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
