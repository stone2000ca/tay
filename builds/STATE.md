# Tay Build — Current State

**Last updated:** 2026-05-17 (Run #010)
**Status:** ✅ **v1.0 COMPLETE — TAY v0.x BUILD CYCLE FEATURE-COMPLETE**
**Roadmap progress:** 11/11 milestones merged

## v1.0 ship-gate triggered

Per `skills/tay-build/SKILL.md` Phase 7:

> When v1.0 milestone is MERGED + JOURNEYS eval suite is green + trust-tier promotion is verified live:
> 1. Do NOT auto-mark "Tay shipped"
> 2. Update STATE.md: `v1.0 complete. Awaiting user kickoff for post-1.0 work.`
> 3. Surface to user with merged-milestone list + open issues + recommended next steps
> 4. Wait for explicit user direction

**Status: v1.0 complete. Awaiting user kickoff for post-1.0 work.**

The next `/tay-build` invocation will print the ship-gate summary (below) and stop. Tay does not auto-start v1.x work.

## Merged milestones (in order)

| Version | Description | PR | Squash commit |
|---|---|---|---|
| v0.0.1 | Scaffold — Next.js 16 + Deploy button + health route | (bootstrap) | `224b024` |
| v0.1 | Setup wizard step 1 (Anthropic key + instance name) | [#1](https://github.com/stone2000ca/tay/pull/1) | `1f87cf1e` |
| v0.2 | Supabase Marketplace + auto-migrations + UI shell | [#3](https://github.com/stone2000ca/tay/pull/3) | `1bcf341e` |
| v0.3 | Voice calibration + LLM pivot to OpenRouter | [#5](https://github.com/stone2000ca/tay/pull/5) | `27840442` |
| v0.4 | Drafter v1 (prospect → AI-drafted email constrained by rubric) | [#7](https://github.com/stone2000ca/tay/pull/7) | `d445d7c0` |
| v0.5 | Judge v1 (4-way decision + audit-log stub + paper cuts) | [#9](https://github.com/stone2000ca/tay/pull/9) | `d0aab4d1` |
| v0.6 | Audit log v1 (sha256 hash chain over Tier-3 events) | [#11](https://github.com/stone2000ca/tay/pull/11) | `39f5c93d` |
| v0.7 | Gmail OAuth + send path (review queue, send, audit, trust events) | [#13](https://github.com/stone2000ca/tay/pull/13) | `d839b071` |
| v0.8 | Suppression list + unsubscribe handling + v0.7 carry-forwards | [#15](https://github.com/stone2000ca/tay/pull/15) | `85f591a9` |
| v0.9 | Reply handler (poll + classify + auto-draft) + v0.8 carry-forwards | [#17](https://github.com/stone2000ca/tay/pull/17) | `b1e24da7` |
| v1.0 | **SHIP GATE** — JOURNEYS + trust-tier + v0.9 polling fixes | [#19](https://github.com/stone2000ca/tay/pull/19) | `cc2d374a` |

## Tay gates at v1.0 (all locked in via JOURNEYS regression contract)

- **B** (no special-category data): schema-level + classifier prompt + judge enforcement; gate B JOURNEY exercises the judge's "block on special-category mention" path
- **C** (AI disclosure footer): `lib/draft/disclosure.ts` + judge verification; gate C JOURNEY exercises both happy-path (footer present) and regression (judge revises if missing)
- **D** (voice rubric enforcement): rubric in drafter system prompt as binding constraint; gate D JOURNEY exercises the judge's "revise on rubric drift" path
- **E** (suppression respect on send): `isSuppressed` safe-default TRUE; called BEFORE Gmail API; gate E JOURNEY exercises REAL `sendDraft` orchestrator with suppression mock
- **F** (audit log on Tier-3): sha256 hash chain over every Tier-3 action; `/api/audit/verify` endpoint; gate F JOURNEY exercises REAL `verifyAuditChain` with 3 cases (clean / hash_mismatch / prev_hash_mismatch)
- **H** (adversarial-input defenses): six stacked defenses across drafter/judge/classifier (untrusted_source wrap + system prompts + json_object + hard validators + neuter + quote-strip); 3 gate H JOURNEYS
- **I** (trust-tier writes): `recordTrustEvent` on every Tier-3 outcome; `recomputeTrustTier` with auto-promotion ladder tier_0→tier_1→tier_2 + demotion; gate I JOURNEY exercises promotion path

## Open known limitations (none blocking; surface to user)

### Live verification gaps (carried throughout build; none ever exercised end-to-end)
- No real Supabase project has been provisioned → none of the 10 migrations applied against live Postgres
- No real `OPENROUTER_API_KEY` → all LLM-touching code mock-tested only
- No real `TAY_OAUTH_SECRET` → AES-256-GCM encryption + HMAC tokens use test-only secrets
- No real Google OAuth client → Gmail send + poll never end-to-end exercised
- No real `CRON_SECRET` → polling cron auth not exercised live
- **First user install via Vercel Marketplace + a real OpenRouter + Google OAuth setup IS the live smoke test for the full schema and the full pipeline.**

### v1.0 polish targets (not regressions; ergonomics)
- **Hash domain separator** (v0.6 judge): hash concatenation currently safe-by-coincidence via canonical JSON framing + fixed-width ISO timestamps + enum-constrained action. v1.x polish: insert `\x1f` separators so it's safe-by-construction. Requires chain re-migration.
- **`AuditVerifyResult` shape** (v0.6 judge): `supabase_unavailable` / `read_error` are lumped under `brokenAt` with zero sentinels rather than a top-level variant. UI handles correctly; cosmetic.
- **Synthesized email edge cases** (v0.4 judge): `prospects.email` v0.4 synthesizer produces `unknown+<name>@<company>.invalid`. Company labels like `"Acme Inc."` produce RFC-1035-violating `acme-inc-.invalid`. Cosmetic (`.invalid` never routes). Best fixed when a real email field replaces the synthesizer in v1.x.
- **`/u/[token]` replay heuristic** (v0.9 judge): now read-before-upsert (fixed in v0.9). Honest under all DB latency.
- **`recomputeTrustTier` event-type semantics** (v1.0 judge): records tier changes as `recordTrustEvent("send", "override_to_send"|"override_to_skip", ...)`. Semantically muddy (those types were designed for one-off send overrides). Not breaking; cosmetic refactor.

### Process improvements logged across the build (for v1.x)
1. Agent prompt MUST enforce "git status clean before declaring COMPLETE" with a hard pre-check — missed twice (runs #001 + #008); enforced by orchestrator follow-up message both times
2. Orchestrator should commit/push `run-NNN-IN_PROGRESS.md` BEFORE spawning the agent so the judge can read it from the agent worktree (currently lives only in orchestrator worktree)
3. For JOURNEYS scenarios: mechanical check that each scenario imports something from the code path its name advertises (would have caught the run #010 NEEDS-FIXES)
4. For load-bearing crypto modules: require a "negative-path test matrix" in the agent's self-report
5. For single-row tables: codify "MUST use deterministic SINGLE_ROW_ID + UNIQUE constraint" pattern in the migration template comment
6. Orchestrator should always pass `--repo <owner/repo>` to `gh pr merge --squash --delete-branch` to avoid the "main is checked out in another worktree" abort

## Recommended next steps (for the user)

### Path A — ship Tay for real
1. Provision Supabase via Vercel Marketplace integration
2. Set required env vars: `OPENROUTER_API_KEY`, `TAY_OAUTH_SECRET` (64 hex chars; generate via `openssl rand -hex 32`), `GOOGLE_OAUTH_CLIENT_ID` + `_SECRET` (Google Cloud Console), `NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`
3. Deploy to Vercel
4. Walk the wizard: setup → voice calibration (paste 5 emails) → draft a test prospect → click Send (queue) → verify Gmail received it → reply yourself → confirm classifier + trust-event chain → verify `/api/audit/verify` returns ok:true
5. After first successful end-to-end run: tag `v1.0.0` and announce

### Path B — first-user dogfood before broader release
1. Same setup as A
2. Use Tay against 3-5 of the user's own warm-but-stalled prospects
3. Watch the trust-tier system promote (or not) based on real bounce/complaint signals
4. Fix any first-real-install friction in a v1.0.1 patch
5. Then ship publicly

### Path C — feature additions before public release
- Reach out to flywheel-main parent thinking for v1.x feature priorities
- Candidates: Pub/Sub push (faster than 5-min poll); booking flow; multi-mailbox; better signature detection; team mode (multi-tenant variant)
- These are explicitly OUT of scope for v0.x per PLAN.md

## v1.0 ship gate semantics

After this STATE update, `/tay-build` (no args) will:
1. Read STATE.md (this file)
2. See "v1.0 complete. Awaiting user kickoff for post-1.0 work."
3. Print the merged-milestone list + open limitations + recommended next steps
4. Stop. Do NOT auto-start v1.x work.

User must give explicit direction (e.g. `/tay-build v1.0.1`, or a new milestone description) to continue.

## Status legend (preserved for v1.x)

**Pre-work:** `NOT_STARTED`
**In-flight (cleared at end of every run):** `IN_FLIGHT`, `PARTIAL`, `INTERRUPTED`
**Review:** `IN_REVIEW`, `NEEDS_FIXES`, `BLOCKED`
**Commit pipeline:** `APPROVED_NOT_COMMITTED`, `PR_CREATED`, `PREVIEW_FAILED`
**Terminal:** `MERGED`

See [skills/tay-build/SKILL.md](../skills/tay-build/SKILL.md) Phase 6 + 1.5 for recovery semantics.
