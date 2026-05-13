# Tay Build — Current State

**Last updated:** 2026-05-13 (Run #001)
**Current milestone:** v0.2 (next to ship)
**Roadmap progress:** 2/10 milestones merged

## Currently in flight

(None — run #001 closed cleanly.)

## Next up

- **v0.2: Supabase Marketplace integration + auto-migrations + UI shell with nav.**
  - Wire Supabase via the Vercel Marketplace (auto-provisions `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`)
  - First migration: `app_config` table (id, name, validated_at, updated_at) + `prospects` skeleton + `audit_log` skeleton
  - Auto-migrate on first server boot if the schema is missing (idempotent)
  - UI shell: top nav with logo + section links (Dashboard / Setup / Settings — Dashboard is just a placeholder for now)
  - Swap `lib/app-config.ts` from cookie-backed to Supabase-backed (the abstraction was designed for this)
  - First-run detector now checks `app_config` row + the cookie can be retired

## Blocked / awaiting input

- **`next lint` script is dead** — Next 16 removed it. Pick (a) direct `eslint .` + ESLint devDep, (b) Biome, or (c) drop. Affects the self-test gate from v0.2 onward.
- **Cookie `secure: true` breaks localhost dev** — relax to `secure: process.env.NODE_ENV === "production"` or accept HTTPS-only dev. One-line fix; can land as part of v0.2 cleanup.
- **No `ANTHROPIC_API_KEY` in orchestrator env** — future LLM-touching milestones (v0.3 voice calibration, v0.4 drafter, v0.5 judge) need a real key for live smoke tests. Add to `.env.local` before run #003 or accept mocked-only verification on those.

## Recent learnings

1. `gh pr merge --delete-branch` aborts at the local-checkout step when `main` is checked out in another worktree. The server-side merge still succeeds — orchestrator must follow up with `git push origin --delete <branch>` to clean the remote.
2. Agent did not auto-commit its work before reporting COMPLETE. Future agent prompts must require `git status` clean as part of self-test.
3. Storage abstraction `lib/app-config.ts` is the seam for v0.1→v0.2 swap. Cookie at v0.1, Supabase at v0.2 — the call sites in `app/page.tsx` and `app/setup/actions.ts` should not change shape during v0.2.
4. `@anthropic-ai/sdk@^0.95.2` is the working version as of 2026-05-13. SDK exports `AuthenticationError`, `RateLimitError`, `APIConnectionError` for error mapping.

## Files most recently touched

- v0.1 (run #001): `app/setup/page.tsx`, `app/setup/actions.ts`, `lib/anthropic.ts`, `lib/app-config.ts`, `lib/app-config.test.ts`, `app/page.tsx`, `README.md`, `package.json`, `package-lock.json` (PR #1, commit `1f87cf1e`)

## Milestone map (synced from PLAN.md roadmap)

| Version | Description | Status | Run merged | PR |
|---|---|---|---|---|
| v0.0.1 | Scaffold — Next.js 16 app, Deploy button, health route | MERGED | (bootstrap) | `224b024` (root commit, no PR) |
| v0.1 | Setup wizard step 1 — paste Anthropic key, name your instance | MERGED | #001 (2026-05-13) | [#1](https://github.com/stone2000ca/tay/pull/1) — `1f87cf1e` |
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
