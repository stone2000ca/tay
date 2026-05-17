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

## Status: v0.7 — Gmail OAuth + send path

This is the early-access build. The setup wizard, judge, drafter, suppression list, and audit log land PR by PR. Roadmap in [PLAN.md](./PLAN.md).

v0.7 is the first PR where Tay actually emits to the outside world. You connect your own Gmail (scope: `gmail.send` only, no read). Drafts the judge marked `allow` show in `/queue`. Click Send and Tay calls Gmail's API directly — your tokens, your account, your data. Every send writes a `sent_messages` row, appends to the audit log (`send.sent`), and records a trust event (`send` / `sent`). OAuth tokens are encrypted at rest with AES-256-GCM under a key you set in `TAY_OAUTH_SECRET` (32 bytes hex); without that key, the OAuth flow refuses to start. Suppression check (`lib/suppression/check.ts`) is a stub that always returns false in v0.7 — v0.8 wires the real list.

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
