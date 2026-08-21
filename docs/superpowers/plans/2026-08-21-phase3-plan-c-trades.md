# Phase 3 Plan C — Trades: Execution First, Then Fairness Flagging

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the trade this product has been analyzing since Phase 1 and has never been able to make, then turn the analyzer that judged it into the platform's own collusion detector without writing a second line of scoring logic.

**Architecture:** Five strands. **(1) The pure layer.** `src/trades/**` is a new pure, browser-safe directory (gate 20) holding the trade's vocabulary, its lifecycle state machine, and — moved here once, re-exported so no consumer's diff is non-zero — `tradeBalance`, the fairness core that has lived unguarded inside `src/ai-advisor/**` since Phase 1 (ruling 2). Four thresholds now sit on one points-per-week axis and one test orders all four (ruling 6). **(2) The negotiation.** `trade_proposals` is one row per offer, its status a guarded one-way stamp in the `UPDATE`'s own `WHERE` — the shape `reviews.removed_at` and `integrity_flags.resolved_at` already use twice. Propose, withdraw and reject are private between two managers and hidden from the league feed (ruling 12); acceptance is league news. **(3) The execution.** `applyTradeInTx` is the first writer of `roster_slots` since the draft commit, and the only one that moves a player between two teams. It clears both sides before it places either, it reuses `assignSlot` rather than inventing a second slot policy, and — the sharpest thing in this plan — it **materializes both teams' lineups for every locked week before it touches a roster**, because `getLineup` falls back to the roster when a team never opened the editor, so a trade would otherwise retroactively change what a manager fielded in a week that has already been scored (ruling 14). **(4) The detector.** The fairness score is computed **inside** the accept transaction, because Plan D needs the auto-hold decision there; the flag is written **after** it commits, in its own transaction, because a flag appends to the platform chain and a trade appends to the league chain and Plan A's ruling 3 forbids one transaction spanning two (ruling 22). It lands in Plan B's existing queue as the `trade_fairness` type Plan B declared and left unraised. **(5) The reversal.** `trade_reversed` stops being a reserved word: `resolveFlag` gains a real compensating transfer, `decisionIsAvailable` stops asking which plan owns a decision and starts asking whether it is wired (ruling 9), and the reversal's `roster_move` goes on the **league** chain and is visible, while the `flag_resolved` that ordered it stays on the platform chain and is not — the two-class sentence `operators-and-moderation.md` §5 wrote, applied to its first new case.

**Tech Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · `node:crypto` (sha256, no new dependency) · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright.

**Spec:** `plans/phase-3-trust-and-integrity.md` — **Step 3** in full (lines 145–176), plus the trade-execution precondition Steps 3 and 5 both assume and which the spec's own dependency graph never builds. Phase split, founder-decision defaults and the residual ledger: `docs/superpowers/plans/2026-08-20-phase3-overview.md` (Plan C, lines 125–154). The primitives this plan consumes and the invariants that bind it: `docs/superpowers/plans/2026-08-20-phase3-plan-a-audit-spine.md`, `docs/superpowers/plans/2026-08-20-phase3-plan-b-operator-surface.md`, `docs/decisions/audit-and-integrity.md`, `docs/decisions/operators-and-moderation.md`.

**Depends on Plans A and B, both merged** (`main` at `408930b`). It **does not depend on Phase 2 Plan D** and it does not depend on Plan D of this phase. The one place Plan D reaches into this plan is a seam and a null: `INTEGRITY_CONFIG.trade.autoHoldThreshold` is `null` on merge, `evaluateTradeBeforeExecute` already has the branch that reads it, and Plan D supplies a number rather than a code path (ruling 7).

**Consumers this plan ships for, by name.** Plan D takes the auto-hold seam in `acceptTrade`'s transaction (Task 5), the `trade_held_for_review` system-action code Plan B pre-denied (ruling 8), and the fairness score `evaluateTradeBeforeExecute` already returns. Phase 9 takes `TradeAsset` as a discriminated union whose second case is an added arm, never a fork (ruling 11). Every reserved-but-unexercised name this plan leaves behind names its plan in its own docblock, exactly as Plan A's `reserved.test.ts` and Plan B's `DECISION_OWNER` already force.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope** (money, tax, native apps come later), not quality. Nothing gets built in a form a later phase plans to throw away — which is why this plan builds the general trade path rather than the flag-shaped stub Step 3 could have been satisfied with, and why `TradeAsset` is a union with one arm today rather than a bare `playerId`.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism"*. Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree; they all talk to one shared stack.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let`).
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`).
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. `users.id` **is** the WorkOS user id. API and SSE routes never redirect — they return a JSON 401 themselves. **`teamId` is always resolved from the authenticated session, never from a request body** — the rule the draft engine has honored since Phase 1 and the rule a trade is most tempting to break, because a trade names two teams and only one of them is yours.
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. No Socket.io, no managed realtime vendor, no second transport — ever. **This plan adds no realtime event type**: an executed trade reaches both managers through the `notice.created` frame Plan A built, and reaches the league through the activity feed on next load (ruling 13).
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. Every accepted action is persisted before it is cached or published.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**`, `src/admin-room/**` and `src/account-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/review-service`, `@/identity-service`, `@/integrity`, `@/integrity-service`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed`, `@/stats-pipeline`, `@/stats` or `@/gifs` as VALUES. `import type` stays allowed. Exempt pure directories that browser code MAY value-import: `src/chat/**`, `src/matchmaking/**`, `src/identity/**`, `src/help/**`, `src/reviews/**`, `src/moderation/**`. **This plan adds `src/trades/**` to that exempt list** (ruling 3). The rule is deliberately **not** applied to `src/app/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them. `INTEGRITY_CONFIG`'s own docblock binds this plan by name: *"Plans B, C and D add FIELDS here, never new files."* `TRADE_FAIRNESS_FLAG_THRESHOLD` and `TRADE_AUTO_HOLD_THRESHOLD` are therefore fields on `INTEGRITY_CONFIG.trade`. Everything about the trade **product** rather than its integrity — expiry, side sizes, proposal caps — is `TRADE_CONFIG` (`src/trades/config.ts`), the 24th colocated config (ruling 5).
- **Tests.** **Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/trades`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **Coverage threshold: 100%** for the gated directories, configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block (an `include` entry with no threshold is not a gate at all). **Nineteen** gated directories on `main` today. **This plan adds one** — `src/trades` as gate 20 (Task 10, ruling 26). Every other directory this plan writes into (`src/league-service`, `src/integrity`, `src/integrity-service`, `src/draft-service`) is already gated at 100%, so the new execution and detection code is covered by construction rather than by intention. Verify with an **unfiltered** `npm run test:coverage`.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). **There is no dev auth bypass and none may be added** — which is why this plan's trade e2e drives two real sealed sessions rather than posting as one user twice.
- **Any step shipping a user-visible surface additionally requires:** a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width. **An operator surface is a user-visible surface** (Plan B, ruling 27) — so the queue's new trade detail is in scope too.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy); once deployed, add with a DEFAULT or backfill in a separate migration. Any migration touching `chat_messages` is checked against `src/db/index-plans.test.ts` (Plan B ruling 17) — **this plan touches no such table, and adds its own EXPLAIN assertions over a realistic corpus instead** (ruling 24).
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. Fail fast with a clear message when a required var is missing. **This plan adds no environment variable.**
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional, and `EmptyState`/`ErrorState` inherit that). **An empty trade inbox is the state most managers see most weeks and it still may not be a dead end** — it offers the propose flow.
- **Both themes are first-class.** Every surface is designed and tested in light and dark, via `inBothThemes` from `src/components/ui/test-utils.tsx`. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** `IconName`s on `main` today: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`, `info`, `shield`, `flame`, `anchor`, `rocket`, `crown`, `bolt`, `clover`. **This plan adds none**: `refresh-cw` is already the trade glyph (Plan B chose it for `ICON_FOR_FLAG_TYPE.trade_fairness`), `inbox` is the inbound offer, `check` and `x` are accept and decline (ruling 29).
- **`PositionBadge` is the only way to render a position label; `Sticker` is the only way to render a position-pigmented tile.** Nothing else may reach for `bg-pos-*` directly. A trade is two lists of players and it renders them through those two primitives, not through a new one.
- **Never set the display face on a paragraph.** It is a lettering face, not a reading face.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/decisions/data-layer-hardening.md`:**

- **Balance as rollup.** Any running total is a rollup row updated **in the same transaction** as each contributing write, over an append-only source table that stays the reconciliation source of truth. Never a `SUM()` on the read path. The threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one. **A team's open-proposal count is bounded by `TRADE_CONFIG.maxOpenProposalsPerTeam`, so the cap is enforced by a counted read inside the transaction and never stored** (ruling 20).
- **PgBouncer transaction pooling forbids session state.** No `pg_advisory_lock`, no named prepared statements (`prepare: false` is unconditional), no `SET` outside a transaction, no session-scoped temp tables, **no `LISTEN`/`NOTIFY`**. DDL goes through the direct port, never the pooler.

**From `docs/decisions/audit-and-integrity.md` (Plan A's rulings, binding here):**

- **The audit append and the notice row are inside the business transaction and fail it; only the Redis frame is best-effort.** The inverse of the publishing rule, in the same flow, deliberately. Every write in this plan obeys it.
- **The lock order is one global order and the audit anchor is ALWAYS the last lock**, where "lock" includes an implicit foreign-key `FOR KEY SHARE`. The permitted sequence is: business rows → notice insert → `audit.record` → `attachAuditEvent` → commit → `deliverNotice`. `src/integrity-service/lock-order.test.ts` catches a violation against real Postgres on two connections with a `pg_stat_activity` rendezvous, and **this plan extends it with every transaction it adds** (ruling 17).
- **A transaction appends to at most one chain.** `recordAll` throws on a batch spanning two scopes. This is the single constraint that decides where the fairness flag is written (ruling 22).
- **`audit_events` carries no foreign keys and nothing ever deletes a row.**
- **Deny by default, on every visibility dimension.** `ACTIVITY_VISIBILITY` is an exhaustive `Record` over the whole `AuditEventType` union; a type with no decision does not compile. Four entries in it say `// Plan C` today and this plan is what decides them (ruling 12).

**From `docs/decisions/operators-and-moderation.md` (Plan B's rulings, binding here):**

- **One `integrity_flags` table with a `flag_type` discriminator.** Plan C adds a subject renderer and a row type, never a second queue.
- **Investigatory events go on the platform chain; a consequence the league already sees goes on the league chain.** The sentence that decides which: *a record about a person under review is not the league's business; a record about a consequence the league already sees is.* A trade is league content, so every `trade_*` and `roster_move` event this plan writes is **league**-scoped (ruling 1).
- **A resolution decision exists when it has an implementation, or a named owning plan plus a runtime refusal.** `trade_reversed` was declared with `plan-c` as its owner and refused at runtime. **This plan is the owner and this plan implements it** (ruling 9).
- **The queue is oldest-first with no severity sort and no bulk action.** A `trade_fairness` flag takes its place in the same line as a reported message, however lopsided the trade was.
- **`SYSTEM_ACTION_SUMMARY_ALLOWED` denies `trade_held_for_review` in advance.** This plan does not flip it (ruling 8).

**Founder rules (binding, from the phase overview and founder memory):**

- **No em-dashes in user-facing copy**, and in this codebase that rule has grown teeth: `copyViolations` (`src/integrity/copy-rules.ts`) is one rulebook enforcing three rules — no em **or en** dash, nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms`, nothing in `INTEGRITY_CONFIG.notices.passiveConstructions`. Five sweeps enforce it (`notices.test.ts`, `activity-view.test.ts`, `rendered-copy.test.tsx`, `room-copy.source.test.ts`, `script-copy.source.test.ts`) and **this plan extends the source sweep's `ROOM_DIRS` with `src/league-room`** so its own components are covered by directory rather than by memory (ruling 27).
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. **Two panels in this plan** (Task 8 and Task 7): the member trade arc, and the operator deciding whether to undo a trade two people agreed to.
- **Centralize UI primitives the first time.** No page-local visual mapping; extract to `src/components/ui/` and refactor the existing consumer in the same commit.
- **No mock data on real surfaces.** The seed proposes and accepts a genuinely lopsided trade through the real routes so the operator queue gets a real `trade_fairness` flag from the real detector — the severities Plan B's ruling 29 named as *"Plan C's seed adds them"* (ruling 28).

---

## What is already true (read before touching anything)

| The spec assumes | Reality on `main` today (`408930b`) |
|---|---|
| A trade exists to subscribe to | It does not. `src/domain/trade.ts` is 30 lines: `TradeSide`, `TradeProposal`, `isBalancedProposal`, with a docblock that says outright *"Nothing in this phase executes one — no table stores it, no service applies it."* There is no `trades` table, no propose path, no accept path. **This plan builds all of it**, and that is why it is eleven tasks rather than the four Step 3 alone would need. |
| `TRADE_ACCEPTED` is a new audit event | It is not. Plan A declared all sixteen types as the `audit_event_type` pg enum, whose docblock states *"no later migration ever runs `ALTER TYPE … ADD VALUE`"*. `roster_move`, `trade_proposed`, `trade_accepted` and `trade_rejected` are all present, all `"hidden"` in `ACTIVITY_VISIBILITY`, and all owned by `"plan-c"` in `src/integrity-service/reserved.test.ts`'s `OWNER` map. **That test fails until this plan publishes all four.** This plan adds no audit event type. |
| `TradeFairnessFlag` is a new record type | It is not. `FLAG_TYPES` already contains `trade_fairness`, `FLAG_SUBJECT_TYPES` already contains `trade`, `SUBJECT_OF.trade_fairness` is already `"trade"`, `QUESTION_FOR_FLAG_TYPE.trade_fairness` already reads *"The platform flagged a trade for a fairness review"* and `ICON_FOR_FLAG_TYPE.trade_fairness` is already `refresh-cw`. Plan B built the whole shelf. **This plan raises the first one and fills in the stubs** — `subjectFor` returns `{ kind: "trade", tradeId: subjectId }` with no lookup (`flags.ts:688`) and `aboutFor` renders the literal `` `A trade (${row.subjectId})` `` (`flags.ts:611`). |
| `src/config/integrity.ts` holds `TRADE_FAIRNESS_FLAG_THRESHOLD` | It does not exist and will not. `INTEGRITY_CONFIG` (`src/integrity/config.ts`) is the 23rd colocated config and its docblock binds this plan: *"Plans B, C and D add FIELDS here, never new files."* The threshold is `INTEGRITY_CONFIG.trade.fairnessFlagThreshold`. |
| The trade analyzer is one function nobody can duplicate | It is one function living in an ungated directory. `tradeBalance` is `src/ai-advisor/valuation.ts:50`; `src/ai-advisor` is **not** coverage-gated and is on the client-boundary **blocked** list, so the fairness core the whole of Step 3 rests on is the one piece of arithmetic in this phase with no 100% gate over it. `ADVISOR_CONFIG` already anticipated the split — it sits in `src/domain/advisor.ts` explicitly so *"a future automated collusion sweep needs to read [the thresholds] without importing the advisor service."* Task 1 finishes the move the config file started (ruling 2). |
| `valuePlayers` lives beside `tradeBalance` | It does not. `valuePlayers` is `src/ai-advisor/context.ts:173` and it **silently drops unknown player ids**; `createTradeAnalyzer` detects the drop by comparing array lengths (`trade.ts:61-62`). The detector must do the same check or it will confidently value a ghost at zero. |
| Rosters are mutated in several places | They are mutated in exactly one: `commitDraftState` (`src/draft-service/commit.ts:38-44`), inside the draft's own transaction, once, when the draft closes. There is no add/drop, no waiver wire and no free agency — *a roster is fixed from draft to season end*. A trade is the **second** roster mutation this product has ever had and the first that moves a player between two teams (ruling 10). |
| `roster_slots` protects against a player on two teams | It does not. Its primary key is `(team_id, slot, slot_index)`, `player_id` is nullable and carries **no foreign key and no unique index**. Nothing at the database level stops a botched transfer leaving the same player on both rosters, which is why the transfer is one function, in one transaction, with an assertion on both sides (ruling 15). |
| A team's lineup is a stored fact | Only sometimes. `getLineup` (`src/league-service/lineups.ts:66`) returns saved `lineup_slots` rows when they exist and **falls back to `roster_slots` when they do not** — the deliberate "a manager who never opened the editor still fields a legal team" rule. `finalizeWeek` scores through `getLineup`, and Plan B's `correctSettledWeek` re-scores a settled week through the same call weeks later. **A trade that moved a player would therefore change what a manager is recorded as having started in a week that has already been played.** Task 4 is mostly about this (ruling 14). |
| `isWeekLocked` lives in `src/league/` | `isLineupLocked(status)` is pure and lives in `src/league/week-status.ts:36`; the two DB-touching halves, `weekStatusFor(db, week)` and `isWeekLocked(db, week)`, are in `src/league-service/lineups.ts:104` and `:116`. There is no trade deadline concept anywhere, and this plan does not invent one (ruling 16). |
| `resolveFlag` can be taught a new decision by adding a branch | It can, but two of its three refusals of `trade_reversed` are hardcoded. `decisionIsAvailable` asks `DECISION_OWNER[decision] === "plan-b"` (`flags.ts:58-60`), the schema `.refine`s on the same predicate (`schemas.ts:41-46`), and the service refuses with a literal string built for exactly one reserved decision (`flags.ts:413-421`, whose own comment hands the obligation to whoever reserves the next one). Task 7 replaces the ownership question with a wiring question (ruling 9). |
| `advisory-only.test.ts` will keep the advisor honest | It greps `src/ai-advisor/**` for a fixed `WRITE_PATTERNS` list that already names `setLineup`, `commitDraft` and `acceptInvite` by hand. **A trade executor is exactly the kind of call it exists to keep out of that directory and it is not in the list.** Task 1 adds it, in the same commit that gives the advisor a trade to be tempted by (ruling 4). |
| Nineteen directories are coverage-gated | Nineteen: `src/moderation` was gate 19. `src/trades` is gate 20, with an `include` entry **and** a `thresholds` block, because an `include` entry with no threshold measures nothing (ruling 26). |
| `toggleReaction` is transactional | It is not. `src/chat-service/chat.ts:306-348` runs a `SELECT`, an `INSERT … onConflictDoNothing().returning()` and a conditional `DELETE … returning()` on a bare `Db`. Plan B's final review adjudicated it as converging with no torn state and **carried it to this plan as a flake-reduction item**. Task 9 wraps it, and the commit body says which of the two it is (ruling 30). |

---

## File Structure

**New — the pure trade layer (`src/trades/**`, browser-safe, joins the coverage gate as the 20th):**

| File | Responsibility |
|---|---|
| `src/trades/config.ts` | `TRADE_CONFIG` — expiry, side sizes, the open-proposal cap, the note cap, the propose/accept rate limits. Everything about the trade as a **product**. The integrity thresholds stay on `INTEGRITY_CONFIG.trade`. |
| `src/trades/assets.ts` | `TRADE_ASSET_KINDS`, `TradeAsset`, `assetPlayerIds`, `assetsAreDistinct`, `describeAsset`. The discriminated union Phase 9 adds an arm to. |
| `src/trades/lifecycle.ts` | `TRADE_STATUSES`, `TradeStatus`, `TERMINAL_STATUSES`, `nextStatusFor`, `TradeTransition`, `transitionIsLegal`. The pure state machine, exhaustive over the union. |
| `src/trades/fairness.ts` | `ValuedPlayer`, `TradeVerdict`, `TradeFlag`, `TradeBalance`, `tradeBalance`, `fairnessGap`, `crossesFairnessThreshold`. The moved core, now gated at 100% for the first time. |
| `src/trades/contract.ts` | `TradeProposalView`, `TradeSideView`, `TradesPageBody`, `ProposeTradeBody`. The wire shapes `src/league-room/**` value-imports. |

**New — the trade service (inside `src/league-service/**`, already gate 17):**

| File | Responsibility |
|---|---|
| `src/league-service/trades.ts` | `proposeTrade`, `withdrawTrade`, `rejectTrade`, `acceptTrade`, `listTrades`, `tradeDetail`, `tradesQuery`. The one HTTP-facing seam. |
| `src/league-service/trade-transfer.ts` | `applyTradeInTx`, `materializeLockedLineupsInTx`, `plannedTransfer`, `TransferRefusal`. The atomic roster swap and the lineup freeze. Separate file because it is the piece Task 7's reversal calls a second time, in the opposite direction. |
| `src/league-service/trade-schemas.ts` | `proposeTradeSchema`, `tradeIdSchema`, `tradeDecisionSchema`. Zod v4 at the boundary. |

**New — the detector (inside `src/integrity-service/**`, already gate 16):**

| File | Responsibility |
|---|---|
| `src/integrity-service/trade-fairness.ts` | `evaluateTradeBeforeExecute`, `raiseTradeFairnessFlag`, `sweepUnflaggedTrades`, `TradeFairnessEvaluation`. Flag-only, proved by `flag-only.test.ts`. |

**New — the reversal (inside `src/league-service/**`):**

`src/league-service/trade-reversal.ts` — `reverseTradeInTx`, `ReversalRefusal`. Called by `resolveFlag`'s `trade_reversed` branch and by nothing else.

**Modified in `src/integrity/**`:** `config.ts` (`INTEGRITY_CONFIG.trade`), `flags.ts` (`DECISION_WIRED_FOR` replaces `CONTENT_REMOVAL_WIRED_FOR` and `decisionIsAvailable`'s ownership test), `notices.ts` (six new templates), `activity-view.ts` (four visibility decisions and their renderers), `queue-view.ts` (the `trade` subject view and its renderer), `test-support.ts` (`NOTICE_SAMPLES`), `flag-only.test.ts` (`INTEGRITY_DIRS` gains `src/trades`), `room-copy.source.test.ts` (`ROOM_DIRS` gains `src/league-room`).

**Modified in `src/integrity-service/**:** `flags.ts` (`subjectFor`/`aboutFor`/`trailFor`'s trade branches, `NOTICE_FOR_DECISION.trade_reversed`, the `trade_reversed` execution branch), `schemas.ts` (`resolveFlagSchema`'s refine), `reserved.test.ts` (four `OWNER` entries move), `lock-order.test.ts` (the three transactions this plan adds).

**New — routes and pages:**

| File | Responsibility |
|---|---|
| `src/app/api/leagues/[leagueId]/trades/route.ts` | `GET` the inbox/outbox/history, `POST` a proposal. |
| `src/app/api/leagues/[leagueId]/trades/[tradeId]/route.ts` | `POST` one decision (`accept` \| `reject` \| `withdraw`), discriminated in the body. |
| `src/app/api/leagues/[leagueId]/trades/_shared.ts` | `tradeRateLimited(userId)`, `resetTradeRateLimit()`. |
| `src/app/app/leagues/[leagueId]/trades/page.tsx` | The trade surface. |

**New — league-room components:** `trade-card.tsx`, `trade-inbox.tsx`, `trade-composer.tsx`, `trade-verdict.tsx`; hook `hooks/use-trades.ts`; modified `league-home.tsx` (the inbound-offer link), `contract.ts`.

**New — scripts:** `scripts/sweep-trade-fairness.ts` (+ `trades:sweep`), on `scripts/sweep-multi-account.ts`'s idiom.

**New — docs:** `docs/trades.md` (the feature narrative) and `docs/decisions/trades-and-fairness.md` (the rulings).

**New migrations:** `drizzle/0027_trade_proposals.sql`.

**Modified:** `src/db/schema.ts`, `src/db/test-db.ts` (`truncateAll` gains `trade_proposals`), `src/db/index-plans.test.ts`, `src/domain/trade.ts`, `src/domain/audit.ts` (three docblocks), `src/ai-advisor/valuation.ts`, `src/ai-advisor/advisory-only.test.ts`, `src/chat-service/chat.ts` (`toggleReaction`), `src/data/seed/**`, `vitest.config.mts`, `package.json`, `eslint.config.mjs`, `e2e/trades.spec.ts` (new), `e2e/mobile-360.spec.ts`, `docs/conventions.md`, `docs/advisor.md`, `docs/decisions/audit-and-integrity.md`, `docs/decisions/operators-and-moderation.md`, `README.md`.

---

## Task 1: The pure trade layer — one home for the fairness core, and four thresholds on one axis

The fairness function this whole step is built on has spent two phases inside `src/ai-advisor/**`: a directory with no coverage gate, on the client-boundary blocked list, whose own contract test exists to stop it doing anything. `ADVISOR_CONFIG` already moved out for this exact reason — its docblock says the thresholds live in `src/domain/` so *"a future automated collusion sweep needs to read [them] without importing the advisor service."* This task finishes that move for the function itself.

It also ends a real risk the overview named: `ADVISOR_CONFIG.evenDelta` (3) and `.lopsidedDelta` (12) are two thresholds on a points-per-week axis, this plan adds a third and Plan D adds a fourth, and the spec only asks for an invariant between two of them. One test orders all four.

**Files:**
- Create: `src/trades/config.ts`, `src/trades/config.test.ts`, `src/trades/assets.ts`, `src/trades/assets.test.ts`, `src/trades/lifecycle.ts`, `src/trades/lifecycle.test.ts`, `src/trades/fairness.ts`, `src/trades/fairness.test.ts`, `src/trades/contract.ts`
- Modify: `src/ai-advisor/valuation.ts` (+ its test), `src/ai-advisor/advisory-only.test.ts`, `src/integrity/config.ts` (+ its test), `src/integrity/flag-only.test.ts`, `eslint.config.mjs`, `src/domain/trade.ts`

**Interfaces:**
- Consumes: `ADVISOR_CONFIG`, `roundPoints` (`@/scoring`), `Position`, `RosterSlotType`, `TradeProposal`.
- Produces:
  - `TRADE_CONFIG`
  - `TRADE_ASSET_KINDS`, `TradeAsset`, `assetPlayerIds`, `assetsAreDistinct`
  - `TRADE_STATUSES`, `TradeStatus`, `transitionIsLegal`, `nextStatusFor`
  - `ValuedPlayer`, `TradeVerdict`, `TradeFlag`, `TradeBalance`, `tradeBalance`, `fairnessGap`, `crossesFairnessThreshold`
  - `INTEGRITY_CONFIG.trade`

Every later task in this plan consumes `src/trades`.

- [ ] **Step 1: Write the failing move test first, so the move is a de-duplication and not a copy**

`src/trades/fairness.test.ts` opens with the assertion that makes this a move:

```ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { tradeBalance } from "./fairness";
import { tradeBalance as reExported } from "@/ai-advisor/valuation";

describe("one fairness function, one home", () => {
  it("is the same function object the advisor calls, not a copy that could drift", () => {
    // Founder decision: the strategy doc's whole dual-use thesis is that a member and the
    // platform read ONE verdict. Two exported functions that happen to agree today is the
    // thing this assertion exists to make impossible.
    expect(reExported).toBe(tradeBalance);
  });

  it("leaves no second implementation behind in the advisor", () => {
    // A grep, not an import check: a re-export satisfies the identity test above even if
    // somebody later pastes the arithmetic back in beside it.
    const source = readFileSync(new URL("../ai-advisor/valuation.ts", import.meta.url), "utf8");
    expect(source).not.toContain("ADVISOR_CONFIG.lopsidedDelta");
    expect(source).not.toContain("ADVISOR_CONFIG.evenDelta");
  });
});
```

And the arithmetic itself moves with its existing tests. The behavior is pinned unchanged, boundary semantics included, because `docs/advisor.md` documents them as deliberate and members have already read verdicts produced by them:

```ts
const rb = (playerId: string, averagePoints: number): ValuedPlayer =>
  ({ playerId, name: playerId, position: "RB", averagePoints });

describe("tradeBalance", () => {
  it("is lenient at BOTH boundaries, exactly as docs/advisor.md documents", () => {
    // gap === evenDelta (3) is still "even" (gap <= evenDelta), and gap === lopsidedDelta (12)
    // is NOT flagged (the flag fires on gap > lopsidedDelta). Both spellings are load-bearing
    // now that an integrity threshold sits on the same axis.
    expect(tradeBalance([rb("a", 13)], [rb("b", 10)]).verdict).toBe("even");
    expect(tradeBalance([rb("a", 22)], [rb("b", 10)]).flags).toEqual([]);
    expect(tradeBalance([rb("a", 22.1)], [rb("b", 10)]).flags).toEqual(["value_gap_over_threshold"]);
  });

  it("reports the direction the delta actually points", () => {
    // delta = giving - receiving. Positive means the PROPOSER sends more value out, which is
    // the receiver's side of a favour, and the naming has been wrong in two other codebases.
    expect(tradeBalance([rb("a", 18)], [rb("b", 10)]).delta).toBe(8);
    expect(tradeBalance([rb("a", 18)], [rb("b", 10)]).verdict).toBe("favors_receiver");
    expect(tradeBalance([rb("a", 10)], [rb("b", 18)]).verdict).toBe("favors_proposer");
  });

  it("calls an empty side lopsided rather than infinitely favourable", () => {
    expect(tradeBalance([], [rb("b", 10)]).flags).toEqual(["empty_side", "uneven_player_count"]);
    expect(tradeBalance([], [rb("b", 10)]).verdict).toBe("lopsided");
  });
});
```

- [ ] **Step 2: Run them, watch them fail, then move the code**

`src/trades/fairness.ts` receives `ValuedPlayer`, `TradeVerdict`, `TradeFlag`, `TradeBalance`, `total` and `tradeBalance` verbatim from `src/ai-advisor/valuation.ts`, with the docblock rewritten to say where it now lives and why:

```ts
/**
 * The fairness verdict — **the platform's trade-fairness detector, not an advisor helper.**
 *
 * It moved OUT of `src/ai-advisor/**` in Phase 3 Plan C for three reasons, all of which the
 * advisor directory's own rules made unavoidable: that directory is coverage-ungated, so the one
 * piece of arithmetic this phase's integrity story rests on had no gate over it; it is on the
 * client-boundary BLOCKED list, so no browser code can read the verdict vocabulary; and
 * `advisory-only.test.ts` exists to prove nothing in it writes, which makes it a strange home for
 * a function the write path calls. `ADVISOR_CONFIG` already moved for the first of those reasons
 * and said so in its own docblock; this is the rest of that move.
 *
 * `src/ai-advisor/valuation.ts` re-exports every name below, so the diff at every existing
 * consumer is zero and `tradeBalance` is still one function object rather than two agreeing ones.
 */
export function tradeBalance(giving: readonly ValuedPlayer[], receiving: readonly ValuedPlayer[]): TradeBalance {
```

`src/ai-advisor/valuation.ts` keeps `StartSitCandidate`, `StartSitBaseline` and `baselineStartSit` (which are advisor-only and stay), and gains one line:

```ts
export { tradeBalance, type ValuedPlayer, type TradeVerdict, type TradeFlag, type TradeBalance } from "@/trades/fairness";
```

Two new pure helpers land beside it, because three later callers each need the same two derived facts and none of them should re-derive `Math.abs`:

```ts
/** The absolute points-per-week distance between the two sides. The one number every threshold
 *  on this axis is compared against. */
export function fairnessGap(balance: TradeBalance): number {
  return Math.abs(balance.delta);
}

/**
 * Whether a completed trade is far enough from even to be worth a human's attention.
 *
 * `threshold` is passed rather than read, so the spec's exit criterion ("a test proves changing
 * the config changes flagging outcomes with no code change") is a test that passes a different
 * number rather than a test that rewrites a module. A `null` threshold means the caller has no
 * ceiling configured and nothing crosses it, which is how Plan D's auto-hold ships inert.
 */
export function crossesFairnessThreshold(balance: TradeBalance, threshold: number | null): boolean {
  return threshold !== null && fairnessGap(balance) >= threshold;
}
```

Note `>=` where `tradeBalance`'s own `lopsidedDelta` test is `>`. That is deliberate and is ruling 6: the advisor's leniency is a copy decision a member reads, and an integrity threshold that skipped its own boundary value would be a threshold nobody could set exactly.

- [ ] **Step 3: `INTEGRITY_CONFIG.trade`, and the four-threshold order**

```ts
  /**
   * The trade-fairness axis, in points per week — the SAME scale `ADVISOR_CONFIG.evenDelta` (3)
   * and `.lopsidedDelta` (12) sit on, because `tradeBalance` is one function and its delta has
   * one unit. Four thresholds now live on that axis and `src/trades/config.test.ts` orders all
   * four; the spec asks for an invariant between two.
   */
  trade: {
    /**
     * The spec's `TRADE_FAIRNESS_FLAG_THRESHOLD`. A COMPLETED trade whose per-week gap reaches
     * this raises a `trade_fairness` flag into the operator queue. Deliberately above
     * `lopsidedDelta` (12): the advisor calls a 13-point gap lopsided to a member's face, and
     * every one of those reaching an operator would be a queue full of ordinary bad trades.
     * A flag is a question about collusion, not a review of somebody's judgment.
     */
    fairnessFlagThreshold: 20,
    /**
     * The spec's `TRADE_AUTO_HOLD_THRESHOLD`, and **Plan D owns it**. `null` means no trade is
     * ever held, which is what ships here: `evaluateTradeBeforeExecute` already reads this field
     * and already has the hold branch (Task 5), so Plan D supplies a NUMBER rather than a code
     * path. `src/integrity-service/reserved.test.ts`'s grep proves nothing in this plan reads it
     * for a real decision, the same way it proves a reserved event type has no publisher.
     */
    autoHoldThreshold: null as number | null,
    /** `sweepUnflaggedTrades`' page size — the manual re-run for a trade whose after-commit flag
     *  write did not land (Task 6). Bounded for the same reason `INTEGRITY_CONFIG.queue.pageSize`
     *  is: an operator script that reads an unbounded set is a script nobody runs twice. */
    sweepBatchSize: 100,
  },
```

`src/integrity/config.test.ts` gains the ordering invariant, and it fails loudly on any misordering rather than on one pair:

```ts
it("keeps all four thresholds on one axis in one order, not just the two the spec names", () => {
  const { evenDelta, lopsidedDelta } = ADVISOR_CONFIG;
  const { fairnessFlagThreshold, autoHoldThreshold } = INTEGRITY_CONFIG.trade;
  // even <= lopsided <= flag <= hold. Every one of these is a real failure mode if inverted:
  // even > lopsided makes the verdict unreachable; lopsided > flag flags trades the advisor
  // itself calls fine; flag > hold holds a trade nobody ever flagged, which is the spec's own
  // Step 5 invariant read the right way round.
  expect(evenDelta).toBeLessThanOrEqual(lopsidedDelta);
  expect(lopsidedDelta).toBeLessThanOrEqual(fairnessFlagThreshold);
  if (autoHoldThreshold !== null) {
    expect(fairnessFlagThreshold).toBeLessThanOrEqual(autoHoldThreshold);
  }
});

it("keeps every threshold on the axis positive and finite", () => {
  for (const value of [ADVISOR_CONFIG.evenDelta, ADVISOR_CONFIG.lopsidedDelta, INTEGRITY_CONFIG.trade.fairnessFlagThreshold]) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThan(0);
  }
});
```

- [ ] **Step 4: `TRADE_CONFIG`, the asset union, and the lifecycle**

`src/trades/config.ts` is the 24th colocated config. It holds the product's numbers, never the integrity ones:

```ts
/**
 * Every tunable the trade PRODUCT has. The integrity thresholds are deliberately not here:
 * `INTEGRITY_CONFIG.trade` owns what makes a completed trade a question for an operator, and
 * that file's own docblock reserves the right to be the one home for this phase's thresholds.
 * Two configs, two audiences, and the line between them is "would a commissioner tune this?"
 */
export const TRADE_CONFIG = {
  /** How long an offer stands before it stops being answerable. Lazy: checked on read and again
   *  inside the accept transaction, never by a scheduled job, because this product has no
   *  scheduler and inventing one for an expiry is how a plan grows a deploy dependency. */
  proposalTtlHours: 72,
  /** Most assets one side may send. Matches `ADVISOR_CONFIG.maxPlayersPerSide` (5) on purpose:
   *  a proposal the advisor cannot assess is a proposal a manager accepts blind. */
  maxAssetsPerSide: 5,
  /** Open offers one team may have outstanding at once, counted inside the proposing
   *  transaction. Bounded so a manager cannot paper a league with offers, and generous enough
   *  that shopping one player to three teams is normal use. */
  maxOpenProposalsPerTeam: 10,
  /** The optional note a proposer attaches. Read by one other human, so it is short. */
  noteMaxLength: 280,
  /** Per user, across every trade route: proposing, withdrawing, rejecting and accepting all
   *  spend the same scarce resource (a multi-table transaction against this league), the same
   *  "one budget across sibling routes" call `advisorRateLimited` and `INTEGRITY_CONFIG.notices
   *  .rateLimit` both make. */
  rateLimit: { maxRequests: 20, windowMs: 60_000 },
} as const;
```

`src/trades/assets.ts` is the shape Phase 9 extends:

```ts
/**
 * What one side of a trade sends. A UNION with one arm today, not a bare `playerId`, because
 * `plans/phase-9-dynasty-and-keeper-depth.md` adds draft-pick assets and the founder rule is
 * that nothing ships in a form a later phase throws away. Phase 9 adds
 * `{ kind: "pick"; draftId: string; round: number }` as a second arm; every `switch` in this
 * plan is exhaustive over `TradeAssetKind`, so that arm is a compile error until it is handled
 * everywhere rather than a silent default somewhere.
 */
export const TRADE_ASSET_KINDS = ["player"] as const;
export type TradeAssetKind = (typeof TRADE_ASSET_KINDS)[number];

export type TradeAsset = { readonly kind: "player"; readonly playerId: string };

/** Every player id an asset list touches. The one place a caller turns assets into roster rows. */
export function assetPlayerIds(assets: readonly TradeAsset[]): readonly string[] {
  return assets.filter((asset) => asset.kind === "player").map((asset) => asset.playerId);
}

/**
 * No asset appears twice across BOTH sides. A proposal naming the same player on both sides is
 * not a trade; a proposal naming the same player twice on one side would double-count him in
 * `tradeBalance` and produce a confident verdict about an impossible offer.
 */
export function assetsAreDistinct(from: readonly TradeAsset[], to: readonly TradeAsset[]): boolean {
  const ids = [...assetPlayerIds(from), ...assetPlayerIds(to)];
  return new Set(ids).size === ids.length;
}
```

with tests that name both failure modes:

```ts
it("refuses the same player on both sides", () => {
  expect(assetsAreDistinct([{ kind: "player", playerId: "p1" }], [{ kind: "player", playerId: "p1" }])).toBe(false);
});

it("refuses the same player twice on one side, which tradeBalance would double-count", () => {
  expect(assetsAreDistinct([{ kind: "player", playerId: "p1" }, { kind: "player", playerId: "p1" }], [])).toBe(false);
});
```

`src/trades/lifecycle.ts` is the state machine, and the exhaustive `Record` is the enforcement:

```ts
export const TRADE_STATUSES = [
  /** Live, answerable, and counting against the proposer's open cap. */
  "open",
  /** Both managers agreed and the rosters moved. TERMINAL. A later reversal stamps
   *  `reversed_at` on this row rather than moving it to a `reversed` status: the acceptance
   *  happened, and a status that erased it would make the audit trail and the row disagree. */
  "accepted",
  /** The counterparty said no. TERMINAL. */
  "rejected",
  /** The proposer took it back. TERMINAL. */
  "withdrawn",
  /** Nobody answered inside `TRADE_CONFIG.proposalTtlHours`. TERMINAL, and reached lazily on
   *  read or accept rather than by a scheduler. */
  "expired",
  /** A DIFFERENT trade moved a player this offer names, so this offer can no longer be honored.
   *  TERMINAL, set by `acceptTrade`'s supersede sweep, and distinct from `rejected` because
   *  nobody rejected it and the copy a manager reads has to say so. */
  "superseded",
] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

export const TERMINAL_STATUSES: Readonly<Record<TradeStatus, boolean>> = {
  open: false, accepted: true, rejected: true, withdrawn: true, expired: true, superseded: true,
};

export type TradeTransition = "accept" | "reject" | "withdraw" | "expire" | "supersede";

/** Which status each transition produces. Exhaustive: a new transition without a target will
 *  not compile. */
const TARGET_OF: Readonly<Record<TradeTransition, TradeStatus>> = {
  accept: "accepted", reject: "rejected", withdraw: "withdrawn", expire: "expired", supersede: "superseded",
};

/**
 * Every transition is legal from `open` and from nowhere else. Stated as a function rather than
 * left implicit because the guard that actually enforces it is in SQL (`WHERE status = 'open'`),
 * and a rule enforced only in SQL is a rule no test can read.
 */
export function transitionIsLegal(from: TradeStatus): boolean {
  return !TERMINAL_STATUSES[from];
}

export function nextStatusFor(transition: TradeTransition): TradeStatus {
  return TARGET_OF[transition];
}
```

```ts
it("lets nothing out of a terminal status, including back to open", () => {
  for (const status of TRADE_STATUSES) {
    expect(transitionIsLegal(status)).toBe(status === "open");
  }
});

it("gives every transition a target, so a new one cannot silently do nothing", () => {
  const targets = (["accept", "reject", "withdraw", "expire", "supersede"] as const).map(nextStatusFor);
  expect(new Set(targets).size).toBe(targets.length);
  expect(targets.every((target) => TERMINAL_STATUSES[target])).toBe(true);
});
```

- [ ] **Step 5: Close the two contract tests around the new directory**

`src/ai-advisor/advisory-only.test.ts`'s `WRITE_PATTERNS` gains three names, in the same commit that gives the advisor a trade worth writing:

```ts
// Phase 3 Plan C: a trade EXISTS now. The advisor assembles both sides of one and returns a
// verdict about it, which is exactly one import away from executing it, and this list is what
// keeps that import from compiling unnoticed. `setLineup`, `commitDraft` and `acceptInvite`
// were added for the same reason when each of those became reachable.
"acceptTrade", "executeTrade", "applyTradeInTx",
```

`src/integrity/flag-only.test.ts`'s `INTEGRITY_DIRS` (line 33) gains `"src/trades"`. The detector's arithmetic now lives there, and a directory that computes suspicion is a directory that must be provably unable to act on it — the same reason `src/integrity` itself is on the list despite being pure. The non-vacuity floor rises with it:

```ts
const INTEGRITY_DIRS = ["src/integrity", "src/integrity-service", "src/trades"];
...
expect(sourceFiles(INTEGRITY_DIRS).length).toBeGreaterThan(15);
```

`eslint.config.mjs`'s client-boundary **exempt** list gains `@/trades`, beside `@/chat`, `@/matchmaking`, `@/identity`, `@/help`, `@/reviews` and `@/moderation`. It has to: `TradeProposalView` and `TRADE_CONFIG.maxAssetsPerSide` are read by `src/league-room/components/trade-composer.tsx` as values, and `@/ai-advisor` — where those names used to live — is blocked precisely because it is not browser-safe.

`src/domain/trade.ts`'s opening docblock is corrected rather than deleted. It has said *"Nothing in this phase executes one"* since Phase 1 and that is no longer true; leaving it is how a reader concludes the trade path does not exist.

- [ ] **Step 6: Commit**

```bash
git add src/trades src/ai-advisor src/integrity src/domain eslint.config.mjs
git commit -m "feat(trades): one home for the fairness core, and four thresholds on one axis

tradeBalance has spent two phases in src/ai-advisor: a directory with no coverage gate, on the
client-boundary blocked list, whose own contract test exists to prove nothing in it writes. That
is a strange home for the one piece of arithmetic this phase's integrity story rests on, and
ADVISOR_CONFIG already moved out for the first of those reasons and said so in its docblock.
This is the rest of that move: src/trades is pure, browser-safe and gated, valuation.ts
re-exports every name so no consumer's diff is non-zero, and a test asserts the two are one
function object rather than two that agree today.

The threshold ordering is the other half. evenDelta (3) and lopsidedDelta (12) were two numbers
on a points-per-week axis; this adds a third and Plan D adds a fourth, and the spec only asks
for an invariant between two of them. One test orders all four and says what each inversion
would actually do.

advisory-only.test.ts gains acceptTrade/executeTrade/applyTradeInTx in the same commit that
gives the advisor a trade to be tempted by. flag-only.test.ts gains src/trades, because a
directory that computes suspicion must be provably unable to act on it."
```

---

## Task 2: `trade_proposals` — one row per offer, and a status that only moves one way

The negotiation needs a record before it needs anything else, and the shape of that record decides four later arguments: whether two identical offers are one question or two, whether a stale offer is answerable, whether the queue can point at a trade, and whether a reversal erases an acceptance or stamps it. All four are settled here.

The row follows the discipline this codebase has now chosen three times — `reviews.removed_at`, `stat_weeks.version`, `integrity_flags.resolved_at`: the state change is a guarded stamp in the `UPDATE`'s own `WHERE`, never a read-then-write, so two managers clicking at the same instant serialize on the row lock and the loser matches zero rows and is told which decision already stands.

**Files:**
- Create: `drizzle/0027_trade_proposals.sql`
- Modify: `src/db/schema.ts`, `src/db/test-db.ts`, `src/db/index-plans.test.ts`
- Create: `src/league-service/trades.ts` (the row mappers and `tradesQuery` only — the services land in Tasks 3 and 5), `src/league-service/trades.test.ts`

**Interfaces:**
- Consumes: `TRADE_STATUSES`, `TradeAsset`, `TRADE_CONFIG`, `DbTx`.
- Produces: `tradeProposals` (Drizzle table), `TradeProposal` (the row type), `toTradeProposal`, `proposalFingerprint`, `tradesQuery`, `isExpired`.

- [ ] **Step 1: Write the failing table tests first**

```ts
describe("trade_proposals", () => {
  it("allows two DIFFERENT open offers between the same two teams", async () => {
    // A manager shopping two packages to one leaguemate is negotiation, not spam. The cap on
    // that is a count (TRADE_CONFIG.maxOpenProposalsPerTeam), not a uniqueness constraint.
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_1", from: ["p_rb1"], to: ["p_wr1"] });
    await insertProposal(db, { id: "tr_2", from: ["p_rb1"], to: ["p_te1"] });
    expect(await openProposalCount(db, "team_a")).toBe(2);
  });

  it("refuses a second open offer with the identical package, on the fingerprint index", async () => {
    // Sending the same offer twice is not a second question. The partial unique index is the
    // same shape integrity_flags_open_subject_idx uses and for the same reason.
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_1", from: ["p_rb1"], to: ["p_wr1"] });
    await expect(insertProposal(db, { id: "tr_2", from: ["p_rb1"], to: ["p_wr1"] })).rejects.toThrow(/trade_proposals_open_fingerprint_idx/);
  });

  it("allows the identical package again once the first one is settled", async () => {
    // Partial on status = 'open'. A package declined in week 3 and re-offered in week 8 is a
    // new question, and an index that blocked it would make a rejection permanent.
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_1", from: ["p_rb1"], to: ["p_wr1"] });
    await db.update(tradeProposals).set({ status: "rejected", settledAt: new Date() }).where(eq(tradeProposals.id, "tr_1"));
    await expect(insertProposal(db, { id: "tr_2", from: ["p_rb1"], to: ["p_wr1"] })).resolves.toBeDefined();
  });

  it("keeps an accepted trade accepted after a reversal, and stamps the reversal beside it", async () => {
    // The acceptance HAPPENED. A `reversed` status would make this row disagree with the
    // trade_accepted event on the league chain, and the chain is the one that cannot be edited.
    await seedTradeableLeague(db);
    await insertProposal(db, { id: "tr_1", status: "accepted" });
    await db.update(tradeProposals).set({ reversedAt: new Date(), reversedByFlagId: "fl_1" }).where(eq(tradeProposals.id, "tr_1"));
    const [row] = await db.select().from(tradeProposals);
    expect(row!.status).toBe("accepted");
    expect(row!.reversedAt).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run them, watch them fail, then write the table**

```ts
/**
 * One row per offer. The FIRST record in this product of two managers negotiating, and the
 * first thing `roster_slots` has ever moved for other than a draft.
 *
 * `status` is a guarded one-way stamp, not a field a caller sets after reading it: every
 * transition is an `UPDATE … WHERE id = $1 AND status = 'open'` and the branch that acts is
 * chosen from `RETURNING`, which is the same discipline `reviews.removed_at`,
 * `integrity_flags.resolved_at` and `toggleReaction` all use, and the reason two managers
 * clicking at the same instant produce one decision rather than two.
 *
 * `reversed_at` is deliberately NOT a status. An operator undoing a trade does not un-happen the
 * acceptance: `trade_accepted` is on the league chain and nothing may edit it, so a status that
 * erased the acceptance would make this row and the chain disagree about the same afternoon.
 *
 * Assets are `jsonb` rather than a `trade_assets` child table. The set is bounded at
 * `TRADE_CONFIG.maxAssetsPerSide` (5) per side, it is never queried by member (`assetPlayerIds`
 * is applied in TypeScript over a bounded list), and it is a DISCRIMINATED UNION Phase 9 adds an
 * arm to, which a normalized child table would model as a nullable column per arm. Derive over a
 * bounded set — `docs/decisions/data-layer-hardening.md`, read the way it applies to shape rather
 * than to totals.
 */
export const tradeProposals = pgTable(
  "trade_proposals",
  {
    id: text("id").primaryKey(),
    leagueId: text("league_id").notNull().references(() => leagues.id, { onDelete: "cascade" }),
    proposerTeamId: text("proposer_team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    counterpartyTeamId: text("counterparty_team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    /** The week the proposal was VALUED at. Kept so a re-read months later can explain the
     *  verdict a manager saw, the same "what was true when it was raised" discipline
     *  `integrity_flags.evidence` follows. */
    weekNumber: integer("week_number").notNull(),
    proposerAssets: jsonb("proposer_assets").$type<readonly TradeAsset[]>().notNull(),
    counterpartyAssets: jsonb("counterparty_assets").$type<readonly TradeAsset[]>().notNull(),
    /** sha256 over the league, the ordered team pair and both sorted asset lists. The index below
     *  is what makes "the same offer, twice" one question. */
    fingerprint: text("fingerprint").notNull(),
    note: text("note"),
    status: text("status").notNull(),
    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
    settledByUserId: text("settled_by_user_id").references(() => users.id),
    reversedAt: timestamp("reversed_at", { withTimezone: true }),
    /** The `integrity_flags.id` whose resolution ordered the reversal. No foreign key, matching
     *  `member_notices.audit_event_id`'s own reasoning: this column is provenance, and a FK here
     *  would take a lock on `integrity_flags` inside a transaction that already holds a chain
     *  anchor. */
    reversedByFlagId: text("reversed_by_flag_id"),
  },
  (t) => [
    /** The same offer twice is one question; a different package to the same manager is two.
     *  Partial on open, so a settled package may be offered again. */
    uniqueIndex("trade_proposals_open_fingerprint_idx").on(t.fingerprint).where(sql`${t.status} = 'open'`),
    /** The inbox read: "what has been offered to my team", newest first. Partial on open,
     *  because the inbox is a to-do list and a settled offer is history. */
    index("trade_proposals_inbox_idx").on(t.counterpartyTeamId, t.proposedAt).where(sql`${t.status} = 'open'`),
    /** The outbox read, and the open-cap count. Same shape, other side. */
    index("trade_proposals_outbox_idx").on(t.proposerTeamId, t.proposedAt).where(sql`${t.status} = 'open'`),
    /** The league's trade history, and the supersede sweep's scan. NOT partial: history is the
     *  settled rows. */
    index("trade_proposals_league_idx").on(t.leagueId, t.proposedAt),
  ],
);
```

`src/db/test-db.ts`'s `truncateAll` list is hand-maintained and gains `trade_proposals`, before `teams` in dependency order. Forgetting it does not fail loudly; it bleeds rows between test files, and `fileParallelism: false` makes that bleed deterministic and therefore easy to mistake for a real result.

- [ ] **Step 3: The fingerprint, and why it is canonical**

```ts
/**
 * The identity of an OFFER, not of a row. Two proposals with the same league, the same ordered
 * team pair and the same two asset sets are the same offer however the arrays were ordered on
 * the way in, so the ids are sorted before hashing. Reuses `canonicalSerialize`
 * (`@/integrity/canonical`) rather than `JSON.stringify` for exactly the reason the audit chain
 * does: key order is not part of the meaning, and a rejecting encoder refuses the values that
 * would not survive a round trip.
 */
export function proposalFingerprint(input: {
  readonly leagueId: string;
  readonly proposerTeamId: string;
  readonly counterpartyTeamId: string;
  readonly proposerAssets: readonly TradeAsset[];
  readonly counterpartyAssets: readonly TradeAsset[];
}): string {
  const canonical = canonicalSerialize({
    leagueId: input.leagueId,
    proposerTeamId: input.proposerTeamId,
    counterpartyTeamId: input.counterpartyTeamId,
    proposerAssets: [...assetPlayerIds(input.proposerAssets)].sort(),
    counterpartyAssets: [...assetPlayerIds(input.counterpartyAssets)].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
```

```ts
it("hashes the same offer to the same value however the sides were ordered on the way in", () => {
  const a = proposalFingerprint({ ...BASE, proposerAssets: [player("p1"), player("p2")] });
  const b = proposalFingerprint({ ...BASE, proposerAssets: [player("p2"), player("p1")] });
  expect(a).toBe(b);
});

it("hashes the MIRROR offer differently, because who is asking is part of the offer", () => {
  // A offering X for Y and B offering Y for X are two different questions with two different
  // people waiting. Sorting the team pair would have merged them.
  const forward = proposalFingerprint(BASE);
  const mirror = proposalFingerprint({ ...BASE, proposerTeamId: BASE.counterpartyTeamId, counterpartyTeamId: BASE.proposerTeamId,
    proposerAssets: BASE.counterpartyAssets, counterpartyAssets: BASE.proposerAssets });
  expect(mirror).not.toBe(forward);
});
```

- [ ] **Step 4: `tradesQuery`, `isExpired`, and the plan assertion measured over a real corpus**

`tradesQuery(db, input)` is exported for inspection, mirroring `feedQuery`, `browseQuery` and `pendingFlagQuery`. `isExpired(row, now)` is pure and is the lazy half of expiry: a row whose `expires_at` has passed reads as `expired` and is refused on accept, without a scheduler ever having touched it.

`src/db/index-plans.test.ts` gains three EXPLAIN assertions, and the corpus that backs them is the carried item from Plan B's final review made mechanical (ruling 24). Plan B's own gate tests were found to have measured queries production never makes, over a corpus with 2% of the per-league density a real league has. So the assertion here builds the corpus from the shape a real league actually produces — twelve teams, a season of weeks, and open proposals at the per-team cap for a fraction of them — and it EXPLAINs **`tradesQuery` itself**, imported, rather than a hand-written SQL string that resembles it:

```ts
it("serves the inbox from the partial index, over a corpus with real per-league density", async () => {
  await seedTradeCorpus(db, { leagues: 200, teamsPerLeague: 12, settledPerTeam: 8, openPerTeam: 3 });
  await db.execute(sql`VACUUM ANALYZE trade_proposals`);
  const plan = await explain(db, tradesQuery(db, { leagueId: CORPUS_LEAGUE, teamId: CORPUS_TEAM, box: "inbox" }));
  expect(indexScanNode(plan, "trade_proposals_inbox_idx")).toBeDefined();
});

it("reddens on a sequential scan if the partial predicate is ever dropped", async () => {
  // The mutation proof. A migration that recreated this index without `WHERE status = 'open'`
  // would still be an index and would still be chosen for some shapes; the assertion above only
  // means something because this one fails when the predicate goes.
  await db.execute(sql`DROP INDEX trade_proposals_inbox_idx`);
  await db.execute(sql`CREATE INDEX trade_proposals_inbox_idx ON trade_proposals (counterparty_team_id, proposed_at)`);
  const plan = await explain(db, tradesQuery(db, { leagueId: CORPUS_LEAGUE, teamId: CORPUS_TEAM, box: "inbox" }));
  expect(planCost(plan)).toBeGreaterThan(BASELINE_INBOX_COST);
});
```

- [ ] **Step 5: Commit**

---

## Task 3: Propose, withdraw, reject — the negotiation half, and the visibility decision that keeps it private

Three of the four transitions are the negotiation, and none of them moves a roster. They are worth their own task because they are where the plan decides something the spec never asks about: **who else finds out**. `ACTIVITY_VISIBILITY` carries four entries that say `// Plan C` and nothing else, and this is the plan that has to fill them in.

The answer for the three below is `"hidden"` (ruling 12). A trade offer is a private negotiation between two managers, and a league feed that announced *"Alice offered Bob her running back"* would broadcast a bid before either party had agreed to anything — a competitive leak of exactly the kind that made `lineup_change` `actor_only` in Plan A. What the league is entitled to know is what actually happened, and that is Task 5's event.

**Files:**
- Modify: `src/league-service/trades.ts` (+ its test)
- Create: `src/league-service/trade-schemas.ts` (+ its test)
- Create: `src/app/api/leagues/[leagueId]/trades/route.ts`, `src/app/api/leagues/[leagueId]/trades/[tradeId]/route.ts`, `src/app/api/leagues/[leagueId]/trades/_shared.ts` (+ its test)
- Modify: `src/integrity/activity-view.ts` (+ its test), `src/integrity/notices.ts` (+ its test), `src/integrity/test-support.ts`, `src/integrity-service/notify.ts` (`quoteFor`), `src/integrity-service/reserved.test.ts`, `src/integrity-service/lock-order.test.ts`
- Modify: `src/league-room/contract.ts`

**Interfaces:**
- Consumes: `withLeagueMemberActor`, `requireLeagueMember`, `raiseFlag`'s sibling `AuditLogger`, `notifyAffectedMember`, `attachAuditEvent`, `deliverNotice`, `TRADE_CONFIG`, `tradeBalance`, `assembleAdvisorContext`.
- Produces: `proposeTrade`, `withdrawTrade`, `rejectTrade`, `listTrades`, `NoticeContexts.trade_proposed` / `.trade_withdrawn` / `.trade_rejected`, `proposeTradeSchema`, `tradeDecisionSchema`.

- [ ] **Step 1: Write the failing service tests**

```ts
it("resolves the proposing team from the session and refuses a body that names another one", async () => {
  // The rule the draft engine has honored since Phase 1, and the one a trade is most tempting to
  // break: a trade names two teams and only one of them is yours. `proposeTrade` takes a userId
  // and derives proposerTeamId; there is no input field to spoof.
  const input = await proposeInput(db, { as: "u_alice" });
  expect(Object.keys(input)).not.toContain("proposerTeamId");
  const result = await proposeTrade(db, input);
  expect(result).toMatchObject({ ok: true });
  const [row] = await db.select().from(tradeProposals);
  expect(row!.proposerTeamId).toBe(await teamIdOf(db, "u_alice"));
});

it("refuses an offer naming a player the proposer does not own", async () => {
  const result = await proposeTrade(db, await proposeInput(db, { give: ["p_not_mine"] }));
  expect(result).toEqual({ ok: false, status: 422, reason: "One of those players isn't on your team." });
});

it("refuses an offer naming a player the counterparty does not own", async () => {
  const result = await proposeTrade(db, await proposeInput(db, { receive: ["p_not_theirs"] }));
  expect(result).toEqual({ ok: false, status: 422, reason: "One of those players isn't on that team." });
});

it("refuses a team trading with itself, in the service and not only in the schema", async () => {
  // `isBalancedProposal` already answers this and has since Phase 1. The service asks it rather
  // than restating it, and it asks even though the schema also refuses, because the service is
  // the real boundary — the same discipline `removeReview` and `resolveFlag` both keep.
  const result = await proposeTrade(db, await proposeInput(db, { counterparty: "self" }));
  expect(result).toEqual({ ok: false, status: 422, reason: "You can't trade with your own team." });
});

it("refuses an eleventh open offer and says what to do about it", async () => {
  await tenOpenOffers(db, { from: "team_a" });
  const result = await proposeTrade(db, await proposeInput(db, { as: "u_alice" }));
  expect(result).toEqual({ ok: false, status: 409, reason: `You have ${TRADE_CONFIG.maxOpenProposalsPerTeam} offers out already. Withdraw one before you send another.` });
});

it("refuses an offer that would leave the receiving roster illegal, before anybody has to answer it", async () => {
  // Two quarterbacks into a one-QB league with a full bench has no legal home, and finding that
  // out at ACCEPT time would mean a manager agreeing to something the product then refuses. The
  // same check runs again inside the accept transaction (Task 5), because rosters move in
  // between; running it here is about not wasting somebody's yes.
  const result = await proposeTrade(db, await proposeInput(db, { give: ["p_qb1", "p_qb2"], receive: ["p_wr1"] }));
  expect(result).toMatchObject({ ok: false, status: 422, reason: expect.stringContaining("no room") });
});

it("tells the counterparty, and tells nobody else", async () => {
  await proposeTrade(db, await proposeInput(db, { as: "u_alice" }));
  const [notice] = await noticesFor(db, "u_bob");
  expect(notice!.noticeType).toBe("trade_proposed");
  expect(await noticesFor(db, "u_alice")).toEqual([]);
  expect(await noticesFor(db, "u_carol")).toEqual([]);
  expect(copyViolations(`${notice!.title} ${notice!.body}`)).toEqual([]);
});

it("writes trade_proposed on the LEAGUE chain, where a trade belongs", async () => {
  // ruling 1, and the sentence operators-and-moderation.md §5 wrote: a record about a person
  // under review is not the league's business; a record about league content is. A trade is
  // league content. The chain scope is the league even though the VISIBILITY is hidden, and the
  // two are independent on purpose.
  await proposeTrade(db, await proposeInput(db));
  expect(await auditEventsOn(db, "lg_1", "trade_proposed")).toHaveLength(1);
  expect(await auditEventsOn(db, "platform", "trade_proposed")).toHaveLength(0);
});
```

and the two decisions, each with its own no-double-decision proof:

```ts
it("lets only the counterparty reject, and only the proposer withdraw", async () => {
  const trade = await openTrade(db, { proposer: "u_alice", counterparty: "u_bob" });
  expect(await rejectTrade(db, { tradeId: trade.id, userId: "u_alice", ... })).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
  expect(await withdrawTrade(db, { tradeId: trade.id, userId: "u_bob", ... })).toEqual({ ok: false, status: 404, reason: "We couldn't find that offer." });
});

it("answers 404 rather than 403 to the wrong manager, so an id tells a prober nothing", async () => {
  // The codebase's non-oracle discipline, third time: publicJoinPrecondition, withAdmin, here.
  const trade = await openTrade(db, { proposer: "u_alice", counterparty: "u_bob" });
  const result = await rejectTrade(db, { tradeId: trade.id, userId: "u_carol", ... });
  expect(result.status).toBe(404);
});

it("serializes a reject and a withdraw arriving at the same instant, and exactly one lands", async () => {
  // The guard is in the UPDATE's own WHERE. A prior read would let both through.
  const trade = await openTrade(db);
  const [a, b] = await Promise.all([
    rejectTrade(db, { tradeId: trade.id, userId: "u_bob", ... }),
    withdrawTrade(db, { tradeId: trade.id, userId: "u_alice", ... }),
  ]);
  expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  expect(await auditEventsOn(db, "lg_1", "trade_rejected")).toHaveLength(a.ok ? 1 : 0);
});

it("refuses to answer an offer that has aged out, and says so in the offer's own words", async () => {
  const trade = await openTrade(db, { proposedAt: "2026-08-01T00:00:00.000Z" });
  const result = await rejectTrade(db, { tradeId: trade.id, userId: "u_bob", clock: fixedClock("2026-08-21T00:00:00.000Z") });
  expect(result).toEqual({ ok: false, status: 409, reason: "That offer expired before anyone answered it." });
});
```

- [ ] **Step 2: Run them, watch them fail, then write the three services**

All three share one transaction shape and one lock order, and the order is Plan A's global one with no local variation:

```ts
/**
 * LOCK ORDER (ruling 3). Business rows first: the proposal row itself, taken `FOR UPDATE`
 * through the guarded UPDATE's own row lock, which also takes `FOR KEY SHARE` on `leagues` and
 * both `teams` rows through its foreign keys. Then the notice, which takes `FOR KEY SHARE` on
 * `users` and `leagues`. Then the anchor. Then `attachAuditEvent`. Then commit, then
 * `deliverNotice` outside the transaction entirely.
 *
 * Nothing here touches `stat_weeks`: a proposal moves no roster, so it has no interaction with
 * the week lock at all. `acceptTrade` (Task 5) is where that begins, and it is why that one
 * takes `stat_weeks FOR SHARE` FIRST, ahead of this row, matching `setLineup`.
 */
```

`rejectTrade` and `withdrawTrade` are one implementation with two actor tests, because they differ only in which column must equal the caller's team and which notice is sent:

```ts
async function settleProposal(db: Db, input: SettleProposalInput): Promise<SettleTradeResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(tradeProposals)
      .set({ status: nextStatusFor(input.transition), settledAt: new Date(input.occurredAt), settledByUserId: input.userId })
      .where(and(
        eq(tradeProposals.id, input.tradeId),
        eq(tradeProposals.status, "open"),
        gt(tradeProposals.expiresAt, new Date(input.occurredAt)),
        eq(input.transition === "withdraw" ? tradeProposals.proposerTeamId : tradeProposals.counterpartyTeamId, input.actorTeamId),
      ))
      .returning();
    if (row === undefined) return refusalFor(tx, input);   // 404, 409-already-settled or 409-expired, told apart by a read

    const notice = await notifyAffectedMember(tx, {
      leagueId: row.leagueId,
      userId: input.transition === "withdraw" ? await ownerOf(tx, row.counterpartyTeamId) : await ownerOf(tx, row.proposerTeamId),
      noticeType: input.transition === "withdraw" ? "trade_withdrawn" : "trade_rejected",
      context: await noticeContextFor(tx, row),
      occurredAt: input.occurredAt,
      auditEventId: null,
    });
    const event = await input.audit.record(tx, {
      eventType: "trade_rejected",
      actorId: input.userId,
      actorType: "user",
      leagueId: row.leagueId,          // LEAGUE chain — ruling 1
      payload: { tradeId: row.id, outcome: row.status, proposerTeamId: row.proposerTeamId, counterpartyTeamId: row.counterpartyTeamId },
      occurredAt: input.occurredAt,
    });
    await attachAuditEvent(tx, notice, event.eventId);
    return { ok: true, tradeId: row.id, status: row.status as TradeStatus };
  });
}
```

One event type covers both outcomes, with the outcome in the payload. `AUDIT_EVENT_TYPES` is frozen — Plan A's docblock says *"no later migration ever runs `ALTER TYPE … ADD VALUE`"* — so a `trade_withdrawn` type does not exist and cannot be added. `trade_rejected` with `payload.outcome` is the honest spelling, and the renderer reads it (ruling 21).

- [ ] **Step 3: The four visibility decisions, and the renderers that make three of them moot**

`src/integrity/activity-view.ts`:

```ts
  /**
   * A proposal is a private negotiation between two managers. A feed announcing "Alice offered
   * Bob her running back" would broadcast a bid before either party agreed to anything, which is
   * the same competitive leak that made `lineup_change` `actor_only` (ruling 15) — and worse,
   * because a bid discloses what a manager thinks his own players are worth. Both parties are
   * told directly, by notice. Nobody else is.
   */
  trade_proposed: "hidden",
  /** Same, and more so: a refusal is nobody's business but the two people in it. */
  trade_rejected: "hidden",
  /** The league's business by construction: it changes two rosters and therefore everyone's
   *  matchups. Rendered with both sides in full — a trade the league can see half of is a
   *  rumour. */
  trade_accepted: "everyone",
  /** The mechanical record of the transfer itself, which `trade_accepted` already describes for
   *  a trade. It is NOT redundant, because a REVERSAL (Plan C Task 7) writes a `roster_move`
   *  with no `trade_accepted` beside it, and that is the row that tells a league the trade it
   *  saw last week has been undone. `renderRosterMove` reads `payload.reason` and says which
   *  of the two it is. */
  roster_move: "everyone",
```

`renderTradeAccepted` and `renderRosterMove` join `renderPayload`'s switch. Both read only the payload keys they name, through the existing `str`/`num` narrowing helpers, so a payload field the renderer never asked for cannot reach a row — the allowlist-by-construction property Plan A's §7 describes. `activity-view.test.ts` gains the deny-by-default proof for both:

```ts
it("never renders a trade's private note, however the payload arrives", () => {
  // `note` is the proposer's own words to one person. It is not in the payload this plan writes,
  // and this asserts the renderer would ignore it even if a future author put it there.
  const event = tradeAcceptedEvent({ note: "don't tell the league I overpaid" });
  expect(activityRowFor(event, viewer, names)!.detail).not.toContain("overpaid");
});

it("renders nothing for a roster move whose reason it has never heard of", () => {
  expect(activityRowFor(rosterMoveEvent({ reason: "waiver_claim" }), viewer, names)).toBeNull();
});
```

That second one is the deny-by-default dimension applied to a payload field rather than a type, and it is the seam a future waivers phase opts into by name.

- [ ] **Step 4: Three notice templates, in the active voice because the denylist requires it**

`NoticeContexts` gains three keys, which the compiler then forces into `NOTICE_TEMPLATES` and `NOTICE_SAMPLES`:

```ts
trade_proposed: ({ leagueName, proposerTeamName, giveSummary, getSummary }) => ({
  title: `${proposerTeamName} sent you a trade offer`,
  body: `In ${leagueName}, ${proposerTeamName} offers you ${giveSummary} for ${getSummary}. Open the trade page to see both sides valued, then accept or decline. The offer stands for three days.`,
}),
trade_rejected: ({ leagueName, counterpartyTeamName }) => ({
  title: "Your trade offer got a no",
  body: `${counterpartyTeamName} declined the offer you sent in ${leagueName}. You can put together a different package any time.`,
}),
trade_withdrawn: ({ leagueName, proposerTeamName }) => ({
  title: "A trade offer came off the table",
  body: `${proposerTeamName} took back the offer they sent you in ${leagueName}. Nothing on your roster changed.`,
}),
```

Read the shipped rulebook before writing a word. `INTEGRITY_CONFIG.notices.passiveConstructions` bans `"was made"`, `"was removed"`, `"is kept"`, `"was kept"`, `"were made"` and `"were removed"`, and `accusatoryTerms` bans nine more — which is why every sentence above names who did the thing. `notices.test.ts` iterates `NOTICE_TEMPLATES`' keys, so these are swept against `copyViolations` the moment they land, and `NOTICE_SAMPLES` is an exhaustive mapped type so a missing sample fails `tsc` rather than skipping the sweep.

`quoteFor` (`src/integrity-service/notify.ts`) learns `trade_proposed` and returns `context.note` when the proposer wrote one, so a manager's own words render as the bounded blockquote the Plan A persona panel asked for rather than as a dense clause in the middle of a sentence. This is the second consumer of a branch Plan A shipped unreachable and Plan B first exercised.

- [ ] **Step 5: The routes**

`POST /api/leagues/[leagueId]/trades` and `POST /api/leagues/[leagueId]/trades/[tradeId]`, both in the fixed order every route in this codebase uses: `withLeagueMemberActor` → `actor.teamId === null` check (`NO_TEAM_MESSAGE`, 403) → `tradeRateLimited(actor.userId)` → `await params` → `parseJson(request, schema)` → service → `fail`/`ok`. `GET` on the collection returns `TradesPageBody`.

`tradeDecisionSchema` is a discriminated union on `action`, so one route handles three transitions with no string comparison in the handler:

```ts
export const tradeDecisionSchema = z.object({
  action: z.enum(["accept", "reject", "withdraw"]),
});
```

The route is written once, here, with its `accept` branch calling the `acceptTrade` Task 5 creates. That branch does not compile until Task 5 lands, which is deliberate and is the same discipline `reserved.test.ts` uses on audit types: a named consumer that fails loudly for two commits beats a stub that works and then gets forgotten. Tasks 4 and 5 both land before this plan merges, so no release ever contains the red branch.

- [ ] **Step 6: Move two reserved entries and extend the lock-order proof**

`src/integrity-service/reserved.test.ts` holds an exhaustive `OWNER` record and greps production sources: `trade_proposed` and `trade_rejected` move from reserved to published in this commit, with the same comment shape Plan B used (*the value marks PUBLISHED, not "written by Plan A" specifically*). That test **fails until they do**. `trade_accepted` and `roster_move` stay reserved until Task 5.

`src/integrity-service/lock-order.test.ts` gains this plan's first transaction, driven on two connections through the existing `waitForBlockedBackend` rendezvous and the existing `seedLeagueWith` helper. The park is a real `joinLeagueInTx` holding `leagues[X] FOR UPDATE`; the writer is `rejectTrade`, whose notice insert reaches for `leagues[X] FOR KEY SHARE` and must therefore block on the park and not on the anchor.

- [ ] **Step 7: Commit**

---

## Task 4: The atomic transfer — and the settled week a trade must not be able to rewrite

This is the task the plan exists to get right. `commitDraftState` has been the only writer of `roster_slots` since Phase 1, it writes a whole draft's rosters at once, and nothing in this product has ever moved a player from one team to another. Three things have to be true when this task ends, and only one of them is obvious.

**One: no partial trade.** One transaction, both sides, all-or-nothing, and an assertion at the end that no player is on two rosters — because `roster_slots.player_id` carries no unique index and nothing at the database level would catch it.

**Two: no illegal roster.** The incoming players find legal slots through `assignSlot` (`src/draft-engine/slotting.ts`), the function that already decides where a drafted player lands. A second slot policy would be a second set of eligibility rules, and *"reuse those rules directly, do not reimplement them"* is in the spec twice.

**Three, and this is the one that is not obvious: no rewritten history.** `getLineup` returns saved `lineup_slots` rows *when they exist* and falls back to `roster_slots` when they do not — the deliberate rule that a manager who never opens the editor still fields a legal team. `finalizeWeek` scores through `getLineup`, and Plan B's `correctSettledWeek` re-scores a settled week through the same call weeks later. So a trade in week 9 would silently change what a manager is recorded as having started in weeks 1 through 8, for every team that never touched the editor, and nobody would find out until a stat correction re-settled an old week with a roster from the future. The fix is to **materialize** both teams' lineups for every locked week before touching a roster: write the rows the fallback would have derived, freezing the fact, and let the roster move afterwards.

**Files:**
- Create: `src/league-service/trade-transfer.ts`, `src/league-service/trade-transfer.test.ts`
- Modify: `src/league-service/test-support.ts` (a trade-shaped fixture), `src/db/index-plans.test.ts`

**Interfaces:**
- Consumes: `assignSlot` (`@/draft-engine`), `validateRosterAdd`, `defaultLineup`, `startersOf`, `getLineup`, `isLineupLocked`, `excludedSetFor`, `BENCH_SLOT`, `LEAGUE_CONFIG`, `DbTx`.
- Produces: `plannedTransfer(input): TransferPlan | TransferRefusal`, `materializeLockedLineupsInTx(tx, input): Promise<number>`, `applyTradeInTx(tx, input): Promise<TransferResult>`.

Task 5 and Task 7 are its two callers, in opposite directions.

- [ ] **Step 1: Write the failing history test FIRST, before anything can move a roster**

This one comes first on purpose. It is the failure nobody would have looked for, and writing it after the transfer works means writing it against an implementation that already decided the answer.

```ts
it("leaves a settled week scoring exactly what it scored before the trade", async () => {
  // THE test in this task. `getLineup` falls back to `roster_slots` for a team that never
  // opened the lineup editor, `finalizeWeek` scores through `getLineup`, and Plan B's
  // `correctSettledWeek` re-scores a settled week through the same call weeks later. Without
  // materialization a week 9 trade rewrites what a manager started in week 3.
  const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: false });
  const before = await scoreTeamsForWeek(db, league.id, 3);

  await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));

  const after = await scoreTeamsForWeek(db, league.id, 3);
  expect(after).toEqual(before);
});

it("writes the lineup rows the fallback would have derived, rather than freezing an empty week", async () => {
  const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: false });
  const expected = await getLineup(db, { teamId: league.teamA, weekNumber: 3, slotConfig: league.slotConfig });

  await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));

  const saved = await db.select().from(lineupSlots).where(and(eq(lineupSlots.teamId, league.teamA), eq(lineupSlots.weekNumber, 3)));
  expect(toRosterSlots(saved)).toEqual(expected);
});

it("leaves a week a manager DID save alone, because it was never at risk", async () => {
  // Materialization is a repair for the fallback, not a rewrite of a real save. A team with
  // saved rows is already immune, and re-deriving them would be the bug this test prevents.
  const league = await seasonThroughWeek(db, { week: 3, settled: true, lineupsSaved: true });
  const before = await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3));
  await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));
  expect(await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 3))).toEqual(before);
});

it("leaves an UNLOCKED week to the fallback, so a trade actually changes the team you field", async () => {
  // The other direction, and the reason this is materialization of LOCKED weeks rather than of
  // every week. A trade must change what you field going forward; freezing an open week would
  // make a traded-for player unstartable until the manager noticed and re-saved.
  const league = await seasonThroughWeek(db, { week: 3, settled: true, currentWeek: 4, lineupsSaved: false });
  await db.transaction((tx) => applyTradeInTx(tx, tradeOf(league, { give: ["p_star_rb"], get: ["p_bench_wr"] })));
  expect(await db.select().from(lineupSlots).where(eq(lineupSlots.weekNumber, 4))).toEqual([]);
  const week4 = await getLineup(db, { teamId: league.teamA, weekNumber: 4, slotConfig: league.slotConfig });
  expect(week4.some((slot) => slot.playerId === "p_bench_wr")).toBe(true);
});
```

- [ ] **Step 2: Run them, watch them fail, then write `materializeLockedLineupsInTx`**

```ts
/**
 * Freeze what each team ACTUALLY fielded in every week that has already locked, for any week
 * where they never saved a lineup and `getLineup` would fall back to the roster.
 *
 * WHY THIS EXISTS. `getLineup` (`@/league-service/lineups`) returns saved `lineup_slots` rows
 * when they exist and derives from `roster_slots` when they do not — a deliberate rule so a
 * manager who never opens the editor still fields a legal team. `finalizeWeek` scores through
 * `getLineup`, and `correctSettledWeek` (Plan B) re-scores a settled week through it weeks
 * later. Moving a player between rosters therefore changes what a manager is RECORDED as having
 * started in every already-played week they never saved, and the change surfaces only when
 * somebody re-settles an old week and gets a different answer.
 *
 * So: every trade materializes first and moves second. The rows written are exactly the rows
 * `getLineup` would have returned a moment earlier, which is what makes this a freeze rather
 * than a decision — nothing here chooses a lineup, it only writes down the one that was already
 * in effect.
 *
 * Bounded by construction: at most `LEAGUE_CONFIG.regularSeasonWeeks` weeks times two teams
 * times the league's slot count, one INSERT, and only for weeks with no saved rows at all.
 */
export async function materializeLockedLineupsInTx(tx: DbTx, input: MaterializeInput): Promise<number>;
```

Which weeks count as locked is read once, in one query, and it is the same rule `setLineup` uses: `isLineupLocked(status)` over the `stat_weeks` rows for this league's season, with an absent row reading `"scheduled"` (open). There is no second definition of "locked" in this codebase and this task does not add one (ruling 16).

- [ ] **Step 3: `plannedTransfer` — pure, refusable, and reusing the one slot policy**

Planning is separated from writing so the same refusal can be surfaced at propose time (Task 3, before a manager wastes a yes) and enforced at accept time (Task 5, because rosters move in between):

```ts
/**
 * Where every moving player lands, or why the trade cannot happen. PURE: it takes both rosters
 * and both asset lists and returns a plan or a refusal, with no database in it, so the propose
 * route can preview the same answer the accept transaction will enforce.
 *
 * BOTH SIDES ARE CLEARED BEFORE EITHER IS FILLED. A swap of two quarterbacks in a one-QB league
 * is legal and would be refused by any implementation that placed before it cleared — the
 * incoming QB has no home until the outgoing one leaves. Clearing first is also what makes the
 * plan order-independent: the answer does not depend on which side the caller passed first.
 *
 * Placement reuses `assignSlot` (`@/draft-engine/slotting`), which already composes
 * `eligibleSlotsForPosition` and `validateRosterAdd` and already prefers a starting slot over
 * FLEX over the bench. A second placement policy here would be a second set of eligibility
 * rules, and the spec says twice to reuse them rather than restate them.
 */
export function plannedTransfer(input: PlannedTransferInput): TransferPlan | TransferRefusal;
```

```ts
it("swaps two quarterbacks in a one-QB league, because it clears both sides before it fills either", () => {
  const plan = plannedTransfer({ ...ONE_QB_LEAGUE, give: [qb("p_qb_mine")], get: [qb("p_qb_theirs")] });
  expect(plan.ok).toBe(true);
  expect(slotOf(plan, "p_qb_theirs")).toEqual({ slot: "QB", slotIndex: 0 });
});

it("returns the same plan whichever side the caller passes first", () => {
  const forward = plannedTransfer({ ...LEAGUE, give: [rb("a")], get: [wr("b")] });
  const mirror = plannedTransfer({ ...MIRRORED_LEAGUE, give: [wr("b")], get: [rb("a")] });
  expect(normalize(forward)).toEqual(normalize(mirror));
});

it("refuses a package with no legal home and names the position, not the slot machinery", () => {
  const plan = plannedTransfer({ ...ONE_QB_LEAGUE_FULL_BENCH, give: [rb("a")], get: [qb("x"), qb("y")] });
  expect(plan).toEqual({ ok: false, reason: "There's no room on your roster for two quarterbacks. Send a player at that position, or free up a bench spot first." });
});

it("puts a player nobody can start on the bench rather than refusing the trade", () => {
  // assignSlot's own preference order, unchanged. A third running back is a bench player, not
  // an illegal trade, and a refusal here would make depth untradeable.
  const plan = plannedTransfer({ ...LEAGUE_WITH_FULL_RB, give: [wr("a")], get: [rb("x")] });
  expect(slotOf(plan, "x")!.slot).toBe("BENCH");
});
```

- [ ] **Step 4: `applyTradeInTx`, and the assertion that no player ends up on two teams**

```ts
/**
 * Move every asset, both directions, in the caller's transaction. The FIRST function in this
 * product to move a player between two teams, and the second ever to write `roster_slots` at
 * all (`commitDraftState` is the first, and it writes one draft's rosters at once rather than
 * moving anything).
 *
 * Takes a `DbTx`, never a `Db`: a trade that half-committed would leave a player on two rosters
 * or on none, and `roster_slots.player_id` carries no unique index and no foreign key, so
 * nothing in the database would notice. The post-write assertion below is the belt to that
 * missing brace.
 *
 * ORDER INSIDE THE TRANSACTION: materialize locked lineups, then clear both sides, then place
 * both sides, then assert. Materialization first because it must record the roster as it was;
 * clearing before placing because a same-position swap has no legal intermediate state.
 */
export async function applyTradeInTx(tx: DbTx, input: ApplyTradeInput): Promise<TransferResult>;
```

```ts
it("never leaves a player on two rosters, and says so out loud rather than trusting the schema", async () => {
  // `roster_slots` has PK (team_id, slot, slot_index), a nullable `player_id`, no FK and no
  // unique index on the player. A botched transfer is invisible to Postgres. This assertion
  // runs inside the transaction and rolls the whole trade back if it ever fires.
  await db.transaction((tx) => applyTradeInTx(tx, TRADE));
  const rows = await db.select().from(rosterSlots).innerJoin(teams, eq(teams.id, rosterSlots.teamId)).where(eq(teams.leagueId, "lg_1"));
  const owned = rows.map((row) => row.roster_slots.playerId).filter((id): id is string => id !== null);
  expect(new Set(owned).size).toBe(owned.length);
});

it("rolls back both sides when the second side cannot be placed", async () => {
  // A simulated mid-flight failure, which is the spec's own requirement. The give side has
  // already been written when the get side refuses.
  const before = await rosterSnapshot(db, "lg_1");
  await expect(db.transaction((tx) => applyTradeInTx(tx, IMPOSSIBLE_TRADE))).rejects.toThrow(TransferRefusedError);
  expect(await rosterSnapshot(db, "lg_1")).toEqual(before);
});

it("is the only function in this codebase that performs a trade roster swap", () => {
  // Grep, not import graph: the claim is that no second implementation exists, and a second one
  // would not import the first.
  const writers = grepSourceTree(/\.insert\(rosterSlots\)|\.update\(rosterSlots\)/, { dirs: ["src", "scripts"], exclude: /\.test\.tsx?$|test-support/ });
  expect(writers.sort()).toEqual(["src/data/seed/seed-season-league.ts", "src/draft-service/commit.ts", "src/league-service/trade-transfer.ts"]);
});
```

- [ ] **Step 5: Commit**

```bash
git add src/league-service src/db
git commit -m "feat(trades): the atomic transfer, and the settled week it must not rewrite

applyTradeInTx is the second writer of roster_slots this product has ever had and the first to
move a player between two teams. One transaction, both sides cleared before either is filled
(a same-position swap has no legal intermediate state), placement through assignSlot rather
than a second eligibility policy, and a no-player-on-two-rosters assertion inside the
transaction because roster_slots has no unique index on player_id and Postgres would not
notice.

The part that is not obvious: getLineup falls back to roster_slots for a team that never opened
the editor, finalizeWeek scores through getLineup, and correctSettledWeek re-scores a settled
week through it weeks later. A week 9 trade would therefore rewrite what a manager started in
week 3, surfacing only when somebody re-settled an old week and got a different answer. Every
trade now materializes both teams' locked-week lineups first, writing exactly the rows the
fallback would have derived, so the freeze records a fact rather than making a decision.
Unlocked weeks are deliberately left to the fallback: a trade has to change the team you field
going forward."
```

---

## Task 5: `acceptTrade` — one transaction, the week lock, the supersede sweep, and the seam Plan D needs

Acceptance is where every constraint in this plan meets. It moves rosters, so it interacts with the ingestion worker and the week lock. It invalidates other offers, so it settles rows nobody clicked. It is the moment the league is entitled to know something, so it writes the one trade event that is visible. And it is the moment Plan D has to be able to intercept, which means the seam has to be built now or Plan D reopens this transaction.

Founder decision #6's default binds and ships: **immediate execution on acceptance, no veto window, no commissioner approval step, no league vote.** That is the shape Steps 3 and 5 of the spec are already written against, and it is reversible in the only direction that matters — the hold seam below is where a veto window would be added, and adding one later changes a branch rather than a design (ruling 7).

**Files:**
- Modify: `src/league-service/trades.ts` (+ its test), `src/integrity/activity-view.ts` (+ its test), `src/integrity/notices.ts` (+ its test), `src/integrity/test-support.ts`
- Create: `src/integrity-service/trade-fairness.ts` (`evaluateTradeBeforeExecute` only — the flag write is Task 6), `src/integrity-service/trade-fairness.test.ts`
- Modify: `src/integrity-service/reserved.test.ts`, `src/integrity-service/lock-order.test.ts`, `src/league-service/score-cache-instance.ts` consumers

**Interfaces:**
- Consumes: `applyTradeInTx`, `plannedTransfer`, `materializeLockedLineupsInTx`, `isLineupLocked`, `tradeBalance`, `assembleAdvisorContext`, `valuePlayers`, `AuditLogger.recordAll`, `notifyAffectedMember`, `attachAuditEvent`, `ScoreCache.invalidate`.
- Produces: `acceptTrade(db, input): Promise<AcceptTradeResult>`, `evaluateTradeBeforeExecute(tx, input): Promise<TradeFairnessEvaluation>`, `NoticeContexts.trade_executed` / `.trade_superseded`.

- [ ] **Step 1: Write the failing accept tests**

```ts
it("moves both rosters, settles the row and tells both managers, in one transaction", async () => {
  const trade = await openTrade(db, { proposer: "u_alice", counterparty: "u_bob", give: ["p_rb1"], get: ["p_wr1"] });
  expect(await acceptTrade(db, { tradeId: trade.id, userId: "u_bob", ... })).toMatchObject({ ok: true });

  expect(await ownerTeamOf(db, "p_rb1")).toBe(await teamIdOf(db, "u_bob"));
  expect(await ownerTeamOf(db, "p_wr1")).toBe(await teamIdOf(db, "u_alice"));
  expect((await tradeRow(db, trade.id)).status).toBe("accepted");
  expect((await noticesFor(db, "u_alice"))[0]!.noticeType).toBe("trade_executed");
  expect((await noticesFor(db, "u_bob"))[0]!.noticeType).toBe("trade_executed");
});

it("lets only the counterparty accept", async () => {
  const trade = await openTrade(db, { proposer: "u_alice", counterparty: "u_bob" });
  expect(await acceptTrade(db, { tradeId: trade.id, userId: "u_alice", ... })).toMatchObject({ ok: false, status: 404 });
});

it("refuses when a named player left the roster since the offer was made", async () => {
  // The other half of "plan at propose time, enforce at accept time". Between the offer and the
  // yes, another trade may have moved the same player, and the guard is in this transaction's
  // own read rather than in a stale plan.
  const trade = await openTrade(db, { give: ["p_rb1"] });
  await anotherTradeMoves(db, "p_rb1");
  expect(await acceptTrade(db, { tradeId: trade.id, userId: "u_bob", ... }))
    .toEqual({ ok: false, status: 409, reason: "One of the players in this offer has already moved to another team. Ask for a fresh offer." });
});

it("settles every other open offer naming a player that just moved, and calls it superseded", async () => {
  // Not `rejected`: nobody rejected them. A manager whose offer dies because somebody else's
  // trade went through first is owed a sentence that says what actually happened.
  const dead = await openTrade(db, { proposer: "u_carol", counterparty: "u_alice", get: ["p_rb1"] });
  const live = await openTrade(db, { proposer: "u_carol", counterparty: "u_alice", get: ["p_te1"] });
  await acceptTrade(db, { tradeId: (await openTrade(db, { give: ["p_rb1"] })).id, userId: "u_bob", ... });

  expect((await tradeRow(db, dead.id)).status).toBe("superseded");
  expect((await tradeRow(db, live.id)).status).toBe("open");
  expect((await noticesFor(db, "u_carol"))[0]!.noticeType).toBe("trade_superseded");
});

it("refuses to move a roster while the week is locked, and says which week", async () => {
  // The same rule setLineup enforces, read the same way: a week is locked once it has STARTED,
  // not once it has been scored. A trade landing mid-week would change a roster whose lineups
  // are already in play and whose scores are being computed live.
  await lockWeek(db, 4);
  expect(await acceptTrade(db, { tradeId: (await openTrade(db)).id, userId: "u_bob", ... }))
    .toEqual({ ok: false, status: 409, reason: "Week 4 has started, so rosters can't change until it ends." });
});

it("takes FOR SHARE on the week before it validates, so a kickoff mid-transaction cannot slip through", async () => {
  // The read-validate-write hole setLineup already closed, in the transaction that moves more
  // than setLineup does. `persistTick` flips the week to in_progress inside its own
  // transaction with no coordination; this is the lock that makes the two agree.
  const parked = await parkPersistTick(db, { week: 4 });
  const accepting = acceptTrade(otherDb, { tradeId: trade.id, userId: "u_bob", ... });
  await waitForBlockedBackend();
  parked.release();
  expect(await accepting).toMatchObject({ ok: false, status: 409 });
});

it("writes trade_accepted AND roster_move on the same league chain, in one batch", async () => {
  // Plan A ruling 3: a transaction appends to at most one chain, and `recordAll` throws on a
  // batch that spans two. Both events are league-scoped, so one call carries both and the two
  // land at consecutive sequences with no second anchor lock.
  await acceptTrade(db, { tradeId: trade.id, userId: "u_bob", ... });
  const events = await auditEventsOn(db, "lg_1");
  expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["trade_accepted", "roster_move"]));
  expect(await auditEventsOn(db, "platform", "trade_accepted")).toHaveLength(0);
});

it("evicts the cached score for the current week after the transaction commits, never inside it", async () => {
  // setLineup's own discipline, and the same failure asymmetry: a slightly-late eviction costs
  // one stale read bounded by the key's TTL; an early one caches a roster the write never
  // landed.
  const cache = recordingCache();
  await acceptTrade(db, { tradeId: trade.id, userId: "u_bob", cache, ... });
  expect(cache.invalidatedAfterCommit).toEqual([{ leagueId: "lg_1", week: 4 }]);
});
```

- [ ] **Step 2: Run them, watch them fail, then write `acceptTrade`**

The transaction's order is Plan A's global one, with one addition at the front that matches `setLineup` exactly:

```ts
/**
 * LOCK ORDER (ruling 3, and ruling 17 of this plan). In order, and this order is not negotiable
 * because two of the three edges already exist elsewhere:
 *
 *   1. `stat_weeks[currentWeek] FOR SHARE`  — FIRST, matching `setLineup`, so the two roster-
 *      adjacent writers in this codebase take the same lock in the same position and cannot
 *      form a cycle with each other or with `persistTick`.
 *   2. `trade_proposals[id]` via the guarded UPDATE  — which also takes `FOR KEY SHARE` on
 *      `leagues` and both `teams` rows through its foreign keys.
 *   3. `roster_slots` / `lineup_slots` writes  — `FOR KEY SHARE` on `teams`.
 *   4. the supersede sweep's UPDATE  — same table, same class of lock, after the row that
 *      caused it.
 *   5. the notice inserts  — `FOR KEY SHARE` on `users` and `leagues`.
 *   6. `audit.recordAll` — the anchor, ALWAYS last.
 *   7. `attachAuditEvent` — the one statement permitted after the anchor, safe only because
 *      `member_notices.audit_event_id` carries no foreign key.
 *
 * Then commit. Then `deliverNotice` for each recipient, then the score-cache eviction, both
 * best-effort and both outside the transaction. Then, in a SEPARATE transaction,
 * `raiseTradeFairnessFlag` (Task 6) — because that one appends to the PLATFORM chain and this
 * one has already appended to the league's.
 */
export async function acceptTrade(db: Db, input: AcceptTradeInput): Promise<AcceptTradeResult>;
```

The supersede sweep is one statement, not a loop, and its `WHERE` is derived from the moved player ids:

```ts
// Every other OPEN offer in this league that names a player who just changed teams can no
// longer be honored. Settling them here, in the same transaction as the trade that killed
// them, is what stops a manager clicking accept on an offer the product will then refuse.
const doomed = await openProposalsNaming(tx, row.leagueId, movedPlayerIds, row.id);
const superseded = doomed.length === 0 ? [] : await tx
  .update(tradeProposals)
  .set({ status: "superseded", settledAt: new Date(input.occurredAt) })
  .where(and(
    eq(tradeProposals.status, "open"),
    inArray(tradeProposals.id, doomed.map((proposal) => proposal.id)),
  ))
  .returning({ id: tradeProposals.id, proposerTeamId: tradeProposals.proposerTeamId, counterpartyTeamId: tradeProposals.counterpartyTeamId });
```

`openProposalsNaming` is ONE bounded read over `trade_proposals_league_idx` that pulls this league's open rows and filters them in TypeScript with `assetPlayerIds` — the asset lists are `jsonb` and bounded at ten per row, so a `jsonb` containment predicate per moved player would buy nothing and cost an index this plan does not have. Its query count is asserted with `countingDb`: one read and at most one write, never a scan per moved player, inside what is already the most expensive transaction in the product. `status = 'open'` is repeated in the `UPDATE`'s own `WHERE` even though the read already filtered on it, because the read is a read and the guard has to be where the write is.

- [ ] **Step 3: The seam Plan D needs, built now and inert**

```ts
/**
 * The fairness verdict for a trade that is ABOUT to execute, computed inside the accept
 * transaction from the rosters as they stand a moment before they move.
 *
 * WHY INSIDE. Step 3 of the spec evaluates a trade that has already completed; Step 5 has to
 * intercept one before it does, and a trade that already executed cannot be "held". The
 * resolution is that the SCORE is computed here, where both rosters are already locked and read,
 * and the DECISION about what to do with it is a branch in this function's own result. Plan D
 * supplies a number for `INTEGRITY_CONFIG.trade.autoHoldThreshold`; it does not reopen this
 * transaction to add a code path.
 *
 * `autoHoldThreshold` is `null` on merge, so `hold` is false for every trade this plan executes.
 * The branch is still covered — `src/league-service` is gated at 100% — by a test that passes a
 * threshold rather than by a test that edits the config, which is the same "the sweep takes its
 * threshold as an argument for exactly this reason" shape Plan B's detector uses.
 *
 * FLAG-ONLY, and provably so: this function returns a verdict and writes nothing.
 * `src/integrity/flag-only.test.ts` covers the directory it lives in.
 */
export async function evaluateTradeBeforeExecute(tx: DbTx, input: EvaluateTradeInput): Promise<TradeFairnessEvaluation>;

export interface TradeFairnessEvaluation {
  readonly balance: TradeBalance;
  readonly gap: number;
  /** At or past `INTEGRITY_CONFIG.trade.fairnessFlagThreshold`. Task 6 acts on it AFTER commit. */
  readonly flagWorthy: boolean;
  /** At or past `INTEGRITY_CONFIG.trade.autoHoldThreshold`. Always false while that is `null`.
   *  PLAN D acts on it, inside this transaction, by not executing. */
  readonly hold: boolean;
}
```

```ts
it("never holds a trade while no hold threshold is configured, however lopsided it is", async () => {
  // The release-gate test for this plan, in the shape Plan B's ip-weight test established. If
  // this ever fails, somebody has given Plan D's threshold a value without Plan D's plan.
  expect(INTEGRITY_CONFIG.trade.autoHoldThreshold).toBeNull();
  const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, GROTESQUELY_LOPSIDED));
  expect(evaluation.gap).toBeGreaterThan(50);
  expect(evaluation.hold).toBe(false);
  expect(evaluation.flagWorthy).toBe(true);
});

it("holds when a threshold IS supplied, so Plan D inherits a proven branch and not an idea", async () => {
  const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...GROTESQUELY_LOPSIDED, autoHoldThreshold: 40 }));
  expect(evaluation.hold).toBe(true);
});

it("values a ghost player as a refusal rather than as zero points", async () => {
  // `valuePlayers` (`src/ai-advisor/context.ts:173`) silently DROPS an unknown id, and
  // `createTradeAnalyzer` catches that by comparing lengths. The detector has to make the same
  // check or it will confidently call a trade lopsided because one side vanished.
  await expect(db.transaction((tx) => evaluateTradeBeforeExecute(tx, TRADE_WITH_GHOST))).rejects.toThrow(/couldn't value/);
});
```

- [ ] **Step 4: `trade_accepted`'s visibility, its renderer, and two more notices**

`ACTIVITY_VISIBILITY.trade_accepted` becomes `"everyone"` and `roster_move` becomes `"everyone"`, with the reasoning written where Task 3 left the entries. `renderTradeAccepted` names both teams and both sides in full, because *a trade the league can see half of is a rumour*; `renderRosterMove` reads `payload.reason` and renders only for the two reasons this plan writes (`"trade"`, `"trade_reversed"`), returning `null` for anything else.

```ts
trade_executed: ({ leagueName, counterpartyTeamName, gaveSummary, gotSummary }) => ({
  title: "Your trade went through",
  body: `You and ${counterpartyTeamName} completed a trade in ${leagueName}. You sent ${gaveSummary} and you got ${gotSummary}. Your lineup for this week already reflects it, so check your starters before kickoff.`,
}),
trade_superseded: ({ leagueName, counterpartyTeamName }) => ({
  title: "One of your offers can no longer go through",
  body: `A player in the offer you had out to ${counterpartyTeamName} in ${leagueName} moved to another team, so that offer is off the table. Nobody declined it. You can put together a new one any time.`,
}),
```

`"Nobody declined it."` is not a flourish. A manager who sees an offer die assumes it was refused, and `INTEGRITY_CONFIG.notices.accusatoryTerms` exists because this product does not let a member draw a worse conclusion than the truth.

- [ ] **Step 5: Move the last two reserved entries, extend the lock-order proof, commit**

`trade_accepted` and `roster_move` move in `reserved.test.ts`, and with them every one of this plan's four types is published — the grep-based half of that test now proves each has a real, non-test publisher.

`lock-order.test.ts` gains the accept transaction, and this one is the plan's most valuable entry: it parks a real `persistTick` holding `stat_weeks[4]` and drives `acceptTrade` on a second connection, proving the trade blocks on the week rather than on the anchor, and it parks a real `joinLeagueInTx` holding `leagues[X] FOR UPDATE` and proves the notice inserts block there rather than after the append.

---

## Task 6: The detector — flag-only, after the commit, into the queue that has been waiting for it

Step 3's whole content is here, and almost all of it is already built: `tradeBalance` is the analyzer, `integrity_flags` is the store, `raiseFlag` is the writer, the queue reads it oldest-first, and `flag_raised` is already published. What this task adds is the subscriber, the threshold comparison, and one decision the spec does not anticipate.

**The decision is where the flag is written.** Plan A's ruling 3 is that a transaction appends to at most one chain, and `recordAll` throws on a batch that spans two. `trade_accepted` is league-scoped. `flag_raised` is platform-scoped (Plan B's ruling 1, because a record about a person under review is not the league's business). So the flag **cannot** be written inside the accept transaction, however much the spec's *"subscribes to `TRADE_ACCEPTED`"* phrasing suggests one flow. It is a second transaction, after the first commits, and the failure mode that creates is named and given an operator path rather than left implicit (ruling 22).

**Files:**
- Modify: `src/integrity-service/trade-fairness.ts` (+ its test), `src/league-service/trades.ts` (the after-commit call)
- Modify: `src/integrity/queue-view.ts` (+ its test), `src/integrity-service/flags.ts` (`subjectFor`/`aboutFor`/`trailFor`'s trade branches, + its test)
- Create: `scripts/sweep-trade-fairness.ts`; Modify: `package.json`

**Interfaces:**
- Consumes: `evaluateTradeBeforeExecute`'s result, `raiseFlag`, `crossesFairnessThreshold`, `INTEGRITY_CONFIG.trade`.
- Produces: `raiseTradeFairnessFlag(db, input)`, `sweepUnflaggedTrades(db, input)`, `FlagSubjectView`'s populated `trade` arm.

- [ ] **Step 1: Write the failing reuse-not-drift test first**

This is the spec's own exit criterion and it is the reason Step 3 exists at all:

```ts
it("gives the member-facing advisor and the automatic sweep the identical verdict, from one call", async () => {
  // Strategy §4.2's dual-use thesis, made a test rather than a promise: "the same model that
  // tells a member whether a trade is fair is the model that powers the platform's own
  // collusion detection." One function, two callers, and this asserts they agree on a real
  // trade read out of a real league rather than on a hand-built fixture.
  const league = await advisorFixture(db, "ppr");
  const proposal = { leagueId: league.id, weekNumber: 4, from: { teamId: league.teamA, playerIds: ["p_star_rb"] }, to: { teamId: league.teamB, playerIds: ["p_bench_wr"] } };

  const advisory = await createTradeAnalyzer({ enabled: false, llm: null })({ context: await assembleAdvisorContext(db, forTeamA), opponent: (await assembleAdvisorContext(db, forTeamB))!.me, proposal });
  const automatic = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...proposal, ...deps }));

  expect(automatic.balance.verdict).toBe(advisory!.verdict);
  expect(automatic.balance.flags).toEqual(advisory!.flags);
  expect(automatic.balance.givingValue).toBe(advisory!.givingValue);
  expect(automatic.balance.receivingValue).toBe(advisory!.receivingValue);
});

it("leaves the pre-accept advisory route completely untouched", () => {
  // The spec asks for this explicitly. `POST /api/leagues/[leagueId]/advisor/trade` gained no
  // import, no branch and no write from this phase.
  const source = read("src/app/api/leagues/[leagueId]/advisor/trade/route.ts");
  expect(source).not.toContain("@/integrity");
  expect(source).not.toContain("acceptTrade");
});
```

and the two sides of the threshold, which the spec also asks for by name:

```ts
it("raises exactly one flag with non-empty reasoning for a trade at or past the threshold", async () => {
  const { tradeId } = await acceptLopsidedTrade(db, { gap: 25 });
  const flags = await openFlags(db);
  expect(flags).toHaveLength(1);
  expect(flags[0]).toMatchObject({ flagType: "trade_fairness", subjectType: "trade", subjectId: tradeId, leagueId: "lg_1" });
  // The analyzer's own machine-readable reasons, stored VERBATIM. Not re-summarized, not
  // regenerated: the spec says reuse it, and a second rendering is a second opinion.
  expect(flags[0]!.evidence).toMatchObject({
    verdict: "lopsided",
    flags: ["value_gap_over_threshold"],
    givingValue: expect.any(Number),
    receivingValue: expect.any(Number),
    gap: 25,
    threshold: INTEGRITY_CONFIG.trade.fairnessFlagThreshold,
  });
});

it("raises no flag for a trade below it", async () => {
  await acceptLopsidedTrade(db, { gap: 4 });
  expect(await openFlags(db)).toEqual([]);
});

it("flips outcomes on a config change alone, with no code change", async () => {
  // The spec's exit criterion. The threshold is an argument for exactly this reason.
  expect(await flagWith(db, { fairnessFlagThreshold: 5 })).toHaveLength(1);
  expect(await flagWith(db, { fairnessFlagThreshold: 999 })).toHaveLength(0);
});

it("flags a lopsided trade and never touches either account", async () => {
  // The flag-only contract, asserted at the outcome as well as by the grep in flag-only.test.ts.
  await acceptLopsidedTrade(db, { gap: 25 });
  expect((await db.select().from(users).where(eq(users.id, "u_alice")))[0]!.isAdmin).toBe(false);
  expect((await tradeRow(db, tradeId)).status).toBe("accepted");   // the trade STANDS. A flag is a question.
});
```

- [ ] **Step 2: Run them, watch them fail, then write the raise and its honest failure mode**

```ts
/**
 * Raise a `trade_fairness` flag for a trade that has ALREADY executed.
 *
 * IT IS A SEPARATE TRANSACTION, AND THAT IS NOT A CONVENIENCE (ruling 22). `trade_accepted` is
 * league-scoped and `flag_raised` is platform-scoped (Plan B ruling 1: a record about a person
 * under review is not the league's business). Plan A's ruling 3 says a transaction appends to at
 * most one chain and `recordAll` throws on a batch that spans two, so writing this flag inside
 * the accept transaction is not a style choice that was rejected — it does not compile past the
 * first append and would deadlock past the second.
 *
 * THE CONSEQUENCE, STATED: a process that dies between the accept commit and this call leaves a
 * lopsided trade with no flag. The trade is correct and complete, the audit trail is complete,
 * and only the QUESTION is missing. So a failure here is logged, never surfaced to the manager
 * (who did nothing and can do nothing about it), and `npm run trades:sweep` re-raises every
 * accepted trade over the threshold that has no flag — the same asymmetry, and the same operator
 * remedy, that Plan B's after-commit multi-account sweep already carries (ruling 11 there).
 *
 * `raiseFlag`'s open-subject unique index makes the re-run idempotent by construction: a second
 * raise for the same trade returns the existing flag and writes no second event.
 */
export async function raiseTradeFairnessFlag(db: Db, input: RaiseTradeFairnessInput): Promise<IntegrityFlag | null>;
```

```ts
it("re-raises nothing for a trade already flagged, however many times the sweep runs", async () => {
  await acceptLopsidedTrade(db, { gap: 25 });
  await sweepUnflaggedTrades(db, {});
  await sweepUnflaggedTrades(db, {});
  expect(await openFlags(db)).toHaveLength(1);
  expect(await auditEventsOn(db, "platform", "flag_raised")).toHaveLength(1);
});

it("catches a trade whose after-commit flag write never landed", async () => {
  // The failure this sweep exists for, driven rather than described: accept with a throwing
  // flag writer, prove the trade is complete and unflagged, then prove one sweep fixes it.
  await acceptTrade(db, { ...INPUT, raiseFlag: throwingRaiser });
  expect((await tradeRow(db, tradeId)).status).toBe("accepted");
  expect(await openFlags(db)).toEqual([]);
  await sweepUnflaggedTrades(db, {});
  expect(await openFlags(db)).toHaveLength(1);
});

it("never fails a trade because the flag write failed", async () => {
  // The person who accepted did nothing wrong and can do nothing about it. Compare the audit
  // append, which DOES fail the write: a mutation nobody recorded is a hole in the record; a
  // question nobody asked is a question an operator script can ask later.
  const result = await acceptTrade(db, { ...INPUT, raiseFlag: throwingRaiser });
  expect(result).toMatchObject({ ok: true });
});
```

- [ ] **Step 3: Fill in the queue's two trade stubs**

Plan B left three placeholders and named this plan in each. `subjectFor` returns `{ kind: "trade", tradeId: subjectId }` with no lookup (`flags.ts:688`); `aboutFor` renders the literal `` `A trade (${row.subjectId})` `` (`flags.ts:611`); `trailFor` has no trade branch. All three are filled here, and `FlagSubjectView`'s trade arm grows the fields an operator actually needs:

```ts
| {
    readonly kind: "trade";
    readonly tradeId: string;
    readonly proposerTeamName: string;
    readonly counterpartyTeamName: string;
    readonly gave: readonly TradedPlayerView[];
    readonly got: readonly TradedPlayerView[];
    readonly acceptedAt: string;
    /** Non-null once an operator has already undone it. The detail page reads this to withhold
     *  `trade_reversed` from a trade that is already reversed, the same way `subjectIsRemoved`
     *  withholds `content_removed` from a message already gone (Plan B, MEDIUM 8). */
    readonly reversedAt: string | null;
  }
```

`TradedPlayerView` carries the player's name, position and the per-week value the detector used — the historical number, not a live one, because *the session data they were computed from will have moved on by the time an operator looks* is Plan B's ruling 5 and it applies identically to a player's form.

`trailFor`'s trade branch reads the league chain for that trade's `trade_proposed`, `trade_accepted` and `roster_move` events — the *"full propose → accept audit sequence for that trade"* the spec asks for by name — bounded by `INTEGRITY_CONFIG.queue.trailLimit`, and rendered through `flagTrailRowFor`'s own switch rather than through the member-facing renderer, because those rows are in the operator's voice.

```ts
it("shows an operator the whole propose-to-accept sequence for the flagged trade", async () => {
  const { flagId, tradeId } = await acceptLopsidedTrade(db, { gap: 25 });
  const detail = await flagDetail(db, flagId);
  expect(detail!.trail.map((row) => row.headline)).toEqual([
    "Alice offered this trade.",
    "Bob accepted it.",
    "Two players changed teams.",
  ]);
});

it("shows a member of that league nothing about the flag at all", async () => {
  // The allowlist proof, completed for the third flag type. Not "the scores are filtered out" —
  // `flag_raised` is on the platform chain and `listLeagueActivity` never reads it.
  const page = await listLeagueActivity(db, { leagueId: "lg_1", viewerUserId: "u_alice" });
  expect(JSON.stringify(page.rows)).not.toMatch(/fairness|lopsided|flag/i);
  // …while the trade itself IS there, because a trade is league news and a flag is not.
  expect(page.rows.some((row) => row.headline.includes("trade"))).toBe(true);
});
```

That second assertion is the sharpest statement of ruling 1 in the plan: the same afternoon produces one row the league reads and one row it cannot reach, and the difference is which chain each went on.

- [ ] **Step 4: The script**

`scripts/sweep-trade-fairness.ts` on `scripts/sweep-multi-account.ts`'s idiom: a typed `Args` (`--league`, optional; all leagues otherwise), the `--flag value` parser that rejects a missing value, a preflight that prints how many accepted trades are over the threshold with no flag, and the sweep. It prints the count last and always. It is **not** confirmed-destructive — it raises questions, it does not answer them — so it has no `confirm()` prompt, which is the honest difference from `remove-review.ts` and is stated in its docblock.

- [ ] **Step 5: Commit**

---

## Task 7: `trade_reversed` stops being a reserved word

Plan B declared a decision it could not carry out, named this plan as its owner, refused it at runtime in three places, and wrote down what would happen if this plan shipped without it: *"the honest move is renaming the owner to `plan-d` rather than deleting the entry."* This plan does not need that escape. It builds the trade, so it builds the reversal.

Two things have to be decided here that Plan B could not decide, because neither question exists until a trade does.

**What a reversal IS.** Not a delete and not a status change: a **compensating transfer**, forward-only, executed through the same `applyTradeInTx` in the opposite direction. The acceptance happened; `trade_accepted` is on the league chain and nothing may edit it. A reversal is a second roster movement that puts the players back, stamped on the original row as `reversed_at`, and it never touches a settled score. A week that has already been played was played with those rosters, and re-scoring it would be the platform editing a result two managers already saw (ruling 18).

**When a reversal is refused.** When the world has moved on: a traded player who has since been traded again is not on the roster a reversal would take him from, and taking him from wherever he is now would drag a third manager into a decision nobody asked them about. The refusal is explicit, in the operator's own view, before the click.

**Files:**
- Modify: `src/integrity/flags.ts` (+ its test), `src/integrity/queue-view.ts` (+ its test), `src/integrity/notices.ts` (+ its test), `src/integrity/test-support.ts`
- Modify: `src/integrity-service/flags.ts` (+ its test), `src/integrity-service/schemas.ts` (+ its test), `src/integrity-service/lock-order.test.ts`
- Create: `src/league-service/trade-reversal.ts` (+ its test)
- Modify: `src/app/app/admin/queue/[flagId]/page.tsx` (+ its test), `src/integrity/rendered-copy.test.tsx`

**Interfaces:**
- Consumes: `applyTradeInTx`, `plannedTransfer`, `resolveFlag`'s transaction, `notifyAffectedMember`, `AuditLogger`.
- Produces: `DECISION_WIRED_FOR`, `decisionIsWiredFor`, `reverseTradeInTx`, `NoticeContexts.trade_reversed`.

- [ ] **Step 1: Write the failing vocabulary test, which is a refactor before it is a feature**

`decisionIsAvailable` asks `DECISION_OWNER[decision] === "plan-b"` — a question about which plan wrote a thing, standing in for a question about whether it works. It was exactly right while `plan-b` and `wired` meant the same thing, and this is the commit where they stop meaning the same thing. `CONTENT_REMOVAL_WIRED_FOR` already exists in the file, one line below, asking the honest question on the other axis; this collapses the two into one table:

```ts
describe("the resolution vocabulary", () => {
  it("asks whether a decision is wired, not which plan wrote it", () => {
    // `decisionIsAvailable` used to be `DECISION_OWNER[d] === "plan-b"`, which was the right
    // question while those two facts agreed. Plan C is where they part: `trade_reversed` is
    // still owned by plan-c and is now wired, so ownership stops being able to answer.
    expect(RESOLUTION_DECISIONS.filter(decisionIsAvailable)).toEqual(["no_action", "warned_user", "content_removed", "trade_reversed"]);
    expect(DECISION_OWNER.trade_reversed).toBe("plan-c");   // provenance survives the wiring
  });

  it("says which subjects each decision can actually be carried out against, in one table", () => {
    // The two-axis version of Plan B's LOW 13: `resolveFlagSchema` accepted `content_removed`
    // for ANY flag, and a direct POST against an account_pair reached an unwired branch and
    // became a 500. A 500 is not a refusal. One table, exhaustive on both axes, so a new
    // decision or a new subject type is a compile error rather than a crash somebody has to
    // find.
    expect(DECISION_WIRED_FOR.content_removed).toEqual({ review: true, chat_message: true, account_pair: false, trade: false });
    expect(DECISION_WIRED_FOR.trade_reversed).toEqual({ review: false, chat_message: false, account_pair: false, trade: true });
    expect(DECISION_WIRED_FOR.no_action).toEqual({ review: true, chat_message: true, account_pair: true, trade: true });
  });

  it("keeps contentRemovalIsWiredFor answering exactly what it answered before", () => {
    // Derived from the new table rather than deleted, so the diff at Plan B's three consumers
    // (the detail page, resolveFlag's pre-write refusal, removeSubject's backstop) is zero.
    // The same "a re-export is what makes this a de-duplication rather than a refactor"
    // discipline ruling 21 of Plan B used for src/moderation.
    for (const subject of FLAG_SUBJECT_TYPES) {
      expect(contentRemovalIsWiredFor(subject)).toBe(DECISION_WIRED_FOR.content_removed[subject]);
    }
  });

  it("still declares account_restricted nowhere at all", () => {
    // Founder decision 5, unchanged and re-asserted here because this is the commit that makes
    // a reserved decision real, and the next reader will wonder whether the other one is next.
    expect(RESOLUTION_DECISIONS as readonly string[]).not.toContain("account_restricted");
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then collapse the two tables into one**

```ts
/**
 * Which decisions this product can actually carry out, against which subjects. TWO axes in one
 * exhaustive table, so "can an operator do this to this?" is answered in ONE place rather than
 * by three consumers each re-deriving half of it.
 *
 * It replaces two narrower answers Plan B shipped: `decisionIsAvailable`, which asked which
 * PLAN owned a decision (right while ownership and wiring agreed, and this is the commit where
 * they part), and `CONTENT_REMOVAL_WIRED_FOR`, which asked the honest question on one axis only.
 * `contentRemovalIsWiredFor` is derived from this table rather than deleted, so the diff at
 * every existing consumer is zero.
 *
 * `no_action` is wired for everything, deliberately: an operator must always be able to close a
 * question by deciding nothing needs to happen, whatever the question was about.
 * `warned_user` is not wired for `account_pair`, unchanged from Plan B: a pair flag names two
 * people and a warning names one.
 */
export const DECISION_WIRED_FOR: Readonly<Record<ResolutionDecision, Readonly<Record<FlagSubjectType, boolean>>>> = {
  no_action:       { review: true,  chat_message: true,  account_pair: true,  trade: true  },
  warned_user:     { review: true,  chat_message: true,  account_pair: false, trade: true  },
  content_removed: { review: true,  chat_message: true,  account_pair: false, trade: false },
  /** Plan C. A trade is not content and cannot be removed; the decision a trade takes is to be
   *  put back. */
  trade_reversed:  { review: false, chat_message: false, account_pair: false, trade: true  },
};

export function decisionIsWiredFor(decision: ResolutionDecision, subjectType: FlagSubjectType): boolean {
  return DECISION_WIRED_FOR[decision][subjectType];
}

/** True when this decision is wired for at least one subject type — the "does this control do
 *  anything at all?" question `decisionIsAvailable` has always asked, now derived. */
export function decisionIsAvailable(decision: ResolutionDecision): boolean {
  return FLAG_SUBJECT_TYPES.some((subject) => decisionIsWiredFor(decision, subject));
}

export function contentRemovalIsWiredFor(subjectType: FlagSubjectType): boolean {
  return decisionIsWiredFor("content_removed", subjectType);
}
```

`flagDetailFor`'s `decisions` narrows on the subject rather than on availability alone, which is what stops the detail page offering a reversal on a chat report; `resolveFlagSchema` keeps its `.refine`, now against `decisionIsAvailable`'s derived form; and `resolveFlag`'s hardcoded `"This product can't reverse a trade yet."` is replaced by the subject-aware refusal Plan B's own comment asked whoever came next to write:

```ts
if (!decisionIsWiredFor(input.decision, row.subjectType)) {
  return { ok: false, status: 400, reason: UNWIRED_REASON[row.subjectType][input.decision] };
}
```

- [ ] **Step 3: Write the failing reversal tests**

```ts
it("puts both sides back, stamps the original row, and leaves its status accepted", async () => {
  const { flagId, tradeId } = await acceptLopsidedTrade(db, { gap: 25, give: ["p_rb1"], get: ["p_wr1"] });
  expect(await resolveFlag(db, { flagId, decision: "trade_reversed", note: "Two accounts, one household, and this trade is why we looked.", operatorUserId: "u_op" })).toMatchObject({ ok: true });

  expect(await ownerTeamOf(db, "p_rb1")).toBe(await teamIdOf(db, "u_alice"));
  expect(await ownerTeamOf(db, "p_wr1")).toBe(await teamIdOf(db, "u_bob"));
  const row = await tradeRow(db, tradeId);
  expect(row.status).toBe("accepted");        // the acceptance HAPPENED
  expect(row.reversedAt).not.toBeNull();
  expect(row.reversedByFlagId).toBe(flagId);
});

it("never re-scores a week that was already played with those rosters", async () => {
  // ruling 18. The week was played. Re-settling it would be the platform editing a result two
  // managers have already seen and argued about, on the strength of a decision made afterwards.
  const before = await scoreTeamsForWeek(db, "lg_1", 4);
  await settleWeek(db, 4);
  await resolveFlag(db, { flagId, decision: "trade_reversed", ... });
  expect(await scoreTeamsForWeek(db, "lg_1", 4)).toEqual(before);
});

it("refuses when a traded player has since moved on, and says whose problem that is not", async () => {
  const { flagId } = await acceptLopsidedTrade(db, { give: ["p_rb1"] });
  await anotherTradeMoves(db, "p_rb1");
  const result = await resolveFlag(db, { flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op" });
  expect(result).toEqual({ ok: false, status: 409, reason: "One of these players has been traded again since. Undoing this trade would take a player off a third team, so it needs a different decision." });
  expect(await isOpen(db, flagId)).toBe(true);            // the question stays open
  expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(0);
});

it("refuses a second reversal of the same trade", async () => {
  // The guard is in the reversal UPDATE's own WHERE (`reversed_at IS NULL`), the same no-re-stamp
  // shape reviews and chat_messages both use.
  await resolveFlag(db, { flagId: first, decision: "trade_reversed", ... });
  const second = await resolveFlag(db, { flagId: reReported, decision: "trade_reversed", ... });
  expect(second).toMatchObject({ ok: false, status: 409 });
});

it("tells BOTH managers, which no other resolution in this product does", async () => {
  // Every other decision names one person. A reversal changes two rosters, so both people are
  // affected and `notifyAffectedMember` is called twice inside the one transaction. The lock
  // order is unchanged: both notices precede the anchor.
  await resolveFlag(db, { flagId, decision: "trade_reversed", note: "n", operatorUserId: "u_op" });
  expect((await noticesFor(db, "u_alice"))[0]!.noticeType).toBe("trade_reversed");
  expect((await noticesFor(db, "u_bob"))[0]!.noticeType).toBe("trade_reversed");
});

it("puts the reversal on the LEAGUE chain and the decision on the platform chain", async () => {
  // The two-class sentence operators-and-moderation.md §5 wrote, applied to its first new case
  // since it was written: the league can SEE two rosters change back, so the roster_move is
  // theirs; the investigation that ordered it is not, so flag_resolved stays platform-scoped.
  await resolveFlag(db, { flagId, decision: "trade_reversed", ... });
  expect(await auditEventsOn(db, "lg_1", "roster_move")).toHaveLength(2);   // the trade, then the reversal
  expect(await auditEventsOn(db, "platform", "flag_resolved")).toHaveLength(1);
  expect(await auditEventsOn(db, "lg_1", "flag_resolved")).toHaveLength(0);
});
```

- [ ] **Step 4: `reverseTradeInTx`, and its two transactions that are really one**

```ts
/**
 * Put a trade back. Called ONLY from `resolveFlag`'s `trade_reversed` branch, inside that
 * function's own transaction, so an operator's decision and its consequence cannot come apart —
 * the same property Plan B built for `content_removed` and for the same reason.
 *
 * A reversal is a COMPENSATING TRANSFER, not an undo: it runs `applyTradeInTx` with the two
 * sides swapped, writes its own `roster_move` on the league chain with `reason:
 * "trade_reversed"`, and stamps `reversed_at` on the original row. Nothing is deleted, no status
 * moves backwards, and no settled week is re-scored (ruling 18).
 *
 * It refuses rather than improvises when the world has moved on. If any traded player is no
 * longer on the roster the trade put him on, this returns a refusal that rolls the whole
 * resolution back, leaving the flag OPEN — an operator who cannot undo a trade should be looking
 * at a question they still have to answer, not at a flag stamped with a decision that did not
 * happen.
 */
export async function reverseTradeInTx(tx: DbTx, input: ReverseTradeInput): Promise<ReversalResult>;
```

There is one genuinely new lock-order edge here and it needs stating, because `resolveFlag`'s transaction previously touched no roster: the reversal reaches `stat_weeks FOR SHARE` **first**, before the `integrity_flags` stamp, matching `setLineup` and `acceptTrade`. That makes the three roster-adjacent writers in this codebase take the same first lock in the same position, which is the property that keeps them from forming a cycle. `lock-order.test.ts` gains the proof, driven against a parked `persistTick`.

```ts
trade_reversed: ({ leagueName, counterpartyTeamName, gaveBackSummary, gotBackSummary, note }) => ({
  title: "An operator put a trade back",
  body: `An operator reviewed the trade you and ${counterpartyTeamName} completed in ${leagueName} and put both rosters back the way they were. You have ${gotBackSummary} again, and ${counterpartyTeamName} has ${gaveBackSummary}. Scores from weeks you have already played stay as they were. There is no reply to this message.`,
}),
```

`quoteFor` returns `context.note` for this type, so the operator's own words render as the bounded blockquote rather than as a clause. The last sentence is founder decision #4, unchanged: there is no appeal path, and a notice that does not say so invites a member to hunt for one.

- [ ] **Step 5: PERSONA PANEL — the operator undoing something two people agreed to (controller step)**

The controller runs the panel. This is the second panel in the plan and it is separate from Task 8's because the questions do not overlap: Task 8 is about making a trade, and this is about a stranger taking one away.

- **The operator, on irreversibility in both directions.** A reversal cannot itself be reversed, and the refusal path (a player traded again) leaves the flag open with nothing the operator can do from this page. Is "needs a different decision" enough guidance, or does the detail page owe them the list of what those decisions are?
- **The operator, on evidence they cannot re-derive.** The flag stores the per-week values from the moment of acceptance. Weeks later those numbers will look wrong beside the players' actual form. Does the detail page say loudly enough that these are historical, or will an operator quietly re-judge the trade on today's numbers?
- **The reversed-on manager, reading the notice.** They agreed to a trade in good faith, possibly with somebody who was cheating and possibly not, and a stranger has now taken it back with no reply channel. The copy says nothing about why beyond the operator's note. Is that the right amount, given `INTEGRITY_CONFIG.notices.accusatoryTerms` forbids the platform hinting at collusion?
- **The other manager in the trade**, who may be the one under suspicion. They get the identical notice. Confirm out loud that the panel agrees both parties read the same words, and that the product never tells one of them which one was being looked at.
- **The commissioner and the rest of the league**, reading the activity feed. They see two rosters change back and a `roster_move` that says a trade was put back. They do not see the flag, the decision or the note. Is the league row's copy honest without being an accusation the feed cannot support?
- **The high-stakes veteran**, on settled weeks. A reversal does not re-score week 4, so the standings still reflect a trade that has been undone. That is deliberate (ruling 18) and it is exactly the kind of asymmetry a competitive manager will notice and dispute. Does it need saying on the surface, or only in `docs/trades.md`?

Anything the panel raises that is out of scope goes to the ledger for Plan D, named, rather than being built here.

- [ ] **Step 6: Commit**

---

## Task 8: The trade surface — propose against a real roster, read the verdict, answer an offer

Trades are the largest new **product** surface in this phase and every one of them is a two-party negotiation about money-adjacent value. The overview says to budget for a real panel round rather than a checkbox, and this task does.

It reuses rather than invents. The verdict comes from the advisor route that has existed since Phase 1 and has never had a proposal to assess — this is the commit where `POST /api/leagues/[leagueId]/advisor/trade` finally has a caller that can act on the answer, and the advisory-only constraint survives it intact: **the AI never accepts anything, a human does.** Rosters render through `PositionBadge` and `Sticker`, the two primitives that already own player display. No new icon, no new primitive.

**Files:**
- Create: `src/league-room/components/trade-card.tsx`, `trade-inbox.tsx`, `trade-composer.tsx`, `trade-verdict.tsx` (+ their tests)
- Create: `src/league-room/hooks/use-trades.ts` (+ its test)
- Create: `src/app/app/leagues/[leagueId]/trades/page.tsx` (+ its test)
- Modify: `src/league-room/contract.ts`, `src/league-room/components/league-home.tsx` (+ its test), `src/integrity/rendered-copy.test.tsx`, `src/integrity/room-copy.source.test.ts`

**Interfaces:**
- Consumes: `TradeProposalView`, `TRADE_CONFIG`, `Card`, `Badge`, `Button`, `Select`, `Modal`, `EmptyState`, `ErrorState`, `Icon`, `PositionBadge`, `Sticker`, `PageTitle`, `AdvisorPanel`'s existing fetch seam.
- Produces: `TradesPageBody`, `TradeCard`, `TradeInbox`, `TradeComposer`, `TradeVerdict`, `useTrades`.

- [ ] **Step 1: Write the failing component tests first, states before happy path**

```ts
it("offers the composer from an empty inbox rather than dead-ending on it", () => {
  // design-system.md: never a dead end, and `StatePanelProps.action` is required rather than
  // optional. An empty trade inbox is what most managers see most weeks and it is the state
  // most likely to be shipped as a shrug.
  renderInBothThemes(<TradeInbox trades={[]} {...deps} />);
  expect(screen.getByRole("button", { name: "Put an offer together" })).toBeVisible();
});

it("shows the verdict beside the accept control, never instead of it", () => {
  // The advisory-only constraint as a layout rule. The model writes prose about a verdict
  // `tradeBalance` already decided, and a human clicks. A surface that gated accept on the
  // verdict would be the AI making the decision.
  renderInBothThemes(<TradeCard trade={LOPSIDED_INBOUND} {...deps} />);
  expect(screen.getByText(/a long way from even/i)).toBeVisible();
  expect(screen.getByRole("button", { name: "Accept" })).toBeEnabled();
});

it("says the verdict is about points per week and not about whether to do it", () => {
  renderInBothThemes(<TradeVerdict assessment={LOPSIDED} />);
  expect(screen.getByText(/weekly production/i)).toBeVisible();
});

it("keeps the accept and decline controls apart at 360px, so a thumb cannot mean the opposite", () => {
  // The one irreversible pair of buttons in this product that sit next to each other. Mobile
  // first is not a nicety here.
  window.happyDOM.setViewport({ width: 360 });
  renderInBothThemes(<TradeCard trade={INBOUND} {...deps} />);
  expect(gapBetween(screen.getByRole("button", { name: "Accept" }), screen.getByRole("button", { name: "Decline" }))).toBeGreaterThanOrEqual(MIN_TARGET_GAP);
});

it("asks once before it accepts, because nothing undoes it", () => {
  renderInBothThemes(<TradeCard trade={INBOUND} {...deps} />);
  fireEvent.click(screen.getByRole("button", { name: "Accept" }));
  expect(screen.getByRole("dialog")).toHaveTextContent("Both rosters change as soon as you accept. You can't undo it.");
});

it("caps the package at the same number the service does, from the same config", () => {
  // TRADE_CONFIG.maxAssetsPerSide, read as a value because `src/trades` is client-boundary
  // exempt. A hardcoded 5 here is the drift that ships a form the API refuses.
  renderInBothThemes(<TradeComposer {...deps} />);
  expect(screen.getByText(new RegExp(`up to ${TRADE_CONFIG.maxAssetsPerSide} players`))).toBeVisible();
});

it("renders a superseded offer with what happened, not with a blank status", () => {
  renderInBothThemes(<TradeCard trade={SUPERSEDED} {...deps} />);
  expect(screen.getByText(/moved to another team/i)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
});

it("renders a reversed trade as reversed, in the history where it still belongs", () => {
  renderInBothThemes(<TradeCard trade={REVERSED} {...deps} />);
  expect(screen.getByText(/an operator put this trade back/i)).toBeVisible();
});
```

- [ ] **Step 2: Run them, watch them fail, then build the three components**

`TradeComposer` picks a leaguemate's team from a `Select`, then two player lists rendered as `Sticker`s with `PositionBadge`, then a note field capped from `TRADE_CONFIG.noteMaxLength` with the same live count `ReviewComposer` already uses. Choosing at least one player on each side calls the existing advisor trade route and renders `TradeVerdict` before the send control is reached — so a manager never sends an offer without having been shown what the platform thinks of it, which is the dual-use thesis pointed at the person rather than at the operator.

`TradeInbox` is three bands: offers to answer, offers you have out, and the league's completed trades. Loading, empty, error and success states all designed; both themes via `inBothThemes`; `axe` clean; the primary flow (open trades, build an offer, read the verdict, send; then as the other manager, open, read, accept) walked keyboard-only.

`league-home.tsx` gains one link with a `Badge` count of inbound offers, beside the existing activity link. No new visual mapping, no page-local styling: the badge is the `Badge` primitive and the glyph is `inbox`.

- [ ] **Step 3: Extend the two copy sweeps rather than trusting this task to remember**

`src/integrity/rendered-copy.test.tsx` gains a `describe` block per surface — the per-surface sweep Plan A built for exactly this, whose own docblock says *"adding a surface here is one `describe` block, which is the point."* Interaction states are driven, not just first paint: the composer with and without a note, each state of `TradeCard` (inbound, outbound, accepted, superseded, reversed), and the confirm dialog — because Plan B's final review found an em dash on a branch that never mounted.

`src/integrity/room-copy.source.test.ts`'s `ROOM_DIRS` gains `"src/league-room"`. It currently reads `src/chat-room` and `src/admin-room` only, which means every string in the league room has been sweep-free since Phase 1 and this plan is about to add thirty more. Directory-derived, so a component added next month is covered the moment it exists rather than when somebody remembers (ruling 27). **Expect this to fail on existing strings** — fix them in this commit; that is the point of a directory-derived sweep and it is why the founder's dash rule grew teeth in the first place.

- [ ] **Step 4: PERSONA PANEL — the trade arc (controller step)**

The controller runs the panel over the whole arc, because it is one story: I built an offer, somebody answered it, my roster changed.

- **The veteran, on the verdict.** They will disagree with `tradeBalance` — it values points per week and nothing else, no positional scarcity, no schedule, no injury. Does the surface claim more than it can support? Is "weekly production" enough of a hedge, or does a confident-looking verdict on a thin model do more harm than no verdict?
- **The casual, on the accept button.** It is irreversible, it changes two rosters, and it sits next to Decline. Is one confirm dialog enough? Does the dialog say the right thing, or should it name the players one more time?
- **The commissioner, on having no role.** Founder decision #6 ships immediate execution with no approval step and no veto window. In a private league of friends that is a real change from what people expect from other platforms, where a commissioner can deny a trade. Is that surprising enough to need saying somewhere a commissioner reads, given they can already remove a member but cannot review a trade?
- **The first-timer, on the composer.** They have to pick a counterparty, then two sets of players, then read a verdict, then send — four decisions before anything happens. Where does that lose somebody, and is there an order that starts from "who has the running back I want" rather than from a team picker?
- **Everyone, on the offer that dies.** `superseded` is a state nobody asked for: your offer stopped being answerable because somebody else traded first. The notice says nobody declined it. Does the card in the inbox say the same thing as clearly?
- **The high-stakes veteran, on expiry.** Three days, lazily enforced, with no reminder and no countdown beyond the date. Is the absence of a nudge a feature (no pressure) or a gap (offers rot silently)? A reminder needs a scheduler, which this phase does not have, so an answer of "gap" goes to the ledger for Plan D rather than into this task.

- [ ] **Step 5: Commit**

---

## Task 9: The seed, the end-to-end walk, and the three items Plan B carried here

Plan B's ledger closed with three named items for this plan and they are done here rather than mentioned here: the trade-fairness severities its own seed could not produce, a real end-to-end trade, and `toggleReaction`'s missing transaction.

**Files:**
- Create: `src/data/seed/seed-trades.ts` (+ its test); Modify: `src/data/seed/index.ts` (+ its test)
- Create: `e2e/trades.spec.ts`; Modify: `e2e/mobile-360.spec.ts`, `e2e/global-setup.ts`
- Modify: `src/chat-service/chat.ts` (+ its test)

- [ ] **Step 1: Seed real trades, through the real routes**

Plan B's ruling 29 refused decorative flag rows and named the gap it left: *"Trade-fairness severities are absent because no trade exists; Plan C's seed adds them."* This is that. The seed proposes and accepts three trades in a seeded league — one even, one lopsided-but-below-threshold, one grotesque — **through `proposeTrade` and `acceptTrade`**, not by inserting rows. What an operator sees locally after `npm run seed && npm run dev` is one real `trade_fairness` flag raised by the real detector from real rosters, sitting in the queue beside Plan B's real multi-account flag.

```ts
it("produces exactly one flag from three trades, and the flag names the grotesque one", async () => {
  await seedTrades(db, deps);
  const flags = await openFlags(db);
  expect(flags.filter((flag) => flag.flagType === "trade_fairness")).toHaveLength(1);
  expect((await tradeRow(db, flags[0]!.subjectId)).status).toBe("accepted");
});

it("seeds through the real services, so what an operator sees locally is what the detector does", () => {
  // The founder rule against mock data on real surfaces, checked rather than asserted.
  const source = read("src/data/seed/seed-trades.ts");
  expect(source).not.toContain("insert(integrityFlags)");
  expect(source).not.toContain("insert(tradeProposals)");
});
```

- [ ] **Step 2: The end-to-end walk, seeded per spec**

`e2e/trades.spec.ts` is a new file rather than three more steps in `league-lifecycle.spec.ts` — the per-spec seeding item Plan B carried here. The lifecycle spec builds a league to draft in; a trade spec needs a league that has already drafted, with two managers holding known players, and bolting that onto the lifecycle run makes both specs slower and each one's failure ambiguous. So this spec seeds what it needs, with the reuse-if-exists stable-identity pattern `mobile-360.spec.ts` already established so repeated runs do not accumulate leagues.

One authenticated pass, two real sealed sessions, no fixtures: manager A opens the trade page, builds an offer against manager B's roster, reads the verdict the advisor route returns, sends it. Manager B sees the offer in their inbox and the notice in the inbox Plan A built, accepts it, confirms. Both rosters have changed on the lineup editor. The league activity feed shows the trade to a third manager and shows them nothing about any flag. Then the seeded operator opens `/app/admin/queue`, finds the `trade_fairness` flag, opens it, sees the full propose-to-accept trail, and resolves it `trade_reversed`. Both managers' rosters are back and both have the notice.

`e2e/mobile-360.spec.ts` gains `/app/leagues/<id>/trades` and the flag detail page for a trade flag to its route list.

- [ ] **Step 3: `toggleReaction` gets its transaction**

Plan B's final review adjudicated this and carried it here in writing: the insert-then-delete pair is un-transacted, it **converges** (correctness comes from each write's own `RETURNING`, never from a prior read) and produces no torn state, but under pooler load the two statements can interleave with another connection's pair and produce a spurious frame. It is a **flake reduction, not a correctness fix**, and the commit body says so rather than claiming a bug that was not there.

```ts
it("keeps judging by its own RETURNING rows, not by a read inside the transaction", async () => {
  // The property the transaction must not quietly replace. A `SELECT … FOR UPDATE` here would
  // be a read-then-write, which is the shape this function was deliberately written to avoid and
  // which `removeReview` and `resolveFlag` both cite it as the exemplar of.
  const source = read("src/chat-service/chat.ts");
  expect(source).not.toMatch(/toggleReaction[\s\S]*?\.for\("update"\)/);
});

it("adds and removes exactly once under two concurrent double-taps", async () => {
  const [a, b] = await Promise.all([toggle(dbOne, ONE_TAP), toggle(dbTwo, ONE_TAP)]);
  expect([a.added, b.added].filter(Boolean)).toHaveLength(1);
  expect(await reactionCount(db, "m_1", "🔥")).toBe(a.added || b.added ? 1 : 0);
});
```

The publish stays outside the transaction, best-effort, exactly where it is: the realtime rule is unchanged and this task does not accidentally make a Redis failure roll back a reaction.

- [ ] **Step 4: Commit**

---

## Task 10: Docs, gate 20, and the closing battery

**Files:**
- Modify: `vitest.config.mts`
- Create: `docs/trades.md`, `docs/decisions/trades-and-fairness.md`
- Modify: `docs/conventions.md`, `docs/advisor.md`, `docs/decisions/audit-and-integrity.md`, `docs/decisions/operators-and-moderation.md`, `README.md`, `package.json`

- [ ] **Step 1: Gate 20, with both halves**

`src/trades` joins `COVERAGE_GATED_DIRS` **and** gets its own `thresholds` block at 100% on all four metrics. Nineteen becomes **twenty**. Both halves, because an `include` entry with no `thresholds` block measures nothing — the exact defect a Phase 2 fix wave caught in `src/stats`. Nothing else this plan writes needs a new gate: `src/league-service` (17), `src/draft-service` (18), `src/integrity` (15) and `src/integrity-service` (16) are all already gated, so the execution path, the transfer, the detector and the reversal are covered by construction. Guards unreachable through real Postgres get narrow stub-`Db` tests that put the code in the state it defends against, never a lowered threshold and never an ignore comment. Verify with an **unfiltered** `npm run test:coverage` reporting twenty directories at 100%.

- [ ] **Step 2: Write `docs/trades.md`**

The one place the propose → analyze → accept → flag → reverse sequence is described end to end, in the shape `docs/chat.md` and `docs/advisor.md` already use: what the surfaces are, what each route does and who may call it, what the lifecycle statuses mean and which are terminal, where the thresholds live and what each one does, and the sequence as a numbered walk. It ends with the two things a reader will look for and not find: there is no waiver wire and no free agency (a roster is fixed from draft to season end, and `roster_move` means draft picks, lineup changes and trades and nothing else), and there is no commissioner approval step.

- [ ] **Step 3: Write `docs/decisions/trades-and-fairness.md`**

A new document rather than more sections on the two existing decision docs, which are 662 and 672 lines about the chain and the operator. Sections, each recording what was chosen, why, and what would have to change for the choice to be wrong:

1. **Where a trade is recorded, and why it is the league chain.** Ruling 1, stated beside `operators-and-moderation.md` §5's two-class sentence so the pair reads as one rule rather than two coincidences. The reversal is the case that shows the split working: the `roster_move` is the league's, the `flag_resolved` is not.
2. **One fairness function, and where it now lives.** Ruling 2: why `src/ai-advisor` was the wrong home, why `src/trades` is the right one, and the identity test that keeps the re-export from becoming a copy. The four-threshold order and what each inversion would actually do.
3. **The proposal's shape.** The fingerprint and what counts as the same offer; why the mirror offer is a different offer; why `reversed_at` is a stamp and not a status; why assets are `jsonb` and what Phase 9 adds.
4. **The transfer, and the settled week.** Ruling 14 in full — the `getLineup` fallback, the two callers that re-read it weeks later, and why materialization records a fact rather than making a decision. This is the section a future reader most needs and least expects.
5. **The lock order for a roster-moving transaction.** The three writers (`setLineup`, `acceptTrade`, `reverseTradeInTx`) that take `stat_weeks FOR SHARE` first, and why the position rather than the lock is what matters.
6. **Where the flag is written, and the hole that leaves.** Ruling 22: the one-chain-per-transaction constraint, the after-commit write it forces, the trade that can end up unflagged, and the operator sweep that is the remedy. Stated beside Plan B's own after-commit exception so the two read as one pattern.
7. **The trade governance default.** Founder decision #6 as shipped: immediate execution, no veto window, no commissioner approval, no league vote. What a veto window would change (a branch in `evaluateTradeBeforeExecute`'s result, not a design) and what a commissioner approval step would change (a third party in a two-party transaction, which is a bigger question than it looks).
8. **The reversal.** Ruling 18: a compensating transfer, forward-only, refused when the world has moved on, and never re-scoring a settled week. Why both managers are told and why they are told the same words.
9. **What a `trade_fairness` flag is and is not.** It is a question about collusion raised on a completed trade, not a review of somebody's judgment — which is why its threshold (20) is well above the one at which the advisor calls a trade lopsided to a member's face (12). The known false positives: a rebuilding manager selling low, a lopsided trade between friends, a manager who values a player differently. All three should reach an operator; all three are usually `no_action`; suppressing them would mean suppressing the real case that looks identical from here.
10. **Threat model additions.** What a trade adds to Plan A's tiers: two accounts under one person can now move value between themselves in a single audited transaction, which is the exact behavior Step 3 exists to detect, and the detection is a question for a human rather than an action. What it does not add: no account action, no money movement, no path from a flag to anything automatic.

- [ ] **Step 4: Correct the drift, by grep and not by guess**

```bash
grep -rn "nineteen\|NINETEEN\|19 gated\|no trade\|Nothing in this phase executes one\|trade_reversed\|Plan C" docs src scripts README.md
```

Known targets: `docs/conventions.md`'s directory map (`src/trades/`, `trade_proposals` in the `db/schema.ts` table list, `src/league-service`'s and `src/integrity-service`'s one-line descriptions, `@/trades` on the client-boundary exempt list with the sentence saying why, the scripts list gaining `trades:sweep`, and the coverage-gate enumeration where nineteen becomes twenty). `docs/advisor.md`'s *"Running `tradeBalance` as a scheduled integrity sweep"* future-work entry becomes a pointer to the sweep that now exists, and its statement that the trade route *"never executes one"* stays true and gains the sentence saying which route does. `docs/decisions/audit-and-integrity.md`'s reserved-name list loses its four trade entries and gains a line saying where each went. `docs/decisions/operators-and-moderation.md` §4's *"What Plan C changes"* paragraph becomes what Plan C changed, and §11's threat model gains the trade. `README.md` gains `trades:sweep`.

- [ ] **Step 5: The closing battery**

```bash
npm run infra:down && npm run infra:up
npm run db:migrate && npm run db:migrate:test
npm run seed && npm run stats:ingest
npm run audit:verify -- --full        # every chain the seed produced, from genesis
npm run integrity:sweep -- --league <seeded>   # Plan B's detector, still green
npm run trades:sweep                  # this plan's, against the real seeded trades
npm test
npm run test:coverage                 # UNFILTERED: twenty gated dirs, all 100%
TEST_DATABASE_URL=$TEST_PGBOUNCER_URL npm test    # the whole suite through the pooler
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
npm run e2e                           # twice, back to back, per Plan A's precedent
```

The through-the-pooler run carries a specific load here beyond inheriting the precedent. This plan adds the widest transaction in the codebase: `acceptTrade` takes `stat_weeks FOR SHARE`, then a `trade_proposals` row, then writes `lineup_slots` and `roster_slots` for two teams, then settles other proposals, then two notices, then a two-event batch on the anchor. That is six lock classes in one transaction, against a worker (`persistTick`) and two other writers (`setLineup`, `joinLeagueInTx`) that take three of the same six. `lock-order.test.ts` running through transaction pooling is the check that matters, and it is the check that found a real cycle in Plan A.

`audit:verify --full` matters for the reason Plan A's documented floor gives: an unverified chain's tail deletion plus anchor rewind is undetectable, so first-verification-per-chain is the requirement. Every league chain the seed and the e2e create is a new chain, and this line is where each gets its first verification.

- [ ] **Step 6: Commit**

---

## Open questions, self-ruled

Every judgment call this plan makes, numbered, with the reasoning that would have to be wrong for the ruling to be wrong.

1. **Every trade event appends to the LEAGUE chain, and every flag about one appends to the platform chain.** `operators-and-moderation.md` §5 wrote the sentence that decides this: *a record about a person under review is not the league's business; a record about a consequence the league already sees is.* A trade is league content — it moves two rosters, changes everyone's matchups and is visible in the standings — so `trade_proposed`, `trade_rejected`, `trade_accepted` and `roster_move` all carry a real `leagueId` and land on that league's chain. The `flag_raised` and `flag_resolved` events about the same trade carry `leagueId: null` and land on the platform chain, unchanged from Plan B. The result is the sharpest demonstration of that rule the codebase has: one afternoon produces a row every member reads and a row no member can reach, and nothing filters the second one out — it is structurally absent from `listLeagueActivity`'s query. This is wrong only if a trade turns out to be private league content, which it cannot be: two rosters changed and the league can see both.

2. **`tradeBalance` moves to `src/trades/fairness.ts` and `src/ai-advisor/valuation.ts` re-exports it.** Three properties made the advisor directory the wrong home, and all three are the advisor directory's own rules. It is not coverage-gated, so the arithmetic the whole of Step 3 rests on had no gate. It is on the client-boundary **blocked** list, so no browser code can read the verdict vocabulary — which the trade surface needs. And `advisory-only.test.ts` exists to prove nothing in it writes, which makes it a strange home for a function the write path calls inside a transaction. `ADVISOR_CONFIG` already moved out for the first reason and said so in its own docblock; this finishes the move. The re-export is what makes it a de-duplication rather than a refactor — the diff at every existing consumer is zero — and `expect(reExported).toBe(tradeBalance)` is what keeps a re-export from later becoming a copy. This is wrong if a future reader concludes `src/trades` is advisor code; the docblock on both sides says which is which.

3. **`src/trades` is a new pure, browser-safe directory on the client-boundary EXEMPT list, not part of `src/domain` and not part of `src/integrity`.** Not `src/domain`: that directory is under `eslint-plugin-functional`'s immutability rules and holds types the whole product shares, and a trade's config, lifecycle and wire contract are a feature's vocabulary rather than the domain's. Not `src/integrity`: that directory is on the **blocked** list because it reads `node:crypto` and Postgres-shaped types, and `src/league-room/components/trade-composer.tsx` needs `TRADE_CONFIG.maxAssetsPerSide` and `TradeProposalView` as values. So a fourth pure exempt directory, beside `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews` and `src/moderation`, for the identical reason each of those is one. `src/domain/trade.ts` stays where it is and keeps `TradeProposal` and `isBalancedProposal`, because `src/ai-advisor` already imports them and a move there would be churn with no property attached.

4. **`advisory-only.test.ts` gains `acceptTrade`, `executeTrade` and `applyTradeInTx` in the same commit that gives the advisor a trade worth executing.** That test's `WRITE_PATTERNS` is a hand-maintained list — `setLineup`, `finalizeWeek`, `applyAction`, `commitDraft`, `acceptInvite` — each added when the named call became reachable and tempting. A trade executor is the most tempting one this codebase has produced: the advisor route already assembles both sides of a proposal and returns a verdict about it, and one import would turn an assessment into an action. Adding the names before the executor exists means the test is red for the length of one commit rather than green over a hole.

5. **Two configs: `TRADE_CONFIG` for the product, `INTEGRITY_CONFIG.trade` for the thresholds.** `INTEGRITY_CONFIG`'s own docblock says *"Plans B, C and D add FIELDS here, never new files,"* which binds the two integrity thresholds the spec names. It does not bind proposal expiry, side sizes or a rate limit, and putting them there would make one object the home of two unrelated audiences' numbers. The line between them is a question anybody can apply: *would a commissioner tune this?* Expiry, yes. The gap at which the platform asks an operator about collusion, no. `src/trades/config.ts` is therefore the 24th colocated config and it follows the convention rather than forking it.

6. **Four thresholds on one axis, one test, and the integrity thresholds are inclusive where the advisor's are not.** `evenDelta` (3) and `lopsidedDelta` (12) are advisor copy decisions with deliberately lenient boundaries documented in `docs/advisor.md` — a gap of exactly 12 is *not* called lopsided. `crossesFairnessThreshold` uses `>=` instead, because a threshold whose exact value can never be reached is a threshold nobody can configure precisely, and because leniency is a kindness to a member reading a verdict and has no meaning at all to a detector. The ordering test covers all four rather than the pair the spec asks for, and it names what each inversion would do: `even > lopsided` makes a verdict unreachable, `lopsided > flag` fills the queue with trades the advisor itself calls fine, `flag > hold` holds trades nobody flagged.

7. **Founder decision #6's default ships: immediate execution on acceptance, no veto window, no commissioner approval, no league vote.** It is the shape Steps 3 and 5 of the spec are already written against, and every alternative adds a third party to a two-party transaction. The reason this is safe to default rather than block on is that the reversal path exists in the same plan: a trade that should not have happened can be undone by an operator, which is a strictly better answer than a delay every honest trade pays for. The founder can veto it, and the cost of a veto is one branch: `evaluateTradeBeforeExecute` already returns a `hold` decision inside the accept transaction, so a veto window is a status and a timer over a seam that is already there, not a re-opened design.

8. **Plan C does not flip `SYSTEM_ACTION_SUMMARY_ALLOWED.trade_held_for_review`.** Plan B denied it in advance and gave the reason: no publisher existed, and *"denying by default means whoever writes it inherits a real decision to argue with rather than a silent gap to rediscover."* This plan still has no publisher — `autoHoldThreshold` is `null`, no trade is ever held, and no `system_action` is written. Flipping a flag for an event nobody emits would be the control-wired-to-nothing this phase has now refused three times. Plan D is the publisher and Plan D flips it, or argues with the denial.

9. **`decisionIsAvailable` stops asking which plan owns a decision and starts asking whether it is wired, and the two `WIRED_FOR` tables become one.** Plan B's `decisionIsAvailable` was `DECISION_OWNER[d] === "plan-b"`, which was exactly right while ownership and wiring agreed — and this is the commit where they part, because `trade_reversed` is still owned by `plan-c` and is now wired. `DECISION_OWNER` survives as provenance; the availability question moves to `DECISION_WIRED_FOR`, a two-axis exhaustive `Record<ResolutionDecision, Record<FlagSubjectType, boolean>>` that also subsumes `CONTENT_REMOVAL_WIRED_FOR`. That collapse is worth doing here rather than later because Plan B's own LOW 13 was the one-axis version of the same bug: a `content_removed` decision against an account pair reached an unwired branch and became a 500, and *a 500 is not a refusal*. `contentRemovalIsWiredFor` is derived rather than deleted, so the diff at its three existing consumers is zero.

10. **A trade is the second roster mutation this product has ever had, and it does not open a third.** `commitDraftState` is the first and only writer of `roster_slots` today. This plan adds one more, and the boundary is stated in `roster_move`'s own docblock rather than left for a reader to assume: **`roster_move` means draft picks, lineup changes and trades, and nothing else.** There is no add/drop, no waiver wire and no free agency in this product — *a roster is fixed from draft to season end* — and `renderRosterMove` returning `null` for a `reason` it does not recognize is the seam a future waivers phase opts into by name rather than inherits by accident.

11. **`TradeAsset` is a discriminated union with one arm.** `plans/phase-9-dynasty-and-keeper-depth.md` adds draft-pick assets, and the founder rule is that nothing ships in a form a later phase throws away. A bare `readonly playerIds: string[]` would make Phase 9 a fork — a second column, a second validation path, a second value function. A union with `{ kind: "player" }` today makes it an added arm, and because every `switch` over `TradeAssetKind` in this plan is exhaustive, that arm is a compile error everywhere it is unhandled rather than a silent default somewhere. The cost is one discriminator field per asset in a bounded `jsonb` column, which is nothing.

12. **A proposal is private; an executed trade is league news.** `trade_proposed` and `trade_rejected` are `"hidden"`, `trade_accepted` and `roster_move` are `"everyone"`. A feed announcing *"Alice offered Bob her running back"* would broadcast a bid before either party agreed to anything, and a bid discloses what a manager thinks his own players are worth — the same competitive leak that made `lineup_change` `actor_only` in Plan A, aimed at a negotiation instead of a lineup. Both parties are told directly by notice; nobody else is told at all. What the league is entitled to is what actually happened, in full, because *a trade the league can see half of is a rumour*. This is wrong if a league wants a public trade block, which is a feature and not a visibility flag.

13. **This plan adds no realtime event type.** An executed trade reaches both managers through the `notice.created` frame on their own user stream, which Plan A built and which carries `{ noticeId, noticeType }` and never the words. It reaches the league through the activity feed on next load. A `trade.executed` league broadcast would be a fourth transport decision for a fact that is already delivered twice, and `REALTIME_EVENT_TYPES` is deliberately enumerated once and grown reluctantly — `score.update` sat reserved for a whole phase before anything published it.

14. **Every trade materializes both teams' locked-week lineups before it moves a roster.** This is the finding this plan exists to have made. `getLineup` returns saved `lineup_slots` rows when they exist and falls back to `roster_slots` when they do not, a deliberate rule so a manager who never opens the editor still fields a legal team. `finalizeWeek` scores through `getLineup`, and Plan B's `correctSettledWeek` re-scores a settled week through the same call weeks later. So a trade in week 9 silently changes what a manager is *recorded* as having started in weeks 1 through 8, for every team that never touched the editor, and it surfaces only when somebody re-settles an old week and gets a different answer — the single worst class of bug this phase could ship, because the audit chain would faithfully record a score nobody can explain. Materialization writes exactly the rows the fallback would have derived a moment earlier, so it freezes a fact rather than making a decision, and it covers only locked weeks: an open week must keep falling back, or a traded-for player would be unstartable until his new manager noticed and re-saved.

15. **`applyTradeInTx` asserts no player is on two rosters, inside the transaction, before it returns.** `roster_slots` has primary key `(team_id, slot, slot_index)`, a nullable `player_id`, no foreign key and no unique index, so a botched transfer is invisible to Postgres. Adding a unique index on `player_id` was considered and rejected: it is only unique *within a league*, `roster_slots` has no league column, and a partial or expression index over a join is not something Drizzle can express or `index-plans.test.ts` can keep honest. An assertion inside the one function that can violate it is the enforcement that fits the schema this codebase actually has.

16. **There is no trade deadline, and there is exactly one definition of "locked".** A trade is refused while the current week is locked, using `isLineupLocked` over the same `stat_weeks` row `setLineup` reads, with an absent row reading `"scheduled"`. A *season* trade deadline — the week after which no trade may happen at all — is a real fantasy concept and is deliberately not invented here: it is a league setting with a default, a commissioner decision, a browse-visible term and a piece of copy on the composer, which is a feature and not a constant. It goes to the ledger for the founder rather than into `TRADE_CONFIG` as a guessed number.

17. **The three roster-moving transactions take `stat_weeks FOR SHARE` first, in the same position.** `setLineup` already does. `acceptTrade` and `reverseTradeInTx` follow it, ahead of their own business rows, which is the property that keeps them from forming a cycle with each other or with `persistTick`. The position matters more than the lock: Plan A's real deadlock was three transactions each honoring the anchor-last rule while taking implicit foreign-key locks *after* the anchor, and the lesson recorded there is that a lock order is only a rule if every writer takes the same locks in the same sequence. `lock-order.test.ts` gains all three of this plan's transactions, driven on separate connections through the `pg_stat_activity` rendezvous that already exists.

18. **A reversal is a compensating transfer, forward-only, and it never re-scores a settled week.** Three properties, each with a rejected alternative. It is not a delete, because `trade_accepted` is on the league chain and nothing may edit it — a reversal that erased the acceptance would make the row and the chain disagree about the same afternoon. It is not a status change, for the same reason, which is why `reversed_at` is a stamp beside `status: "accepted"`. And it does not re-settle: a week that has already been played was played with those rosters, both managers have seen the result, and re-scoring it afterwards would be the platform editing a result on the strength of a decision made later. The asymmetry that leaves — the standings still reflect a trade that has been undone — is real, is the kind of thing a competitive manager will dispute, and is deliberately the smaller wrong.

19. **A proposal expires lazily, and expiry sends no notice.** `expires_at` is checked on read and again inside the settle transaction's own `WHERE`; nothing sweeps. That is not a shortcut, it is the absence of a scheduler: this product has one dev ticker started by `instrumentation.ts` and a production scheduler is Phase 2 Plan D's, so an expiry job would be this plan's first deploy dependency for a state change nobody is waiting on. No notice is sent for the same reason a `no_action` resolution notices nobody (Plan B ruling 6): nothing happened. The offer is visible in the proposer's outbox with its date, and a reminder before expiry is a real product idea that needs the scheduler — it goes to the ledger for Plan D.

20. **The open-proposal cap is counted inside the transaction, never stored.** `docs/decisions/data-layer-hardening.md`'s threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one. A team's open proposals are bounded by the cap itself — the count can never exceed ten, and the index that serves the count (`trade_proposals_outbox_idx`, partial on open) is the same one the outbox read uses. A stored counter would be a second source of truth for a number that can be read in one indexed count, and it would need the same in-transaction discipline anyway.

21. **`trade_rejected` carries the outcome in its payload, and there is no `trade_withdrawn` event type.** `AUDIT_EVENT_TYPES` ships as a pg enum whose own docblock says *"no later migration ever runs `ALTER TYPE … ADD VALUE`"*, so the vocabulary this plan has is the vocabulary Plan A gave it. A withdrawal and a rejection are the same class of fact — an offer settled without executing — and `payload.outcome` names which, read by the renderer. Both are `"hidden"` besides, so the distinction never reaches a feed at all; it reaches the two people involved through two different notice types, which is where it matters.

22. **The fairness flag is written AFTER the accept transaction commits, in its own transaction, and the hole that leaves has an operator remedy.** This is not a style choice. `trade_accepted` is league-scoped, `flag_raised` is platform-scoped, and Plan A's ruling 3 says a transaction appends to at most one chain with `recordAll` throwing on a batch that spans two. So the spec's *"subscribes to `TRADE_ACCEPTED`"* cannot be one flow, and the honest consequence is that a process dying between the commit and the flag write leaves a lopsided trade unflagged. The trade is correct, the chain is complete, and only the *question* is missing — which is why the failure is logged rather than surfaced (the manager did nothing and can do nothing), and why `npm run trades:sweep` re-raises every over-threshold accepted trade with no flag. `raiseFlag`'s open-subject unique index makes the re-run idempotent by construction. This is the same after-commit exception, with the same operator remedy, that Plan B's multi-account sweep already carries, and it is stated beside it in the decision doc so the two read as one pattern.

23. **`superseded` is its own terminal status, not `rejected`.** An offer that dies because somebody else's trade moved one of its players was not declined by anybody, and a manager who sees `rejected` will draw a conclusion about a leaguemate that is simply false. The notice says *"Nobody declined it"* for the same reason. The cost is one more status in the union and one more entry in three exhaustive tables, which is what those tables are for.

24. **Every index assertion this plan adds EXPLAINs the query production actually calls, over a corpus with real per-league density.** Plan B's final review found two of its own gate tests measuring queries production never makes, over a corpus at roughly 2% of a real league's density — a green assertion about an index that was inert. So `index-plans.test.ts`'s new block imports `tradesQuery` and EXPLAINs *that*, rather than a hand-written string that resembles it, over a corpus built from the shape a real league produces (twelve teams, a season of weeks, open proposals at a realistic fraction of the cap). Each assertion is paired with a mutation proof: drop the partial predicate, recreate the index without it, and watch the cost assertion redden. An index test that cannot fail is a comment.

25. **A trade route answers 404, never 403, to a manager who is not part of the trade.** The codebase's non-oracle discipline, third application: `publicJoinPrecondition` answers 404 for a non-public league, `withAdmin` answers 404 for a signed-in non-operator, and a trade id belonging to two other people answers 404 for everybody else. A 403 would confirm that a guessed id names a real negotiation between two named managers, which is a small leak with an obvious use in a league where people are already suspicious of each other.

26. **`src/trades` joins the coverage gate as the 20th, and nothing else needs a new one.** Every other directory this plan writes into is already gated: `src/league-service` (17) holds the execution and the transfer, `src/integrity-service` (16) holds the detector, `src/integrity` (15) holds the vocabulary. That is the payoff of Plan B's gates 17 and 18 arriving one plan early, and it means the riskiest code in this plan is at 100% by construction rather than by intention. The new directory gets an `include` entry **and** a `thresholds` block, because an `include` entry with no threshold is not a gate at all.

27. **`room-copy.source.test.ts` gains `src/league-room`, and the resulting failures are fixed rather than excluded.** That sweep reads `src/chat-room` and `src/admin-room` today, which means every user-facing string in the league room has been unswept since Phase 1 — and this plan is about to add thirty more to it. `audit-and-integrity.md` already records the shape of this gap: *"every sweep in this repo is per-module and opt-in, so a new module with user-facing copy is swept only if its author remembers to write the sweep, which is exactly how twelve strings in this plan's own UI ended up uncovered."* A directory-derived sweep covers the component somebody adds next month. Existing violations it surfaces are fixed in the same commit; a carve-out would make the sweep a decoration.

28. **The seed proposes and accepts real trades through the real services.** Plan B's ruling 29 refused decorative flag rows and named this plan by name for the severities it could not produce. Inserting a `trade_fairness` flag directly would be mock data on a real surface, which the founder rules forbid, and would prove nothing about the path that raises one. Three seeded trades through `proposeTrade` and `acceptTrade` produce exactly one flag, raised by the real detector from real rosters, and what an operator sees locally is what the detector actually does.

29. **No new icon and no new UI primitive.** `refresh-cw` is already the trade glyph — Plan B chose it for `ICON_FOR_FLAG_TYPE.trade_fairness` before a trade existed — `inbox` is the inbound offer, and `check`/`x` are accept and decline. Two lists of players render through `PositionBadge` and `Sticker`, which are already the only sanctioned ways to show a position label and a position-pigmented tile. Three phases in, "centralize the first time" looks like a plan that adds a major surface and touches `src/components/ui/` not at all.

30. **`toggleReaction` gets a transaction, and the commit says it is a flake reduction rather than a bug fix.** Plan B's final review adjudicated it: correctness comes from each write's own `RETURNING` rather than from a prior read, it converges, and it produces no torn state. What it does do under pooler load is interleave with another connection's pair and publish a frame that misrepresents the count for one refresh. Wrapping it is cheap and removes the flake; claiming it fixed a correctness bug would be a false entry in a ledger this loop reads. The `RETURNING`-derived judgment must survive the wrap unchanged, and a test greps for the `FOR UPDATE` that would quietly replace it, because a read-then-write inside a transaction is exactly what this function was written to avoid and is cited elsewhere as the exemplar of avoiding.

31. **The fingerprint makes the same offer twice one question, and two different packages two questions.** A partial unique index on `fingerprint WHERE status = 'open'` — the same shape `integrity_flags_open_subject_idx` uses, for the same reason. Sending an identical package again is not a second question and should not produce a second row somebody has to answer twice. Shopping *different* packages to the same manager is ordinary negotiation and is capped by count rather than by uniqueness. The mirror offer (B offering back what A asked for) hashes differently on purpose: it is a different question with a different person waiting, and sorting the team pair into the hash would have merged two live negotiations into one.

---

## Self-review

**Spec coverage — Step 3 (trade-fairness flagging service), task by task:**

| Spec task (lines 155–161) | Where |
|---|---|
| Read the existing analyzer and confirm its exported signature before writing tests | Task 1 step 1, and the finding is recorded rather than assumed: `tradeBalance` is `src/ai-advisor/valuation.ts:50` but `valuePlayers` is `src/ai-advisor/context.ts:173` and **silently drops unknown ids**, which Task 5's ghost-player test pins |
| A `TradeFairnessFlagService` subscribing to `TRADE_ACCEPTED`, calling the existing analyzer, comparing against `TRADE_FAIRNESS_FLAG_THRESHOLD` | Tasks 5 and 6. Split across two because the constraint the spec could not know about — one transaction, one chain — forces the score inside the accept transaction and the flag outside it (ruling 22) |
| `TRADE_FAIRNESS_FLAG_THRESHOLD` in config, documented as distinct from the member-facing advisory copy | Task 1 step 3. `INTEGRITY_CONFIG.trade.fairnessFlagThreshold` (20), deliberately above `lopsidedDelta` (12), with the docblock saying why a flag is a collusion question and not a review of somebody's judgment |
| A `TradeFairnessFlag` at `PENDING_REVIEW` storing the analyzer's own reasoning verbatim, plus `FLAG_RAISED` | Task 6 step 1. One `integrity_flags` row of type `trade_fairness` (Plan B ruling 28), `evidence` carrying the verdict, the flags array, both side values, the gap and the threshold, unmodified |
| Confirm the pre-accept advisory flow is completely unmodified | Task 6 step 1, asserted by reading the route's source: no `@/integrity` import, no `acceptTrade` reference |
| A test proving reuse rather than drift: identical score through both paths | Task 6 step 1, run against a real league through `advisorFixture` rather than a hand-built pair, comparing verdict, flags and both values |
| Tests for both sides of the threshold: below produces no flag, at-or-above produces exactly one with non-empty reasoning | Task 6 step 1, plus the config-change test the exit criteria ask for separately |

**Spec coverage — Step 3's exit criteria:**

| Exit criterion | Where |
|---|---|
| A repo-wide search confirms only one function computes trade fairness | Task 1 step 1's two-part proof: `expect(reExported).toBe(tradeBalance)` for identity, plus a source grep proving no second implementation was left behind in the advisor. Stronger than the spec asks, because a grep alone passes on two functions that agree |
| `TRADE_FAIRNESS_FLAG_THRESHOLD` is config-driven, with a test proving a config change alters flagging | Task 6 step 1's `flagWith({ fairnessFlagThreshold })` pair. The threshold is an argument for exactly this reason, the same shape Plan B's sweep uses |
| A deliberately lopsided trade is reliably flagged; a balanced one is not | Task 6 step 1, and Task 9 seeds all three severities through the real path so the claim is also true of what an operator sees locally |

**The precondition the spec assumes and never builds:**

| What Steps 3 and 5 assume | Where |
|---|---|
| A trade can be proposed | Task 3 |
| A trade can be withdrawn or rejected | Task 3 |
| A trade can be accepted, atomically, across both rosters | Tasks 4 and 5 |
| The accept path has a seam Step 5 can intercept before execution | Task 5 step 3, `evaluateTradeBeforeExecute`'s `hold`, inert on merge and covered by a test that supplies a threshold |
| A trade can be reversed (`TRADE_REVERSED` in Step 4's enum) | Task 7 |
| A trade's roster move respects lineup locks and settled weeks | Task 4, ruling 14, and Task 5's `FOR SHARE` |
| Every affected manager is noticed | Tasks 3, 5 and 7. Six notice types, each compile-forced into `NOTICE_TEMPLATES` and `NOTICE_SAMPLES` and swept by `notices.test.ts` on arrival |

**Overview obligations:**

| Obligation (overview lines 133–146) | Where |
|---|---|
| Read `src/domain/trade.ts` and `src/ai-advisor/valuation.ts` and pin their exact shapes before writing a test | Task 1, with the two corrections the overview itself got wrong recorded in "What is already true": `tradeBalance` is not in `src/domain/trade.ts`, and `valuePlayers` is not in `valuation.ts` |
| The `trade_proposals` migration and lifecycle status, following `draft_actions`' discipline | Task 2. Guarded one-way stamps, every transition an audit event, and the `reversed_at` stamp that keeps an acceptance from being un-happened |
| Propose / withdraw / reject, each authenticated through the league membership seam with `teamId` from the session | Task 3 step 1, whose first test asserts the input type has no `proposerTeamId` field at all |
| `executeTrade` — one transaction, row-locked, all-or-nothing, reusing eligibility, with a simulated mid-flight failure rolling back both sides; grep-verifiable as the only trade roster swap | Task 4 steps 3 and 4. `assignSlot` reused rather than a second slot policy; the rollback test drives a real refusal; the grep test enumerates all three `roster_slots` writers |
| The week lock and the ingestion worker: reuse `setLineup`'s `FOR SHARE`, do not invent a second answer | Task 5 step 1's parked-`persistTick` test, and ruling 17 putting all three roster writers on the same first lock |
| The `TRADE_PROPOSED`/`TRADE_ACCEPTED`/`TRADE_REJECTED` events Plan A reserved, now published | Tasks 3 and 5, moved in `reserved.test.ts` in the commits that publish them. `roster_move` too, which the overview did not name and Plan A assigned to this plan |
| The trade UI, reusing `AdvisorPanel`'s surface, keeping advisory-only intact, full states, a11y, 360px, persona panel | Task 8, with the accept/decline spacing at 360px given its own test because it is the one irreversible button pair in the product |
| `TradeFairnessFlagService` on `TRADE_ACCEPTED`, system-supplied valuations, `PENDING_REVIEW`, analyzer flags stored verbatim | Task 6 |
| The reuse-not-drift test | Task 6 step 1 |
| The threshold-ordering task across all four, in one place, failing loudly | Task 1 step 3 |
| `docs/trades.md` describing propose → analyze → accept → flag end to end | Task 10 step 2, plus `docs/decisions/trades-and-fairness.md` for the rulings, because the two existing decision docs are 662 and 672 lines about other subjects |
| Scope creep resisted in both directions (Phase 9 assets, waivers) | Rulings 10 and 11 |
| `ROSTER_MOVE`'s docblock says what it does and does not cover | Ruling 10, Task 10 step 4 |
| Step 5 intercepts pre-commit; Plan C builds the accept path with that seam present | Task 5 step 3, ruling 7 |
| The flag writer lives outside `src/ai-advisor/**` and the advisory-only constraint stays enforced | Task 1 step 5 and Task 6. The writer is `src/integrity-service/trade-fairness.ts`, and `advisory-only.test.ts` gained three names rather than losing any |
| Budget a real persona round, not a checkbox | Two panels: Task 8 (the trade arc) and Task 7 (an operator undoing a trade two people agreed to), split by audience because the questions do not overlap |
| 8 to 12 tasks; final task is docs plus the closing battery including the pooler-routed suite and a double e2e | Ten tasks; Task 10 step 5 |
| Nothing depends on Phase 2 Plan D or on Plan D of this phase | The only Plan D interaction is `autoHoldThreshold: null` and the branch that reads it (ruling 7) |

**Plans A and B obligations this plan inherits:**

| Carried item | Where |
|---|---|
| `roster_move`, `trade_proposed`, `trade_accepted`, `trade_rejected` reserved with `plan-c` in `reserved.test.ts`'s `OWNER` | Moved in Tasks 3 and 5; the test fails until each is |
| No new audit event type may be added (`ALTER TYPE` is a trap) | This plan adds none. `trade_rejected` carries `payload.outcome` for withdrawals (ruling 21) |
| The write-ordering rule and the one global lock order | Every transaction in Tasks 3, 5 and 7, each added to `lock-order.test.ts`. The one exception is the after-commit flag write, named and argued (ruling 22) |
| A transaction appends to at most one chain | Ruling 22, which is the constraint that shaped Task 6 rather than a rule it happened to obey |
| Deny-by-default on every visibility dimension; four `// Plan C` entries in `ACTIVITY_VISIBILITY` | Tasks 3 and 5 decide all four, with the renderer's own field allowlist proved by the "never renders the private note" test |
| `SYSTEM_ACTION_SUMMARY_ALLOWED.trade_held_for_review` denied in advance | Not flipped (ruling 8) |
| **`trade_reversed`'s owner moves from a Plan C reservation to a real implementation, or is re-adjudicated with reasoning** | **Implemented**, Task 7. `DECISION_OWNER.trade_reversed` stays `plan-c` as provenance; `decisionIsAvailable` stops asking about ownership (ruling 9) |
| **`toggleReaction` gets its transaction (flake-reduction, small)** | Task 9 step 3, with the commit body saying which of the two it is (ruling 30) |
| **Corpus-realism mechanism for plan assertions** | Task 2 step 4 and ruling 24: EXPLAIN the imported query, over a real-density corpus, with a mutation proof beside every assertion |
| **Per-spec e2e seeding consideration** | Task 9 step 2: `e2e/trades.spec.ts` seeds what it needs rather than extending the lifecycle spec, with the reuse-if-exists stable-identity pattern so runs do not accumulate leagues |
| `src/domain/trade.ts` already exists — read it and its test first | Task 1; both files are quoted in "What is already true" and neither is redefined |
| Plan B's queue stubs (`subjectFor`, `aboutFor`, `trailFor`, `FlagSubjectView`'s trade arm) named this plan | Task 6 step 3 |
| The allowlist proof, completed for a third flag type | Task 6 step 3's paired assertion: the trade is in the league feed, the flag is structurally unreachable from it |
| `quoteFor`'s blockquote branch, kept for the plans that add quotable league-scoped notices | Tasks 3 and 7: `trade_proposed` quotes the proposer's note, `trade_reversed` quotes the operator's |
| Gates: any new pure or service directory joins | Task 10 step 1, nineteen to twenty (ruling 26) |
| First-verification-per-chain is a documented binding floor | Task 10 step 5, the `audit:verify --full` line, with the reason restated |

**Placeholder scan:** no `TODO`, no `TBD`, no "handle errors appropriately", no "similar to Task N", no step whose expected output is unstated. Every file in the File Structure tables appears in a task's Files block. Seven places name a helper the executing engineer writes to taste rather than showing it in full — `refusalFor` and `noticeContextFor` (Task 3), `openProposalsNaming` (Task 5), the three trade-room component bodies (Task 8), `seedTradeCorpus` (Task 2), the profile assembly inside `evaluateTradeBeforeExecute` (Task 5) and the preflight print in Task 6 step 4 — and each names the existing file in this repo whose shape it copies (`src/integrity-service/flags.ts`'s `alreadyResolvedOrMissing`, `src/league-service/home.ts`'s bounded-query idiom, `src/league-room/components/lineup-editor.tsx`, `src/db/index-plans.test.ts`'s existing corpus builders, `src/ai-advisor/context.ts`, `scripts/sweep-multi-account.ts`), which is a pointer to real code rather than a placeholder.

**Type consistency:** `TradeAssetKind`, `TradeStatus`, `TradeTransition`, `TradeVerdict` and `TradeFlag` are each declared once as a `readonly` tuple with the union derived from it, the `REALTIME_EVENT_TYPES` shape this repo uses everywhere. `TERMINAL_STATUSES`, `TARGET_OF`, `DECISION_WIRED_FOR`, `QUESTION_FOR_FLAG_TYPE` and `ACTIVITY_VISIBILITY` are exhaustive `Record`s over those unions, so an added member without a decision is a compile error. `TradeProposal` (the row) is one interface, returned by `proposeTrade`, stored by `tradeProposals`, read by `listTrades` and narrowed by `TradeProposalView` for the wire, with `proposedAt`/`expiresAt`/`settledAt`/`reversedAt` as strings in TypeScript and `Date` only at the Drizzle boundary — the same discipline `AuditEvent` and `IntegrityFlag` both keep. `TradeBalance` is one type produced by `tradeBalance` and consumed by the advisor, by `evaluateTradeBeforeExecute` and by `evidence`. `TradeAsset` is one union validated by `proposeTradeSchema`, stored in two `jsonb` columns, read by `assetPlayerIds` and switched on exhaustively in `plannedTransfer` and `describeAsset`. The domain's `TradeProposal` (the pure Phase 1 shape the advisor takes) and the service's row type share no name: the row is `TradeProposalRow` at the Drizzle boundary and `StoredTradeProposal` in the service, because two types called `TradeProposal` differing by one import line is the collision Plan A refused for `notifications.ts`.

**Boundary check:** `src/trades/**` is pure, has no Node imports, no clock and no database, and joins `eslint.config.mjs`'s client-boundary **exempt** list beside `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews` and `src/moderation`; `src/league-room/components/trade-composer.tsx` value-imports `TRADE_CONFIG` and `import type`s `TradeProposalView`, which is the boundary unchanged. `src/league-service/**` and `src/integrity-service/**` stay on the blocked list and nothing in this plan asks browser code to value-import either. `src/league-service/trade-transfer.ts` imports `@/draft-engine` (`assignSlot`) and `@/domain`, both server-side and both already imported by `src/league-service` today. `src/integrity-service/trade-fairness.ts` imports `@/trades/fairness` and `@/ai-advisor/context` — a service importing the advisor's read-only context assembler is the direction `advisory-only.test.ts` permits and polices, and no import runs the other way. `src/app/app/leagues/[leagueId]/trades/**` and `src/app/api/leagues/[leagueId]/trades/**` are under `src/app/**`, where the client-boundary rule is deliberately not applied. `scripts/sweep-trade-fairness.ts` imports `src/**`, the allowed direction; nothing under `src/**` imports `scripts/**`, which the existing `src→scripts` eslint ban enforces.

**Founder rules:** two persona panels, both marked as controller steps (Task 7 step 5, Task 8 step 4), split by audience because an operator undoing a trade and a manager making one are two different people with two different fears. Every user-facing string quoted in this plan is em-dash and en-dash free and written in the active voice, which is not a stylistic preference here — `INTEGRITY_CONFIG.notices.passiveConstructions` bans `"was removed"` and `"were made"`, and `notices.test.ts` sweeps every template the moment it lands; the source sweep gains `src/league-room` in the same plan that adds thirty strings to it (ruling 27). No new UI primitive and no new icon (ruling 29). No mock data on a real surface: the seeded queue's trade flag is raised by the real detector from a real accepted trade (ruling 28). Nothing here is built in a shape a later phase plans to throw away — `TradeAsset` admits Phase 9's picks as an arm, `evaluateTradeBeforeExecute` admits Plan D's hold as a number, `DECISION_WIRED_FOR` admits a new decision as a row, and `renderRosterMove` admits a future waivers phase as a `reason` it has to opt into by name.

**Three things this plan deliberately does not do, stated so none is mistaken for an oversight.** It does not add a **trade deadline** — a season cutoff after which no trade may happen is a league setting with a commissioner decision and a browse-visible term behind it, not a constant, and guessing a week number would be inventing a rule (ruling 16). It does not add a **commissioner approval step or a veto window**, per founder decision #6, and the reason it is safe to default that way is that the reversal exists in the same plan: a trade that should not have happened can be undone, which is better than a delay every honest trade pays for (ruling 7). And it does not **re-score a settled week** when a trade is reversed, which leaves the standings reflecting a trade that has been undone — the smaller of two wrongs, chosen deliberately, and the one a competitive manager is most likely to argue with (ruling 18).
