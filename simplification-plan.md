# Tay v1.1 plan (v3) — "non-tech user can install in 10 minutes"

> v3 — two Sonnet review passes folded in. v1 had collapsed-threat-model + missed-features gaps; v2 fixed those but Sonnet's second pass caught HKDF spec gaps + cold-start crash + interim-state issues. v3 closes the spec gaps.

## End-state install path (unchanged from v2)

1. Click Vercel Deploy → Vercel auto-provisions Supabase via Marketplace
2. App boots; wizard opens
3. Wizard step 1: bootstrap `instance_secrets` (silent — salt + derived secrets)
4. Wizard step 2: paste an Anthropic / OpenAI / OpenRouter key (provider auto-detected)
5. Wizard step 3: mailbox setup (**Easy** = SMTP App Password OR **Power** = Google OAuth)
6. Wizard step 4: calibrate voice (paste 1+ real emails — anchor required)
7. Wizard step 5: rubric preview & sample draft (renamed from "Try Tay first")
8. Wizard step 6: test-send to the user's own email
9. Wizard step 7: add first prospect (describe in 1-2 sentences)
10. Done

Zero terminal commands. Zero env vars the user sets themselves. Zero Google Cloud Console for Easy-mode users.

## Locked-in design decisions

### Decision A — LLM key location: wizard-collected, stored in Supabase
- Single-row `instance_secrets` table
- App boots without the key; LLM-touching pages render "configure LLM first" banner until set
- Mitigations: surface provider spending-limit links during wizard; show fingerprint in `/settings/secrets`; one-click rotate

**Fingerprint algorithm (specced):** SHA-256 of the raw key, hex-encoded, first 8 chars. Computed server-side from the stored encrypted value (decrypt → hash → return prefix only). Display-only; never echoed back the key itself.

### Decision B — TAY_OAUTH_SECRET via HKDF (full spec)

```
TAY_OAUTH_SECRET = HKDF-SHA256(
  ikm:    Buffer.from(process.env.SUPABASE_SERVICE_ROLE_KEY, "utf8"),  // JWT string as UTF-8 bytes
  salt:   instance_secrets.salt,                                        // 32 random bytes, per install
  info:   Buffer.from("tay-oauth-secret-v1", "utf8"),
  length: 32                                                            // 32 bytes → 64 hex chars (matches existing SECRET_REGEX)
)
```

CRON_SECRET uses identical KDF with `info: "tay-cron-secret-v1"`.

**Salt generation (race-safe):**
- Lives in `instance_secrets(lock_col integer DEFAULT 1 UNIQUE, salt bytea NOT NULL, ...)` — same single-row pattern as `gmail_poll_cursor`
- Generated in `ensureSchema()` after the table is created. Insert is `INSERT ... ON CONFLICT (lock_col) DO NOTHING` so concurrent boots race-safely (first write wins; second is a no-op)
- `ensureSchema()` returns ONLY after the salt is durably committed

**Trade-off:** rotating `SUPABASE_SERVICE_ROLE_KEY` invalidates all encrypted Gmail OAuth tokens. Mitigation: `/settings/secrets` shows a prominent step-ordered banner — "Before rotating your Supabase service role key, disconnect Gmail here first. After rotation, reconnect."

### Decision C — Cold-start crash guards
- `getInstanceSecret(purpose)` is a lazy-loader that reads from `instance_secrets` with a module-scoped Promise cache
- `getLlmClient()` no longer throws on missing key; returns `{ ok: false, reason: "llm_not_configured" } | { ok: true, client: OpenAI | Anthropic }`
- ALL non-wizard callers (cron route, reply handler, judge) handle the `not_configured` case by short-circuiting cleanly (cron returns `{ processed: 0, skipped: 0, errors: 0, reason: "llm_not_configured" }`; reply handler skips classification and records a `reply.received` audit with `intent: "deferred"`)
- Existing wizard callers stay synchronous (key validation path uses the discriminated `validateLlmKey` flow; unchanged)
- **Cron auth ordering (specced):** the cron route's handler first calls `ensureSchema()` (bootstraps salt), then derives `CRON_SECRET`, then verifies the request's `Authorization: Bearer` header. Salt must exist before auth check can run.

## Revised priorities (v3)

### P1 + P2 — Secrets foundation + provider-agnostic LLM keys (v1.1.1)
**Includes:**
- `instance_secrets` migration (salt + llm_key_ciphertext + llm_provider columns; single-row via `lock_col UNIQUE`)
- HKDF lazy-loader (`lib/secrets/derive.ts`)
- `lib/oauth/crypto.ts`, `lib/unsubscribe/token.ts`, cron auth refactored to use `getInstanceSecret(purpose)`
- `lib/llm.ts` provider-detect: `sk-ant-` → Anthropic via `@anthropic-ai/sdk`; `sk-or-` → OpenRouter (existing); `sk-...` (no `-or-`) → OpenAI via `openai` SDK pointed at OpenAI's default URL
- `MODELS.cheap` / `MODELS.quality` resolve per provider: Anthropic = `claude-3-5-haiku-latest` / `claude-3-7-sonnet-latest`; OpenAI = `gpt-4o-mini` / `gpt-4o`; OpenRouter = current
- Cold-start guards (all non-wizard callers handle `llm_not_configured`)
- `NEXT_PUBLIC_SITE_URL` → falls back to `VERCEL_PROJECT_PRODUCTION_URL`
- `/settings/secrets` page: fingerprint display, rotate button, Supabase-rotation step-ordered banner

**Estimated:** 1.5–2 runs (Sonnet flagged P1+P2 bundle as 7-8 distinct pieces; budget 1 NEEDS-FIXES cycle).

### P3a — SMTP send (v1.1.2)
**Includes:**
- Wizard mailbox step: Easy (App Password) or Power (OAuth, current path)
- Easy path: paste sender email + App Password; Tay verifies via SMTP STARTTLS handshake; if rejected with auth error, suggest Power mode with linked guide
- `lib/send/smtp.ts` via `nodemailer`
- `mailbox_credentials` table with `kind: "oauth" | "app_password"`
- `lib/send/orchestrate.ts` becomes channel-aware (Gates E/F/I unaffected by transport)
- **Interim-state banner (Sonnet's gap):** when SMTP mode is active, `/queue` and `/replies` show a banner: "Reply polling activates in the next update (v1.1.2.5). You can send now; replies become visible then." This is feature-flag-visible — users see what they're getting

**Estimated:** 1 run.

### P3b — IMAP polling for SMTP mode (v1.1.2.5)
**Includes:**
- `lib/reply/imap-poll.ts` using `imapflow`
- Thread-matching by `Message-ID` / `In-Reply-To` (SMTP send sets these via nodemailer's `messageId` option)
- `imap_poll_cursor` table (single-row, lock_col UNIQUE pattern)
- Parallel pipeline to v0.9's Gmail History API path; `lib/reply/poll.ts` dispatches by `mailbox_credentials.kind`
- Remove the v1.1.2 interim-state banner once shipped

**Estimated:** 1 run (one full reply pipeline parallel to v0.9's).

### P4 — Rubric preview & sample draft (v1.1.3) — renamed from "Try Tay first"
**Acknowledged restructure (Sonnet's gap):** this step runs AFTER LLM key + voice calibration, so it's NOT a pre-setup demo. It's a "see your rubric in action before you add a real prospect" step. Same code; honest framing.

**Includes:**
- After voice calibration completes, generate a sample draft against a canned fake prospect (Alex Chen, VP Sales, Acme Corp)
- Use the user's just-extracted rubric
- Render draft + judge decision + disclosure footer
- "Continue" advances to test-send; "Recalibrate voice" loops back to voice cal

**Effort:** 0.25 milestone (reuses existing pipeline; just UI).

### P5 — Voice calibration paths (v1.1.3, bundled)
**Four paths, all require at least 1 real email anchor:**
- Path 0 (zero-emails fallback — Sonnet's addition): "I've never sent a cold email. Help me write a sample now." Tay prompts: "Write to a [role] at a [company type] about your [product category]." User fills in; that becomes the anchor email.
- Path 1: paste 1-5 real emails (full email flow, relaxed minimum from 5 to 1)
- Path 2: paste 1 email + answer 3 questions (formality / common openers / phrases-to-avoid). LLM combines.
- Path 3: paste 1 email + your company URL. LLM scrapes About/Team page, fuses with email anchor.

**Rubric preview (Sonnet's missing simplification):** after extraction, render the rubric in plain English with inline editing — formality dropdown, common-phrase / avoid-phrase tag inputs, tone-notes textarea. User confirms or recalibrates BEFORE the sample-draft step (P4) runs.

**Effort:** 1 run (3 extractor variants + Path 0 prompt scaffold + URL scraper + preview/edit UI + per-path JOURNEYS scenarios).

### P6 — Test-send + prospect quick-add (v1.1.3, bundled)
**Test-send:**
- After rubric preview & sample draft, Tay drafts a real email TO the user themselves
- Real send via configured mailbox; user sees in inbox; confirms whole pipeline
- Existing send-orchestrate path; `prospect` is the user themselves

**Prospect quick-add (Sonnet's LinkedIn-URL gap):**
- **Primary path: describe in 1-2 sentences.** "I met Sarah at the Stripe event, she runs ops at a fintech in NYC." → cheap LLM extracts `full_name="Sarah"`, `company="<unknown>"` (asks user), `notes="met at Stripe event, runs ops, fintech, NYC"`. User confirms.
- **LinkedIn URL is DROPPED from v1.1** (LinkedIn returns 999/login-wall for all serverless fetches; not a reliable path). Reintroduce as v1.2+ ONLY if a stable scraping option emerges (paid API, browser extension, etc.).

**Effort:** 0.75 milestone (test-send is small; prospect-extract is one LLM call + form pre-fill).

### P7 — Reply notification (v1.1.4)
**Includes:**
- `/settings` toggle: notification channel = `email | slack_webhook | none`
- **Default: email-on-reply (Sonnet's correction).** Sends to the same address as the user's mailbox via the existing send-orchestrate path. Zero extra setup.
- **Slack webhook = "Advanced" tab**, with a linked guide to Slack's webhook docs. Not the default.
- `lib/reply/handle.ts` calls `notifyReply(reply, classification)` after audit + trust-event writes
- Notification payload: intent + sender (redacted to "<email_lower>" via existing redactor pattern) + link to `/replies` thread. Never includes raw reply body.

**Effort:** 0.5 run.

## Sequencing summary

| Milestone | Bundles | Estimated runs |
|---|---|---|
| **v1.1.1** | P1 + P2 (secrets + provider-detect + VERCEL_URL) | 1.5–2 |
| **v1.1.2** | P3a (SMTP send + interim banner) | 1 |
| **v1.1.2.5** | P3b (IMAP poll) | 1 |
| **v1.1.3** | P4 + P5 + P6 (rubric preview + voice paths + test-send + prospect quick-add) | 1.5–2 |
| **v1.1.4** | P7 (reply notifications) | 0.5–1 |

**Total: ~5.5–7 runs** — wider than the v0.x 1-run-per-milestone cadence because P1 is genuinely larger and the SMTP+IMAP split is two real pipelines.

## What changed v2 → v3

- HKDF spec made explicit (SHA-256, 32-byte output, JWT-as-UTF8 IKM, `info` strings versioned)
- Salt generation race resolved (`ON CONFLICT (lock_col) DO NOTHING` in `ensureSchema()`; explicit ordering before cron auth check)
- Cold-start crash addressed (`getLlmClient` returns discriminated union; all non-wizard callers handle `llm_not_configured`)
- SMTP-only interim no longer ships broken (banner makes the limitation visible until v1.1.2.5)
- LLM key fingerprint algorithm specced (SHA-256 prefix, 8 hex, server-side decrypt-then-hash)
- P4 renamed and honestly reframed (sandbox → rubric preview & sample draft; runs after voice cal, not before)
- LinkedIn URL dropped from v1.1 (LinkedIn blocks serverless scrapers; "describe in 1-2 sentences" is the primary path; revisit in v1.2 only with stable option)
- Reply notification default is email, Slack is advanced (matches non-tech user setup)
- Voice cal gains Path 0 (zero-emails fallback: Tay prompts user to write a sample on the spot)
- Supabase-rotation warning is step-ordered ("disconnect Gmail first"), not a footnote

## All decisions locked

**P6 LinkedIn URL — DROPPED (user chose option C, 2026-05-17).** The "describe in 1-2 sentences" path is the primary prospect quick-add. LinkedIn URL revisited in v1.2+ only if a stable scraping path emerges.

## After v3 approval: what starts v1.1.1

Once you greenlight, v1.1.1 begins with:
1. New worktree (orchestrator pattern from v0.x)
2. Migration 0011 introduces `instance_secrets`
3. `lib/secrets/derive.ts` (HKDF + lazy-loader)
4. `lib/llm.ts` provider-detect rewrite
5. Crypto + token + cron callsite refactors
6. `/settings/secrets` page (fingerprint + rotate + rotation banner)
7. Wizard step "configure LLM key" replaces the v0.1 Anthropic-key-in-env flow
8. JOURNEYS scenarios for the new paths
9. Judge review + ship via gh PR flow
