# Tay — your own AI BDR agent

Tay finds prospects, writes them in your voice, and books meetings — running on your own Vercel + Supabase. No SaaS account. No shared data. No per-seat fees.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/stone2000ca/tay&env=ANTHROPIC_API_KEY,NEXT_PUBLIC_APP_NAME&envDescription=Your%20Anthropic%20API%20key%20and%20a%20display%20name%20for%20your%20Tay&envLink=https://github.com/stone2000ca/tay/blob/main/README.md%23env-vars)

## What you'll need

- An [Anthropic API key](https://console.anthropic.com/settings/keys) — Tay uses Claude to draft, judge, and research (~$20/month for moderate use)
- A free [Vercel](https://vercel.com/signup) account — hosts your Tay instance
- A free [Supabase](https://supabase.com/) account — stores your prospects, drafts, and audit log
- 15 minutes for first-time setup

## Install in 3 steps

1. **Click the Deploy button above.** Vercel forks this repo into your account and prompts you for env vars.
2. **Connect Supabase** via the Vercel Marketplace once your project is created. Tay runs migrations on first boot.
3. **Open your Tay URL** (Vercel shows it after deploy). The setup wizard walks you through Gmail connect, voice calibration, and your first ICP.

No CLI. No Docker. No `npm install` on your machine.

## Why self-hosted?

Cold-outbound AI tools that run on someone else's servers see every prospect you target and every draft you write. That's a lot of trust to outsource. Tay keeps the same code, but the data lives in *your* Supabase, *your* Gmail, *your* Vercel. Tay-the-author never sees a byte.

## Status: v0.0.1 — scaffold

This is the initial public scaffold. The setup wizard, judge, drafter, suppression list, and audit log land PR by PR. Roadmap in [PLAN.md](./PLAN.md).

v0.1 — setup wizard step 1 lives at `/setup`. First run redirects there until the wizard is completed.

## Env vars

| Var | What it's for | Required |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude calls for drafting, judging, research | yes |
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
cp .env.example .env.local   # fill in ANTHROPIC_API_KEY at minimum
npm run dev
```

Then `http://localhost:3000`.

## License

TBD.
