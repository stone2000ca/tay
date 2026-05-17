# Tay Build — Current State

**Last updated:** 2026-05-17 (Run #002)
**Current milestone:** v0.3 (next to ship)
**Roadmap progress:** 3/10 milestones merged

## Currently in flight

(None — run #002 closed cleanly.)

## Next up

- **v0.3: Voice calibration — paste 5 emails, extract rubric, save to DB.**
  - New `/setup/voice` (or step 2 of the wizard) where the user pastes 5 of their own sample outbound emails
  - LLM extractor (Claude) reads the 5 samples and produces a structured rubric: opener style, sentence length, formality, signature pattern, common-phrase whitelist, do-not-use phrase blacklist
  - New `voice_calibration` table (id, rubric jsonb, sample_count, created_at) — single-row per install, same pattern as `app_config`
  - Rubric is the contract the v0.4 drafter and v0.5 judge enforce — write the JSON schema deliberately
  - Tay gates: B (no special-category data in the rubric — purely stylistic features), H (sample emails wrapped in `<untrusted_source>` blocks when passed to the extractor LLM; structured output schema only)

## Blocked / awaiting input

- **`ANTHROPIC_API_KEY` not in orchestrator env** — v0.3 is the first LLM-touching milestone post-scaffold and needs a real key for the extractor smoke test. Add to `.env.local` (see `.env.example`) before run #003 or accept that v0.3 ships with mocked-only verification on the LLM seam.
- **(Optional) Live Supabase smoke test** — `migrate.ts` shipped in v0.2 has not been exercised against a real Postgres cluster (no Supabase project linked in build env). 5-minute fix: provision Supabase via the Vercel Marketplace on the live project, hit the home route once, confirm tables appear. Mitigations in place (inline-SQL fallback, transactional DDL, idempotent CREATEs) make this low-risk.
- **Vercel project not linked to GitHub repo** — preview URLs not captured on PRs. One-time setup; would also unlock the live Supabase smoke-test path above.

## Recent learnings

1. `gh pr merge --delete-branch` aborts at the local-checkout step whenever `main` is checked out in another worktree. Hit on runs #001 AND #002. Orchestrator workaround: follow up with `git push origin --delete <branch>` regardless of `gh` exit code. Candidate SKILL.md tweak.
2. Next 16 + Turbopack emits an NFT-trace warning on dynamic `path.join` for non-bundled asset loads (e.g. SQL migration files). Mitigation pattern: inline-string SQL as runtime source of truth, keep disk-load as fallback, document inline. Suppression hints (`/*turbopackIgnore: true*/`) don't actually silence the warning.
3. Single-row Supabase tables (`app_config`, `voice_calibration`, etc.) are clean with DELETE+INSERT in a transaction — simpler than upsert dance, and respects the "one config per install" invariant by design.
4. Vercel Marketplace Supabase integration auto-provisions `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING` alongside the Supabase-specific vars — use the non-pooling URL for DDL via `pg` (the JS SDK doesn't expose DDL).
5. Dual-backend (Supabase + cookie fallback) modules need an explicit read-vs-write error contract — read paths should soft-fail to null, write paths should throw. Comment the convention in the module, not just the agent's report (judge improvement for run #003).

## Files most recently touched

- v0.2 (run #002): `lib/supabase/server.ts`, `lib/supabase/anon.ts`, `lib/supabase/migrations/0001_init.sql`, `lib/supabase/migrate.ts`, `lib/supabase/migrate.test.ts`, `components/nav.tsx`, `app/settings/page.tsx`, `lib/app-config.ts`, `lib/app-config.test.ts`, `app/page.tsx`, `app/layout.tsx`, `app/setup/actions.ts`, `package.json`, `package-lock.json`, `README.md`, `.env.example` (PR #3, commit `1bcf341e`)
- v0.1 (run #001): `app/setup/page.tsx`, `app/setup/actions.ts`, `lib/anthropic.ts`, `lib/app-config.ts`, `lib/app-config.test.ts`, `app/page.tsx`, `README.md`, `package.json`, `package-lock.json` (PR #1, commit `1f87cf1e`)

## Milestone map (synced from PLAN.md roadmap)

| Version | Description | Status | Run merged | PR |
|---|---|---|---|---|
| v0.0.1 | Scaffold — Next.js 16 app, Deploy button, health route | MERGED | (bootstrap) | `224b024` (root commit, no PR) |
| v0.1 | Setup wizard step 1 — paste Anthropic key, name your instance | MERGED | #001 (2026-05-13) | [#1](https://github.com/stone2000ca/tay/pull/1) — `1f87cf1e` |
| v0.2 | Supabase Marketplace integration + auto-migrations + UI shell with nav | MERGED | #002 (2026-05-17) | [#3](https://github.com/stone2000ca/tay/pull/3) — `1bcf341e` |
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
