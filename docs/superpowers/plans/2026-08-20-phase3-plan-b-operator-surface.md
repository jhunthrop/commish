# Phase 3 Plan B — The Operator Surface: Detection, the Dispute Queue, and Moderation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give this product its first authority beyond league membership, a queue where a report or a suspicion becomes a recorded human decision, a detector that first fills that queue, and the three moderation paths Phase 2 deliberately left unbuilt so that they could be built once, here, instead of twice.

**Architecture:** Five strands. **(1) The role.** `users.is_admin`, one boolean, no RBAC framework, granted only by a guarded operator script run against the database host — there is deliberately no in-product path to grant it (ruling 15). `requireAdmin()` sits beside `requireCurrentUser()` and gates every surface in this plan, answering 404 rather than 403 (ruling 14), and a route-tree contract test proves no admin file can forget it. **(2) The queue.** One `integrity_flags` table with a `flag_type` discriminator, not one table per detector (ruling 28). A flag is raised by the platform, never by a member (ruling 12); a member's report is a signal that raises one. Resolution is a one-way stamp guarded in the `UPDATE`'s own `WHERE` (ruling 4), the same shape `reviews` already uses, and the immutable record of the decision is the `flag_resolved` audit event. **(3) Moderation.** Chat gains the report affordance and the removal stamp it has never had, mirroring `reviews` field for field, with GIFs covered by construction because a GIF is one `chat_messages` row. `review_reports` gets its first consumer. Both land in the same queue and both are resolved by the same `resolveFlag`. **(4) Detection.** Three pure similarity heuristics over a new mutable `session_signals` table (never the immutable audit payload — ruling 7), combined by weights in `INTEGRITY_CONFIG`, **with the IP weight pinned at zero until a platform-verified client IP exists** and a stored `ip_source` discriminator that makes flipping it a filter rather than a memo (rulings 8 and 10). League-bounded, flag-only, and proved flag-only by a contract test in the shape of `advisory-only.test.ts`. **(5) The operator's other job.** The post-final stat-correction path Phase 2 Plan B's ledger named by hand: an audited, budget-reserving re-read of any settled week, one transaction per league, every affected manager told. That is also the plan's first league-scoped `system_action`, which trips the pre-wiring gate Plan A left behind, and closing that gate properly is a task here rather than a note (ruling 13).

**Tech Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · `node:crypto` (sha256, no new dependency) · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright.

**Spec:** `plans/phase-3-trust-and-integrity.md` — **Step 2** in full (lines 109–141), plus the **admin half of Step 4** (lines 192–197 and 199–200; line 198's member feed shipped in Plan A). Phase split, the founder-decision defaults and the residual ledger: `docs/superpowers/plans/2026-08-20-phase3-overview.md`. Plan A's rulings and the primitives this plan consumes: `docs/superpowers/plans/2026-08-20-phase3-plan-a-audit-spine.md` and `docs/decisions/audit-and-integrity.md`.

**Depends on Plan A, which is merged** (`main` at `185e22a`). It **does not depend on Phase 2 Plan D**, and the one place Plan D's resources would change behavior is a config weight and a stored discriminator rather than undelivered code: `INTEGRITY_CONFIG.multiAccount.weights.ip` is `0` and `session_signals.ip_source` is `"xff_unverified"` until Fly's proxy overwrites `X-Forwarded-For`, at which point one weight and one filter change and no logic does (Task 9). It does not depend on Plan C or Plan D for anything.

**Consumers this plan ships for, by name.** Plan C writes a `trade_fairness` flag into `raiseFlag` and a `trade` subject into the queue, and turns on the `trade_reversed` resolution this plan declares and refuses (ruling 2). Plan D escalates everything ambiguous into the same queue, publishes a league-scoped `system_action` for its auto-set lineups, and inherits this plan's decided answer about what such an action may say to a league (ruling 13). Every reserved-but-unexercised name in this plan names its plan in its own docblock, exactly as Plan A's `reserved.test.ts` already forces for the audit vocabulary.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope** (money, tax, native apps come later), not quality. Nothing gets built in a form a later phase plans to throw away. **This plan is the one that rule was written at**: Phase 2 Plan C's ruling 18 refused to build a smaller moderation surface *precisely so* it would not have to be reconciled with this one.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism"*. Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree; they all talk to one shared stack.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let`).
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`).
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. `users.id` **is** the WorkOS user id. API and SSE routes never redirect — they return a JSON 401 themselves. **This plan adds exactly one function to that file (`requireAdmin`) and no second identity source** (ruling 15).
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. No Socket.io, no managed realtime vendor, no second transport — ever. **This plan adds no realtime event type**: `notice.created` already exists and a removed chat message rides the `chat.message` fold the same way a GIF does.
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. Every accepted action is persisted before it is cached or published, and `teamId` is always resolved from the authenticated session, never from a request body.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**` and `src/account-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/review-service`, `@/identity-service`, `@/integrity`, `@/integrity-service`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed`, `@/stats-pipeline`, `@/stats` or `@/gifs` as VALUES. `import type` stays allowed. The rule is deliberately **not** applied to `src/app/**`. Exempt pure directories that browser code MAY value-import: `src/chat/**`, `src/matchmaking/**`, `src/identity/**`, `src/help/**`, `src/reviews/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them. `INTEGRITY_CONFIG` (`src/integrity/config.ts`) is the 23rd and its own docblock binds this plan: *"Plans B, C and D add FIELDS here, never new files."*
- **Tests.** **Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/integrity`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **Coverage threshold: 100%** for the gated directories, configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block (an `include` entry with no threshold is not a gate at all). **Sixteen** gated directories on `main` today. **This plan adds three** — `src/league-service` and `src/draft-service` as gates 17 and 18, per the recommendation Plan A's final whole-branch review recorded in `.superpowers/sdd/meta-loop.md`, plus `src/moderation` as gate 19 (Task 11, ruling 26). Verify with an **unfiltered** `npm run test:coverage`.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). **There is no dev auth bypass and none may be added** — which is the reason this plan's admin e2e coverage seeds an admin rather than granting one through a UI.
- **Any step shipping a user-visible surface additionally requires:** a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width. **An operator surface is a user-visible surface** (ruling 27).
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy, as in `drizzle/0001`); once deployed, add with a DEFAULT or backfill in a separate migration. **Every migration in this plan that touches `chat_messages` is checked against `src/db/index-plans.test.ts`** (ruling 17).
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. Fail fast with a clear message when a required var is missing (see `db/client.ts`, `realtime/redis.ts`).
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional, and `EmptyState`/`ErrorState` inherit that). **An empty dispute queue is the state an operator sees most often and it still may not be a dead end.**
- **Both themes are first-class.** Every surface is designed and tested in light and dark, via `inBothThemes` from `src/components/ui/test-utils.tsx`. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** `IconName`s on `main` today: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`, `info`, `shield`, `flame`, `anchor`, `rocket`, `crown`, `bolt`, `clover`. **This plan adds none**: `shield` is the operator glyph, `alert-triangle` the flag, `x` the removal, `check` the resolution.
- **`PositionBadge` is the only way to render a position label; `Sticker` is the only way to render a position-pigmented tile.** Nothing else may reach for `bg-pos-*` directly.
- **Never set the display face on a paragraph.** It is a lettering face, not a reading face.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/decisions/data-layer-hardening.md`:**

- **Balance as rollup.** Any running total is a rollup row updated **in the same transaction** as each contributing write, over an append-only source table that stays the reconciliation source of truth. Never a `SUM()` on the read path. The threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one. **A report count per review is bounded, so the queue derives it and does not store it** (ruling 5).
- **PgBouncer transaction pooling forbids session state.** No `pg_advisory_lock`, no named prepared statements (`prepare: false` is unconditional), no `SET` outside a transaction, no session-scoped temp tables, **no `LISTEN`/`NOTIFY`**. DDL goes through the direct port, never the pooler.

**From `docs/decisions/audit-and-integrity.md` (Plan A's rulings, binding here):**

- **The audit append and the notice row are inside the business transaction and fail it; only the Redis frame is best-effort.** The inverse of the publishing rule, in the same flow, deliberately. **Every operator action in this plan obeys it.**
- **The lock order is one global order and the audit anchor is ALWAYS the last lock**, where "lock" includes an implicit foreign-key `FOR KEY SHARE`. The permitted sequence is: business rows → notice insert → `audit.record` → `attachAuditEvent` → commit → `deliverNotice`. `src/integrity-service/lock-order.test.ts` catches a violation against real Postgres and **this plan extends it with every transaction it adds**.
- **A transaction appends to at most one chain.** `recordAll` throws on a batch spanning two scopes. This is why the stat correction is one transaction per league (ruling 23).
- **`audit_events` carries no foreign keys and nothing ever deletes a row.** Which is why device and IP signals may not live in an audit payload (ruling 7).
- **Deny by default, on every visibility dimension.** `ACTIVITY_VISIBILITY` is an exhaustive `Record` over the whole `AuditEventType` union; a type with no decision does not compile. This plan adds a third dimension in the same shape (ruling 13).

**Founder rules (binding, from the phase overview and founder memory):**

- **No em-dashes in user-facing copy**, and in this codebase that rule has grown teeth: `copyViolations` (`src/integrity/copy-rules.ts`) is one rulebook enforcing three rules — no em **or en** dash, nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms`, nothing in `INTEGRITY_CONFIG.notices.passiveConstructions`. **This plan writes the most emotionally loaded copy in the product** (you were reported, your message was removed, your settled result changed) and every string it writes is swept.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. **Two panels in this plan** (ruling 27), because an operator surface has personas too and because the member-facing halves land on somebody who did not ask for them.
- **Centralize UI primitives the first time.** No page-local visual mapping; extract to `src/components/ui/` and refactor the existing consumer in the same commit.
- **No mock data on real surfaces.** The spec's *"seed several flags at different severities for manual verification"* is satisfied by seeding real reportable content and running the real detector against it, never by inserting decorative flag rows (ruling 30).

---

## What is already true (read before touching anything)

| The spec assumes | Reality on `main` today (`185e22a`) |
|---|---|
| An `isAdmin` boolean can be added to "the Phase 2 account/session model" | There is no session model to add it to. There is no `sessions` table and there will not be one; WorkOS AuthKit owns sessions and `users.id` **is** the WorkOS user id. `users` has exactly seven columns (`id`, `email`, `display_name`, `experience_tier`, `avatar_url`, `created_at`, `last_seen_at`) and **no role column of any kind**. The boolean goes on `users` and the gate reads it through the one existing identity seam (Task 1). |
| An admin can be made an admin | Nothing can grant anything. `scripts/remove-review.ts --by <operatorUserId>` takes an arbitrary id with nothing to verify it against, and its own header says so: *"ruling 18: no admin role and no admin UI exist in this phase, so this script IS the removal path."* Founder decision #12's default is a DB flag set by a guarded operator script; ruling 15 makes that the **only** path, deliberately. |
| `FLAG_RAISED`, `FLAG_RESOLVED` and `ADMIN_ACTION` are new event types | They already exist. Plan A declared the whole 16-entry vocabulary in `src/domain/audit.ts` and shipped it as the `audit_event_type` pg enum, whose docblock states that *"no later migration ever runs `ALTER TYPE … ADD VALUE`"*. **This plan adds no audit event type**; it moves three entries in `src/integrity-service/reserved.test.ts`'s `OWNER` map from reserved to published, and that test fails until it does. |
| `src/config/integrity.ts` holds the new thresholds | It does not exist and will not. `INTEGRITY_CONFIG` (`src/integrity/config.ts`) is the 23rd colocated config and its docblock binds this plan by name: *"Plans B, C and D add FIELDS here, never new files."* Every threshold the spec names (`MULTI_ACCOUNT_FLAG_THRESHOLD`, the per-signal weights) is a field on `INTEGRITY_CONFIG.multiAccount`. |
| `SESSION_STARTED` already carries device and IP signals to compare | It carries neither, on purpose. Plan A's ruling 20: *"a multi-account flag built on a forgeable header lets an attacker manufacture suspicion against someone else's account … Plan B adds real device/IP signals, with the IP weight at zero."* Task 7 adds them, and **not to the audit payload** — `audit_events` has no foreign keys and nothing may ever delete a row from it, so an IP written there outlives the account forever and cannot be erased (ruling 7). |
| The IP heuristic is one signal among three | It is one signal among three whose weight is **zero on merge**. All four existing IP reads key on `X-Forwarded-For` through `clientKey()` in the `_shared.ts` limiters, which their own docblocks call caller-controlled and rotatable; `identity-and-trust.md` records fixing it as LAUNCH-BLOCKING for Phase 2 Plan D. Ruling 10 pins the weight at zero with a test proving device plus behavioral alone can still cross the threshold; ruling 8 makes the flip mechanical by storing an `ip_source` discriminator so pre-fix rows can be excluded rather than trusted. |
| `ACCOUNT_RESTRICTED` is one of four resolution decisions | Nothing in this product can restrict an account, the spec's own out-of-scope list forbids any account action in this phase, and founder decision #5's default is to ship the enum without it. Ruling 2 goes one step further and states the test: a decision value ships when it has an implementation, or it is declared with an owning plan and refused at runtime. `account_restricted` has neither owner nor implementation, so it is not declared at all. `trade_reversed` has an owner (Plan C) and is declared and refused. |
| A `TradeFairnessFlag` exists to put in the queue beside a `MultiAccountFlag` | It does not. There is no `trades` table and no trade path; `TradeProposal`/`tradeBalance` are a pure type and a pure function with no persistence. **Plan C builds it.** This plan ships one `integrity_flags` table with a `flag_type` discriminator (ruling 28), so Plan C adds a row type and a renderer, not a second queue. |
| `review_reports` rows can be triaged as they are | `review_reports` is `(review_id, reporter_user_id)` composite PK, insert-only, **with no status column and no index beyond the PK**. Nothing has ever read it. Task 4 gives it a consumer by having `reportReview` raise a flag into the shared queue; the report table stays the insert-only signal and the flag carries the decision. |
| Chat has some content path to extend | It has none. `src/chat-service` has no delete, no hide and no report, and `ChatMessageView`'s eight fields cannot express a removed state. `identity-and-trust.md` records this as *larger* than the review gap and assigns it here by name: *"Phase 3's moderation surface owns chat, not just reviews."* Task 6 builds it as a stamp mirroring `reviews` field for field. |
| A migration on `chat_messages` is routine | It is the one migration in this repo with a hand-written index. `chat_messages_league_id_idx` carries `INCLUDE (body)` added by hand in `drizzle/0018` because `drizzle-orm`'s `index()` builder cannot express it, and `src/db/index-plans.test.ts` reads `indexdef` back out of `pg_indexes` over a **20,000-row, VACUUM ANALYZE'd** corpus to prove the Index-Only Scan is still chosen. `0017`'s six nullable columns already tipped the planner off this index once. Ruling 17 makes re-measuring a step, not an assumption. |
| Post-final stat corrections need new machinery | They need a caller. `persistTick` is an absolute-valued upsert that advances `stat_weeks.version` only when Postgres reports a real change, and `finalizeWeek(db, leagueId, week, cache)` recomputes scores inside its own writing transaction and invalidates the cache after commit. `live-scoring-pipeline.md` says they were *"only missing a caller."* What does **not** serve is `correctionCandidate`, which structurally returns only the most recent settled week and only inside `STATS_INGESTION_CONFIG.correctionWindowDays` (3). Task 10 reaches around it. |
| The operator surface is not a user-facing surface | It is. The overview said *"the admin views are operator surfaces, not persona surfaces"* and ruling 27 overrules it: an operator triaging under load, an accused member reading the record afterwards and a reporter waiting to learn whether anything happened are three real people, and this plan runs two panels. |
| `system_action` can be made member-visible by writing a payload | It can, and that is precisely the hole Plan A's own residual named: *"`renderSystemAction` renders whatever `payload.summary` string it is given, verbatim, to every league member … re-review is required before Plan D emits a league-scoped `system_action`."* This plan is the first to emit one (the stat correction), so this plan owes that re-review. Ruling 13 closes the gate by adding a third deny-by-default dimension rather than by approving the hole. |
| Fifteen directories are coverage-gated | Sixteen. Plan A added `src/integrity` and `src/integrity-service` as gates 15 and 16. `src/league-service` and `src/draft-service` are **still ungated**, which Plan A's final whole-branch review recorded as a recommendation for this plan (`.superpowers/sdd/meta-loop.md`: *"GATES 17/18 recommended for Phase 3 Plan B (league-service, draft-service)"*). Task 11 adds them, plus `src/moderation` as gate 19 (ruling 21). |

---

## File Structure

**New — the shared moderation vocabulary (`src/moderation/**`, pure and browser-safe, joins the coverage gate as the 19th):**

| File | Responsibility |
|---|---|
| `src/moderation/config.ts` | `MODERATION_CONFIG` — the **one** closed report/removal reason set, its labels and its removal phrases, plus the report rate limits. Founder decision #2's default ("mirror `reviews`' existing closed set exactly; one vocabulary, two record types") turned into a single source rather than a copy. |
| `src/moderation/removal.ts` | `REMOVAL_REASON_VALUES`, `isRemovalReason`, `removalPhraseFor`, `removalSentenceFor`, `RemovedState`. The pure mappers both `reviews` and `chat` render through. |

**New — the integrity rule layer (`src/integrity/**`, gate 15, gains four files):**

| File | Responsibility |
|---|---|
| `src/integrity/flags.ts` | `FLAG_TYPES`, `FlagType`, `FLAG_SUBJECT_TYPES`, `FlagSubjectType`, `RESOLUTION_DECISIONS`, `ResolutionDecision`, `DECISION_OWNER` (the reserved-owner record), `decisionIsAvailable`, `FLAG_STATUSES`. The vocabulary, pure, with no database in it. |
| `src/integrity/similarity.ts` | `deviceSimilarity`, `ipCorrelation`, `behavioralSimilarity`, `multiAccountSuspicion`, `SignalScores`. Three pure heuristics and their weighted combination. No I/O, no clock, no database. |
| `src/integrity/queue-view.ts` | `QueueRow`, `FlagDetail`, `queueRowFor`, `flagDetailFor`. The **admin** field set, the deliberate counterpart to `activity-view.ts`'s member field set, so the allowlist proof compares two named modules rather than two page renders (ruling 16). |
| `src/integrity/system-actions.ts` | `SYSTEM_ACTION_CODES`, `SystemActionCode`, `SYSTEM_ACTION_SUMMARY_ALLOWED`. The third deny-by-default dimension that closes Plan A's pre-wiring gate (ruling 13). |

**Modified in `src/integrity/**`:** `config.ts` (`INTEGRITY_CONFIG.multiAccount`, `.moderation`, `.corrections`, `.queue`), `notices.ts` (four new templates), `activity-view.ts` (the `renderSystemAction` guard).

**New — the integrity service layer (`src/integrity-service/**`, gate 16, gains three files):**

| File | Responsibility |
|---|---|
| `src/integrity-service/flags.ts` | `raiseFlag(tx, input)`, `resolveFlag(db, input)`, `listPendingFlags(db, input)`, `flagDetail(db, flagId)`, `pendingFlagQuery`. |
| `src/integrity-service/multi-account.ts` | `sweepLeagueForMultiAccounts(db, leagueId, deps)` — the league-bounded pair comparison and the flag write. |
| `src/integrity-service/session-signals.ts` | `recordSessionSignals(tx, input)`, `signalsForUsers(db, userIds)`, `hashClientIp`. |

**Modified in `src/integrity-service/**`:** `schemas.ts` (`resolveFlagSchema`, `queueQuerySchema`), `reserved.test.ts` (three `OWNER` entries move), `lock-order.test.ts` (every transaction this plan adds), `notify.ts` (`quoteFor` learns the new quotable types).

**New — chat moderation:**

| File | Responsibility |
|---|---|
| `src/chat-service/moderation.ts` | `reportMessage(db, input)`, `removeChatMessage(db, input)`, `ChatRemovalRecord`. |
| `src/chat-room/components/removed-message.tsx` | The rendered removed state, in place of the body. |
| `src/chat-room/components/report-dialog.tsx` | The member-facing report affordance, one per message. |

**New — routes and pages:**

| File | Responsibility |
|---|---|
| `src/app/api/admin/_shared.ts` | `withAdmin(request, handler)`, `adminRateLimited(userId)`, `resetAdminRateLimit()`. The one gate every admin route goes through. |
| `src/app/api/admin/flags/[flagId]/resolve/route.ts` | `POST` — the one-way resolution. |
| `src/app/app/admin/queue/page.tsx` | The dispute queue list. |
| `src/app/app/admin/queue/[flagId]/page.tsx` | One flag, its evidence, its audit trail, and the decision form. |
| `src/app/api/leagues/[leagueId]/chat/[messageId]/report/route.ts` | `POST` — the chat report, mirroring the reviews report route exactly. |

**New — scripts:** `scripts/grant-admin.ts` (+ `admin:grant`), `scripts/correct-stat-week.ts` (+ `stats:correct`), both on `scripts/remove-review.ts`'s confirmed-destructive idiom.

**New — decision doc:** `docs/decisions/operators-and-moderation.md`.

**New migrations:** `drizzle/0022_operator_role.sql`, `drizzle/0023_integrity_flags.sql`, `drizzle/0024_chat_moderation.sql` (hand-finished for the covering index, exactly as `0018` was), `drizzle/0025_session_signals.sql`.

**Modified:** `src/db/schema.ts`, `src/db/test-db.ts` (`truncateAll`'s hand-maintained list gains four tables), `src/db/index-plans.test.ts`, `src/lib/auth/current-user.ts`, `src/reviews/config.ts`, `src/review-service/reviews.ts`, `src/review-service/schemas.ts`, `src/chat/config.ts`, `src/chat/contract.ts`, `src/chat/messages.ts`, `src/chat-service/chat.ts`, `src/chat-service/index.ts`, `src/chat-room/components/message-list.tsx`, `src/chat-room/hooks/use-league-chat.ts`, `src/stats-pipeline/index.ts`, `src/components/app-shell/app-header.tsx`, `src/data/seed/**`, `src/integrity/rendered-copy.test.tsx`, `vitest.config.mts`, `package.json`, `e2e/league-lifecycle.spec.ts`, `e2e/mobile-360.spec.ts`, `docs/conventions.md`, `docs/decisions/identity-and-trust.md`, `docs/decisions/audit-and-integrity.md`, `README.md`.

---

## Task 1: The role — one boolean, one seam, one script, and no way in from the product

This plan's first commit is the product's first authority beyond league membership, and the shape of it matters more than the size. It is one boolean on `users`, one function beside `requireCurrentUser`, and one operator script. There is deliberately **no in-product way to grant it** (ruling 15): the highest-privilege mutation in this codebase should require shell access to the database host, not a session, which means `requireAdmin` has no privilege-escalation path inside the app at all — not a forgotten one, not a hard one, none.

The grant is itself an operator action, so it audits and it notices: the granted account is told, in plain words, that it can now see other people's reports. A privilege that arrives silently is a privilege nobody knows they are accountable for.

**Files:**
- Create: `drizzle/0022_operator_role.sql`
- Modify: `src/db/schema.ts`, `src/lib/auth/current-user.ts` (+ its test)
- Create: `scripts/grant-admin.ts`
- Modify: `src/integrity/notices.ts` (+ its test), `src/data/seed/index.ts` (+ the seed's test), `package.json`

**Interfaces:**
- Consumes: `getCurrentUser`, `requireCurrentUser`, `getAuditLogger`, `notifyAffectedMember`, `attachAuditEvent`, `INTEGRITY_CONFIG`.
- Produces:
  - `users.isAdmin` (Drizzle column), `CurrentUser.isAdmin: boolean`
  - `requireAdmin(): Promise<CurrentUser>`
  - `grantAdmin(db, input): Promise<GrantAdminResult>` (in `src/integrity-service/flags.ts`'s sibling — see step 4)
  - `NoticeContexts.admin_granted`

Every task after this one consumes `requireAdmin`.

- [ ] **Step 1: Write the failing seam test**

`src/lib/auth/current-user.test.ts` gains:

```ts
it("hands back the admin flag as part of the identity, not as a second lookup", async () => {
  await seedUser(db, { id: "u_op", isAdmin: true });
  const user = await getCurrentUserWith({ workosUserId: "u_op" });
  expect(user?.isAdmin).toBe(true);
});

it("defaults every account that has never been granted anything to false", async () => {
  await seedUser(db, { id: "u_plain" });
  const user = await getCurrentUserWith({ workosUserId: "u_plain" });
  expect(user?.isAdmin).toBe(false);
});

it("refuses an ordinary signed-in account by name, so a caller cannot mistake it for a 401", async () => {
  await seedUser(db, { id: "u_plain" });
  await expect(requireAdminWith({ workosUserId: "u_plain" })).rejects.toThrow("Not an operator.");
});

it("refuses a signed-out caller with the SAME message requireCurrentUser uses", async () => {
  // requireAdmin composes requireCurrentUser rather than re-reading the session: two ways to
  // answer "who is this" is how they drift, and the drift here is an auth bypass.
  await expect(requireAdminWith({ workosUserId: null })).rejects.toThrow("Not authenticated.");
});
```

- [ ] **Step 2: Run it, watch it fail, then add the column and the seam**

`drizzle/0022_operator_role.sql`, generated then read:

```sql
ALTER TABLE "users" ADD COLUMN "is_admin" boolean DEFAULT false NOT NULL;
```

`ADD COLUMN … NOT NULL` **with** a `DEFAULT`, per `conventions.md`'s migration rule — the table is not empty locally and will not be in production.

In `src/db/schema.ts`, on `users`:

```ts
/**
 * The product's first authority beyond league membership, and deliberately the smallest one that
 * can exist: a boolean, not a role, not a permission set, not an RBAC framework (the spec's own
 * out-of-scope list forbids one). An operator can read every pending flag on the platform and
 * record one decision on each. They cannot restrict an account, because nothing in this product
 * can (founder decision 5, ruling 2).
 *
 * There is NO in-product path that writes this column: `scripts/grant-admin.ts` is the only
 * writer, and it runs against the database host, not through a session (ruling 15). A privilege
 * escalation bug therefore has to be a bug in Postgres access control rather than a bug here.
 */
isAdmin: boolean("is_admin").notNull().default(false),
```

In `src/lib/auth/current-user.ts`:

```ts
/**
 * The operator gate. Composes `requireCurrentUser` rather than reading the session again, so
 * there is exactly one answer to "who is this" in this codebase and this function only answers
 * the second question.
 *
 * It THROWS rather than returning a `Response`, matching `requireCurrentUser`. Route handlers
 * translate; `withAdmin` (`src/app/api/admin/_shared.ts`) is the one place that translation lives
 * and it answers 404, never 403 (ruling 14).
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireCurrentUser();
  if (!user.isAdmin) throw new Error("Not an operator.");
  return user;
}
```

`CurrentUser` gains `readonly isAdmin: boolean` from the same `users` row `getCurrentUser` already selects. No second query.

- [ ] **Step 3: The notice, and its copy sweep**

`src/integrity/notices.ts` gains the third `NoticeContexts` key, which the compiler then forces into `NOTICE_TEMPLATES` and `NOTICE_SAMPLES`:

```ts
readonly admin_granted: { readonly grantedByUserId: string };
```

```ts
admin_granted: () => ({
  title: "You can now use the operator tools",
  body: "Someone with database access turned on operator access for your account. You can open the dispute queue from your account menu. Every decision you record there carries your name and cannot be taken back.",
}),
```

The copy is swept automatically: `notices.test.ts` iterates `NOTICE_TEMPLATES`' keys, so a template added here is checked against `copyViolations` the moment it lands. Read the shipped rulebook before writing a word — `INTEGRITY_CONFIG.notices.passiveConstructions` bans `"was made"`, `"was removed"`, `"is kept"`, `"was kept"`, `"were made"` and `"were removed"`, which is why every string in this plan is written in the active voice by construction rather than by editing.

- [ ] **Step 4: Write `scripts/grant-admin.ts` on the confirmed-destructive idiom**

`scripts/remove-review.ts` is the template and it has five parts: a typed `Args`, a `--flag value` parser that rejects a missing value, a `confirm()` prompt over `node:readline/promises`, a preflight read that previews **the exact member-facing copy through the shared renderer** rather than a hand-copied string, and a service call that trusts its own `WHERE` rather than the preflight read. All five apply here.

```ts
const USAGE = "Usage: npm run admin:grant -- --user <userId> --by <granterUserIdOrBootstrap> [--revoke]";
```

The service function lives in `src/integrity-service/flags.ts` (it is the first `admin_action` publisher and belongs beside the others), and its transaction obeys Plan A's one global lock order exactly: business row, then the notice, then the anchor, then `attachAuditEvent`.

```ts
/**
 * Grant or revoke operator access. The ONLY writer of `users.is_admin`.
 *
 * `--by bootstrap` is legal exactly once per database and is checked, not trusted: the statement
 * below refuses it if any admin already exists. After that, an existing operator's id is required,
 * so the grant chain is walkable in the audit log from the first admin forward.
 */
export async function grantAdmin(db: Db, input: GrantAdminInput): Promise<GrantAdminResult> {
  return db.transaction(async (tx) => {
    const [subject] = await tx
      .update(users)
      .set({ isAdmin: input.grant })
      .where(and(eq(users.id, input.userId), eq(users.isAdmin, !input.grant)))
      .returning({ id: users.id });
    if (subject === undefined) return { ok: false, reason: `"${input.userId}" is not a user, or already has that setting.` };

    const notice = input.grant
      ? await notify(tx, { leagueId: null, userId: subject.id, noticeType: "admin_granted", context: { grantedByUserId: input.grantedBy }, occurredAt: clock.now(), auditEventId: null })
      : null;
    const event = await audit.record(tx, {
      eventType: "admin_action",
      actorId: input.grantedBy === BOOTSTRAP_ACTOR ? null : input.grantedBy,
      actorType: input.grantedBy === BOOTSTRAP_ACTOR ? "system" : "user",
      leagueId: null,
      payload: { action: input.grant ? "admin_granted" : "admin_revoked", subjectUserId: subject.id },
      occurredAt: clock.now(),
    });
    if (notice !== null) await attachAuditEvent(tx, notice, event.eventId);
    return { ok: true, userId: subject.id, isAdmin: input.grant };
  });
}
```

The `eq(users.isAdmin, !input.grant)` in the `UPDATE`'s own `WHERE` is the `removeReview` guard applied to a toggle: a second `--revoke` on an already-revoked account matches zero rows and reports that honestly instead of writing a duplicate audit event about a change that did not happen.

The bootstrap check is a separate statement inside the same transaction, and it is a check rather than a convention:

```ts
if (input.grantedBy === BOOTSTRAP_ACTOR) {
  const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.isAdmin, true)).limit(1);
  if (existing !== undefined) return { ok: false, reason: "This database already has an operator. Pass --by <their user id>." };
}
```

- [ ] **Step 5: Seed a local operator, and prove a non-admin reaches nothing**

`src/data/seed/` grants the existing seeded commissioner account operator access, so `npm run seed && npm run dev` produces a working queue with no manual step. That is not mock data: it is a real grant through `grantAdmin`, writing a real audit event and a real notice, which is exactly what the founder rule about mock data asks for.

The negative proof is a test, and it is deliberately written before any admin route exists so that every route added later inherits it:

```ts
it("gives an ordinary account no way to become an operator through the product", () => {
  // Every writer of users.is_admin, found by grep rather than by memory.
  const writers = grepSourceTree(/\bisAdmin\s*:/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$/ });
  expect(writers).toEqual(["src/db/schema.ts", "src/integrity-service/flags.ts"]);
  // …and the only caller of grantAdmin is the script.
  expect(grepSourceTree(/grantAdmin\(/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$/ }))
    .toEqual(["scripts/grant-admin.ts", "src/data/seed/index.ts", "src/integrity-service/flags.ts"]);
});
```

- [ ] **Step 6: Commit**

```bash
git add drizzle src/db src/lib/auth src/integrity src/integrity-service scripts src/data/seed package.json
git commit -m "feat(admin): the product's first authority beyond league membership

One boolean on users, one function beside requireCurrentUser, one operator script, and
deliberately no in-product way to grant it. The highest-privilege mutation in this codebase now
requires shell access to the database host rather than a session, which means requireAdmin has no
privilege-escalation path inside the app to get wrong.

The grant audits and notices, like every other operator action in this plan. A privilege that
arrives silently is a privilege nobody knows they are accountable for, so the granted account is
told in plain words what it can now see and that its decisions cannot be taken back.

--by bootstrap is checked rather than trusted: it is refused once any operator exists, so the
grant chain is walkable in the audit log from the first admin forward."
```

---

## Task 2: The flag store — one table, one vocabulary, and a name that is refused until somebody owns it

The spec asks for a `MultiAccountFlag` and a `TradeFairnessFlag`. Two tables would mean two queue queries, two detail views and two resolution paths for one workflow, and Plan C would add a third of each. This is **one** `integrity_flags` table with a `flag_type` discriminator (ruling 28), and the vocabulary that governs it is pure and lives in `src/integrity/flags.ts` with no database in it.

The sharpest decision in this task is what the resolution vocabulary contains. Founder decision #5 rules `ACCOUNT_RESTRICTED` out with the reason that *"an enum value with no implementation is a control wired to nothing."* Applied honestly, that reason also indicts `TRADE_REVERSED`, which the overview's default list keeps: this product cannot reverse a trade either, because it cannot make one. Ruling 2 states the test that separates them — a decision ships when it has an implementation, **or** it is declared with a named owning plan and refused at runtime, exactly the way Plan A reserved `trade_accepted`. `trade_reversed` has an owner. `account_restricted` has neither owner nor implementation, so it is not declared at all.

**Files:**
- Create: `src/integrity/flags.ts`, `src/integrity/flags.test.ts`
- Create: `drizzle/0023_integrity_flags.sql`
- Modify: `src/db/schema.ts`, `src/db/test-db.ts`, `src/db/index-plans.test.ts`
- Create: `src/integrity-service/flags.ts` (extends Task 1's file), `src/integrity-service/flags.test.ts`
- Modify: `src/integrity/config.ts`, `src/integrity-service/reserved.test.ts`, `src/integrity-service/lock-order.test.ts`

**Interfaces:**
- Consumes: `AuditLogger.record`, `DbTx`, `INTEGRITY_CONFIG`, `Clock`.
- Produces:
  - `FLAG_TYPES`, `FlagType`, `FLAG_SUBJECT_TYPES`, `FlagSubjectType`, `FLAG_STATUSES`, `FlagStatus`
  - `RESOLUTION_DECISIONS`, `ResolutionDecision`, `DECISION_OWNER`, `decisionIsAvailable(decision): boolean`
  - `integrityFlags` Drizzle table, `IntegrityFlag`
  - `raiseFlag(tx, input): Promise<RaiseFlagResult>`

Task 3 resolves what this raises; Tasks 4, 6 and 9 are its three callers; Plan C is the fourth.

- [ ] **Step 1: Write the failing vocabulary test**

`src/integrity/flags.test.ts`:

```ts
describe("the resolution vocabulary", () => {
  it("offers an operator only decisions this product can actually carry out", () => {
    expect(RESOLUTION_DECISIONS.filter(decisionIsAvailable)).toEqual(["no_action", "warned_user", "content_removed"]);
  });

  it("declares trade_reversed, names its owner, and refuses it today", () => {
    // The score.update precedent: reserved through one plan, turned on by name in the next.
    expect(RESOLUTION_DECISIONS).toContain("trade_reversed");
    expect(DECISION_OWNER.trade_reversed).toBe("plan-c");
    expect(decisionIsAvailable("trade_reversed")).toBe(false);
  });

  it("does not declare account_restricted at all", () => {
    // Founder decision 5. Unlike trade_reversed it has no owning plan, and the spec's own
    // out-of-scope list forbids any account action in this phase. A reserved name with no owner
    // is how a control wired to nothing gets wired to something by a reader who assumes intent.
    expect(RESOLUTION_DECISIONS as readonly string[]).not.toContain("account_restricted");
  });

  it("assigns every declared decision an owning plan, or fails to compile", () => {
    // DECISION_OWNER is an exhaustive Record over the union, so this assertion is belt to the
    // type system's braces and exists so the property is visible in the suite.
    expect(Object.keys(DECISION_OWNER).sort()).toEqual([...RESOLUTION_DECISIONS].sort());
  });
});

describe("the flag vocabulary", () => {
  it("names one flag type per detector, with its subject", () => {
    expect(FLAG_TYPES).toEqual(["multi_account", "review_report", "chat_report", "trade_fairness"]);
    expect(SUBJECT_OF.multi_account).toBe("account_pair");
    expect(SUBJECT_OF.trade_fairness).toBe("trade");
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then write `src/integrity/flags.ts`**

```ts
/**
 * The dispute queue's vocabulary. Pure: no database, no clock, no I/O. `src/integrity-service/
 * flags.ts` is what writes rows; this file is what decides which words exist.
 */
export const FLAG_TYPES = [
  /** Raised by this plan's detector, league-bounded, never platform-wide. */
  "multi_account",
  /** Raised by `reportReview`. `review_reports` stays the insert-only signal; this is the decision. */
  "review_report",
  /** Raised by `reportMessage`. Covers a GIF with no second path: a GIF is one chat_messages row. */
  "chat_report",
  /** RESERVED — Plan C raises this from its post-acceptance fairness check. */
  "trade_fairness",
] as const;

export const RESOLUTION_DECISIONS = [
  /** The operator looked and nothing needs to happen. Notices nobody, on purpose (ruling 6). */
  "no_action",
  /** The operator's own words reach the member as a notice. */
  "warned_user",
  /** The reported content is stamped removed in the same transaction as the decision. */
  "content_removed",
  /**
   * RESERVED — Plan C owns this. There is no trade in this product to reverse, so `resolveFlag`
   * refuses it and `decisionIsAvailable` returns false. Plan C turns it on by adding the subject
   * type and the reversal, together, in one commit. Compare `account_restricted`, which is not
   * declared at all: it has no owning plan, and the spec forbids account actions in this phase.
   */
  "trade_reversed",
] as const;

/** Which plan may exercise each decision. Exhaustive: a new decision without an owner will not compile. */
export const DECISION_OWNER: Readonly<Record<ResolutionDecision, "plan-b" | "plan-c">> = {
  no_action: "plan-b",
  warned_user: "plan-b",
  content_removed: "plan-b",
  trade_reversed: "plan-c",
};

export function decisionIsAvailable(decision: ResolutionDecision): boolean {
  return DECISION_OWNER[decision] === "plan-b";
}
```

- [ ] **Step 3: The table**

```ts
/**
 * One row per open question a human has to answer. ONE table for every detector rather than one
 * per detector (ruling 28): the queue read, the detail view and the resolution are one workflow,
 * and three copies of it is how three of them drift.
 *
 * The row carries what was true WHEN IT WAS RAISED and nothing else. A review's report count is
 * derived at read time from `review_reports`, because a report count per review is bounded and
 * `docs/decisions/data-layer-hardening.md` says to derive over a bounded set and roll up only
 * over an unbounded one (ruling 5). `evidence` is for facts a later read cannot recover: the
 * similarity scores that crossed the threshold, computed against session data that will have
 * moved on by the time an operator looks.
 *
 * Resolution is a STAMP with the no-re-stamp guard in the UPDATE's own WHERE, exactly as `reviews`
 * removal is (ruling 4). The immutable record of the decision is the `flag_resolved` audit event;
 * this row is the queue's index into it.
 */
export const integrityFlags = pgTable(
  "integrity_flags",
  {
    id: text("id").primaryKey(),
    flagType: text("flag_type").notNull(),
    subjectType: text("subject_type").notNull(),
    /** The reviewed thing. For `account_pair`, the two user ids joined low-id-first so the pair is canonical. */
    subjectId: text("subject_id").notNull(),
    /** Where it happened. NOT a chain scope: this row is not an audit event (ruling 1). */
    leagueId: text("league_id").references(() => leagues.id, { onDelete: "cascade" }),
    evidence: jsonb("evidence").$type<JsonObject>().notNull(),
    raisedAt: timestamp("raised_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByUserId: text("resolved_by_user_id").references(() => users.id),
    resolution: text("resolution"),
    resolutionNote: text("resolution_note"),
  },
  (t) => [
    /**
     * At most one OPEN flag per subject. A second report of the same message, or a second sweep
     * finding the same pair, is confirmation rather than a duplicate — the same property
     * `review_reports`' composite primary key already gives one reporter, lifted to the subject.
     * Partial on `resolved_at IS NULL` so a resolved flag never blocks a later one about the same
     * subject: content reported again after a `no_action` is a new question, not the old one.
     */
    uniqueIndex("integrity_flags_open_subject_idx")
      .on(t.subjectType, t.subjectId)
      .where(sql`${t.resolvedAt} is null`),
    /** The queue's only ordering: oldest first, open only (ruling 30). */
    index("integrity_flags_queue_idx").on(t.raisedAt).where(sql`${t.resolvedAt} is null`),
  ],
);
```

`src/db/test-db.ts`'s `truncateAll` list is hand-maintained and gains `integrity_flags` in the same commit. Forgetting it does not fail loudly; it bleeds rows between test files, and `fileParallelism: false` makes that bleed deterministic and therefore easy to mistake for a real result.

`src/db/index-plans.test.ts` gains a `pg_indexes` assertion for both indexes, in the typed `db.execute<{ indexname: string; indexdef: string }>` form the `audit_events` block already uses, asserting the `WHERE (resolved_at IS NULL)` predicate is actually on disk rather than only in the Drizzle definition.

- [ ] **Step 4: `raiseFlag`, and the chain it appends to**

```ts
/**
 * Raise a flag. Idempotent on the open-subject index: a second call about the same open subject
 * returns the existing flag rather than failing or duplicating, because a second report IS
 * confirmation and a second detector run finding the same pair is not news.
 *
 * The audit event goes on the PLATFORM chain, never a league chain (ruling 1). A record about a
 * person under review is not the league's business, and `audit_events.league_id` is what decides
 * chain scope (`scopeFor`), so the league id lives in the payload instead. The consequence is
 * deliberate: `flag_raised` cannot appear in any league activity feed even if a future author
 * flips its `ACTIVITY_VISIBILITY`, because platform-chain events are never read by
 * `listLeagueActivity` at all.
 */
export async function raiseFlag(tx: DbTx, input: RaiseFlagInput): Promise<IntegrityFlag> {
  const [row] = await tx
    .insert(integrityFlags)
    .values({ id: input.newId(), flagType: input.flagType, subjectType: SUBJECT_OF[input.flagType], subjectId: input.subjectId, leagueId: input.leagueId, evidence: input.evidence, raisedAt: new Date(input.occurredAt) })
    .onConflictDoNothing({ target: [integrityFlags.subjectType, integrityFlags.subjectId], targetWhere: isNull(integrityFlags.resolvedAt) })
    .returning();

  if (row === undefined) return existingOpenFlagFor(tx, input);   // the confirmation path: no second event

  await audit.record(tx, {
    eventType: "flag_raised",
    actorId: input.raisedByUserId,             // a reporter, or null when the platform's own sweep raised it
    actorType: input.raisedByUserId === null ? "system" : "user",
    leagueId: null,                            // platform chain — ruling 1
    payload: { flagId: row.id, flagType: row.flagType, subjectType: row.subjectType, leagueId: input.leagueId },
    occurredAt: input.occurredAt,
  });
  return toFlag(row);
}
```

Two properties the tests must pin, because both are the kind that look fine until they are load-bearing:

```ts
it("returns the open flag and writes no second event when the same subject is reported twice", async () => { /* one row, one flag_raised */ });

it("raises a NEW flag for a subject whose previous flag was resolved", async () => {
  // The partial unique index is on open flags only. Content reported again after a no_action is a
  // new question, and an operator who answered the old one must not be answering it a second time.
});
```

- [ ] **Step 5: Move the reserved entry and extend the lock-order proof**

`src/integrity-service/reserved.test.ts` holds an exhaustive `OWNER` record and greps production sources; `flag_raised` moves from reserved to published in this commit and `admin_action` moved in Task 1. That test **fails until they do**, which is the point of it. `flag_resolved` stays reserved until Task 3.

`src/integrity-service/lock-order.test.ts` gains this plan's first transaction. The order is Plan A's one global order and there is no local variation of it: business rows first, then any notice insert (it takes `FOR KEY SHARE` on `users` and `leagues`), then the anchor, then `attachAuditEvent`, then commit. `raiseFlag`'s insert takes `FOR KEY SHARE` on `leagues` through its foreign key, which is why it precedes the anchor and not the other way round.

- [ ] **Step 6: Commit**

---

## Task 3: `resolveFlag` — one way, once, and the audit event is the record

A resolution is the moment this plan exists for: a report or a suspicion becomes a decision with a name on it. Three properties make it trustworthy and all three are enforced in SQL or in the type system rather than by the caller being careful. It is **one way** (only from open to resolved, never back). It is **once** (the guard is in the `UPDATE`'s own `WHERE`, so two operators clicking at the same moment serialize on the row lock and the second matches zero rows). And the **record of it is the audit event**, not the row — the row is the queue's index into the record.

The spec says resolution *"never mutates the original flag."* A stamp is that claim in the only sense that matters and is the shape this codebase has already chosen twice (`reviews.removed_at`, `stat_weeks.version`): no fact is overwritten, the guard makes it single-shot, and the alternative — deriving status from a separate resolutions table — costs a join on every queue read for a relation bounded at one (ruling 4).

**Files:**
- Modify: `src/integrity-service/flags.ts` (+ its test), `src/integrity-service/schemas.ts`
- Modify: `src/integrity/notices.ts` (+ its test), `src/integrity-service/notify.ts` (`quoteFor`), `src/integrity-service/reserved.test.ts`, `src/integrity-service/lock-order.test.ts`

**Interfaces:**
- Consumes: `raiseFlag`'s table, `decisionIsAvailable`, `notifyAffectedMember`, `AuditLogger`.
- Produces: `resolveFlag(db, input): Promise<ResolveFlagResult>`, `NoticeContexts.operator_warning`, `resolveFlagSchema`.

Task 5's route is its only HTTP caller; Tasks 4 and 6 supply the `content_removed` implementations.

- [ ] **Step 1: Write the failing resolution tests**

```ts
it("records a decision, stamps the flag once, and writes the audit event that IS the record", async () => {
  const flag = await openFlag(db, { flagType: "review_report" });
  const result = await resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "Two reports, both from the same league, review reads as a real opinion.", operatorUserId: "u_op" });
  expect(result.ok).toBe(true);

  const events = await auditEventsOn(db, "platform", "flag_resolved");
  expect(events).toHaveLength(1);
  expect(events[0]!.payload).toMatchObject({ flagId: flag.id, decision: "no_action" });
  expect(events[0]!.actorId).toBe("u_op");
});

it("refuses a second decision on the same flag, and says which one already stands", async () => {
  const flag = await openFlag(db, { flagType: "review_report" });
  await resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "n", operatorUserId: "u_op" });
  const second = await resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "n", operatorUserId: "u_two" });
  expect(second).toEqual({ ok: false, status: 409, reason: 'That flag was already resolved as "no action". A different decision is a new flag, not an edit.' });
});

it("serializes two operators resolving at the same instant, and exactly one wins", async () => {
  // The guard is in the UPDATE's own WHERE. A prior read would let both pass it.
  const flag = await openFlag(db, { flagType: "chat_report" });
  const [a, b] = await Promise.all([resolveFlag(db, { flagId: flag.id, decision: "no_action", ... }), resolveFlag(db, { flagId: flag.id, decision: "warned_user", ... })]);
  expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(1);
});

it("refuses a decision no plan in this phase owns", async () => {
  const flag = await openFlag(db, { flagType: "review_report" });
  const result = await resolveFlag(db, { flagId: flag.id, decision: "trade_reversed", note: "n", operatorUserId: "u_op" });
  expect(result).toEqual({ ok: false, status: 400, reason: "This product can't reverse a trade yet." });
  expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(0);
});

it("tells the member in the operator's own words when the decision is a warning", async () => {
  const flag = await openFlag(db, { flagType: "chat_report", subjectAuthor: "u_member", leagueId: "lg_1" });
  await resolveFlag(db, { flagId: flag.id, decision: "warned_user", note: "Keep the trash talk about the teams.", operatorUserId: "u_op" });
  const [notice] = await noticesFor(db, "u_member");
  expect(notice!.noticeType).toBe("operator_warning");
  expect(notice!.context).toMatchObject({ note: "Keep the trash talk about the teams." });
  expect(copyViolations(`${notice!.title} ${notice!.body}`)).toEqual([]);
});

it("tells NOBODY when the decision is no_action", async () => {
  // Ruling 6, and the one deliberate exception to this plan's own rule that every operator action
  // notices the affected member. An investigation that closed with nothing happening is not an
  // event in that member's life, and "we looked into you and found nothing" is precisely the
  // accusation INTEGRITY_CONFIG.notices.accusatoryTerms exists to keep out of this product.
  const flag = await openFlag(db, { flagType: "multi_account", subjectAuthor: "u_member" });
  await resolveFlag(db, { flagId: flag.id, decision: "no_action", note: "Roommates. Same wifi, different drafts.", operatorUserId: "u_op" });
  expect(await noticesFor(db, "u_member")).toEqual([]);
  expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(1);   // the record still exists
});
```

- [ ] **Step 2: Run them, watch them fail, then write `resolveFlag`**

```ts
/**
 * ONE WAY, ONCE, AND THE AUDIT EVENT IS THE RECORD.
 *
 * The note is the operator's own words and reaches the member verbatim when the decision is
 * `warned_user`, the same call `removalPhraseFor` already made in Phase 2: an operator writing
 * copy a member reads should know they are doing it, which is why `scripts/grant-admin.ts` and
 * the resolution form both preview the rendered notice before anything is written.
 *
 * There is NO appeal path (founder decision 4), and the notice says where the decision came from
 * rather than implying a reply channel that does not exist.
 */
export async function resolveFlag(db: Db, input: ResolveFlagInput): Promise<ResolveFlagResult> {
  if (!decisionIsAvailable(input.decision)) return { ok: false, status: 400, reason: UNAVAILABLE_DECISION[input.decision] };
  if (input.note.length > INTEGRITY_CONFIG.moderation.noteMaxLength) return { ok: false, status: 400, reason: `Keep the note to ${INTEGRITY_CONFIG.moderation.noteMaxLength} characters or fewer. The member reads it.` };

  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(integrityFlags)
      .set({ resolvedAt: now, resolvedByUserId: input.operatorUserId, resolution: input.decision, resolutionNote: input.note })
      .where(and(eq(integrityFlags.id, input.flagId), isNull(integrityFlags.resolvedAt)))
      .returning();
    if (row === undefined) return alreadyResolvedOrMissing(tx, input.flagId);

    // content_removed performs the removal INSIDE this transaction, so a decision and its
    // consequence cannot come apart. Tasks 4 and 6 supply the two removers.
    const removed = input.decision === "content_removed" ? await removeSubject(tx, row, input) : null;
    if (removed !== null && !removed.ok) return removed;

    const notice = NOTICE_FOR_DECISION[input.decision] === null ? null : await notify(tx, { ... });
    const event = await audit.record(tx, {
      eventType: "flag_resolved",
      actorId: input.operatorUserId,
      actorType: "user",
      leagueId: null,                                    // platform chain — ruling 1
      payload: { flagId: row.id, flagType: row.flagType, decision: input.decision, subjectType: row.subjectType, subjectId: row.subjectId, leagueId: row.leagueId },
      occurredAt: input.occurredAt,
    });
    if (notice !== null) await attachAuditEvent(tx, notice, event.eventId);
    return { ok: true, flagId: row.id, decision: input.decision };
  });
}
```

`NOTICE_FOR_DECISION` is an exhaustive `Record<ResolutionDecision, NoticeType | null>`, so a decision added later cannot silently inherit "tell nobody" — it has to be decided, which is the same deny-by-default shape `ACTIVITY_VISIBILITY` uses and for the same reason.

- [ ] **Step 3: The warning notice and its quote**

```ts
operator_warning: ({ leagueName }) => ({
  title: "An operator left you a note",
  body: `Somebody reported something you posted in ${leagueName}. An operator read it, decided to leave your post up, and wrote you this note. There is no reply to this message.`,
}),
```

`quoteFor` (`src/integrity-service/notify.ts`) learns `operator_warning` and returns `context.note`, so the operator's words render as the bounded blockquote the persona panel asked for in Plan A's Task 10 rather than as a dense inline sentence. The last sentence is not a flourish: founder decision #4 rules there is no appeal path, and a notice that does not say so invites a member to look for one.

- [ ] **Step 4: Move the second reserved entry, extend the lock-order proof, commit**

`flag_resolved` moves in `reserved.test.ts`. `lock-order.test.ts` gains the resolution transaction, including the `content_removed` variant once Tasks 4 and 6 land — the removal `UPDATE` takes a row lock on `reviews`/`chat_messages` and it must precede the notice, which must precede the anchor.

---

## Task 4: Residual — the review report queue's first consumer

`review_reports` has been accumulating rows since Phase 2 Plan C and **nothing has ever read them**. `identity-and-trust.md` names the gap and assigns it here. This task closes it in the smallest honest way: `reportReview` additionally raises a `review_report` flag into the queue Task 2 built, and `removeReview` becomes reachable from `resolveFlag` as well as from the script. The script stays — it is the pattern this tooling mirrors, and an operator locked out of the web app still needs it — but it stops being the only path.

The **shared vocabulary** moves in this task, because founder decision #2's default is *"mirror `reviews`' existing closed set exactly; one vocabulary, two record types"* and two record types cannot share a vocabulary that lives in one of them. `src/moderation/**` is a new pure, browser-safe directory holding the one closed reason set and its two mappers; `REVIEW_CONFIG.reportReasons` re-exports from it so every existing consumer (`reportReviewSchema`'s `z.enum`, `ReviewComposer`, `scripts/remove-review.ts`) keeps working unchanged against a single source (ruling 21).

**Files:**
- Create: `src/moderation/config.ts`, `src/moderation/removal.ts`, `src/moderation/removal.test.ts`
- Modify: `src/reviews/config.ts` (+ its test), `src/review-service/reviews.ts` (+ its test), `src/review-service/schemas.ts`
- Modify: `src/integrity-service/flags.ts` (`removeSubject`'s review branch), `eslint.config.mjs` (`@/moderation` joins the client-boundary **exempt** list)

**Interfaces:**
- Consumes: `raiseFlag`, `resolveFlag`, `removeReview`, `REVIEW_CONFIG`.
- Produces:
  - `MODERATION_CONFIG`, `REMOVAL_REASON_VALUES`, `isRemovalReason`, `removalPhraseFor`, `removalSentenceFor`
  - `RemoveReviewInput` gains an optional `flagId`
  - `ReportReviewResult` unchanged on the wire

- [ ] **Step 1: Write the failing single-source test**

`src/moderation/removal.test.ts`, and a matching assertion in `src/reviews/config.test.ts`:

```ts
it("is the only place the removal vocabulary is written down", () => {
  // Founder decision 2: one vocabulary, two record types. A second literal list anywhere is the
  // thing this test exists to make impossible, so it greps rather than trusting the import graph.
  const literals = grepSourceTree(/"abusive"/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$/ });
  expect(literals).toEqual(["src/moderation/config.ts"]);
});

it("keeps reviews' shipped vocabulary byte for byte, because members have already read it", () => {
  expect(REVIEW_CONFIG.reportReasons).toEqual([
    { value: "spam", label: "Spam or fake", removalPhrase: "spam or fake content" },
    { value: "abusive", label: "Abusive or harassing", removalPhrase: "abusive or harassing content" },
    { value: "other", label: "Something else", removalPhrase: "breaking the review rules" },
  ]);
});

it("narrows REMOVAL_REASON_VALUES from string to the closed union", () => {
  // The shipped array is typed `readonly string[]`, which widens and lets a typo past the
  // compiler at every call site. `isRemovalReason` is the guard the script and the route both use.
  expect(isRemovalReason("spam")).toBe(true);
  expect(isRemovalReason("Spam")).toBe(false);
  expect(isRemovalReason("harassment")).toBe(false);
});
```

- [ ] **Step 2: Move the vocabulary, keep the callers**

`src/moderation/config.ts` holds the array; `src/reviews/config.ts` becomes `reportReasons: MODERATION_CONFIG.reasons` inside the existing `REVIEW_CONFIG` object, and `removalPhraseFor`/`removalSentenceFor` re-export from `src/moderation/removal.ts`. Nothing else changes: the point of a re-export here is that the diff at every consumer is zero, which is what makes this a de-duplication rather than a refactor.

`src/moderation/**` joins `eslint.config.mjs`'s **exempt** list beside `src/chat`, `src/matchmaking`, `src/identity`, `src/help` and `src/reviews`. It has to: the chat report dialog in `src/chat-room/**` needs the labels as values, and `src/integrity/**` is on the blocked list precisely because it is not browser-safe. Two directories, two boundaries, and ruling 21 says why they are not one.

- [ ] **Step 3: `reportReview` raises a flag**

```ts
it("raises exactly one open flag however many people report the same review", async () => {
  await reportReview(db, { reviewId: "r_1", reporterUserId: "u_a", reason: "spam" });
  await reportReview(db, { reviewId: "r_1", reporterUserId: "u_b", reason: "abusive" });
  const flags = await openFlags(db);
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ flagType: "review_report", subjectType: "review", subjectId: "r_1" });
  // Both reports are still rows in review_reports: that table stays the insert-only signal and
  // this row is the decision. The queue derives the count, it does not store it (ruling 5).
  expect(await reportCount(db, "r_1")).toBe(2);
});

it("still treats a second report from the SAME reporter as confirmation, not an error", async () => {
  // The behavior Phase 2 shipped on the composite primary key, unchanged by the flag.
  await reportReview(db, { reviewId: "r_1", reporterUserId: "u_a", reason: "spam" });
  expect(await reportReview(db, { reviewId: "r_1", reporterUserId: "u_a", reason: "spam" })).toEqual({ ok: true });
  expect(await openFlags(db)).toHaveLength(1);
});
```

The flag insert joins `reportReview`'s existing transaction — the report row and the flag commit together or neither does, because a report that produced no queue entry is exactly the silence this residual exists to end.

- [ ] **Step 4: `resolveFlag`'s review branch**

`removeSubject`'s `review` case calls the existing `removeReview` **inside `resolveFlag`'s transaction**, passing the operator as `removedByUserId` and the operator's chosen reason. `removeReview` already writes its own `review_removed` audit event and its own `review_removed` notice with the author's own text preserved; nothing about that path changes, which is the whole reason Phase 2 built it as a stamp.

One real seam has to move: `removeReview` currently opens its own `db.transaction`, and a transaction inside a transaction is a savepoint with different failure semantics. Extract the body to `removeReviewInTx(tx, input)` and let `removeReview(db, input)` be `db.transaction((tx) => removeReviewInTx(tx, input))` — the same two-door shape `joinLeagueInTx` already uses for exactly this reason, and `src/review-service` is a gated directory so both doors are covered by construction.

```ts
it("removes the review and resolves the flag in one transaction, or neither", async () => {
  const flag = await reportedReview(db, { reviewId: "r_1", authorUserId: "u_author" });
  await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op" });
  expect(await isRemoved(db, "r_1")).toBe(true);
  expect((await noticesFor(db, "u_author"))[0]!.noticeType).toBe("review_removed");
});

it("leaves the flag open when the removal itself fails", async () => {
  // Already removed by the script a minute earlier: removeReview's own WHERE matches zero rows.
  const flag = await reportedReview(db, { reviewId: "r_1", alreadyRemoved: true });
  const result = await resolveFlag(db, { flagId: flag.id, decision: "content_removed", note: "spam", operatorUserId: "u_op" });
  expect(result.ok).toBe(false);
  expect(await isOpen(db, flag.id)).toBe(true);
  expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(0);
});
```

- [ ] **Step 5: Commit**

---

## Task 5: The queue — the surface an operator actually works, and the two field sets that prove the allowlist

The spec asks for a list filtered by status and sorted oldest-first, a detail view with full context and the relevant audit trail, and a test proving raw investigatory fields reach the admin view and not the member feed. This task builds all three, and it makes the third one provable by putting the admin field set in its own named module (`src/integrity/queue-view.ts`) opposite Plan A's member field set (`src/integrity/activity-view.ts`), so the proof compares two modules rather than scraping two rendered pages (ruling 16).

The route guard is the other half of the task and it is treated as a security surface in its own right, because it is one: this is the highest-value target in the codebase and it is landing before Phase 2 Plan D's hardening. The guard is `withAdmin`, it answers **404 and not 403** (ruling 14), and a contract test enumerates the admin route tree and fails if any file in it does not go through the seam.

**Files:**
- Create: `src/integrity/queue-view.ts`, `src/integrity/queue-view.test.ts`
- Modify: `src/integrity-service/flags.ts` (+ its test) — `listPendingFlags`, `flagDetail`, `pendingFlagQuery`
- Create: `src/app/api/admin/_shared.ts`, `src/app/api/admin/_shared.test.ts`
- Create: `src/app/api/admin/flags/[flagId]/resolve/route.ts`
- Create: `src/app/app/admin/queue/page.tsx` (+ its test), `src/app/app/admin/queue/[flagId]/page.tsx` (+ its test)
- Create: `src/app/app/admin/admin-routes.test.ts` (the route-tree contract)
- Modify: `src/components/app-shell/app-header.tsx` (+ its test), `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `requireAdmin`, `resolveFlag`, `listPendingFlags`, `flagDetail`, `listLeagueActivity`'s `buildActivityNames`, `Card`, `Badge`, `EmptyState`, `ErrorState`, `Icon`, `PageTitle`.
- Produces: `QueueRow`, `FlagDetail`, `queueRowFor`, `flagDetailFor`, `withAdmin`, `resolveFlagSchema`.

- [ ] **Step 1: Write the failing guard tests first**

`src/app/api/admin/_shared.test.ts`:

```ts
it("answers 404 to a signed-in non-operator, never 403", async () => {
  // The codebase's non-oracle discipline, the same reason publicJoinPrecondition and the league
  // page answer 404 for a stranger. A 403 tells somebody probing that they found the admin
  // surface and only need a session; a 404 tells them nothing they did not already have.
  const response = await withAdmin(requestFrom("u_plain"), () => ok({}));
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ ok: false, error: "Not found." });
});

it("answers 401 to a signed-out caller, because that IS the distinction worth making", async () => {
  const response = await withAdmin(requestFrom(null), () => ok({}));
  expect(response.status).toBe(401);
});

it("never runs the handler for a non-operator", async () => {
  const handler = vi.fn();
  await withAdmin(requestFrom("u_plain"), handler);
  expect(handler).not.toHaveBeenCalled();
});
```

`src/app/app/admin/admin-routes.test.ts` — the contract that keeps it true as routes are added:

```ts
it("routes every file under the admin tree through the one gate", () => {
  // Recursive, .test excluded and nothing else — advisory-only.test.ts's shape, whose own history
  // is that both of its earlier holes were name-based carve-outs.
  const files = sourceFiles(["src/app/app/admin", "src/app/api/admin"]);
  expect(files.length).toBeGreaterThan(3);          // never vacuous
  const ungated = files.filter((f) => !f.endsWith("_shared.ts") && !/requireAdmin\(|withAdmin\(/.test(read(f)));
  expect(ungated).toEqual([]);
});

it("keeps the operator gate out of every non-admin route", () => {
  // The inverse claim, and the one a future author is likelier to break: requireAdmin appearing
  // on an ordinary member route would be an authorization change nobody reviewed.
  expect(grepSourceTree(/requireAdmin\(/, { dirs: ["src"], exclude: /\.test\.tsx?$|^src\/app\/(app|api)\/admin\// }))
    .toEqual(["src/lib/auth/current-user.ts", "src/app/api/admin/_shared.ts"]);
});
```

- [ ] **Step 2: The two field sets, and the proof between them**

`src/integrity/queue-view.ts` is pure and is the admin counterpart to `activity-view.ts`:

```ts
/**
 * What an operator sees. The deliberate opposite number of `activity-view.ts`, which decides what
 * a MEMBER sees, and the reason the spec's exit criterion is provable: two named modules with two
 * field sets over the same underlying rows, rather than two page renders to scrape.
 *
 * The asymmetry is the product. `evidence` carries the raw similarity scores that raised a
 * multi-account flag, and no path exists from an audit event to a member-facing row that could
 * carry them: `flag_raised` is platform-chain-scoped, so `listLeagueActivity` never reads it at
 * all, and `ACTIVITY_VISIBILITY.flag_raised` is `hidden` besides. Two independent reasons, because
 * one of them is a one-line change away from being wrong.
 */
export interface FlagDetail {
  readonly flagId: string;
  readonly flagType: FlagType;
  readonly raisedAt: string;
  readonly subject: FlagSubjectView;          // the reported content, or the account pair
  readonly evidence: JsonObject;              // raw. admin-only. never leaves this module's consumers
  readonly reporters: readonly ReporterView[];// derived at read time (ruling 5)
  readonly trail: readonly ActivityRow[];     // the relevant audit sequence
  readonly decisions: readonly ResolutionDecision[];  // only those decisionIsAvailable() allows
}
```

The proof, in `src/integrity/queue-view.test.ts`:

```ts
it("puts the raw similarity scores in the operator's view and nowhere a member can reach", () => {
  const event = flagRaisedEvent({ evidence: { device: 0.94, behavioral: 0.81 } });
  expect(flagDetailFor(flag, ...).evidence).toMatchObject({ device: 0.94, behavioral: 0.81 });
  // The member side of the same claim, run against Plan A's module rather than restated:
  expect(activityRowFor(event, { userId: "u_member" }, names)).toBeNull();
  expect(ACTIVITY_VISIBILITY.flag_raised).toBe("hidden");
});

it("offers an operator no decision this product cannot carry out", () => {
  expect(flagDetailFor(flag, ...).decisions).not.toContain("trade_reversed");
});
```

- [ ] **Step 3: The read model**

`listPendingFlags(db, { limit, before })` is open-only, oldest-first (ruling 30: no severity sort — a severity ordering over a heuristic score is the platform quietly telling an operator which accusations to believe), served by `integrity_flags_queue_idx`. `pendingFlagQuery` is exported for inspection, mirroring `feedQuery` and `browseQuery`, and its test asserts the **table set** it touches with the `tablesIn(sql)` helper `reviews.test.ts` already uses — a stronger claim than "no field leaked" because the fields are not fetched to leak.

`flagDetail(db, flagId)` is bounded: one flag, its subject, its reporters, and the relevant audit trail read from the platform chain by `flagId` plus, where the subject has one, the league chain's events for that subject. Query count is asserted with `countingDb`.

- [ ] **Step 4: The surfaces**

`/app/admin/queue` and `/app/admin/queue/[flagId]` are Server Components: `requireAdmin`, then the read, then render. Both use existing primitives only, and every glyph is already in `ICONS`.

The queue list shows, per row: what kind of question it is in plain words ("A member reported a message"), who or what it is about, how long it has been waiting, and nothing that pre-judges it. The empty state is the state an operator sees most and it still may not be a dead end: it says the queue is clear and links to the activity feed of the most recently active league, because "nothing to do" and "nothing is happening" are different facts and an operator wants to tell them apart.

The detail page shows the evidence, the reporters, the audit trail, and a decision form that **previews the exact notice the member will receive** before it is submitted — the same discipline `scripts/remove-review.ts` established, moved into the product. A one-way decision that a person reads about should not be the first time the operator sees the words.

Loading, empty, error and success states are all designed; both themes via `inBothThemes`; `axe` clean; the primary flow (open the queue, open a flag, choose a decision, submit) is walked keyboard-only; 360px is in `e2e/mobile-360.spec.ts`'s route list, because an operator triaging on a phone at 11pm is the realistic case and not the exotic one.

Component-authored strings go into `src/integrity/rendered-copy.test.tsx` as a new `describe` block, which is the per-surface sweep Plan A built for exactly this: *"adding a surface here is one `describe` block, which is the point."*

- [ ] **Step 5: The resolve route**

`POST /api/admin/flags/[flagId]/resolve`, in the fixed order every route in this codebase uses: `withAdmin` → rate limit → `await params` → `parseJson(request, resolveFlagSchema)` → `resolveFlag` → `fail`/`ok`. The schema is Zod v4 with `z.enum(RESOLUTION_DECISIONS)` narrowed by `.refine(decisionIsAvailable)` so an unavailable decision is a 400 naming the field rather than a service-layer rejection, and the note has `MODERATION_CONFIG.noteMaxLength` from config.

- [ ] **Step 6: PERSONA PANEL — the operator (controller step)**

The controller runs the panel. The overview said the admin views are not persona surfaces; ruling 27 overrules it, and this is the panel that shows why. Specific things to put in front of it:

- **The operator, at volume.** The queue is oldest-first with no severity sort and no bulk action. Is that discipline or is it an operator who stops reading carefully at flag forty? What does the surface do when the queue has two hundred rows, and is "nothing that pre-judges it" still right then?
- **The operator, on irreversibility.** A decision cannot be taken back and a corrected decision is a new flag. Does the form make that plain enough *before* the click, and is the notice preview enough, or does this need a confirm step like the scripts have?
- **The accused member, reading afterwards.** They see a warning with an operator's note and no reply channel. Founder decision #4 rules there is no appeal. Does the copy say so honestly, or does it read as though somebody forgot to build the reply box?
- **The reporter, waiting.** They reported a review or a message and will never be told what happened, by design (telling a reporter the outcome tells them the outcome of a decision about somebody else). Is silence acceptable, or does the reporter need "we got it" at the moment of reporting to stop them reporting four more times?
- **The first-timer, on `no_action`.** Ruling 6 says nobody is told. Confirm out loud that the panel agrees a member should never learn they were reviewed and cleared.

Anything the panel raises that is out of scope goes to the ledger for Plan C or Plan D, named, rather than being built here.

- [ ] **Step 7: Commit**

---

## Task 6: Residual — chat gets the removal path it has never had

`identity-and-trust.md` records this as the larger of the two moderation gaps and says why: *"A posted message or GIF in a league chat cannot be deleted, hidden or reported by anyone: not its author, not the commissioner, not the operator."* Phase 2 opened the higher-volume user-content surface, complete with an open GIF search, without the removal path the lower-volume one got, and said so in writing rather than leaving it to be found in a real league.

This task is that path, and it mirrors `reviews` deliberately: a **stamp**, never a delete (author, text, remover, reason and time all preserved), the no-re-stamp guard in the `UPDATE`'s own `WHERE`, the author told in the operator's own words. GIFs need no second code path at all — a GIF is one `chat_messages` row (`identity-and-trust.md`'s ruling 17), so the stamp covers them by construction, which is the whole reason founder decision #1 could keep the pg-13 ceiling and document it as unreviewed rather than blocking on it (ruling 20).

Where chat **diverges** from reviews is the read: a removed review vanishes from the feed, and a removed message may not. A conversation with a hole in it is a conversation everybody misreads, and the members who saw the message before it went already know it existed. The removed state renders in place (ruling 18).

**Files:**
- Create: `drizzle/0024_chat_moderation.sql` (hand-finished — the covering index)
- Modify: `src/db/schema.ts`, `src/db/test-db.ts`, `src/db/index-plans.test.ts`
- Modify: `src/moderation/config.ts` (chat report rate limits), `src/chat/config.ts`, `src/chat/contract.ts`, `src/chat/messages.ts` (+ their tests)
- Create: `src/chat-service/moderation.ts` (+ its test); Modify: `src/chat-service/chat.ts` (+ its test), `src/chat-service/index.ts`
- Create: `src/app/api/leagues/[leagueId]/chat/[messageId]/report/route.ts`, `src/app/api/leagues/[leagueId]/chat/_shared.ts`
- Create: `src/chat-room/components/removed-message.tsx`, `src/chat-room/components/report-dialog.tsx` (+ their tests)
- Modify: `src/chat-room/components/message-list.tsx` (+ its test), `src/integrity/notices.ts`, `src/integrity-service/flags.ts` (`removeSubject`'s chat branch)

**Interfaces:**
- Consumes: `raiseFlag`, `resolveFlag`, `MODERATION_CONFIG`, `removalPhraseFor`, `notifyAffectedMember`, `AuditLogger`.
- Produces: `chat_messages` removal columns, `chat_message_reports`, `reportMessage`, `removeChatMessageInTx`, `ChatMessageView.removal`, `NoticeContexts.chat_message_removed`.

- [ ] **Step 1: Write the failing migration-safety test FIRST**

This is the one migration in this repo that has bitten before, and the test comes before the migration on purpose.

```ts
it("keeps chat_messages_league_id_idx covering after this migration too", async () => {
  const rows = await db.execute<{ indexname: string; indexdef: string }>(
    sql`SELECT indexname, indexdef FROM pg_indexes WHERE indexname = 'chat_messages_league_id_idx'`,
  );
  // 0018 added INCLUDE (body) by hand because drizzle-orm's index() builder cannot express it,
  // and 0017's six nullable columns had already tipped the planner off this index once. Three
  // more columns is the same risk with the same fix, and the fix is only real if the read
  // actually needs them: ChatMessageView now carries the removed state, so it does.
  expect(rows[0]!.indexdef).toContain("INCLUDE (body, removed_at, removal_reason)");
});

it("still chooses an Index-Only Scan for a league's chat page over the 20,000-row corpus", async () => {
  // The existing assertion, unchanged, re-run against the widened row. If it fails, the answer is
  // the INCLUDE list, never deleting the assertion.
  expect(indexScanNode(await explainChatPage(db), "chat_messages_league_id_idx")).toBeDefined();
});
```

`removed_by_user_id` is deliberately **not** in the `INCLUDE` list and not on `ChatMessageView`: which operator removed a message is an operator fact, and the fewer columns in a covering index the longer it stays chosen.

- [ ] **Step 2: The migration, hand-finished**

Generate, then read the generated SQL and fix it — `drizzle-kit generate` will drop and recreate the index from the Drizzle definition, which cannot express `INCLUDE`. The committed file ends:

```sql
ALTER TABLE "chat_messages" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "removed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD COLUMN "removal_reason" text;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_removed_by_user_id_users_id_fk"
  FOREIGN KEY ("removed_by_user_id") REFERENCES "public"."users"("id");--> statement-breakpoint
CREATE TABLE "chat_message_reports" (
  "message_id" bigint NOT NULL REFERENCES "chat_messages"("id") ON DELETE CASCADE,
  "reporter_user_id" text NOT NULL REFERENCES "users"("id"),
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chat_message_reports_pkey" PRIMARY KEY ("message_id","reporter_user_id")
);--> statement-breakpoint
-- Hand-written, exactly as 0018 was and for the same reason: drizzle-orm's index() builder has no
-- .include() API, so a generated recreation of this index silently drops the clause. Widened with
-- the two removal columns the chat page now reads. src/db/index-plans.test.ts asserts this back
-- out of pg_indexes rather than trusting this file to still be what is on disk.
DROP INDEX "chat_messages_league_id_idx";--> statement-breakpoint
CREATE INDEX "chat_messages_league_id_idx" ON "chat_messages"
  USING btree ("league_id","id") INCLUDE ("body","removed_at","removal_reason");
```

`chat_message_reports` copies `review_reports` exactly, composite PK included, so a second click from the same reporter is confirmation rather than a duplicate. `truncateAll`'s hand-maintained list gains it.

- [ ] **Step 3: The view, the fold, and the removed state**

`ChatMessageView` gains one nullable field rather than three loose ones, so an unremoved message cannot be half-removed in the type:

```ts
/**
 * Null for a message that stands. Populated for one that an operator removed, and the message
 * still renders: a removed review vanishes from its feed, but a conversation with a hole in it is
 * a conversation everybody misreads, and the members who saw it already know it existed.
 *
 * `body` is NOT sent for a removed message. The row keeps it (the author's words are preserved
 * exactly, the same as a removed review) and the wire does not carry it.
 */
readonly removal: { readonly at: string; readonly phrase: string } | null;
```

`phrase` is `removalPhraseFor(reason)` resolved server-side, so the closed vocabulary reaches the browser as words rather than as a token the client would have to map — the mapping lives in `src/moderation/**` and both consumers call it, not one each.

`src/chat/messages.ts` is gated at 100%, and `mergeMessages` is last-write-wins per field by id. A live `chat.message` frame carrying the removal folds in correctly; an **older** frame re-sent afterwards would un-remove it. That is not hypothetical — the composer's optimistic path and the SSE fold both write into the same held list — so it gets a test that names the hazard:

```ts
it("never un-removes a message when an older copy of it arrives late", () => {
  const held = [message({ id: "7", removal: { at: "2026-08-20T00:00:00.000Z", phrase: "spam or fake content" } })];
  expect(mergeMessages(held, [message({ id: "7", removal: null })])[0]!.removal).not.toBeNull();
});
```

`RemovedMessage` renders in place of the body: the author's name and avatar stay (attribution is not the thing being removed), the words are gone, and the reason is stated in the closed vocabulary's own phrase. It is rendered by `message-list.tsx`, which is mounted in **two** places — `league-home.tsx` and `draft-room.tsx` — and both are covered.

- [ ] **Step 4: Report and remove**

`reportMessage(db, input)` mirrors `reportReview` line for line: idempotent insert on the composite PK, `raiseFlag` of type `chat_report` in the same transaction, `POST /api/leagues/[leagueId]/chat/[messageId]/report` gated by `withLeagueMemberActor` (you may report what you can see, and only that) and rate-limited from `MODERATION_CONFIG.reportRateLimit`.

`removeChatMessageInTx(tx, input)` is `removeReview`'s four load-bearing properties applied to the other table: the guard in the `UPDATE`'s own `WHERE` (`isNull(chatMessages.removedAt)`), the length check before the transaction opens, the ordering inside it (notice first, anchor last, then `attachAuditEvent`), and the audit-plus-notice firing only on the branch that actually landed a stamp, judged from `RETURNING` rather than a prior read.

It writes `admin_action` on the **platform** chain (ruling 1) rather than a league-scoped event: the removal is visible in the league already, in the conversation, which is where a member reads it. `resolveFlag`'s `removeSubject` calls it for the `chat_message` subject.

```ts
chat_message_removed: ({ leagueName }) => ({
  title: "We removed one of your messages",
  body: `An operator removed a message you posted in ${leagueName}. Your leaguemates can see that the message went and who posted it, and they can no longer read it. We keep your words on file exactly as you wrote them.`,
}),
```

`quoteFor` returns `removalPhraseFor(context.reason)` for this type, so the reason renders as the bounded blockquote and not as a dense clause. Every string here is swept by `notices.test.ts` against `copyViolations` the moment it lands, which is what keeps `"was removed"` (a banned passive) out of a sentence that badly wants to be written that way.

- [ ] **Step 5: PERSONA PANEL — the member-facing moderation surfaces (controller step)**

The controller runs the panel over the report affordance, the removed-message state and the removal notice together, because they are one arc: I reported this, something happened, or it happened to me.

- **The reporter**, on the affordance: where does "Report" live on a message so it is findable when needed and invisible the rest of the time? On hover only is a desktop assumption and this product is mobile-first at 360px.
- **The reporter**, on the reason list: three reasons inherited from reviews (spam, abusive, something else). Are those the right three for a chat room, or does trash talk in a league of friends need a fourth that is not one of these?
- **The accused member**, on the removal notice: it says the league can see that a message went. Is that reassuring (nobody can read it) or alarming (everybody knows)? It is true either way and the copy has to choose which half leads.
- **The social casual**, on the removed state in the conversation: does a removed-message placeholder in the middle of draft-night trash talk read as moderation working, or as the product scolding the room?
- **The commissioner**, on who can act: founder decision #3 rules operator-only, so a commissioner cannot remove anything in their own private league. Is that surprising enough to need saying somewhere, given they can already remove a member?
- **Everyone**, on the pg-13 ceiling: founder decision #1 keeps it and documents it as unreviewed. The panel is the place that gets said out loud rather than staying in a decision doc.

- [ ] **Step 6: Commit**

---

## Task 7: Session signals — what the platform may know about a device, and where it may keep it

The spec asks the session model to capture a coarse device fingerprint and the request IP at session creation. Plan A recorded the sign-in and deliberately recorded no signals, for a reason it wrote down: a multi-account flag built on a forgeable header lets an attacker manufacture suspicion against somebody else's account.

This task adds the signals and it makes two decisions the spec does not.

**They do not go in the audit payload** (ruling 7). `audit_events` has no foreign keys and two triggers that refuse `UPDATE` and `DELETE`, which is exactly right for a record of what happened and exactly wrong for a person's IP address: a deleted account's cascade cannot reach it, and nothing in the design can ever erase it. Signals go in `session_signals`, a mutable table with cascading foreign keys, which is what "extend the session model" actually means in a product whose sessions live at WorkOS.

**There is no client beacon** (ruling 9). The spec suggests screen dimensions and timezone; getting them means a browser round trip, which is a new attack surface reporting values the attacker chooses, for a signal the design has already decided not to trust alone. What the server observes at `/callback` — `User-Agent`, `Accept-Language`, and the request IP — is the same class of information from the same source with no new surface, and it is literally what "self-reported client signals" means.

**Files:**
- Create: `drizzle/0025_session_signals.sql`
- Modify: `src/db/schema.ts`, `src/db/test-db.ts`
- Create: `src/integrity-service/session-signals.ts` (+ its test)
- Modify: `src/lib/auth/user-sync.ts` (+ its test), `src/app/callback/route.ts`, `src/integrity/config.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `DbTx`, `syncUserFromWorkOS`'s existing transaction, `INTEGRITY_CONFIG`.
- Produces: `sessionSignals` table, `recordSessionSignals(tx, input)`, `signalsForUsers(db, userIds)`, `hashClientIp(ip, salt)`, `IpSource`.

- [ ] **Step 1: Write the failing storage tests**

```ts
it("stores a hash of the address and never the address", async () => {
  await recordSessionSignals(tx, { userId: "u_a", userAgent: UA, acceptLanguage: "en-US", clientIp: "203.0.113.7", occurredAt: T });
  const [row] = await db.select().from(sessionSignals);
  expect(row!.ipHash).toHaveLength(64);
  expect(JSON.stringify(row)).not.toContain("203.0.113.7");
});

it("hashes the same address to the same value, because correlation needs equality and nothing more", () => {
  expect(hashClientIp("203.0.113.7", SALT)).toBe(hashClientIp("203.0.113.7", SALT));
  expect(hashClientIp("203.0.113.8", SALT)).not.toBe(hashClientIp("203.0.113.7", SALT));
});

it("stamps every row with where the address came from", async () => {
  // The release gate, made mechanical. Rows written before Fly's proxy overwrites X-Forwarded-For
  // are attacker-influenced; rows written after are not. Storing which is which means flipping the
  // weight is a filter this code already applies, not a memo somebody has to remember to act on.
  const [row] = await db.select().from(sessionSignals);
  expect(row!.ipSource).toBe("xff_unverified");
});

it("goes with the user row and the audit event, or none of them go", async () => {
  await expect(syncUserFromWorkOS({ db, clock, via: "callback", audit: throwingLogger }, workosUser)).rejects.toThrow();
  expect(await db.select().from(sessionSignals)).toEqual([]);
});

it("deletes a member's signals when the member is deleted, which audit_events cannot do", async () => {
  await db.delete(users).where(eq(users.id, "u_a"));
  expect(await db.select().from(sessionSignals)).toEqual([]);
  // …while the session_started audit event stays, correctly: what happened is not personal data
  // about a device, and Plan A's ruling 7 is why the two live in different tables.
  expect(await auditEventsOn(db, "platform", "session_started")).toHaveLength(1);
});
```

- [ ] **Step 2: The table**

```ts
/**
 * What the server observed about the client at a sign-in. NOT an audit event, on purpose
 * (ruling 7): `audit_events` refuses UPDATE and DELETE and carries no foreign keys, which is
 * right for a record of what happened and wrong for a person's device and network. This table
 * cascades from `users`, so deleting an account erases them.
 *
 * NO CLIENT BEACON FEEDS THIS (ruling 9). Three server-observed values: the User-Agent and
 * Accept-Language headers, and a hash of the request address. Screen dimensions and a timezone
 * would need a browser round trip reporting numbers the browser chooses, which is a new surface
 * for a signal already ruled untrustworthy alone.
 *
 * `ip_source` is the release gate in a column. `INTEGRITY_CONFIG.multiAccount.weights.ip` is 0
 * and stays 0 until Fly's proxy overwrites X-Forwarded-For (Phase 2 Plan D); this column is what
 * lets the heuristic then use only the rows written after that, rather than trusting a history
 * any caller could have written (ruling 8).
 */
export const sessionSignals = pgTable(
  "session_signals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    acceptLanguage: text("accept_language"),
    /** sha256(salt + address). Correlation needs equality; it never needs the address. */
    ipHash: text("ip_hash"),
    ipSource: text("ip_source").notNull(),
  },
  (t) => [index("session_signals_user_occurred_idx").on(t.userId, t.occurredAt)],
);
```

`SESSION_SIGNAL_SALT` joins `.env.example` and fails fast when missing, the same way `db/client.ts` and `realtime/redis.ts` already do. A salt that defaults to a constant is a salt that does nothing, and this is the one value in the plan whose absence has to be loud.

- [ ] **Step 3: Capture at the one observable moment**

`syncUserFromWorkOS` already wraps its upsert and its `session_started` append in one transaction; `recordSessionSignals` joins it. The headers reach it through the existing `Deps` object rather than by `user-sync.ts` reaching for `headers()` — that file has no business knowing it is inside a request, and the seam is what makes the tests above possible without a fake request.

Lock order is unchanged and must stay so: the `session_signals` insert takes `FOR KEY SHARE` on `users` through its foreign key, so it goes **before** the anchor, alongside the notice insert in every other flow. `lock-order.test.ts` gains it.

The truncation caps come from `INTEGRITY_CONFIG.multiAccount.signals` — a `User-Agent` is caller-controlled and unbounded, and storing one unbounded caller-controlled string per sign-in is a growth question this plan can answer with a number instead of inheriting.

- [ ] **Step 4: Commit**

---

## Task 8: The three heuristics, in isolation, with numbers computed by hand

The spec is emphatic that each similarity heuristic is a pure function with no side effects, independently unit-tested against hand-computed expected values for known-similar and known-dissimilar synthetic pairs. That is the whole task, and it lands before anything can flag anybody.

Every one of the three is deliberately **generous** — it will score a roommate pair, a family pair and two people who happen to draft at the same tempo well above zero. That is not a defect to tune away. The threshold and the human reading the queue are the defense; the heuristic's job is to be legible enough that an operator looking at `{ device: 0.94, behavioral: 0.62 }` can tell what the machine actually noticed.

**Files:**
- Create: `src/integrity/similarity.ts`, `src/integrity/similarity.test.ts`
- Modify: `src/integrity/config.ts` (+ its test)

**Interfaces:**
- Consumes: `INTEGRITY_CONFIG.multiAccount`. Nothing else. No database, no clock, no I/O.
- Produces:
  - `DeviceProfile`, `NetworkProfile`, `CadenceProfile`, `SignalScores`
  - `deviceSimilarity(a, b): number`, `ipCorrelation(a, b): number`, `behavioralSimilarity(a, b): number`
  - `multiAccountSuspicion(scores, weights): number`

Task 9 is the only caller; it supplies the profiles from `session_signals`, `draft_actions` and the audit log.

- [ ] **Step 1: Write the failing heuristic tests, with the arithmetic shown**

```ts
describe("deviceSimilarity", () => {
  it("is the overlap of the client signatures each account has ever signed in with", () => {
    // Jaccard: |A ∩ B| / |A ∪ B|. A = {x, y}, B = {y, z} → 1 / 3.
    expect(deviceSimilarity({ signatures: ["x", "y"] }, { signatures: ["y", "z"] })).toBeCloseTo(0.3333, 4);
  });

  it("is 1 for two accounts that have only ever signed in from the same one client", () => {
    expect(deviceSimilarity({ signatures: ["x"] }, { signatures: ["x"] })).toBe(1);
  });

  it("is 0 when they share nothing, and 0 when either side has never signed in", () => {
    expect(deviceSimilarity({ signatures: ["x"] }, { signatures: ["y"] })).toBe(0);
    expect(deviceSimilarity({ signatures: [] }, { signatures: ["y"] })).toBe(0);
    // Not NaN. An empty union is the degenerate case a Jaccard implementation gets wrong once,
    // and a NaN reaching a weighted sum silently poisons the whole score.
  });
});

describe("ipCorrelation", () => {
  it("counts only addresses the platform itself observed", () => {
    // Every hash written before Fly's proxy overwrites X-Forwarded-For is caller-influenced, so
    // it is not evidence of anything (ruling 8). Two accounts whose only shared address is
    // unverified correlate at 0, not at 1.
    const a = { addresses: [{ hash: "h1", source: "xff_unverified" as const }] };
    const b = { addresses: [{ hash: "h1", source: "xff_unverified" as const }] };
    expect(ipCorrelation(a, b)).toBe(0);
  });

  it("is the same Jaccard once the platform is the one reporting the address", () => {
    const a = { addresses: [v("h1"), v("h2")] };
    const b = { addresses: [v("h2")] };
    expect(ipCorrelation(a, b)).toBeCloseTo(0.5, 4);   // |{h2}| / |{h1,h2}|
  });
});

describe("behavioralSimilarity", () => {
  it("compares how long each account takes to act, which is the thing a person does the same way twice", () => {
    // 1 - min(1, |medianA - medianB| / cadenceToleranceSeconds). 12s vs 18s, tolerance 60 → 0.9.
    expect(behavioralSimilarity({ medianSeconds: 12, actions: 20 }, { medianSeconds: 18, actions: 20 })).toBeCloseTo(0.9, 4);
  });

  it("is 0, not a guess, below the minimum sample", () => {
    // A median over two picks is noise, and noise fed into a weighted sum is a flag raised about
    // a real person on the strength of nothing.
    expect(behavioralSimilarity({ medianSeconds: 12, actions: 2 }, { medianSeconds: 12, actions: 40 })).toBe(0);
  });

  it("floors at 0 rather than going negative when the two are nothing alike", () => {
    expect(behavioralSimilarity({ medianSeconds: 4, actions: 20 }, { medianSeconds: 300, actions: 20 })).toBe(0);
  });
});
```

- [ ] **Step 2: The combination, and what happens to a signal weighted at zero**

```ts
describe("multiAccountSuspicion", () => {
  it("is the weighted mean over the signals that carry any weight at all", () => {
    // device 0.6 · 0.9 + behavioral 0.4 · 0.8, over a weight sum of 1.0 → 0.86.
    expect(multiAccountSuspicion({ device: 0.9, ip: 1, behavioral: 0.8 }, { device: 0.6, ip: 0, behavioral: 0.4 }))
      .toBeCloseTo(0.86, 4);
  });

  it("ignores a zero-weighted signal completely, however extreme it is", () => {
    // The release gate as arithmetic. With ip at 0 a perfect address match cannot move the score
    // one thousandth, so an attacker forging X-Forwarded-For to look like somebody else's session
    // manufactures nothing at all — not a smaller flag, not any flag.
    const withMatch = multiAccountSuspicion({ device: 0.2, ip: 1, behavioral: 0.1 }, WEIGHTS);
    const without = multiAccountSuspicion({ device: 0.2, ip: 0, behavioral: 0.1 }, WEIGHTS);
    expect(withMatch).toBe(without);
  });

  it("normalizes by the weights in play, so turning the ip weight on later does not deflate the others", () => {
    // A plain Σ(w·s) would silently halve every existing score's meaning the day the gate flips.
    expect(multiAccountSuspicion({ device: 1, ip: 1, behavioral: 1 }, { device: 0.6, ip: 0.3, behavioral: 0.4 })).toBe(1);
  });
});
```

- [ ] **Step 3: `INTEGRITY_CONFIG.multiAccount`, with the zero written where a reader trips over it**

```ts
multiAccount: {
  /**
   * THE IP WEIGHT IS ZERO AND STAYS ZERO. This is a release gate, recorded in
   * `docs/decisions/operators-and-moderation.md` and in the phase overview's founder-gated
   * bucket, not a tuning choice: every address this product can see today comes from
   * `X-Forwarded-For`, which is caller-controlled until a trusted proxy overwrites it. A rate
   * limiter keyed on a forgeable header loses a speed bump. A MULTI-ACCOUNT FLAG keyed on one
   * lets an attacker manufacture suspicion against somebody else's account.
   *
   * Flipping it needs two things together, and `session_signals.ip_source` is why the second is
   * mechanical: (1) Fly's proxy overwriting the header (Phase 2 Plan D), and (2) the heuristic
   * counting only rows stamped `platform_verified`, which `ipCorrelation` already does.
   */
  weights: { device: 0.6, ip: 0, behavioral: 0.4 },
  /** The spec's MULTI_ACCOUNT_FLAG_THRESHOLD. Reachable on device plus behavioral alone, by design. */
  flagThreshold: 0.75,
  signals: {
    cadenceToleranceSeconds: 60,
    minActionsForBehavioral: 5,
    maxUserAgentLength: 512,
    maxSignaturesPerAccount: 50,
  },
},
```

A config test asserts every weight is non-negative, at least one is positive, and `flagThreshold` is inside `(0, 1]` — the three ways a tuning edit turns the detector off or on for everybody without anybody noticing.

- [ ] **Step 4: Commit**

---

## Task 9: The detector — league-bounded, flag-only, and provably unable to do anything else

Everything the spec's Step 2 is careful about lands here: the comparison is bounded to accounts that share a league and is never platform-wide, the only output is a `PENDING_REVIEW` flag, and no code path in the module can suspend, ban or restrict anything. The last one is a **test**, not a comment, in the shape `src/ai-advisor/advisory-only.test.ts` already proved this class of constraint in this codebase.

The known-false-positive tests are part of the deliverable and their names say so. Roommates on one wifi, a family sharing a laptop, two friends who draft at the same tempo — all three produce a flag, all three are correct behavior, and all three get a test whose name makes it clear that suppressing the flag is not the fix. A future reader "cleaning up a flaky test" has to read the sentence explaining why it is there.

**Files:**
- Create: `src/integrity-service/multi-account.ts`, `src/integrity-service/multi-account.test.ts`
- Create: `src/integrity/flag-only.test.ts`
- Modify: `src/integrity-service/flags.ts`, `src/league-service/join.ts` (+ its test), `src/integrity/queue-view.ts`
- Create: `scripts/sweep-multi-account.ts` (+ `integrity:sweep`); Modify: `package.json`

**Interfaces:**
- Consumes: `deviceSimilarity`, `ipCorrelation`, `behavioralSimilarity`, `multiAccountSuspicion`, `signalsForUsers`, `raiseFlag`, `joinLeagueInTx`'s existing transaction.
- Produces: `sweepLeagueForMultiAccounts(db, leagueId, deps): Promise<SweepResult>`, `canonicalPairId(a, b)`.

- [ ] **Step 1: Write the failing contract test first, before the detector can exist to violate it**

`src/integrity/flag-only.test.ts` — four properties, the same four `advisory-only.test.ts` earned the hard way:

```ts
const INTEGRITY_DIRS = ["src/integrity", "src/integrity-service"];
const ACCOUNT_ACTION_PATTERNS = ["isAdmin", "suspend", "ban", "restrict", "disable", "lock", "deactivate"] as const;

it("has files to check, so the guard is never vacuous", () => {
  expect(sourceFiles(INTEGRITY_DIRS).length).toBeGreaterThan(10);
});

it("contains no code path that takes an action against an account", () => {
  // Collect every offender rather than failing on the first, so the failure names the file AND
  // the pattern instead of sending the next reader hunting.
  const offenders: string[] = [];
  for (const file of sourceFiles(INTEGRITY_DIRS)) {
    if (file === "src/integrity-service/flags.ts") continue;   // grantAdmin lives here — see below
    for (const pattern of ACCOUNT_ACTION_PATTERNS) {
      if (read(file).includes(pattern)) offenders.push(`${file}: ${pattern}`);
    }
  }
  expect(offenders).toEqual([]);
});

it("keeps the one account-touching function unreachable from the detector", () => {
  // `grantAdmin` is the single exception and it is an exception in the opposite direction: it
  // GIVES authority and only the operator script calls it. The claim that matters is that
  // nothing in the detection path can reach it, which is an import-graph fact, not a grep.
  expect(importClosureOf("src/integrity-service/multi-account.ts")).not.toContain("grantAdmin");
});

it("can only ever write a flag at pending, never at resolved", () => {
  // A detector that could write `resolution` would be a detector that decides. The type says no:
  // `RaiseFlagInput` has no resolution field, and this @ts-expect-error is what keeps it saying no.
  // @ts-expect-error `resolution` is not part of RaiseFlagInput, which is the whole point.
  const bad: RaiseFlagInput = { ...validInput, resolution: "warned_user" };
  expect(bad).toBeDefined();
});
```

- [ ] **Step 2: Write the failing detector tests**

```ts
it("compares only accounts that share the league it was asked about", async () => {
  // Never platform-wide: the spec bounds this for compute cost AND for false-positive exposure,
  // and the second reason is the one that matters. Two strangers on one office network who have
  // never met are not a question anybody should be asked to answer.
  await twoAccountsOnOneDevice(db, { leagueId: "lg_1" });
  await twoAccountsOnOneDevice(db, { leagueId: "lg_2" });
  const result = await sweepLeagueForMultiAccounts(db, "lg_1", deps);
  expect(result.pairsCompared).toBe(1);
  expect(await openFlags(db)).toHaveLength(1);
});

it("raises one flag per pair, with a canonical subject id, however the sweep is ordered", async () => {
  // "u_a:u_b" and "u_b:u_a" are one question. canonicalPairId sorts, so the open-subject unique
  // index actually catches the second sighting rather than opening a mirror-image duplicate.
  expect(canonicalPairId("u_b", "u_a")).toBe("u_a:u_b");
});

it("stores the scores that raised it, because they will not be true by the time a human looks", async () => {
  const [flag] = await openFlags(db);
  expect(flag!.evidence).toMatchObject({ device: expect.any(Number), behavioral: expect.any(Number), ip: 0, total: expect.any(Number) });
});

it("does not flag a pair below the threshold, and a config change alone flips that", async () => {
  // The spec's exit criterion: a test proves changing the config changes flagging outcomes with
  // no code change. The sweep takes its weights and threshold as an argument for exactly this.
  expect(await sweepWith(db, { flagThreshold: 0.95 })).toMatchObject({ flagsRaised: 0 });
  expect(await sweepWith(db, { flagThreshold: 0.50 })).toMatchObject({ flagsRaised: 1 });
});

it("crosses the threshold on device and behavioral alone, with the ip weight at zero", async () => {
  // THE release-gate test. If this ever fails, the detector has become dependent on a forgeable
  // header and the honest fix is the heuristic, never the weight.
  await pairSharingADeviceButNotAnAddress(db, "lg_1");
  expect((await sweepLeagueForMultiAccounts(db, "lg_1", deps)).flagsRaised).toBe(1);
});
```

And the three the spec asks for by name, written so nobody deletes them:

```ts
describe("known false positives, which are CORRECT behavior and not defects", () => {
  it("flags two roommates on one wifi, and that is the right answer", async () => {
    // A flag is a question for a human, never an action against an account. Two roommates in one
    // league SHOULD reach an operator's queue; an operator resolves it `no_action` in ten seconds
    // and nobody is ever told they were looked at (ruling 6). Suppressing this flag would mean
    // suppressing the real case that looks identical from here. DO NOT "FIX" THIS TEST.
  });

  it("flags a family sharing one laptop, and that is the right answer", async () => { /* same reasoning */ });

  it("flags two friends who happen to draft at the same tempo, and that is the right answer", async () => {
    // The weakest of the three signals producing the weakest of the three flags. It is still a
    // question, it is still cheap to answer, and the alternative is a detector that misses the
    // one-person-two-accounts case it exists for, because one person drafts at one tempo.
  });
});
```

- [ ] **Step 3: The sweep, and when it runs**

```ts
/**
 * Compare every pair of accounts in ONE league and raise a flag for each pair over the threshold.
 *
 * It is a SWEEP WITH A TRIGGER, not a subscriber (ruling 11). The pair set of a league changes
 * exactly when a seat is filled, so `joinLeagueInTx` is the trigger and `scripts/sweep-multi-
 * account.ts` is the manual re-run for a league whose signals moved after it filled up. A
 * subscriber on every session start would re-derive the same answer thousands of times for a
 * question whose inputs change once.
 *
 * FLAGS ONLY. There is no branch in this file, or reachable from it, that takes any action
 * against an account — proved by `src/integrity/flag-only.test.ts` rather than asserted here.
 */
export async function sweepLeagueForMultiAccounts(db: Db, leagueId: string, deps: SweepDeps): Promise<SweepResult>;
```

The pair count is `n·(n-1)/2` over a league's members, which for `LEAGUE_CONFIG`'s ceiling is a small constant, and the profiles are read in **three batched queries** rather than per pair. `countingDb` asserts it, because an N² read over an N² comparison is how this becomes the slowest thing in the join path.

The join-time trigger runs **after** `joinLeagueInTx` commits, not inside it, and this is the one place in the plan where an integrity write is deliberately outside a business transaction. The reason is the lock order and not convenience: the sweep reads other members' rows and would append to the platform chain while the join transaction still holds `league_invites` and `leagues`, which is a second anchor in a transaction that already has one and a lock-ordering hazard besides. A failed sweep must not fail a join — the person joining did nothing — so it is logged and the operator script re-runs it. That asymmetry is written into the docblock and into the decision doc, because it reads like a violation of Plan A's write-ordering rule until you see which write it is.

- [ ] **Step 4: The queue's multi-account detail view, and the allowlist proof completed**

`queue-view.ts` gains the `account_pair` subject renderer: both display names, both join dates, the three component scores, the weighted total, and the signals that produced them. This is the *"raw multi-account similarity scores present in the admin detail view"* half of the spec's exit criterion; Task 5 already wrote the other half. With a real multi-account flag existing for the first time, the proof runs end to end against real rows:

```ts
it("shows an operator the scores and shows a member of that league nothing at all", async () => {
  await pairSharingADeviceButNotAnAddress(db, "lg_1");
  await sweepLeagueForMultiAccounts(db, "lg_1", deps);
  const [flag] = await listPendingFlags(db, {});

  expect((await flagDetail(db, flag!.flagId)).evidence).toMatchObject({ device: expect.any(Number) });

  // The same underlying events, read the way a member reads them. Not "the scores are filtered
  // out" — the events are not in this league's chain to be filtered.
  const page = await listLeagueActivity(db, { leagueId: "lg_1", viewerUserId: "u_a" });
  expect(JSON.stringify(page.rows)).not.toMatch(/device|behavioral|suspicion|0\.\d{2}/);
  expect(page.rows.every((row) => row.headline !== "")).toBe(true);   // and it is not empty because it broke
});
```

- [ ] **Step 5: Move the last reserved entry, seed, commit**

`reserved.test.ts` is now fully honest for this plan's three types. The seed grows two accounts in one seeded league that share a client signature, so `npm run seed && npm run dev` puts a **real** flag in the queue, raised by the real detector from real rows. That is the spec's *"seed several flags at different severities for manual verification"* honored without a decorative row (ruling 29).

---

## Task 10: Residual — the stat correction an operator can actually run, and the gate it trips

Phase 2 Plan B's ledger and `live-scoring-pipeline.md` §10 both record this by hand: the sweep covers the most recent settled week for three days, and *"older revisions need Phase 3's operator path."* The machinery is already idempotent and recompute-and-overwrite. In the decision doc's own words it was *"only missing a caller."* This is that caller.

It is also the plan's **first league-scoped `system_action`**, which trips the pre-wiring gate Plan A left behind in writing: *"`renderSystemAction` renders whatever `payload.summary` string it is given, verbatim, to every league member … re-review is required before Plan D emits a league-scoped `system_action`."* Ruling 13 closes it by removing the hole rather than approving it: a third deny-by-default dimension, in the same shape as the other two, so writing `summary` for an action nobody signed off does not compile.

Founder decision #11's default binds: operator-chosen week with no hard limit, always re-settling, always notifying every affected manager. A retroactive standings change that nobody is told about is the exact failure the notice primitive exists to prevent.

**Files:**
- Create: `src/integrity/system-actions.ts`, `src/integrity/system-actions.test.ts`
- Modify: `src/integrity/activity-view.ts` (+ its test), `src/integrity/notices.ts` (+ its test)
- Modify: `src/stats-pipeline/finalize.ts` (+ its test) — the `finalizeWeekInTx` seam
- Create: `src/stats-pipeline/correction.ts`, `src/stats-pipeline/correction.test.ts`
- Create: `scripts/correct-stat-week.ts`; Modify: `package.json`, `src/stats-pipeline/index.ts`, `src/integrity/config.ts`

**Interfaces:**
- Consumes: `getStatsProvider`, `getIngestionBudget`, `persistTick`, `finalizeWeek`, `scoreTeamsForWeek`, `AuditLogger`, `notifyAffectedMember`.
- Produces: `SYSTEM_ACTION_CODES`, `SYSTEM_ACTION_SUMMARY_ALLOWED`, `correctSettledWeek(db, input): Promise<CorrectionResult>`, `finalizeWeekInTx`, `NoticeContexts.stat_week_corrected`.

- [ ] **Step 1: Close the gate first, before anything can walk through it**

`src/integrity/system-actions.ts`:

```ts
/**
 * Which system actions may say something to a whole league, decided per action code and denying
 * by default. The THIRD deny-by-default dimension in this codebase, added to the two Plan A
 * shipped (`ACTIVITY_VISIBILITY` decides types; each payload renderer decides fields).
 *
 * WHY THIS EXISTS. `renderSystemAction` renders `payload.summary` verbatim to every member of a
 * league, and `system_action` is `"everyone"` in ACTIVITY_VISIBILITY. That has been safe only by
 * accident of what existed: the sole publisher was `scripts/verify-audit-chain.ts`, which writes
 * no `summary` and is platform-chain-scoped anyway. Plan A named the hole in its own residuals and
 * required a re-review before anything emitted a league-scoped one. This plan is that publisher,
 * so this is that re-review, and its outcome is a table rather than an approval.
 *
 * The RE-REVIEW'S ANSWER, in full, so Plan D inherits a decision instead of the question:
 *  - `stat_week_corrected` is ALLOWED. It is a fact about the league's shared scoreboard, true for
 *    everyone in it, about nobody's conduct. A member who is not told is a member reading standings
 *    that changed under them.
 *  - `chain_verification_failed` is DENIED, restating Plan A's ruling 8: telling a league its
 *    record may have been altered, before a human has read the output, is the accusation this
 *    phase spends a denylist preventing.
 *  - `lineup_auto_set` is DENIED IN ADVANCE, and Plan D should not simply flip it. The
 *    competitive-sensitivity argument that makes `lineup_change` `actor_only` (Plan A ruling 15)
 *    applies at least as hard to a system-authored sentence describing one manager's lineup, and
 *    broadcasting the lapse publicly while manual changes stay private would be worse than either.
 *    What Plan D needs is an actor-scoped path, which is a new visibility, not a new summary.
 */
export const SYSTEM_ACTION_SUMMARY_ALLOWED: Readonly<Record<SystemActionCode, boolean>> = {
  stat_week_corrected: true,
  chain_verification_failed: false,
  lineup_auto_set: false,
  trade_held_for_review: false,
};
```

`renderSystemAction` gains one line before it reads `summary`: an `action` code that is not in the record, or is in it as `false`, renders `null`. The tests pin all three states, and the mutation proof is that deleting the guard reddens a test rather than nothing:

```ts
it("renders nothing for an action nobody signed off, even when it carries a summary", () => {
  const event = systemActionEvent({ action: "lineup_auto_set", summary: "We set Alice's lineup." });
  expect(activityRowFor(event, viewer, names)).toBeNull();
});

it("renders nothing for an action code it has never heard of", () => {
  expect(activityRowFor(systemActionEvent({ action: "whatever", summary: "hi" }), viewer, names)).toBeNull();
});

it("still renders nothing for the verifier's own event, which is Plan A's ruling 8 unchanged", () => {
  expect(activityRowFor(chainVerificationFailedEvent(), viewer, names)).toBeNull();
});
```

- [ ] **Step 2: The `finalizeWeekInTx` seam**

`finalizeWeek(db, leagueId, week, cache)` opens its own transaction, and a correction has to write its audit event and its notices inside the same one — Plan A's write-ordering rule is not negotiable and a nested `db.transaction` is a savepoint with different failure semantics. Extract the body to `finalizeWeekInTx(tx, leagueId, week)` and make `finalizeWeek` the one-door wrapper that also invalidates the cache after commit, the same two-door shape `joinLeagueInTx` uses and the same one Task 4 applied to `removeReview`. `src/stats-pipeline` is gated at 100%, so both doors are covered by construction; the worker's existing caller changes not at all.

- [ ] **Step 3: Write the failing correction tests**

```ts
it("refuses a week that has not settled, because that week is the worker's job", async () => {
  expect(await correctSettledWeek(db, { week: 5, ... })).toEqual({ ok: false, reason: 'Week 5 has not settled yet. The ingestion worker still owns it.' });
});

it("reaches back past the three-day sweep window and past the newest settled week", async () => {
  // The whole point of the residual. `correctionCandidate` returns only the most recent settled
  // week and only inside STATS_INGESTION_CONFIG.correctionWindowDays, so this path goes around it
  // rather than through it. Founder decision 11: operator-chosen week, no hard limit.
  await settledWeeksThrough(db, 9, { updatedDaysAgo: 40 });
  expect((await correctSettledWeek(db, { week: 3, ... })).ok).toBe(true);
});

it("writes nothing at all when the provider's numbers have not moved", async () => {
  // persistTick advances `version` only when Postgres itself reports a real change. No version
  // bump means no re-settlement, no audit event and no notice: an operator running a correction
  // that changes nothing has not performed an operator action, and a row saying they did would be
  // a lie in the one record this phase exists to make trustworthy.
  const result = await correctSettledWeek(db, { week: 3, ... });
  expect(result).toMatchObject({ ok: true, changed: false, leaguesResettled: 0 });
  expect(await auditEventsOn(db, "lg_1", "system_action")).toHaveLength(0);
});

it("re-settles each affected league in its own transaction, because a transaction appends to one chain", async () => {
  // Plan A ruling 3. Two leagues means two transactions and two league chains, never one
  // transaction spanning both — `recordAll` throws on a batch that spans scopes and `record`
  // would take a second anchor.
  await correctSettledWeek(db, { week: 3, ... });
  expect(await auditEventsOn(db, "lg_1", "system_action")).toHaveLength(1);
  expect(await auditEventsOn(db, "lg_2", "system_action")).toHaveLength(1);
});

it("tells every manager whose points moved, and says whether the result moved with them", async () => {
  const [notice] = await noticesFor(db, "u_manager");
  expect(notice!.noticeType).toBe("stat_week_corrected");
  expect(notice!.body).toContain("your matchup");
  expect(copyViolations(`${notice!.title} ${notice!.body}`)).toEqual([]);
});

it("tells nobody whose points did not move", async () => { /* a correction to one player's line */ });

it("fails closed when the request ledger is unreachable, and writes nothing", async () => {
  // `createRequestBudget` deliberately fails closed, unlike the caches and the publisher. An
  // operator correction is a third spender against one monthly ceiling; a correction that ran
  // without reserving is a worker that silently cannot run later.
  expect(await correctSettledWeek(db, { week: 3, budget: unreachableBudget })).toEqual({ ok: false, reason: "The request ledger is unreachable, so nothing has been read or written. Try again once Redis is back." });
});
```

- [ ] **Step 4: The correction, the summary, and the notice**

`correctSettledWeek` reserves in **two phases** exactly as the worker does — reserve for the schedule call, then reserve for the exact box scores it decided to fetch, never a worst case, because `RequestBudget` has no release path. It debits the same monthly key the worker does, and the script prints the delta last and always, mirroring `scripts/ingest-once.ts`.

Per affected league, in one transaction: capture each team's stored result, `finalizeWeekInTx`, compare, write the notices for the managers who moved, then the anchor, then `attachAuditEvent`. The `system_action` payload is `{ action: "stat_week_corrected", week, summary }`, and the summary is composed from the same template the notice uses so the league-wide sentence and the personal one cannot say different things:

```ts
stat_week_corrected: ({ leagueName, week, points, outcome }) => ({
  title: `We corrected your week ${week} score`,
  body: `Our stats provider revised its numbers for week ${week}, so we recomputed ${leagueName}. Your team now has ${points} points, and ${outcome}.`,
}),
```

`outcome` is one of three fixed clauses resolved by the caller (`"your matchup result stays the same"`, `"that turns your matchup into a win"`, `"that turns your matchup into a loss"`), never a free string, so the copy sweep covers every sentence this notice can produce rather than one sample of it. `NOTICE_SAMPLES` carries one; the test iterates all three.

The league-wide summary is the impersonal half: `"We corrected week 3 scores after our stats provider revised its numbers. Standings now match the update."`

- [ ] **Step 5: The script**

`scripts/correct-stat-week.ts` on `remove-review.ts`'s confirmed-destructive idiom: typed `Args` (`--week`, `--by`), the `--flag value` parser, a preflight that prints which leagues will re-settle and previews the **rendered notice** for one affected manager through `renderNotice`, `confirm()`, then the call. Exit `0` on success or cancel, `1` on refusal or throw. The budget delta prints last.

- [ ] **Step 6: Commit**

---

## Task 11: Docs, three more gates, and the closing battery

**Files:**
- Modify: `vitest.config.mts`
- Create: `docs/decisions/operators-and-moderation.md`
- Modify: `docs/conventions.md`, `docs/decisions/identity-and-trust.md`, `docs/decisions/audit-and-integrity.md`, `README.md`
- Modify: `e2e/league-lifecycle.spec.ts`, `e2e/mobile-360.spec.ts`

- [ ] **Step 1: Add three gates, with both halves each**

`src/league-service` and `src/draft-service` join `COVERAGE_GATED_DIRS` **and** get their own `thresholds` blocks, as gates 17 and 18 — the recommendation Plan A's final whole-branch review left for this plan by name (`.superpowers/sdd/meta-loop.md`: *"GATES 17/18 recommended for Phase 3 Plan B (league-service, draft-service)"*). The reasoning is the same one that produced gates 13 through 16: every whole-branch review in this loop has found its HIGH findings in the service layer, and this plan writes into both of those directories (`join.ts`'s sweep trigger, `store.ts`'s existing notice path). `src/moderation` joins as gate 19 for the reason every pure directory does, and because it is now the single home of the vocabulary that decides what may be removed (ruling 21).

Sixteen becomes **nineteen**. Both halves for each, because an `include` entry with no `thresholds` block measures nothing — the exact defect Phase 2 Plan A's fix wave caught in `src/stats`. Guards unreachable through real Postgres get narrow stub-`Db` tests that put the code in the state it defends against, exactly as `identity-service` and `integrity-service` already do, never a lowered threshold and never an ignore comment. Verify with an **unfiltered** `npm run test:coverage` reporting nineteen directories at 100% on all four metrics.

- [ ] **Step 2: Write `docs/decisions/operators-and-moderation.md`**

A new document rather than more sections on `audit-and-integrity.md`, which is 653 lines about the chain. Sections, each recording what was chosen, why, and what would have to change for the choice to be wrong:

1. **The role, and why it cannot be granted from inside the product.** One boolean, no RBAC, the script as the only writer, the bootstrap check, and what a deployment gets instead of an admin-creates-admin UI.
2. **404 and not 403**, restated beside the two places the codebase already made this choice, so the discipline reads as one rule rather than three coincidences.
3. **The queue's shape.** One table with a discriminator; the stamp versus a resolutions table; the partial unique index on open flags and why a resolved subject may be flagged again; oldest-first with no severity sort.
4. **The resolution vocabulary, and the test a decision has to pass to exist.** Implementation, or a named owning plan plus a runtime refusal. Why `trade_reversed` passes and `account_restricted` does not, and what Plan C changes.
5. **Where an operator action is recorded.** The platform chain for everything investigatory, with the league id in the payload; the league chain only for a consequence the league shares. The two classes, and the sentence that decides which one a future action is.
6. **Who is told, and the one exception.** Every operator action notices the affected member, except `no_action`, with ruling 6's reasoning in full. Also: the reporter is never told the outcome, and why.
7. **The multi-account detector.** League-bounded; the three heuristics and their arithmetic; the flag-only contract test; the false-positive tests that must not be "fixed"; and **the IP release gate in full** — the zero weight, the `ip_source` discriminator, the two things that must land together, and where the gate is also recorded (the phase overview's founder-gated bucket, beside Phase 2 Plan D's XFF item).
8. **Moderation.** Founder decisions 1, 2, 3 and 4 as shipped: pg-13 kept and documented as unreviewed; one closed reason vocabulary in `src/moderation`; operator-only removal with no commissioner path; no appeal, stated on the notice itself. Why chat renders a removed message and reviews vanish one.
9. **The `renderSystemAction` gate, closed.** The re-review Plan A required, its outcome as a table, and the pre-decided answer for Plan D's `lineup_auto_set`.
10. **Stat corrections.** Founder decision 11 as shipped; the two-phase budget reservation and the fail-closed ledger; one transaction per league; who is told and who is not.
11. **Threat model additions.** What the operator role adds to Plan A's tiers: an operator is inside tier 1 by definition and every action they take is on the chain; a compromised operator session can resolve flags and remove content and **cannot** grant itself anything, because the grant is not in the application at all.

- [ ] **Step 3: Correct the drift, by grep and not by guess**

```bash
grep -rn "sixteen\|SIXTEEN\|16 gated\|no admin\|admin role\|ruling 18\|no removal path\|Phase 3" docs src scripts README.md
```

Known targets: `docs/conventions.md`'s directory map (`src/moderation/`, and one-line descriptions for the new integrity files), its coverage-gate enumeration (sixteen becomes nineteen), its client-boundary section (`@/moderation` joins the **exempt** list, `@/integrity` is already blocked, and the sentence saying why one is which), and its scripts list (`admin:grant`, `stats:correct`, `integrity:sweep`). `docs/decisions/identity-and-trust.md`'s residual list has four entries this plan closes — the moderation surface, chat's missing removal path, the review report queue's missing consumer and the pg-13 question's disposition — and each becomes a line saying where it went rather than being deleted. `audit-and-integrity.md`'s `renderSystemAction` residual becomes a pointer to the closed gate. `README.md` gains the three new scripts and the local operator's seeded identity.

- [ ] **Step 4: Extend the e2e walkthroughs**

`e2e/league-lifecycle.spec.ts` gains the arc this plan is about, in one authenticated pass: a member reports a chat message, the seeded operator opens the queue, sees exactly one row, opens it, resolves it as `content_removed`, and the reporting member reloads the chat to find the message rendered as removed and the author's notice waiting in the inbox Plan A built. Two sessions, one real flag, no fixtures — the whole plan end to end in a browser.

`e2e/mobile-360.spec.ts` gains `/app/admin/queue` and one flag detail page to its route list.

- [ ] **Step 5: The closing battery**

```bash
npm run infra:down && npm run infra:up
npm run db:migrate && npm run db:migrate:test
npm run seed && npm run stats:ingest
npm run audit:verify -- --full        # every chain the seed produced, from genesis
npm run integrity:sweep -- --league <seeded>   # the detector against real seeded rows
npm test
npm run test:coverage                 # UNFILTERED: nineteen gated dirs, all 100%
TEST_DATABASE_URL=$TEST_PGBOUNCER_URL npm test    # the whole suite through the pooler
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
npm run e2e                           # twice, back to back, per Plan A's precedent
```

The through-the-pooler run carries a specific load here beyond inheriting Plan A's reason. This plan adds a transaction that takes a row lock on `integrity_flags` and then an anchor, and another that takes `chat_messages` then a notice then an anchor. Both are the lock-ordering class Plan A's final review found a real cycle in, on a scratch-table reproduction, after eleven tasks of getting it right. `lock-order.test.ts` running through transaction pooling is the check that matters.

The `audit:verify --full` line matters for a second reason this time: Plan A's documented floor is that **an unverified chain's tail deletion plus anchor rewind is undetectable**, so first-verification-per-chain is the requirement. Every league chain this plan's seed and e2e create is a new chain, and this line is where each gets its first verification.

- [ ] **Step 6: Commit**

---

## Open questions, self-ruled

Every judgment call this plan makes, numbered, with the reasoning that would have to be wrong for the ruling to be wrong.

1. **Every investigatory operator event appends to the platform chain, never a league chain.** `flag_raised`, `flag_resolved` and `admin_action` carry `leagueId: null` on the event and the real league id in the payload, because `scopeFor` derives chain scope from the column and Plan A's invariant is that the two agree. A record about a person under review is not the league's business, and this buys a property no visibility flag can: a platform-chain event is never read by `listLeagueActivity` at all, so a future author flipping `ACTIVITY_VISIBILITY.flag_raised` to `"everyone"` still leaks nothing. Two independent defenses, because one of them is one line away from being wrong. The cost is that `audit_events_league_occurred_idx` does not serve these rows, which is fine: the queue reads `integrity_flags`, not the chain. The **consequence** to accept honestly is that a member's own activity feed will never show that they were reported, which is deliberate and is ruling 6's other half.

2. **A resolution decision exists when it has an implementation, or a named owning plan plus a runtime refusal.** Founder decision #5 drops `ACCOUNT_RESTRICTED` on the reasoning that *"an enum value with no implementation is a control wired to nothing."* Applied honestly, that reasoning also indicts `TRADE_REVERSED`, which the overview's default list keeps: this product cannot reverse a trade because it cannot make one. The test above separates them. `trade_reversed` is declared, its owner is `plan-c` in an exhaustive `DECISION_OWNER` record, `decisionIsAvailable` returns false and `resolveFlag` refuses it by name — Plan A's `score.update` precedent exactly. `account_restricted` has no owning plan in this phase, and the spec's own out-of-scope list forbids account actions, so it is not declared at all: a reserved name with no owner is how a control wired to nothing gets wired to something by a reader who assumes intent. This is wrong only if Plan C's trade lands without a reversal, in which case the entry moves to `plan-d` rather than being deleted.

3. **`content_removed` is a fourth decision the overview's default list did not name.** That list (`NO_ACTION`, `WARNED_USER`, `TRADE_REVERSED`) comes from the spec's Step 4, which knew only about multi-account and trade flags. This plan absorbs the moderation residuals, and the resolution of a report is a removal; without a decision that names what actually happened, an operator removing a message would have to record it as `warned_user` and the audit trail would say something untrue. It is also the only decision in the list with a complete implementation on the day it merges.

4. **Resolution is a one-way stamp guarded in the `UPDATE`'s own `WHERE`, not a separate resolutions table.** The spec says resolution *"never mutates the original flag."* A stamp is that claim in the only sense that matters: no fact is overwritten, the guard makes it single-shot, and two operators clicking at once serialize on the row lock with the loser matching zero rows. It is the shape this codebase has already chosen twice (`reviews.removed_at`, `stat_weeks.version`). The alternative — deriving status from an appends-only resolutions table — costs a join on every queue read for a relation bounded at exactly one, which is the balance-as-rollup convention's own threshold read backwards. The immutable record is the `flag_resolved` audit event; the row is the queue's index into it.

5. **The flag stores what was true when it was raised; everything recoverable is derived at read time.** `evidence` carries the similarity scores, because the session data they were computed from will have moved on by the time a human looks. A review's report count is not stored, because `review_reports` still holds every report and a count per review is bounded — derive over a bounded set, roll up over an unbounded one. The apparent inconsistency (one flag type's evidence is rich, another's is empty) is the rule applied consistently, and the detail view says which numbers are historical and which are live.

6. **A `no_action` resolution tells nobody, and it is the one exception to this plan's own rule that every operator action notices the affected member.** An investigation that closed with nothing happening is not an event in that member's life, and "we looked into you and found nothing" is precisely the accusation `INTEGRITY_CONFIG.notices.accusatoryTerms` exists to keep out of this product. The record still exists — the audit event is written either way — so the exception is about who is told, never about what is recorded. `NOTICE_FOR_DECISION` is an exhaustive `Record<ResolutionDecision, NoticeType | null>` so a decision added later cannot silently inherit the exception; it has to be decided. This is wrong only if a regulator later requires subject notification of a closed investigation, which is a Phase 4 question with a one-entry answer.

7. **Device and network signals live in `session_signals`, a mutable cascading table, and never in an audit payload.** `audit_events` has no foreign keys and two triggers that refuse `UPDATE` and `DELETE` — exactly right for a record of what happened, exactly wrong for a person's IP address. An address written there outlives the account forever, is unreachable by any cascade, and cannot be erased by any code this design permits. Splitting the two costs one table and buys the property that deleting a user actually deletes what the platform knew about their device, while the fact that they signed in stays on the chain where it belongs.

8. **The stored address is a salted hash plus an `ip_source` discriminator, and that discriminator is what makes the release gate mechanical.** Correlation needs equality and never needs the address, so a hash loses nothing the heuristic uses. The discriminator is the part that matters: every hash written before a trusted proxy overwrites `X-Forwarded-For` is caller-influenced, and without a column recording which is which, flipping the weight later would silently start trusting a history any caller could have written. `ipCorrelation` counts only `platform_verified` rows today, which is why the gate flip is one config value rather than a data audit. `SESSION_SIGNAL_SALT` fails fast when missing, because a salt with a default is a salt that does nothing.

9. **There is no client-side device beacon.** The spec suggests screen dimensions and a timezone; getting them means a browser round trip reporting values the browser chooses, which is a new surface, the product's first "we collect this about your device" moment with no privacy copy anywhere, and additional resolution on a signal the design has already ruled untrustworthy alone. `User-Agent` and `Accept-Language` are the same class of information from the same source with no new surface, and they are literally what "coarse, self-reported client signals" means. This is wrong if the detector's device signal proves too coarse to separate anything, which is measurable on real data and is a heuristic change rather than an architecture one.

10. **The IP weight is zero on merge, and a test proves the threshold is reachable without it.** The release gate the phase overview carries. A rate limiter keyed on a forgeable header loses a speed bump; a multi-account flag keyed on one lets an attacker manufacture suspicion against somebody else's account, and the flag names a **pair**, so the manufactured suspicion lands on a real person who did nothing. The arithmetic makes it airtight rather than merely low: `multiAccountSuspicion` normalizes over the weights in play, so a zero-weighted signal is excluded from the numerator **and** the denominator and cannot move a score by one thousandth however extreme it is. If the release-gate test ever fails, the honest fix is the heuristic and never the weight.

11. **The detector is a sweep with a named trigger, and the trigger runs after the join commits.** A league's pair set changes exactly when a seat fills, so `joinLeagueInTx` is the trigger and the operator script is the manual re-run. A subscriber on every session start would re-derive one answer thousands of times. The **after-commit** part is the deliberate part and it reads like a violation of Plan A's write-ordering rule until you see which write it is: the sweep would append to the platform chain while the join transaction still holds `league_invites` and `leagues`, which is a second anchor in a transaction that already has one. And a failed sweep must not fail a join, because the person joining did nothing. The audit event that matters for the join is the join's own `member_joined`, written inside the transaction where it belongs.

12. **A flag is raised by the platform. A member's report is a signal that raises one; it is not a flag they aim.** The distinction is why there is no "report this member" affordance anywhere in this plan: everything reportable is a **piece of content**, and every flag whose subject is a person (`account_pair`) is raised by a sweep with no human on the other end of it. A product where one member can put another member in an operator's queue by clicking is a product with a new harassment vector, and this plan does not open one.

13. **`renderSystemAction` gains a third deny-by-default dimension rather than an approval.** Plan A left an explicit pre-wiring gate: `system_action` is `"everyone"`, the renderer emits `payload.summary` verbatim to a whole league, and that has been safe only by accident of what existed. This plan is the first publisher of a league-scoped one, so this plan owes the re-review. Closing it with "we looked and the stat correction is fine" would leave the hole open for Plan D. `SYSTEM_ACTION_SUMMARY_ALLOWED` is an exhaustive `Record<SystemActionCode, boolean>` in the same shape as `ACTIVITY_VISIBILITY`, so writing a summary for an action nobody signed off does not compile, and Plan D inherits a decided answer for `lineup_auto_set` (denied, and what it needs instead is a new visibility, not a new summary) rather than the question.

14. **Admin surfaces answer 404, never 403.** The codebase's existing non-oracle discipline, applied where it matters most: `publicJoinPrecondition` answers 404 for a non-public league and the league page answers 404 for a stranger, both to avoid confirming that a guessed id names something real. A 403 on `/app/admin/queue` tells somebody probing that they found the admin surface and only need a session. 401 for a signed-out caller is kept, because that distinction is about the caller's own state and reveals nothing about the surface.

15. **There is no in-product path that grants operator access.** Founder decision #12's default is a guarded operator script; this ruling makes it the only path rather than the first one. The consequence is the point: `requireAdmin` has no privilege-escalation path inside the application at all, so a privilege-escalation bug has to be a bug in Postgres access control rather than a bug here, and the product's highest-privilege mutation requires shell access to the database host. The bootstrap is checked and not trusted (`--by bootstrap` is refused once any operator exists), so the grant chain is walkable in the audit log from the first admin forward. This is wrong when the operator team is large enough that shell access becomes the bottleneck, which is a real day and is one route away.

16. **The admin field set is its own pure module, opposite the member's.** `src/integrity/queue-view.ts` beside `src/integrity/activity-view.ts` is what makes the spec's exit criterion — raw scores in the admin view, absent from the member feed — a comparison of two named modules rather than a scrape of two rendered pages. A page-level assertion proves what one render happened to contain; a module-level one proves what the field set is. It also means Plan C adds a trade renderer to one file with a decided shape rather than inventing an admin view.

17. **Any migration touching `chat_messages` re-measures the covering index, and the test is written before the migration.** `chat_messages_league_id_idx` carries `INCLUDE (body)` added by hand in `0018` because `drizzle-orm`'s `index()` builder cannot express it, and `0017`'s six nullable columns had already tipped the planner off it once. Three more columns is the same risk. The `INCLUDE` list widens to `(body, removed_at, removal_reason)` and `removed_by_user_id` stays out deliberately — which operator removed a message is an operator fact, and the fewer columns in a covering index the longer it stays chosen. `index-plans.test.ts` reads `indexdef` back out of `pg_indexes` over the existing 20,000-row corpus rather than trusting the migration file to still be what is on disk.

18. **A removed chat message renders in place; a removed review vanishes. Same stamp, opposite read.** Not an inconsistency. A review feed is a list of independent opinions and a missing one is unnoticeable. A conversation is sequential, the people in it already saw the message, and a silent hole is a conversation everybody misreads — plus it hands the author deniability the room can see through. So the row keeps the words (preserved exactly, as `reviews` does) and the wire does not carry them, the author and avatar stay because attribution is not the thing being removed, and the reason renders in the closed vocabulary's own phrase.

19. **There is no appeal path, and the notice says so rather than implying one.** Founder decision #4's default. The consequence Phase 2 already recorded is that `--reason` is author-facing copy with no reply channel; this plan inherits it for chat and for warnings. The ruling is not the absence, it is the disclosure: a notice that describes a decision and offers no reply invites a member to hunt for one, so `operator_warning` says outright that there is no reply to it. Adding an appeal later is a new notice type and a new flag type in the queue this plan already built, which is why not building one now costs nothing later.

20. **pg-13 stays, documented as unreviewed, and GIF removal needs no second code path.** Founder decision #1's default. The engineering half is free: a GIF is one `chat_messages` row (`identity-and-trust.md`'s ruling 17 refused a second event type for exactly this reason), so the removal stamp covers it by construction the day a Giphy key arrives. The policy half stays a founder question and is put in front of the persona panel rather than left in a decision doc, because "is pg-13 the right ceiling for a real-money product" is a question four personas will answer differently and that difference is the useful output.

21. **`src/moderation` is one client-safe home for the removal vocabulary, and it is deliberately not `src/integrity`.** Founder decision #2 says one vocabulary, two record types, and two record types cannot share a vocabulary that lives inside one of them. It cannot live in `src/integrity/**` either: that directory is on the client-boundary **blocked** list because it reads `node:crypto` and Postgres, and the chat report dialog in `src/chat-room/**` needs the reason labels as values. So a third pure directory, browser-safe and exempt, joining the coverage gate. `src/reviews/config.ts` re-exports from it so the diff at every existing consumer is zero, which is what makes this a de-duplication rather than a refactor. Two similar names, two boundaries: `integrity` is the server-only machinery, `moderation` is the vocabulary of what may be removed and why.

22. **Operator-only removal. A commissioner cannot remove content, even in their own private league.** Founder decision #3's default, and §4.1's reasoning is why it is not obviously wrong for private leagues either: *"a public league can't trust a stranger the same way."* The asymmetry a member will notice is that a commissioner can already remove a **member** but not a **message**, which is worth saying out loud somewhere a commissioner reads rather than letting them discover it while angry. Commissioner removal in private leagues stays a later, additive decision: one more actor branch in `removeChatMessageInTx` and one more entry in the audit payload.

23. **A stat correction is one transaction per league.** Plan A's ruling 3: a transaction appends to at most one chain, and `recordAll` throws on a batch spanning scopes. Two leagues affected by one week's revision means two transactions and two league chains. The global `persistTick` runs once before them, outside any of them, because `stat_weeks` is keyed on week alone and is not league-scoped at all. A partial failure therefore means some leagues re-settled and some did not, which is recoverable by re-running (the machinery is idempotent) and is strictly better than one giant transaction holding a lock on every affected league's chain at once.

24. **Only managers whose points moved are told, and the notice names whether the result moved with them.** "Every affected manager" (founder decision #11) means affected, not present: a manager whose score did not change did not have anything change. The second half is the part that stings and therefore the part that must be explicit — a member reading "your score changed by 0.4" and discovering three days later that it turned a win into a loss has been told a true thing and misled anyway. The outcome clause is one of three fixed strings resolved by the caller, never a free-form sentence, so every sentence the notice can produce is covered by the copy sweep rather than one sample of it.

25. **There is no hard reach-back limit on a correction; the request budget is the real ceiling and it fails closed.** Founder decision #11's default. A hard limit would be inventing a number, and the machinery is genuinely idempotent at any depth. What actually bounds it is `RequestBudget`, which is a shared monthly ceiling with no release path and which deliberately fails **closed** on a Redis outage unlike every cache in this repo. An operator correction is a third spender against that key beside the worker and the backfill reserve, so it reserves in two phases exactly as the worker does and the script prints the delta last and always.

26. **`src/league-service`, `src/draft-service` and `src/moderation` join the coverage gate as 17, 18 and 19.** The first two are the recommendation Plan A's final whole-branch review left for this plan by name, and the reasoning is the one that produced gates 13 through 16: every whole-branch review in this loop has found its HIGH findings in the service layer, and this plan writes into both directories. The third is a new pure directory and every pure directory gates. Each gets an `include` entry **and** a `thresholds` block, because an `include` entry with no threshold is not a gate at all — the exact defect a Phase 2 fix wave caught in `src/stats`.

27. **Two persona panels, contradicting the overview.** The overview says *"the admin views are operator surfaces, not persona surfaces."* That is wrong on its own terms: an operator triaging forty flags at 11pm on a phone, an accused member reading a warning with no reply box, and a reporter who will never learn what happened are three people with three different relationships to this plan's output, and two of the three are ordinary members. The panels are split by audience rather than by surface — one over the operator's queue, one over the member-facing moderation arc — because the questions do not overlap.

28. **One `integrity_flags` table with a `flag_type` discriminator, not one table per detector.** The spec names `MultiAccountFlag` and `TradeFairnessFlag`, and Plan C would add a third of everything: three queue queries, three detail views, three resolution paths for one workflow. One table means Plan C adds a subject renderer and a row type. The cost is a jsonb `evidence` column whose shape varies by flag type, which is what a discriminated union is, and which `queue-view.ts` narrows at the one place it is read.

29. **The seed raises real flags through the real detector, not decorative rows.** The spec asks to *"seed several multi-account and trade-fairness flags at different severities for manual verification."* Inserting flag rows directly would be mock data on a real surface, which the founder rules forbid, and would prove nothing about the path that raises them. Instead the seed creates two accounts in one league sharing a client signature and runs the sweep, and creates a reported review. What an operator sees locally is what the detector actually produces. Trade-fairness severities are absent because no trade exists; Plan C's seed adds them.

30. **The queue is oldest-first with no severity sort and no bulk action.** A severity ordering over a heuristic score is the platform quietly telling an operator which accusations to believe, on the strength of a number this plan's own tests say will be high for roommates. Oldest-first is the only ordering that cannot express an opinion. It is also the ordering that starves nobody, which matters because the two flag types with a human on the other end (a report) are the two an operator resolving by score would reach last. This is wrong at a queue volume no human can clear, which is the day the answer is more operators or better heuristics, not a sort that hides the backlog.

---

## Self-review

**Spec coverage — Step 2 (multi-account detection heuristics), task by task:**

| Spec task (lines 119–127) | Where |
|---|---|
| Tests first for each heuristic in isolation, hand-computed scores for known-similar and known-dissimilar synthetic pairs | Task 8 step 1. All three, with the arithmetic shown in the test bodies, and the degenerate cases (empty union, below the sample floor) named rather than left to a reader to trust |
| Extend the session model to capture a coarse device fingerprint and the request IP; log each session start as `SESSION_STARTED` | Task 7. The `session_started` event already exists (Plan A, `/callback`); the signals are new and land in `session_signals` rather than the audit payload, with rulings 7 and 9 giving the two reasons |
| `computeDeviceSimilarityScore`, `computeIpCorrelationScore`, `computeBehavioralSimilarityScore` as pure functions, each independently unit-tested | Task 8 step 1. Named `deviceSimilarity` / `ipCorrelation` / `behavioralSimilarity` to match this repo's existing naming (`tradeBalance`, `matchesBrowseFilter`), which is the same "shipped spelling wins" call Plan A made on the event vocabulary |
| Combine into a weighted score; weights and `MULTI_ACCOUNT_FLAG_THRESHOLD` in config, not inline | Task 8 steps 2 and 3. `INTEGRITY_CONFIG.multiAccount`, per ruling 24 of Plan A and this config's own docblock |
| Bound the comparison to accounts that share a league; never platform-wide | Task 9 step 2, the first test, which asserts the pair count as well as the flag count so a widened sweep fails loudly rather than quietly costing more |
| On crossing the threshold, write a `MultiAccountFlag` at `PENDING_REVIEW` with the scores that produced it, plus `FLAG_RAISED` — nothing else | Task 9 step 3. One `integrity_flags` row (ruling 28) with `evidence`, and one `flag_raised` on the platform chain (ruling 1) |
| An explicit "flag only, never auto-ban" contract test | Task 9 step 1, `src/integrity/flag-only.test.ts`, in `advisory-only.test.ts`'s shape with all four of its earned properties: a type-level guard, a non-vacuity assertion, recursive traversal with `.test` as the only exclusion, and every offender collected |
| Tests for shared device, shared IP and family-in-one-league that assert a flag IS produced and name that as correct | Task 9 step 2, the `describe("known false positives, which are CORRECT behavior and not defects")` block, with `DO NOT "FIX" THIS TEST` in the body of the first |

**Spec coverage — Step 2's exit criteria:**

| Exit criterion | Where |
|---|---|
| Each heuristic has an independent suite with hand-computed expected values | Task 8 step 1 |
| Threshold and weights load from config; a test proves a config change alters flagging with no code change | Task 9 step 2, the `sweepWith({ flagThreshold })` pair. The sweep takes weights and threshold as an argument precisely so this test is possible |
| No automatic account action is reachable; flags only ever land at `PENDING_REVIEW`, verified by an explicit test | Task 9 step 1, four properties, including the `@ts-expect-error` proving `RaiseFlagInput` has no resolution field and the import-closure assertion proving the detector cannot reach `grantAdmin` |

**Spec coverage — Step 4, the admin half only (the member feed shipped in Plan A):**

| Spec task (lines 192–197, 199–200) | Where |
|---|---|
| Tests first for a `DisputeQueue` read model aggregating flag records filtered by status, oldest-first | Task 5 step 3. `listPendingFlags`, served by the partial `integrity_flags_queue_idx`, with `pendingFlagQuery` exported for the table-set assertion `feedQuery` and `browseQuery` already precedent |
| A minimal `isAdmin` boolean, not a permissions framework, gating all dashboard routes | Task 1. One boolean on `users`, `requireAdmin` beside `requireCurrentUser`, and Task 5's route-tree contract test proving no admin file can forget the gate |
| An admin list with full context: component scores and signals for a multi-account flag | Task 5 step 4 for the list, Task 9 step 4 for the multi-account renderer, which lands with the detector rather than ahead of it |
| A flag detail view surfacing the relevant Step 1 audit trail | Task 5 step 3, `flagDetail`'s `trail`, reading the platform chain by `flagId` and the league chain for the subject |
| `resolveFlag(flagId, decision, adminNote)`, fixed enum, own `FLAG_RESOLVED` event, never mutating a flag or an audit record | Task 3. The enum is ruled in Task 2 (rulings 2 and 3); "never mutates" is honored as a guarded one-way stamp with ruling 4 stating the argument in full |
| Only `PENDING_REVIEW` flags are resolvable; resolution is one-way, no re-opening | Task 3 step 1. The guard is in the `UPDATE`'s own `WHERE`, and the concurrent-operators test proves exactly one wins |
| A test proving raw scores are in the admin detail view and absent from the member activity feed | Task 5 step 2 (the module-level half) and Task 9 step 4 (the end-to-end half, against a real flag from the real detector). This is the criterion Plan A's decision doc explicitly deferred to this plan |
| Seed several flags at different severities for manual verification | Task 9 step 5, through the real detector rather than as rows (ruling 29). Trade-fairness severities are Plan C's, named |
| A non-admin session cannot reach any dashboard route or call `resolveFlag`, verified by an explicit test | Task 5 step 1, plus Task 1's grep proving nothing in the product writes `is_admin` |

**Overview obligations:**

| Obligation | Where |
|---|---|
| The minimal `isAdmin` plus a `requireAdmin` seam, explicit test that a non-admin reaches nothing | Task 1, Task 5 step 1 |
| Session/device signal capture, no paid fingerprinting vendor | Task 7. No vendor, and no client beacon either (ruling 9) |
| Three pure heuristics, then the weighted combination and the threshold, all in `INTEGRITY_CONFIG` | Task 8 |
| The league-bounded comparison, the flag at `PENDING_REVIEW`, the `FLAG_RAISED` event | Task 9 steps 2 and 3 |
| The flag-only contract test in `advisory-only.test.ts`'s shape | Task 9 step 1 |
| The known-false-positive tests, named so nobody "fixes" them | Task 9 step 2 |
| `DisputeQueue` over every flag type, filtered by status, oldest-first; list and detail with context and audit trail | Task 5 |
| `resolveFlag` — fixed enum, one-way, only from pending, never mutating, own audit event | Task 3 |
| The allowlist proof | Task 5 step 2 and Task 9 step 4 |
| Residual: the review report queue's first consumer; `removeReview` in-product, script retained | Task 4 |
| Residual: chat content removal as a stamp mirroring `reviews`, removed state rendered, author told, GIFs covered, migration trap named | Task 6, with ruling 17 turning the trap into a test written before the migration |
| Residual: the post-final stat-correction operator path, `SYSTEM_ACTION`, `notifyAffectedMember` for every affected manager | Task 10 |
| Persona-panel step on the member-facing halves | Task 6 step 5, plus a second panel on the operator surface (Task 5 step 6, ruling 27) |
| The IP heuristic ships at weight zero with a test that device plus behavioral alone cross the threshold; the flip recorded as a release gate | Task 8 step 3, Task 9 step 2, Task 11 step 2 section 7, rulings 8 and 10 |
| `ACCOUNT_RESTRICTED` absent | Ruling 2, with the same test applied to `TRADE_REVERSED` and a different answer |
| Founder decision defaults 1, 2, 3, 4, 5, 11 and 12 as shipped | Rulings 20, 21, 22, 19, 2, 25 and 15 respectively, each named in the decision doc's sections 1, 8 and 10 |
| New gated dirs join with `include` **and** `thresholds` | Task 11 step 1, sixteen to nineteen |
| 8 to 12 tasks; final task is docs plus the closing battery including the pooler-routed suite and a double e2e | Eleven tasks; Task 11 step 5 |
| Nothing depends on Phase 2 Plan D landing | The only Plan D interaction is one config weight and one stored discriminator (ruling 8), both shipped and both inert |

**Plan A obligations this plan inherits:**

| Carried item | Where |
|---|---|
| `flag_raised`, `flag_resolved`, `admin_action` reserved with `plan-b` in `reserved.test.ts`'s `OWNER` map | Moved in Tasks 1, 2 and 3 respectively; the test fails until each is |
| No new audit event type may be added (`ALTER TYPE` is a trap) | This plan adds none. The whole 16-entry vocabulary already ships as the pg enum |
| The everyone-visible `renderSystemAction` pre-wiring gate, re-review required before a league-scoped `system_action` | Task 10 step 1, closed with a third deny-by-default dimension and a pre-decided answer for Plan D's `lineup_auto_set` (ruling 13) |
| The write-ordering rule and the one global lock order (business → notice → anchor → attach → commit → deliver) | Every transaction in Tasks 1, 2, 3, 4, 6, 7 and 10, each added to `lock-order.test.ts`. The one deliberate exception is named and argued (ruling 11) |
| `notifyAffectedMember(tx, input)` called by name; `member_notices.notice_type` is `text` so no `ALTER TYPE` is needed | Four new notice types across Tasks 1, 3, 6 and 10, each compile-forced into `NOTICE_TEMPLATES` and `NOTICE_SAMPLES` and swept by `notices.test.ts` on arrival |
| Gates 17/18 recommended for this plan | Task 11 step 1, plus gate 19 (ruling 26) |
| First-verification-per-chain is a documented binding floor | Task 11 step 5, the `audit:verify --full` line, with the reason restated |
| `quoteFor`'s blockquote branch is unreachable today and kept for the plans that add quotable league-scoped notices | Tasks 3 and 6 are those plans: `operator_warning` and `chat_message_removed` both quote and both are league-scoped |

**Placeholder scan:** no `TODO`, no `TBD`, no "handle errors appropriately", no "similar to Task N", no step whose expected output is unstated. Every file in the File Structure tables appears in a task's Files block. Six places name a helper the executing engineer writes to taste rather than showing it in full — `existingOpenFlagFor` and `alreadyResolvedOrMissing` (Tasks 2 and 3), the three admin page bodies (Task 5 step 4), `src/app/api/admin/_shared.ts`'s limiter, the profile readers in Task 9 step 3, and the preflight print in Task 10 step 5 — and each names the existing file in this repo whose shape it copies (`src/app/api/notices/_shared.ts`, `src/app/api/reviews/[reviewId]/report/route.ts`, `src/league-service/home.ts`'s bounded-query idiom, `scripts/remove-review.ts`), which is a pointer to real code rather than a placeholder.

**Type consistency:** `FlagType`, `FlagSubjectType`, `ResolutionDecision` and `FlagStatus` are each declared once in `src/integrity/flags.ts` as a `readonly` tuple with the union derived from it, the `REALTIME_EVENT_TYPES` shape this repo uses everywhere. `SUBJECT_OF` and `DECISION_OWNER` are exhaustive `Record`s over those unions, so an added member without a decision is a compile error, matching `ACTIVITY_VISIBILITY` and `NOTICE_TEMPLATES`. `IntegrityFlag` is one interface, returned by `raiseFlag`, stored by `integrityFlags`, read by `listPendingFlags` and narrowed by `queueRowFor`, with `raisedAt`/`resolvedAt` strings in TypeScript and `Date` only at the Drizzle boundary — the same discipline `AuditEvent` already keeps. `SignalScores` is one type produced by the three heuristics and consumed by `multiAccountSuspicion` and by `evidence`. `RemovalReason` is declared once in `src/moderation/removal.ts` and is what `reportReviewSchema`, `reportMessageSchema`, both removal services and both scripts validate against, replacing the `readonly string[]` that widens today. `ChatMessageView.removal` is one nullable object rather than three loose fields, so a half-removed message is unrepresentable. `SystemActionCode` is declared once and is the key of both `SYSTEM_ACTION_SUMMARY_ALLOWED` and every `system_action` payload this plan writes.

**Boundary check:** `src/integrity/**` and `src/integrity-service/**` are already on `SERVER_ONLY_MODULE_GROUPS` (Plan A, ruling 14) and stay there; nothing in this plan asks browser code to value-import either. `src/moderation/**` joins the **exempt** list beside `src/chat`, `src/matchmaking`, `src/identity`, `src/help` and `src/reviews`, because it is pure, has no Node imports and is value-imported by `src/chat-room/components/report-dialog.tsx`; ruling 21 states why it is not part of `src/integrity`. `src/chat-service/moderation.ts` imports `@/integrity-service` and `@/moderation`; `src/chat-room/**` imports `@/moderation` and `@/chat` as values and `@/chat/contract` as types, which is the boundary unchanged. `src/app/app/admin/**` and `src/app/api/admin/**` are under `src/app/**`, where the client-boundary rule is deliberately not applied, and they import `@/integrity`, `@/integrity-service` and `@/lib/auth` as the other route trees already do. `scripts/grant-admin.ts`, `scripts/correct-stat-week.ts` and `scripts/sweep-multi-account.ts` import `src/**`, the allowed direction; nothing under `src/**` imports `scripts/**`, which the existing `src→scripts` eslint ban enforces.

**Founder rules:** two persona panels, both marked as controller steps (Task 5 step 6, Task 6 step 5), split by audience because the operator's questions and the accused member's questions do not overlap. Every user-facing string quoted in this plan is em-dash and en-dash free and is written in the active voice, which is not a stylistic preference here — `INTEGRITY_CONFIG.notices.passiveConstructions` bans `"was removed"` and `"is kept"`, the two phrases every sentence in this plan most wants to use, and `notices.test.ts` sweeps every template the moment it lands. No new UI primitive and no new icon: `shield`, `alert-triangle`, `x` and `check` are already in `ICONS`, which is what "centralize the first time" looks like three phases later. No mock data on a real surface: the seeded queue is filled by the real detector from real rows (ruling 29). Nothing here is built in a shape a later phase plans to throw away — the flag table admits Plan C's trades as a `flag_type` and a subject renderer, the decision vocabulary admits `trade_reversed` as an owner change, the notice registry admits Plan D's three types as three template entries, and `SYSTEM_ACTION_SUMMARY_ALLOWED` admits Plan D's enforcement actions as decided entries rather than as a rediscovered question.

**Two things this plan deliberately does not do, stated so neither is mistaken for an oversight.** It does not tell a reporter what happened to their report. Telling a reporter the outcome tells them the outcome of a decision about somebody else, and the alternative — a bare "we looked at it" — is a notification with no information in it. What the reporter gets is confirmation at the moment of reporting, which is on the persona panel's list. And it does not let a member appeal anything, per founder decision #4, which is why the one notice that could invite an appeal says outright that there is no reply to it.

