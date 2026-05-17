# Tay Build — Quality Log

Per-run process + product scores from the judge agent. Trend table for spotting drift in build quality over time.

| Run # | Date | Milestone | Status | Process | Product | Notable |
|---|---|---|---|---|---|---|
| 001 | 2026-05-13 | v0.1 setup wizard step 1 | MERGED | 4/5 | 4/5 | Agent didn't commit before declaring done; missing tests on SDK error-mapping seam; cookie `secure: true` will infinite-loop localhost dev |
| 002 | 2026-05-17 | v0.2 Supabase + auto-migrations + UI shell | MERGED | 4/5 | 4/5 | Judge flagged cold-start race on `/setup` POST — fixed in-PR (`9c5786e`). Live-DB verification gap (no Supabase project linked); inline-SQL fallback + transactional DDL mitigate. Cookie `secure` fix from run #001 escalation landed. `next lint` dead-script dropped. |
| 003 | 2026-05-17 | LLM pivot to OpenRouter + v0.3 voice calibration | MERGED | 5/5 | 4/5 | Two coupled milestones shipped in one PR. User pivot: Tay now uses OpenRouter via the OpenAI SDK (`@anthropic-ai/sdk` removed). v0.3 ships voice-calibration extractor with gate H defenses (untrusted_source wrap + response_format json_object + parseRubric hard validator) and gate B (zero special-category fields). Paper cuts: `/setup/voice` wedges if Supabase env absent; SAMPLE_COUNT mismatch between UI (5) and extractor (3-10). |

---

## Scoring notes

- **Process score (1-5):** how well the agent + orchestrator worked. 5 = clean run, scope respected, judge had nothing to flag. 1 = chaos / fixes / re-runs.
- **Product score (1-5):** quality of the merged work itself. 5 = production-grade with comprehensive tests. 1 = shipped-but-fragile.
- **Honest rubric.** A 5/5 product score should be rare. A 4/5 product score is normal for shipping.
- **Trend warnings:** if process score < 3 for two consecutive runs OR product score < 3 for a single run, surface to user before next run kicks off.
