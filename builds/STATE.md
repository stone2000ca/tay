# Tay Build — Current State

**Last updated:** 2026-05-18 (Run #015)
**Status:** ✅ **v1.1 FEATURE-COMPLETE — non-tech-user simplification arc done**
**Roadmap progress:** v0.x complete (11/11) + v1.1 complete (5/5) = **16 milestones merged across 15 runs**

## Currently in flight

(None — run #015 closed cleanly. v1.1 cycle done. Awaiting user direction for post-1.1 work.)

## v1.1 ship-gate triggered

After v1.1.4 merge, the simplification-plan.md v3 is fully implemented. Per the SKILL.md ship-gate pattern: the next `/tay-build` invocation should surface this status and wait for explicit user direction. Tay does not auto-start post-1.1 work.

**The non-tech-user install path is now:** Vercel Deploy → wizard (LLM key → mailbox → voice → rubric preview → sample draft → test-send → first prospect) → done. **~10 minutes, zero terminal commands, zero Google Cloud Console for Easy-mode users.**

## v1.1 merged milestones

| Milestone | Description | Run | Process / Product | PR | Squash |
|---|---|---|---|---|---|
| v1.1.1 | Secrets foundation + multi-provider LLM + VERCEL_URL | #011 | 4/4 (1 fix-pass) | [#22](https://github.com/stone2000ca/tay/pull/22) | `ad39d163` |
| v1.1.2 | SMTP send (Easy mode) + channel-aware orchestrator | #012 | 4/4 (1 fix-pass) | [#24](https://github.com/stone2000ca/tay/pull/24) | `92049d35` |
| v1.1.2.5 | IMAP reply polling for SMTP mode | #013 | 5/5 (clean) | [#26](https://github.com/stone2000ca/tay/pull/26) | `e3b8168b` |
| v1.1.3 | Wizard polish (rubric preview + 4 voice paths + test-send + prospect quick-add) | #014 | 5/5 (clean) | [#27](https://github.com/stone2000ca/tay/pull/27) | `2a300f10` |
| v1.1.4 | Reply notifications + v1.1.3 carry-forwards | #015 | 5/5 (clean) | [#28](https://github.com/stone2000ca/tay/pull/28) | `6953633d` |

**Trend:** 3 consecutive clean first-pass APPROVALs after the v1.1.1/v1.1.2 fix-pass rounds. Foundation work was harder (secrets crypto + channel-aware orchestrator forced design decisions); composition work was smoother (each subsequent milestone built on stable abstractions).

## v0.x merged (unchanged from v1.0 ship gate)

| Version | Description | PR | Squash commit |
|---|---|---|---|
| v0.0.1 | Scaffold | (bootstrap) | `224b024` |
| v0.1 | Setup wizard step 1 | [#1](https://github.com/stone2000ca/tay/pull/1) | `1f87cf1e` |
| v0.2 | Supabase Marketplace + auto-migrations + UI shell | [#3](https://github.com/stone2000ca/tay/pull/3) | `1bcf341e` |
| v0.3 | Voice calibration + LLM pivot to OpenRouter | [#5](https://github.com/stone2000ca/tay/pull/5) | `27840442` |
| v0.4 | Drafter v1 | [#7](https://github.com/stone2000ca/tay/pull/7) | `d445d7c0` |
| v0.5 | Judge v1 + audit stub | [#9](https://github.com/stone2000ca/tay/pull/9) | `d0aab4d1` |
| v0.6 | Audit log v1 — sha256 hash chain | [#11](https://github.com/stone2000ca/tay/pull/11) | `39f5c93d` |
| v0.7 | Gmail OAuth + send path | [#13](https://github.com/stone2000ca/tay/pull/13) | `d839b071` |
| v0.8 | Suppression list + unsubscribe | [#15](https://github.com/stone2000ca/tay/pull/15) | `85f591a9` |
| v0.9 | Reply handler + classifier + auto-draft | [#17](https://github.com/stone2000ca/tay/pull/17) | `b1e24da7` |
| v1.0 | SHIP GATE — JOURNEYS + trust-tier | [#19](https://github.com/stone2000ca/tay/pull/19) | `cc2d374a` |

## Tay gates at v1.1 (all 7 locked in by JOURNEYS regression contract)

Unchanged from v1.0 — every v1.1 milestone preserved all 7 gates:
- **B** (no special-category data): schemas + classifier prompts + judge enforcement; URL-bootstrap + prospect-extract system prompts forbid demographic inference
- **C** (AI disclosure footer): `withDisclosure` + judge verification; sample-draft preview shows it visibly; notification dispatch documents intentional bypass for operator-bound sends
- **D** (voice rubric enforcement): rubric is v0.4 drafter contract; all 4 v1.1.3 voice paths produce `parseRubric`-valid output; `parseRubric` silently strips hallucinated fields from URL-bootstrap
- **E** (suppression respect on send): `isSuppressed` safe-default TRUE; called BEFORE channel branch in orchestrator (verified by gate-ordering tests for BOTH OAuth and SMTP paths); notification self-send bypass documented
- **F** (audit log on Tier-3): sha256 hash chain; v1.1.4 added `reply.notified` + `notifications.configured`; v1.1.3 added `voice.calibrated` + `setup.completed`; v1.1.2 added `mailbox.connected`/`disconnected`
- **H** (adversarial-input defenses): six stacked defenses preserved across all v1.1 work; reply body NEVER in notification payload; webhook URLs never echoed; URL-bootstrap content + free-form descriptions + IMAP body all `<untrusted_source>`-wrapped
- **I** (trust-tier writes): `recordTrustEvent` on every Tier-3 outcome; channel-tagged through orchestrator

## Open known limitations

### Live verification gaps (carried throughout v0.x and v1.x)
- No real Supabase project provisioned → migrations 0001–0015 (15 total) untested live
- No real LLM key (OpenRouter / Anthropic / OpenAI) — OpenRouter key in `.env.local` (from earlier session) smoke-tests the OpenRouter branch only
- No real Google OAuth client → Gmail send/poll never end-to-end exercised
- No real Gmail App Password → SMTP path mock-only
- No real IMAP server → IMAP polling mock-only
- No real Slack webhook URL → Slack notification dispatch mock-only
- No real `CRON_SECRET` (Vercel auto-sets at deploy time; not exercised locally)
- **First user install via Vercel Marketplace + real LLM + real mailbox IS the live smoke test for the full pipeline.**

### Non-blocking carry-forwards (suitable for post-1.1 work)
- Hash domain separator (from v0.6 judge) — currently safe-by-coincidence
- AuditVerifyResult shape (from v0.6 judge) — cosmetic
- Synthesized email edge cases (from v0.4 judge) — partial fix in v1.1.3 (real-email override); remaining synthesizer issues cosmetic since `.invalid` never routes
- `ensureSalt` inter-instance race only documented (in-process Promise cache test only) — production code is correct, just under-tested at the DB-race level
- Anthropic-direct `chatComplete` drops `response_format: json_object` — mitigated by system-prompt suffix injection AND all current callers having "Output ONLY JSON" in their prompts (v1.1.1 judge note)
- `sanitizeFromAddress` JSDoc claims U+007F (DEL) stripped but regex only covers U+0000–U+001F — doc/code drift only; CRLF (the actual injection vector) IS stripped (v1.1.4 judge note)

### Process improvements logged (for post-1.1 work)
1. Agent prompt enforces "git status clean before COMPLETE" — held since run #009 onward
2. Orchestrator commits IN_PROGRESS to a branch before spawning agent (so judge can read from agent worktree) — sometimes skipped; agent prompts have embedded spec as fallback
3. JOURNEYS scenarios must call the production code they claim to exercise — caught in run #010, not repeated since
4. Load-bearing crypto modules: negative-path test matrix in agent self-report
5. Single-row tables: always `lock_col UNIQUE DEFAULT 1` + deterministic SINGLE_ROW_ID upsert (followed since v1.0)
6. `gh pr merge --repo` always-on (followed since run #003)
7. v0.x → vN.x upgrade matrix review (caught the v1.1.1 CRON_SECRET issue)
8. Channel-aware abstractions: grep for every consumer of legacy signals (caught the v1.1.2 `/queue` blocker)
9. Wizard milestones: mental walk-through as brand-new user end-to-end (added in v1.1.2 judge)
10. Sanitizer-utility comment-vs-code review loop (added in v1.1.4 judge)

## Strategic pivots logged

- **2026-05-17 (run #003):** LLM provider Anthropic direct → OpenRouter (unified gateway)
- **2026-05-17 (run #011):** Multi-provider LLM keys (prefix-detect Anthropic/OpenAI/OpenRouter); secrets moved from user-set env vars → Supabase (wizard-collected or HKDF-derived)
- **2026-05-17 (run #012):** Mailbox channel-aware (Gmail OAuth + SMTP App Password); `lib/send/orchestrate.ts` chokepoint preserved; suppression check BEFORE channel branch
- **2026-05-18 (run #015):** v1.1 simplification arc complete. Install path is ~10 min, zero terminal, zero Google Cloud Console for Easy-mode users.

## Total v0.x + v1.x stats

| Metric | Total |
|---|---|
| Milestones merged | 16 (v0.0.1 + v0.1–v0.9 + v1.0 + v1.1.1 + v1.1.2 + v1.1.2.5 + v1.1.3 + v1.1.4) |
| Runs | 15 (one per milestone; run #003 folded LLM pivot + v0.3) |
| Unit tests | 586 |
| Journey tests | 10 (regression contract for v1.x+) |
| Migrations | 15 (0001 through 0015) |
| PRs shipped | 28 (15 feature PRs + 13 orchestrator checkpoint PRs) |
| NEEDS-FIXES rounds | 3 (v1.0 SHIP GATE; v1.1.1 CRON_SECRET design; v1.1.2 `/queue` half-migration) |
| Clean first-pass APPROVALs | 12 of 15 |

## Recommended next steps (for the user)

### Path A — Ship for real
1. Provision Supabase via Vercel Marketplace
2. Deploy to Vercel
3. Walk the wizard: LLM key → mailbox (Easy = App Password OR Power = OAuth) → voice (pick one of 4 paths) → rubric preview → sample draft → test-send to self → first prospect via natural language
4. If round-trip works: tag `v1.1.0` and announce
5. Optional: provision a real Anthropic / OpenAI key alongside OpenRouter to smoke-test those direct-provider paths

### Path B — First-user dogfood
- Same as A but against 3-5 of user's own warm-but-stalled prospects
- Watch the trust-tier system promote (or not) based on real bounce/complaint signals
- Fix any first-real-install friction in a v1.1.5 patch
- Then ship publicly

### Path C — Post-v1.1 features
- Pub/Sub push for OAuth mode (replaces 5-min polling cadence with realtime)
- Booking flow (out of v0.x/v1.x scope per PLAN.md)
- Vercel Env Var API integration (would let Tay write env vars to user's Vercel project — eliminates the few remaining marketplace-managed env reads)
- Address the non-blocking carry-forwards above (hash domain separator; AuditVerifyResult shape cleanup; etc.)

## Post-v1.1 ship-gate semantics

After this STATE update, `/tay-build` (no args) will:
1. Read STATE.md (this file)
2. See "v1.1 FEATURE-COMPLETE — awaiting user direction"
3. Surface the merged-milestone summary + open limitations + recommended next steps
4. Stop. Do NOT auto-start post-1.1 work.

User must give explicit direction (e.g. `/tay-build v1.2`, or a new milestone description) to continue.

## Status legend (preserved)

**Pre-work:** `NOT_STARTED`
**In-flight (cleared at end of every run):** `IN_FLIGHT`, `PARTIAL`, `INTERRUPTED`
**Review:** `IN_REVIEW`, `NEEDS_FIXES`, `BLOCKED`
**Commit pipeline:** `APPROVED_NOT_COMMITTED`, `PR_CREATED`, `PREVIEW_FAILED`
**Terminal:** `MERGED`

See [skills/tay-build/SKILL.md](../skills/tay-build/SKILL.md) Phase 6 + 1.5 for recovery semantics.
