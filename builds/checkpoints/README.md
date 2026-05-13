# Checkpoints

Per-run detailed reports. One file per `/tay-build` invocation.

## Naming

- In flight: `run-NNN-IN_PROGRESS.md` — created when the orchestrator writes its Phase 2 plan; renamed at Phase 6 close.
- Completed: `run-NNN-YYYY-MM-DD.md` — final checkpoint.
- A stuck `run-NNN-IN_PROGRESS.md` paired with a stale `.run-lock.json` (parent dir) signals a crashed run. Next invocation surfaces RESUME / FORCE-CLEAR.

## Structure

Each checkpoint follows [skills/tay-build/checkpoint-template.md](../../skills/tay-build/checkpoint-template.md). Sections:
- Goal (Phase 2 plan, verbatim)
- Agents spawned
- Milestone outcome (status, files, acceptance criteria, tests, Tay-specific gates, rollback)
- Quality check (judge verdict verbatim)
- Outcomes (scores, token spend, run time)
- State after this run (next up, blockers, state-machine reconciliation)
- Process improvements + escalations + notes

## When to read

- After every run — verify what landed
- When debugging a regression — checkpoint shows which run introduced a change
- When the build feels off-track — trend across last 5 checkpoints shows whether the agent is drifting

## When to NOT modify

Checkpoints are immutable post-completion. The orchestrator does not edit completed checkpoints; if a milestone's outcome needs annotation later (e.g., "this was reverted in run #N"), add a note to run-log.md instead.
