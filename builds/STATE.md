# Tay Build — Current State

**Last updated:** 2026-05-17 (Run #011)
**Status:** ✅ **v1.1.1 merged. Continuing v1.x simplification arc.**
**Roadmap progress:** v0.x complete (11/11); v1.1.1 merged (1/5 of v1.1 milestones).

## Currently in flight

(None — run #011 closed cleanly.)

## Next up — v1.1.2

Per `simplification-plan.md` (v3), v1.1.2 ships **SMTP send (Easy mode)** so non-tech users on personal Gmail can connect with a 2-step App Password instead of the 20-step Google Cloud OAuth flow. Reply polling for SMTP mode is split out to v1.1.2.5 (interim banner makes the limitation visible). All seven Tay gates still apply.

**Scope:**
- Wizard mailbox step: Easy (SMTP App Password) or Power (Google OAuth, existing path). Default = Easy.
- SMTP path: paste sender email + App Password → SMTP STARTTLS handshake → store credentials encrypted (existing crypto layer)
- `lib/send/smtp.ts` via `nodemailer`; `mailbox_credentials` table with `kind: "oauth" | "app_password"`
- `lib/send/orchestrate.ts` becomes channel-aware (Gates E/F/I unaffected by transport)
- Interim banner in `/queue` and `/replies`: "Reply polling activates in v1.1.2.5"
- Auto-detect App Password availability via STARTTLS handshake; if rejected with auth error, suggest Power mode with linked guide (App Password deprecation defense)

See `simplification-plan.md` P3a section for full spec.

## v1.x roadmap (from simplification-plan.md v3)

| Milestone | Status | Bundles | PR |
|---|---|---|---|
| v1.1.1 | MERGED #011 | P1 secrets foundation + P2 multi-provider LLM + VERCEL_URL | [#22](https://github.com/stone2000ca/tay/pull/22) — `ad39d163` |
| v1.1.2 | NOT_STARTED | P3a SMTP send (Easy mode) + interim banner | — |
| v1.1.2.5 | NOT_STARTED | P3b IMAP polling for SMTP mode | — |
| v1.1.3 | NOT_STARTED | P4 rubric preview + P5 voice cal paths + P6 test-send & prospect quick-add | — |
| v1.1.4 | NOT_STARTED | P7 reply notifications | — |

After v1.1.4: install path is Vercel Deploy → Wizard (LLM key → mailbox → voice → test-send → first prospect) → done. ~10 min, zero terminal, zero Google Cloud Console (Easy mode).

## v0.x merged (unchanged from v1.0 ship gate)

| Version | Description | PR | Squash commit |
|---|---|---|---|
| v0.0.1 | Scaffold — Next.js 16 + Deploy button + health route | (bootstrap) | `224b024` |
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

## Tay gates at v1.1.1 (all locked in by JOURNEYS regression contract)

Unchanged from v1.0 — async crypto refactor preserves all 7 gates:
- B (no special-category data): schema + classifier prompt + judge enforcement
- C (AI disclosure footer): `withDisclosure` + judge verification
- D (voice rubric enforcement): rubric in drafter system prompt as binding constraint
- E (suppression respect on send): `isSuppressed` safe-default TRUE; called BEFORE Gmail/SMTP API
- F (audit log on Tier-3): sha256 hash chain over every Tier-3 action; verifier endpoint
- H (adversarial-input defenses): six stacked defenses across drafter/judge/classifier
- I (trust-tier writes): `recordTrustEvent` on every Tier-3 outcome; tier-promotion ladder

## Open known limitations (carried)

### Live verification gaps
- No real Supabase project provisioned → migrations 0001–0011 untested live
- No real LLM key (OpenRouter / Anthropic / OpenAI) in env (OpenRouter key in `.env.local` from earlier session can smoke-test the OpenRouter branch only)
- No real Google OAuth client → Gmail send + poll never end-to-end exercised
- No real `CRON_SECRET` (Vercel auto-sets at deploy time; not exercised locally)
- **First user install via Vercel Marketplace + a real LLM provider + Google OAuth setup IS the live smoke test.**

### v1.x polish targets (non-blocking)
- Hash domain separator (from v0.6 judge)
- AuditVerifyResult shape (from v0.6 judge)
- Synthesized email edge cases (from v0.4 judge)
- Race-safety test for `ensureSalt` only covers in-process Promise cache, not inter-instance DB race (from v1.1.1 judge; production code is correct, just under-tested)
- Anthropic-direct `chatComplete` silently drops `response_format: json_object` — mitigated by system-prompt suffix injection AND by all current callers having "Output ONLY JSON" in their prompts; future callers without that instruction would regress (from v1.1.1 judge fix-pass)

### Process improvements logged across the build (for v1.x)
1. Agent prompt MUST enforce "git status clean before declaring COMPLETE" — missed twice in v0.x; held in v1.1.1
2. Orchestrator should commit/push IN_PROGRESS checkpoints before spawning the agent (so judge can read from agent worktree)
3. JOURNEYS scenarios must import + call the production code they claim to exercise (caught in v1.0; not repeated since)
4. For load-bearing crypto modules: require negative-path test matrix in agent self-report
5. For single-row tables: always use `lock_col UNIQUE DEFAULT 1` + deterministic SINGLE_ROW_ID upsert
6. Orchestrator always passes `--repo <owner/repo>` to `gh pr merge` to avoid local-checkout abort
7. **NEW from v1.1.1:** "v0.x → vN.x upgrade matrix" review step for any milestone that changes how a user-managed secret or env var is read

## Strategic pivots logged

- **2026-05-17 (run #003):** LLM provider changed from Anthropic direct → OpenRouter (unified gateway)
- **2026-05-17 (run #011):** Multi-provider LLM keys (Anthropic + OpenAI + OpenRouter, prefix-detect); secrets moved from user-set env vars → Supabase (wizard-collected or HKDF-derived)

## Status legend

**Pre-work:** `NOT_STARTED`
**In-flight (cleared at end of every run):** `IN_FLIGHT`, `PARTIAL`, `INTERRUPTED`
**Review:** `IN_REVIEW`, `NEEDS_FIXES`, `BLOCKED`
**Commit pipeline:** `APPROVED_NOT_COMMITTED`, `PR_CREATED`, `PREVIEW_FAILED`
**Terminal:** `MERGED`

See [skills/tay-build/SKILL.md](../skills/tay-build/SKILL.md) Phase 6 + 1.5 for recovery semantics.
