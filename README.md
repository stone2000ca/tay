# Tay — your own AI BDR agent

Tay finds prospects, writes them in your voice, and books meetings — running on your own Vercel + Supabase. No SaaS account. No shared data. No per-seat fees.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/stone2000ca/tay)

## What you'll need

- An LLM API key — bring your own from [Anthropic](https://console.anthropic.com/settings/keys), [OpenAI](https://platform.openai.com/api-keys), or [OpenRouter](https://openrouter.ai/keys). The wizard auto-detects the provider; you paste the key into the in-app setup, not your env vars.
- A free [Vercel](https://vercel.com/signup) account — hosts your Tay instance
- A free [Supabase](https://supabase.com/) account — stores your prospects, drafts, and audit log
- A Gmail account — either (a) **Easy mode** (v1.1.2): personal Gmail with 2-Step Verification on, generate an [App Password](https://myaccount.google.com/apppasswords), takes ~2 minutes. Or (b) **Power mode**: a [Google Cloud OAuth client](https://console.cloud.google.com/apis/credentials) — "Web application" with `${SITE_URL}/api/auth/google/callback` as redirect URI; scopes `gmail.send` + `gmail.readonly`. Power is required for Workspace accounts and passkey-only Google accounts.
- 10 minutes for first-time setup

## Install in 3 steps

1. **Click the Deploy button above.** Vercel forks this repo into your account and prompts you for env vars.
2. **Connect Supabase** via the Vercel Marketplace once your project is created. Tay runs migrations on first boot — the first page load after the integration finishes creates the `app_config`, `prospects`, and `audit_log` tables idempotently.
3. **Open your Tay URL** (Vercel shows it after deploy). The setup wizard walks you through Gmail connect, voice calibration, and your first ICP.

No CLI. No Docker. No `npm install` on your machine.

## Why self-hosted?

Cold-outbound AI tools that run on someone else's servers see every prospect you target and every draft you write. That's a lot of trust to outsource. Tay keeps the same code, but the data lives in *your* Supabase, *your* Gmail, *your* Vercel. Tay-the-author never sees a byte.

## Status: v1.1.2.5 — IMAP reply polling for SMTP mode

v1.1.2.5 closes the reply-pipeline gap left by v1.1.2. SMTP App Password users now get the full reply pipeline (classify → trust → auto-draft) on the same 5-minute cadence as the OAuth path — no extra setup, no Vercel config to touch.

- **IMAP poller** — `lib/reply/imap-poll.ts` uses `imapflow` to fetch new messages over implicit-TLS port 993. Cursor advances by UID (`imap_poll_cursor` table; single-row `lock_col` UNIQUE pattern). First poll seeds from `uidNext - 1` without backfill — same "no historical replay" guarantee as the v0.9 Gmail History API path.
- **Channel dispatcher** — `lib/reply/poll.ts` adds `pollReplies()` which reads `mailbox_credentials.kind` and delegates to either `pollGmail()` (OAuth) or `pollImapMailbox()` (SMTP). The cron route (`/api/cron/poll-gmail`, name preserved for `vercel.json` cron-config stability) now calls the dispatcher.
- **Dual thread anchor** — `lib/reply/handle.ts` matches inbound replies via `sent_messages.gmail_thread_id` first (OAuth path) and falls back to `gmail_message_id` when the IMAP poller passes the parsed `In-Reply-To` header (SMTP path uses our generated `Message-ID` from `lib/send/smtp.ts` as the thread anchor).
- **Channel-tagged audit** — `reply.received` and `reply.classified` audit entries now carry `channel: "oauth" | "app_password"` so the gate F chain records which transport saw each reply.
- **Interim banner removed** — `/queue` and `/replies` no longer show the v1.1.2 "Reply polling activates in the next update" notice; SMTP users get the same replies surface as OAuth users today.
- **Gate H preserved** — IMAP-fetched reply bodies flow through the existing `handleReply()` → `classifyReply()` path, so the `<untrusted_source>` wrap is still the load-bearing defense against prompt injection from attacker-controlled inbound mail.

### Earlier — v1.1.2: SMTP send (Easy mode) for 10-minute non-tech install

v1.1.2 ships the SMTP App Password path so non-technical users on personal Gmail can connect in ~2 minutes instead of doing the ~20-minute Google Cloud OAuth dance.

- **Wizard mailbox step** (`/setup/mailbox`) — two-column choice: **Easy** (Gmail App Password) or **Power** (Google OAuth). Easy is recommended for personal Gmail; Power is required for Workspace and for passkey-only Google accounts (where App Passwords are no longer offered).
- **SMTP via nodemailer** — `lib/send/smtp.ts` opens a single-shot STARTTLS connection to `smtp.gmail.com:587`, authenticates with the App Password, and sends. Message-ID is generated server-side so v1.1.2.5 can match IMAP replies by `In-Reply-To`. The orchestrator (`lib/send/orchestrate.ts`) is now channel-aware: same suppression / judge / audit / trust gates on both transports.
- **Unified mailbox credentials** — new `mailbox_credentials` table replaces `google_oauth` as the primary read target. Backwards-compat fallback to `google_oauth` keeps existing v0.7+ OAuth installs working without forcing a reconnect.
- **App Password verification** — `lib/send/smtp-verify.ts` runs an STARTTLS handshake at wizard time so wrong-password / wrong-host / TLS / passkey-only cases surface BEFORE the credentials are persisted. Auth failures route the user to the "try Power mode" suggestion (passkey-only Google accounts can't generate App Passwords).

### Earlier — v1.1.1: secrets foundation

- **Derived per-purpose secrets** — `TAY_OAUTH_SECRET` is gone from your env. The OAuth-token AES key and the unsubscribe HMAC are derived via HKDF-SHA256(`SUPABASE_SERVICE_ROLE_KEY`, `instance_secrets.salt`, per-purpose `info`) on every request. The salt is minted automatically on first cold start and lives in your own Supabase. (Legacy `TAY_OAUTH_SECRET` is still accepted as a fallback for v0.x installs upgrading in place.) `CRON_SECRET` is NOT derived — Vercel Cron's auth mechanism reads `process.env.CRON_SECRET` directly, and Vercel auto-sets it for any project with a `vercel.json` cron config. Non-Vercel deploys must set it manually like any other env var.
- **BYO LLM provider** — Tay now supports Anthropic (`sk-ant-…`), OpenAI (`sk-…`), and OpenRouter (`sk-or-…`) via auto-detection from the key prefix. The wizard collects your key in-app, encrypts it (AES-256-GCM via the derived OAuth secret), and stores it in `instance_secrets`. Drafter / judge / reply / voice all use a provider-neutral `chatComplete` adapter.
- **`VERCEL_URL` auto-detection** — `NEXT_PUBLIC_SITE_URL` is now optional. Tay falls through to `VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_URL` (both auto-set by Vercel) before defaulting to `http://localhost:3000`. The OAuth callback + unsubscribe links pick up the right host without manual configuration.

v1.0 (still in place) ships JOURNEYS eval suite + trust-tier promotion. Roadmap in [PLAN.md](./PLAN.md).

v1.0 lands three things together:

- **JOURNEYS eval suite** — adversarial-scenario regression corpus that locks in the 7 Tay gates (B/C/D/E/F/H/I). 10 scenarios covering: cold-draft happy path, prompt injection in prospect notes, special-category mention (gate B), disclosure footer regression (gate C), rubric drift (gate D), send to suppressed prospect (gate E), audit hash chain integrity (gate F), two adversarial-reply variants (gate H), and trust-tier promotion (gate I). Run via `npm run test:journeys`; on green the suite prints `*** JOURNEYS GREEN ***`. The suite is the regression contract for v1.x — break a gate, break a scenario.
- **Trust-tier promotion** — `lib/trust/tier.ts` reads `trust_events` and computes a per-capability tier (`tier_0` / `tier_1` / `tier_2` / `tier_3`). Auto-promotion stops at `tier_2`; `tier_3` is manual-only. Thresholds default to 25 clean sends → `tier_1`, 250 clean / ≤2 incidents → `tier_2` for the `send` capability. 5+ incidents in 30 days demote one tier. View and recompute per capability at `/settings/trust`.
- **v0.9 polling robustness fixes** — Gmail poll cursor now advances using the `historyId` returned by the History API response itself (no second `getProfile()` call — eliminates the race window where new mail could arrive between list and profile and be marked already-seen). `gmail_poll_cursor` is constrained to a single row via a deterministic `SINGLE_ROW_ID` + `lock_col` UNIQUE constraint. Reply handler: unmatched threads now persist a `<unmatched-thread>` sentinel body (privacy + storage); self-sent outbound short-circuits classifier; auto-draft reply hydrates the real prospect record into the drafter's prompt inputs.

### Run the JOURNEYS suite

```bash
npm run test:journeys
```

Runs `vitest run journeys` — the 10 adversarial scenarios + an aggregated summary banner. Mocks the OpenAI SDK + Supabase server client + audit/trust writers; tests the PIPELINE WIRING, not the LLM itself. Green = the 7 Tay gates' wiring still holds.

`npm test` runs the full unit-test suite AND the JOURNEYS harness (both pick up `*.test.ts`).

## Env vars (v1.1.1)

| Var | What it's for | Required |
|---|---|---|
| `NEXT_PUBLIC_APP_NAME` | Display name shown in the Tay UI | optional |
| `NEXT_PUBLIC_SUPABASE_URL` | Auto-set by the Vercel + Supabase Marketplace integration | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auto-set by the integration | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-set by the integration. v1.1.1: used as HKDF IKM for the OAuth/unsubscribe/cron secrets | yes |
| `POSTGRES_URL`, `POSTGRES_URL_NON_POOLING` | Auto-set by the integration. Used by the migration runner | yes |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth client ID from Google Cloud Console — required for the send path | yes (v0.7+) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth client secret paired with the ID above | yes (v0.7+) |
| `NEXT_PUBLIC_SITE_URL` | Public URL of your Tay deploy. v1.1.1: falls back to `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL` so it's optional on Vercel | optional |
| `OPENROUTER_MODEL_CHEAP` | Override the default cheap OpenRouter model | optional |
| `OPENROUTER_MODEL_QUALITY` | Override the default quality OpenRouter model | optional |
| `TAY_OAUTH_SECRET` | DEPRECATED. v0.x env var; v1.1.1 derives this. Still honored as fallback while you migrate | optional |
| `CRON_SECRET` | Auto-set by Vercel when a `vercel.json` cron is configured. Non-Vercel deploys must set this manually | auto on Vercel |

For local development, copy [.env.example](./.env.example) to `.env.local`. The LLM API key is collected by the in-app wizard, not env vars.

## Local dev

```bash
git clone git@github.com:stone2000ca/tay.git
cd tay
npm install
cp .env.example .env.local   # Supabase + Google OAuth vars only
npm run dev
```

Then `http://localhost:3000`. The wizard at `/setup` walks you through naming the instance, pasting your LLM key (sk-ant-… / sk-… / sk-or-…), and calibrating voice.

## License

TBD.
