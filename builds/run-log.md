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

## Run #002 — (not yet started)

Next invocation of `/tay-build` (without args) will pick up v0.2 (Supabase Marketplace integration + auto-migrations + UI shell with nav). Recommended to address the three escalations above first; otherwise next run will inherit them.
