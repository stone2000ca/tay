# Tay Build — Current State

**Last updated:** 2026-05-13 (Bootstrap)
**Current milestone:** v0.1 (next to ship)
**Roadmap progress:** 1/10 milestones merged

## Currently in flight

(None)

## Next up

- **v0.1: Setup wizard step 1** — paste Anthropic key, name your instance.
  - Route: `/setup` (or `/setup/welcome`)
  - First-run detector: if no `ANTHROPIC_API_KEY` in env AND no `app_config` row in DB, redirect home → setup
  - Persist API key validation result (don't store the key in DB — it stays in Vercel env vars / .env.local)
  - Persist app name (display name) to Supabase `app_config` table
  - Smoke test the key with a `claude-haiku-4-5` hello-world before saving

## Blocked / awaiting input

- **None.** v0.1 is purely a UI + Anthropic API call. No external decisions needed.

## Recent learnings

(None yet — bootstrap state.)

## Files most recently touched

- v0.0.1 scaffold: package.json, app/layout.tsx, app/page.tsx, app/api/health/route.ts, README.md, PLAN.md (commits `224b024`, `1e33741` on `main`)

## Milestone map (synced from PLAN.md roadmap)

| Version | Description | Status | Run merged | PR |
|---|---|---|---|---|
| v0.0.1 | Scaffold — Next.js 16 app, Deploy button, health route | MERGED | (bootstrap) | `224b024` (root commit, no PR) |
| v0.1 | Setup wizard step 1 — paste Anthropic key, name your instance | NOT_STARTED | — | — |
| v0.2 | Supabase Marketplace integration + auto-migrations + UI shell with nav | NOT_STARTED | — | — |
| v0.3 | Voice calibration — paste 5 emails, extract rubric, save to DB | NOT_STARTED | — | — |
| v0.4 | Drafter v1 — type a prospect's name + company → generated draft | NOT_STARTED | — | — |
| v0.5 | Judge v1 — 4-way decision over drafts | NOT_STARTED | — | — |
| v0.6 | Audit log v1 — every draft + decision logged with hash chain | NOT_STARTED | — | — |
| v0.7 | Gmail OAuth + send path | NOT_STARTED | — | — |
| v0.8 | Suppression list + unsubscribe handling | NOT_STARTED | — | — |
| v0.9 | Reply handler — inbound webhook + threaded LLM | NOT_STARTED | — | — |
| v1.0 | JOURNEYS eval suite green; trust-tier promotion live | NOT_STARTED | — | — |

## Status legend

**Pre-work:** `NOT_STARTED`

**In-flight (cleared at end of every run):** `IN_FLIGHT`, `PARTIAL`, `INTERRUPTED`

**Review:** `IN_REVIEW`, `NEEDS_FIXES`, `BLOCKED`

**Commit pipeline:** `APPROVED_NOT_COMMITTED`, `PR_CREATED`, `PREVIEW_FAILED`

**Terminal:** `MERGED`

See [skills/tay-build/SKILL.md](../skills/tay-build/SKILL.md) Phase 6 + 1.5 for recovery semantics.

## v1.0 ship gate

When v1.0 is MERGED + JOURNEYS eval suite is green + trust-tier promotion verified live:
- /tay-build surfaces "v1.0 complete. Awaiting user kickoff for post-1.0 work."
- Wait for explicit user direction
