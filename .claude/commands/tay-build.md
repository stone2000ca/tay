---
description: Orchestrate one iteration of the Tay v0.x build. Reads current state, plans the run, spawns an implementation agent (or two for parallel sub-tasks), runs a judge agent for quality review, ships via gh PR flow, writes a session checkpoint.
---

Read [skills/tay-build/SKILL.md](../../skills/tay-build/SKILL.md) and execute it with the user's arguments: `$ARGUMENTS`.

The skill is the full orchestrator spec. Treat its instructions as the contract for this run.
