---
name: tay-build
description: Orchestrate one iteration of the Tay v0.x build. Reads current state, plans the run, spawns an implementation agent (or two parallel for sub-tasks), runs a judge for quality review, ships via gh PR flow, writes a session checkpoint.
---

# /tay-build — Flywheel orchestrator (single-tenant Tay)

You are running **one iteration of the Tay multi-session build**. Each invocation = one "run" that advances the work by one v0.x milestone, ships via PR, and writes a checkpoint the next run will read.

Tay is a **self-hosted single-tenant** AI BDR agent. Each install is owned by one person and runs on their own Vercel + Supabase + Anthropic. There is no Tay-the-platform. Brand-safety on the user's outbound = the load-bearing risk; the judge layer is non-negotiable.

Keywords: tay, tay-build, BDR agent, cold outbound, flywheel, agent build

Input: `$ARGUMENTS` (optional)
- Empty → pick up from `builds/STATE.md` (the next v0.x not yet shipped)
- A version (e.g., `v0.3`) → focus this run on that specific milestone
- `status` → read-only — print current state; does NOT acquire the run lock
- `dry-run` → run Phases 1, 1.5 (preflight only), and 2 (planning); print the planned agent prompt; **do not spawn agents, do not commit**
- `bootstrap` → first-run initialization (creates STATE.md from PLAN.md roadmap if missing)

## Skill runtime target

Claude Code CLI on Windows PowerShell (also runs on Bash via the Bash tool for POSIX scripts).

## Source of truth

Read these every run:

- **Plan:** [PLAN.md](../../PLAN.md) — what we're building, the v0.x → v1.0 roadmap, what was dropped vs the original multi-tenant SPEC
- **Parent thinking:** [flywheel-main/tay-flywheel/](https://github.com/stone2000ca/flywheel-main/tree/main/tay-flywheel) — the original discovery, compliance rationale, architecture write-up. Reference only; do not treat as binding spec for *this* repo.

Build state lives in `builds/`:
- `STATE.md` — current state pointer (always reflects "where are we right now")
- `run-log.md` — append-only history of every run
- `quality-log.md` — process + product scores per run
- `checkpoints/run-NNN-YYYY-MM-DD.md` — detailed per-run report

Supporting prompts:
- `judge-prompt.md` — the judge agent's persona for quality checks
- `state-template.md` — STATE.md structure
- `checkpoint-template.md` — checkpoint structure

## Phase 1 — Read state

Read in parallel via Read tool calls in a single message:

1. `builds/STATE.md`
2. `builds/run-log.md` (last 200 lines)
3. `PLAN.md` — roadmap table + the section for the next v0.x milestone
4. Most recent checkpoint in `builds/checkpoints/`

If `STATE.md` does not exist (or `$ARGUMENTS` is `bootstrap`):
- Bootstrap from PLAN roadmap — copy structure from `state-template.md`
- Mark v0.0.1 MERGED (the initial scaffold) and all later versions `NOT_STARTED`
- Skip to Phase 6

If `$ARGUMENTS` is `status`:
- Report current state to user verbatim from STATE.md
- Stop. Do not spawn agents, do not commit. Do not acquire the run lock.

## Phase 1.5 — Preflight + acquire run lock

**Fail early.**

### Preflight checks (PowerShell-friendly)

```powershell
git status --short          # expect empty
git branch --show-current   # expect main OR a feature branch
node --version              # expect v24.x.x
npm --version               # expect 10+
gh auth status              # expect "Logged in to github.com"
Test-Path node_modules      # expect $true
$env:ANTHROPIC_API_KEY      # expect non-empty for any LLM-touching milestone
```

Map failures to user-actionable remediation:
- Dirty git state → "Stash or commit uncommitted changes before running tay-build."
- Node mismatch → "Install Node 24 LTS."
- gh unauthenticated → "Run `gh auth login` before tay-build."
- Missing `node_modules` → "Run `npm install` first."
- Missing `ANTHROPIC_API_KEY` → "Add to `.env.local` (see .env.example) before running an LLM-touching milestone."

STOP on any failure.

### Orchestrator-owned files (agents are forbidden from editing)

- `builds/STATE.md`
- `builds/run-log.md`
- `builds/quality-log.md`
- `builds/checkpoints/*`
- `builds/.run-lock.json`

Enforced via agent prompt (Phase 3) + judge (Phase 4) flagging any agent diff touching them.

### Run lock

Check `builds/.run-lock.json`:

**If lock does NOT exist:** create it with:

```json
{
  "run_id": "NNN",
  "started_at": "YYYY-MM-DDTHH:MM:SSZ",
  "phase": "preflight",
  "current_milestone": null
}
```

**If lock EXISTS:** another run is in progress OR a prior run crashed.

1. Read the lock + the corresponding `run-NNN-IN_PROGRESS.md` checkpoint
2. Check lock age:
   - <2 hours: likely-still-running — STOP, surface to user
   - ≥2 hours: likely-crashed — surface options
   - ≥24 hours: orphaned (lean force-clear)
3. Surface to user with options:
   - **RESUME:** Read IN_PROGRESS checkpoint, restart from recorded phase
   - **FORCE-CLEAR:** Delete lock + IN_PROGRESS checkpoint after user confirmation
4. Wait for user decision

The lock is updated as the run progresses (`phase` field flips on each transition) and **deleted at the end of Phase 7**.

## Phase 2 — Plan this run

From the PLAN roadmap and current state:

1. **Eligible milestone** — the next v0.x in the roadmap with status `NOT_STARTED`. (Or the one specified in `$ARGUMENTS`.)

2. **Spawn count** — most v0.x milestones are small enough for **one agent**. Spawn two only if the milestone has two genuinely-parallel sub-tasks (e.g., "UI shell + Supabase migrations"). Hard cap: **2 implementation agents + 1 judge = 3 agents total per run**.

3. **Verify dependencies** — every v0.x depends on the prior version being merged. If skipping ahead (because `$ARGUMENTS` specified a later milestone), flag the dependency gap explicitly.

4. **State the plan** in 3-5 sentences before spawning. Example:

> Run #003 plan: spawning one agent for v0.3 (voice calibration — paste 5 emails, extract rubric, save to Supabase voice_calibration table). Depends on v0.2 (Supabase wired) which merged in run #002. No blockers. Judge will review against gates D (voice rubric) + F (audit) + the general 7 criteria.

### Write the IN_PROGRESS checkpoint (before spawning)

If the machine crashes mid-run, the next invocation must know what was assigned. Write `builds/checkpoints/run-NNN-IN_PROGRESS.md` containing:
- Full run plan
- Per-agent assignment + write-scope manifest
- Lock-file reference + start timestamp

Update lock file's `phase` from `preflight` → `agents_spawning`.

## Phase 3 — Spawn implementation agent(s)

Spawn 1-2 agents in a single message (true parallel if 2). Use `isolation: "worktree"` so each agent works on its own branch.

**Agent prompt template:**

```
You are implementing v<VERSION> of the Tay single-tenant installable build.

PARENT PLAN: PLAN.md (read the roadmap row for v<VERSION> + the architecture section)
ORIGINAL DISCOVERY (reference only — NOT binding for this repo): 
  https://github.com/stone2000ca/flywheel-main/tree/main/tay-flywheel

MILESTONE GOAL: <one-line from PLAN roadmap row>

DETAILED SCOPE (expand the one-liner into concrete deliverables):
- <Claude orchestrator fills this in based on the milestone + prior context>
- Must include: files to create/edit, acceptance criteria, test approach, rollback plan

WRITE-SCOPE MANIFEST: This milestone is expected to touch ONLY:
- <enumerated list — be specific>

If your work requires editing files outside this scope, STOP and report — do not silently expand scope.

ORCHESTRATOR-OWNED PATHS (NEVER touch):
- builds/STATE.md
- builds/run-log.md
- builds/quality-log.md
- builds/checkpoints/*
- builds/.run-lock.json

INSTRUCTIONS:
1. Implement exactly what the scope says — no scope additions
2. Self-test before declaring done:
   - `npm run typecheck`
   - `npm run build` (must pass)
   - `npm run lint` if applicable
   - For schema changes: write the migration; run it against the user's local Supabase if available, otherwise mark NEEDS-INPUT
   - For LLM-touching code: smoke test against `$env:ANTHROPIC_API_KEY`
3. Tay-specific gates (apply where relevant):
   - **No special-category data** — never collect race, religion, health, sexual orientation, political views, biometric/genetic data
   - **AI disclosure footer** — any code path producing a final draft MUST include the disclosure-mode lookup + footer-injection step
   - **Voice rubric enforcement** — any drafter change MUST honor the user's voice_calibration rubric
   - **Suppression check on send paths** — any code that hits Gmail send API MUST first call `isSuppressed(email)` and hard-block on true
   - **Audit log writes on Tier-3** — every send / book / reply-send MUST call `appendAudit(...)`
   - **Adversarial-input defenses** — researcher / classifier / drafter must wrap untrusted content in `<untrusted_source>` blocks + use structured-output schemas
   - **Trust-tier writes** — capability code completing a Tier-3 action MUST call `recordTrustEvent(capability, eventType, metadata)`
   - **Never log raw prospect emails or OAuth tokens** — hash or redact
4. Include a ROLLBACK PLAN in your report (how to undo this in 60 seconds): file revert list + prior commit reference; for schema PRs, down-migration SQL
5. Return a structured report:
   - Status: COMPLETE | NEEDS-INPUT | BLOCKED
   - Files added / modified (vs declared scope)
   - Acceptance criteria (each item with ✅ or ❌ + evidence)
   - Test results (typecheck / build / lint / smoke)
   - Tay-specific gates: each marked ✅ / ❌ / N/A
   - Rollback plan
   - Deviations from scope
   - Suggested commit message (Conventional Commits format)
   - Worktree path + branch name
```

Use `subagent_type: "general-purpose"` with `isolation: "worktree"`.

Wait for ALL parallel agents to return before proceeding.

## Phase 4 — Quality check via judge agent

Spawn ONE Agent (`subagent_type: "general-purpose"`) with the judge persona. Read [judge-prompt.md](./judge-prompt.md) for the full prompt.

The judge returns:
- PER MILESTONE: APPROVED | NEEDS-FIXES (with specific list)
- PROCESS SCORE: 1-5 with reason
- PRODUCT SCORE: 1-5 with reason
- TOP IMPROVEMENTS for next run
- ESCALATIONS requiring user input

**If judge returns NEEDS-FIXES:**
- Spawn one focused agent for the fixes (`isolation: "worktree"`, same worktree as original)
- Re-judge (only the fixed scope)
- Repeat at most twice — if still failing, mark BLOCKED and surface to user

### Partial-batch handling (if 2 parallel agents)

With `isolation: "worktree"`, partial batches are clean:
- All APPROVED → Phase 5
- All BLOCKED → mark milestone failed; both worktrees preserved for next-run resume
- Mixed → Phase 5 for APPROVED worktree only; BLOCKED worktree preserved with judge feedback in STATE.md

## Phase 5 — Commit + ship (gh PR flow)

```
For each APPROVED worktree (in dependency order):
  1. cd <worktree path>
  2. Final pre-commit verification:
     - npm run typecheck
     - npm run build
     - For schema PRs: verify migration applies cleanly
  3. git push -u origin HEAD
  4. gh pr create \
       --title "<from agent's commit message — Conventional Commits>" \
       --body "<from agent's report — acceptance criteria + test evidence + rollback + judge note>"
  5. Wait briefly for Vercel preview build to kick off; surface preview URL to user if available
  6. gh pr merge --squash --delete-branch
  7. Capture PR URL + commit SHA from `gh pr view` after merge
  8. Verify via `gh pr view <URL> --json state` returning "MERGED"
```

### State transitions

`APPROVED_NOT_COMMITTED` → `PR_CREATED` → `MERGED`. On failure: `PREVIEW_FAILED`.

### Failure classification

- **Systemic** (gh auth expired, network down, branch protection denied) → STOP, mark this milestone `PREVIEW_FAILED`, surface to user
- **PR-specific** (CI failed, lint error, merge conflict) → mark this milestone `PREVIEW_FAILED` with diagnostic; next run reads checkpoint + retries

## Phase 6 — Write checkpoint + update state

Write `builds/checkpoints/run-NNN-YYYY-MM-DD.md` using [checkpoint-template.md](./checkpoint-template.md).

Update `STATE.md`:
- Move newly-merged milestone → `MERGED`
- Update "next up" (the next v0.x in the roadmap)
- Update phase progress (X/10 milestones merged)
- Add new "recent learnings" (max 5; older roll to run-log)
- For BLOCKED milestones: keep with judge reason + worktree path
- For PREVIEW_FAILED milestones: keep with worktree path + classification

Append one row to `quality-log.md`. Append one screen to `run-log.md`.

### Self-verification before declaring done

- [ ] Every `MERGED` milestone has commit SHA + PR URL captured
- [ ] Every `MERGED` PR is verified via `gh pr view <URL> --json state` returning `MERGED`
- [ ] Every `BLOCKED` milestone has judge feedback + worktree path
- [ ] Every `PREVIEW_FAILED` milestone has worktree path + classification
- [ ] Quality-log row matches judge verdict
- [ ] Run-log entry matches checkpoint
- [ ] Status counts in STATE.md sum to 10 (total milestones v0.0.1 → v1.0)

On any inconsistency: do NOT release lock. Surface to user.

### Rename IN_PROGRESS checkpoint + release lock

Rename `run-NNN-IN_PROGRESS.md` → `run-NNN-YYYY-MM-DD.md`. Delete `builds/.run-lock.json`.

## Phase 7 — Report to user

Brief end-of-turn message (4-6 lines):

> Run #NNN complete. Merged v<VERSION> (<description>) — PR <URL>.
> Process: N/5 (<reason>).
> Product: N/5 (<reason>).
> Vercel preview: <URL if captured>.
> Next: v<NEXT> (<description>).
> Blockers: <none | list>.

## Anti-patterns

- **Skipping the judge phase.** Always run.
- **Spawning more than 2 implementation agents per run** (3 total counting judge).
- **Direct push to main without `gh pr create`** — bypasses CI + Vercel preview.
- **Silently failing if a test fails.** Surface explicitly.
- **Modifying PLAN.md without user approval.** Flag instead.
- **Letting an agent skip a Tay-specific gate** because "this milestone doesn't seem to need it." Apply where relevant; flag explicit reasoning if you believe an exception applies.
- **Reintroducing dropped multi-tenant concerns** (RLS contract tests, KMS, DPA, etc.) — these were explicitly dropped per PLAN.md.

## v1.0 ship gate

When v1.0 milestone is MERGED + JOURNEYS eval suite is green + trust-tier promotion is verified live:

1. Do NOT auto-mark "Tay shipped"
2. Update STATE.md: `v1.0 complete. Awaiting user kickoff for post-1.0 work.`
3. Surface to user with:
   - List of every merged milestone + PR URL
   - Open issues / TODOs / known limitations
   - Recommended next steps (marketing, real-user dogfood, etc.)
4. Wait for explicit user direction

## When in doubt — stop, report, ask

The flywheel only works if state stays honest. Never paper over a problem to keep cadence going.
