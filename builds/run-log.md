# Tay Build — Run Log

Append-only history of every /tay-build invocation. Each run gets one screen with:
- Run #, date, duration
- Milestone touched (status transition)
- Judge scores (process / product)
- Notable events (BLOCKED, PREVIEW_FAILED, escalations)
- Pointer to detailed checkpoint at `checkpoints/run-NNN-YYYY-MM-DD.md`

---

## Run #001 — 2026-05-13 (~20 min)

**Milestone:** v0.1 — setup wizard step 1 (Anthropic key + instance name)
**Status transition:** NOT_STARTED → MERGED
**PR:** [#1](https://github.com/stone2000ca/tay/pull/1) — squashed as `1f87cf1e`
**Judge:** Process 4/5, Product 4/5 — APPROVED, no fix-pass needed.

### What landed
- `/setup` route with form (key + name), server action calling `claude-haiku-4-5-20251001` to validate the key
- `lib/app-config.ts` cookie-backed storage abstraction (designed for v0.2 swap to Supabase)
- `lib/anthropic.ts` SDK wrapper with discriminated-union error mapping
- `app/page.tsx` first-run redirect to `/setup` when not configured
- `vitest` added; 4 tests passing on the cookie store
- API key never persisted — only sent to Anthropic for validation

### Notable
- Agent did NOT commit before reporting COMPLETE — orchestrator committed in Phase 5. Process-improvement-1 for next run: bake "git status clean" into agent self-test.
- No live Anthropic smoke test (no `ANTHROPIC_API_KEY` in orchestrator env). Static evidence only.
- `gh pr merge --delete-branch` aborted on local-checkout (main is checked out elsewhere); merge succeeded server-side; remote branch deleted manually.

### Escalations to user (open before next run)
1. `next lint` is dead in Next 16 — pick eslint / Biome / drop
2. Cookie `secure: true` breaks localhost dev — relax to NODE_ENV-gated
3. Add `ANTHROPIC_API_KEY` to orchestrator `.env.local` before LLM-touching milestones (v0.3+)

### Detailed checkpoint
`builds/checkpoints/run-001-2026-05-13.md`

---

## Run #002 — 2026-05-17 (~19 min)

**Milestone:** v0.2 — Supabase Marketplace integration + auto-migrations + UI shell with nav
**Status transition:** NOT_STARTED → MERGED
**PR:** [#3](https://github.com/stone2000ca/tay/pull/3) — squashed as `1bcf341e`
**Judge:** Process 4/5, Product 4/5 — APPROVED with one in-PR fix (cold-start race on `/setup` POST).

### What landed
- `@supabase/supabase-js` + `pg` + `@types/pg` deps; lazy server/anon client factories in `lib/supabase/`
- First migration `lib/supabase/migrations/0001_init.sql`: `app_config`, `prospects`, `audit_log` (with `prev_hash`/`this_hash` columns ready for the v0.6 hash chain); all CREATEs idempotent; pgcrypto extension declared
- `lib/supabase/migrate.ts` — `ensureSchema()` with module-scoped Promise cache, info-schema pre-check, transaction-wrapped DDL, inline-SQL fallback against Turbopack bundling quirks; never throws
- `lib/app-config.ts` refactored to dual backend: Supabase when env present, cookie fallback otherwise; cookie `secure` flag now NODE_ENV-gated (resolves run #001 dev-loop bug)
- `components/nav.tsx` mounted in root layout (Dashboard / Setup / Settings); suppressed on `/setup` for clean first-run UX
- `app/settings/page.tsx` placeholder so the nav link resolves
- `app/page.tsx` calls `ensureSchema()`; `app/setup/actions.ts` also calls it before first write (closes cold-start race)
- Dropped dead `next lint` script (resolves run #001 escalation)
- 11/11 tests passing (8 app-config + 3 migrate)

### Notable
- Judge spotted a cold-start race on `/setup` POST that the agent missed — first wizard submit on a fresh Vercel function instance would have thrown "relation does not exist." Fix landed in-PR as `9c5786e`.
- No real Supabase project linked → migration's live path (TLS connect + DDL on actual cluster) never exercised. Unit tests cover skip + cache memoization only. Inline-SQL + transactional + idempotent mitigations in place; first user install is the live smoke test.
- `gh pr merge --delete-branch` aborted on local-checkout again (same root as run #001: `main` is checked out in parent worktree). Merge succeeded server-side; remote branch deleted manually.

### Escalations to user (open before next run)
1. **Add `ANTHROPIC_API_KEY` to orchestrator env before run #003** — v0.3 voice calibration is LLM-touching and needs live smoke evidence. This was deferred on run #001 and again on run #002; v0.3 makes it load-bearing.
2. (Optional) **Live Supabase smoke test** — 5-minute Marketplace integration on the live Vercel project would exercise `migrate.ts` end-to-end before first customer install.
3. (Still open) **Vercel project linking** — would unlock preview URLs in PR comments.

### Detailed checkpoint
`builds/checkpoints/run-002-2026-05-17.md`

---

## Run #003 — (not yet started)

Next invocation of `/tay-build` (without args) will pick up v0.3 (Voice calibration — paste 5 emails, extract rubric, save to DB). v0.3 is the first LLM-touching milestone post-scaffold and will REQUIRE `ANTHROPIC_API_KEY` in env for the extractor smoke test. Address the three escalations above first or accept mocked-only verification for the LLM seam.
