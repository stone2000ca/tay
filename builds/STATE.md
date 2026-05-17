# Tay Build — Current State

**Last updated:** 2026-05-17 (Run #005)
**Current milestone:** v0.6 (next to ship)
**Roadmap progress:** 6/10 milestones merged

## Currently in flight

(None — run #005 closed cleanly.)

## Next up

- **v0.6: Audit log v1 — every draft + decision logged with hash chain.**
  - Replace `lib/audit/append.ts` stub with the real implementation:
    - Read `prev_hash` from latest `audit_log` row (sha256 hex, 64 chars; `prev_hash = null` for first row)
    - Compute `this_hash = sha256(prev_hash + canonical_json(payload) + occurred_at_iso + action)`
    - INSERT atomically (transaction or single insert from canonical payload)
    - Idempotent under retry: actions are inherently new events (don't dedupe; just append)
  - New `/api/audit/verify` (GET) — walks the chain, recomputes hashes, returns `{ ok, totalRows, brokenAt? }`
  - Optional: `/audit` page showing recent events + verifier badge
  - Backfill: existing `judge_decisions` rows don't have audit rows yet — but since v0.5's stub already called `appendAudit` with operational metadata, the v0.6 implementation just starts the chain fresh from the next call. Document this transition.
  - Address v0.5 carry-forwards:
    1. Tighten `appendAudit` redactor matcher OR tighten the comment + add a test that asserts each named protected key gets redacted (judge's improvement #1)
    2. `neuter()` belt-and-braces on `<untrusted_source` opener (one-line)
    3. `sanitizeReasons` cap-vs-reject — document rationale at call site
  - Out of scope: sending (v0.7), suppression (v0.8), reply handling (v0.9), JOURNEYS (v1.0)

## Blocked / awaiting input

(All previously-noted gates explicitly waived by user. Recommended but not blocking:)

- **First-user smoke test recommended** — paste real `OPENROUTER_API_KEY`, calibrate voice, draft a sample email. If `anthropic/claude-3.5-haiku` 404s on the user's OpenRouter account, swap `VALIDATION_MODEL` to `openai/gpt-4o-mini`.
- **Live Supabase not yet provisioned** — three migrations (0001, 0002, 0003 coming in v0.4) all unverified against real Postgres. Mitigations: idempotent CREATE IF NOT EXISTS, transactional DDL, inline-SQL fallback.
- **Vercel project not linked to GitHub repo** — preview URLs not captured on PRs.
- **Paper cuts to address in v0.6:**
  - `appendAudit` redactor doc-vs-impl drift (v0.5 judge): comment claims it redacts `email`/`body`/`raw`, but matcher only catches `api_key`/`secret`/`token`/`password`. Either tighten the matcher or tighten the comment; add a test per protected key. Becomes load-bearing in v0.7 when send-event callers come online.
  - `neuter()` belt-and-braces on the `<untrusted_source` opener (v0.5 judge)
  - `sanitizeReasons` cap-vs-reject — document the design choice at the call site (v0.5 judge)
- **Carried (best fixed in a later run with the right context):**
  - Synthesized-email edge cases — punt to when a real email field lands

## Recent learnings

1. `gh pr merge --squash --delete-branch --repo <owner/repo>` succeeds even when `main` is checked out in another worktree. Pattern locked in for run #003+; resolves the cleanup churn from runs #001 and #002.
2. OpenRouter is OpenAI-API-compatible → drop-in via `openai` SDK pointed at `https://openrouter.ai/api/v1`. One key, ~100 models. Users pick models via env vars (`OPENROUTER_MODEL_CHEAP`, `OPENROUTER_MODEL_QUALITY`) without code changes.
3. `response_format: { type: "json_object" }` is the right adversarial-input defense for LLM JSON outputs combined with a hard schema validator (`parseRubric`). System prompt should also instruct the LLM to ignore embedded instructions in untrusted inputs.
4. Multi-file migration runner pattern: a `MIGRATIONS_INLINE` map keyed by filename + per-migration sentinel pre-check (look for a known table from that migration in `information_schema`) keeps the runner idempotent without needing a migrations-tracking table.
5. Dual-backend modules (Supabase + cookie fallback) work but the "neither configured" state creates redirect-loop UX. Future milestones touching these should add a top-of-page "Supabase not configured" banner that short-circuits the loop and tells the user what to do.
6. Voice rubric is the contract for v0.4 (drafter) and v0.5 (judge). Schema header in `lib/voice/rubric-schema.ts` documents this so future maintainers don't reshape it.

## Files most recently touched

- v0.3 + LLM pivot (run #003, PR #5, squash `27840442`): `lib/llm.ts`, `lib/llm.test.ts`, `lib/voice/rubric-schema.ts`, `lib/voice/calibrate.ts`, `lib/voice/calibrate.test.ts`, `lib/supabase/migrations/0002_voice_calibration.sql`, `lib/supabase/migrate.ts`, `app/setup/voice/page.tsx`, `app/setup/voice/actions.ts`, `app/page.tsx`, `app/setup/page.tsx`, `app/setup/actions.ts`, `.env.example`, `README.md`, `package.json`, `package-lock.json` — and DELETED `lib/anthropic.ts`
- v0.2 (run #002, PR #3, squash `1bcf341e`): `lib/supabase/server.ts`, `lib/supabase/anon.ts`, `lib/supabase/migrations/0001_init.sql`, `lib/supabase/migrate.ts`, `lib/supabase/migrate.test.ts`, `components/nav.tsx`, `app/settings/page.tsx`, `lib/app-config.ts`, `lib/app-config.test.ts`, `app/page.tsx`, `app/layout.tsx`, `app/setup/actions.ts`, `package.json`, `package-lock.json`, `README.md`, `.env.example`
- v0.1 (run #001, PR #1, squash `1f87cf1e`): `app/setup/page.tsx`, `app/setup/actions.ts`, `lib/anthropic.ts` (since deleted), `lib/app-config.ts`, `lib/app-config.test.ts`, `app/page.tsx`, `README.md`, `package.json`, `package-lock.json`

## Milestone map (synced from PLAN.md roadmap)

| Version | Description | Status | Run merged | PR |
|---|---|---|---|---|
| v0.0.1 | Scaffold — Next.js 16 app, Deploy button, health route | MERGED | (bootstrap) | `224b024` (root commit, no PR) |
| v0.1 | Setup wizard step 1 — paste Anthropic key, name your instance | MERGED | #001 (2026-05-13) | [#1](https://github.com/stone2000ca/tay/pull/1) — `1f87cf1e` |
| v0.2 | Supabase Marketplace integration + auto-migrations + UI shell with nav | MERGED | #002 (2026-05-17) | [#3](https://github.com/stone2000ca/tay/pull/3) — `1bcf341e` |
| v0.3 | Voice calibration — paste 5 emails, extract rubric, save to DB | MERGED | #003 (2026-05-17) | [#5](https://github.com/stone2000ca/tay/pull/5) — `27840442` |
| v0.4 | Drafter v1 — type a prospect's name + company → generated draft | MERGED | #004 (2026-05-17) | [#7](https://github.com/stone2000ca/tay/pull/7) — `d445d7c0` |
| v0.5 | Judge v1 — 4-way decision over drafts | MERGED | #005 (2026-05-17) | [#9](https://github.com/stone2000ca/tay/pull/9) — `d0aab4d1` |
| v0.6 | Audit log v1 — every draft + decision logged with hash chain | NOT_STARTED | — | — |
| v0.7 | Gmail OAuth + send path | NOT_STARTED | — | — |
| v0.8 | Suppression list + unsubscribe handling | NOT_STARTED | — | — |
| v0.9 | Reply handler — inbound webhook + threaded LLM | NOT_STARTED | — | — |
| v1.0 | JOURNEYS eval suite green; trust-tier promotion live | NOT_STARTED | — | — |

## Strategic pivots logged

- **2026-05-17 (run #003):** LLM provider changed from Anthropic direct to OpenRouter (unified gateway, OpenAI-API-compatible). `lib/anthropic.ts` deleted; `@anthropic-ai/sdk` removed from package.json. Setup wizard now collects an `sk-or-` key.

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
