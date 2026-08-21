# Phase 3 Plan D — Automated enforcement, participation tiers, and the commissioner's clock

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the platform act as commissioner where no trustworthy human one exists — enforce the lineup, hold the lopsided trade, start the draft on time, and keep a newcomer's public league from filling with veterans — with every automated action audited *and* explained to the member it landed on.

**Architecture:** Six strands. **(1) Participation.** A league's season completion is stamped once, in the transaction that makes it true (`finalizeWeekInTx`), so the question "how many seasons has this account finished?" is one indexed count over a bounded set rather than an anti-join over every matchup in the product (ruling 2). `src/participation/**` is a new pure, browser-safe directory (gate 21) holding the third and last meaning of the word "tier", named `participationTier` and spelled `newcomer`/`veteran` so it cannot be confused with the two `beginner`/`experienced` columns that already exist (ruling 1). **(2) Segregation.** The tier reaches `PublicLeagueSummary` as a composition label and a default always-visible filter, and it reaches the door as one more clause in `publicJoinPrecondition` — plus the clause the spec never thought to ask for, at league *creation*, because a veteran who declares his own public league `beginner` walks past a join gate he never touches (ruling 6). **(3) The auto-set lineup.** `getLineup` already falls back to the roster, so an unset lineup is legal but not *chosen*; `REPEAT_PREVIOUS_WEEK` carries last week's choice forward at the moment the week locks, materializing exactly what the fallback would have derived when there is no previous week — a fact frozen, not a decision made, the same shape Plan C's trade materialization used (ruling 9). It rides the ingestion worker's own week transition, one transaction per league, on `correctSettledWeek`'s precedent. **(4) The auto-hold.** `INTEGRITY_CONFIG.trade.autoHoldThreshold` stops being `null` and becomes **35**. The seam Plan C left is filled with a number, not a code path — and the hold transaction turns out to be **platform-scoped end to end**, which means the hold and the flag that asks about it commit together, with none of the after-commit hole the fairness flag has to live with (ruling 12). A held trade is a real lifecycle state with two real exits, `trade_released` and `trade_blocked`, because a trade frozen with no way out is the control-wired-to-nothing this phase has now refused four times. **(5) The clock.** `drafts.kickoff_at` stops being a number the product computes and never shows: a commissioner chooses it, every prospect reads it, a commissioner can finally press start, and for a public matchmade league the platform presses it (ruling 15). **(6) The delivery fix.** `useNotices` stops remounting on every navigation — not through the shared `src/app/app/layout.tsx` the ledger guessed at, which would put a header on the draft room and require a session on a signed-out invite page, but through a `NoticesProvider` in the root layout that already survives every client-side navigation in the product (ruling 19). The 120/60s stopgap comes back down to 30 with its arithmetic re-derived.

**Tech Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · `node:crypto` · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright.

**Spec:** `plans/phase-3-trust-and-integrity.md` — **Step 5** in full (lines 221–256) and **Step 6** in full (lines 260–293), plus the Phase 2 commissioner-scheduling residuals and the verified-played-here signal, which need the same participation data Step 6 computes. Phase split, founder-decision defaults and the residual ledger: `docs/superpowers/plans/2026-08-20-phase3-overview.md` (Plan D, lines 158–189). The primitives this plan consumes and the invariants that bind it: `docs/decisions/audit-and-integrity.md`, `docs/decisions/operators-and-moderation.md`, `docs/decisions/trades-and-fairness.md`, `docs/decisions/identity-and-trust.md`.

**Depends on Plans A, B and C, all merged** (`main` at `7a363ff`). It **does not depend on Phase 2 Plan D**. Every gate that plan holds is named in the founder-gated bucket below and none of them blocks a task here.

**This is the last plan in Phase 3.** Nothing it ships may leave a reserved name behind for a plan that does not exist. `src/integrity-service/reserved.test.ts`'s `OWNER` map has a `"plan-d"` arm that is currently **unused** — every one of the sixteen audit event types is already published — and this plan must leave it unused, because a Plan D reservation with no Plan E is exactly the inert deliverable this loop has caught six times. Every name this plan declares is wired in this plan, or it is not declared.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope**, not quality. Nothing gets built in a form a later phase plans to throw away — which is why the season-completion stamp is a column written by the transaction that makes it true rather than a query run when somebody asks, and why a held trade gets two real exits instead of an operator note saying what should have happened.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism"*. Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree; they all talk to one shared stack.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let`).
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`, `src/draft-service/index.ts`'s `systemClock`). **This plan is the most clock-dependent in the phase** — a kickoff time, a lock moment and a scan interval — and every one of them takes an injected clock.
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. `users.id` **is** the WorkOS user id. API and SSE routes never redirect — they return a JSON 401 themselves. **`teamId` and `weekNumber` are always resolved from the authenticated session and the server's own schedule, never from a request body.** Plan C's final review found a caller-supplied `weekNumber` acting as a collusion-evasion vector and ruled it out permanently; this plan writes lineups for a week and starts drafts at a time, and neither number may ever arrive from a client.
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. **This plan adds no realtime event type** (ruling 20): an auto-started draft already publishes `draft.status` through `publishDraftEvent`, and every other automated action reaches its member through the `notice.created` frame Plan A built.
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. Every accepted action is persisted before it is cached or published. **The auto-start writes no state of its own**: it calls `store.startDraft`, which is the same `START_DRAFT` action a commissioner's press produces, so a platform-started draft and a human-started one are byte-identical in the log except for who is recorded as having asked.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**`, `src/admin-room/**` and `src/account-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/review-service`, `@/identity-service`, `@/integrity`, `@/integrity-service`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed`, `@/stats-pipeline`, `@/stats` or `@/gifs` as VALUES. `import type` stays allowed. Exempt pure directories that browser code MAY value-import: `src/chat/**`, `src/matchmaking/**`, `src/identity/**`, `src/help/**`, `src/reviews/**`, `src/moderation/**`, `src/trades/**`. **This plan adds `src/participation/**` to that exempt list** (ruling 3). The rule is deliberately **not** applied to `src/app/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations and key formats live in a `config.ts` next to the module that uses them. `INTEGRITY_CONFIG`'s own docblock binds this plan by name: *"Plans B, C and D add FIELDS here, never new files."* So `autoHoldThreshold`, the participation cutoffs, the missed-deadline strategy and both rollback switches are **fields on `INTEGRITY_CONFIG`**, and this plan adds no new config file at all (ruling 4).
- **Tests.** **Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/participation`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **The no-write-before-a-committed-refusal test class.** Plan C's Task 5 review caught a CRITICAL: a plain `return` after a status stamp committed a false `accepted` state. The standing rule since: **every refusal path of a transaction that has already written anything is asserted to have left the world unchanged.** This plan adds four such transactions and therefore four such helpers — `expectNoAutoSetTookPlace`, `expectNoHoldTookPlace`, `expectNoReleaseTookPlace`, `expectNoAutoStartTookPlace` — each asserted on **every** refusal path of its writer, not on a representative one.
- **FK-lock enumeration in every lock-order entry.** Plan C's final review found a real `40P01` deadlock caused by an `INSERT`'s implicit foreign-key `FOR KEY SHARE` that the per-task lock proofs had waived because parent-row locks are invisible at call sites. The lesson is recorded and binding: **every transaction this plan adds enumerates its implicit FK acquisitions by name in its own docblock**, and `src/integrity-service/lock-order.test.ts` grows an entry per writer (7/7 today, 11/11 on merge).
- **Coverage threshold: 100%** for the gated directories, configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block (an `include` entry with no threshold is not a gate at all). **Twenty** gated directories on `main` today. **This plan adds one** — `src/participation` as gate 21 (Task 11, ruling 21). Every other directory this plan writes into (`src/league-service`, `src/draft-service`, `src/integrity`, `src/integrity-service`, `src/stats-pipeline`, `src/matchmaking`, `src/reviews`) is already gated at 100%, so the enforcement code is covered by construction rather than by intention. Verify with an **unfiltered** `npm run test:coverage`.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). **There is no dev auth bypass and none may be added.**
- **Any step shipping a user-visible surface additionally requires:** a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width. **An operator surface is a user-visible surface** (Plan B, ruling 27) — so the queue's new held-trade detail is in scope too.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy); once deployed, add with a DEFAULT or backfill in a separate migration. Any migration touching `chat_messages` is checked against `src/db/index-plans.test.ts` (Plan B ruling 17) — this plan touches no such table. **This plan's one migration adds one nullable column and one partial index**, and the index carries a mutation proof beside its assertion (ruling 5).
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. Fail fast with a clear message when a required var is missing. **This plan adds no environment variable.**
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional). **A blocked join is the hardest case in the product** — the member cannot have the thing they asked for — so its state offers the thing they *can* have: the open leagues they are eligible for.
- **Both themes are first-class.** Every surface is designed and tested in light and dark, via `inBothThemes` from `src/components/ui/test-utils.tsx`. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** `IconName`s on `main` today: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`, `info`, `shield`, `flame`, `anchor`, `rocket`, `crown`, `bolt`, `clover`. **This plan adds none**: `clock` is the draft time and the lock, `shield` is the platform acting, `clover` is the newcomer tier and `crown` the veteran one, `check` is the verified badge (ruling 22).
- **`PositionBadge` is the only way to render a position label; `Sticker` is the only way to render a position-pigmented tile.** The auto-set lineup notice names players through the same two primitives the lineup editor already uses.
- **Never set the display face on a paragraph.** It is a lettering face, not a reading face.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/decisions/data-layer-hardening.md`:**

- **Balance as rollup.** Any running total is a rollup row updated **in the same transaction** as each contributing write, over an append-only source table that stays the reconciliation source of truth. Never a `SUM()` on the read path. The threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one. **A league's season completes exactly once and an account's team count is bounded by the leagues it has joined**, so the expensive half (is this season over?) is stamped once per league by the transaction that ends it, and the cheap half (how many has this account finished?) is a bounded indexed count that is never stored (ruling 2).
- **PgBouncer transaction pooling forbids session state.** No `pg_advisory_lock`, no named prepared statements (`prepare: false` is unconditional), no `SET` outside a transaction, no session-scoped temp tables, **no `LISTEN`/`NOTIFY`**. DDL goes through the direct port, never the pooler. **This binds the auto-start scanner**: it may not take an advisory lock to elect a leader, which is why idempotency comes from a guarded status transition rather than from mutual exclusion (ruling 16).

**From `docs/decisions/audit-and-integrity.md` (Plan A's rulings, binding here):**

- **The audit append and the notice row are inside the business transaction and fail it; only the Redis frame is best-effort.** Every write in this plan obeys it.
- **The lock order is one global order and the audit anchor is ALWAYS the last lock**, where "lock" includes an implicit foreign-key `FOR KEY SHARE`. The permitted sequence is: business rows → notice insert → `audit.record` → `attachAuditEvent` → commit → `deliverNotice`.
- **A transaction appends to at most one chain.** `recordAll` throws on a batch spanning two. This is the constraint that decides where the hold is recorded (ruling 12) and why the release is two transactions (ruling 13).
- **`audit_events` carries no foreign keys and nothing ever deletes a row.** `AUDIT_EVENT_TYPES` is a pg enum whose docblock states *"no later migration ever runs `ALTER TYPE … ADD VALUE`"* — the vocabulary is **frozen**, so every automated action in this plan rides `system_action` with a `payload.action` code (ruling 7).
- **Deny by default, on every visibility dimension.** `ACTIVITY_VISIBILITY` is exhaustive over the whole `AuditEventType` union; a type with no decision does not compile. **This plan adds the fourth such dimension** and, in adding it, collapses the third into it (ruling 8).
- **First-verification-per-chain is a documented binding floor.** The scheduled runner is **Phase 2 Plan D's**, not this plan's (ruling 23). What this plan owes is the closing battery's `audit:verify --full` over every chain its seed and e2e create.

**From `docs/decisions/operators-and-moderation.md` (Plan B's rulings, binding here):**

- **One `integrity_flags` table with a `flag_type` discriminator.** Plan D adds a flag type, a subject type and two decisions — never a second queue.
- **Investigatory events go on the platform chain; a consequence the league already sees goes on the league chain.** The sentence that decides which: *a record about a person under review is not the league's business; a record about a consequence the league already sees is.*
- **A resolution decision exists when it has an implementation, or a named owning plan plus a runtime refusal.** This plan is the last plan, so **both new decisions ship wired** (ruling 11).
- **The queue is oldest-first with no severity sort and no bulk action.** A held trade takes its place in the same line as a reported message — which is a correction to the overview's own founder-decision default, and the reasoning is written down rather than quietly ignored (ruling 14).
- **`SYSTEM_ACTION_SUMMARY_ALLOWED` denies `lineup_auto_set` and `trade_held_for_review` in advance, and `lineup_auto_set`'s denial comes with a pre-decided answer**: *"What Plan D needs is an actor-scoped path, which is a new visibility, not a new summary."* This plan takes that answer and finds one thing wrong with it, stated rather than papered over: a `system_action` has `actorId: null` by construction, so `actor_only` cannot mean anything for it. The path is **subject**-scoped (ruling 8).

**From `docs/decisions/trades-and-fairness.md` (Plan C's rulings, binding here):**

- **`evaluateTradeBeforeExecute` already returns `hold`, computed inside the accept transaction.** Plan D supplies a **number**, not a code path.
- **`crossesFairnessThreshold` is `>=` and `null` never crosses.** The four-threshold ordering test in `src/integrity/config.test.ts` already orders `evenDelta < lopsidedDelta < fairnessFlagThreshold < autoHoldThreshold`; today the last comparison is skipped because the value is `null`. **This plan is what makes that assertion real** (ruling 10).
- **A reversal is forward-only, refused when the world has moved on, and never re-scores a settled week.** A *hold* is none of those things, because nothing has happened yet, and the difference is why `trade_blocked` is a separate word from `trade_reversed` (ruling 11).

**Founder rules (binding, from the phase overview and founder memory):**

- **No em-dashes in user-facing copy**, and in this codebase that rule has teeth: `copyViolations` (`src/integrity/copy-rules.ts`) is one rulebook enforcing three rules — no em **or en** dash, nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms`, nothing in `INTEGRITY_CONFIG.notices.passiveConstructions`. Five sweeps enforce it (`notices.test.ts`, `activity-view.test.ts`, `rendered-copy.test.tsx`, `room-copy.source.test.ts`, `script-copy.source.test.ts`). **This plan writes more platform-authored sentences than any before it**, and every one of them is a sentence the platform says about something a member did not ask for.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. **Four panels in this plan** (Tasks 3, 5, 6 and 8): a blocked join, a held trade, a draft time somebody is deciding around, and a badge that claims something about a stranger.
- **Centralize UI primitives the first time.** No page-local visual mapping; extract to `src/components/ui/` and refactor the existing consumer in the same commit.
- **No mock data on real surfaces.** The seed produces a genuinely blocked join, a genuinely held trade, a genuinely auto-set lineup and a genuinely auto-started draft, all through the real paths (ruling 24).

---

## What is already true (read before touching anything)

| The spec assumes | Reality on `main` today (`7a363ff`) |
|---|---|
| `computeExperienceTier` is a new function over a new idea | The **word** is taken three times over. `users.experience_tier` (`beginner`\|`experienced`) is a self-reported sign-up answer that drives `helpLevel` defaults. `leagues.experience_tier` (same enum) is a self-declared label rendered on `/browse` and filtered on by `matchesBrowseFilter`. Step 6's is a **computed, enforced** fact. Three meanings, one word, one of which blocks a join. This plan names the computed one `participationTier` and spells it `newcomer`\|`veteran` (ruling 1). |
| Tier is computed from "a completed-public-league count sourced from the audit log" | There is nothing in the audit log that says a season ended. `leagues` has no status column; the only observable completion is *every* matchup in the league carrying scores. The anti-join that asks it cannot use `matchups_unsettled_idx`, whose leading column is `week_number`. This plan stamps `leagues.season_completed_at` in `finalizeWeekInTx` — the one transaction that scores a week — and counts over that (ruling 2). |
| `TRADE_AUTO_HOLD_THRESHOLD` needs to be added to config | It exists. `INTEGRITY_CONFIG.trade.autoHoldThreshold` is `null as number \| null`, its docblock says **"Plan D owns it"**, `evaluateTradeBeforeExecute` already reads it and already returns `hold`, `crossesFairnessThreshold` already treats `null` as never-crossing, and `src/integrity-service/trade-fairness.test.ts` already proves the branch works when a threshold *is* supplied. Plan D supplies **35** and wires what happens next. |
| A held trade is a state the trade lifecycle already has | It is not. `TRADE_STATUSES` declares six (`open`, `accepted`, `rejected`, `withdrawn`, `expired`, `superseded`) and `nextStatusFor`/`transitionIsLegal` are exhaustive over them. `held` is a seventh, and unlike the reversal — which was deliberately *not* a seventh status because the row still meant "accepted" — a held trade genuinely is neither open nor settled (ruling 11). |
| `resolveFlag` can absorb a held trade with its existing decisions | It cannot honestly. `no_action` is documented as noticing nobody *because nothing happened*, and using it to release a frozen trade would make the one decision that means "nothing happened" perform a roster mutation. `trade_reversed` describes undoing something that occurred. `DECISION_WIRED_FOR` is a two-axis exhaustive `Record<ResolutionDecision, Record<FlagSubjectType, boolean>>` built for exactly this: a new subject type gets a column, two new decisions get rows, and every cell is a compile-forced answer. |
| `SYSTEM_ACTION_SUMMARY_ALLOWED` is the gate to flip | It is the gate to **subsume**. It answers "may this action say words", and Plan D needs "to whom" — a question `ACTIVITY_VISIBILITY` answers for types but nothing answers for codes. `SYSTEM_ACTION_VISIBILITY` replaces it and derives the old boolean, so the three existing consumers see a zero-line diff, exactly the way `contentRemovalIsWiredFor` survived `DECISION_WIRED_FOR` in Plan C (ruling 8). |
| An unset lineup forfeits the week | It does not. `getLineup` (`src/league-service/lineups.ts:66`) returns saved `lineup_slots` rows when they exist and **falls back to `roster_slots` when they do not**, through `defaultLineup`, so a manager who never opens the editor still fields a legal team. What the fallback does *not* do is remember: it is per week, so a manager who set week 1 carefully and forgot week 2 fields the raw roster order in week 2, not the team they chose. That gap is what `REPEAT_PREVIOUS_WEEK` closes (ruling 9). |
| Mechanically invalid roster moves need automatic rejection in public leagues | They are **already** rejected, in every league, better than the spec asks. `setLineup` validates ownership, duplicate starts and `validateLineup(…)` against `src/domain/roster-eligibility.ts`, returning a 422 with a plain-language reason. Step 5's fourth task is satisfied by construction and this plan's job is to **prove** it with the matched pair rather than build a second path (ruling 18). The one real gap is the audit residual: `setLineup` never asserts `teams.league_id === input.leagueId`, and this plan writes a team-scoped mutation, so it inherits the obligation to close it. |
| `drafts.kickoff_at` is a commissioner's choice | It is `now + LEAGUE_CONFIG.defaults.draftDaysFromCreation`, computed in `src/league-service/creation.ts:73`, **never chosen and never shown**. It is read in exactly one behavioral place: `clockTierFor`/`nextTighteningAfter`, the draft clock's tightening schedule. **Nothing compares it to the current time.** `POST /api/drafts/[draftId]/start` exists, is commissioner-only, is correct, and **no UI in the product calls it** — it is reachable by curl and by `scripts/drive-dev-draft.ts` and by nothing else. |
| A production scheduler exists to hang an auto-start on | `src/instrumentation.ts` starts two in-process workers (`getDraftTicker()`, `getIngestionWorker()`), each a bare `setInterval` with a non-overlap guard and **no leader election**. PgBouncer transaction pooling forbids `pg_advisory_lock`, so mutual exclusion across instances is unavailable by construction. The existing precedent for cross-instance idempotency is the nudger's `draft_nudges` row on `(draftId, pickNumber)` with `onConflictDoNothing().returning()` — a claim, not a lock (ruling 16). |
| There is a shared app layout to fix the notices remount in | There is not. The only layout in the tree is `src/app/layout.tsx`. `AppHeader` is rendered by **nine pages individually**, and two pages under `/app` deliberately do not render it: the draft room (`RoomRail` is its header, under a no-page-scroll contract) and the invite page (`src/app/app/join/[code]/page.tsx`, **the one page under `/app` a signed-out visitor reaches**, per `middleware.ts`'s single exemption). A `src/app/app/layout.tsx` that renders `AppHeader` breaks both (ruling 19). |
| Twenty directories are coverage-gated | Twenty: `src/trades` was gate 20. `src/participation` is gate 21, with an `include` entry **and** a `thresholds` block. |

---

## File Structure

**New — the participation vocabulary (`src/participation/**`, pure, browser-safe, gate 21):**

| File | Responsibility |
|---|---|
| `src/participation/tier.ts` | `PARTICIPATION_TIERS`, `ParticipationTier`, `participationTierFor(completedSeasons, cutoff)`, `PARTICIPATION_TIER_LABEL`, `PARTICIPATION_TIER_BLURB`. The third meaning of "tier", named so it can never be the other two. |
| `src/participation/composition.ts` | `TierComposition`, `tierCompositionFor({ newcomers, veterans })`, `TIER_COMPOSITION_LABEL`. What a browse card says about who is already in a league, as an aggregate and never per member. |
| `src/participation/verified.ts` | `isVerifiedPlayer(completedSeasons, cutoff)`, `VERIFIED_BADGE_LABEL`, `VERIFIED_BADGE_TOOLTIP`. Founder decision #8's definition, stated on the badge's own tooltip. |
| `src/participation/contract.ts` | `ParticipationSummary` — the wire shape `src/league-room/**` and `src/account-room/**` value-import. |

**New — the participation read model and the enforcement policy (inside `src/league-service/**`, already gate 17):**

| File | Responsibility |
|---|---|
| `src/league-service/participation.ts` | `completedSeasonsFor`, `participationFor`, `leagueTierComposition`, `stampSeasonCompleteInTx`. The count, the tier, the composition, and the stamp. |
| `src/league-service/enforcement.ts` | `PublicLeagueEnforcementPolicy`, `enforcementAppliesTo`, `tierJoinPrecondition`, `ENFORCEMENT_REFUSALS`. The one place "is this league platform-commissioned?" is answered. |
| `src/league-service/auto-lineup.ts` | `autoSetLineupsForWeek`, `autoSetLineupInTx`, `plannedAutoLineup`, `AutoSetOutcome`. The missed-deadline strategy, applied. |
| `src/league-service/draft-schedule.ts` | `setDraftKickoff`, `draftScheduleView`, `KICKOFF_REFUSALS`. A commissioner choosing a time, and everybody reading it. |

**New — the auto-start (inside `src/draft-service/**`, already gate 18):**

`src/draft-service/auto-start.ts` — `autoStartDueDrafts`, `claimAutoStart`, `AutoStartOutcome`. Scanned by the existing ticker, claimed by a guarded status transition, never by a lock.

**Modified in `src/integrity/**`:** `config.ts` (`INTEGRITY_CONFIG.trade.autoHoldThreshold`, `.participation`, `.enforcement`), `system-actions.ts` (`SYSTEM_ACTION_VISIBILITY` replaces `SYSTEM_ACTION_SUMMARY_ALLOWED`, two new codes), `activity-view.ts` (`renderSystemAction`'s subject check, `renderRosterMove` untouched), `notices.ts` (five new templates), `flags.ts` (`FLAG_TYPES` gains `trade_hold`, `FLAG_SUBJECT_TYPES` gains `held_trade`, `RESOLUTION_DECISIONS` gains `trade_released`/`trade_blocked`, `DECISION_OWNER` gains its `plan-d` arm, `DECISION_WIRED_FOR` gains a column and two rows), `queue-view.ts` (the `held_trade` subject view), `test-support.ts` (`NOTICE_SAMPLES`), `flag-only.test.ts` (`INTEGRITY_DIRS` gains `src/participation`), `copy-rules.ts` (unchanged, exercised harder).

**Modified in `src/integrity-service/**`:** `flags.ts` (`NOTICE_FOR_DECISION`, `NOTE_REACHES_SOMEONE_ELSE`, `DECISION_LABEL`, `subjectFor`/`aboutFor`/`trailFor`'s `held_trade` branches, the two new execution branches), `schemas.ts` (`resolveFlagSchema`'s refine), `lock-order.test.ts` (four new transactions), `reserved.test.ts` (unchanged, and a new assertion that the `"plan-d"` arm stays unused).

**Modified elsewhere:** `src/stats-pipeline/finalize.ts` (the season-completion stamp), `src/stats-pipeline/worker.ts` (the lock-transition trigger), `src/league-service/join.ts` (`publicJoinPrecondition` gains the tier clause; `publicJoinPrecondition` becomes exported), `src/league-service/creation.ts` (the chosen kickoff and the creation-side tier gate), `src/league-service/browse.ts` (`PublicLeagueSummary`'s two new fields), `src/league-service/lineups.ts` (the `teams.league_id` assertion), `src/league-service/trades.ts` (the hold branch), `src/league/terms.ts` (`leagueTerms` gains the draft time), `src/matchmaking/contract.ts` + `filter.ts` + `config.ts` (the participation filter), `src/reviews/contract.ts` (`ReviewView.verified`), `src/review-service/reviews.ts` (the badge's one join), `src/draft-service/ticker.ts` + `index.ts` (the auto-start scan), `src/trades/lifecycle.ts` (`held`), `src/db/schema.ts`, `src/db/index-plans.test.ts`, `src/db/test-corpus.ts` (new; the corpus-realism mechanism), `src/data/seed/**`, `vitest.config.mts`, `eslint.config.mjs`.

**New — routes, pages and components:**

| File | Responsibility |
|---|---|
| `src/app/api/leagues/[leagueId]/draft-schedule/route.ts` | `POST` a commissioner-chosen kickoff time. |
| `src/app/api/leagues/[leagueId]/moderation/route.ts` | `GET` the commissioner's window into platform moderation in their own league. |
| `src/components/app-shell/notices-provider.tsx` | The root-layout provider that ends the remount (ruling 19). |
| `src/league-room/components/draft-schedule-panel.tsx` | The chosen time, the countdown, and the "Start the draft" control. |
| `src/league-room/components/held-trade-banner.tsx` | What both managers see while a trade waits for a human. |
| `src/league-room/components/moderation-summary.tsx` | The commissioner's read-only moderation window. |
| `src/admin-room/components/held-trade-detail.tsx` | The operator's release-or-block surface. |

**New migrations:** `drizzle/0028_season_completion.sql`.

**New docs:** `docs/enforcement.md`, `docs/decisions/enforcement-and-tiers.md`.

**Modified docs:** `docs/conventions.md`, `docs/trades.md`, `docs/advisor.md`, `docs/draft-room.md`, `docs/decisions/audit-and-integrity.md`, `docs/decisions/operators-and-moderation.md`, `docs/decisions/trades-and-fairness.md`, `docs/decisions/identity-and-trust.md`, `docs/decisions/live-scoring-pipeline.md`, `README.md`.

**New e2e:** `e2e/enforcement.spec.ts`.

---

## Task 1: Participation — the third meaning of "tier", and the one stamp that makes it cheap

Everything in Steps 5 and 6 that is about *who a person is* reads from this task. It is first because the two consumers (the browse label and the join gate) are worthless without it and because the naming decision has to be made before a single identifier is typed: `experienceTier` already means two different things in this codebase and Step 6 is about to add a third.

**Files:**
- Create: `src/participation/tier.ts`, `src/participation/composition.ts`, `src/participation/verified.ts`, `src/participation/contract.ts` (+ tests for each)
- Create: `src/league-service/participation.ts` (+ its test), `drizzle/0028_season_completion.sql`, `src/db/test-corpus.ts`
- Modify: `src/db/schema.ts`, `src/stats-pipeline/finalize.ts` (+ its test), `src/integrity/config.ts` (+ its test), `src/db/index-plans.test.ts`, `eslint.config.mjs`, `src/integrity/flag-only.test.ts`

**Interfaces:**
- Consumes: `finalizeWeekInTx`, `checkFinalizeGuards`, `matchups`, `teams`, `leagues`, `INTEGRITY_CONFIG`.
- Produces: `participationTierFor`, `tierCompositionFor`, `isVerifiedPlayer`, `completedSeasonsFor`, `participationFor`, `leagueTierComposition`, `stampSeasonCompleteInTx`, `ParticipationSummary`.

- [ ] **Step 1: Name the three facts, in a test, before anything reads them**

```ts
// src/participation/tier.test.ts
it("shares no vocabulary at all with the two experience_tier columns", () => {
  // The whole point of this file. `users.experience_tier` and `leagues.experience_tier` are both
  // `beginner | experienced`; this is a THIRD fact about a person and reusing either word would
  // guarantee that somebody one day reads a self-reported sign-up answer as a computed
  // participation record and blocks a join on it.
  expect(PARTICIPATION_TIERS).toEqual(["newcomer", "veteran"]);
  expect(PARTICIPATION_TIERS as readonly string[]).not.toContain("beginner");
  expect(PARTICIPATION_TIERS as readonly string[]).not.toContain("experienced");
});

it("is newcomer below the cutoff, veteran at it and above it", () => {
  // The spec's boundary trio, and `>=` on purpose: `crossesFairnessThreshold`'s own reasoning
  // applies unchanged. A cutoff whose exact value can never be reached is a cutoff nobody can
  // configure precisely.
  expect(participationTierFor(2, 3)).toBe("newcomer");
  expect(participationTierFor(3, 3)).toBe("veteran");
  expect(participationTierFor(4, 3)).toBe("veteran");
});

it("treats an account that has never finished anything as a newcomer, not as unknown", () => {
  expect(participationTierFor(0, 3)).toBe("newcomer");
});

it("refuses a negative count rather than classifying it", () => {
  // A count can only come from a `count(*)`, so a negative one means the caller is confused and
  // the honest answer is a throw, not a tier. Fail fast at the boundary.
  expect(() => participationTierFor(-1, 3)).toThrow(/completedSeasons/);
});
```

`PARTICIPATION_TIER_LABEL` is `{ newcomer: "Newcomer", veteran: "Veteran" }` and `PARTICIPATION_TIER_BLURB` carries the one sentence each tier is explained with, so no page composes its own. Both are exhaustive `Record`s over the union.

- [ ] **Step 2: The three cutoffs, on `INTEGRITY_CONFIG`, ordered by a test**

```ts
participation: {
  /**
   * The spec's `EXPERIENCE_TIER_CONTEST_COUNT_CUTOFF`. Completed seasons at or past this and an
   * account is a `veteran` for public-league segregation.
   *
   * THREE (founder decision #7's default, a conservative single-digit number). It is deliberately
   * NOT any state's statutory figure: Tennessee separates under-51 from 500-plus contests and
   * Mississippi marks 1,000-plus, and strategy §4.1 asks for one platform-wide default rather
   * than a state toggle. Those numbers count CONTESTS (a daily-fantasy entry); this product's
   * unit is a season-long league, and three finished seasons is a real fantasy history by any
   * reading. It is config-driven for exactly the reason the spec says: this is the number most
   * likely to need tuning once the platform has a history to tune against.
   *
   * THE GRANDFATHERING RULE IS STRUCTURAL, NOT A SPECIAL CASE. Segregation is enforced at the
   * JOIN, and nowhere else, so nobody already sitting in a league is ever reclassified out of it.
   * No league on this platform has completed a season yet, which means every account is a
   * `newcomer` today and no join is blocked today. That is the mechanism being CORRECT and not
   * yet firing, and `enforcement.test.ts` proves the difference against a seeded veteran rather
   * than leaving it to a reader's confidence.
   */
  veteranSeasonCutoff: 3,
  /**
   * Founder decision #8's default: one completed season in one league is what the review feed's
   * "verified" badge claims, and the badge's own tooltip says so in those words. Necessarily at
   * or below `veteranSeasonCutoff` — an account cannot be experienced enough to segregate and
   * too inexperienced to have played here.
   */
  verifiedSeasonCutoff: 1,
  /**
   * Step 6's rollback, as the spec words it: "tier computed but inert." `false` leaves every
   * label, filter and badge exactly as they are and stops the join gate refusing anybody.
   */
  enforceTierSegregation: true,
},
enforcement: {
  /**
   * Step 5's rollback. `false` stops the auto-set, the auto-hold and the auto-start; it changes
   * nothing about what any of them would have decided, so re-enabling resumes rather than
   * replays. Public leagues fall back to Step 4's review-only behavior, which is what they have
   * today.
   */
  enabled: true,
  /**
   * `REPEAT_PREVIOUS_WEEK` (founder decision #9's default) or `BEST_LEGAL_LINEUP`. The first is
   * predictable and sometimes obviously wrong; the second is better and looks like the platform
   * playing somebody's team. Predictability wins when the platform is acting without consent,
   * and the notice says exactly which one ran.
   */
  missedDeadlineLineupStrategy: "repeat_previous_week" as MissedDeadlineLineupStrategy,
},
```

```ts
// src/integrity/config.test.ts
it("orders all four fairness thresholds, and the fourth is finally a number", () => {
  // Plan C wrote this test with the last comparison skipped, because `autoHoldThreshold` was
  // null. This is the commit where it stops being skipped.
  expect(INTEGRITY_CONFIG.trade.autoHoldThreshold).toBe(35);
  expect(ADVISOR_CONFIG.evenDelta).toBeLessThan(ADVISOR_CONFIG.lopsidedDelta);
  expect(ADVISOR_CONFIG.lopsidedDelta).toBeLessThan(INTEGRITY_CONFIG.trade.fairnessFlagThreshold);
  expect(INTEGRITY_CONFIG.trade.fairnessFlagThreshold).toBeLessThan(INTEGRITY_CONFIG.trade.autoHoldThreshold);
});

it("keeps the verified cutoff at or below the veteran cutoff", () => {
  // An inversion would mean an account the platform segregates as experienced and refuses to
  // call verified, which is two statements about one person that contradict each other.
  expect(INTEGRITY_CONFIG.participation.verifiedSeasonCutoff).toBeLessThanOrEqual(INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
});
```

- [ ] **Step 3: Stamp the season's end where the season ends**

```sql
-- drizzle/0028_season_completion.sql
ALTER TABLE "leagues" ADD COLUMN "season_completed_at" timestamp with time zone;
CREATE INDEX "leagues_season_completed_idx" ON "leagues" ("id") WHERE "season_completed_at" IS NOT NULL;
```

Nullable, no default, no backfill: a league that finished its season before this column existed does not exist, because no league on this platform has finished one. The migration is written by hand rather than generated, and `index-plans.test.ts` asserts the partial predicate is present in `pg_indexes` — `drizzle-kit generate` has silently dropped clauses before (Plan B ruling 17's `INCLUDE` trap), and a partial index that quietly became a full one is a bigger table nobody notices.

```ts
// src/stats-pipeline/finalize.test.ts
it("stamps the league's season complete on the write that scores its last week", async () => {
  const league = await leagueWithSeason(db, { weeks: 3 });
  await finalizeWeek(db, league.id, 1);
  await finalizeWeek(db, league.id, 2);
  expect(await seasonCompletedAt(db, league.id)).toBeNull();

  await finalizeWeek(db, league.id, 3);
  expect(await seasonCompletedAt(db, league.id)).toBe(FIXED_NOW);
});

it("never re-stamps, so a correction to an already-settled week leaves the original date alone", async () => {
  // `correctSettledWeek` re-runs `finalizeWeekInTx` weeks later. A season ended when it ended,
  // and the guard is in the UPDATE's own WHERE, not in a prior read: the same one-way-stamp
  // discipline `reviews.removed_at` and `integrity_flags.resolved_at` already use twice.
  await completeSeason(db, league.id);
  const first = await seasonCompletedAt(db, league.id);
  await correctSettledWeek(db, { weekNumber: 2, operatorUserId: "u_admin" });
  expect(await seasonCompletedAt(db, league.id)).toBe(first);
});

it("does not stamp a league with an unscored week left, however many are done", async () => {
  const league = await leagueWithSeason(db, { weeks: 3 });
  await finalizeWeek(db, league.id, 3);
  await finalizeWeek(db, league.id, 1);
  expect(await seasonCompletedAt(db, league.id)).toBeNull();
});
```

`stampSeasonCompleteInTx(tx, leagueId, occurredAt)` runs at the end of `finalizeWeekInTx`, inside the caller's transaction, and is one statement:

```ts
/**
 * LOCK NOTE, and the reason this is the LAST statement in `finalizeWeekInTx` rather than the
 * first. `joinLeagueInTx` takes `leagues[id] FOR UPDATE` before anything else it does, so a
 * writer that touches `leagues` after `matchups` would be taking the same two rows in the
 * opposite order and could cycle with it. This statement is an `UPDATE … WHERE season_completed_at
 * IS NULL AND NOT EXISTS(unscored matchup)` — it takes a row-exclusive lock on ONE `leagues` row
 * and an implicit `FOR KEY SHARE` on nothing (there is no FK out of `leagues` this touches). The
 * ordering property that keeps it safe is not its position among this function's own statements
 * but the fact that a settlement transaction takes NO other lock that `joinLeagueInTx` also
 * takes: a league whose last week is being scored has a complete draft (`checkFinalizeGuards`),
 * and a league with a complete draft refuses joins at `publicJoinPrecondition` before it locks
 * anything. `lock-order.test.ts` proves it with a real parked `joinLeagueInTx`.
 */
export async function stampSeasonCompleteInTx(tx: DbTx, leagueId: string, occurredAt: string): Promise<boolean>;
```

The `NOT EXISTS` sub-select reads `matchups` for this league where `home_score IS NULL`, which is served by `matchups_unsettled_idx` only when the week is known and is a small per-league scan otherwise. It runs once per settled week per league and never on a read path, so it is measured (Step 6) rather than assumed.

- [ ] **Step 4: The count, the tier and the composition**

```ts
// src/league-service/participation.test.ts
it("counts one completed season per completed league this account has a team in", async () => {
  await seatIn(db, "u_alice", [completedLeagueA, completedLeagueB, unfinishedLeagueC]);
  expect(await completedSeasonsFor(db, "u_alice")).toBe(2);
});

it("reads the tier through the configured cutoff and not through a second copy of the rule", async () => {
  await seatIn(db, "u_alice", [completedLeagueA, completedLeagueB, completedLeagueC]);
  expect(await participationFor(db, "u_alice")).toEqual({ completedSeasons: 3, tier: "veteran", verified: true });
});

it("costs exactly one query, however many leagues the account is in", async () => {
  // The read model is a bounded, indexed count over the account's own teams — never a per-league
  // round trip, and never a rollup row that could disagree with it. `data-layer-hardening.md`'s
  // threshold is unbounded growth, and an account's team count is bounded by the leagues it has
  // joined; the unbounded half (every matchup in the product) is what the stamp removed.
  const counting = countingDb(db);
  await participationFor(counting, "u_alice");
  expect(counting.queryCount).toBe(1);
});

it("names an aggregate and never a member, in the composition", async () => {
  // `PublicLeagueSummary` is the privacy boundary of this product's one unauthenticated read.
  // A composition is two counts; a list of who is a newcomer would be a roster of strangers'
  // inexperience published to anybody with the URL.
  expect(await leagueTierComposition(db, publicLeague.id)).toEqual({ newcomers: 8, veterans: 0 });
});
```

- [ ] **Step 5: `verified`, and what it claims**

`isVerifiedPlayer(completedSeasons, cutoff)` is the pure half; `VERIFIED_BADGE_TOOLTIP` is the sentence founder decision #8 asks for: **"This reviewer finished at least one full season on Commish."** It states the claim rather than implying a broader one, because a badge that says only "Verified" invites every reader to guess what was verified. The badge lands on `ReviewView` in Task 8; the vocabulary lands here so both halves read from one file.

- [ ] **Step 6: The corpus-realism mechanism, extracted rather than re-derived**

Plan B's final review found two of its own gate tests measuring queries production never makes, over a corpus at roughly 2% of a real league's density; Plan C answered it per-assertion (ruling 24) and carried "a corpus-realism mechanism for plan assertions" forward. This is that mechanism, and it is small: the corpus builders currently inlined in `src/db/index-plans.test.ts` move to `src/db/test-corpus.ts` with a documented density contract (twelve teams, a full season of weeks, proposals at a realistic fraction of the cap, a stated leagues-to-rows ratio), and every EXPLAIN assertion in this plan builds from it. Each new assertion is paired with a **mutation proof**: drop the partial predicate, recreate the index without it, and watch the cost assertion redden. An index test that cannot fail is a comment.

```ts
// src/db/index-plans.test.ts
it("serves the completed-season count from teams_user_id_idx, not a leagues scan", async () => {
  await seedRealisticCorpus(db);
  const plan = await explain(db, completedSeasonsQuery(db, "u_alice"));
  expect(plan).toMatch(/Index Scan using teams_user_id_idx/);
  expect(plan).not.toMatch(/Seq Scan on leagues/);
});

it("reddens when leagues_season_completed_idx loses its partial predicate", async () => {
  await seedRealisticCorpus(db);
  await recreateWithoutPredicate(db, "leagues_season_completed_idx");
  await expect(assertCompletedSeasonPlan(db)).rejects.toThrow();
});
```

- [ ] **Step 7: The boundary lists, and commit**

`src/participation` joins three lists in the same commit that creates it: `eslint.config.mjs`'s client-boundary **exempt** set (it is pure, has no Node import, no clock and no database, and `src/league-room/components/browse-card.tsx` needs `PARTICIPATION_TIER_LABEL` as a value), `src/integrity/flag-only.test.ts`'s `INTEGRITY_DIRS` (no function in it may reach an account action — the flag-only contract extends to the directory that decides who is a veteran), and `vitest.config.mts` (Task 11, gate 21).

---

## Task 2: The tier on the browse contract — a default filter and an honest composition label

Step 6 asks for the tier as *"a default, always-visible filter (not opt-in)"* and a *"visible per-league tier composition label"*, extending Phase 1's filter rather than building a parallel one. Both halves land on the same privacy boundary, and that boundary is the point of this task: `PublicLeagueSummary` is the field-by-field contract of this product's one unauthenticated read, and `browse.test.ts` fails if the wire body carries a key it does not name.

**Files:**
- Modify: `src/matchmaking/contract.ts`, `src/matchmaking/filter.ts`, `src/matchmaking/config.ts` (+ their tests)
- Modify: `src/league-service/browse.ts` (+ its test), `src/db/index-plans.test.ts`
- Modify: `src/league-room/components/public-league-list.tsx`, `browse-filters.tsx` (+ their tests), `src/app/browse/page.tsx`

**Interfaces:**
- Consumes: `browseQuery`, `listPublicLeagues`, `normalizeBrowseFilter`, `matchesBrowseFilter`, `leagueTierComposition`, `tierCompositionFor`, `PARTICIPATION_TIER_LABEL`.
- Produces: `PublicLeagueSummary.tierComposition`, `BrowseFilter.participationTier`, `MATCHMAKING_CONFIG.participationTiers`.

- [ ] **Step 1: Write the failing contract tests**

```ts
it("carries the composition as two counts and nothing that names a person", async () => {
  const [summary] = await listPublicLeagues(db, EMPTY_BROWSE_FILTER);
  expect(summary!.tierComposition).toEqual({ newcomers: 6, veterans: 0 });
  expect(Object.keys(summary!)).toEqual([...PUBLIC_LEAGUE_FIELDS]);
});

it("filters on participation tier as a first-class filter, beside the two that already exist", () => {
  const filter = normalizeBrowseFilter({ participationTier: "newcomer" });
  expect(filter.participationTier).toBe("newcomer");
  expect(matchesBrowseFilter(newcomerLeague, filter)).toBe(true);
  expect(matchesBrowseFilter(veteranLeague, filter)).toBe(false);
});

it("defaults to any, so the filter is VISIBLE by default without being APPLIED by default", () => {
  // Step 6 says "default, always-visible" and those are two different properties. Always-visible
  // is a rendering decision (the control is on the page with no disclosure to open); defaulting
  // to `any` is what keeps a browse page from hiding two thirds of the leagues from a visitor
  // who never chose a tier.
  expect(normalizeBrowseFilter({}).participationTier).toBe("any");
});

it("refuses an unknown tier by falling back to any, never by throwing at a stranger", () => {
  expect(normalizeBrowseFilter({ participationTier: "expert" }).participationTier).toBe("any");
});
```

- [ ] **Step 2: One query, not one per league**

The composition is a `GROUP BY` folded into `browseQuery`'s existing `leftJoin(teams)`, not a per-league call to `leagueTierComposition`: the browse page returns up to `MATCHMAKING_CONFIG.maxResults` (48) leagues and 48 round trips on an unauthenticated route is the N+1 `listLeagueActivity`'s own shape exists to refuse. The count each team contributes is derived from that member's completed-season count, which means the query joins `teams` twice — once for the league's own seats, once for the seat-holder's other completed leagues — and that join is the one this task must measure rather than assume.

```ts
it("plans the browse query with the composition join and still uses leagues_public_browse_idx", async () => {
  await seedRealisticCorpus(db, { publicLeagues: 5_000 });
  const plan = await explain(db, browseQuery(db, EMPTY_BROWSE_FILTER));
  expect(plan).toMatch(/leagues_public_browse_idx/);
  expect(plan).not.toMatch(/Seq Scan on leagues/);
});
```

If the measured plan degrades, the composition is computed in a **second** bounded query over the 48 league ids the first returned — two round trips, never forty-nine — and the choice is recorded in the commit body with the measurement that drove it. Deciding this by measurement rather than by preference is the whole content of Plan B's inert-index lesson.

- [ ] **Step 3: The label, in one place**

`TIER_COMPOSITION_LABEL` renders `{ newcomers, veterans }` into the sentence a card shows: **"All newcomers"**, **"Mostly newcomers"**, **"Open to everyone"**. Never a raw ratio and never a percentage, because a browse card is a decision aid and "7 of 12 veterans" is a statistic a visitor has to interpret. The thresholds between the three phrases live in `src/participation/composition.ts` beside the function, not in the component.

- [ ] **Step 4: The surface**

`browse-filters.tsx` gains one `Select` beside the two it already renders, using the same control, the same label idiom and the same `Icon` set — `clover` for newcomer, `crown` for veteran, matching what the tier means rather than inventing a glyph. `public-league-list.tsx` renders the composition label on the card it already builds. Full state coverage (loading, empty, error with an action, success), `inBothThemes`, an axe pass, a keyboard-only walkthrough of filter-then-choose, and 360px. `/browse` is reachable signed out, so every string added here is swept by `room-copy.source.test.ts`, which reads `src/league-room` since Plan C.

- [ ] **Step 5: Commit**

---

## Task 3: The door — enforcement at the join, and the hole the spec never saw

This is the first time this product tells a person "no" to something they asked for by name. Step 6's enforcement is one more clause in `publicJoinPrecondition`, which already answers 404 for a non-public league specifically so a signed-in stranger cannot use it as an existence oracle, and the new clause must not break that discipline.

It is also where this plan finds the gap Step 6 does not contain. Step 6 blocks a `veteran` from joining a `beginner` public league. Nothing in it blocks a `veteran` from **creating** one. A league's `experience_tier` is self-declared by whoever creates it, `publicJoinPrecondition` never runs for the creator, and §4.1's entire premise is that a public league's commissioner is a stranger nobody should trust. A veteran declaring his own public league `beginner` and waiting for newcomers to fill it is the exact abuse the segregation exists to prevent, executed through the one door the segregation does not cover (ruling 6).

**Files:**
- Modify: `src/league-service/join.ts` (+ its test), `src/league-service/creation.ts` (+ its test)
- Create: `src/league-service/enforcement.ts` (+ its test)
- Modify: `src/integrity/notices.ts` (+ its test), `src/integrity/test-support.ts`, `src/integrity/system-actions.ts` (+ its test), `src/integrity-service/lock-order.test.ts`
- Modify: `src/app/api/public/leagues/[leagueId]/join/route.ts` (+ its test), `src/league-room/components/public-league-list.tsx`

**Interfaces:**
- Consumes: `joinLeagueInTx`, `JoinPrecondition`, `participationFor`, `notifyAffectedMember`, `AuditLogger.record`, `INTEGRITY_CONFIG.participation`.
- Produces: `tierJoinPrecondition`, `enforcementAppliesTo`, `PublicLeagueEnforcementPolicy`, `ENFORCEMENT_REFUSALS`, `NoticeContexts.tier_blocked_join`.

- [ ] **Step 1: Write the failing enforcement tests**

```ts
it("blocks a veteran from a beginner public league, and says why without saying what they did wrong", async () => {
  await giveCompletedSeasons(db, "u_vet", 3);
  expect(await joinPublicLeague(deps, { leagueId: beginnerPublic.id, userId: "u_vet" })).toEqual({
    ok: false,
    status: 409,
    reason: "This league is reserved for newer players so everyone starts on a level footing. Browse the open leagues to find one you can join.",
  });
});

it("lets the same account into the same league the moment segregation is off", async () => {
  // Step 6's rollback, exercised rather than described. The tier is still computed, the label is
  // still rendered, and nobody is refused.
  await giveCompletedSeasons(db, "u_vet", 3);
  expect(await joinPublicLeague(depsWith({ enforceTierSegregation: false }), { leagueId: beginnerPublic.id, userId: "u_vet" })).toMatchObject({ ok: true });
});

it("leaves private leagues completely alone, for the identical account and the identical tier", async () => {
  // The spec's matched pair for Step 6. Two leagues, identical in every field but
  // `is_public_matchmade`, one account, two outcomes.
  await giveCompletedSeasons(db, "u_vet", 3);
  expect(await acceptInvite(deps, { code: privateBeginnerInvite, userId: "u_vet" })).toMatchObject({ ok: true });
});

it("answers 404 and not 403 for a league that is not public, exactly as it did before", async () => {
  // The non-oracle discipline, unchanged. The tier clause runs AFTER the public check, so a
  // private league's existence is never confirmed to a stranger by a tier refusal.
  expect(await joinPublicLeague(deps, { leagueId: privateLeague.id, userId: "u_vet" }))
    .toEqual({ ok: false, status: 404, reason: NOT_PUBLIC });
});

it("tells the blocked member once, and not again on a second attempt at the same league", async () => {
  await giveCompletedSeasons(db, "u_vet", 3);
  await joinPublicLeague(deps, { leagueId: beginnerPublic.id, userId: "u_vet" });
  await joinPublicLeague(deps, { leagueId: beginnerPublic.id, userId: "u_vet" });
  expect((await noticesFor(db, "u_vet")).filter((n) => n.noticeType === "tier_blocked_join")).toHaveLength(1);
});

it("writes the block on the PLATFORM chain, because a league nobody joined is not told about it", async () => {
  await joinPublicLeague(deps, { leagueId: beginnerPublic.id, userId: "u_vet" });
  expect(await auditEventsOn(db, beginnerPublic.id)).toHaveLength(0);
  const [event] = await auditEventsOn(db, "platform", "system_action");
  expect(event!.payload).toMatchObject({ action: "tier_blocked_join", subjectUserId: "u_vet" });
  expect(event!.payload.summary).toBeUndefined();
});
```

- [ ] **Step 2: Write the precondition, and keep the ordering that makes it safe**

`publicJoinPrecondition` is module-private today (`join.ts:157`). It becomes exported, and its body gains one clause **after** the public check and **after** the draft-status check, so the two refusals a stranger can already provoke keep their exact shapes and only a caller who has proved the league is public and open ever reaches a tier answer. `JoinPrecondition`'s signature gains the joining `userId` — it takes `(tx, leagueId)` today and cannot ask a question about a person — and `invitePrecondition` (`invites.ts:110`) ignores it, which is the matched pair expressed as a type rather than as a test.

```ts
/**
 * FK LOCK ENUMERATION (Plan C's H2 lesson, binding). This precondition runs inside
 * `joinLeagueInTx`'s transaction, AFTER its `leagues[id] FOR UPDATE`. Its own reads take:
 *   - `leagues` + `drafts`: plain SELECT, no lock beyond the one already held.
 *   - `teams` + `leagues` (the completed-season count): plain SELECT.
 * It takes NO new lock and writes nothing. The block's own notice, audit event and refusal are
 * written by `joinPublicLeague` AFTER the transaction has rolled back, in a separate
 * platform-scoped transaction, because a refused join must not leave a league-chain row behind
 * and because the refusal is what the caller is waiting for.
 */
export const publicJoinPrecondition: JoinPrecondition;
```

The block's record is written after the join transaction unwinds, not inside it: a rolled-back transaction writes nothing, and the platform-scoped `system_action` plus the member's notice belong to a different chain in any case. The dedupe (one notice per user per league) is a bounded read inside that second transaction, against `member_notices` filtered by `(user_id, league_id, notice_type)` over the inbox's own bounded page — the same derive-over-a-bounded-set rule `listNotices` already follows.

- [ ] **Step 3: Close the creation-side hole**

```ts
it("refuses to let a veteran create a public league declared for beginners", async () => {
  // The gate Step 6 does not contain. A creator never passes through
  // `publicJoinPrecondition`, so without this a veteran can build the exact league the
  // segregation exists to keep them out of and then wait for it to fill.
  await giveCompletedSeasons(db, "u_vet", 3);
  expect(await createLeague(deps, { userId: "u_vet", isPublicMatchmade: true, experienceTier: "beginner", ... })).toEqual({
    ok: false,
    status: 409,
    reason: "You have played enough seasons here that you can't open a league reserved for newer players. Open it to everyone instead.",
  });
});

it("lets the same veteran create the same league privately, or publicly for everyone", async () => {
  await giveCompletedSeasons(db, "u_vet", 3);
  expect(await createLeague(deps, { userId: "u_vet", isPublicMatchmade: false, experienceTier: "beginner", ... })).toMatchObject({ ok: true });
  expect(await createLeague(deps, { userId: "u_vet", isPublicMatchmade: true, experienceTier: "experienced", ... })).toMatchObject({ ok: true });
});
```

Both gates read the same `tierJoinPrecondition` predicate from `src/league-service/enforcement.ts`, so the rule exists once. The refusal copy differs because the two moments are different: one person is being turned away from somebody else's league, the other is being told to change one field of their own.

- [ ] **Step 4: `PublicLeagueEnforcementPolicy`, and what it actually is**

```ts
/**
 * The one answer to "is the platform this league's commissioner?" — `is_public_matchmade` AND
 * `INTEGRITY_CONFIG.enforcement.enabled`. Every automated action in this plan asks it and none
 * of them re-derives it, which is what makes the spec's matched public-versus-private pair a
 * property of one function rather than a promise repeated in four places.
 *
 * IT IS NOT A PER-LEAGUE DATABASE FLAG. The spec's rollback says "per-league feature flag", and
 * a boolean column with no UI, no script and no caller that can set it would be the control
 * wired to nothing this phase has refused four times (ruling 17). The per-league axis already
 * exists and is `is_public_matchmade`; the platform axis is one config boolean settable at
 * deploy, exactly the way `autoHoldThreshold` is. Both are tested in both states.
 */
export function enforcementAppliesTo(league: Pick<LeagueRow, "isPublicMatchmade">): boolean;
```

- [ ] **Step 5: The notice, the code, and the copy**

`SYSTEM_ACTION_CODES` gains `tier_blocked_join`, and `SYSTEM_ACTION_VISIBILITY` (Task 4 builds the table; this task adds the row, and the two commits are ordered so neither is ever red) sets it `"hidden"`: nobody in the league needs to know that somebody was turned away at the door, and telling them would publish a stranger's inexperience to twelve people who never met them.

```ts
tier_blocked_join: ({ leagueName }) => ({
  title: "That league is reserved for newer players",
  body: `You asked to join ${leagueName}, which keeps its seats for players who are new to Commish so everyone starts on a level footing. Plenty of leagues are open to everyone, and the browse page lists the ones with seats left right now.`,
}),
```

No em-dash, no en-dash, active voice, and nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms` — and, deliberately, nothing that congratulates the member on being experienced either, because the sentence has to work for somebody who is annoyed.

- [ ] **Step 6: Persona panel — the blocked join**

Veteran, casual, commissioner, first-timer, on the full arc: the browse card that showed the league, the press, the refusal, the notice, and what the page offers instead. The two questions the panel exists to answer: does a blocked member understand *why* without feeling accused, and does the page give them somewhere to go in the same breath. `StatePanelProps.action` is required for exactly this reason and a blocked join is the hardest case in the product to satisfy it honestly.

- [ ] **Step 7: Lock-order entry, and commit**

`lock-order.test.ts` gains the block's platform-scoped write transaction, driven on a second connection against a parked `joinLeagueInTx` holding `leagues[X] FOR UPDATE`, proving the block never waits on the league row it just failed to enter.

---

## Task 4: The auto-set lineup, and the fourth deny-by-default dimension

The spec's missed-deadline handling and the visibility question Plan B pre-decided are one task, because the auto-set is the first league-scoped `system_action` that describes one specific member, and there is nowhere to put it until the dimension exists.

Plan B's pre-decided answer is right in substance and wrong in one word. It says *"what Plan D needs is an actor-scoped path, which is a new visibility, not a new summary"* — and `actor_only` cannot mean anything for a `system_action`, because `actorType: "system"` implies `actorId: null` by construction and `activityRowFor`'s `actor_only` branch compares `event.actorId !== viewer.userId`. The path is **subject**-scoped: the member the action was taken *about*, carried on the payload as `subjectUserId`, checked by the renderer (ruling 8).

**Files:**
- Modify: `src/integrity/system-actions.ts` (+ its test), `src/integrity/activity-view.ts` (+ its test)
- Create: `src/league-service/auto-lineup.ts` (+ its test)
- Modify: `src/stats-pipeline/worker.ts` (+ its test), `src/league-service/lineups.ts` (+ its test)
- Modify: `src/integrity/notices.ts` (+ its test), `src/integrity/test-support.ts`, `src/integrity-service/lock-order.test.ts`

**Interfaces:**
- Consumes: `getLineup`, `defaultLineup`, `startersOf`, `validateLineup`, `isLineupLocked`, `enforcementAppliesTo`, `AuditLogger.record`, `notifyAffectedMember`, `ScoreCache.invalidate`.
- Produces: `SYSTEM_ACTION_VISIBILITY`, `systemActionSummaryAllowed`, `autoSetLineupsForWeek`, `autoSetLineupInTx`, `plannedAutoLineup`, `NoticeContexts.lineup_auto_set`.

- [ ] **Step 1: Collapse the third dimension into the fourth**

```ts
/** Who may see a system action on the member-facing activity feed, decided per action CODE.
 *  `"subject_only"` and not `"actor_only"`: a system action has no actor, by construction. */
export type SystemActionVisibility = "everyone" | "subject_only" | "hidden";

export const SYSTEM_ACTION_VISIBILITY: Readonly<Record<SystemActionCode, SystemActionVisibility>> = {
  stat_week_corrected: "everyone",
  chain_verification_failed: "hidden",
  /**
   * Plan B denied this in advance and named what was needed instead: an actor-scoped path. This
   * is that path, with one correction Plan B could not have made without writing the code — an
   * event with `actorType: "system"` has `actorId: null`, so `ACTIVITY_VISIBILITY`'s `actor_only`
   * branch (which compares `actorId` to the viewer) can never match one. The scope that means
   * something here is the SUBJECT: the manager whose lineup this was. The competitive-sensitivity
   * argument that made `lineup_change` `actor_only` (Plan A ruling 15) is unchanged and is why
   * this is not `"everyone"`: broadcasting one manager's lapse while every manual change stays
   * private would be worse than either.
   */
  lineup_auto_set: "subject_only",
  /**
   * STILL DENIED, and now for a structural reason rather than a provisional one. Plan B denied it
   * because no publisher existed; Plan C left it denied for the same reason. This plan IS the
   * publisher and still denies it, because the hold's `system_action` is written on the PLATFORM
   * chain (ruling 12) and a platform-chain event is never read by `listLeagueActivity` at all.
   * The denial is no longer a decision anybody has to keep making.
   */
  trade_held_for_review: "hidden",
  /** Platform chain, for the same reason. Nobody in a league needs to know who was turned away. */
  tier_blocked_join: "hidden",
  /**
   * ALLOWED, on `stat_week_corrected`'s reasoning exactly: a fact about the league's shared
   * calendar, true for everyone in it, about nobody's conduct. A member whose draft started
   * without a human pressing anything is owed the sentence that says so.
   */
  draft_auto_started: "everyone",
};

/** Derived, never deleted — the three existing consumers see a zero-line diff, the same way
 *  `contentRemovalIsWiredFor` survived `DECISION_WIRED_FOR` in Plan C. */
export function systemActionSummaryAllowed(code: SystemActionCode): boolean;
```

```ts
it("shows an auto-set lineup to the manager it happened to and to nobody else", () => {
  const event = systemActionEvent({ action: "lineup_auto_set", subjectUserId: "u_alice", summary: "We set your lineup for week 4." });
  expect(activityRowFor(event, { userId: "u_alice" }, names)).not.toBeNull();
  expect(activityRowFor(event, { userId: "u_bob" }, names)).toBeNull();
});

it("renders nothing at all for a subject_only action whose payload names no subject", () => {
  // Deny by default on a malformed or tampered payload, the same `return null` the rest of this
  // module holds every renderer to. A missing subject must not mean "show everyone".
  const event = systemActionEvent({ action: "lineup_auto_set", summary: "We set a lineup." });
  expect(activityRowFor(event, { userId: "u_alice" }, names)).toBeNull();
});

it("keeps every previously-decided code exactly where Plan B left it", () => {
  expect(systemActionSummaryAllowed("stat_week_corrected")).toBe(true);
  expect(systemActionSummaryAllowed("chain_verification_failed")).toBe(false);
  expect(systemActionSummaryAllowed("trade_held_for_review")).toBe(false);
});
```

- [ ] **Step 2: Write the failing auto-set tests**

```ts
it("carries last week's chosen lineup into a locked week the manager never opened", async () => {
  await setLineup(db, { leagueId, teamId: alice, weekNumber: 3, slots: aliceWeek3, userId: "u_alice" });
  await lockWeek(db, 4);
  await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });

  expect(await savedLineup(db, alice, 4)).toEqual(aliceWeek3);
  expect((await noticesFor(db, "u_alice"))[0]!.noticeType).toBe("lineup_auto_set");
});

it("leaves a manager who DID set their lineup completely alone", async () => {
  await setLineup(db, { leagueId, teamId: bob, weekNumber: 4, slots: bobWeek4, userId: "u_bob" });
  await lockWeek(db, 4);
  await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });

  expect(await savedLineup(db, bob, 4)).toEqual(bobWeek4);
  expect(await noticesFor(db, "u_bob")).toHaveLength(0);
});

it("writes exactly what the fallback would have derived when there is no previous week", async () => {
  // Week 1. `getLineup` already falls back to the roster through `defaultLineup`, so this is a
  // materialization and not a decision — the same property Plan C's trade lineup freeze has, for
  // the same reason: the platform records a fact rather than choosing a team.
  await lockWeek(db, 1);
  const wouldHaveBeen = await getLineup(db, { teamId: carol, weekNumber: 1, slotConfig });
  await autoSetLineupsForWeek(db, { weekNumber: 1, occurredAt: NOW });
  expect(await savedLineup(db, carol, 1)).toEqual(wouldHaveBeen);
});

it("drops a player who is no longer on the roster and refills the slot legally", async () => {
  // Between week 3 and week 4 a trade moved a starter. Repeating last week's lineup verbatim
  // would start somebody else's player, which `validateLineup` would refuse and which the
  // scoring path would then have to interpret.
  await setLineup(db, { leagueId, teamId: alice, weekNumber: 3, slots: aliceWeek3, userId: "u_alice" });
  await tradeAway(db, alice, "p_rb1");
  await lockWeek(db, 4);
  await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });

  const lineup = await savedLineup(db, alice, 4);
  expect(lineup.map((slot) => slot.playerId)).not.toContain("p_rb1");
  expect(validateLineup({ slotConfig: starterConfig, roster: startersOf(lineup), playerPositions })).toEqual({ valid: true });
});

it("never touches a private league, for the identical unset lineup", async () => {
  // Step 5's matched pair, on the lineup half.
  await lockWeek(db, 4);
  await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });
  expect(await savedLineup(db, privateTeam, 4)).toBeNull();
});

it("does nothing at all while enforcement is off, and leaves no partial state behind", async () => {
  await lockWeek(db, 4);
  await autoSetLineupsForWeek(dbWith({ enabled: false }), { weekNumber: 4, occurredAt: NOW });
  await expectNoAutoSetTookPlace(db, { weekNumber: 4 });
});

it("is idempotent: a second run over the same week writes nothing and notices nobody", async () => {
  // The worker can tick twice across a restart, and two instances can both observe the same
  // transition. The guard is that a team WITH saved rows is skipped, which is the same condition
  // the first run created.
  await lockWeek(db, 4);
  await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: NOW });
  await autoSetLineupsForWeek(db, { weekNumber: 4, occurredAt: LATER });
  expect((await noticesFor(db, "u_alice"))).toHaveLength(1);
});
```

- [ ] **Step 3: Write it, one transaction per league**

```ts
/**
 * The missed-deadline lineup, applied to every public matchmade league at the moment a week
 * locks. ONE TRANSACTION PER LEAGUE, and the reason is Plan A's ruling 3 read literally: a
 * transaction appends to at most one chain, and this runs across every affected league at once.
 * `correctSettledWeek` reached the identical shape for the identical reason and this follows it
 * rather than inventing a second answer — including its failure semantics, where a partial run
 * names the leagues it could not finish by id and reason and is safe to re-run because the
 * per-team guard is the state the first run left.
 *
 * LOCK ORDER, and the FK acquisitions enumerated (Plan C's H2 lesson):
 *   1. `stat_weeks[week] FOR SHARE`  — FIRST, matching `setLineup` and `acceptTrade`, so all
 *      THREE roster-adjacent writers take the same lock in the same position. Here it is doing
 *      the opposite job it does there: this writer requires the week to be LOCKED and holds the
 *      share so `persistTick` cannot advance it out from under the write.
 *   2. `lineup_slots` INSERT  — implicit `FOR KEY SHARE` on `teams`, and through `teams` nothing
 *      further; `lineup_slots` has no other parent.
 *   3. the notice inserts  — implicit `FOR KEY SHARE` on `users` and `leagues`.
 *   4. `audit.record`  — the anchor, ALWAYS last.
 *   5. `attachAuditEvent`  — the one statement permitted after the anchor.
 * Then commit, then `deliverNotice` and the score-cache eviction, both best-effort and both
 * outside the transaction.
 */
export async function autoSetLineupsForWeek(db: Db, input: AutoSetInput): Promise<AutoSetOutcome>;

/** Pure: last week's saved slots plus this week's roster, in, a legal lineup out. No clock, no
 *  database, exhaustive over `MissedDeadlineLineupStrategy`, so adding `best_legal_lineup` later
 *  is a compile error everywhere it is unhandled rather than a silent default. */
export function plannedAutoLineup(input: PlannedAutoLineupInput): readonly RosterSlot[];
```

The strategy switch is exhaustive over `MissedDeadlineLineupStrategy` and ships with `repeat_previous_week` implemented and `best_legal_lineup` **not declared at all**. Declaring a second strategy nobody implements would be the enum value with no implementation that founder decision #5 already refused once for `ACCOUNT_RESTRICTED` (ruling 17). The founder's veto costs one arm in one exhaustive switch.

- [ ] **Step 4: The trigger, on the worker's own transition**

The auto-set runs when a week LOCKS, and the one place that is observable is the ingestion worker's advancement of `stat_weeks.status` out of `scheduled`. It runs **after** that transaction commits, never inside it: `stat_weeks` is keyed on week alone and is not league-scoped at all, which is exactly why `correctSettledWeek` runs its own global `persistTick` before and outside every per-league transaction. A failure is logged and the run is safe to repeat on the next tick, because idempotency comes from the per-team guard rather than from the trigger firing exactly once.

```ts
it("fires once, on the tick that moves the week out of scheduled, and not on the ticks after it", async () => {
  const worker = testWorker(db);
  await worker.tick();                       // week 4 flips to in_progress
  await worker.tick();                       // and stays there
  expect(autoSetCalls).toEqual([{ weekNumber: 4 }]);
});
```

- [ ] **Step 5: Close the `teams.league_id` residual, because this plan is the next writer**

`docs/decisions/audit-and-integrity.md`'s residuals name it: *"`setLineup` never asserts `teams.league_id === input.leagueId`. Pre-existing, and safe only because the route derives both from the session actor rather than from the request body. Recorded so the next writer of a team-scoped mutation adds the check rather than copying the omission."* This plan is that next writer. `autoSetLineupInTx` derives its `teamId` from the league it is iterating and therefore cannot be wrong, and `setLineup` gains the one assertion in the same commit, with a test that drives a team id from another league through it and gets a 404.

- [ ] **Step 6: The copy, and what it must not imply**

```ts
lineup_auto_set: ({ leagueName, week, carriedFrom, changedPlayers }) => ({
  title: `We set your week ${week} lineup for you`,
  body: `Week ${week} kicked off in ${leagueName} before you set a lineup, so we started the same team you started in week ${carriedFrom}.${changedPlayers} You can set your own lineup any week before kickoff, and we will leave it alone when you do.`,
}),
```

Three properties, each deliberate. It says what the platform did and which week it copied, so the manager can check it. It ends with the thing they control, because a notice about something they did not choose should close on something they can. And it never uses the word "missed": `INTEGRITY_CONFIG.notices.accusatoryTerms` does not ban it, and `copyViolations` will pass either way, but a sentence that opens with what somebody failed to do is the failure mode the denylist exists to approximate. `changedPlayers` is a rendered clause from a fixed set (nothing changed; one player named; several named), never free text, so `notices.test.ts` sweeps every sentence this notice can produce rather than one sample of it — the discipline `correctionOutcome` established in Plan B.

- [ ] **Step 7: Lock-order entry, and commit**

`lock-order.test.ts` gains the auto-set transaction: a real parked `persistTick` holding `stat_weeks[4]` on one connection, `autoSetLineupsForWeek` on another, proving it blocks on the week and not on the anchor, and a parked `setLineup` proving the two roster-adjacent writers queue rather than cycle.

---

## Task 5: The auto-hold — a number, a seventh status, and two ways out

Plan C left a seam and a `null`. This task supplies **35** and everything that has to be true for a held trade to be a state a real person can be in without being stuck there forever.

The shape of the transaction is the finding. Plan C's fairness flag has to be written after the accept transaction commits, because the trade is league-scoped and the flag is platform-scoped and one transaction may append to one chain. A **hold** is the opposite case and the constraint pays out instead of costing: nothing happens in the league, so nothing is written to the league's chain, so the hold's `system_action` and the flag that asks about it are **both platform-scoped and commit together** (ruling 12). The auto-hold has no after-commit hole at all.

**Files:**
- Modify: `src/trades/lifecycle.ts` (+ its test), `src/trades/contract.ts`
- Modify: `src/league-service/trades.ts` (+ its test)
- Modify: `src/integrity/flags.ts` (+ its test), `src/integrity/queue-view.ts` (+ its test), `src/integrity/notices.ts` (+ its test), `src/integrity/test-support.ts`, `src/integrity/config.ts`
- Modify: `src/integrity-service/flags.ts` (+ its test), `src/integrity-service/schemas.ts`, `src/integrity-service/trade-fairness.ts`, `src/integrity-service/lock-order.test.ts`
- Create: `src/league-room/components/held-trade-banner.tsx`, `src/admin-room/components/held-trade-detail.tsx` (+ their tests)

**Interfaces:**
- Consumes: `evaluateTradeBeforeExecute`, `applyTradeInTx`, `raiseFlag`, `resolveFlag`, `enforcementAppliesTo`, `notifyAffectedMember`.
- Produces: `TRADE_STATUSES` gains `held`, `FLAG_TYPES` gains `trade_hold`, `FLAG_SUBJECT_TYPES` gains `held_trade`, `RESOLUTION_DECISIONS` gains `trade_released`/`trade_blocked`, `NoticeContexts.trade_held_for_review` / `.trade_blocked`.

- [ ] **Step 1: Write the failing hold tests**

```ts
it("holds a grotesquely lopsided public-league trade instead of executing it", async () => {
  const trade = await openTrade(db, { league: publicLeague, ...GROTESQUELY_LOPSIDED });
  expect(await acceptTrade(db, { tradeId: trade.id, userId: "u_bob", ... }))
    .toMatchObject({ ok: true, outcome: "held" });

  expect((await tradeRow(db, trade.id)).status).toBe("held");
  expect(await ownerTeamOf(db, "p_rb1")).toBe(await teamIdOf(db, "u_alice"));   // nothing moved
  expect((await noticesFor(db, "u_alice"))[0]!.noticeType).toBe("trade_held_for_review");
  expect((await noticesFor(db, "u_bob"))[0]!.noticeType).toBe("trade_held_for_review");
});

it("executes the identical trade in a private league, because the platform is not its commissioner", async () => {
  // Step 5's matched pair, on the trade half. Two leagues identical but for
  // `is_public_matchmade`; one trade; two outcomes.
  const trade = await openTrade(db, { league: privateLeague, ...GROTESQUELY_LOPSIDED });
  expect(await acceptTrade(db, { tradeId: trade.id, userId: "u_bob", ... })).toMatchObject({ ok: true, outcome: "executed" });
});

it("executes a trade between the two thresholds and flags it, exactly as Plan C shipped", async () => {
  // The spec's boundary test. A gap of 25 is past the flag threshold (20) and short of the hold
  // threshold (35): the trade completes and a question is raised, which is Step 3's behavior
  // unchanged.
  const trade = await openTrade(db, { league: publicLeague, gap: 25 });
  expect(await acceptTrade(db, { tradeId: trade.id, userId: "u_bob", ... })).toMatchObject({ ok: true, outcome: "executed" });
  expect(await openFlagsOfType(db, "trade_fairness")).toHaveLength(1);
  expect(await openFlagsOfType(db, "trade_hold")).toHaveLength(0);
});

it("writes the hold and the flag that asks about it in ONE transaction, both on the platform chain", async () => {
  // The property that makes this different from Plan C's after-commit flag: nothing about a held
  // trade is league news, so nothing is appended to the league chain, so there is no second
  // chain to cross and no gap a dying process can leave.
  await acceptTrade(db, { tradeId: trade.id, userId: "u_bob", ... });
  expect(await auditEventsOn(db, publicLeague.id)).toHaveLength(0);
  const [event] = await auditEventsOn(db, "platform", "system_action");
  expect(event!.payload).toMatchObject({ action: "trade_held_for_review", tradeId: trade.id });
  expect(await openFlagsOfType(db, "trade_hold")).toHaveLength(1);
});

it("leaves nothing behind when the flag write fails inside the hold transaction", async () => {
  await expectNoHoldTookPlace(db, () => acceptTrade(dbWithFailingRaise, { tradeId: trade.id, userId: "u_bob", ... }));
  expect((await tradeRow(db, trade.id)).status).toBe("open");
});

it("holds nothing while enforcement is off, however lopsided", async () => {
  const trade = await openTrade(db, { league: publicLeague, ...GROTESQUELY_LOPSIDED });
  expect(await acceptTrade(dbWith({ enabled: false }), { tradeId: trade.id, userId: "u_bob", ... }))
    .toMatchObject({ ok: true, outcome: "executed" });
});
```

- [ ] **Step 2: The seventh status, and why it is one**

`TRADE_STATUSES` gains `held`. Plan C refused a seventh status for the reversal and the reasoning is what makes this one correct rather than inconsistent: a reversed trade **still means accepted** and stamps `reversed_at` beside it, because the acceptance genuinely happened and the league chain says so. A held trade means neither open nor settled — nobody may accept it, withdraw it or reject it, and no roster moved. `nextStatusFor` and `transitionIsLegal` are exhaustive over the union, so the legal transitions are declared rather than implied: `open → held`, `held → accepted` (a release), `held → blocked`. `held` is not terminal and `blocked` is.

```ts
it("refuses every ordinary lifecycle move on a held trade, one test per verb", async () => {
  const held = await heldTrade(db);
  for (const attempt of [withdrawTrade, rejectTrade, acceptTrade]) {
    expect(await attempt(db, { tradeId: held.id, userId: "u_alice", ... }))
      .toEqual({ ok: false, status: 409, reason: "This trade is waiting on a fairness review, so it can't change right now." });
  }
});

it("supersedes a held trade when another trade moves one of its players, and tells both parties", async () => {
  // A held trade is not immune to the world moving on. It dies the same way an open one does,
  // and `superseded` still says the true thing: nobody declined it.
  const held = await heldTrade(db, { gives: ["p_rb1"] });
  await acceptTrade(db, { tradeId: (await openTrade(db, { gives: ["p_rb1"] })).id, userId: "u_bob", ... });
  expect((await tradeRow(db, held.id)).status).toBe("superseded");
  expect(await openFlagsOfType(db, "trade_hold")).toHaveLength(0);   // the question died with it
});
```

- [ ] **Step 3: The queue's new subject, and the two decisions that resolve it**

`FLAG_TYPES` gains `trade_hold`, `FLAG_SUBJECT_TYPES` gains `held_trade`, `SUBJECT_OF.trade_hold` is `"held_trade"`, and `RESOLUTION_DECISIONS` gains `trade_released` and `trade_blocked`. `DECISION_WIRED_FOR` — the two-axis exhaustive `Record` Plan C built precisely so a new subject is a column and a new decision is a row — gains all of it, and every cell is a compile-forced answer:

| | `review` | `chat_message` | `account_pair` | `trade` | `held_trade` |
|---|---|---|---|---|---|
| `no_action` | true | true | true | true | **false** |
| `warned_user` | true | true | false | true | **false** |
| `content_removed` | true | true | false | false | **false** |
| `trade_reversed` | false | false | false | true | **false** |
| `trade_released` | false | false | false | **false** | **true** |
| `trade_blocked` | false | false | false | **false** | **true** |

`no_action` is `false` for a `held_trade` and that cell is the whole reason two new decisions exist rather than one. `no_action`'s own docblock says it notices nobody *because nothing happened*, and `NOTICE_FOR_DECISION.no_action` is `null` on that basis. Using it to release a frozen trade would make the one decision that means "nothing happened" perform a roster mutation and notify two people, which is a lie in a table this codebase reads as documentation. `trade_reversed` is `false` for the same class of reason: a held trade never executed, and Plan C's own `superseded`-is-not-`rejected` ruling is the precedent — *a manager who sees the wrong word will draw a conclusion that is simply false*.

`DECISION_OWNER` gains its `"plan-d"` arm (typed `"plan-b" | "plan-c"` today) and both new decisions are owned by it and **wired in this same plan**, because there is no Plan E to reserve them for.

- [ ] **Step 4: Release and block**

```ts
it("releases a held trade by executing it, then resolves the flag, in that order", async () => {
  // TWO transactions, and the order is chosen by which failure is recoverable. The execution is
  // league-scoped (`trade_accepted` + `roster_move`); the resolution is platform-scoped
  // (`flag_resolved`). A process dying between them leaves an executed trade with an open flag,
  // which an operator resolves again — and the second attempt is safe because the execution is
  // guarded on `status = 'held'` and `raiseFlag`'s open-subject index makes the flag unique.
  // The other order would leave a resolved flag over a trade that never executed: a decision
  // recorded and never carried out, which nobody would ever discover.
  const held = await heldTrade(db);
  expect(await resolveFlag(db, { flagId: held.flagId, decision: "trade_released", note: "", operator })).toMatchObject({ ok: true });

  expect((await tradeRow(db, held.id)).status).toBe("accepted");
  expect(await ownerTeamOf(db, "p_rb1")).toBe(await teamIdOf(db, "u_bob"));
  expect((await noticesFor(db, "u_alice"))[0]!.noticeType).toBe("trade_executed");
});

it("blocks a held trade without moving anything, and tells both managers in the same words", async () => {
  const held = await heldTrade(db);
  await resolveFlag(db, { flagId: held.flagId, decision: "trade_blocked", note: "Both teams belong to one person.", operator });

  expect((await tradeRow(db, held.id)).status).toBe("blocked");
  expect(await ownerTeamOf(db, "p_rb1")).toBe(await teamIdOf(db, "u_alice"));
  expect(await noticeBody(db, "u_alice", "trade_blocked")).toBe(await noticeBody(db, "u_bob", "trade_blocked"));
});

it("refuses to release a trade the world has moved past, and says what changed", async () => {
  // The same forward-only discipline the reversal has. A held trade whose player has since moved
  // cannot be executed, and the operator is told which player rather than getting a 500.
  const held = await heldTrade(db, { gives: ["p_rb1"] });
  await tradeAway(db, alice, "p_rb1");
  expect(await resolveFlag(db, { flagId: held.flagId, decision: "trade_released", note: "", operator }))
    .toEqual({ ok: false, status: 409, reason: expect.stringContaining("has already moved to another team") });
  await expectNoReleaseTookPlace(db, held);
});

it("carries the operator's own words to both managers when a trade is blocked", async () => {
  // `NOTE_REACHES_SOMEONE_ELSE.trade_blocked` is true, so the accusatory-terms guard runs on it —
  // the same guard `trade_reversed`'s note already passes through.
  expect(await resolveFlag(db, { flagId: held.flagId, decision: "trade_blocked", note: "This looks like cheating.", operator }))
    .toEqual({ ok: false, status: 422, reason: expect.stringContaining("cheating") });
});
```

`NOTICE_FOR_DECISION` gains `trade_released: null` (the execution sends `trade_executed` to both, exactly as `acceptTrade` does, so a generic third notice would tell one of them twice — `trade_reversed`'s existing reasoning, applied unchanged) and `trade_blocked: null` (the block path sends its own to both). `DECISION_LABEL` gains "released" and "blocked" so a second operator's 409 never prints a raw token.

- [ ] **Step 5: What both managers see while they wait**

```ts
trade_held_for_review: ({ leagueName, counterpartyTeamName }) => ({
  title: "Your trade is waiting on a fairness review",
  body: `Your trade with ${counterpartyTeamName} in ${leagueName} is on hold while somebody at Commish looks at it. Public leagues get a second pair of eyes on trades this lopsided, and neither roster changes until that finishes. We will tell you both as soon as there is an answer.`,
}),
trade_blocked: ({ leagueName, counterpartyTeamName }) => ({
  title: "Your trade will not go through",
  body: `After the fairness review, your trade with ${counterpartyTeamName} in ${leagueName} will not go ahead, and both rosters stay exactly as they were. You can put together a different offer any time.`,
}),
```

"somebody at Commish looks at it" rather than "is under investigation"; "this lopsided" rather than "suspicious". The held-trade banner on the trades page says the same thing in the same words, because a member reading two different sentences about one fact concludes that one of them is a euphemism.

**Founder decision #10, as shipped, with one correction.** The default reads *"no expiry, but the held trade is visible to both parties with its status and stays at the top of Plan B's queue."* The first two halves ship. The third cannot: `operators-and-moderation.md` §3 rules the queue is oldest-first with **no severity sort and no bulk action**, and a held trade is exactly the kind of urgent-feeling row a severity sort would be introduced for. It takes its place by age like every other flag, and the property that makes that acceptable is that the flag is raised at the moment of the hold, so a held trade is never behind anything raised after two people were left waiting (ruling 14).

- [ ] **Step 6: The operator's surface**

`held-trade-detail.tsx` shows what the operator needs and nothing else: both sides in full through `PositionBadge` and `Sticker`, the gap and both side values with the `basis` label Plan C's evidence already carries, the two managers' join dates and league history, the audit trail from `trailFor`, and two buttons. An operator surface is a user-visible surface (Plan B ruling 27), so it gets the full state coverage, the axe pass, the keyboard walkthrough and 360px. The two buttons are the only irreversible pair in the operator product and get the same 360px spacing test Plan C gave accept-and-decline.

- [ ] **Step 7: Persona panel — the held trade**

Both sides of it, because there are two audiences and their fears do not overlap. The managers: two people who agreed on something and were told to wait, one of whom may be entirely innocent and the other of whom may be the reason. The operator: a person deciding whether to overrule two adults about their own teams, on the strength of a number.

- [ ] **Step 8: Lock-order entry, and commit**

`lock-order.test.ts` gains the hold transaction and the release's two, with the FK acquisitions enumerated for each — the hold's `integrity_flags` insert takes `FOR KEY SHARE` on `leagues`, and the release re-enters `applyTradeInTx`'s full lock set, which is already proved.

---

## Task 6: The commissioner's clock — a time somebody chose, and a button that finally exists

`drafts.kickoff_at` has been in the schema since Phase 1, has never been chosen by a human, has never been rendered on any page, and is compared to the current time by nothing. `POST /api/drafts/[draftId]/start` has been correct and commissioner-only since Phase 1 and is called by no UI in the product. Phase 2's persona panel filed the consequence as a product gap: *"a joiner cannot learn when the draft is."*

This is Step 5's premise applied to the most mechanical commissioner function there is, and it is two tasks: the human half here, the platform half in Task 7.

**Files:**
- Create: `src/league-service/draft-schedule.ts` (+ its test), `src/app/api/leagues/[leagueId]/draft-schedule/route.ts` (+ its test)
- Create: `src/league-room/components/draft-schedule-panel.tsx` (+ its test)
- Modify: `src/league-service/creation.ts` (+ its test), `src/league/terms.ts` (+ its test), `src/league-room/components/league-terms-panel.tsx`, `league-home.tsx`, `src/matchmaking/contract.ts`, `src/league-service/browse.ts`
- Modify: `src/app/app/leagues/[leagueId]/page.tsx`, `src/app/app/join/[code]/page.tsx`, `src/app/browse/page.tsx`

**Interfaces:**
- Consumes: `LEAGUE_CONFIG.defaults`, `drafts.kickoffAt`, `getDraftStore().startDraft`, `leagueTerms`, `LeagueTermsPanel`, `requireLeagueMember`.
- Produces: `setDraftKickoff`, `draftScheduleView`, `KICKOFF_REFUSALS`, `LeagueTerms.draftAt`, `PublicLeagueSummary.draftAt`.

- [ ] **Step 1: Write the failing schedule tests**

```ts
it("takes the commissioner's chosen time at creation instead of computing one", async () => {
  const league = await createLeague(deps, { userId: "u_alice", kickoffAt: "2026-09-12T23:00:00.000Z", ... });
  expect(await kickoffOf(db, league.id)).toBe("2026-09-12T23:00:00.000Z");
});

it("still computes a default when no time is chosen, so nothing that exists today breaks", async () => {
  // `kickoffAt` is optional at the boundary, and the fallback is the same
  // `LEAGUE_CONFIG.defaults.draftDaysFromCreation` arithmetic creation.ts has used since Phase 1.
  // The seeds, the integration pipeline and every existing caller are unchanged.
  const league = await createLeague(deps, { userId: "u_alice", ... });
  expect(await kickoffOf(db, league.id)).toBe(addDays(FIXED_NOW, LEAGUE_CONFIG.defaults.draftDaysFromCreation));
});

it("lets the commissioner move the time while the draft is still scheduled", async () => {
  expect(await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: LATER })).toMatchObject({ ok: true });
});

it("refuses to move it once the draft has started, and says why", async () => {
  await startDraft(db, draftId);
  expect(await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: LATER }))
    .toEqual({ ok: false, status: 409, reason: "This draft has already started, so its time can't change." });
});

it("refuses a time in the past", async () => {
  expect(await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: YESTERDAY }))
    .toEqual({ ok: false, status: 422, reason: "Pick a time in the future so everyone has a chance to show up." });
});

it("refuses a time further out than the clock schedule can describe", async () => {
  // `DRAFT_CLOCK_SCHEDULE`'s widest tier is 168 hours before kickoff. A draft scheduled a year
  // out is not wrong, but the pick clock would sit at eight hours for eleven months and the
  // product would be describing a tier nobody experiences. The ceiling is
  // `LEAGUE_CONFIG.defaults.maxDraftDaysFromCreation`, and the refusal names it.
  expect(await setDraftKickoff(db, { leagueId, userId: commissioner, kickoffAt: NEXT_YEAR }))
    .toEqual({ ok: false, status: 422, reason: expect.stringContaining("60 days") });
});

it("answers 404 to a member who is not the commissioner, never 403", async () => {
  // Third application of the non-oracle discipline in this plan, and the shape `withAdmin` and
  // `publicJoinPrecondition` already use.
  expect(await setDraftKickoff(db, { leagueId, userId: ordinaryMember, kickoffAt: LATER }))
    .toMatchObject({ ok: false, status: 404 });
});
```

- [ ] **Step 2: Surface the time everywhere a prospect decides**

`leagueTerms` (`src/league/terms.ts`) is already rendered on the invite preview **and** on league home, and it is already the one place a prospect reads what they are joining. The draft time is one more field on it, which means three surfaces gain it with no new component: `LeagueTermsPanel`, the invite preview (reachable signed out), and league home. `PublicLeagueSummary` gains `draftAt` as its tenth field, which is a change to the privacy boundary and is therefore a decision rather than an addition: a draft time is a scheduling fact about a league and not a fact about any person in it, and a visitor who cannot see it cannot tell whether they are able to attend (ruling 15).

Rendering is one shared helper, not three: the same absolute-plus-relative format (`Saturday 12 September, 7:00 PM your time`) in all three places, with the absolute time first because a relative-only string is useless to somebody deciding whether they are free. It lives in `src/league/terms.ts` beside the field, never in a component, and the clock comes in as a prop from the server so `new Date()` never appears in a `.tsx` file — the one violating line Plan C's fix wave removed and this plan does not reintroduce.

- [ ] **Step 3: The button that has existed for two phases**

`draft-schedule-panel.tsx` renders, for a commissioner, the chosen time, the countdown, an edit control while the draft is `scheduled`, and **"Start the draft"** calling `POST /api/drafts/[draftId]/start` — the route that has been correct since Phase 1 and reachable only by curl. For an ordinary member it renders the time and the countdown and no controls. For a public matchmade league it also renders the one sentence that makes Task 7 honest: **"If nobody starts it, we will start it at the scheduled time."**

The panel's states: scheduled with a time, scheduled and starting within the hour, in progress with a link into the room, complete. Every one designed; `StatePanelProps.action` satisfied on each; `inBothThemes`; axe; keyboard-only walkthrough of choose-time-then-start; 360px.

- [ ] **Step 4: Persona panel — the draft everyone is planning around**

Commissioner, veteran, casual, first-timer. The questions: can a commissioner tell what happens if they do nothing, does a joiner learn the time before committing, and does the countdown read as informative rather than as pressure. The first-timer's question is the sharp one: *"Do I have to be there?"* — and the panel decides whether the auto-pick that already exists (`draft_auto_picked`, live since Plan A) is mentioned here or only in the room.

- [ ] **Step 5: Commit**

---

## Task 7: The platform presses start

A public matchmade league has nobody who will reliably press the button Task 6 just built. This is the most mechanical platform-owned commissioner function there is, and it is the one place in this plan that is genuinely a scheduler.

**Files:**
- Create: `src/draft-service/auto-start.ts` (+ its test)
- Modify: `src/draft-service/ticker.ts` (+ its test), `src/draft-service/index.ts`, `src/draft-service/config.ts`
- Modify: `src/integrity/system-actions.ts`, `src/integrity/notices.ts` (+ their tests), `src/integrity/test-support.ts`
- Modify: `src/integrity-service/lock-order.test.ts`

**Interfaces:**
- Consumes: `DraftStore.startDraft`, `drafts.kickoffAt`, `drafts_status_idx`, `enforcementAppliesTo`, `AuditLogger.record`, `notifyAffectedMember`, `publishDraftEvent`.
- Produces: `autoStartDueDrafts`, `claimAutoStart`, `AutoStartOutcome`, `NoticeContexts.draft_auto_started`.

- [ ] **Step 1: Write the failing auto-start tests**

```ts
it("starts a public matchmade draft whose kickoff has passed", async () => {
  const draft = await scheduledDraft(db, { public: true, kickoffAt: MINUTE_AGO });
  await autoStartDueDrafts(db, { store, clock: fixedClock(NOW) });
  expect(await draftStatus(db, draft.id)).toBe("in_progress");
});

it("leaves a private league's draft for its commissioner, however late they are", async () => {
  // Step 5's matched pair, on the scheduling half. A private league trusts a friend; that is the
  // whole premise, and a platform that starts their draft for them has taken the decision away.
  const draft = await scheduledDraft(db, { public: false, kickoffAt: WEEK_AGO });
  await autoStartDueDrafts(db, { store, clock: fixedClock(NOW) });
  expect(await draftStatus(db, draft.id)).toBe("scheduled");
});

it("does not start a draft whose kickoff is still ahead", async () => {
  const draft = await scheduledDraft(db, { public: true, kickoffAt: IN_AN_HOUR });
  await autoStartDueDrafts(db, { store, clock: fixedClock(NOW) });
  expect(await draftStatus(db, draft.id)).toBe("scheduled");
});

it("refuses to start a league that cannot draft, and says which, rather than throwing", async () => {
  // An empty league, or one seat filled. `startDraft` builds an order from the team rows, and a
  // one-team draft is a draft nobody can lose. The refusal is an outcome, logged and re-tried on
  // the next tick, never an exception that stops the scan for every other league.
  const draft = await scheduledDraft(db, { public: true, kickoffAt: MINUTE_AGO, teams: 1 });
  expect(await autoStartDueDrafts(db, { store, clock: fixedClock(NOW) }))
    .toEqual([{ draftId: draft.id, started: false, reason: expect.stringContaining("enough managers") }]);
});

it("starts exactly once when two instances scan the same due draft at the same moment", async () => {
  // The property that matters, and the only one PgBouncer transaction pooling makes hard: no
  // advisory lock is available, so exclusion has to come from the write itself.
  const draft = await scheduledDraft(db, { public: true, kickoffAt: MINUTE_AGO });
  const [a, b] = await Promise.all([
    autoStartDueDrafts(dbOne, { store: storeOne, clock: fixedClock(NOW) }),
    autoStartDueDrafts(dbTwo, { store: storeTwo, clock: fixedClock(NOW) }),
  ]);
  expect([a, b].flat().filter((outcome) => outcome.started)).toHaveLength(1);
  expect(await draftActionsOfType(db, draft.id, "START_DRAFT")).toHaveLength(1);
});

it("does nothing at all while enforcement is off", async () => {
  const draft = await scheduledDraft(db, { public: true, kickoffAt: MINUTE_AGO });
  await autoStartDueDrafts(dbWith({ enabled: false }), { store, clock: fixedClock(NOW) });
  await expectNoAutoStartTookPlace(db, draft);
});
```

- [ ] **Step 2: Claim, do not lock**

```ts
/**
 * WHY THERE IS NO LOCK. `docs/decisions/data-layer-hardening.md` forbids `pg_advisory_lock` under
 * PgBouncer transaction pooling, so leader election among app instances is unavailable by
 * construction, and `instrumentation.ts`'s ticker is a per-process `setInterval` with no
 * coordination beyond a non-overlap guard inside one process. Exclusion therefore comes from the
 * WRITE, on the precedent this codebase already has: the nudger claims a nudge with a
 * `draft_nudges` row on `(draftId, pickNumber)` and `onConflictDoNothing().returning()`, and an
 * empty return means somebody else got there first (`src/draft-service/nudge.ts:67-72`).
 *
 * The claim here is the guarded status transition itself:
 *
 *     UPDATE drafts SET status = 'in_progress'
 *      WHERE id = $1 AND status = 'scheduled'
 *      RETURNING id
 *
 * Zero rows means another instance already started it, and this instance returns
 * `{ started: false, reason: "already started" }` without touching the action log. One row means
 * this instance owns the start, and `store.startDraft` appends `START_DRAFT` inside the same
 * transaction — which is why the claim is a precondition INSIDE `startDraft`'s own transaction
 * and not a separate round trip before it. `drafts_league_id_idx` (unique on `league_id`) and
 * this guard together are what make the whole scan safe to run on every instance every tick.
 *
 * FK LOCK ENUMERATION: the `UPDATE` takes a row-exclusive lock on one `drafts` row and an
 * implicit `FOR KEY SHARE` on its `leagues` parent. `draft_actions`' insert takes `FOR KEY SHARE`
 * on `drafts`. The notices take `FOR KEY SHARE` on `users` and `leagues`. The anchor is last.
 * `joinLeagueInTx` takes `leagues FOR UPDATE` first, so the two are ordered leagues-then-drafts in
 * both directions and cannot cycle; `lock-order.test.ts` parks a real join and proves it.
 */
export async function claimAutoStart(tx: DbTx, draftId: string): Promise<boolean>;
```

- [ ] **Step 3: The scan, on the ticker that already exists**

`autoStartDueDrafts` is one bounded query — `drafts` where `status = 'scheduled' AND kickoff_at <= now`, joined to `leagues` on `is_public_matchmade`, limited by `DRAFT_SERVICE_CONFIG.maxDraftsPerTick` and ordered by `id` for the same determinism reason the expiry scan is. It is served by `drafts_status_idx`, which exists and is currently used by exactly one query; this is its second reader, and the EXPLAIN assertion over the realistic corpus proves it stays an index scan with the new predicate rather than degrading to a filter.

It hangs off the existing ticker rather than a third `setInterval`:

```ts
async function tick(): Promise<readonly TickOutcome[]> {
  // Auto-start FIRST, then the expiry scan, so a draft this tick starts gets its first clock
  // checked on the NEXT tick rather than being expired a millisecond after it began. One second
  // of latency at the start of a draft nobody is watching yet, against the alternative of a
  // reducer being asked to expire a turn that has not begun.
  const started = await autoStartDueDrafts(...);
  ...
}
```

`DRAFT_SERVICE_CONFIG` gains nothing: the interval, the per-tick cap and the warn interval are the ones the ticker already has, and adding a second cadence for a scan that shares a connection pool with the first would be two numbers to keep in step.

- [ ] **Step 4: The record and the notice**

`SYSTEM_ACTION_CODES` gains `draft_auto_started`, `SYSTEM_ACTION_VISIBILITY` sets it `"everyone"` on `stat_week_corrected`'s reasoning (a fact about the league's shared calendar, true for everyone, about nobody's conduct), and the `system_action` is **league**-scoped — the first automated action in this plan that is, and the sentence from `operators-and-moderation.md` §5 is why: *a record about a consequence the league already sees is* the league's business, and every member is about to be in a draft room.

```ts
draft_auto_started: ({ leagueName }) => ({
  title: `Your draft in ${leagueName} has started`,
  body: `The draft reached its scheduled time, so we started it. Head to the draft room now, or let the clock queue your picks if you cannot make it. We will tell you when it is your turn.`,
}),
```

Every member gets one, in the same transaction as the `system_action`, and the existing `draft.status` realtime frame publishes after commit exactly as `startDraft` already does. The notice is the durable half and the frame is the live half; neither is a second transport.

- [ ] **Step 5: The scheduler question, reconciled honestly**

Two schedulers are named across this codebase's plans and they belong to two different phases, which is why `INTEGRITY_CONFIG` and `scripts/verify-audit-chain.ts` both spell out "Phase 2 Plan D" in full rather than saying "Plan D".

- **The full audit-chain walk is Phase 2 Plan D's**, not this plan's. `INTEGRITY_CONFIG.verification.fullVerifyIntervalHours` (24) is *"the number a production scheduler is configured with, and Phase 2 Plan D is the plan that has one"*; the interim control is the operator runbook line in `scripts/verify-audit-chain.ts`'s own docblock; and Plan A's documented floor — an unverified chain's tail deletion plus anchor rewind is undetectable, so **first-verification-per-chain is the requirement** — is a floor about coverage, not cadence.
- **This plan does not adopt it onto its ticker**, and the reasoning is recorded rather than assumed (ruling 23): the walk is unbounded work with an operator-facing report, the ticker is a per-process singleton with no leader election, and running a full walk on every instance every 24 hours would be duplicated unbounded reads against the one table the whole trust model rests on. A claim row would fix the duplication and would leave an integrity job depending on a dev worker's liveness, which is a worse property than the runbook it replaced.
- **What this plan does owe** is the coverage half: every chain its seed and its e2e create is a new chain, and Task 11's `audit:verify --full` is where each gets its first verification.

- [ ] **Step 6: Lock-order entry, and commit**

---

## Task 8: Two windows — the verified badge, and the commissioner's view of moderation in their own league

Both are read-model and visibility work over data that already exists, and both are items this phase carried by name. They share a task because they share a shape: somebody is shown something true about somebody else, and the whole question is how much.

**Files:**
- Modify: `src/reviews/contract.ts`, `src/review-service/reviews.ts` (+ its test), `src/account-room/components/review-feed.tsx` (+ its test)
- Create: `src/app/api/leagues/[leagueId]/moderation/route.ts` (+ its test), `src/league-room/components/moderation-summary.tsx` (+ its test)
- Modify: `src/integrity-service/flags.ts` (+ its test), `src/app/app/leagues/[leagueId]/page.tsx`

**Interfaces:**
- Consumes: `participationFor`, `isVerifiedPlayer`, `listReviews`, `requireLeagueMember`, `integrityFlags`, `chatMessages.removedAt`, `reviews.removedAt`.
- Produces: `ReviewView.verified`, `leagueModerationSummary`, `ModerationSummaryView`.

- [ ] **Step 1: The badge, and the one join it costs**

```ts
it("marks a reviewer verified when they have finished a season here", async () => {
  await giveCompletedSeasons(db, "u_alice", 1);
  const [review] = (await listReviews(db, {})).reviews;
  expect(review!.verified).toBe(true);
});

it("marks a signed-in account that has never played here unverified, and says nothing else about them", async () => {
  // The badge's whole content is one boolean. It never carries the count, because "3 seasons"
  // on a public feed is a fact about a stranger that nobody asked them to publish.
  const [review] = (await listReviews(db, {})).reviews;
  expect(review!.verified).toBe(false);
  expect(Object.keys(review!)).toEqual([...REVIEW_VIEW_FIELDS]);
});

it("costs one extra query for a whole page of reviews, never one per review", async () => {
  // `listReviews` already makes two round trips (the page, then the display-only rating lookup).
  // This is a third, batched over the page's distinct author ids — the same shape
  // `listLeagueActivity`'s three batched name lookups use, and for the same reason.
  const counting = countingDb(db);
  await listReviews(counting, {});
  expect(counting.queryCount).toBe(3);
});
```

`VERIFIED_BADGE_TOOLTIP` is rendered through the existing `InfoTip` (click-activated, AA target size, `helpLevel`-aware) rather than a `title` attribute, because a claim a reader has to hover to understand is a claim most readers never understand.

- [ ] **Step 2: The commissioner's window**

Plan B's Task 6 persona panel raised it as a MEDIUM and Plan B ruled it out of its own scope by name: *"league-commissioner moderation visibility is a NEW surface, not T6 member-path scope — Plan D (enforcement/tiers) owns the commissioner console question."* Today a commissioner has **zero** visibility of platform moderation in their own league: the activity band filters to the member's own notices, removals are tombstoned in place without saying who acted, and the operator's record is on the platform chain where no member can reach it.

The window is deliberately narrow, and each line of it is a decision:

```ts
it("tells the commissioner how many messages and reviews the platform removed in their league, and when", async () => {
  expect(await leagueModerationSummary(db, { leagueId, userId: commissioner })).toEqual({
    removedMessages: 2,
    removedReviews: 0,
    mostRecentAt: "2026-08-19T14:02:00.000Z",
    openQuestions: 1,
  });
});

it("never names who was moderated, what they said, or why", async () => {
  // The boundary. A commissioner is a member with extra buttons, not an operator: Plan B's
  // founder decision #3 shipped "operator only" for removal and this does not reopen it. The
  // removal reason reaches the author's own notice and nobody else (Plan B's wire-level HIGH),
  // and a count is what tells a commissioner their league is being looked after without
  // publishing a member's worst afternoon to the person who runs their league.
  const summary = await leagueModerationSummary(db, { leagueId, userId: commissioner });
  expect(JSON.stringify(summary)).not.toContain("u_bob");
  expect(Object.keys(summary)).toEqual([...MODERATION_SUMMARY_FIELDS]);
});

it("answers 404 to an ordinary member of the same league", async () => {
  expect(await leagueModerationSummary(db, { leagueId, userId: ordinaryMember })).toBeNull();
});

it("counts open questions without saying what they are about", async () => {
  // `openQuestions` is the number of unresolved `integrity_flags` scoped to this league. It is a
  // count and never a list, for the identical reason: an open flag is a question about a person
  // and `ACTIVITY_VISIBILITY.flag_raised` is `hidden` on that basis. What the commissioner gains
  // is the knowledge that something is in hand, which is the entire complaint the panel raised.
  expect((await leagueModerationSummary(db, { leagueId, userId: commissioner })).openQuestions).toBe(1);
});
```

`moderation-summary.tsx` renders it on league home under one sentence that says what it is and what it deliberately is not: **"Commish reviews reports in every league. We keep the details between the people involved and our operators."** Four counts and a date, or an empty state saying nothing has needed attention — which is a real state and, on a healthy league, the only one anybody ever sees, so it gets designed first rather than last.

- [ ] **Step 3: Persona panel — the badge and the window**

The commissioner and the casual member on the moderation window (does a count reassure or alarm?), and the veteran and the first-timer on the badge (does an unverified review read as untrustworthy, and is that what we mean?). The badge's persona risk is the sharper one and it is the reason the tooltip states the claim rather than the status.

- [ ] **Step 4: Commit**

---

## Task 9: The notices remount, fixed where the render tree actually allows it

Plan C's final review ledgered this as MEDIUM 6 and Plan C took a stopgap and said so: `INTEGRITY_CONFIG.notices.rateLimit` went from 30 to 120, with the arithmetic written into its own docblock and a row in the overview's carried-items table that stays open **"until the layout does."** This task closes it, and it closes it somewhere other than where the ledger guessed.

**The ledger's fix shape does not survive contact with the route tree.** It proposes *"a shared `src/app/app/layout.tsx` rendering `AppHeader` once, above the page subtree."* Two pages under `/app` deliberately do not render `AppHeader` and cannot be made to: the draft room (`src/app/app/drafts/[draftId]/page.tsx`, whose `RoomRail` **is** its header under a no-page-scroll contract) and the invite page (`src/app/app/join/[code]/page.tsx`, **the one page under `/app` a signed-out visitor reaches**, per `middleware.ts`'s single exemption, which renders its own signed-out header and must not require a session). A layout that renders `AppHeader` breaks the first visually and the second functionally. A route group that moves seven pages into `(shell)/` would work and would rewrite seven import paths, seven test paths and every `next/link` target's file location to solve a problem that is not about headers at all.

**The problem is the hook's lifetime, and there is already a component in this product that outlives every client-side navigation: the root layout.** `src/app/layout.tsx` renders `ThemeProvider` around every page in the application and is not re-mounted when the router navigates. A `NoticesProvider` beside it holds the hook's state once, for the life of the tab (ruling 19).

**Files:**
- Create: `src/components/app-shell/notices-provider.tsx` (+ its test)
- Modify: `src/app/layout.tsx`, `src/account-room/hooks/use-notices.ts` (+ its test), `src/account-room/components/notice-inbox.tsx` (+ its test), `src/integrity/config.ts` (+ its test)

- [ ] **Step 1: Write the failing lifetime tests**

```ts
it("fetches once across three navigations, not six times", async () => {
  // The measurement Plan C's stopgap was derived from, inverted into an assertion. Two requests
  // per navigation was the observed cost; the ceiling for the whole session is now one mount
  // fetch plus one stream open.
  const fetchJson = countingFetch();
  render(<NoticesProvider deps={{ fetchJson, openEventSource }}><Router pages={[home, league, trades]} /></NoticesProvider>);
  await navigateTo("league");
  await navigateTo("trades");
  expect(fetchJson.callsTo("/api/notices")).toHaveLength(1);
});

it("opens exactly one EventSource and never closes it on navigation", async () => {
  // The other half of the two-per-navigation cost: the stream is refcounted, `useNotices` was
  // its only subscriber, and navigating away dropped refs to zero, closed the connection, and
  // the next page's fresh `open` fired a fresh refetch. With one subscriber that never unmounts,
  // `open` fires once per real connection, which is what it was always supposed to mean.
  expect(openEventSource.calls).toHaveLength(1);
  await navigateTo("trades");
  expect(closedSources).toHaveLength(0);
});

it("does not fetch anything until something actually renders the inbox", async () => {
  // The provider wraps every page in the product, including the landing page, `/sign-in` and
  // the signed-out invite preview. A provider that fetched on mount would send an authenticated
  // request from every signed-out visitor and render an error state nobody asked for. It fetches
  // when its first consumer subscribes.
  render(<NoticesProvider deps={deps}><LandingPage /></NoticesProvider>);
  expect(deps.fetchJson).not.toHaveBeenCalled();
});

it("keeps the notices it already has when the inbox unmounts and remounts", async () => {
  // The draft room renders no header. Navigating into it and back out must not cost a refetch.
  await navigateTo("draft");
  await navigateTo("league");
  expect(deps.fetchJson.callsTo("/api/notices")).toHaveLength(1);
});

it("still refetches on a notice.created frame, because the frame carries no words", async () => {
  // Plan A ruling 13 unchanged: the frame is `{ noticeId, noticeType }` and the words come from
  // the next authenticated GET. Nothing about this task changes what a frame means.
  emit("notice.created", { noticeId: "n_1", noticeType: "trade_executed" });
  expect(deps.fetchJson.callsTo("/api/notices")).toHaveLength(2);
});
```

- [ ] **Step 2: Move the state, keep the hook**

`useNotices` keeps its name, its `UseNoticesResult` shape and every one of its four callers' expectations, including the `generationRef` guard that Plan A's own docblock spends thirteen lines explaining — it is moved, not rewritten, because that guard exists to fix a real race between a mount fetch and `markRead` and the race does not go away. What changes is where it runs: inside `NoticesProvider`, once, and `useNotices()` becomes a `useContext` read. The subscription count is what triggers the first fetch, on `subscribeLeagueStream`'s own refcount idiom, so the provider's presence costs nothing until an inbox exists.

`AccountRoomDepsProvider`'s default context value is already the real browser deps (`BROWSER_DEPS`), so the provider needs no wiring in `src/app/layout.tsx` beyond rendering it, and every existing test that injects doubles keeps working unchanged.

- [ ] **Step 3: Bring the ceiling back down, with the arithmetic re-derived**

```ts
/**
 * 30 requests per 60 seconds, restored.
 *
 * THE STOPGAP IS OVER. Plan C raised this to 120 from an observed cost of two `GET /api/notices`
 * per client-side navigation (the mount fetch, plus the refcounted stream's `open` refetch after
 * it reopened), and wrote the arithmetic here so the number would be honest rather than
 * comfortable. Phase 3 Plan D removed the cause: `NoticesProvider` lives in the root layout,
 * survives every navigation, and holds one stream and one page of notices for the life of the
 * tab.
 *
 * THE NEW ARITHMETIC, from the new cost:
 *
 *     1 GET per SESSION            (the first subscriber's mount fetch)
 *   + 1 GET per real reconnection  (the stream's `open`, which now fires only when the browser
 *                                   actually reconnects, not on every page change)
 *   + 1 GET per notice received    (`notice.created` still refetches, ruling 13)
 *   + 1 POST /api/notices/read per bell-open with unread notices
 *
 * A member receiving a notice every four seconds for a minute, opening the bell each time, spends
 * 30. That is not browsing, it is a stress case, and it is the ceiling. The old 30 was reachable
 * in FIFTEEN navigations; the new 30 is not reachable by navigation at all.
 */
rateLimit: { maxRequests: 30, windowMs: 60_000 },
```

- [ ] **Step 4: Close the ledger row**

The overview's carried-items table says this row *"stays open until the layout does."* It closes with a correction rather than a completion, and `docs/decisions/audit-and-integrity.md`'s residuals gain the reason the layout was the wrong instrument: two pages under `/app` cannot have a shared header, and the defect was never about headers.

- [ ] **Step 5: Commit**

---

## Task 10: The seed, the walk, and the proof that none of this is inert

Every automated action in this plan is correct today and fires for nobody, because no league on this platform has completed a season, no trade has ever been lopsided enough locally, and no draft has ever reached a kickoff nobody attended. A mechanism that cannot be observed is indistinguishable from a mechanism that does not work, and this loop has now caught six inert deliverables. This task makes all four fire, locally, through the real paths.

**Files:**
- Modify: `src/data/seed/index.ts`, `seed-public-leagues.ts`, `seed-season-league.ts`, `seed-integrity.ts`, `seed-trades.ts` (+ their tests)
- Create: `src/data/seed/seed-enforcement.ts` (+ its test), `e2e/enforcement.spec.ts`
- Modify: `e2e/global-setup.ts`, `e2e/support/fixtures.ts`, `e2e/mobile-360.spec.ts`

- [ ] **Step 1: A veteran who is genuinely a veteran**

`seed-season-league.ts` already seeds a league whose season has been played. The seed gains two more, completed the same way, so one seeded identity crosses `veteranSeasonCutoff` **by finishing three real seasons whose last weeks were really settled** — which means the `season_completed_at` stamps come from `finalizeWeekInTx` and not from an `UPDATE` in a seed script. Inserting the stamp directly would be mock data on a real surface and would prove nothing about the path that writes it (ruling 24).

That veteran is then pointed at a seeded `beginner` public league and blocked, so `npm run seed` produces a real `tier_blocked_join` notice raised by the real precondition.

- [ ] **Step 2: A trade that really holds, a lineup that really auto-sets, a draft that really starts**

- The seed proposes and accepts a trade past 35 in a public matchmade league, producing a real `held` row, a real `trade_hold` flag in the operator queue, and two real notices. Plan B's ruling 29 refused decorative flags and Plan C's ruling 28 made the fairness flag real; this completes the set with the last flag type the queue can hold.
- The seed leaves one manager's lineup unset in a locked week of a public league and runs the auto-set, so the activity feed carries a `subject_only` row that exactly one seeded account can see, which is also the only way to check the new visibility dimension by eye.
- The seed leaves one public league's draft scheduled in the past and lets the ticker start it, rather than calling `startDraft` itself.

- [ ] **Step 3: The e2e walk, in its own file**

Plan B and Plan C both carried "per-spec e2e seeding consideration", and both answered it the same way: a spec seeds what it needs rather than extending an existing spec's league, using the reuse-if-exists stable-identity pattern so repeated runs do not accumulate leagues. `e2e/enforcement.spec.ts` does the same and covers the three journeys a screenshot cannot fake:

1. A veteran browses, sees the tier filter and the composition label, presses join on a beginner league, and reads the refusal and the notice. Two real sealed sessions, no dev auth bypass.
2. A commissioner sets a draft time, a second manager reads it on the invite preview **signed out**, and the commissioner presses "Start the draft" — the first time any browser in this product's history has called that route.
3. A manager opens the trades page while one of their trades is held, and reads the same sentence the notice sent them.

`mobile-360.spec.ts` gains the blocked-join refusal and the held-trade banner, which are the two new surfaces most likely to overflow: both are long sentences inside a bordered panel.

- [ ] **Step 4: The fragility Plan C ledgered, honored**

Plan C's Task 10 report recorded it plainly: **e2e specs with hardcoded open-flag counts assume a never-swept dev database**, and nine tasks of unswept trades made `trades:sweep` correctly flag six historical rows and break two specs. This plan adds a second flag type to the same queue and a seed that raises one. Every count assertion this plan writes is **relative** — the flags this spec created, filtered by subject id — never an absolute total of the queue, and the two existing absolute assertions are converted in the same commit.

- [ ] **Step 5: Commit**

---

## Task 11: Docs, gate 21, and the closing battery

**Files:**
- Modify: `vitest.config.mts`
- Create: `docs/enforcement.md`, `docs/decisions/enforcement-and-tiers.md`
- Modify: `docs/conventions.md`, `docs/trades.md`, `docs/advisor.md`, `docs/draft-room.md`, `docs/decisions/audit-and-integrity.md`, `docs/decisions/operators-and-moderation.md`, `docs/decisions/trades-and-fairness.md`, `docs/decisions/identity-and-trust.md`, `docs/decisions/live-scoring-pipeline.md`, `README.md`

- [ ] **Step 1: Gate 21, with both halves**

`src/participation` joins `COVERAGE_GATED_DIRS` **and** gets its own `thresholds` block at 100% on all four metrics. Twenty becomes **twenty-one**. Both halves, because an `include` entry with no `thresholds` block measures nothing — the defect a Phase 2 fix wave caught in `src/stats`. Nothing else this plan writes needs a new gate: `src/league-service` (17), `src/draft-service` (18), `src/integrity` (15), `src/integrity-service` (16), `src/stats-pipeline` (8), `src/matchmaking` (6) and `src/reviews` (11) are all already gated, so the enforcement policy, the auto-set, the auto-hold, the auto-start and the season stamp are covered by construction. Guards unreachable through real Postgres get narrow stub-`Db` tests that put the code in the state it defends against, never a lowered threshold and never an ignore comment. Verify with an **unfiltered** `npm run test:coverage`.

- [ ] **Step 2: Write `docs/enforcement.md`**

The one place the enforcement story is told end to end, in the shape `docs/trades.md` and `docs/chat.md` already use: what the platform does automatically and in which leagues, the four automated actions in the order a member meets them, what each one tells them, where every threshold lives and what changing it does, and both rollback switches with what each one stops. It ends with the three things a reader will look for and not find: there is no account action anywhere in this phase (the flag-only contract is enforced by test), there is no state-conditional branching in the tier (strategy §4.1's platform-wide default, deliberately not a state toggle), and there is no automated action in a private league at all.

- [ ] **Step 3: Write `docs/decisions/enforcement-and-tiers.md`**

A new document rather than more sections on four decision docs that are already 400 to 700 lines each about other subjects. Sections, each recording what was chosen, why, and what would have to change for the choice to be wrong:

1. **Three tiers, three names, one document.** Ruling 1 in full: `users.experience_tier` (self-reported, drives `helpLevel`), `leagues.experience_tier` (self-declared, drives browse and now the join gate), `participationTier` (computed, enforces segregation), with the spelling difference stated as the mechanism that keeps them apart rather than as a style choice.
2. **Where a completed season is recorded, and why it is a stamp.** Ruling 2: the anti-join that could not use its index, the one transaction that ends a season, the one-way guard in the `UPDATE`'s own `WHERE`, and the lock note. The section a future reader most needs when they add a second consumer of participation.
3. **The cutoffs, and the grandfathering that is structural rather than special.** Founder decisions #7 and #8 as shipped, why three and one, why they are ordered by a test, and why enforcement at the join alone means nobody is ever reclassified out of a league they are already in.
4. **The door, and the door the spec forgot.** Ruling 6: the join gate, the creation gate, and why a self-declared league label is trustworthy enough to enforce *against* its own declarer.
5. **The fourth deny-by-default dimension.** Ruling 8: what `SYSTEM_ACTION_VISIBILITY` decides, why it subsumed `SYSTEM_ACTION_SUMMARY_ALLOWED` instead of sitting beside it, and the one word Plan B's pre-decided answer got wrong — `actor_only` cannot mean anything for an event whose actor is the platform.
6. **The auto-set, and why it is a materialization.** Ruling 9: the `getLineup` fallback, what it does not remember, why week 1 writes exactly what the fallback would have derived, and why the strategy enum ships with one arm.
7. **The hold, and the hole it does not have.** Ruling 12: the platform-scoped transaction, why the one-chain rule pays out here and costs elsewhere, and the two exits with the table cell that made them necessary.
8. **What a held trade is and is not.** It is a question raised before a trade happens, not a judgment about two people, which is why the threshold (35) is nearly twice the one at which the platform merely asks (20) and almost three times the one at which the advisor calls a trade lopsided to a member's face (12). The known false positives: a rebuilding manager, a genuine salary dump, two friends. All three should reach an operator; all three are usually `trade_released`.
9. **The clock, and the two schedulers.** Ruling 15 and ruling 23: a commissioner-chosen kickoff, a platform that presses start for a league with no trustworthy commissioner, why the claim is a guarded status transition rather than a lock, and why the audit-chain walk is Phase 2 Plan D's and not this ticker's.
10. **The rollback switches, and why neither is a database column.** Ruling 17: what the spec asked for, what a per-league boolean with no writer would have been, and what `is_public_matchmade` plus one config flag give instead.
11. **Threat model additions.** What automated enforcement adds to Plans A, B and C's model: the platform now writes rosters, starts drafts and refuses joins on its own, which means a bug in this plan is a bug that acts. What bounds it — every action is chain-recorded with `actorType: "system"`, every action is reversible or refusable by a human, no action touches an account, and both switches turn all of it off without a deploy of business logic. What it does **not** add: no new privilege, no new account action, and no path from any threshold to a consequence a person cannot see.

- [ ] **Step 4: Correct the drift, by grep and not by guess**

```bash
grep -rn "twenty\|TWENTY\|20 gated\|autoHoldThreshold\|SYSTEM_ACTION_SUMMARY_ALLOWED\|Plan D\|plan-d\|experience_tier\|kickoff" docs src scripts README.md
```

Known targets: `docs/conventions.md`'s directory map (`src/participation/`, `season_completed_at` in the `db/schema.ts` table list, `@/participation` on the client-boundary exempt list with the sentence saying why, and the coverage-gate enumeration where twenty becomes twenty-one). `docs/decisions/operators-and-moderation.md` §9's table (the `lineup_auto_set` and `trade_held_for_review` rows become decided rather than pre-decided, and the section says which document now owns the dimension). `docs/decisions/trades-and-fairness.md` §7's *"Plan D is the plan that supplies a number"* becomes the number, and the four-threshold section's parenthetical *"(once a hold threshold is a real number)"* comes out. `docs/decisions/audit-and-integrity.md`'s residuals: the `renderSystemAction` trap closes for the second and last time, the notices-remount row closes with its correction, and the `setLineup` league-id residual closes. `docs/decisions/identity-and-trust.md`'s verified-played-here residual gains its definition. `docs/decisions/live-scoring-pipeline.md` gains the worker's new post-transition trigger. `docs/draft-room.md` gains the chosen kickoff and the auto-start. `README.md` gains nothing — this plan adds no script and no environment variable, and saying so is the check.

**Every "Plan D" string in `src/` and `scripts/` is triaged in this step**, because the phrase is overloaded across three phases and a reader who greps it after this merges must not find a Phase 3 obligation that has already shipped. The Phase 2 Plan D references (`src/db/config.ts`, `src/db/schema.ts:814`, `src/identity/notifications.ts`, `src/identity/config.ts`, `src/integrity-service/session-signals.ts`, `src/integrity/config.ts:41` and `:149`, `src/app/api/admin/_shared.ts`, `scripts/verify-audit-chain.ts`) stay and are left spelled out in full. The Phase 3 Plan D references (`src/integrity/config.ts:81` and `:192`, `src/integrity/system-actions.ts`, `src/integrity/activity-view.ts:220` and `:240`, `src/integrity-service/trade-fairness.ts:46` and `:70`, `src/trades/fairness.ts:96`, `src/league-service/trades.ts:771`, `src/domain/audit.ts:42`, and the four test names) become statements of what shipped.

- [ ] **Step 5: Prove nothing was reserved for a plan that does not exist**

```ts
// src/integrity-service/reserved.test.ts
it("leaves the plan-d arm of OWNER unused, because there is no plan after this one", () => {
  // Phase 3 ends here. A reserved audit event type with a named owner is honest while the owner
  // is coming; after the last plan it is a name with no writer and no plan that will ever write
  // one. Every one of the sixteen types is published, and this assertion is what keeps a future
  // reader from adding a seventeenth "for Plan D".
  expect(Object.values(OWNER)).not.toContain("plan-d");
});
```

The same sweep runs by hand over the four tables this plan touched: every `SystemActionCode` has a publisher, every `NoticeType` has a sender, every `ResolutionDecision` is wired for at least one subject type, and every `FlagType` can be raised. Four lists, four greps, recorded in the commit body.

- [ ] **Step 6: The closing battery**

```bash
npm run infra:down && npm run infra:up
npm run db:migrate && npm run db:migrate:test
npm run seed && npm run stats:ingest
npm run audit:verify -- --full         # every chain the seed produced, from genesis
npm run integrity:sweep -- --league <seeded>
npm run trades:sweep
npm test
npm run test:coverage                  # UNFILTERED: twenty-one gated dirs, all 100%
TEST_DATABASE_URL=$TEST_PGBOUNCER_URL npm test    # the whole suite through the pooler
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
npm run e2e                            # twice, back to back, per Plan A's precedent
```

The through-the-pooler run carries a specific load here. This plan adds four transactions to a codebase whose lock-order suite already covers seven writers, and two of them touch rows the existing seven already take: the auto-set takes `stat_weeks FOR SHARE` ahead of `lineup_slots`, joining `setLineup` and `acceptTrade` as the third roster-adjacent writer in the same position, and the auto-start takes `drafts` after `leagues` in the direction opposite to `joinLeagueInTx`. Plan A found a real foreign-key deadlock and Plan C found a second one that its own per-task proofs had waived; `lock-order.test.ts` running through transaction pooling at 11/11 writers is the check that has caught both.

`audit:verify --full` matters for the reason Plan A's documented floor gives: an unverified chain's tail deletion plus anchor rewind is undetectable, so first-verification-per-chain is the requirement, and every league chain this plan's seed and e2e create is a new chain. It is also the one line in this battery that this plan does **not** own the scheduling of, and Task 7 step 5 says whose it is.

- [ ] **Step 7: Commit**

---

## Open questions, self-ruled

Every judgment call this plan makes, numbered, with the reasoning that would have to be wrong for the ruling to be wrong.

1. **The computed tier is called `participationTier` and spelled `newcomer` / `veteran`, and it shares no word with either `experience_tier` column.** The phase overview flagged this before any code existed: `users.experience_tier` is a self-reported sign-up answer that drives `helpLevel` defaults and first-run ordering; `leagues.experience_tier` is a self-declared label rendered on `/browse`; Step 6's is a computed, enforced participation fact that blocks a join. Three meanings on one word is how a future reader ships the wrong one, and the failure is silent because all three are `beginner`-shaped strings that type-check against each other. A different noun **and** a different vocabulary means a mistake is a compile error rather than a bug — `participationTierFor` cannot be handed a `users.experience_tier` value and `matchesBrowseFilter` cannot be handed a `ParticipationTier`. This is wrong only if the three facts turn out to be one fact, which they cannot be: one is what somebody said about themselves, one is what somebody said about a league, and one is what the platform observed.

2. **A league's season completion is stamped once, by the transaction that ends it, and the per-account count is derived and never stored.** The spec says to source the tier from "the audit log / league-membership records" and neither can answer it: no audit event says a season ended, and the only observable completion is every matchup carrying scores. The query that asks it directly (`NOT EXISTS (SELECT 1 FROM matchups WHERE league_id = $1 AND home_score IS NULL)`) cannot use `matchups_unsettled_idx`, whose leading column is `week_number`, so it degrades with the size of the whole product rather than the size of the league. `data-layer-hardening.md`'s rule decides the split exactly: derive over a bounded set, roll up over an unbounded one. The unbounded half is every matchup in the product and it gets stamped once, in `finalizeWeekInTx`, which is the one transaction that can know; the bounded half is one account's teams and it is counted on demand. A stored per-user counter was considered and rejected for the reason `data-layer-hardening.md` gives: a second source of truth for a number one indexed count already answers, needing the same in-transaction discipline anyway. This is wrong if a league can complete a season without its last week being scored, which is not a state this product has.

3. **`src/participation` is a new pure, browser-safe directory on the client-boundary EXEMPT list, and it is the eighth.** Not `src/domain`: that directory is under `eslint-plugin-functional`'s immutability rules and holds types the whole product shares, and a participation tier's labels and thresholds are a feature's vocabulary. Not `src/integrity`: that directory is **blocked** because it reads `node:crypto` and Postgres-shaped types, and `browse-filters.tsx` needs `PARTICIPATION_TIER_LABEL` and `TIER_COMPOSITION_LABEL` as values. So a pure exempt directory beside `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews`, `src/moderation` and `src/trades`, for the identical reason each of those is one. It joins `flag-only.test.ts`'s `INTEGRITY_DIRS` in the same commit, because the directory that decides who is a veteran is exactly the directory somebody would one day reach for an account action from.

4. **This plan adds no config file.** `INTEGRITY_CONFIG`'s own docblock binds it: *"Plans B, C and D add FIELDS here, never new files."* Every number and switch this plan introduces is about integrity — a segregation cutoff, a hold threshold, a missed-deadline strategy, two rollbacks — and none of them is a thing a commissioner would tune, which is the line Plan C's ruling 5 drew between `TRADE_CONFIG` and `INTEGRITY_CONFIG.trade` and which this plan applies unchanged. `LEAGUE_CONFIG.defaults` gains one field (`maxDraftDaysFromCreation`) because a draft-scheduling ceiling genuinely is league product configuration and sits beside `draftDaysFromCreation`, which it bounds.

5. **The one migration adds one nullable column and one partial index, hand-written, with a mutation proof beside the assertion.** `drizzle-kit generate` has silently dropped an index clause before (Plan B ruling 17's `INCLUDE` trap on `chat_messages`), and a partial index that quietly became a full one on the product's most-joined table is a cost nobody notices until it matters. The index is asserted present *with its predicate* against `pg_indexes`, and the assertion is paired with a proof that it reddens when the predicate is removed — because an index test that cannot fail is a comment, which is the finding Plan B's final review made about two of its own gate tests.

6. **Segregation is enforced at the join AND at league creation, and the second gate is not in the spec.** Step 6 blocks a `veteran` joining a `beginner` public league. It does not block a `veteran` from creating one, and a creator never passes through `publicJoinPrecondition` at all. §4.1's premise is that a public league's commissioner is *"whichever stranger happened to create the league"* and should not be trusted; a veteran declaring his own public league `beginner` and waiting for it to fill is that stranger executing the exact harm the segregation exists to prevent, through the one door it does not cover. Both gates read one predicate so the rule exists once, and the refusals differ because being turned away from somebody else's league and being asked to change one field of your own are different sentences. This is wrong only if a league's self-declared tier should not bind its own declarer, which would make the label meaningless.

7. **Every automated action rides `system_action` with a `payload.action` code; this plan adds no audit event type.** `AUDIT_EVENT_TYPES` ships as a pg enum whose docblock states *"no later migration ever runs `ALTER TYPE … ADD VALUE`"*, and `system_action`'s own docblock has said since Plan A that *"Plan D's enforcement policy is what makes it common."* `SYSTEM_ACTION_CODES` is a plain `as const` array with no database representation, so it grows freely — which is precisely why Plan A put the vocabulary there. Four codes are added (`tier_blocked_join`, `draft_auto_started`) or given their first publisher (`lineup_auto_set`, `trade_held_for_review`), and every one of them is wired in this plan.

8. **`SYSTEM_ACTION_VISIBILITY` replaces `SYSTEM_ACTION_SUMMARY_ALLOWED`, and the new scope is `subject_only`, not `actor_only`.** Plan B's pre-decided answer is right that Plan D needs a visibility rather than a flipped boolean, and wrong in one word it could not have tested: a `system_action` has `actorType: "system"` and therefore `actorId: null`, so `activityRowFor`'s `actor_only` branch — which compares `event.actorId` to the viewer — can never match one. The member an auto-set concerns is the **subject**, carried on the payload. Replacing rather than adding is the same collapse Plan C performed on `CONTENT_REMOVAL_WIRED_FOR`, for the same reason: two tables answering "may this say words" and "to whom" would disagree the first time somebody edited one, and the boolean is derivable from the visibility with a zero-line diff at all three existing consumers. A payload with no `subjectUserId` renders nothing, because deny-by-default has to survive a malformed payload as well as a missing decision.

9. **The auto-set materializes a fact; it does not choose a team.** `getLineup` already falls back to the roster through `defaultLineup`, so an unset lineup is legal — but the fallback is per week and has no memory, which means a manager who set week 1 carefully and forgot week 2 fields the raw roster order in week 2. `REPEAT_PREVIOUS_WEEK` carries their own last choice forward, and where there is no previous choice (week 1) it writes exactly what the fallback would have derived a moment later, which is the same "freeze a fact rather than make a decision" property Plan C's locked-week lineup materialization has. `BEST_LEGAL_LINEUP` is not declared at all rather than declared and unimplemented: founder decision #9 defaults to the predictable strategy, predictability beats optimality when the platform is acting without consent, and an enum value with no implementation is the control wired to nothing that founder decision #5 already refused once for `ACCOUNT_RESTRICTED`.

10. **`autoHoldThreshold` is 35, and the four-threshold ordering test stops being partially skipped.** The four sit on one points-per-week axis: `evenDelta` 3 (below this the advisor calls a trade even), `lopsidedDelta` 12 (above this the advisor tells a member to their face that a trade is lopsided), `fairnessFlagThreshold` 20 (at this the platform asks an operator a question about a completed trade), `autoHoldThreshold` 35 (at this the platform stops a trade two adults agreed to). The gap between 20 and 35 is deliberate and is the whole content of the number: a flag costs an operator ten seconds and costs the members nothing, while a hold costs two members their agreement and their time. 35 is roughly "one side gave back nothing that starts," which is the only shape of trade worth that cost. It is config-driven for the reason the spec gives, and every inversion is named in the test: `flag > hold` would hold trades nobody flagged, which is a trade frozen before anyone ever asked a question about it.

11. **A held trade is a seventh status, and it has two exits of its own rather than borrowing three that mean other things.** Plan C refused a seventh status for the reversal because a reversed trade **still means accepted** and the league chain says so; a held trade means neither open nor settled and no roster moved, so the row genuinely needs a state it does not have. The exits are `trade_released` and `trade_blocked`, and the alternative — reusing `no_action` for release and `trade_reversed` for block — was rejected on this codebase's own precedent. `no_action` is documented as noticing nobody *because nothing happened*; making it move two rosters and notify two people would put a lie in a table this codebase reads as documentation. And `trade_reversed` describes undoing something that occurred, which is precisely the class of false word Plan C's ruling 23 refused when it made `superseded` its own status rather than calling it `rejected`: *a manager who sees the wrong word will draw a conclusion that is simply false*. `DECISION_WIRED_FOR` was built as a two-axis exhaustive `Record` so that a new subject is a column and a new decision is a row, and every one of the thirty cells is a compile-forced answer.

12. **The hold's audit event and its flag are BOTH platform-scoped, so they commit in one transaction, and the auto-hold has no after-commit hole.** Plan C's fairness flag has to be raised after the accept transaction commits, because `trade_accepted` is league-scoped, `flag_raised` is platform-scoped, and Plan A's ruling 3 permits one chain per transaction — and the honest consequence is a trade that can end up unflagged if a process dies, remedied by an operator sweep. A hold is the mirror image: nothing happens in the league, so nothing is written to the league chain, so there is no second scope to cross. The one-chain rule that cost Plan C a hole pays this plan a guarantee, and that is worth stating rather than leaving as a coincidence a reader has to notice. It is also why `SYSTEM_ACTION_SUMMARY_ALLOWED.trade_held_for_review` stays denied: a platform-chain event is structurally unreachable from `listLeagueActivity`, so the denial stops being a decision anybody has to keep making.

13. **A release executes first and resolves second; the order is chosen by which failure is recoverable.** Releasing a held trade crosses scopes in the other direction — the execution appends `trade_accepted` and `roster_move` to the league chain, the resolution appends `flag_resolved` to the platform chain — so it is two transactions whatever order they take. Executing first can leave an executed trade with an open flag: an operator sees the row again, resolves it again, and the second attempt is a no-op because the execution is guarded on `status = 'held'`. Resolving first can leave a resolved flag over a trade that never executed: a decision recorded, never carried out, invisible to everybody including the two people waiting. The second failure is the one nobody discovers, so the first order wins. This is the same shape as Plan C's after-commit flag with the same operator-recoverable property, and it is stated beside it in the decision doc so the two read as one pattern.

14. **A held trade takes its place in the oldest-first queue, which is a correction to founder decision #10's own default.** That default reads *"no expiry, but the held trade is visible to both parties with its status and stays at the top of Plan B's queue."* The first two halves ship. The third contradicts `operators-and-moderation.md` §3, which rules the queue oldest-first with **no severity sort and no bulk action** — and a held trade is exactly the row a severity sort would be introduced for, which is how a queue acquires one. The property that makes plain ordering acceptable is that the flag is raised in the same transaction as the hold, so a held trade is never behind anything raised after two people started waiting. Recording the correction rather than quietly implementing the default is the point: a founder reading the ledger should see that their instruction met an existing ruling and which one won.

15. **`drafts.kickoff_at` becomes a commissioner's choice with a default, and `PublicLeagueSummary` gains `draftAt` as its tenth field.** The column has existed since Phase 1, has never been chosen or shown, and is compared to the clock by nothing; Phase 2's persona panel filed the consequence as a product gap. Making it chosen is additive (the computed default stays, so every existing caller and every seed is unchanged) and making it visible costs one field on the privacy boundary of this product's one unauthenticated read. That is a decision and not an addition: a draft time is a scheduling fact about a league, not a fact about any person in it, and a visitor who cannot see it cannot tell whether they are able to attend the only synchronous event this product has. `PublicLeagueSummary`'s own key-set test is what makes the addition deliberate rather than accidental.

16. **The auto-start claims with a guarded status transition, never with a lock.** PgBouncer transaction pooling forbids `pg_advisory_lock` (`data-layer-hardening.md`), so leader election among app instances is unavailable by construction, and `instrumentation.ts`'s ticker is a per-process `setInterval` whose only guard is a non-overlap flag inside one process. The precedent this codebase already has is the nudger's claim row — `draft_nudges` on `(draftId, pickNumber)` with `onConflictDoNothing().returning()`, where an empty return means somebody else got there first. The claim here is `UPDATE drafts SET status = 'in_progress' WHERE id = $1 AND status = 'scheduled' RETURNING id`, inside `startDraft`'s own transaction, so exclusion comes from the write rather than from coordination. Two instances scanning the same due draft in the same millisecond produce exactly one `START_DRAFT` action, and the test drives that on two real connections rather than asserting it in prose.

17. **Neither rollback is a per-league database column.** The spec asks for *"a per-league feature flag"* for Step 5 and *"a flag"* for Step 6. A boolean column on `leagues` with no UI, no script and no caller able to set it would be the control wired to nothing this phase has now refused four times (ruling 11's `ACCOUNT_RESTRICTED`, Plan B's `trade_reversed` refusal, Plan C's untouched `SYSTEM_ACTION_SUMMARY_ALLOWED`, and this plan's undeclared `best_legal_lineup`). The per-league axis already exists and is `is_public_matchmade`, which is exactly the axis the spec's own matched test pair turns on; the platform axis is `INTEGRITY_CONFIG.enforcement.enabled` and `INTEGRITY_CONFIG.participation.enforceTierSegregation`, settable at deploy without touching business logic, in the same shape `autoHoldThreshold: null` shipped in. Both are tested in both states, which is the property a rollback actually needs.

18. **Automatic rejection of mechanically invalid roster moves is already shipped, everywhere, and this plan proves it rather than building it.** `setLineup` validates ownership, duplicate starts and `validateLineup` against `src/domain/roster-eligibility.ts` and returns a 422 with a plain-language reason — for every league, not just public ones, which is better than Step 5 asks for and would be strictly worse to "add." Building a public-league-only rejection path beside it would be the two-implementations-of-one-rule failure Phase 2's ruling 18 refused for moderation. What this plan owes is the matched public-versus-private test proving the behavior is identical (because the rule is not enforcement, it is validity), and closing the one real gap the audit residuals named: `setLineup` never asserts `teams.league_id === input.leagueId`, and the residual says explicitly that the next writer of a team-scoped mutation should add the check rather than copy the omission. This plan is that writer.

19. **The notices remount is fixed with a root-layout provider, not the shared `src/app/app/layout.tsx` the ledger proposed.** Two pages under `/app` deliberately render no `AppHeader` and cannot be made to: the draft room, whose `RoomRail` is its header under a no-page-scroll contract, and the invite page, which is **the one page under `/app` a signed-out visitor reaches** and must not require a session. A layout rendering `AppHeader` breaks the first visually and the second functionally; a `(shell)` route group would work and would move seven pages, seven test files and every link target to solve a problem that is not about headers. The actual defect is the hook's lifetime, and `src/app/layout.tsx` already contains a component (`ThemeProvider`) that outlives every client-side navigation in the product. The provider fetches on first subscription rather than on mount, because it wraps the landing page and `/sign-in` too and a signed-out visitor must not send an authenticated request. This is wrong if Next.js remounts the root layout on navigation, which it does not, and the test asserts it against a real router rather than against that belief.

20. **This plan adds no realtime event type.** An auto-started draft already publishes `draft.status` through `publishDraftEvent`, which is the same frame a commissioner's press produces and the same frame the draft room already listens for. Every other automated action reaches its member through `notice.created` on their own user stream. A `league.enforcement` broadcast would be a second transport for facts already delivered twice, and `REALTIME_EVENT_TYPES` is deliberately enumerated once and grown reluctantly — `score.update` sat reserved for a whole phase before anything published it.

21. **`src/participation` joins the coverage gate as the 21st, and nothing else needs a new one.** Every other directory this plan writes into is already gated: `src/league-service` (17) holds the participation read model, the enforcement policy, the auto-set and the schedule; `src/draft-service` (18) holds the auto-start; `src/integrity` (15) and `src/integrity-service` (16) hold the visibility dimension, the decisions and the resolution branches; `src/stats-pipeline` (8) holds the stamp. That is the payoff of gates 17 and 18 arriving two plans early, and it means the code that writes rosters and starts drafts on its own is at 100% by construction rather than by intention. The new directory gets an `include` entry **and** a `thresholds` block, because an `include` entry with no threshold is not a gate at all.

22. **No new icon and no new UI primitive.** `clock` is already the draft clock and the lineup lock, `shield` is already the platform acting on its own (Plan B chose it for the operator surface), `clover` and `crown` carry newcomer and veteran without either reading as a judgment, and `check` is the verified badge. Two lists of players in an auto-set notice render through `PositionBadge` and `Sticker`, which are already the only sanctioned ways to show a position label and a position-pigmented tile. Four phases in, "centralize the first time" looks like the last plan of a phase adding four member-facing surfaces and touching `src/components/ui/` only to add the provider that has no visual output at all.

23. **The full audit-chain walk is Phase 2 Plan D's, not this ticker's, and the reconciliation is recorded rather than assumed.** Two schedulers are named across this codebase and both are called "Plan D", which is why `INTEGRITY_CONFIG.verification` and `scripts/verify-audit-chain.ts` both spell out "Phase 2 Plan D" in full. `fullVerifyIntervalHours` (24) is *"the number a production scheduler is configured with"*; the interim control is the operator runbook line; and Plan A's documented floor — first-verification-per-chain, because an unverified chain's tail deletion plus anchor rewind is undetectable — is about coverage, not cadence. This plan builds an in-process scheduled action and deliberately does not adopt the walk onto it: the walk is unbounded work with an operator-facing report, the ticker has no leader election, and every instance running a full walk every 24 hours would be duplicated unbounded reads against the one table the trust model rests on. A claim row would fix the duplication and leave an integrity job depending on a dev worker's liveness, which is worse than the runbook it replaced. What this plan owes is the coverage half, and Task 11's `audit:verify --full` is where every chain it creates gets its first verification.

24. **The seed makes all four mechanisms fire, through the real paths, or they are indistinguishable from mechanisms that do not work.** Every automated action in this plan is correct today and fires for nobody: no league has completed a season, no local trade has been lopsided enough, no draft has reached an unattended kickoff. Stamping `season_completed_at` from a seed script, or inserting a `trade_hold` flag directly, would be mock data on a real surface (which the founder rules forbid) and would prove nothing about the path that writes it — the exact objection Plan B's ruling 29 raised against decorative flags and Plan C's ruling 28 answered for the fairness flag. So the seed plays three real seasons to their last settled week, proposes and accepts a real trade past 35, leaves a real lineup unset in a locked week, and lets the ticker start a real overdue draft. What an operator and a member see locally is what the mechanisms actually do.

25. **The commissioner's schedule route answers 404 to a member who is not the commissioner, never 403.** Fourth application of the non-oracle discipline: `publicJoinPrecondition` answers 404 for a non-public league, `withAdmin` answers 404 for a signed-in non-operator, Plan C's trade routes answer 404 for a manager not party to the trade, and a schedule route answers 404 to a member who does not run the league. A 403 would confirm which member holds the commissioner's chair to anybody who can reach the league, which is small and is exactly the kind of small thing that is free to get right and awkward to change later.

26. **The verified badge carries a boolean and never a count.** Founder decision #8's default is one completed season, and the tooltip states that claim in those words rather than saying "Verified" and letting every reader guess what was verified. What it deliberately does not carry is *how many* — "3 seasons" on a public, unauthenticated review feed is a fact about a stranger's history that nobody asked them to publish, and the same reasoning that makes `leagueTierComposition` two counts rather than a list of names applies to one person with more force. This is wrong if readers need to weigh reviewers against each other, which is a ranking feature and not a badge.

---

## Self-review

**Spec coverage — Step 5 (automated rule enforcement for public leagues), task by task:**

| Spec task (lines 233–241) | Where |
|---|---|
| A `PublicLeagueEnforcementPolicy` activating only on `isPublicMatchmade`, with a matched pair proving the identical scenario differs only by that flag | Task 3 step 4 builds the one predicate; the matched pairs are Task 3 step 1 (join), Task 4 step 2 (lineup), Task 5 step 1 (trade) and Task 7 step 1 (draft start). Four pairs, not one, because the spec's single pair would have proved the policy for whichever action was tested |
| `TRADE_AUTO_HOLD_THRESHOLD` in config, stricter than the flag threshold; at or past it a trade is held pending mandatory review, not reversed or auto-rejected | Task 1 step 2 (the number, 35) and Task 5 (the hold). Held and not reversed: `applyTradeInTx` is never called, no roster moves, and the row's status says so |
| A test enforcing the config invariant, failing loudly on misorder | Task 1 step 2. All **four** thresholds on one axis, which is Plan C's ruling 6 extended to the value that finally exists, with each inversion's consequence named |
| Missed-deadline lineup handling under `MISSED_DEADLINE_LINEUP_STRATEGY` | Task 4, on the worker's own lock transition, one transaction per league |
| Automatic rejection of mechanically invalid roster moves, reusing the eligibility rules, with a clear reason | Task 4 step 5 and ruling 18: **already shipped for every league** by `setLineup`'s `validateLineup`, proved by the matched pair rather than duplicated. The one real gap (`teams.league_id` unasserted) is closed in the same task |
| Every automated action writes a `SYSTEM_ACTION` audit event with `actorType: SYSTEM` | Tasks 3, 4, 5 and 7. Four codes, each with a publisher, each enumerated in Task 11 step 5's four-list sweep |
| `LINEUP_AUTO_SET` and `TRADE_HELD_FOR_REVIEW` notification templates, called in the same flow as the audit event | Task 4 step 6 and Task 5 step 5. Both inside the business transaction, per Plan A's write-ordering rule, so the notice cannot survive a rolled-back action |
| A boundary test: between the thresholds a trade completes and is flagged; at or above the hold threshold it is held and notified | Task 5 step 1, third test, with the flag types asserted separately so "flagged" and "held" can never be conflated |

**Spec coverage — Step 5's exit criteria:**

| Exit criterion | Where |
|---|---|
| A matched pair proves public and private differ solely via `isPublicMatchmade` | Four pairs, listed above |
| Every automated action traceable with `actorType: SYSTEM`; none bypasses the log | Task 11 step 5's sweep: every `SystemActionCode` has a publisher, proved by grep in the shape `reserved.test.ts` already uses for event types |
| Every auto-set and every auto-hold produces both a `SYSTEM_ACTION` event and a notice with non-empty, non-accusatory copy | Tasks 4 and 5, each asserted on both halves in the same test. The copy sweep is `notices.test.ts`, which runs `copyViolations` over every template the moment it lands |
| A config test fails if the hold threshold is ever less extreme than the flag threshold | Task 1 step 2 |

**Spec coverage — Step 6 (experience-tier segregation), task by task:**

| Spec task (lines 270–276) | Where |
|---|---|
| `computeExperienceTier(accountId)` over a small fixed enum derived from completed-league count | Task 1 steps 1 and 4, named `participationTierFor` / `participationFor` per ruling 1, with the naming collision resolved before an identifier was typed |
| Tier computed from a completed-league count, with a comment that a real-money phase adds a prize-win signal | Task 1. The count's source is the `season_completed_at` stamp (ruling 2), because the audit log the spec names cannot answer the question; the prize-win note lands in the config docblock and in `docs/decisions/enforcement-and-tiers.md` §3 |
| `EXPERIENCE_TIER_CONTEST_COUNT_CUTOFF` as a single platform-wide constant, documented as not varying by state | Task 1 step 2, as `INTEGRITY_CONFIG.participation.veteranSeasonCutoff`. No state-conditional branching exists anywhere in this plan, and the docblock says why three rather than 51, 500 or 1,000 |
| Recompute on a defined trigger, not continuously | Task 1 step 4: read at the public-join attempt and at league creation, never stored on the account. The stamp is what makes an on-demand read cheap enough to need no cache |
| Tier as a default, always-visible browse filter, plus a visible per-league composition label, reusing the existing filter pattern | Task 2, extending `normalizeBrowseFilter`/`matchesBrowseFilter`/`PublicLeagueSummary` rather than building a parallel filter, with "always visible" and "defaults to any" separated as the two different properties they are |
| Enforce at public-league join; private leagues unaffected; `TIER_BLOCKED_JOIN` notice with a non-accusatory reason | Task 3, plus the creation-side gate the spec does not contain (ruling 6) |
| Boundary tests one below, exactly at, one above | Task 1 step 1 |

**Spec coverage — Step 6's exit criteria:**

| Exit criterion | Where |
|---|---|
| The cutoff lives only in config; a test proves a change alters tiering with no code change | Task 1 step 1 takes the cutoff as an argument for exactly this reason, the same shape `crossesFairnessThreshold` and Plan B's sweep both use |
| A seeded veteran cannot join a seeded newcomer public league, through the UI or the underlying function | Task 3 step 1 (the function), Task 10 step 3 (the browser, two real sealed sessions) |
| A blocked join produces a `TIER_BLOCKED_JOIN` notice with non-accusatory copy | Task 3 steps 1 and 5 |
| A matched test proves private leagues are unaffected | Task 3 step 1, third test, through `acceptInvite`'s own precondition |

**Overview obligations (lines 166–188):**

| Obligation | Where |
|---|---|
| The participation read model, recomputed on a defined trigger, the single source both the tier and the badge read | Task 1. One module, two consumers (Tasks 2/3 and Task 8) |
| `computeParticipationTier` and the cutoff in `INTEGRITY_CONFIG`, no state branching, boundary tests | Task 1 steps 1 and 2 |
| The naming ruling and its doc entry: three facts, three names, one document | Ruling 1, Task 11 step 3 §1 |
| Tier as a default always-visible filter and a per-league composition label, extending `matchmaking/filter.ts` and `PublicLeagueSummary` with the privacy boundary intact | Task 2, with the boundary's key-set test named as the thing that makes the tenth and eleventh fields deliberate |
| Enforcement at `publicJoinPrecondition` keeping the non-oracle discipline, plus the notice and the matched private test | Task 3 |
| `PublicLeagueEnforcementPolicy` activating only on `is_public_matchmade`, with the matched pair | Task 3 step 4 |
| Missed-deadline auto-set on the kickoff lock, strategy from config, reusing eligibility so the result is legal by construction | Task 4 |
| Trade auto-hold at the threshold through Plan C's seam, plus the invariant test | Tasks 1 and 5 |
| Automatic rejection of invalid roster moves, reusing eligibility, with a clear reason | Ruling 18 — already shipped, proved not rebuilt |
| Every automated action: a `SYSTEM_ACTION` with `actorType: SYSTEM` **and** a `notifyAffectedMember` in the same flow, passing the denylist | Tasks 3, 4, 5, 7 |
| **Residual — the commissioner's clock**: chosen `kickoff_at`, surfaced everywhere a prospect decides, a start control, and auto-start for public leagues on the ticker, idempotent across instances | Tasks 6 and 7. Split because one is a product surface and the other is a scheduler, and because ruling 16's proof needs two real connections |
| **Residual — the verified-played-here signal**, on the same read model | Task 8 |
| Persona panel covering a blocked join, an auto-set lineup and a held trade | Four panels: Task 3 (the blocked join), Task 5 (the held trade, both audiences), Task 6 (the draft everyone plans around), Task 8 (the badge and the moderation window). The auto-set notice is reviewed inside Task 3's panel as the third of the platform's three unrequested sentences |
| 8 to 12 tasks; the final task is docs plus the closing battery with the pooler-routed suite and a double e2e | Eleven tasks; Task 11 step 6 |
| Nothing depends on Phase 2 Plan D | Nothing does. Every gate that plan holds is listed below and none blocks a task |

**Carried items this plan inherits, and where each lands:**

| Carried item | Ledger source | Where |
|---|---|---|
| **The notices rate-limit architectural fix** (shared layout or header fetch caching; the P3C stopgap ceiling and its own ledger row) | Plan C final review MEDIUM 6; overview carried-items table | Task 9, fixed in the root layout instead, with the ledger row closed by correction (ruling 19) |
| **Commissioner visibility of platform moderation in their own league** | Plan B Task 6 panel MEDIUM, ruled "Plan D owns the commissioner console question" | Task 8 step 2, narrow by decision: counts and a date, never a name, a quote or a reason |
| **The multi-account detector's `operator_warning` escalation path** | Overview, if the spec has one | **The spec has none, and this plan adds none.** Step 2 is flag-only and says so three times; the escalation that exists is Plan B's `warned_user` decision, already wired to the `operator_warning` notice. `flag-only.test.ts` gains `src/participation` so the contract covers the directory that decides who is a veteran, and that is the whole of this plan's contact with the detector |
| **Per-spec e2e seeding consideration** | Plans B and C ledgers | Task 10 step 3: `e2e/enforcement.spec.ts` seeds what it needs, on the reuse-if-exists stable-identity pattern, and every count assertion is relative rather than absolute (Task 10 step 4, honoring Plan C's own ledgered fragility) |
| **Corpus-realism mechanism for plan assertions (a small task if cheap)** | Plan B final review; carried through Plan C's ruling 24 | Task 1 step 6: the builders move to `src/db/test-corpus.ts` with a documented density contract, and every EXPLAIN assertion in this plan builds from it with a mutation proof beside it. Cheap, and it is the difference between a convention and a mechanism |
| **The first-verification-per-chain scheduler question — who owns it** | Plan A's documented floor; overview's founder-gated bucket | Task 7 step 5 and ruling 23. **Reconciled honestly: the full-walk scheduler is Phase 2 Plan D's**, stated in two docblocks that already spell the phase out because the name is ambiguous. Phase 3 Plan D owns the coverage half only, and Task 11's `audit:verify --full` is where every chain it creates gets its first verification |
| `SYSTEM_ACTION_SUMMARY_ALLOWED.lineup_auto_set` denied in advance, with a pre-decided answer Plan D must not simply flip | `operators-and-moderation.md` §9 | Ruling 8. The answer is taken and one word of it corrected, with the correction argued rather than performed |
| `SYSTEM_ACTION_SUMMARY_ALLOWED.trade_held_for_review` denied by Plan B and left denied by Plan C | `operators-and-moderation.md` §9, `trades-and-fairness.md` §7 | Ruling 12. **Still denied**, and now for a structural reason: the hold's event never reaches a league chain at all |
| `INTEGRITY_CONFIG.trade.autoHoldThreshold` is Plan D's number, not Plan D's code path | `config.ts:192`, `trade-fairness.ts:70` | Task 1 step 2. A number. `evaluateTradeBeforeExecute` is unchanged |
| The `plan-d` arm of `reserved.test.ts`'s `OWNER` | Plan A | Task 11 step 5: asserted **unused**, because Phase 3 ends here |

**Placeholder scan:** no `TODO`, no `TBD`, no "handle errors appropriately", no "similar to Task N", no step whose expected output is unstated. Every file in the File Structure tables appears in a task's Files block. Six places name a helper the executing engineer writes to taste rather than showing it in full — `plannedAutoLineup`'s strategy body (Task 4), `openProposalsNaming`'s held-trade extension (Task 5), the four component bodies (Tasks 5, 6, 8), `seedRealisticCorpus` (Task 1), the `changedPlayers` clause set (Task 4) and `draftScheduleView`'s formatter (Task 6) — and each names the existing file in this repo whose shape it copies (`src/league/lineup.ts`'s `defaultLineup`, `src/league-service/trades.ts`'s own sweep, `src/league-room/components/lineup-editor.tsx` and `trade-card.tsx`, `src/db/index-plans.test.ts`'s existing builders, `src/stats-pipeline/correction.ts`'s `correctionOutcome`, `src/league/terms.ts`), which is a pointer to real code rather than a placeholder.

**Type consistency:** `ParticipationTier`, `TierComposition`, `SystemActionVisibility` and `MissedDeadlineLineupStrategy` are each declared once as a `readonly` tuple with the union derived from it, the shape `REALTIME_EVENT_TYPES`, `AUDIT_EVENT_TYPES`, `SYSTEM_ACTION_CODES` and `TRADE_STATUSES` all already use. `PARTICIPATION_TIER_LABEL`, `PARTICIPATION_TIER_BLURB`, `TIER_COMPOSITION_LABEL`, `SYSTEM_ACTION_VISIBILITY`, `DECISION_WIRED_FOR`, `DECISION_OWNER`, `NOTICE_FOR_DECISION`, `NOTE_REACHES_SOMEONE_ELSE` and `DECISION_LABEL` are exhaustive `Record`s over those unions, so a member added without a decision is a compile error. `ParticipationSummary` is one interface produced by `participationFor` and narrowed nowhere; the browse contract carries `tierComposition` as the two counts and `draftAt` as an ISO string, with `Date` appearing only at the Drizzle boundary — the discipline `AuditEvent`, `IntegrityFlag` and `TradeProposal` all keep. `held` and `blocked` join `TRADE_STATUSES` and are answered by `nextStatusFor`, `transitionIsLegal` and `TERMINAL_STATUSES`, all three exhaustive. Nothing in this plan declares a second type named for something that already has one: the computed tier is `ParticipationTier` and never `ExperienceTier`, which is ruling 1 expressed as a type rather than as a convention.

**Boundary check:** `src/participation/**` is pure, has no Node import, no clock and no database, and joins `eslint.config.mjs`'s client-boundary **exempt** list beside the seven that are already on it; `src/league-room/components/browse-filters.tsx` value-imports `PARTICIPATION_TIER_LABEL` and `import type`s `ParticipationSummary`, which is the boundary unchanged. `src/league-service/**`, `src/draft-service/**`, `src/integrity/**`, `src/integrity-service/**` and `src/stats-pipeline/**` stay on the blocked list and nothing here asks browser code to value-import any of them. `src/league-service/participation.ts` imports `@/participation` and `@/db`; `src/league-service/auto-lineup.ts` imports `@/league` and `@/domain/roster-eligibility`, both server-side and both already imported by that directory. `src/draft-service/auto-start.ts` imports `@/league-service/enforcement` — a service importing a sibling service, which the boundary rule does not police and which runs in the one direction that already exists (`draft-service` → `league-service` at `commit.ts`). `src/components/app-shell/notices-provider.tsx` is a client component importing only `@/account-room/hooks`, which is browser code importing browser code. `src/app/**` is exempt by design. Nothing under `src/**` imports `scripts/**`, which the existing eslint ban enforces, and this plan adds no script at all.

**Founder rules:** four persona panels, each a marked controller step, split by audience because a blocked stranger, two managers waiting on a human, a commissioner planning a Saturday and a reader judging a review are four different people with four different fears. Every user-facing string quoted in this plan is em-dash and en-dash free and written in the active voice, which is not a preference here — `copyViolations` bans both dashes, every `accusatoryTerm` and every `passiveConstruction`, and five sweeps run it. No new UI primitive and no new icon (ruling 22). No mock data on a real surface: every one of the four mechanisms fires in the seed through the real path (ruling 24). Nothing is built in a shape a later phase throws away — the participation read model is what a real-money phase adds a prize-win signal to, `SYSTEM_ACTION_VISIBILITY` admits a new code as a row, `DECISION_WIRED_FOR` admits a new subject as a column, and the missed-deadline strategy admits a second arm as a compile error rather than a silent default.

**Four things this plan deliberately does not do, stated so none is mistaken for an oversight.** It does not add a **production scheduler**; the draft auto-start rides the ticker that already exists and the audit-chain walk stays Phase 2 Plan D's, with the reconciliation written down rather than assumed (ruling 23). It does not add an **account action of any kind**; Step 2's flag-only contract is unchanged, `flag-only.test.ts` grows to cover one more directory, and the strongest thing this plan can do to a person is refuse them a seat and tell them why. It does not add **`best_legal_lineup`**, because an unimplemented enum arm is the control wired to nothing this phase has refused four times, and founder decision #9's veto costs one arm in one exhaustive switch (ruling 9). And it does not give a held trade an **expiry**; founder decision #10 says no expiry and the reason it is safe to default that way is the same reason Plan C's proposals expire lazily — this product has one dev ticker and no production scheduler, and a timer that quietly kills two people's agreed trade while nobody is watching would be a worse answer than a queue an operator can see.

## The founder-gated bucket, unchanged

Nothing in this plan is blocked on any of it. Listed so no task quietly assumes one arrived.

| Gate | What this plan ships without it |
|---|---|
| Platform-verified client IP (Fly's proxy overwriting `X-Forwarded-For`) + Redis-shared limiter counters — LAUNCH-BLOCKING since Phase 2 Plan C | `INTEGRITY_CONFIG.multiAccount.weights.ip` stays **0**, untouched by this plan, and the ceiling assertion that reddens if any weight moves stays green. This plan's own release gate is the same shape and is now satisfied rather than pending: `autoHoldThreshold` was the value Plan C pinned at `null`, and Task 1 step 2 is where it becomes a number with a plan behind it |
| An email sender (`channelStatus.email` → `"live"`) | In-app delivery only, over the durable notice row and the activity feed. Five new notice types, none of which can be emailed, and the catalog still says so honestly with no switch beside it |
| A production scheduler | The draft auto-start ships as a real local mechanism on `instrumentation.ts`'s existing ticker, proved idempotent across two connections, with the production cadence a deployment decision rather than a rewrite. The audit-chain walk stays Phase 2 Plan D's (ruling 23) |
| Production admin bootstrapping | Seeded locally; the grant is founder decision #12's guarded script, unchanged. The two new resolution decisions need an operator and an operator needs a grant, which is the same bar Plan B already set |
| An object store | Custom avatar upload stays Phase 2 Plan D's. This plan renders no image it does not already have |
| Any real account action tied to money holds | Explicitly out of scope per the spec, and now provably so for one more directory |
