# Tay — your own AI BDR agent

Tay finds prospects, writes them in your voice, and books meetings — running on your own Vercel + Supabase. No SaaS account. No shared data. No per-seat fees.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/stone2000ca/tay&env=OPENROUTER_API_KEY,NEXT_PUBLIC_APP_NAME&envDescription=Your%20OpenRouter%20API%20key%20and%20a%20display%20name%20for%20your%20Tay&envLink=https://github.com/stone2000ca/tay/blob/main/README.md%23env-vars)

## What you'll need

- An [OpenRouter API key](https://openrouter.ai/keys) — one key for any model (Claude, GPT, Gemini, Llama, etc.). Tay uses the model you pick to draft, judge, and research (~$20/month for moderate use on a mid-tier model)
- A free [Vercel](https://vercel.com/signup) account — hosts your Tay instance
- A free [Supabase](https://supabase.com/) account — stores your prospects, drafts, and audit log
- A [Google Cloud OAuth client](https://console.cloud.google.com/apis/credentials) — "Web application" type, with `${NEXT_PUBLIC_SITE_URL}/api/auth/google/callback` as an authorized redirect URI; scope `gmail.send` (send only, no read)
- 15 minutes for first-time setup

## Install in 3 steps

1. **Click the Deploy button above.** Vercel forks this repo into your account and prompts you for env vars.
2. **Connect Supabase** via the Vercel Marketplace once your project is created. Tay runs migrations on first boot — the first page load after the integration finishes creates the `app_config`, `prospects`, and `audit_log` tables idempotently.
3. **Open your Tay URL** (Vercel shows it after deploy). The setup wizard walks you through Gmail connect, voice calibration, and your first ICP.

No CLI. No Docker. No `npm install` on your machine.

## Why self-hosted?

Cold-outbound AI tools that run on someone else's servers see every prospect you target and every draft you write. That's a lot of trust to outsource. Tay keeps the same code, but the data lives in *your* Supabase, *your* Gmail, *your* Vercel. Tay-the-author never sees a byte.

## Status: v1.0 — production-ready (post-discovery; pre-customer)

This is the v0.x ship gate. After v1.0, Tay is feature-complete for the v0.x cycle. Future work is gated on explicit user direction (the `/tay-build` orchestrator surfaces "awaiting user direction" on the next invocation). Roadmap in [PLAN.md](./PLAN.md).

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

## Env vars

| Var | What it's for | Required |
|---|---|---|
| `OPENROUTER_API_KEY` | LLM calls for drafting, judging, research — any model OpenRouter supports | yes |
| `OPENROUTER_MODEL_CHEAP` | Override the default cheap model (default `anthropic/claude-3.5-haiku`) | optional |
| `OPENROUTER_MODEL_QUALITY` | Override the default quality model (default `anthropic/claude-3.5-sonnet`) | optional |
| `NEXT_PUBLIC_APP_NAME` | Display name shown in the Tay UI | optional |
| `NEXT_PUBLIC_SUPABASE_URL` | Auto-set by the Vercel + Supabase Marketplace integration | yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Auto-set by the integration | yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-set by the integration | yes |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth client ID from Google Cloud Console — required for v0.7 send path | yes (v0.7+) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth client secret paired with the ID above | yes (v0.7+) |
| `TAY_OAUTH_SECRET` | 64 hex chars (32 bytes). Encrypts OAuth tokens at rest. Generate with `openssl rand -hex 32` | yes (v0.7+) |
| `NEXT_PUBLIC_SITE_URL` | Public URL of your Tay deploy. Used to build the OAuth redirect URI | yes (v0.7+) |
| `CRON_SECRET` | Bearer token Vercel Cron forwards when triggering `/api/cron/poll-gmail`. Generate with `openssl rand -hex 32`. Without it, the cron route returns 401 and Tay never polls for replies | yes (v0.9+) |

For local development, copy [.env.example](./.env.example) to `.env.local` and fill in values.

## Local dev

```bash
git clone git@github.com:stone2000ca/tay.git
cd tay
npm install
cp .env.example .env.local   # fill in OPENROUTER_API_KEY at minimum
npm run dev
```

Then `http://localhost:3000`.

## License

TBD.
