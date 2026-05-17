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

## Run #002 — 2026-05-17 (~19 min)

**Milestone:** v0.2 — Supabase Marketplace integration + auto-migrations + UI shell with nav
**Status transition:** NOT_STARTED → MERGED
**PR:** [#3](https://github.com/stone2000ca/tay/pull/3) — squashed as `1bcf341e`
**Judge:** Process 4/5, Product 4/5 — APPROVED with one in-PR fix (cold-start race on `/setup` POST).

### What landed
- `@supabase/supabase-js` + `pg` + `@types/pg` deps; lazy server/anon client factories in `lib/supabase/`
- First migration `lib/supabase/migrations/0001_init.sql`: `app_config`, `prospects`, `audit_log` (with `prev_hash`/`this_hash` columns ready for the v0.6 hash chain); all CREATEs idempotent; pgcrypto extension declared
- `lib/supabase/migrate.ts` — `ensureSchema()` with module-scoped Promise cache, info-schema pre-check, transaction-wrapped DDL, inline-SQL fallback against Turbopack bundling quirks; never throws
- `lib/app-config.ts` refactored to dual backend: Supabase when env present, cookie fallback otherwise; cookie `secure` flag now NODE_ENV-gated (resolves run #001 dev-loop bug)
- `components/nav.tsx` mounted in root layout (Dashboard / Setup / Settings); suppressed on `/setup` for clean first-run UX
- `app/settings/page.tsx` placeholder so the nav link resolves
- `app/page.tsx` calls `ensureSchema()`; `app/setup/actions.ts` also calls it before first write (closes cold-start race)
- Dropped dead `next lint` script (resolves run #001 escalation)
- 11/11 tests passing (8 app-config + 3 migrate)

### Notable
- Judge spotted a cold-start race on `/setup` POST that the agent missed — first wizard submit on a fresh Vercel function instance would have thrown "relation does not exist." Fix landed in-PR as `9c5786e`.
- No real Supabase project linked → migration's live path (TLS connect + DDL on actual cluster) never exercised. Unit tests cover skip + cache memoization only. Inline-SQL + transactional + idempotent mitigations in place; first user install is the live smoke test.
- `gh pr merge --delete-branch` aborted on local-checkout again (same root as run #001: `main` is checked out in parent worktree). Merge succeeded server-side; remote branch deleted manually.

### Escalations to user (open before next run)
1. **Add `ANTHROPIC_API_KEY` to orchestrator env before run #003** — v0.3 voice calibration is LLM-touching and needs live smoke evidence. This was deferred on run #001 and again on run #002; v0.3 makes it load-bearing.
2. (Optional) **Live Supabase smoke test** — 5-minute Marketplace integration on the live Vercel project would exercise `migrate.ts` end-to-end before first customer install.
3. (Still open) **Vercel project linking** — would unlock preview URLs in PR comments.

### Detailed checkpoint
`builds/checkpoints/run-002-2026-05-17.md`

---

## Run #003 — 2026-05-17 (~17 min)

**Milestones:** LLM provider pivot (Anthropic → OpenRouter) + v0.3 voice calibration
**Status transition:** v0.3 NOT_STARTED → MERGED (also: foundational LLM-seam pivot)
**PR:** [#5](https://github.com/stone2000ca/tay/pull/5) — squashed as `27840442`
**Judge:** Process 5/5, Product 4/5 — APPROVED both milestones, no fix-pass needed.

### What landed

**LLM pivot:**
- New `lib/llm.ts` — OpenAI SDK pointed at `https://openrouter.ai/api/v1`; `MODELS` constants (`cheap` = `anthropic/claude-3.5-haiku`, `quality` = `anthropic/claude-3.5-sonnet`) overridable via env
- `validateLlmKey` discriminated union (no raw SDK text leaks; verified by test)
- `lib/anthropic.ts` deleted; `@anthropic-ai/sdk` removed from package.json
- Setup wizard: `sk-or-` prefix, OpenRouter copy, link to openrouter.ai/keys
- `.env.example` + README updated

**v0.3 voice calibration:**
- Migration `0002_voice_calibration.sql` (single-row pattern, idempotent)
- `lib/voice/rubric-schema.ts` — `VoiceRubric` type + `parseRubric` hard validator (gate B: zero special-category fields)
- `lib/voice/calibrate.ts` — extractor with gate H defenses (`<untrusted_source>` wrap + `response_format: json_object` + ignore-embedded-instructions system prompt)
- `app/setup/voice/page.tsx` + `actions.ts` — 5 textareas, server action with cold-start `ensureSchema()` guard
- `lib/supabase/migrate.ts` extended to handle multiple migrations
- 29/29 tests passing (was 11)

### Notable

- User strategic pivot: Tay's LLM provider changed from Anthropic direct to OpenRouter (unified gateway). All future LLM-touching code uses `lib/llm.ts`.
- Preflight gates (ANTHROPIC_API_KEY, Vercel-linking, live Supabase) explicitly waived by user. Live LLM and live DB verification deferred to first-user smoke test.
- Two coupled milestones shipped in one PR. Acceptable because they're sequentially dependent (v0.3 needs the new LLM abstraction).
- `gh pr merge --squash --delete-branch --repo stone2000ca/tay` works (passing `--repo` avoids the local-checkout abort that hit runs #001 and #002). New pattern locked in.

### Escalations to user (open before next run)

1. **First-user smoke test recommended** — paste real OpenRouter key, calibrate voice, confirm `voice_calibration` row exists. If `anthropic/claude-3.5-haiku` 404s on the user's account, swap `VALIDATION_MODEL` to `openai/gpt-4o-mini` (already documented as fallback in `lib/llm.ts`).
2. **Paper cuts before v0.5 ship:**
   - `/setup/voice` should surface "Supabase not configured" banner instead of wedging in a redirect loop
   - Define `SAMPLE_COUNT` once and import in both UI and extractor

### Detailed checkpoint
`builds/checkpoints/run-003-2026-05-17.md`

---

## Run #004 — 2026-05-17 (~12 min)

**Milestone:** v0.4 — Drafter v1 (prospect → AI-drafted email constrained by voice rubric)
**Status transition:** NOT_STARTED → MERGED
**PR:** [#7](https://github.com/stone2000ca/tay/pull/7) — squashed as `d445d7c0`
**Judge:** Process 5/5, Product 5/5 — APPROVED, no fix-pass needed. First 5/5 product score.

### What landed

- Migration `0003_drafts.sql` — new `drafts` table (FK to prospects with ON DELETE CASCADE; `rubric_snapshot` + `prompt_inputs` jsonb for v0.5 re-judge) + `ALTER TABLE prospects ADD COLUMN notes`
- `lib/draft/disclosure.ts` — `withDisclosure` idempotent footer injection (Tay gate C)
- `lib/draft/prompt.ts` — system + user message builder; rubric as binding constraint; prospect data in `<untrusted_source field="...">` blocks (Tay gate H)
- `lib/draft/generate.ts` — LLM call via `MODELS.quality`; `response_format: json_object`; defensive JSON parse with fence stripping; shape validation; SDK error mapping suppresses raw text
- `lib/draft/persist.ts` — upsertProspect + saveDraft (WRITE, throws) + getDraftCount (READ, soft-fails to null)
- `app/draft/` — form + server action with cold-start `ensureSchema()` guard
- `app/page.tsx` — dashboard cascade (app_config → voice rubric → dashboard with /draft link + count card)
- `components/nav.tsx` — Draft link added between Dashboard and Setup
- `lib/supabase/migrate.ts` — sentinel pre-check refactored to `{kind: "table"|"column"}` for ALTER-bearing migrations
- 49/49 tests passing (was 29; added 20)

### Notable

- First milestone where all four named Tay gates (B/C/D/H) apply simultaneously. Defense layers stack: response_format json_object + fence stripper + shape validator + length caps + disclosure injector + system-prompt rules + adversarial wrappers + input ASCII-bound. Every layer has a test.
- Migration runner sentinel handles fresh install, upgrade-from-v0.3, and steady state correctly (judge verified).
- `upsertProspect` synthesizes `unknown+<name>@<company>.invalid` placeholder email because `prospects.email` is NOT NULL (0001 schema decision). RFC 2606 `.invalid` TLD guarantees no routing. v0.5 will add a real email field.
- Judge improvement: orchestrator should commit/push `run-NNN-IN_PROGRESS.md` BEFORE spawning the agent so the judge can read it from the agent's worktree (currently lives only in orchestrator worktree).

### v0.5 paper-cut targets (carried forward)

- Synthesized-email edge cases: company labels like `"Acme Inc."` produce `acme-inc-.invalid` (RFC 1035 violation); unicode-different names map to same synthesized email
- Notes-field `</untrusted_source>` injection sanitizer + test
- Pre-flight `hasSupabaseEnv()` check in `generateAndSaveDraft` (avoid wasted LLM calls on misconfigured deploys)
- `/setup/voice` "Supabase not configured" banner (from v0.3 judge)
- Define `SAMPLE_COUNT` once and import (from v0.3 judge)

### Detailed checkpoint
`builds/checkpoints/run-004-2026-05-17.md`

---

## Run #005 — 2026-05-17 (~19 min)

**Milestone:** v0.5 — Judge v1 + audit-log stub + v0.3/v0.4 paper cuts
**Status transition:** NOT_STARTED → MERGED
**PR:** [#9](https://github.com/stone2000ca/tay/pull/9) — squashed as `d0aab4d1`
**Judge:** Process 5/5, Product 4/5 — APPROVED

### What landed
- Migration `0004_judge_decisions.sql` (CHECK constraint on decision; FK CASCADE; two indexes)
- `lib/judge/` — decision-schema (hard validator) + prompt (4 decisions, gates B/C/D/H criteria, rubric verbatim, untrusted_source wrap, JSON-only) + judge (MODELS.quality, temp 0.2, response_format json_object, defensive parse) + persist (read-vs-write contract)
- `lib/audit/append.ts` — stub for v0.6's hash chain; never throws; defensive redactor on a small set of secret-like keys
- Wired into `app/draft/actions.ts`: pre-flight `hasSupabaseEnv` → generate → saveDraft → judge → saveJudgeDecision → appendAudit. Judge failure = degraded-mode visibility (draft saved + amber banner).
- 4 of 5 paper cuts cleared (Supabase warning banner via server component; SAMPLE_COUNT hoisted; pre-flight env check; closing-tag neuter in both drafter and judge prompts). Synthesized-email RFC/unicode punted.
- 96/96 tests (added 47)

### Notable
- THE LOAD-BEARING MILESTONE. All four Tay gates wired as VERIFICATION, not just trust.
- Judge gave 4/5 product (not 5/5) for `appendAudit` doc-vs-impl drift — the comment claims it redacts email/body/raw but the matcher only catches api_key/secret/token/password. No active leak in v0.5 (no callers pass email) but v0.7 send-event callers must not trust the doc. Fix in v0.6.
- `appendAudit` is the contract surface — v0.6 will rewrite it to the real hash chain without touching call sites.

### v0.6 carry-forwards
1. `appendAudit` redactor — tighten matcher OR tighten comment (judge's improvement #1: make the doc executable via test)
2. `neuter()` belt-and-braces on `<untrusted_source` opener (one-line)
3. `sanitizeReasons` cap-vs-reject — document the rationale at the call site

### Detailed checkpoint
`builds/checkpoints/run-005-2026-05-17.md`

---

## Run #006 — 2026-05-17 (~20 min)

**Milestone:** v0.6 — Audit log v1 (sha256 hash chain) + v0.5 carry-forwards
**Status transition:** NOT_STARTED → MERGED
**PR:** [#11](https://github.com/stone2000ca/tay/pull/11) — squashed as `39f5c93d`
**Judge:** Process 5/5, Product 4/5 — APPROVED

### What landed
- `lib/audit/hash.ts` (pure): `computeHash`, recursive `canonicalJson`, `NULL_PREV_HASH_SENTINEL`
- `lib/audit/append.ts` rewritten — public API preserved; never throws; redacts before hashing
- `lib/audit/verify.ts` — chain walker with discriminated `hash_mismatch` / `prev_hash_mismatch` / `supabase_unavailable` / `read_error`
- `GET /api/audit/verify` + `/audit` page (server component; nav link)
- Migration `0005_audit_index.sql` (`audit_log_occurred_at_idx`) with new `index` sentinel kind
- v0.5 carry-forwards cleared: redactor expanded (email/body/raw/raw_body/prospect_email + per-key test); neuter opener belt-and-braces; sanitizeReasons doc-comment
- 143/143 tests

### Notable
- **Tay gate F NOW FULLY LIVE.** Every Tier-3 judge decision writes a tamper-evident row.
- Hash determinism: verifier and writer import the same `computeHash`; canonical JSON sorts keys recursively; NULL sentinel for first row.
- Concurrency: two parallel `appendAudit` calls could break the chain (documented); single-tenant + verifier surfaces the break as `prev_hash_mismatch`.
- Judge gave 4/5 product for two cosmetic v0.7+ polishes (hash domain separator; AuditVerifyResult shape).

### Detailed checkpoint
`builds/checkpoints/run-006-2026-05-17.md`

---

## Run #007 — 2026-05-17 (~24 min)

**Milestone:** v0.7 Gmail OAuth + send path
**Status transition:** NOT_STARTED → MERGED
**PR:** [#13](https://github.com/stone2000ca/tay/pull/13) — squashed as `d839b071`
**Judge:** Process 5/5, Product 4/5 — APPROVED

### What landed
- Migrations 0006 (google_oauth) + 0007 (sent_messages + trust_events)
- `lib/oauth/{crypto,google,persist}.ts` — AES-256-GCM + raw-fetch OAuth + encrypt-at-rest
- `/api/auth/google/{start,callback}` — CSRF state cookie + state validation before code exchange
- `lib/suppression/check.ts` (stub) + `lib/trust/record.ts` + `lib/send/{gmail,orchestrate}.ts`
- `/queue` (per-row send actions, degraded-state matrix) + `/settings` (status dots + connect/disconnect)
- All 7 Tay gates active for the first time
- 216/216 tests (added 30+)

### Notable
- **THE LOAD-BEARING EMISSION MILESTONE.** Every console.log audited; log-probe test asserts recipient/subject/body/token never appear in error output.
- Orchestrator gate ordering test (isSuppressed → ensureFreshAccessToken → sendEmail) locks the invariant.
- Tay rule "never log raw OAuth tokens or recipient emails" verified at every seam.
- Judge: "the most carefully-engineered PR in the build."

### v0.8 carry-forwards (non-blocking)
1. `sent_messages.draft_id` needs UNIQUE constraint to backstop the orchestrator's read-then-write race (real risk: two browser tabs → double-send)
2. `sendDraftAction` silent-failure: redirect with `?error=` instead of console.warn + revalidatePath
3. `saveGoogleOAuth` DELETE+INSERT should be wrapped in a transaction
4. Subject field not in audit redactor matcher (consistent with "callers must pre-redact" but worth a pass)
5. Suppression stub returns false — v0.8's real impl MUST default to TRUE on read error per the header note

### Detailed checkpoint
`builds/checkpoints/run-007-2026-05-17.md`

---

## Run #008 — 2026-05-17 (~23 min)

**Milestone:** v0.8 — Suppression list + unsubscribe handling + v0.7 carry-forwards
**PR:** [#15](https://github.com/stone2000ca/tay/pull/15) — squashed as `85f591a9`
**Judge:** Process 5/5, Product 4/5 — APPROVED

### What landed
- Migration 0008: suppression table + idempotent ALTER for sent_messages_draft_id_unique
- `lib/suppression/{check,add}.ts` — real impl; safe-default TRUE on uncertainty
- `lib/unsubscribe/token.ts` — HMAC-SHA256 + timingSafeEqual + kind-claim + 90-day exp
- `lib/draft/disclosure.ts` extended — per-recipient unsubscribe link
- `/u/[token]` page — collapses all bad states to one generic message; NO email echo
- `/settings/suppression` — list/add/remove
- All 4 v0.7 carry-forwards CLOSED
- 267/267 tests

### Notable
- Tay gate E now LOAD-BEARING
- Judge: "the unsubscribe page is a model of restraint"
- Agent forgot to commit before COMPLETE — orchestrator follow-up via SendMessage (second occurrence; first was run #001)

### v0.9 observations
1. `/u/[token]` replay 5-second age heuristic — strictly honest under DB lag would need read-before-upsert
2. bad-kind token-reject test missing (the check is implemented)
3. disclosure.ts silently swallows token-generation throws
4. `/u/[token]` uses dynamic import for listSuppressions
5. `/settings/suppression` UI shows first entry only (audit log has full history)

### Detailed checkpoint
`builds/checkpoints/run-008-2026-05-17.md`

---

## Run #009 — (not yet started)

Next invocation picks up v0.9 — Reply handler (inbound webhook + threaded LLM). Listens for Gmail replies via push notification or polling; LLM classifies (positive/negative/oof/needs-human); records trust events; if positive intent + autonomous tier, drafts a follow-up via the same drafter+judge stack.
