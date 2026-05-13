# Tay Build — Quality Log

Per-run process + product scores from the judge agent. Trend table for spotting drift in build quality over time.

| Run # | Date | Milestone | Status | Process | Product | Notable |
|---|---|---|---|---|---|---|
| (not yet) | — | — | — | — | — | Bootstrap state; first run pending |

---

## Scoring notes

- **Process score (1-5):** how well the agent + orchestrator worked. 5 = clean run, scope respected, judge had nothing to flag. 1 = chaos / fixes / re-runs.
- **Product score (1-5):** quality of the merged work itself. 5 = production-grade with comprehensive tests. 1 = shipped-but-fragile.
- **Honest rubric.** A 5/5 product score should be rare. A 4/5 product score is normal for shipping.
- **Trend warnings:** if process score < 3 for two consecutive runs OR product score < 3 for a single run, surface to user before next run kicks off.
