# STATE.md template

Live state pointer for the Tay v0.x build. Always reflects "where are we right now."

---

# Tay Build — Current State

**Last updated:** YYYY-MM-DD (Run #NNN)
**Current milestone:** v<VERSION> (<description>)
**Roadmap progress:** X/10 milestones merged

## Currently in flight

(Either a description of an in-flight agent + worktree, OR "None")

## Next up

The next v0.x milestone in the PLAN roadmap with all prior milestones MERGED.

- v<VERSION>: <one-line description from PLAN.md>

## Blocked / awaiting input

(List anything blocking the next milestone — e.g., user needs to paste an OAuth credential, decide on a config default, etc. Empty if nothing.)

## Recent learnings

(Max 5 — older roll to run-log.md)

- <learning 1>

## Files most recently touched

- <path>

## Milestone map (synced from PLAN.md roadmap)

| Version | Description | Status | Run merged | PR |
|---|---|---|---|---|
| v0.0.1 | Scaffold | MERGED | (bootstrap) | (no PR; root commit) |
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

**Pre-work:**
- `NOT_STARTED` — not yet picked up by any run

**In-flight (cleared at end of every run):**
- `IN_FLIGHT` — agent currently working
- `PARTIAL` — agent returned but didn't finish; cell notes what's missing
- `INTERRUPTED` — run ended mid-work; resume next run

**Review:**
- `IN_REVIEW` — passed agent self-test, awaiting judge
- `NEEDS_FIXES` — judge found issues, fix agent spawned
- `BLOCKED` — judge rejected after retries; cell notes why; worktree preserved

**Commit pipeline:**
- `APPROVED_NOT_COMMITTED` — judge approved, gh PR not yet attempted
- `PR_CREATED` — gh pr create succeeded, awaiting merge
- `PREVIEW_FAILED` — push or PR-create or merge failed; resume from retry

**Terminal:**
- `MERGED` — PR landed (commit hash + URL captured)

## Recovery semantics

| State at end of run | Next run does |
|---|---|
| `INTERRUPTED` | Re-spawn agent same scope; agent picks up from partial work in preserved worktree |
| `IN_REVIEW` | Re-run judge only |
| `NEEDS_FIXES` | Spawn fix agent in same worktree, re-judge |
| `BLOCKED` | Re-appear in "next up" with judge feedback; new agent reads feedback before starting |
| `APPROVED_NOT_COMMITTED` | Skip engineering + judge, go to gh PR flow |
| `PR_CREATED` | Verify merge via `gh pr view <URL> --json state`; update to MERGED |
| `PREVIEW_FAILED` | Read failure classification from checkpoint; retry per the classification |

## v1.0 ship gate

When v1.0 is MERGED + JOURNEYS eval suite is green + trust-tier promotion verified live:
- /tay-build will surface "v1.0 complete. Awaiting user kickoff for post-1.0 work."
- Wait for explicit user direction
