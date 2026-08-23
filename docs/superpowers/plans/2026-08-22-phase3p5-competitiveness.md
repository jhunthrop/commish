# Phase 3.5 — The competitiveness pass: formats, the clock, and the lobby that fills

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before any money moves, make the site experience *correct* against the field we intend to beat. The competitive analysis (`docs/research/2026-08-20-game-types-and-lobby-strategy.md`) named eight concrete build items and one liquidity doctrine; Phase 3 shipped two of the eight. This plan ships the six that are real product today, rules the seventh out with its reasoning written down, and repays the UX debts three persona panels filed against exactly this pass.

**Architecture:** Five strands. **(1) The canonical format grows two toggles that do not fragment the pool.** Superflex is a named slot in a config row (`eligiblePositions` is already data, so the engine changes nothing) and the league median game is one number per league week, written by the one transaction that already holds every team's score. Both are §4.1's doctrine applied literally: *variety in toggles, not queues.* **(2) The clock learns to be humane.** An overnight pause (2am to 5am Eastern) freezes the per-pick clock in the slow tiers only, and it is a **command-time and view-time** concept, never a reducer one, so a pause table changed after a draft started cannot brick replay. **(3) The timeout stops being punitive.** A team with a queue has consented to a pick being made for them and is autopicked exactly as today; a team with no queue, in a slow tier, is **skipped** and owed that pick, which it may redeem at any moment and which the draft settles before it can complete. **(4) The order stops being pure luck.** Managers rank the draft slots they want; the same seeded draw runs, and each drawn manager takes their highest still-free choice, NFFC's Kentucky Derby System on our own randomizer. **(5) The lobby fills.** A sit-and-go league writes a kickoff time the instant its last seat fills, and Phase 3 Plan D's auto-start scanner presses the button that already exists, which means the fill trigger is **a time, not a second start path** — and because the clock ladder is anchored to that same kickoff, a pod that fires in five minutes drafts at the ladder's floor with no second mechanism. The waiting room, the browse card that shows a league nearly full, and the create form's promoted "Who it's for" control are the surfaces that make all of it visible.

**Tech Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · `Intl.DateTimeFormat` (the one timezone dependency, and it is a platform built-in) · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright.

**Spec:** There is no `plans/phase-3p5-*.md`, and this plan does not invent one. Its specification is the founder's directive of 2026-08-22 (*"before payments, make sure the site experience is correct: the competitive-analysis findings and the core-product improvements needed to be competitive"*) read against two research documents: `docs/research/2026-08-20-game-types-and-lobby-strategy.md` (§1 the three lobby models, §4.1 the liquidity doctrine, §4.2 the sequenced league-type strategy, §4.3 the eight build items) and `docs/research/2026-08-16-beating-apex-strategy.md` §4/§4.1 (filter-and-browse transparency, the AI moderator replacing Apex's human, never a dead end). Per-operator sources with URLs: `docs/research/sources/research-ffpc-nffc.md`, `research-bestball-lobbies.md`, `research-apex-sleeper-formats.md`.

**Depends on all of Phase 3, merged** (`main` at `e46c68b`). It **does not depend on Phase 2 Plan D** or on Phase 4. Every founder gate is listed at the bottom and none of them blocks a task here.

**This is an interstitial phase, not a renumbering.** `plans/00-roadmap.md`'s nine phases are unchanged and Phase 4 (payments) remains the next roadmap phase. Phase 3.5 is a founder-ordered pass over the core product; Task 11 records it in the roadmap as exactly that, so a later reader does not go hunting for a tenth phase file.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope**, not quality. Nothing gets built in a form a later phase plans to throw away — which is why a skipped pick is owed and settled rather than forgiven, why the median is a stored number rather than a page-time recomputation, and why the fill trigger reuses the auto-start scanner instead of growing a second way to start a draft.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism."* Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree; they all talk to one shared stack.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let`). **This plan adds a member to `RosterSlotType` in `src/domain/roster.ts`** and therefore writes under those rules.
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`, `src/draft-service/index.ts`'s `systemClock`). **The overnight pause is the sharpest test this rule has had**: it needs a calendar and a timezone, and it gets neither from the environment — the window is an explicit input on `DraftConfig`, and every function that reads it takes the instant as an argument.
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. `users.id` **is** the WorkOS user id. API and SSE routes never redirect — they return a JSON 401 themselves. **`teamId` and `weekNumber` are always resolved from the authenticated session and the server's own schedule, never from a request body** (Plan C's collusion-evasion finding, permanent). This plan adds two client-submitted payloads — a draft-slot ranking and a create-form roster shape — and neither carries a team id, a league id it did not already prove membership in, or a time.
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. **This plan adds no realtime event type** (ruling 20): the pause and the skip ride `DraftClockView` on every existing `draft.*` payload, a fill-triggered start publishes the same `draft.status` frame a commissioner's press produces, and every member-facing consequence reaches its member through Plan A's `notice.created` frame.
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. Every accepted action is persisted before it is cached or published. **The reducer may read only the action log and prior state, never a module-level tunable** (`src/draft-engine/reduce.ts:9-14`, `admit.ts:10-26`): anything a deploy can flip lives in `admit.ts` or in `DraftConfig`, consumed at command time and at view time only. The 60s → 90s clock-floor change that once turned every persisted `TIMER_EXPIRE` into a permanent 500 is the in-code precedent, and **the overnight pause is the single most dangerous place in this plan to forget it** (ruling 8).
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**`, `src/chat-room/**`, `src/admin-room/**` and `src/account-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/review-service`, `@/identity-service`, `@/integrity`, `@/integrity-service`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond`, `@/data/seed`, `@/stats-pipeline`, `@/stats` or `@/gifs` as VALUES. `import type` stays allowed. The exempt pure directories browser code MAY value-import are the eight already on the list: `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews`, `src/moderation`, `src/trades`, `src/participation`. **This plan adds no ninth** (ruling 21). The rule is deliberately **not** applied to `src/app/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations and key formats live in a `config.ts` next to the module that uses them. This plan adds fields to `DRAFT_CLOCK_SCHEDULE`'s neighbours in `src/draft-engine/config.ts` (the pause window, the skip policy), to `LEAGUE_CONFIG` (the roster shape default, the median default) and to `MATCHMAKING_CONFIG` (the sit-and-go grace). **It adds no new config file** (ruling 22).
- **Tests. Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/draft-engine`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **The no-write-before-a-committed-refusal test class.** Plan C's Task 5 review caught a CRITICAL: a plain `return` after a status stamp committed a false `accepted` state. The standing rule since: **every refusal path of a transaction that has already written anything is asserted to have left the world unchanged.** This plan adds three such transactions and therefore three such helpers — `expectNoFillTriggerTookPlace`, `expectNoMedianWriteTookPlace`, `expectNoSlotPreferenceTookPlace` — each asserted on **every** refusal path of its writer, not on a representative one.
- **FK-lock enumeration in every lock-order entry.** Plan C's final review found a real `40P01` deadlock caused by an `INSERT`'s implicit foreign-key `FOR KEY SHARE` that per-task lock proofs had waived, because parent-row locks are invisible at call sites. Binding: **every transaction this plan adds or extends enumerates its implicit FK acquisitions by name in its own docblock**, and `src/integrity-service/lock-order.test.ts` grows one entry per writer this plan adds or extends — **three** of them (the fill trigger, the median write, the slot-preference write). The task that touches the suite reads its current count off the file rather than trusting a number written here, because a plan quoting a count it did not measure is how a green test starts describing yesterday.
- **Coverage threshold: 100%** for the gated directories, configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block (an `include` entry with no threshold is not a gate at all). **Twenty-one** gated directories on `main`. **This plan adds none** (ruling 21) and deliberately places its new pure modules inside directories that are already gated: `src/draft-engine/pause.ts` (gate 2), `src/league/median.ts` and `src/league/roster-shape.ts` (gate 4), `src/draft-service/slot-preference.ts` (gate 18), `src/league-service/fill-trigger.ts` (gate 17). Verify with an **unfiltered** `npm run test:coverage` — a path-filtered coverage run reports the other gated directories at 0%.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). It authenticates with a sealed WorkOS test-directory session. **There is no dev auth bypass and none may be added.** `playwright.config.ts` pins `workers: 1` and `fullyParallel: false`; a spec relying on suite order names the file it depends on in its own comment.
- **Two e2e disciplines this repo learned the hard way, and both bind every spec here.** **(a) The SSR fake:** a server-rendered control is visible and "stable" before React attaches its handler, so a click that lands pre-hydration is a silent no-op with no request on the wire. Every interaction assertion is **click-and-verify, retried** against a receipt the click itself produces (`e2e/league-lifecycle.spec.ts:140-160` is the pattern), and a discriminator is chosen that only the hydrated page can render — never one the server also paints. **(b) Hardcoded counts:** a spec that asserts an absolute row count is asserting the seed, not the behavior. Count assertions are **relative** (a delta across the action) or derived from the page, and a count that must be absolute names the seed line it depends on.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy); once deployed, add with a DEFAULT or backfill in a separate migration. **Index rebuilds hold ACCESS EXCLUSIVE and nothing in this repo uses `CONCURRENTLY`** — named for the deploy era as a runbook step, never a migration against a live database. This plan ships **two** migrations, both additive, neither rebuilding an index on a hot table.
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. Fail fast with a clear message when a required var is missing. **This plan adds no environment variable.**
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional). **This plan's hardest case is a league that is filling and is not full**: the member cannot have the thing they came for (a draft, now), so the waiting room offers the things they can have — the seats still open and how to fill them, or the other leagues that are closer to firing.
- **Both themes are first-class.** Every surface is designed and tested in light and dark, via `inBothThemes` from `src/components/ui/test-utils.tsx`. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** The eighteen `IconName`s on `main`: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`, `info`, `shield`, `flame`, `anchor`, `rocket`, `crown`, `bolt`, `clover`. **This plan adds none** (ruling 23): `clock` is the paused clock and the countdown, `users` is a filling league, `shield` is the platform acting, `refresh-cw` is a skipped pick coming back around.
- **`PositionBadge` is the only way to render a position label; `SlotChip` is the only way to render a roster-slot letter that is not itself a position.** `SUPERFLEX` is a `SlotChip`, exactly as `FLEX` and `BENCH` already are.
- **Never set the display face on a paragraph.** It is a lettering face, not a reading face.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/decisions/data-layer-hardening.md`:**

- **Balance as rollup.** Any running total is a rollup row updated **in the same transaction** as each contributing write, over an append-only source table that stays the reconciliation source of truth. Never a `SUM()` on the read path. The threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one. **The league median obeys it exactly**: the unbounded half (score every team's lineup for a week) is already rolled up into `matchups.home_score`/`away_score` by `finalizeWeekInTx`, and the median of those is one more number written by that same transaction; the bounded half (fold a season's median results into one league's standings) is derived on the read path over at most eighteen rows.
- **PgBouncer transaction pooling forbids session state.** No `pg_advisory_lock`, no named prepared statements (`prepare: false` is unconditional), no `SET` outside a transaction, **no `LISTEN`/`NOTIFY`**. DDL goes through the direct port, never the pooler. **This binds the fill trigger**: it may not elect a leader, which is why it writes a time inside a transaction that already holds `leagues FOR UPDATE` and lets the existing guarded status transition do the starting (ruling 14).

**From `docs/decisions/audit-and-integrity.md` (Plan A's rulings, binding here):**

- **The audit append and the notice row are inside the business transaction and fail it; only the Redis frame is best-effort.** Every write in this plan obeys it.
- **The lock order is one global order and the audit anchor is ALWAYS the last lock**, where "lock" includes an implicit foreign-key `FOR KEY SHARE`. The permitted sequence is: business rows → notice insert → `audit.record` → `attachAuditEvent` → commit → `deliverNotice`.
- **A transaction appends to at most one chain.** `recordAll` throws on a batch spanning two.
- **`audit_events` carries no foreign keys and nothing ever deletes a row.** `AUDIT_EVENT_TYPES` is a pg enum whose docblock states *"no later migration ever runs `ALTER TYPE … ADD VALUE`"* — the vocabulary is **frozen**, so every new automated action in this plan rides `system_action` with a `payload.action` code, exactly as Plan D's four do (ruling 19).
- **Deny by default, on every visibility dimension.** `SYSTEM_ACTION_VISIBILITY` is exhaustive over `SystemActionCode`; a code with no decision does not compile. This plan adds two codes and therefore two compile-forced answers.

**From `docs/decisions/enforcement-and-tiers.md` (Plan D's rulings, binding here):**

- **`drafts.kickoff_at` is a time a human chose, the ladder's anchor, and the auto-start's due date, all at once.** Plan D made the first two true. This plan adds the third writer (a league filling) and states the conflation out loud rather than discovering it later (ruling 13).
- **The platform presses start only in a public matchmade league** (`ENFORCED_LEAGUE_SQL`), because that is the league with no trustworthy human commissioner. This plan does not widen that predicate (ruling 15).
- **`autoStartDueDrafts` claims with a guarded status transition, never with a lock**, and both the human door and the platform door funnel through `store.startDraft`. The fill trigger adds no third door.
- **Enforcement is checked at three named doors** (join, creation, and the invite door's deliberate mechanism-based exemption). This plan writes at the join door and therefore inherits the obligation to leave all three consistent.

**Founder rules (binding, from founder memory and the phase ledgers):**

- **No em-dashes in user-facing copy**, and here that rule has teeth: `copyViolations` (`src/integrity/copy-rules.ts`) is one rulebook enforcing three rules — no em **or en** dash, nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms`, nothing in `INTEGRITY_CONFIG.notices.passiveConstructions`. Five sweeps enforce it (`notices.test.ts`, `activity-view.test.ts`, `rendered-copy.test.tsx`, `room-copy.source.test.ts`, `script-copy.source.test.ts`), and Plan D's fix wave repaired the source sweep's template-literal blindness with a hand-walked parser. **Every user-facing sentence this plan writes is swept by the machinery as repaired**, and the two new notice templates are registry-derived so they are swept the commit they land.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. **Five panels in this plan** (Tasks 3, 5, 6, 8 and 9): a second result nobody asked for, a pick that passed while you were away, a slot draw you can influence, a league you are waiting on, and the form that decides who may sit down with you.
- **Centralize UI primitives the first time.** No page-local visual mapping; extract to `src/components/ui/` and refactor the existing consumer in the same commit. **This plan's one candidate is the countdown**, which `DraftSchedulePanel` and the draft room's `RoomRail` both already render differently; the sit-and-go waiting state is the third caller, and three is where the extraction happens (ruling 18).
- **No mock data on real surfaces.** The seed produces a genuinely superflex league, a genuinely median-scored season, a genuinely skipped-and-redeemed pick, a genuinely preference-honored draft order, and a genuinely fill-triggered draft, all through the real paths (ruling 24).
- **Verification agents never write review artifacts and never commit.** Plan D's governance disclosure is now a standing dispatch rule; every review dispatch in this plan repeats it.

---

## What is already true (read before touching anything)

Every "already exists" claim in the founder's brief was checked against `main` at `e46c68b`. Two were wrong in a way that changes the plan.

| The brief or the analysis assumes | Reality on `main` today |
|---|---|
| Draft date/time exists as a domain concept, with a commissioner surface and platform auto-start | **True, all three.** `setDraftKickoff`/`draftScheduleView`/`KICKOFF_REFUSALS` (`src/league-service/draft-schedule.ts`), `PUT /api/leagues/[leagueId]/draft-schedule`, `DraftSchedulePanel`, and `autoStartDueDrafts`/`claimAutoStart`/`dueDraftsQuery` (`src/draft-service/auto-start.ts`) on the existing ticker. §4.3 item 1 is **done** and is not re-planned. |
| Experience-tier segregation is enforced with honest browse composition labels | **True, at three doors**, with `compositionCategory` reduced to a coarse bucket server-side so an N=1 league cannot disclose one manager's computed tier. Not re-planned. |
| The auto-tightening ladder exists | **True and verbatim Underdog-shaped**: `DRAFT_CLOCK_SCHEDULE` is 8h → 4h → 1h → 10m → 90s keyed to `kickoffAt` (`src/draft-engine/config.ts:19-25`). `currentDeadline` derives from `turnStartedAt` and is **never persisted**. **There is no pause of any kind**, and `America/New_York` appears nowhere under `src/` — the only `Intl` timezone in the product pins **UTC** deliberately (`src/league/terms.ts:83-86`). |
| Native snake AND auction both exist | **True.** One reducer, both formats, `bestAvailableFor` the single autopick policy for both. |
| PPR / half-PPR / TE-premium presets exist | **True**, all four including `standard` (`src/domain/scoring.ts:54-66`). **But the preset name is never stored** — only the fifteen weights — and the label is re-derived by `describeScoring`. Anything this plan wants on a browse card must be derivable from stored columns, not from a remembered preset name. **`LEAGUE_CONFIG.defaults.scoringPreset` is `"ppr"`**, not the analysis's recommended half-PPR canon. |
| The median game is a small addition because the engine already scores every team | **Half true, and the good half is better than expected.** `scoreTeamsForWeek(db, leagueId, weekNumber, teamIds)` (`src/stats-pipeline/finalize.ts:66-71`) already returns every team's rounded weekly total, and `finalizeWeekInTx` already calls it with **every team in the league for that week** (line 223-224), inside the settlement transaction, in a deadlock-safe ordered loop. The bad half: **there is nowhere to put a toggle** (`scoring_settings` is fifteen flat `real` columns with no flags; `leagues` has no settings JSON but `roster_slots`), and **three places encode "one game per week"** that a median game breaks — `clinchedTeamIds`'s `firstOut.wins + weeksRemaining` ceiling, `seasonProgress.playedWeeks`, and `formatRecord`'s single `W-L`. |
| Superflex is "a config row, no engine work" | **Exactly true, and provably so.** `eligiblePositions` on each `RosterSlotConfig` **is** the eligibility map; `eligibleSlotsForPosition`, `validateRosterAdd`, `validateLineup`, `assignSlot` and `bestAvailableFor` all read it as data. A league could ship QB-in-flex **today** by writing `{ slot: "FLEX", count: 2, eligiblePositions: ["QB","RB","WR","TE"] }` into `leagues.roster_slots`. What does not exist is the **word**: `RosterSlotType` has no `SUPERFLEX` member, there is no roster-shape vocabulary, and **there is no per-league roster editor of any kind** — the shape is fixed at creation from `LEAGUE_CONFIG.defaults.rosterSlots`. |
| The draft order is a randomizer we can rank against | **True and better than expected.** `draftOrderFor(draftId, teamIds)` (`src/draft-service/order.ts:21-31`) is an FNV-1a hash of the draft id seeding `mulberry32`, over pre-sorted ids, so the draw is reproducible forever from the draft id and cannot be influenced by query order. It has **exactly one call site** (`store.startDraft`, `src/draft-service/store.ts:472`), the order is frozen into `StartDraftAction.draftOrder`, and `reduceStart` accepts any permutation. There is **no preferences storage of any kind**. |
| Skip-and-return is a tweak to the timeout | **It is the largest engine change in this plan.** `reduceSnakeExpiry` (`src/draft-engine/snake.ts:38-45`) autopicks instantly and `advanceSnake` unconditionally increments `pickNumber`; **there is no "skipped" concept anywhere in the state**, and `DraftState` has no field that could hold one. A skip that is not owed and settled would break the invariant every other part of the engine leans on — that every team fills the same number of roster slots. |
| A sit-and-go trigger needs a new start path | **It does not.** The admit flow (`joinLeagueInTx`) already takes `leagues FOR UPDATE` before counting seats and already knows the seat it just filled was the last one (`hasOpenSeat`, `src/league-service/join.ts:99-100`). The start path already exists and is idempotent across instances. **What is missing is the sentence between them**, and it is a `kickoff_at` write. |
| A fill meter is missing from browse | **Its absence is deliberate and documented.** `src/league-room/components/public-league-list.tsx:65-75`: *"Fill status is stated plainly ('3 of 12 joined') rather than drawn as a bar, because the number is the decision a visitor is actually making and a bar makes them estimate it."* This plan does **not** add a bar (ruling 16). What browse is missing is the *ordering* that makes a nearly-full league findable and the *sentence* that says a league starts the moment it fills. |
| Mock drafts need "some bots" | **There is no bot infrastructure at all, and the schema forbids one.** `teams.user_id` is a NOT NULL foreign key to `users.id` with a per-league unique index; there is no system user, no non-user seat, and the only autonomous drafter is a reducer branch fired by wall-clock expiry with no way to act immediately for a designated seat. Ruled OUT, with reasoning, in ruling 25. |
| The "Who it's for" control is hard to find | **Understated.** It is nested **two** disclosures deep: an outer `<details>` ("Start or join another league", closed by default, whose section order comes from `firstRunPathOrder` so `create` is not even guaranteed first) containing an inner always-closed `<details>` whose summary reads *"Advanced settings: draft format, team count, scoring"* and does not mention it, where it sits **sixth of seven** controls beside a similarly-worded `"Who can join"`. And `LEAGUE_CONFIG.maxCreateInteractions = 3` is asserted by a test, so any fix must not add a required interaction. |

---

## File Structure

**New — pure modules, every one inside an already-gated directory:**

| File | Responsibility |
|---|---|
| `src/draft-engine/pause.ts` | `PauseWindow`, `pausedMillisBetween`, `deadlineAfter`, `pausedUntil`, `zoneOffsetMinutes`. The overnight freeze, as arithmetic over explicit instants. Gate 2. |
| `src/league/roster-shape.ts` | `ROSTER_SHAPES`, `RosterShapeName`, `SUPERFLEX_ROSTER_SLOTS`, `describeRosterShape`, `ROSTER_SHAPE_LABEL`. The roster vocabulary, beside the league's other rules rather than in the ungated `src/domain`. Gate 4. |
| `src/league/median.ts` | `leagueMedian`, `medianResultFor`, `MedianResult`, `MEDIAN_RESULT_LABEL`. One number a week and what it does to a record. Gate 4. |
| `src/draft-service/slot-preference.ts` | `setSlotPreference`, `slotPreferencesFor`, `assignDraftSlots`, `SLOT_PREFERENCE_REFUSALS`. The Kentucky Derby draw. Gate 18. |
| `src/league-service/fill-trigger.ts` | `fireWhenFullInTx`, `fillTriggerOutcome`, `FILL_TRIGGER_REFUSALS`. A time, written by the transaction that filled the last seat. Gate 17. |

**Modified — the engine:** `src/domain/roster.ts` (`RosterSlotType` gains `SUPERFLEX`), `src/draft-engine/config.ts` (`DRAFT_PAUSE_WINDOW`, `DRAFT_SKIP_POLICY`), `src/draft-engine/state.ts` (`DraftConfig.pauseWindow`, `DraftState.owedPicks`), `src/draft-engine/selectors.ts` (`currentDeadline`/`nudgeDeadline` become pause-aware; `teamOnClock` and `upcomingOnClock` learn about owed picks; `draftClockView` gains `pausedUntil` and `owedPicks`), `src/draft-engine/snake.ts` (`reduceSnakeExpiry`'s three-way decision, `advanceSnake`'s catch-up turns), `src/draft-engine/apply-pick.ts` (redeeming an owed pick), `src/draft-engine/admit.ts` (the redemption's admission rule), `src/draft-engine/events.ts` (`draft.timer_expire`'s skipped payload), `src/draft-service/order.ts` (`draftOrderFor` takes preferences), `src/draft-service/store.ts` (the preference read at start, the skip notice), `src/draft-service/setup.ts` (`pauseWindow` injection).

**Modified — the season:** `src/stats-pipeline/finalize.ts` (the median write), `src/league/standings.ts` (`computeStandings` folds median results), `src/league/clinch.ts` (`weeksRemaining` becomes `gamesRemaining`), `src/league/schedule.ts` (`seasonProgress` untouched, and ruling 6 says why), `src/league-service/results.ts` + `src/league-service/home.ts` (the medians the standings need, read without an N+1), `src/league-service/read.ts` (`MatchupSummary`'s median line), `src/league/terms.ts` (the format sentences a prospect reads).

**Modified — the lobby:** `src/league-service/join.ts` (the fill trigger call), `src/league-service/creation.ts` (roster shape, median toggle, start trigger), `src/league-service/browse.ts` (the two new fields, the fills-soonest order), `src/league-service/draft-schedule.ts` (the sit-and-go view and its refusal), `src/matchmaking/contract.ts` + `filter.ts` + `config.ts` (`PublicLeagueSummary`'s eleventh and twelfth fields, `MATCHMAKING_CONFIG.sitAndGo`), `src/league-service/schemas.ts`.

**Modified — integrity:** `src/integrity/system-actions.ts` (two codes, two compile-forced visibilities), `src/integrity/notices.ts` (two templates), `src/integrity/test-support.ts` (`NOTICE_SAMPLES`), `src/integrity-service/lock-order.test.ts` (three writers, 11/11 → 14/14).

**Modified — the browser:** `src/league-room/components/create-league-form.tsx`, `draft-schedule-panel.tsx`, `public-league-list.tsx`, `browse-filters.tsx`, `standings-table.tsx`, `matchup-panel.tsx`, `league-terms-panel.tsx`, `src/draft-room/components/room-rail.tsx`, `player-pool.tsx`, `room-dock.tsx`, `src/draft-room/components/countdown.tsx` (moved to `src/components/ui/`, Task 8), `src/draft-room/state/config.ts`, `format.ts`, `payloads.ts`, `src/help/glossary.ts`.

**New — routes, pages and components:**

| File | Responsibility |
|---|---|
| `src/app/api/leagues/[leagueId]/slot-preference/route.ts` | `GET`/`PUT` one team's ranked draft slots. |
| `src/components/ui/countdown.tsx` | The one countdown primitive, extracted at its third caller. |
| `src/league-room/components/slot-preference-panel.tsx` | Ranking the slots, with named move controls and never drag-only. |
| `src/league-room/components/waiting-room.tsx` | A league filling, a league full, and what happens next. |
| `src/league-room/components/median-result.tsx` | The second result, wherever a week's score is shown. |

**New migrations:** `drizzle/0030_median_game.sql`, `drizzle/0031_sit_and_go_and_slots.sql`.

**New docs:** `docs/decisions/formats-and-lobby.md`.

**Modified docs:** `docs/conventions.md`, `docs/league.md`, `docs/draft-engine.md`, `docs/draft-moderator.md`, `docs/design-system.md`, `docs/decisions/enforcement-and-tiers.md`, `plans/00-roadmap.md`, `README.md`.

**New e2e:** `e2e/formats-and-lobby.spec.ts`.

---

## Task 1: Superflex, and the canonical format's defaults

The analysis calls superflex "a config row, no engine work" and it is right — `eligiblePositions` is data and every consumer reads it as data. What the product lacks is the **word**: no `SUPERFLEX` slot type, no roster-shape vocabulary, and a create form that offers no roster choice at all. This task adds the vocabulary, the one config row, and the two canon defaults §4.2 names.

**Files:**
- Create: `src/league/roster-shape.ts` (+ its test)
- Modify: `src/domain/roster.ts` (+ its test), `src/league/config.ts`, `src/league-service/creation.ts` (+ its test), `src/league-service/schemas.ts`, `src/components/ui/slot-chip.tsx`, `src/help/glossary.ts` (+ its test)
- Modify: `src/draft-engine/slotting.test.ts`, `src/league/lineup.test.ts` (the two gated proofs that stand in for `src/domain`'s missing gate)
- Modify: `src/league-room/components/create-league-form.tsx` (+ its test)

**Interfaces:**
- Consumes: `RosterSlotConfig`, `STANDARD_ROSTER_SLOTS`, `assignSlot`, `validateLineup`, `eligibleSlotsForPosition`, `SCORING_PRESETS`, `LEAGUE_CONFIG.defaults`.
- Produces: `RosterSlotType["SUPERFLEX"]`, `ROSTER_SHAPES`, `RosterShapeName`, `describeRosterShape`, `ROSTER_SHAPE_LABEL`, `CreateLeagueInput.rosterShape`.

- [ ] **Step 1: Write the failing eligibility tests, in the two directories that are gated**

```ts
// src/draft-engine/slotting.test.ts — the draft's half of the proof
it("puts a second quarterback in SUPERFLEX rather than on the bench", () => {
  const roster = filled(SUPERFLEX_ROSTER_SLOTS, { QB: 1 });
  expect(assignSlot({ position: "QB", roster, slotConfig: SUPERFLEX_ROSTER_SLOTS }))
    .toMatchObject({ ok: true, slot: "SUPERFLEX", slotIndex: 0 });
});

it("still benches a second quarterback under the standard shape, so the shape is what changed", () => {
  const roster = filled(STANDARD_ROSTER_SLOTS, { QB: 1 });
  expect(assignSlot({ position: "QB", roster, slotConfig: STANDARD_ROSTER_SLOTS }))
    .toMatchObject({ ok: true, slot: "BENCH" });
});

it("fills FLEX before SUPERFLEX for a running back, because config order is the priority", () => {
  // SUPERFLEX sits after FLEX and before K in ROSTER_SHAPES.superflex. A running back is
  // eligible for both, and `assignSlot` takes the first eligible slot in config order, so the
  // narrower flex fills first and the superflex stays available for the position only it accepts.
  const roster = filled(SUPERFLEX_ROSTER_SLOTS, { RB: 2, WR: 2, TE: 1 });
  expect(assignSlot({ position: "RB", roster, slotConfig: SUPERFLEX_ROSTER_SLOTS }))
    .toMatchObject({ ok: true, slot: "FLEX" });
});

it("adds exactly one round to the draft, because rounds are the sum of slot counts", () => {
  expect(totalRosterSlots(SUPERFLEX_ROSTER_SLOTS)).toBe(totalRosterSlots(STANDARD_ROSTER_SLOTS) + 1);
});
```

```ts
// src/league/lineup.test.ts — the season's half
it("accepts a quarterback started in SUPERFLEX", () => {
  expect(validateLineup({ starters: superflexStarters(), slotConfig: SUPERFLEX_ROSTER_SLOTS }))
    .toEqual({ ok: true });
});

it("refuses a kicker in SUPERFLEX, and says which positions it takes", () => {
  expect(validateLineup({ starters: withSlot(superflexStarters(), "SUPERFLEX", kicker), slotConfig: SUPERFLEX_ROSTER_SLOTS }))
    .toMatchObject({ ok: false, reason: expect.stringContaining("SUPERFLEX") });
});
```

- [ ] **Step 2: The vocabulary, in `src/league`, not in `src/domain`**

`RosterSlotType` gains `"SUPERFLEX"` in `src/domain/roster.ts` — the type has to live where the type lives, and adding the member turns every exhaustive `Record<RosterSlotType, …>` in the product into a compile error, which is the point of adding it there and nowhere else. Everything else lands in the new `src/league/roster-shape.ts`:

```ts
export const SUPERFLEX_ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 2, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "SUPERFLEX", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
  { slot: "K", count: 1, eligiblePositions: ["K"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: BENCH_SLOT, count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

export const ROSTER_SHAPES = { standard: STANDARD_ROSTER_SLOTS, superflex: SUPERFLEX_ROSTER_SLOTS } as const;
export type RosterShapeName = keyof typeof ROSTER_SHAPES;
```

`describeRosterShape(slots)` mirrors `describeScoring` exactly, and for the same reason: **the shape name is never stored** (only the jsonb rows are), so every label anybody reads is re-derived from what is actually in the column. It returns `"Superflex"` when a `SUPERFLEX` slot is present, `"Standard"` when the rows equal `STANDARD_ROSTER_SLOTS`, and `"Custom"` otherwise — the same three-way honesty `describeScoring` already gives a browse card.

- [ ] **Step 3: The canon defaults**

`LEAGUE_CONFIG.defaults.scoringPreset` becomes `"half_ppr"` and `LEAGUE_CONFIG.defaults.rosterShape` is added as `"standard"`. §4.2's launch canon is *"half-PPR default with PPR / TE-premium / superflex toggles"*, and half-PPR is the trend consensus the analysis found across Underdog's own tournament default. This changes **defaults only**: all four presets stay offered, every existing league keeps the fifteen weights it was created with (the preset name was never stored, so there is nothing to migrate), and the create form's own Scoring select is unchanged except for which option is preselected. The test that pins it says so:

```ts
it("creates a half-PPR league by default, and leaves every other preset reachable", async () => {
  const league = await createLeague(deps, { userId: "u_alice", name: "Sunday Money" });
  expect(await scoringLabelOf(db, league.id)).toBe("Half PPR");
  expect(Object.keys(SCORING_PRESETS)).toEqual(["standard", "ppr", "half_ppr", "te_premium"]);
});
```

- [ ] **Step 4: The create form's roster choice, and the one place the words come from**

`CreateLeagueInput` gains `rosterShape: RosterShapeName` (the service resolves it to rows through `ROSTER_SHAPES`; `rosterSlots` stays on the input for the seeds and the integration pipeline that already pass explicit rows). The form gains a **Roster shape** select inside the advanced drawer, options built from `ROSTER_SHAPE_LABEL` the same way the scoring select is built from its label map — never typed at the call site. `SlotChip` renders `SUPERFLEX`; `PositionBadge` does not, because superflex is not a position.

- [ ] **Step 5: Glossary**

`superflex` joins `GLOSSARY` with a short line a first-timer can act on: "A flex spot that also accepts a quarterback, so most teams start two." `InfoTip` at the roster-shape select and beside the `SlotChip` in the lineup editor is how it reaches the page, and `helpLevel="guided"` prints it inline for the managers who asked for that.

- [ ] **Step 6: Commit**

---

## Task 2: The league median game — one number a week, and the record it changes

Apex's one genuine product idea, given away free by Sleeper, and our scoring engine already computes the input. §4.2: *"Adopting it neutralizes Apex's signature differentiator at near-zero cost."* Near-zero is accurate for the number and wrong for the arithmetic around it: three places in this codebase assume one game per week.

**Files:**
- Create: `src/league/median.ts` (+ its test), `drizzle/0030_median_game.sql`
- Modify: `src/db/schema.ts`, `src/stats-pipeline/finalize.ts` (+ its test), `src/stats-pipeline/correction.ts` (+ its test), `src/league/standings.ts` (+ its test), `src/league/clinch.ts` (+ its test), `src/league-service/results.ts` (+ its test), `src/league-service/home.ts` (+ its test), `src/league-service/creation.ts`, `src/league-service/schemas.ts`

**Interfaces:**
- Consumes: `scoreTeamsForWeek`, `finalizeWeekInTx`, `roundPoints`, `computeStandings`, `clinchedTeamIds`.
- Produces: `leagueMedian`, `medianResultFor`, `weeks.median_score`, `leagues.median_game`, `computeStandings`'s `medianByWeek` input, `clinchedTeamIds`'s `gamesRemaining`.

- [ ] **Step 1: Write the failing median tests**

```ts
// src/league/median.test.ts
it("averages the two middle scores in an even league, on the same rounding the scores use", () => {
  expect(leagueMedian([100, 110, 120, 130])).toBe(115);
  expect(leagueMedian([100.01, 110.02, 120.03, 130.04])).toBe(roundPoints((110.02 + 120.03) / 2));
});

it("takes the middle score in an odd league, which is what a bye week leaves behind", () => {
  // An odd team count gets a BYE in `generateSchedule` and the bye team has no matchup, so it
  // has no score that week and plays no median game. The median is over the teams that played.
  expect(leagueMedian([100, 110, 130])).toBe(110);
});

it("has no median for a week nobody played", () => {
  expect(leagueMedian([])).toBeNull();
});

it("counts a score equal to the median as a tie, in both directions", () => {
  expect(medianResultFor(115, 115)).toBe("tie");
  expect(medianResultFor(115.01, 115)).toBe("win");
  expect(medianResultFor(114.99, 115)).toBe("loss");
});
```

```ts
// src/league/standings.test.ts
it("gives every team a second result each week when the median is on", () => {
  // Twelve teams, one week, scores 1..12. The median is 6.5, so six teams beat it and six do not:
  // the median game cannot invent wins for the league as a whole, it redistributes them.
  const rows = computeStandings({ teamIds, matchups: weekOne, medianByWeek: new Map([[1, 6.5]]) });
  expect(rows.reduce((n, r) => n + r.wins, 0)).toBe(12);
  expect(rows.reduce((n, r) => n + r.wins + r.losses + r.ties, 0)).toBe(24);
});

it("leaves points for and points against alone, because the median is not an opponent", () => {
  const withMedian = computeStandings({ teamIds, matchups: weekOne, medianByWeek: new Map([[1, 6.5]]) });
  const without = computeStandings({ teamIds, matchups: weekOne });
  expect(withMedian.map((r) => r.pointsFor)).toEqual(without.map((r) => r.pointsFor));
  expect(withMedian.map((r) => r.pointsAgainst)).toEqual(without.map((r) => r.pointsAgainst));
});

it("ignores a week whose median is absent, exactly as it ignores a half-scored matchup", () => {
  expect(computeStandings({ teamIds, matchups: weekOne, medianByWeek: new Map() }))
    .toEqual(computeStandings({ teamIds, matchups: weekOne }));
});
```

- [ ] **Step 2: The column, the toggle, and where each lives**

`drizzle/0030_median_game.sql`, hand-written, two additive statements:

```sql
ALTER TABLE "leagues" ADD COLUMN "median_game" boolean NOT NULL DEFAULT false;
ALTER TABLE "weeks" ADD COLUMN "median_score" real;
```

The toggle is on `leagues` and not on `scoring_settings` because a median game is a **season structure**, not a scoring weight: `scoring_settings` is fifteen `real` columns that answer "what is a catch worth", and `describeScoring` derives its label from exactly those. The stored number is on `weeks`, whose primary key is already `(league_id, week_number)` and which has carried no other column since Phase 1 — one row per league week is precisely the cardinality of one median per league week, so this is the table that already exists for the fact.

- [ ] **Step 3: The write, in the transaction that already knows every score**

`finalizeWeekInTx` builds `scores` for every team in the league's week at line 224 before it writes a single matchup. The median is computed from that map and written with the matchup scores, inside the same transaction:

```ts
it("writes the week's median beside the scores it was computed from", async () => {
  await finalizeWeek(db, leagueId, 1);
  expect(await medianOf(db, leagueId, 1)).toBe(leagueMedian([...(await scoresOf(db, leagueId, 1)).values()]));
});

it("recomputes the median when a stat correction re-settles the week", async () => {
  // `correctSettledWeek` re-runs settlement inside the three-day correction window and
  // OVERWRITES scores. A median left at its first value would describe a week that no longer
  // exists, so the write is an overwrite, not a one-way stamp, and this is the difference
  // between it and `leagues.season_completed_at`, which is deliberately one-way.
  await correctSettledWeek(db, { leagueId, weekNumber: 1 });
  expect(await medianOf(db, leagueId, 1)).toBe(recomputedMedian);
});

it("writes no median for a league that has the toggle off", async () => {
  await finalizeWeek(db, plainLeagueId, 1);
  expect(await medianOf(db, plainLeagueId, 1)).toBeNull();
});
```

**FK acquisitions, enumerated:** `finalizeWeekInTx` already holds `matchups` rows (FK `FOR KEY SHARE` on `leagues` and on `teams`) in `ORDER BY home_team_id`. The median `UPDATE weeks SET median_score` takes that row's lock and an FK `FOR KEY SHARE` on `leagues` — **a lock the transaction already holds**, so the global order is unchanged and the entry in `lock-order.test.ts` says so with the acquisition named rather than assumed. The update is ordered **after** the matchup writes and **before** `stampSeasonCompleteInTx`, so a median can never be written for a week whose scores rolled back. `expectNoMedianWriteTookPlace` asserts it on every refusal path of `checkFinalizeGuards`.

- [ ] **Step 4: The clinch arithmetic, corrected rather than papered over**

`clinchedTeamIds({ standings, weeksRemaining, playoffTeams })` computes `ceiling = firstOut.wins + weeksRemaining`. With a median game every remaining week is worth **two** wins, so the parameter is renamed to `gamesRemaining` and the caller multiplies. The rename is the fix: a parameter called `weeksRemaining` that must sometimes hold games is exactly the silent wrongness Plan D's `maxDraftDaysFromCreation` rename already corrected once in this codebase.

```ts
it("refuses to clinch anybody a median game could still catch", () => {
  // Two weeks left, median on, so four wins are still available to the first team outside the cut.
  expect(clinchedTeamIds({ standings, gamesRemaining: 4, playoffTeams: 6 })).toEqual([]);
  expect(clinchedTeamIds({ standings, gamesRemaining: 2, playoffTeams: 6 })).toContain("t_leader");
});
```

- [ ] **Step 5: The read paths, with no N+1**

`leagueStandings` reads the league's `weeks` rows for their medians in the same round trip shape it already reads matchups. `crossLeagueHome` computes standings **per league in a loop** (`home.ts:82-95`), and a per-league median query inside that loop would be exactly the N+1 the data-layer rules forbid: the medians for every league the user is in are fetched in **one** grouped query before the loop and handed in. The test is a query count, not a comment:

```ts
it("reads every league's medians in one query, however many leagues a manager is in", async () => {
  const counted = countingDb(db);
  await crossLeagueHome(counted, userId, deps);
  expect(counted.queriesMatching(/from "weeks"/)).toBe(1);
});
```

- [ ] **Step 6: Commit**

---

## Task 3: The median where a manager reads it

A second result that appears only in the standings total is a rule people will believe we got wrong. This task puts it on the three surfaces where a week is actually read, and on the two a stranger reads before joining.

**Files:**
- Create: `src/league-room/components/median-result.tsx` (+ its test)
- Modify: `src/league-service/read.ts` (+ its test), `src/league-room/contract.ts`, `src/league-room/components/matchup-panel.tsx`, `standings-table.tsx`, `league-terms-panel.tsx`, `public-league-list.tsx` (+ their tests)
- Modify: `src/league/terms.ts` (+ its test), `src/matchmaking/contract.ts`, `src/league-service/browse.ts` (+ its test), `src/help/glossary.ts`

**Interfaces:**
- Consumes: `medianResultFor`, `MatchupSummary`, `leagueTerms`, `PublicLeagueSummary`.
- Produces: `MatchupSummary.median`, `LeagueTerms.formatNotes`, `PublicLeagueSummary.medianGame`.

- [ ] **Step 1: The matchup page's second line**

`matchupWeek` already renders both teams' starters and totals. `MatchupSummary` gains `median: { score: number; homeResult: MedianResult; awayResult: MedianResult } | null`, and `MedianResultLine` renders one sentence per team: **"You scored 118.4. The league median was 104.2, so you won that one too."** Null when the toggle is off, and null when the week has no median yet, which is the same state as a week with no scores and reads the same way.

- [ ] **Step 2: The standings table says what a record contains**

`formatRecord` is unchanged and stays one record, because the median game **is** a game — a second record column would say the opposite of what the format means. What the table gains is a caption note and an `InfoTip` on the Record header pointing at the new `median-game` glossary term: **"Records include each week's median game."** One sentence, on the surface where the number could otherwise be misread.

- [ ] **Step 3: The two surfaces a prospect reads before committing**

`leagueTerms` gains a `formatNotes` list rendered by `LeagueTermsPanel` on the invite preview (reachable signed out) and on league home: **"Every team also plays the league median each week."** and, from Task 1, **"Superflex: you can start a second quarterback."** One list, two sentences, both derived from stored columns rather than from a remembered preset name.

`PublicLeagueSummary` gains `medianGame: boolean` as its **eleventh** field. That is a disclosure decision and gets the same reasoning `draftAt` and `scoringLabel` got: how a league decides a week is a fact about the league, not about any person in it, and a visitor who cannot see it cannot tell what game they are joining. `browse.test.ts`'s key-set assertion is what makes the addition deliberate rather than accidental.

- [ ] **Step 4: Persona panel — a result nobody asked for**

Veteran, casual, commissioner, first-timer. The questions: does the veteran understand instantly that this halves schedule luck (it is his reason to prefer us to Apex, and if he has to ask, the sentence is wrong); does the casual manager read "you won that one too" as a consolation prize or as a real result; does the commissioner understand the toggle is set at creation and not changeable mid-season, and does the form say so; and the first-timer's question, which is the sharp one: **"So I play two games a week?"** The panel decides whether the standings note is enough or whether league home needs the sentence too.

- [ ] **Step 5: Commit**

---

## Task 4: The overnight pause

FFPC freezes 2am to 8am ET; Underdog freezes 2am to 5am and lets the pause drop away once the clock has tightened. Our ladder is Underdog's ladder and gets Underdog's pause. This is the smallest feature in the plan and the one with the most ways to be quietly wrong.

**Files:**
- Create: `src/draft-engine/pause.ts` (+ its test)
- Modify: `src/draft-engine/config.ts`, `src/draft-engine/state.ts`, `src/draft-engine/selectors.ts` (+ its tests), `src/draft-service/setup.ts` (+ its test), `src/draft-service/nudge.ts` (+ its test)
- Modify: `src/draft-room/state/payloads.ts`, `src/draft-room/state/format.ts` (+ its test), `src/draft-room/components/room-rail.tsx` (+ its test), `src/league-room/components/draft-schedule-panel.tsx`

**Interfaces:**
- Consumes: `currentDeadline`, `currentTier`, `nudgeDeadline`, `DraftConfig`, `Intl.DateTimeFormat`.
- Produces: `PauseWindow`, `pausedMillisBetween`, `deadlineAfter`, `pausedUntil`, `DRAFT_PAUSE_WINDOW`, `DraftClockView.pausedUntil`.

- [ ] **Step 1: Write the failing pause tests, including both DST edges**

```ts
// src/draft-engine/pause.test.ts
const ET: PauseWindow = { zone: "America/New_York", startHour: 2, endHour: 5, appliesAtOrAbovePickSeconds: 60 * 60 };

it("pushes a deadline that would land inside the window out to the far side of it", () => {
  // A four-hour pick clock started at 11:30 PM ET would expire at 3:30 AM ET, inside the freeze.
  // Awake time is what the manager actually gets: 11:30 PM to 2:00 AM is two and a half hours,
  // and the remaining ninety minutes run from 5:00 AM. The answer is a FIXPOINT, not one
  // addition: the first extension pushes the deadline INTO the rest of the window, so the
  // overlap has to be recomputed against the moved deadline until it stops moving.
  expect(deadlineAfter("2026-09-15T03:30:00.000Z", 4 * 60 * 60, ET)) // 11:30 PM ET on the 14th
    .toBe("2026-09-15T10:30:00.000Z");                               //  6:30 AM ET, 4h of awake time
});

it("does not move a deadline that never touches the window", () => {
  expect(deadlineAfter("2026-09-15T14:00:00.000Z", 60 * 60, ET)).toBe("2026-09-15T15:00:00.000Z");
});

it("extends across two windows when a clock is long enough to span a whole day", () => {
  // An eight-hour clock started at 1 AM ET crosses one window; the extension itself cannot
  // reach the next one, and the fixpoint is what proves that rather than assuming it.
  expect(deadlineAfter("2026-09-15T05:00:00.000Z", 8 * 60 * 60, ET)).toBe("2026-09-15T16:00:00.000Z");
});

it("survives spring forward, where 2 AM does not exist", () => {
  // 8 March 2026, the US spring-forward date: clocks jump 2 AM to 3 AM ET, so the window is
  // one hour shorter that night. The freeze runs 3 AM to 5 AM local, which is the honest
  // answer and the one this test pins rather than a silent hour of extra clock.
  expect(pausedMillisBetween("2026-03-08T06:00:00.000Z", "2026-03-08T11:00:00.000Z", ET)).toBe(2 * MS_PER_HOUR);
});

it("survives fall back, where 1 AM happens twice", () => {
  // 1 November 2026: the window is a normal three hours because it starts after the repeat.
  expect(pausedMillisBetween("2026-11-01T05:00:00.000Z", "2026-11-01T11:00:00.000Z", ET)).toBe(3 * MS_PER_HOUR);
});

it("reads no ambient clock and no ambient zone", () => {
  // Every input is an argument. The test runs under TZ=UTC and TZ=Australia/Sydney and gets
  // identical answers, which is the property that lets a pure engine own a timezone at all.
  expect(underTz("Australia/Sydney", () => deadlineAfter(START, 4 * 60 * 60, ET)))
    .toBe(underTz("UTC", () => deadlineAfter(START, 4 * 60 * 60, ET)));
});
```

```ts
// src/draft-engine/selectors-clock.test.ts
it("does not pause the 90-second clock, because that room is awake", () => {
  // `appliesAtOrAbovePickSeconds` is one hour. At the 10-minute and 90-second tiers the draft
  // is within two hours of kickoff and everybody in it is at their keyboard; freezing them at
  // 2 AM would strand eleven managers to protect the one who is asleep.
  const state = draftAt({ kickoffIn: minutes(30), turnStartedAt: "2026-09-15T06:00:00.000Z" });
  expect(currentDeadline(state)).toBe(plusSeconds(state.turnStartedAt, 90));
  expect(draftClockView(state).pausedUntil).toBeNull();
});

it("tells the room when picks come back, without stopping anybody picking now", () => {
  const state = draftAt({ kickoffIn: days(5), turnStartedAt: "2026-09-15T06:30:00.000Z" });
  expect(draftClockView(state).pausedUntil).toBe("2026-09-15T09:00:00.000Z");
  expect(reduceDraft(state, makePick("t_alice", "p_1")).ok).toBe(true);
});
```

- [ ] **Step 2: The arithmetic, and the one platform API it leans on**

`zoneOffsetMinutes(instantMs, zone)` reads the offset at an instant from `Intl.DateTimeFormat(…, { timeZone, timeZoneName: "shortOffset" }).formatToParts`, which is a platform built-in, present in Node 20+ and every target browser, and needs no dependency and no tz database of ours. The window's UTC bounds for a given local date are found with the standard two-pass correction (guess at the local wall time, correct by the offset at the guess, correct once more), which is what makes both DST tests above pass rather than pass by luck. `deadlineAfter` is a fixpoint: add the clock, add the overlap, repeat until the answer stops moving, with an iteration ceiling asserted so a pathological window can never spin.

- [ ] **Step 3: Where the window enters, and where it may never be read**

`DraftConfig` gains `pauseWindow: PauseWindow | null`, injected by `loadDraftConfig` beside `clockSchedule` — the two travel together because they are the same kind of thing: a deploy-flippable clock rule consumed at command time and at view time. **The reducer never reads it.** A source-level assertion proves that, in the shape `flag-only.test.ts` already uses:

```ts
it("keeps the pause out of the reducer, because a changed window must never break replay", () => {
  // `reduce.ts`, `snake.ts`, `auction.ts` and `apply-pick.ts` decide what an action DOES.
  // `admit.ts` and `selectors.ts` decide whether a command is allowed and what a viewer sees.
  // A pause window read on the first list would mean a deploy that shifted the window turned
  // every persisted TIMER_EXPIRE inside it into a different outcome on replay, which is the
  // exact failure the 60s to 90s clock-floor change caused once already.
  for (const file of REDUCER_FILES) expect(readFileSync(file, "utf8")).not.toMatch(/pauseWindow|deadlineAfter/);
});
```

- [ ] **Step 4: The room, and the schedule panel**

`DraftClockView` gains `pausedUntil: string | null`, which rides `draftStateView` and every `draft.*` payload, so it can never be staler than the event that would refresh it. `RoomRail` renders **"Picks are paused until 5:00 AM Eastern. You can still make yours."** in place of the countdown, and the countdown resumes on the next frame. `formatTightening` and `formatYourTurn` both extrapolate across future clocks and are corrected to route through `deadlineAfter`, because an ETA that ignores a six-hour freeze is worse than no ETA. `DraftSchedulePanel` gains the same sentence for a slow draft scheduled to run overnight.

- [ ] **Step 5: Commit**

---

## Task 5: Skip and return — the forgiving timeout

*"Punitive instant-autopick is the single most-complained-about draft-room behavior on legacy hosts"* (§4.3 item 6). NFFC skips a timed-out manager and gives them a fresh clock; we autopick instantly. The hybrid the analysis asks for adjudicates on **consent**: a team with a queue has already told us what to take, and a team without one has not.

**Files:**
- Modify: `src/draft-engine/state.ts` (+ its test), `src/draft-engine/snake.ts` (+ its test), `src/draft-engine/apply-pick.ts` (+ its test), `src/draft-engine/selectors.ts` (+ its tests), `src/draft-engine/admit.ts` (+ its test), `src/draft-engine/events.ts` (+ its test), `src/draft-engine/config.ts`
- Modify: `src/draft-service/store.ts` (+ its test), `src/integrity/system-actions.ts`, `src/integrity/notices.ts`, `src/integrity/test-support.ts` (+ their tests)
- Modify: `src/draft-room/state/payloads.ts`, `src/draft-room/components/room-dock.tsx`, `room-rail.tsx`, `player-pool.tsx` (+ their tests)

**Interfaces:**
- Consumes: `bestAvailableFor`, `queueFor`, `currentTier`, `applyPick`, `advanceSnake`, `snakeTeamForPick`, `SYSTEM_ACTION_CODES`, `NOTICE_TEMPLATES`.
- Produces: `DraftState.owedPicks`, `DRAFT_SKIP_POLICY`, `teamOnClock`'s catch-up arm, `draft_pick_skipped`.

- [ ] **Step 1: Write the failing expiry tests — the three-way decision**

```ts
// src/draft-engine/reduce-expiry.test.ts
it("autopicks a team that set a queue, because they already told us what to take", () => {
  const state = slowDraft({ onClock: "t_alice", queues: { t_alice: ["p_9"] } });
  const next = expectOk(reduceDraft(state, timerExpire()));
  expect(lastPick(next)).toMatchObject({ teamId: "t_alice", playerId: "p_9", auto: true });
  expect(next.owedPicks).toEqual({});
});

it("skips a team with no queue while the clock is slow, and owes them the pick", () => {
  const state = slowDraft({ onClock: "t_alice", queues: {} });
  const next = expectOk(reduceDraft(state, timerExpire()));
  expect(next.owedPicks).toEqual({ t_alice: [3] });
  expect(next.picks).toHaveLength(state.picks.length);   // nothing was chosen for anybody
  expect(teamOnClock(next)).toBe("t_bob");               // the room moved on
});

it("autopicks instead of skipping once the clock has tightened, because the room is live", () => {
  // At the 90-second tier the draft is inside two hours of kickoff. A skip there is not
  // forgiveness, it is a hole in a live room that everybody else is sitting in.
  const state = fastDraft({ onClock: "t_alice", queues: {} });
  expect(lastPick(expectOk(reduceDraft(state, timerExpire())))).toMatchObject({ teamId: "t_alice", auto: true });
});

it("autopicks the second time, because one owed pick per team is the whole allowance", () => {
  const state = slowDraft({ onClock: "t_alice", queues: {}, owedPicks: { t_alice: [3] } });
  expect(lastPick(expectOk(reduceDraft(state, timerExpire())))).toMatchObject({ teamId: "t_alice", auto: true });
});

it("leaves the auction alone, because a skipped nomination stalls everybody", () => {
  // `reduceAuctionExpiry` auto-nominates the nominator's best available at the minimum bid.
  // A skipped nomination would freeze a lot nobody can bid on, which is a different product
  // failure from the one this task is fixing.
  const next = expectOk(reduceDraft(auctionDraft({ nominating: "t_alice", queues: {} }), timerExpire()));
  expect(next.auction?.lot).toMatchObject({ autoNominated: true });
  expect(next.owedPicks).toEqual({});
});
```

- [ ] **Step 2: Write the failing redemption and settlement tests**

```ts
it("lets a team make an owed pick on somebody else's turn", () => {
  const state = slowDraft({ onClock: "t_bob", owedPicks: { t_alice: [3] } });
  const next = expectOk(reduceDraft(state, makePick("t_alice", "p_4")));
  expect(next.owedPicks).toEqual({});
  expect(next.picks.at(-1)).toMatchObject({ teamId: "t_alice", pickNumber: 3, auto: false });
  expect(teamOnClock(next)).toBe("t_bob");     // redeeming does not steal the current turn
});

it("refuses an owed pick for a player somebody has since taken, and says so plainly", () => {
  expect(admitCommand(stateWithTaken("p_4"), makePick("t_alice", "p_4")))
    .toEqual({ ok: false, reason: "Somebody already drafted that player. Pick another." });
});

it("cannot complete a draft that still owes a pick", () => {
  // At the last pick number the draft would normally finish. An owed pick means a roster is
  // short, and every downstream consumer (commitDraftResults, defaultLineup, validateLineup)
  // assumes every team filled the same number of slots.
  const state = lastPickOf(slowDraft({ owedPicks: { t_alice: [3] } }));
  const next = expectOk(reduceDraft(state, makePick("t_zoe", "p_last")));
  expect(next.phase).toBe("in_progress");
  expect(teamOnClock(next)).toBe("t_alice");   // a catch-up turn, on a fresh clock
  expect(next.turnStartedAt).toBe(NOW);
});

it("autopicks the catch-up turn if it expires too, so a draft always ends", () => {
  const next = expectOk(reduceDraft(catchUpTurnFor("t_alice"), timerExpire()));
  expect(next.phase).toBe("complete");
  expect(rosterSize(next, "t_alice")).toBe(totalRosterSlots(SLOT_CONFIG));
});
```

- [ ] **Step 3: The state field, and why it is a list of pick numbers**

`DraftState` gains `owedPicks: Readonly<Record<string, readonly number[]>>` — the pick numbers a team was skipped at, in order. Not a boolean, because the pick number is what the board renders and what a redeemed pick is stamped with; not a count, because a redeemed pick has to know **which** slot in the draft's history it fills. `DRAFT_SKIP_POLICY` in `src/draft-engine/config.ts` holds `maxOwedPerTeam: 1` and `appliesAtOrAbovePickSeconds: 60 * 60`, and it is read **only** by `reduceSnakeExpiry`, which is a reducer — so unlike the pause window, this one is **snapshotted into `START_DRAFT`** alongside the clock schedule it is measured against, because a deploy that changed the allowance mid-draft would otherwise change what a persisted expiry did on replay. That asymmetry with Task 4 is deliberate and ruling 9 explains it.

- [ ] **Step 4: The room says what happened, to the right person**

A skip publishes `draft.timer_expire` with `skipped: true` (the payload already exists; the flag is new), and the board renders the pick number as pending rather than as a name. `RoomDock` shows the owing manager the one thing they can do: **"Your pick passed while you were away. Make it whenever you are ready."** with the pool's Draft buttons live on their turn and off it. Everybody else sees a pending cell and no accusation, because `copyViolations` bans one and taste bans the other.

- [ ] **Step 5: The notice, and the audit code**

`SYSTEM_ACTION_CODES` gains `draft_pick_skipped`, `SYSTEM_ACTION_VISIBILITY` gains its compile-forced row at `subject_only` (the manager it happened to is the subject; a `system_action` has `actorId: null` by construction, which is Plan D's ruling 8 applied unchanged), and `NOTICE_TEMPLATES` gains `draft_pick_skipped`: **"Your pick passed while you were away. You can still make it, and the draft will wait for it before it finishes."** Written by the same `alsoInTransaction` seam `draft_auto_picked` already uses in `store.ts`, so the notice cannot survive a rolled-back action.

- [ ] **Step 6: Persona panel — the pick that passed**

Veteran, casual, commissioner, first-timer. The questions: does the veteran feel the skip is a courtesy or a penalty; does the casual manager understand they still own that pick; does the commissioner have any reason to intervene (the answer must be no, and if the panel says otherwise the copy is wrong rather than the mechanism); and does the first-timer, who has never set a queue, learn from this moment that setting one is how they avoid it. The panel also decides whether the room announces a skip to everybody or only to its subject.

- [ ] **Step 7: Commit**

---

## Task 6: Draft-slot preference — rank before the randomizer

NFFC's Kentucky Derby System, and the analysis calls it *"a visible 'built by people who play' signal"*. Our randomizer is already deterministic, seeded and single-call-site, which makes this cheaper here than it is at NFFC.

**Files:**
- Create: `src/draft-service/slot-preference.ts` (+ its test), `src/app/api/leagues/[leagueId]/slot-preference/route.ts` (+ its test), `src/league-room/components/slot-preference-panel.tsx` (+ its test), `drizzle/0031_sit_and_go_and_slots.sql` (shared with Task 7)
- Modify: `src/db/schema.ts`, `src/draft-service/order.ts` (+ its test), `src/draft-service/store.ts` (+ its test), `src/league-service/draft-schedule.ts` (+ its test), `src/league-room/contract.ts`, `src/help/glossary.ts`

**Interfaces:**
- Consumes: `draftOrderFor`, `mulberry32`, `requireLeagueMember`, `store.startDraft`.
- Produces: `setSlotPreference`, `slotPreferencesFor`, `assignDraftSlots`, `SLOT_PREFERENCE_REFUSALS`, `DraftScheduleBody.slotPreference`.

- [ ] **Step 1: Write the failing draw tests**

```ts
// src/draft-service/order.test.ts
it("gives each drawn manager their highest still-free choice", () => {
  // The draw order is the existing seeded shuffle. Alice is drawn first and takes slot 1;
  // Bob wanted 1 too, is drawn second, and takes his next choice.
  const order = draftOrderFor("d_1", ["t_alice", "t_bob", "t_cara"], {
    t_alice: [1], t_bob: [1, 3], t_cara: [],
  });
  expect(order[0]).toBe("t_alice");
  expect(order[2]).toBe("t_bob");
});

it("is identical to today's shuffle when nobody ranked anything", () => {
  // The whole feature has to be additive: a league where nobody opens the panel drafts in
  // exactly the order it would have drafted in before this task existed.
  expect(draftOrderFor("d_1", TEAMS, {})).toEqual(legacyDraftOrderFor("d_1", TEAMS));
});

it("reproduces the same order forever from the same draft id and the same preferences", () => {
  expect(draftOrderFor("d_1", TEAMS, PREFS)).toEqual(draftOrderFor("d_1", TEAMS, PREFS));
});

it("cannot be influenced by the order the preferences arrive in", () => {
  // Ids are sorted before the shuffle for this exact reason, and preferences are read into a
  // map keyed by team id, so a different insertion order is a different object and the same draw.
  expect(draftOrderFor("d_1", TEAMS, reversedInsertion(PREFS))).toEqual(draftOrderFor("d_1", TEAMS, PREFS));
});

it("fills a manager who got none of their choices into the lowest free slot", () => {
  expect(draftOrderFor("d_1", TEAMS, { t_zoe: [1] }).indexOf("t_zoe")).toBeGreaterThanOrEqual(0);
});
```

```ts
// src/draft-service/slot-preference.test.ts
it("refuses a ranking once the draft has started", async () => {
  await startDraft(db, draftId);
  expect(await setSlotPreference(db, { leagueId, userId: alice, ranking: [1, 2] }))
    .toEqual({ ok: false, status: 409, reason: "This draft has already started, so the order is set." });
});

it("refuses a slot number this league does not have", async () => {
  expect(await setSlotPreference(db, { leagueId, userId: alice, ranking: [13] }))
    .toEqual({ ok: false, status: 422, reason: "Pick from slots 1 to 12." });
});

it("refuses a repeated slot, because a ranking is an order and not a wish list", async () => {
  expect(await setSlotPreference(db, { leagueId, userId: alice, ranking: [2, 2] }))
    .toMatchObject({ ok: false, status: 422 });
});

it("accepts a partial ranking, because most managers care about two slots and not twelve", async () => {
  expect(await setSlotPreference(db, { leagueId, userId: alice, ranking: [1, 12] })).toMatchObject({ ok: true });
});

it("answers 404 to somebody who is not in this league, never 403", async () => {
  expect(await setSlotPreference(db, { leagueId, userId: stranger, ranking: [1] }))
    .toMatchObject({ ok: false, status: 404 });
});
```

- [ ] **Step 2: The table, and why the preferences are not a draft action**

`draft_slot_preferences (draft_id, team_id, ranking jsonb, updated_at)`, primary key `(draft_id, team_id)`, both columns foreign-keyed. It is a **table and not a `SET_QUEUE`-style action** for the reason the pool is a table (ruling 27): preferences are an *input* to a one-time computation whose *output* is snapshotted into `START_DRAFT.draftOrder`, exactly as the player pool is an input whose snapshot is `START_DRAFT.pool`. Replay determinism is preserved by the snapshot, not by the input, which is why editing a preference after the draw cannot change history and why a preference row may be read with an ordinary query instead of a replay.

`setSlotPreference` writes one row and refuses on five paths, so `expectNoSlotPreferenceTookPlace` is asserted on **each** of them, not on a representative one.

- [ ] **Step 3: The panel, ranked with buttons and never with drag alone**

`SlotPreferencePanel` renders the league's slots as an `<ol>` (position **is** the meaning, the same reasoning `RoomDock`'s queue chips already carry), with named move-up / move-down / remove buttons, a clear "I do not mind" empty state, and a save that says what it saved. Keyboard-only walkthrough of rank-then-save; `inBothThemes`; axe; 360px. Copy: **"Rank the slots you want. We draw in random order and give each manager their highest choice that is still free."**

- [ ] **Step 4: What everybody sees afterwards**

Once the draft starts, `DraftScheduleBody.slotPreference` carries the manager's own result and the panel becomes one sentence: **"You ranked slot 3 first and you got slot 3."** or **"Slot 3 went to another manager, so you got slot 7."** Nobody sees anybody else's ranking — a ranking is a preference a person expressed privately, and Plan A's notice-privacy reasoning applies to it whole.

- [ ] **Step 5: Persona panel — a draw you can influence**

Veteran, casual, commissioner, first-timer. The questions: does the veteran recognize KDS by shape without being told the name; does the casual manager understand ranking is optional and costs nothing; does the commissioner know when the draw happens (at start, not at schedule time); and does the first-timer learn what a draft slot even is, which is a glossary entry (`draft-slot`) and an `InfoTip`, not a paragraph.

- [ ] **Step 6: Commit**

---

## Task 7: The sit-and-go trigger — a time, not a button

§4.3 item 3: *"fire the draft when the Nth member joins; the draft engine and admit flow exist, the trigger and its waiting-room UX don't."* The trigger is one write, and choosing **which** write is the entire design.

**Files:**
- Create: `src/league-service/fill-trigger.ts` (+ its test)
- Modify: `drizzle/0031_sit_and_go_and_slots.sql`, `src/db/schema.ts`, `src/league-service/join.ts` (+ its test), `src/league-service/creation.ts` (+ its test), `src/league-service/schemas.ts`, `src/league-service/draft-schedule.ts` (+ its test), `src/matchmaking/config.ts`
- Modify: `src/integrity/system-actions.ts`, `src/integrity/notices.ts`, `src/integrity/test-support.ts`, `src/integrity-service/lock-order.test.ts` (+ their tests)

**Interfaces:**
- Consumes: `joinLeagueInTx`, `hasOpenSeat`, `autoStartDueDrafts`, `claimAutoStart`, `AuditLogger`, `notifyAffectedMember`.
- Produces: `fireWhenFullInTx`, `FILL_TRIGGER_REFUSALS`, `drafts.start_trigger`, `MATCHMAKING_CONFIG.sitAndGo`.

- [ ] **Step 1: Write the failing trigger tests**

```ts
// src/league-service/fill-trigger.test.ts
it("writes a kickoff time when the last seat fills", async () => {
  await fillTo(db, leagueId, 11);
  await joinPublicLeague(deps, { leagueId, userId: "u_twelfth" });
  expect(await kickoffOf(db, leagueId)).toBe(plusSeconds(FIXED_NOW, MATCHMAKING_CONFIG.sitAndGo.graceSeconds));
});

it("does nothing on the eleventh seat, because a league is not full until it is", async () => {
  await fillTo(db, leagueId, 10);
  await joinPublicLeague(deps, { leagueId, userId: "u_eleventh" });
  expect(await kickoffOf(db, leagueId)).toBe(ORIGINAL_KICKOFF);
});

it("leaves a scheduled league's time alone even when it fills early", async () => {
  // A scheduled draft is a time twelve people planned around. Filling early is not consent to
  // move it, and this is the one behavior that separates the two triggers.
  await fillTo(db, scheduledLeagueId, 11);
  await joinPublicLeague(deps, { leagueId: scheduledLeagueId, userId: "u_twelfth" });
  expect(await kickoffOf(db, scheduledLeagueId)).toBe(ORIGINAL_KICKOFF);
});

it("starts the draft on the next tick, through the auto-start that already exists", async () => {
  await fillLeague(db, leagueId);
  await autoStartDueDrafts(db, { store, clock: clockAt(plusSeconds(FIXED_NOW, GRACE + 1)) });
  expect(await draftStatusOf(db, leagueId)).toBe("in_progress");
});

it("drafts at the ladder's floor, because the kickoff it wrote is minutes away", () => {
  // `clockTierFor` measures the pick clock against `kickoff_at`, and the fill trigger just
  // wrote a kickoff five minutes out, so a sit-and-go pod runs at 90-second picks with no
  // second mechanism and no special case. This is the whole reason the trigger writes a TIME.
  expect(clockTierFor(NOW, plusSeconds(NOW, GRACE)).pickSeconds).toBe(90);
});

it("refuses twice, and the second attempt writes nothing at all", async () => {
  await fillLeague(db, leagueId);
  const before = await snapshotOf(db, leagueId);
  await expectRefusal(fireWhenFullInTx(tx, leagueId, FIXED_NOW));
  await expectNoFillTriggerTookPlace(db, leagueId, before);
});
```

- [ ] **Step 2: The column, and where the trigger runs**

`drafts.start_trigger` is a pg enum `('scheduled','when_full')` defaulting to `'scheduled'` — on `drafts`, beside `kickoff_at`, because it answers a question about the draft's schedule and not about the league's identity. `fireWhenFullInTx` runs **inside `joinLeagueInTx`**, which already holds `leagues FOR UPDATE` and has already counted the seats, so the check and the write cannot race a twelfth joiner: the same lock that makes seat counting correct makes the trigger fire exactly once.

**FK acquisitions, enumerated:** `UPDATE drafts SET kickoff_at` takes the draft row's lock plus an implicit `FOR KEY SHARE` on `leagues` (the `drafts.league_id` FK) — **already held FOR UPDATE by the caller**, so no new edge enters the global order. The notice insert and the `system_action` append follow, in that order, with the audit anchor last, per Plan A. `lock-order.test.ts` gains this writer with the FK named.

- [ ] **Step 3: The words, and the code**

`SYSTEM_ACTION_CODES` gains `draft_fill_triggered`; `SYSTEM_ACTION_VISIBILITY` gives it `league` scope, because a league filling is a fact the whole league already sees and Plan B's rule (*"a record about a consequence the league already sees is the league's business"*) puts it on the league chain. `NOTICE_TEMPLATES` gains `draft_fill_triggered`, delivered to every member: **"Your league filled up. The draft starts in about five minutes."** The number comes from `MATCHMAKING_CONFIG.sitAndGo.graceSeconds`, rendered by the same helper the panel uses, so the sentence and the countdown can never disagree.

- [ ] **Step 4: The grace, chosen and defended**

`MATCHMAKING_CONFIG.sitAndGo = { graceSeconds: 300 }`. Underdog fires instantly; we do not, and the reason is that our pod's members joined a **managed** league possibly hours earlier and are not necessarily sitting at a lobby screen. Five minutes is long enough for a notice to land and a tab to open, short enough that nobody who is present feels stalled. It is one config field, tested in both directions (a tick before the grace does not start the draft; a tick after it does), which is the property a tunable actually needs.

- [ ] **Step 5: Creation, and the refusal that keeps the control honest**

`when_full` is offered **only for public matchmade leagues**, because `dueDraftsQuery` starts drafts only in those (`ENFORCED_LEAGUE_SQL`) and a private league whose fill wrote a time nobody presses would be the control wired to nothing this codebase has now refused five times. `createLeagueSchema` refuses the combination with a plain sentence — **"Leagues that start when they fill are public leagues. Make this one public, or pick a draft time."** — and `setDraftKickoff` refuses to move a `when_full` draft's time with its own sentence, because a time nobody chose is not a time anybody may edit.

- [ ] **Step 6: Commit**

---

## Task 8: The waiting room, and a lobby that shows a league filling

The trigger is invisible until somebody can watch it happen. This is the surface half of §4.1's hybrid lobby: browse plus fill status plus scheduled slots plus sit-and-go, all in one list.

**Files:**
- Create: `src/components/ui/countdown.tsx` (+ its test), `src/league-room/components/waiting-room.tsx` (+ its test)
- Modify: `src/league-service/draft-schedule.ts` (+ its test), `src/league-service/browse.ts` (+ its test), `src/matchmaking/contract.ts`, `src/league-room/contract.ts`, `src/league-room/components/draft-schedule-panel.tsx` (+ its test), `public-league-list.tsx` (+ its test), `src/draft-room/components/room-rail.tsx`
- Modify: `src/app/app/leagues/[leagueId]/page.tsx`, `src/app/browse/page.tsx`

**Interfaces:**
- Consumes: `draftScheduleView`, `listPublicLeagues`, `hasOpenSeat`, `MATCHMAKING_CONFIG.sitAndGo`.
- Produces: `Countdown`, `WaitingRoom`, `DraftScheduleBody.startTrigger`/`filledTeams`, `PublicLeagueSummary.startTrigger`.

- [ ] **Step 1: The countdown, extracted at its third caller**

`RoomRail` consumes `useCountdown` from `src/draft-room/components/countdown.tsx`, ticking at `DRAFT_ROOM_CONFIG.countdownTickMs`; `DraftSchedulePanel` formats its own remaining time a second way. The waiting room is the third caller, and three is where "centralize the first time" stops being a preference: the hook and its presentation move to `src/components/ui/countdown.tsx` as `Countdown` + `useCountdown`, with a `role="status"` live region that announces at sensible intervals rather than every second, a reduced-motion branch, and its tick interval in `UI_CONFIG` rather than in the draft room's own config. **Both existing consumers are refactored onto it in the same commit**, which is the founder rule stated exactly, and the draft room keeps a private copy of nothing.

- [ ] **Step 2: The waiting room's four states**

```ts
it("offers the thing a half-full league can actually give", () => {
  // Never a dead end, in its hardest form: the member cannot have a draft yet.
  render(<WaitingRoom league={{ filledTeams: 9, teamCount: 12, startTrigger: "when_full" }} />);
  expect(screen.getByText("9 of 12 seats taken")).toBeVisible();
  expect(screen.getByRole("link", { name: "Invite someone" })).toBeVisible();
  expect(screen.getByRole("link", { name: "See leagues closer to filling" })).toBeVisible();
});

it("counts down once the last seat fills, and says who is starting it", () => {
  render(<WaitingRoom league={fullSitAndGo} />);
  expect(screen.getByText("All 12 seats are full.")).toBeVisible();
  expect(screen.getByRole("status")).toHaveTextContent(/starts in/i);
});
```

The four states: filling, full and counting down, in progress with a link into the room, and complete. Every one designed, `StatePanelProps.action` satisfied on each, `inBothThemes`, axe, keyboard-only walkthrough, 360px. The waiting room is rendered by league home for a `when_full` draft; the existing `DraftSchedulePanel` keeps the scheduled case unchanged, and the two never render at once.

- [ ] **Step 3: The browse card, without a progress bar**

`PublicLeagueSummary` gains `startTrigger` as its **twelfth** field, and the card renders either the draft time it already renders or **"Starts as soon as it fills"** — never both, and never a fabricated date, because a `when_full` league's stored kickoff is a placeholder until the moment it is not. The fill line stays exactly as it is: `"9 of 12 joined"` and `"3 spots left"`, in words, because `public-league-list.tsx`'s own docblock ruled a bar out on the grounds that the number is the decision, and this plan agrees with it rather than quietly overruling it (ruling 16).

- [ ] **Step 4: The order that makes a nearly-full league findable**

`browseQuery` orders by `created_at ASC` today. It becomes **seats remaining ASC, then `created_at` ASC**: the lobby's job is to fill leagues, and §4.1's whole liquidity doctrine is concentration. The plan's own claim about cost is measured rather than asserted — `browse.ts`'s docblock already records that the measured plan is `Limit -> Sort (top-N heapsort) -> HashAggregate`, so the sort happens after aggregation either way, and the task carries an `EXPLAIN` assertion built from `src/db/test-corpus.ts` with a mutation proof beside it, exactly as Plan D's index assertions do.

- [ ] **Step 5: Persona panel — waiting**

Veteran, casual, commissioner, first-timer. The questions: does a manager waiting on a half-full league feel informed or stranded; does "starts as soon as it fills" read as a promise we can keep; does the countdown create useful urgency or anxiety; and the first-timer's: **"What happens if I am not there when it starts?"** — which the panel answers by deciding whether the waiting room names the queue and the skip (Task 5) or leaves them to the room.

- [ ] **Step 6: Commit**

---

## Task 9: The create form — the two questions that decide who can join you

P3D's fix wave built the "Who it's for" control because veterans could not create public leagues through the UI at all; the re-review then noted the new default was *"sound but collapsed"*. It is nested two disclosures deep, sixth of seven, under a summary that does not mention it, beside a near-homonym. This task is the UX debt that pass filed.

**Files:**
- Modify: `src/league-room/components/create-league-form.tsx` (+ its test), `create-league-panel.test.tsx`, `start-or-join-disclosure.tsx` (+ its test), `create-league-interactions.test.tsx`
- Modify: `src/identity/config.ts` (+ its test), `src/help/glossary.ts`

**Interfaces:**
- Consumes: `LEAGUE_EXPERIENCE_TIER_LABEL`, `LEAGUE_EXPERIENCE_TIER_HINT`, `VISIBILITIES`, `LEAGUE_CONFIG.maxCreateInteractions`, `ROSTER_SHAPE_LABEL`, `MATCHMAKING_CONFIG.sitAndGo`.
- Produces: no new module. A form with its two decisions above the fold and an honest drawer.

- [ ] **Step 1: Write the failing structure tests**

```ts
it("shows who can join and who it's for without opening anything", () => {
  render(<CreateLeagueForm onCreated={noop} />);
  expect(screen.getByLabelText("Who can join")).toBeVisible();
  expect(screen.getByLabelText("Who it's for")).toBeVisible();
});

it("still creates a league in three interactions or fewer", () => {
  // `LEAGUE_CONFIG.maxCreateInteractions` is 3 and is asserted, not aspirational. Promoting a
  // control that already has a default adds a visible element, not a required interaction:
  // type a name, submit. The count is what proves the promotion did not cost the fast path.
  expect(interactionsToCreate()).toBeLessThanOrEqual(LEAGUE_CONFIG.maxCreateInteractions);
});

it("names everything the drawer actually contains", () => {
  // The old summary read "Advanced settings: draft format, team count, scoring" while the
  // drawer also held visibility, who it's for and the stake tier. A summary that under-describes
  // its contents is how a control becomes unfindable while still being present.
  expect(screen.getByText(DRAWER_SUMMARY)).toHaveTextContent(/roster shape/i);
  for (const label of drawerControlLabels()) expect(DRAWER_SUMMARY.toLowerCase()).toContain(label.split(" ")[0]!.toLowerCase());
});
```

- [ ] **Step 2: The promotion, and the two words kept apart**

"Who can join" (public or invite-only) and "Who it's for" (open to everyone, or reserved for newer managers) leave the drawer and sit under the league name, in that order, because the first decides whether the second matters. They are given distinct hints rather than distinct-sounding labels, since the near-homonymy is the real defect and renaming one of them would only move it. The drawer keeps format, teams, scoring, roster shape, auction budget, start trigger and stake tier, and its summary names them all.

- [ ] **Step 3: The refusal's remedy points at something visible**

`ENFORCEMENT_REFUSALS.create` tells a veteran to open their league to everyone. After this task that instruction points at a control on screen rather than at one two disclosures away, which is the property the refusal always claimed and never had. The test asserts the refusal and the control render on the same view.

- [ ] **Step 4: The ledgered persona backlog, swept and adjudicated**

Each item from the Plans B, C and D ledgers gets a decision here rather than another carry:

| Backlog item | Ruling |
|---|---|
| Enum-keyed labels instead of literals in browse filters | **Done already** (`3b85ee7`, the one-import centralization). Confirmed by test, closed. |
| Glossary wiring for new vocabulary | **In**, and paid in the tasks that create the words: `superflex`, `median-game`, `draft-slot`, `sit-and-go`. A term without an `InfoTip` on a real surface is not wired, and each is asserted at its surface. |
| Em-dash lint as an ESLint rule | **Out.** Five sweeps run `copyViolations`, and Plan D repaired the source sweep's template-literal blindness with a hand-walked parser. A sixth mechanism enforcing the same rule is a second place to disagree with the first. |
| Tone-sharing presets for chat | **Out.** A chat feature with no competitive-analysis finding behind it. Stays on the founder-triage list. |
| Help-level hide-versus-quiet | **Out.** A real question about `helpLevel`'s semantics, unrelated to competitiveness, and answering it inside this pass would put an identity decision in a formats plan. Stays ledgered. |

- [ ] **Step 5: Persona panel — the form that decides who sits down with you**

Commissioner first this time, then first-timer, casual, veteran. The questions: can a commissioner tell, without opening anything, whether strangers can join; does a first-timer creating their first league understand "reserved for players newer to Commish" is a protection rather than a demotion; and does the veteran find the drawer's contents where the summary says they are.

- [ ] **Step 6: Commit**

---

## Task 10: The seed, and the walk

Every mechanism in this plan is correct today and fires for nobody. A seed that stamps the outcomes directly would be mock data on a real surface and would prove nothing about the paths that write them.

**Files:**
- Modify: `src/data/seed/**` (+ its tests)
- Create: `e2e/formats-and-lobby.spec.ts`

- [ ] **Step 1: Five arcs, each through the real path**

A superflex league drafted through the real engine with a real second quarterback in the real `SUPERFLEX` slot. A median league whose weeks are settled by the real `finalizeWeek`, producing real medians and real second results in the standings. A slow draft where a queueless team is really skipped by a real `TIMER_EXPIRE` and really redeems the owed pick. A draft whose order really came from real preference rows. And a public sit-and-go league that really fills and whose kickoff is really rewritten by the real join transaction.

- [ ] **Step 2: Idempotence, and the standing hazard**

The seed is re-runnable against an already-seeded database (Plan D's psql-verified property) and every new arc follows the reuse-if-exists stable-identity pattern. The cross-phase persisted dev volume is a recorded standing hazard: this task's fixtures self-heal the specific modes it can encounter, and the task states plainly which ones it cannot.

- [ ] **Step 3: The browser walk**

`e2e/formats-and-lobby.spec.ts`, on both disciplines named in the Global Constraints: every interaction is **click-and-verify, retried** against a receipt only the hydrated page produces, and every count assertion is **relative** or derived from the page. Three journeys a screenshot cannot fake: a manager ranks two draft slots and the draft starts in an order consistent with the ranking; a sit-and-go league's last seat is taken in one session and the other session's waiting room shows the countdown; and a settled median week shows a second result on the matchup page and a record in the standings that includes it.

- [ ] **Step 4: Commit**

---

## Task 11: Docs, the roadmap row, and the closing battery

- [ ] **Step 1: The decision doc**

`docs/decisions/formats-and-lobby.md`, written to the code that shipped rather than to this plan: the toggles-not-queues doctrine and what it excluded, the median's storage split, the pause's command-time-only boundary and its two DST answers, the skip's consent test and the owed-pick invariant, the KDS snapshot argument, and the fill trigger as a time rather than a button. Every ruling below that survived contact gets a section; every one that changed gets the correction, not the original.

- [ ] **Step 2: Drift**

`docs/conventions.md` (the directory map's new files; the gate count stays **twenty-one** and the doc says why no gate joined), `docs/league.md` (roster shapes, the median, the browse order), `docs/draft-engine.md` (the pause, the skip, `owedPicks`, the KDS input), `docs/draft-moderator.md` (a queue is now the difference between an autopick and a skip, which makes the moderator's nudge more load-bearing than it was), `docs/design-system.md` (`Countdown`, `SlotChip`'s new member), `docs/decisions/enforcement-and-tiers.md` (the third writer of `kickoff_at`), `README.md`.

- [ ] **Step 3: The roadmap row**

`plans/00-roadmap.md` gains one line recording Phase 3.5 as a founder-ordered interstitial pass with its plan file named, and states that the nine-phase sequence and Phase 4's position are unchanged. A reader who finds a "3.5" in a commit message must be able to find out what it was without reading this file.

- [ ] **Step 4: The inert-deliverable sweep**

Four lists, walked and asserted: every `SystemActionCode` has a publisher; every `NOTICE_TEMPLATE` has a caller; every `RosterShapeName` is reachable from the create form; every field added to `PublicLeagueSummary` renders on a card. **This plan declares no name it does not wire** — if this step finds one, the name comes out rather than the sweep being loosened, which is the answer this loop has given six times.

- [ ] **Step 5: The closing battery**

`npm run infra:up` from a cold stack · both migrations applied forward · `npm run seed` · the ingestion pass that settles the median weeks · `npm run audit:verify -- --full` over every chain the seed and the e2e create, first-verification-per-chain satisfied · `npm run integrity:sweep` · `npm run trades:sweep` · `npm test` unfiltered · `npm run test:coverage` unfiltered with **twenty-one** gates at 100% · the whole suite routed **through PgBouncer** with the lock-order suite at 14/14 · `npm run typecheck && npm run lint && npm run build` · **`npm run e2e` twice**, green both times, with any fixture interaction the battery itself exposes fixed rather than retried around.

- [ ] **Step 6: Commit**

---

## Open questions, self-ruled

Every judgment call this plan makes, numbered, with the reasoning that would have to be wrong for the ruling to be wrong.

1. **The new formats are toggles on one canonical league, and none of them becomes a browse filter.** §4.1 is unambiguous that managed-league liquidity comes from concentration: *"Fragmenting launch liquidity across ten formats would strand seats. Launch with one canonical public family and put variety in toggles that don't fragment the pool."* Every filter axis is a way for an open seat to become invisible to somebody who would have taken it, so superflex and the median game surface as **badges and terms**, not as `BrowseFilter` fields. The two axes that already exist for segregation stay, because they exist to keep people apart on purpose. This is wrong only if a manager would rather see no leagues than a league with a toggle they did not pick, which the same doctrine says is exactly the failure to avoid.

2. **The median toggle lives on `leagues` and the median value lives on `weeks`.** `scoring_settings` is fifteen flat `real` weights and `describeScoring` derives a browse label from precisely those; a boolean in that table would make the label function either wrong or aware of something that is not a weight. `weeks` has carried nothing but its own primary key since Phase 1, and one median per league week is exactly its cardinality. A `median_results` table with a row per team per week was considered and rejected: it would store N numbers to record a fact that N scores already imply, and the comparison is cheaper than the row.

3. **A median result is a win, a loss or a tie, and it never touches points for or points against.** Folding the median score into points against would mean a team's opponents column described a team that does not exist, and it is the tiebreaker that compares real schedules. Folding a team's own score in twice would double the column outright. Apex's format calls the median an opponent; our columns say what actually happened, and the record, which is what people argue about, counts it fully. This is wrong if two teams with identical records must be separated by their median opponents, which is a tiebreaker nobody in the field runs.

4. **A pseudo-matchup row for the median was rejected on the schema's own terms.** `matchups.home_team_id` and `away_team_id` are NOT NULL foreign keys to `teams.id` and the primary key is `(league_id, week_number, home_team_id)`, so a median row needs a sentinel team and a relaxed key. It would also break three things that read the table as a season: `stampSeasonCompleteInTx`'s `NOT EXISTS(unscored matchup)` would never be satisfied by a row nothing scores, `seasonProgress.playedWeeks` would count it, and `computeStandings` would double every points column. One number on `weeks` breaks none of them.

5. **The clinch parameter is renamed rather than adjusted at the call site.** `clinchedTeamIds` computed `firstOut.wins + weeksRemaining`; with a median game a week is worth two wins, and a parameter named `weeksRemaining` that sometimes holds games is a silent lie of exactly the kind `maxDraftDaysFromCreation` already told this codebase once. `gamesRemaining` makes the multiplication the caller's visible job. `clinchedTeamIds` is deliberately conservative and stays so: a team that could still be caught by two median results has not clinched.

6. **`seasonProgress` and `currentWeekNumber` are deliberately untouched.** Both answer "how far into the calendar is this league", and a median game adds no week. Changing `playedWeeks` to count games would make a progress bar read 28 of 14. The one place the doubling is real is the clinch ceiling, and that is where the change lands.

7. **The overnight pause is 2am to 5am Eastern, and it stops applying once the clock is under an hour.** FFPC pauses 2 to 8, Underdog 2 to 5 with the pause dropping away once the ladder has tightened, and our ladder is Underdog's ladder verbatim, so it takes Underdog's pause. The tier cutoff is the humane half: at the 10-minute and 90-second tiers the draft is inside two hours of kickoff and everybody in the room is at a keyboard; freezing them at 2am would strand eleven awake managers to protect one asleep. Eastern rather than each viewer's own zone because a draft has one clock and twelve viewers, and per-viewer freezing is not a clock.

8. **The pause is read at command time and at view time, and never by the reducer.** `admit.ts`'s docblock states the rule and the 60s to 90s clock-floor change is the in-code proof of what breaking it costs: every persisted `TIMER_EXPIRE` became a permanent 500. `currentDeadline` and `nudgeDeadline` are selectors consumed by `admitTimerExpire`, the ticker and the wire view; `reduceSnakeExpiry` applies an expiry that was already admitted and asks no question about time. So a deploy that shifts the window changes what the product will do next and cannot change what it already did, and a source-level test asserts the reducer files never name it.

9. **The skip policy is snapshotted into `START_DRAFT`, and the pause window is not, and the asymmetry is the whole point.** The skip policy is read **by the reducer** (`reduceSnakeExpiry` decides skip-versus-autopick), so a deploy that changed the allowance would change what a persisted expiry did on replay; it therefore travels in the action log exactly as `minBid` and the pool ranking already do. The pause window is read only outside the reducer and therefore may live in `DraftConfig` where a deploy can move it. Two clock-shaped tunables, two different homes, one rule deciding both.

10. **The timeout's three-way decision turns on consent, not on politeness.** A team with a usable queue is autopicked exactly as today, because `bestAvailableFor` is that team's own instruction and honoring it is not a punishment. A team with no queue, in a slow tier, is skipped, because instant autopick there is the behavior the analysis names as *"the single most-complained-about draft-room behavior on legacy hosts."* A team with no queue in a fast tier is autopicked, because a live room cannot hold a hole. This is wrong if a manager who sets no queue means "pick for me", which is the interpretation the complaint data contradicts.

11. **A skipped pick is owed, redeemable at any time, and settled before the draft can complete.** The alternative — forgiving the pick — would leave one roster a player short, and every downstream consumer (`commitDraftResults`, `defaultLineup`, `validateLineup`, the lineup editor, the standings) assumes every team filled the same slots. So `owedPicks` holds the pick numbers, a redemption may land on anybody's turn (it does not steal the current one), and at the draft's last pick the state stays `in_progress` and hands catch-up turns to the owing teams on fresh clocks, autopicking any that expire again. The draft always ends, every roster is always legal, and a manager who steps away for ten minutes loses nothing.

12. **One owed pick per team, and the second timeout autopicks.** An unbounded allowance is an abandoned seat with extra steps: eleven managers would wait out a draft for somebody who left. One is enough to cover the case the mechanism exists for (a person missed a turn) and too few to cover the case it must not enable (a person is gone). The number is config and both sides of it are tested.

13. **The auction is deliberately excluded from skip-and-return.** `reduceAuctionExpiry` auto-nominates a stalled nominator's best available at the minimum bid, and that is not punitive: while a lot is open the clock belongs to everybody, and a skipped nomination freezes eleven people who are ready to bid. The forgiving behavior in an auction is the bid window itself, which already restarts on every bid. Skip-and-return is snake-only and says so.

14. **The fill trigger writes a kickoff time and does not start a draft.** Two doors already start drafts — a commissioner's press and `autoStartDueDrafts` — and both funnel through `store.startDraft`'s guarded status transition, which is the only cross-instance-safe start this product has (PgBouncer forbids advisory locks, so no leader election exists). A third door would need its own idempotency and would be the second thing to get wrong when `startDraft` changed. Writing a time inside the transaction that already holds `leagues FOR UPDATE` reuses the exclusion that makes seat counting correct, and hands the start to a mechanism proven idempotent across two connections in Plan D.

15. **Sit-and-go is a public-lobby product, and `dueDraftsQuery` is not widened.** §4.1 puts sit-and-go pods *"for the canonical format only, where the fill population is deepest"*, and Plan D scoped platform auto-start to public matchmade leagues on the principle that the platform commissions where no trustworthy human one exists. A private league that filled would write a time nobody presses, which is the control wired to nothing this codebase has refused five times, so `createLeagueSchema` refuses the combination outright with a sentence naming the remedy. This is wrong if a private commissioner would rather the platform started their draft than press the button they already have, which is a preference no research in this repo evidences.

16. **The browse card gets an order, not a progress bar.** `public-league-list.tsx`'s own docblock ruled the bar out: *"the number is the decision a visitor is actually making and a bar makes them estimate it."* That reasoning is still right and this plan does not quietly overrule a documented decision to satisfy the word "meter" in a research note. What §4.1 actually asks for is that a nearly-full league be **findable**, which is an ordering problem: seats remaining ascending, then oldest first. The measured plan already sorts after aggregation, so the change costs nothing, and the task proves that with an `EXPLAIN` assertion and a mutation proof rather than with this sentence.

17. **A `when_full` league shows "Starts as soon as it fills" instead of a date.** Its stored `kickoff_at` is a placeholder until the trigger rewrites it, and rendering that placeholder would put a specific, wrong Saturday evening on a public card. `PublicLeagueSummary` gains `startTrigger` as its twelfth field on the same disclosure reasoning `draftAt`, `scoringLabel` and `compositionCategory` each established: how a league starts is a fact about the league, not about any person in it.

18. **The countdown becomes a UI primitive at its third caller and not before.** Two divergent countdowns were tolerable; three is a visual mapping living in feature code, which the founder rule forbids. Both existing consumers are refactored onto it in the same commit, which is the rule's second half and the half that usually gets skipped.

19. **Every new automated action rides `system_action` with a payload code, and this plan adds no audit event type.** `AUDIT_EVENT_TYPES` is a frozen pg enum whose docblock forbids `ALTER TYPE … ADD VALUE` forever; `SYSTEM_ACTION_CODES` is a plain `as const` array with no database representation, which is exactly why Plan A put the growable vocabulary there. Two codes are added (`draft_pick_skipped`, `draft_fill_triggered`), each with a publisher, each with a compile-forced visibility, and `draft_pick_skipped` is `subject_only` for Plan D's reason: a `system_action` has `actorId: null`, so `actor_only` can never match one.

20. **This plan adds no realtime event type.** The pause and the owed picks ride `DraftClockView`, which is already on `draftStateView` and on every `draft.*` payload, so they cannot be staler than the frame that would refresh them. A fill-triggered start publishes the same `draft.status` a commissioner's press does. Everything else reaches its member on `notice.created`. `REALTIME_EVENT_TYPES` is enumerated once and grown reluctantly; `score.update` sat reserved for an entire phase before anything published it.

21. **No new coverage gate, and no ninth exempt directory.** Every pure module this plan writes is placed inside a directory that is already gated at 100% — which is why `roster-shape.ts` and `median.ts` land in `src/league` rather than in `src/domain`, and why the pause lands in `src/draft-engine`. `src/domain` is **not** gated and this plan does not gate it: it holds types the whole product shares, a 100% claim over it is a separate piece of work, and the one line this plan adds there is a type union member whose every behavior is pinned by tests in two gated directories. Stating that hole is better than either hiding it or fixing it badly inside a formats plan.

22. **No new config file.** The pause window and the skip policy are draft-clock rules and sit in `src/draft-engine/config.ts` beside `DRAFT_CLOCK_SCHEDULE`, which is the thing they modify. The roster-shape default and the median default are league product configuration and sit in `LEAGUE_CONFIG.defaults` beside the scoring preset. The sit-and-go grace is a lobby tunable and sits in `MATCHMAKING_CONFIG`, which is browser-safe, so the sentence a waiting manager reads and the number the server enforces are the same number.

23. **No new icon and no new UI primitive except the extracted countdown.** `clock` already means both the pick clock and the lineup lock; `users` already means a league's members; `refresh-cw` already means something coming back around, which is what an owed pick is; `shield` already means the platform acting on its own. Four phases in, the icon list holding at eighteen while five surfaces ship is the centralization rule working rather than a constraint being observed.

24. **The seed fires all five mechanisms through real paths.** Stamping a median, inserting an owed pick, or setting a kickoff by hand would be mock data on a real surface, and it would prove nothing about the code that writes them — the exact objection Plan B raised against decorative flags and Plan D answered for all four of its own mechanisms. What a founder sees locally is what the mechanisms actually do.

25. **The public mock-draft lobby is OUT of this phase, and the reasoning is not "too big".** Mock drafts need seats that no person occupies. `teams.user_id` is a NOT NULL foreign key to `users.id` with a per-league unique index, there is no system user and no non-user seat concept anywhere in the schema, and the only autonomous drafter in the product is a reducer branch fired by wall-clock expiry with no way to act immediately for a designated seat. Building it means a first-class non-human participant — a new identity kind reaching the roster, the chat, the audit log, the activity feed and the review feed — plus a drafter with judgment, which is Phase 6's AI productionization by name. And the funnel argument cuts the same way: §4.1 calls mocks *"the free liquidity funnel"* into a lobby, which is the thing this phase is building; a funnel into a lobby that does not yet fill is an acquisition feature ahead of the product it acquires for. **Ledgered to Phase 6**, with the schema obstacle named so whoever picks it up starts from the real constraint.

26. **Six more candidates ruled out here so none is mistaken for an oversight.** **Two-layer prizes** (league payout plus a national pool) need Phase 4's payout-structure domain, which does not exist; the analysis itself sequences them there. **Real stake tiers** stay cosmetic for the same reason and the disclosure that says so stays on the create form. **Best ball** is §4.2's post-launch fast follow and is a scoring fold plus a lobby of its own; entering it now would fragment exactly the pool §4.1 says to concentrate. **Guillotine** is the same fast-follow bucket and additionally needs a waiver engine, of which this product has none. **Third-round reversal and linear draft order** are real formats in §2's taxonomy but appear in none of §4.3's build items, and each is a variety axis that splits the canonical pool for a preference nobody in the research asked for. **Dynasty and keeper depth** are Phase 9 and need multi-season trust this platform has not yet earned. Every one of these is a scope ruling, not a difficulty ruling.

27. **Draft-slot preferences are a table, and the order they produce is what goes in the log.** `SET_QUEUE` is an action because a queue is consulted *during* the draft, at an arbitrary pick, so replay must know what it was at that moment. A slot preference is consulted **once**, before the first action exists, and its only consequence is the permutation `reduceStart` receives — which is snapshotted into `START_DRAFT.draftOrder` and is authoritative forever after. That is precisely the shape of the player pool, which is also read from Postgres and also snapshotted, and nobody has ever wanted it in the log twice. The consequence worth stating: a manager who edits their ranking after the draw changes nothing, and the panel says so rather than accepting a write that does nothing.

---

## Self-review

**Analysis coverage — `2026-08-20-game-types-and-lobby-strategy.md` §4.3, item by item:**

| §4.3 build item | Where |
|---|---|
| 1. Draft date/time as a domain concept | **Shipped in Phase 3 Plan D** (`setDraftKickoff`, `DraftSchedulePanel`, `autoStartDueDrafts`). Verified on `main`, not re-planned. Task 7 adds the third writer and Task 11 documents the conflation. |
| 2. Payout structure as a domain concept | **Out — Phase 4.** Named in ruling 26 with the analysis's own sequencing. |
| 3. Sit-and-go fill trigger, plus the waiting-room UX | Task 7 (the trigger, as a time), Task 8 (the room, the card, the order) |
| 4. Overnight pause for slow drafts | Task 4, with both DST edges pinned and the tier cutoff Underdog's own behavior implies |
| 5. Draft-slot preference (KDS) | Task 6, on the existing seeded draw, stored as an input and snapshotted as an output (ruling 27) |
| 6. Skip-and-return timeouts | Task 5, adjudicated on consent (ruling 10), owed and settled (ruling 11), snake-only (ruling 13) |
| 7. Median-game scoring toggle | Tasks 2 and 3, including the three "one game per week" assumptions the analysis did not know about |
| 8. Superflex slot config | Task 1, and it really was a config row |

**Analysis coverage — §4.1 (the liquidity doctrine) and §4.2 (launch canon):**

| Claim | Where |
|---|---|
| Variety in toggles, not queues | Ruling 1, and enforced by what this plan refuses to add: zero new browse filter axes |
| Hybrid lobby: browse + fill status + scheduled slots + sit-and-go | Task 8. All four in one list, with the fill line kept in words (ruling 16) |
| The AI moderator is a liquidity feature (unlimited concurrent staffed drafts) | Already true and now more load-bearing: after Task 5 a queue is the difference between an autopick and a skip, so the nudge that reminds a manager to set one has a mechanical consequence. Documented in Task 11 step 2 |
| Mock drafts as the free liquidity funnel | **Out**, ruling 25, ledgered to Phase 6 with the schema obstacle named |
| Half-PPR default with PPR / TE-premium / superflex toggles | Task 1 steps 3 and 4. All four presets stay reachable; only the default moves |
| The median as a standard toggle | Tasks 2 and 3 |
| Native live auction as the premium flagship | **Already shipped** (one reducer, both formats). Task 5 protects it by leaving auction expiry alone (ruling 13) |
| Stake tiers $25/$50/$100/$250 | **Out** — cosmetic until Phase 4, ruling 26 |
| Experience-tier segregation stays on | **Shipped in Plan D**, three doors. Task 9 makes its own refusal's remedy visible for the first time |

**Analysis coverage — `2026-08-16-beating-apex-strategy.md` §4/§4.1:**

| Principle | Where |
|---|---|
| Filter-and-browse transparency rather than blind assignment | Preserved and deepened: Task 8 adds ordering and a start-mode sentence, and adds no auto-assignment anywhere |
| Auto-tightening slow-draft clocks | Extended, not replaced: Task 4 pauses the slow tiers only and leaves the ladder's kickoff anchor alone |
| The AI moderator replaces the human, every round | Unchanged mechanically; Task 5 gives its nudge a consequence |
| Never a dead end | Task 8's waiting room is the hardest instance in the product and gets two real actions |
| Genuine participant input required by statute (no full autopilot) | Untouched and reinforced: a skip requires a human to come back, and the one automatic path (autopick) is the one a manager consented to by ranking a queue |

**Founder-directive coverage:**

| Directive clause | Where |
|---|---|
| "Before payments" | Nothing here depends on Phase 4, and ruling 26 rules out everything that would |
| "The site experience is correct" | Five member-facing surfaces, five persona panels, and the create-form debt three reviews filed |
| "Competitive-analysis findings" | Six of §4.3's eight, with the other two verified shipped or ruled out |
| "Core-product improvements needed to be competitive" | The two format toggles that neutralize Apex's signature and unlock the growing format, and the two clock behaviors that separate us from every legacy host |
| 8 to 12 tasks | Eleven |
| The launch-canon liquidity logic governs how new formats surface | Ruling 1, and the absence of any new filter axis is the evidence |

**Placeholder scan:** no `TODO`, no `TBD`, no "handle errors appropriately", no "similar to Task N", no step whose expected output is unstated. Every file in the File Structure tables appears in a task's Files block. Five places name a helper the executing engineer writes to taste rather than showing it in full — `zoneOffsetMinutes`'s two-pass correction (Task 4), `describeRosterShape`'s body (Task 1), the four component bodies (Tasks 3, 6, 8), the medians read-path query (Task 2 step 5) and `seedFormats`'s five arcs (Task 10) — and each names the existing file in this repo whose shape it copies (`src/league/terms.ts`'s `Intl` usage, `src/scoring/describe.ts`, `src/league-room/components/draft-schedule-panel.tsx` and `room-dock.tsx`, `src/league-service/home.ts`'s existing grouped reads, `src/data/seed/seed-enforcement.ts`), which is a pointer to real code rather than a placeholder.

**Type consistency:** `RosterShapeName`, `MedianResult`, `PauseWindow` and `StartTrigger` are each declared once, three of them as a `readonly` tuple or `as const` object with the union derived from it, the shape `REALTIME_EVENT_TYPES`, `AUDIT_EVENT_TYPES`, `SYSTEM_ACTION_CODES`, `TRADE_STATUSES` and `PARTICIPATION_TIERS` all already use. `ROSTER_SHAPE_LABEL` and `MEDIAN_RESULT_LABEL` are exhaustive `Record`s over those unions, so a member added without a label is a compile error. `owedPicks` is `Readonly<Record<string, readonly number[]>>`, matching `queues` and `rosters` field for field, so the immutability rules apply to it unchanged. `medianByWeek` is a `ReadonlyMap<number, number>` at the pure boundary and a plain query result at the Drizzle one, with `Date` appearing only at the Drizzle edge — the discipline `AuditEvent`, `IntegrityFlag` and `TradeProposal` all keep. Nothing here declares a second type named for something that already has one: a roster **shape** is not a roster **slot**, and `SUPERFLEX` is a `RosterSlotType` member rather than a fifth position.

**Boundary check:** `src/league/roster-shape.ts` and `src/league/median.ts` are pure and stay inside `src/league`, which is on the **blocked** import list for browser code, so `src/league-room/**` reaches `ROSTER_SHAPE_LABEL` over the wire through `CreateLeagueBody` and `LeagueTerms` rather than by value-import — the same way it already reaches `scoringLabel`. `MATCHMAKING_CONFIG.sitAndGo` is value-imported by the waiting room, which is legal because `src/matchmaking` is exempt and is precisely why the grace seconds live there. `src/draft-engine/pause.ts` is pure, imports nothing but `Intl` and its own config, and is reached by `src/draft-room/**` only as a serialized `pausedUntil` string on the wire. `src/draft-service/slot-preference.ts` imports `@/db` and `@/draft-engine`, both server-side and both already imported by that directory. `src/league-service/fill-trigger.ts` is called by `src/league-service/join.ts`, a sibling within one directory. `src/app/**` is exempt by design. Nothing under `src/**` imports `scripts/**` or `e2e/**`, and this plan adds no script.

**Founder rules:** five persona panels, each a marked controller step, split by audience because a manager reading a second result, a manager who missed a pick, a manager ranking a slot, a manager waiting on strangers and a commissioner deciding who may sit down are five different people with five different fears. Every user-facing string quoted in this plan is em-dash and en-dash free, active, and free of `accusatoryTerms` and `passiveConstructions`, which is not a preference here: `copyViolations` bans all three and five sweeps run it, one of them repaired mid-Plan-D specifically so template literals cannot hide. No new icon, one new primitive and it is an extraction with both existing consumers refactored in the same commit (ruling 18). No mock data on a real surface (ruling 24). Nothing is built in a shape a later phase throws away: the roster-shape vocabulary is what a dynasty phase adds shapes to, `owedPicks` is what a Phase 6 moderator escalates against, `PublicLeagueSummary`'s new fields are what a Phase 4 lobby prices, and the median is stored where a payout structure would read it.

**Four things this plan deliberately does not do, stated so none is mistaken for an oversight.** It does not add a **bot, a mock lobby, or any non-human seat** (ruling 25), and it names the schema fact that would have to change first. It does not add a **browse filter axis**, because §4.1's own doctrine says a filter is how a pool fragments (ruling 1). It does not touch **money in any form** — stake tiers stay cosmetic, prizes stay absent, and the disclosure that says so is unchanged. And it does not add a **production scheduler**: the fill trigger rides the ticker that already exists, the audit-chain walk stays Phase 2 Plan D's, and every claim about cross-instance safety rests on the guarded status transition Plan D already proved on two real connections.

## The founder-gated bucket, unchanged

Nothing in this plan is blocked on any of it. Listed so no task quietly assumes one arrived.

| Gate | What this plan ships without it |
|---|---|
| Platform-verified client IP + Redis-shared limiter counters (LAUNCH-BLOCKING since Phase 2 Plan C) | `INTEGRITY_CONFIG.multiAccount.weights.ip` stays **0**, untouched, and the ceiling assertion that reddens if any weight moves stays green. The one new unauthenticated read path this plan touches is browse, whose per-IP ceiling is unchanged |
| An email sender | In-app delivery only. Two new notice types, neither emailable, and the catalog still says so honestly with no switch beside it |
| A production scheduler | The fill trigger writes a time and the existing in-process ticker starts the draft, proved idempotent across two connections in Plan D. The audit-chain full walk stays Phase 2 Plan D's |
| A banking partner and gaming counsel (Phase 4) | Stake tiers stay cosmetic, two-layer prizes stay unbuilt, and ruling 26 records both as scope rather than as difficulty |
| An object store, Fly.io, managed Postgres/Redis, Sentry | Unrelated to every task here |
