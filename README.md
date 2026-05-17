# Tay — your own AI BDR agent

Tay finds prospects, writes them in your voice, and books meetings — running on your own Vercel + Supabase. No SaaS account. No shared data. No per-seat fees.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/stone2000ca/tay&env=OPENROUTER_API_KEY,NEXT_PUBLIC_APP_NAME&envDescription=Your%20OpenRouter%20API%20key%20and%20a%20display%20name%20for%20your%20Tay&envLink=https://github.com/stone2000ca/tay/blob/main/README.md%23env-vars)

## What you'll need

- An [OpenRouter API key](https://openrouter.ai/keys) — one key for any model (Claude, GPT, Gemini, Llama, etc.). Tay uses the model you pick to draft, judge, and research (~$20/month for moderate use on a mid-tier model)
- A free [Vercel](https://vercel.com/signup) account — hosts your Tay instance
- A free [Supabase](https://supabase.com/) account — stores your prospects, drafts, and audit log
- 15 minutes for first-time setup

## Install in 3 steps

1. **Click the Deploy button above.** Vercel forks this repo into your account and prompts you for env vars.
2. **Connect Supabase** via the Vercel Marketplace once your project is created. Tay runs migrations on first boot — the first page load after the integration finishes creates the `app_config`, `prospects`, and `audit_log` tables idempotently.
3. **Open your Tay URL** (Vercel shows it after deploy). The setup wizard walks you through Gmail connect, voice calibration, and your first ICP.

No CLI. No Docker. No `npm install` on your machine.

## Why self-hosted?

Cold-outbound AI tools that run on someone else's servers see every prospect you target and every draft you write. That's a lot of trust to outsource. Tay keeps the same code, but the data lives in *your* Supabase, *your* Gmail, *your* Vercel. Tay-the-author never sees a byte.

## Status: v0.5 — judge v1 (4-way decision over drafts)

This is the early-access build. The setup wizard, judge, drafter, suppression list, and audit log land PR by PR. Roadmap in [PLAN.md](./PLAN.md).

v0.5 wires the judge into the drafter flow. Every draft now passes through a strict reviewer LLM before display — it returns one of four decisions (`allow` / `block` / `revise` / `escalate`) and the UI renders it alongside the draft. The judge verifies Tay gates B (no special-category data), C (AI disclosure footer), D (voice rubric adherence), and H (adversarial-input defenses) as VERIFICATION rather than trusting the drafter. Decisions persist to a new `judge_decisions` table and emit a Tier-3 audit event (real hash chain lands in v0.6). NO send yet — that's v0.7.

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
