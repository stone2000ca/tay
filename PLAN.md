# Tay — plan

## What Tay is

A self-hosted AI BDR agent that one person installs once and runs forever on their own infrastructure.

Tay:

- **Researches** prospects from the web + their company + your CRM
- **Drafts** cold-outbound emails and follow-ups in your voice
- **Sends** approved drafts from your Gmail (audited Tier-3 path with a judge gate)
- **Replies** to threads autonomously up to a configurable trust tier
- **Books** appointments by negotiating times via reply
- **Audits** everything — every send, every decision, every override

## Architecture — single-tenant, installable

Each install is owned by one person. There is no Tay-the-platform. The whole thing is a Next.js 16 app deployed to the user's own Vercel project, backed by the user's own Supabase project. LLM calls go to the user's own Anthropic account.

```
User's Vercel project (forked via Deploy button)
├── Next.js 16 app
│   ├── Setup wizard           (first-run UX for non-tech users)
│   ├── Dashboard              (review queue, sent log, settings)
│   ├── Researcher             (LLM + web search)
│   ├── Drafter                (LLM + voice rubric + playbook)
│   ├── Judge                  (LLM — 4-way: allow / block / revise / escalate)
│   ├── Sender                 (Gmail OAuth, Tier-3 audited path)
│   └── Reply handler          (inbound webhook + threaded LLM)
│
└── User's Supabase project (linked via Marketplace)
    ├── prospects
    ├── drafts
    ├── threads
    ├── audit_log              (append-only, hash-chained)
    ├── suppression            (per-install — no cross-tenant overlap)
    └── voice_calibration      (5 sample emails + extracted rubric)
```

## The non-tech install promise

- 15 minutes from "click Deploy" to "Tay is running"
- No CLI. No Docker. No `npm install` on the user's machine.
- All config in the in-app wizard, not env-var editing
- Sensible defaults everywhere; "advanced" settings hidden behind a toggle

## What this version drops from the original multi-tenant SPEC

The original [tay-flywheel SPEC](https://github.com/stone2000ca/flywheel-main/blob/main/tay-flywheel/SPEC.md) targets a multi-tenant SaaS. This installable version drops:

- RLS tenant-isolation contract tests — no tenants to isolate
- KMS field-level encryption — Supabase handles at-rest; user owns the project
- Cross-tenant suppression overlap — no other tenants
- Tenant lifecycle state machine — just user-paused / user-running
- State arbiter — just a kill switch
- DPA / DSAR portal — user-owned data; user complies for themselves
- Tenant-cost-cap throttle — user sees their own Anthropic bill directly
- Counsel-reviewed privacy + LIA templates as a ship gate — still recommended, not gated

This collapses ~17 Phase-0 PRs in the original spec to ~9 v0.x release milestones below.

## What this version keeps

- Judge layer — 4-way decision over every draft (brand safety is product safety)
- Audit hash chain — append-only, tamper-evident log of every Tier-3 action
- Suppression list — per-install; unsubscribe + bounce + complaint tracking
- Voice calibration rubric — paste 5 emails, extract style, enforce in drafter + judge
- Playbook content — opener patterns, follow-up cadence, objection rebuttals
- Trust tiers — capabilities (send / reply / book) start at "needs approval" and earn autonomy
- JOURNEYS eval suite — adversarial prospect scenarios that gate releases
- AI disclosure footer — every draft carries the disclosure (jurisdiction-aware policy)

## Roadmap (v0.x → v1.0)

| Version | What ships |
|---|---|
| v0.0.1 | Scaffold — Next.js 16 app, Deploy button, health route. *(this commit)* |
| v0.1 | Setup wizard step 1 — paste Anthropic key, name your instance |
| v0.2 | Supabase Marketplace integration + auto-migrations + UI shell with nav |
| v0.3 | Voice calibration — paste 5 emails, extract rubric, save to DB |
| v0.4 | Drafter v1 — type a prospect's name + company → generated draft |
| v0.5 | Judge v1 — 4-way decision over drafts (stubs allowed; wiring real) |
| v0.6 | Audit log v1 — every draft + decision logged with hash chain |
| v0.7 | Gmail OAuth + send path — review queue → send → audit log |
| v0.8 | Suppression list + unsubscribe handling |
| v0.9 | Reply handler — inbound webhook + threaded LLM |
| v1.0 | JOURNEYS eval suite green; trust-tier promotion live |

## Source-of-truth for the bigger picture

The original multi-tenant design — full discovery, compliance, architecture rationale — lives in [tay-flywheel/](https://github.com/stone2000ca/flywheel-main/tree/main/tay-flywheel) inside the flywheel-main handbook repo. That doc is the parent thinking. **This repo is what actually ships.**
