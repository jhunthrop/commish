# Phase 4.5 — Mock drafts: the real room, on practice terms

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship mock drafts as the platform's August acquisition surface: a practice draft that renders the REAL draft room — the real clock, the real queue, the real moderator, the real board — against named practice opponents driven by the platform's own rankings, in three modes: **instant solo** (one click, eleven bots), **live public lobby** (strangers fill a settings-tiered room, bots top up at the countdown), and **private link** (friends claim seats from a share code, bots top up the rest). Bots are intelligent and non-repeating: a strategy-archetype layer with seeded, bounded randomness, positional need, and run-reaction — rankings-driven heuristics only, never ML ("learn from everyone's drafts" is explicitly Phase 6). A mock league writes **no audit event, no notice, no money row, no season**, pollutes no proof stat, no wire item, no browse shelf and no participation history, and is swept away on a retention clock — because the founder's trust framing cuts both ways: the mock must showcase the real room, and the real product's numbers must never count a rehearsal.

**Architecture:** One new column and one sidecar, not a parallel machine. A mock **is a league row** (`leagues.is_mock`, migration `0041`) with a `mock_rooms` sidecar carrying the mock-only facts (mode, pick clock, bot seed, share code, expiry) — because the draft engine, the store's single-writer transaction, the ticker, SSE and the whole room UI all key off `drafts`/`leagues`/`teams` rows (`loadDraftConfig` joins `leagues` for the roster shape; `startDraft`'s in-transaction thunk reads `teams`; the room's SSE rides `league:<id>:events`), and a parallel `mock_drafts` table set would fork every one of them into a toy copy of the room the founder said the mock must not be. Exclusion from the real product is two mechanisms that already exist plus one new predicate: every mock ships `is_public_matchmade = false`, so every `ENFORCED_LEAGUE_SQL` consumer (browse, the wire's three event queries, the proof strip's 48h/next-draft reads, auto-start's due scan) excludes it **by construction**; the one aggregate that deliberately counts private leagues too (`leaguesFilledQuery`) gains `NOT is_mock`; and the store grows a **mock lane** — for a mock draft, `applyAction` skips the audit append, the notices, the season commit and the multi-account sweep, which is precisely what makes the retention sweep's `DELETE` legal against an audit spine whose triggers refuse deletion (ruling 2). Bots are ordinary `users` rows (`is_bot = true`, a seeded roster of named practice opponents) seated as ordinary `teams` rows, and bot picks are ordinary `MAKE_PICK` actions applied by a ticker-side driver through the same `store.applyAction` single-writer path every human pick takes — never a second pick implementation, never an early `TIMER_EXPIRE` (which `admitTimerExpire` would refuse anyway, `src/draft-engine/admit.ts:77-83`).

**Tech Stack:** Unchanged. TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 through PgBouncer in transaction mode · Redis 7 (Streams → SSE) · WorkOS AuthKit · Zod v4 · Vitest · Playwright. This plan adds **no runtime dependency**: the seeded PRNG is thirty lines of pure code (ruling 7), not a package.

**Spec:** `docs/research/2026-08-16-beating-apex-strategy.md:39` (Sleeper's bar: "Mock drafts configurable to match real league settings, shareable via link, with bots that 'learn from everyone's drafts' to behave realistically" — the learning half is Phase 6's, stated there and restated here as refused scope D3); `docs/research/2026-08-23-backend-gaps-backlog.md:50` (row 18: "I want a practice draft before a real one." — the first-timer, MEDIUM, with `RoomTour` shipped as the stand-in, "a look, not a rehearsal"); the founder's phase order of 2026-08-25 ("It's critical for people to trust and like the platform" — August is mock-draft season, the acquisition window); and the founder's mid-planning requirements of 2026-08-25, recorded verbatim below and binding.

**Depends on Phase 4 merged to `main`** (`cbd4db0`). Nothing here regresses the money-dark contract, the roll, the seat hold, or any Phase 3.x surface.

---

## Founder requirements (recorded 2026-08-25 — these bind verbatim)

> "The mock draft should support live mock drafts against others and bot mode. Also the bots should be intelligent and not pick the same way every time to allow for real-world type of scenarios."

Bound as: (1) three first-class modes — instant solo, live public lobby against strangers with bot top-up, private link with bot top-up (Tasks 5-7, 9); (2) a bot **strategy layer**, not one greedy ranker — per-bot per-draft archetypes, rank-weighted sampling with a temperature and a hard reach cap, positional-need weighting against the league's own roster slots, and run-reaction (Task 3), all driven by an injected `Rng` seeded per draft and stored on the mock row so a draft's bot behavior is replayable in a bug report and fixable in a test.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied from the codebase's own rules and from verification policy v4, restated in full.

**Verification policy v4:**

- **Per-task verification is changed-files scope:** `npm test -- <changed directories>` plus `npm run typecheck && npm run lint`. Never the full suite per task.
- **`npm run build` only when the task changes routes, layouts, middleware, or config** (Tasks 7, 8, 9, 11 here).
- **e2e only at cluster checkpoints, and only the specs that walk touched surfaces:** checkpoint 1 after Task 6 (`league-lifecycle`, `formats-and-lobby` — the ticker and the join-adjacent seat paths moved under them), checkpoint 2 after Task 9 (`whole-site`, `mobile-360`, `money-dark`, plus the new `mock-draft` spec). The closing battery in Task 12 is the one full pass.
- **TDD per task: the failing test is Step 1 of every task**, and every refusal path of a writer that could have written something is asserted with a no-write helper (`expectNoMockRoomCreated`, `expectNoSeatClaimed` here, in the `expectNoPostingTookPlace` family).

**From `docs/conventions.md` (the standing laws, and the one carve-out this plan rules):**

- **The global lock law:** any transaction touching `leagues` + `drafts` takes the `leagues` row lock FIRST, as its own statement (`joinLeagueInTx`, `src/league-service/join.ts:197-206`; `applyAction`, `src/draft-service/store.ts:375-399`). Every mock writer that seats a team or stamps a kickoff opens with `leagues[id] FOR UPDATE` (Task 5), and the bot driver goes through `store.applyAction`, which already holds the order.
- **The audit law and the anchor law bind every REAL-league writer unchanged.** For mock leagues this plan rules a **carve-out** (ruling 2, argued in full below): mock writers append **nothing** to the audit chain, create **no** notices, and post **no** money — proven by the statement-spy pattern Phase 4 established (`recordStatements` asserting zero `audit_%`, `member_notices`, `money_%` statements across a whole mock lifecycle). With no anchor append there is no anchor lock, so the anchor-last law is vacuously satisfied; the lock-order suite still gains the mock writers' concurrent pairs (Task 5) because the `leagues`/`drafts` half of the law is not carved out.
- **PgBouncer transaction pooling forbids advisory locks and session state.** Exclusion is row locks and guarded writes only — the bot driver and the mock starter both claim work exactly the way `claimAutoStart` does (`src/draft-service/auto-start.ts:60-67`): a guarded `UPDATE ... RETURNING`, or the store's own `drafts FOR UPDATE`.
- **Immutability:** domain types `readonly`; `src/domain/**` under `eslint-plugin-functional`. The archetype table and bot roster are `as const` tuples with unions derived from them.
- **Timing:** no ambient clock. Every mock writer and the bot driver take a `Clock` (`src/domain/timing.ts`); the bot think-delay is measured against `state.turnStartedAt`, never a wall clock read inline. **Randomness follows the same DI law:** no `Math.random` anywhere in the mock path — every stochastic choice reads an injected `Rng` (Task 1), seeded from `mock_rooms.bot_seed`.
- **Identity:** server code reads "who is this" only via `getCurrentUser()`/`requireCurrentUser()`. WorkOS owns authn (standing memory law — never roll our own). This is load-bearing for ruling 4 (no guest sessions this phase).
- **Client boundary:** the room directories reach services only over the wire. `src/mock-draft/**` is pure but **BLOCKED, not exempt** (the `src/integrity` precedent, `docs/conventions.md:562-571`): its bot brain value-imports `@/draft-engine`, which the rooms must never reach as a value, and the two config values the setup form needs cross as props from a server page instead (ruling 8). `src/mock-draft-service/**` joins the banned value-import list.
- **API envelope:** `{ ok: true, data }` / `{ ok: false, error }` via `src/lib/api/respond.ts`; bodies via `parseJson(request, ZodSchema)`; error strings are user-facing plain language.
- **Config over magic numbers:** every clock preset, delay bound, temperature, reach cap, fill window, retention window and roster of bot names lives in `MOCK_CONFIG` (`src/mock-draft/config.ts`), never inline.
- **Tests beside the code**, integration against the real docker-compose Postgres/Redis (`createTestDb()` + `truncateAll(db)`), `fileParallelism: false`.
- **Coverage:** the gate list in `vitest.config.mts` holds **24** directories today (`docs/conventions.md:599`, counted). This plan adds **two gates**: `src/mock-draft/**` (gate 25, pure) and `src/mock-draft-service/**` (gate 26, service layer), each with `include` AND a `thresholds` block at 100%.
- **Migrations:** the latest is `drizzle/0040_league_dissolution_status.sql` (counted off the directory); this plan ships `0041_mock_drafts.sql`. `ADD COLUMN ... NOT NULL DEFAULT false` on `leagues`/`users` is safe pre-deploy; nothing uses `CONCURRENTLY`.
- **Commits:** conventional commits, one per completed step, bodies explain why.
- **Environment:** this plan adds **no env var.** Bot behavior is config plus a per-row seed, and there is no external service behind any of it.

**From `docs/design-system.md` (the v3 six rules bind all new UI) and the copy rulebook:**

- The Sunday Standard's six rules, verbatim from the doc's own spine: **color is meaning** (green money/seats, red live/clocks, everything else ink and paper); **one face, earned weights**; **no capitals anywhere** (`no-uppercase.source.test.ts` gates it); **hairlines, not boxes**; **one ink action per view** (`accent-budget.source.test.ts` gates the spellings); **only true things move.** No raw hex, no raw px; both themes first-class and tested via `renderSurface`; WCAG 2.2 AA; 360px minimum; never a dead end.
- **Copy:** no contractions, no em or en dashes, active voice, nothing in `INTEGRITY_CONFIG.notices.accusatoryTerms` or `passiveConstructions` (`src/integrity/config.ts:63,71`). Every new component joins `src/integrity/rendered-copy.test.tsx`'s roster in the task that creates it; the four sweeps cover the rest.
- **The C3 vocabulary law, extended:** "the room picks for you from your queue" remains the ONLY safety-net phrase, and `copy-rules.ts` already bans "autodraft"/"auto-draft" (`src/integrity/copy-rules.ts:75-76`). Bots get their own honest vocabulary, named once (Task 1): they are **"practice opponents"**, each rendered with a visible `bot` marker; no surface ever writes "AI", "smart AI", "learns", or any sentence that promises intelligence this phase does not ship (Task 1 Step 4 adds the banned terms to the rulebook so the sweeps enforce it, not review).
- **Mocks never touch money — stated as law, proven as mechanism:** the whole mock lifecycle (create, claim, top-up, start, forty picks, complete, sweep) runs under the Phase 4 statement spy with zero `money_%` statements (Task 4 Step 1). Trivially true today because nothing in the mock path imports a money writer; the spy is what keeps it true after someone adds one.

**Founder rules (binding):** no MVP; centralize UI primitives the first time; persona-panel pass on every new user-facing surface (Task 10 — first-timer and veteran are the deciders for this phase); no mock data on real surfaces — which for THIS phase reads: a practice room is real machinery honestly labeled, and every number on the results page is derived from the draft's own log, never invented (ruling 5).

---

## What is already true (read before touching anything)

Checked against this worktree (`main` at `cbd4db0`). Each row was verified by reading the file named.

| The product shape assumes | Reality in the code today |
|---|---|
| The bot's pick mechanism is the existing autopick path | **Half true, and the half matters.** The engine's autopick (`reduceSnakeExpiry` → `bestAvailableFor`, `src/draft-engine/snake.ts:68-81`, `selectors.ts:165-183`) fires only on `TIMER_EXPIRE`, and `admitTimerExpire` refuses any expiry before the deadline (`admit.ts:77-83`) — so bots riding autopick would wait the full pick clock every turn, and eleven bots at 60s each is a dead room. The bot driver therefore submits ordinary `MAKE_PICK` actions through `store.applyAction` after a short seeded think-delay (Task 6); `bestAvailableFor`'s queue-then-pool legality walk is REUSED as the bot brain's legality oracle (`chooseBotPick` samples only from picks `assignSlot` accepts, the same predicate), and the engine's own expiry remains the human safety net inside a mock exactly as in a real room. |
| The clock is configurable per draft | **It is not.** `loadDraftConfig` hardcodes `DRAFT_CLOCK_SCHEDULE` and `DRAFT_PAUSE_WINDOW` onto every draft (`src/draft-service/setup.ts:34-38`); the schedule is kickoff-relative (`config.ts:19-25`, 8h → 90s floor). A mock created with `kickoffAt = now` would land on the 90s floor — close, but not the configurable fast clock the spec asks for. Because `clockSchedule` is command-time/view-time only (never read by the reducer — `reduce.ts:9-14`'s guard rule, and `admitCommand`'s docblock records the replay incident that forced it), a per-draft substitution is deploy-safe: Task 4 has `loadDraftConfig` return a single-tier schedule `[{ untilHoursBeforeKickoff: 0, pickSeconds: mockRoom.pickSeconds }]` for a mock, and the overnight pause window is dropped for mocks (`appliesAtOrAbovePickSeconds` already exempts fast tiers; a mock never reaches a slow one). |
| A bot can sit in a seat | **Only as a user.** `teams.userId` is `NOT NULL` with an FK to `users` and a unique `(leagueId, userId)` index (`src/db/schema.ts:334-351`), and `startDraft`'s in-transaction thunk draws `draftOrder` from `teams` rows (`store.ts:674-695`); the room resolves names by joining `users` (`src/draft-service/teams.ts:13-17`). So bots are a seeded roster of `users` rows (`is_bot`, Task 2) seated as ordinary teams — and the unique index means one bot user cannot hold two seats in one room, which is why the roster holds more names than the largest room has seats. |
| A mock league can be excluded from the product's numbers | **Mostly by construction, with one hole.** `ENFORCED_LEAGUE_SQL` is `is_public_matchmade = true` (`src/league-service/enforcement.ts:82`) and already scopes browse, the wire's three queries (`wire.ts:57,86,116`), the proof strip's 48h and next-draft reads (`proof.ts:72,93`) and auto-start's due scan (`auto-start.ts:127`). The hole is `leaguesFilledQuery` (`proof.ts:48-54`) — deliberately unscoped ("a total count across every league, public or private") and consumed by BOTH the proof strip and the wire's season count (`wire.ts:171`), so a drafted mock would inflate "leagues filled this season" in two places from one query. Task 2 adds `NOT is_mock` there, one place. `completedSeasonsQuery` (`participation.ts:21-27`) is gated on `seasonCompletedAt`, which only `stampSeasonCompleteInTx` writes from the scoring pipeline — a mock never grows matchups (Task 4 skips the season commit), so participation history is safe without a predicate, and a belt test proves it. |
| A completed draft just ends | **A completed draft becomes a season, atomically.** `applyAction` runs `commitDraftState` inside the same transaction the moment phase reaches `complete` (`store.ts:516-518`), writing `draft_picks`, `roster_slots` and the full matchup schedule, then audits `draft_completed` and fires the multi-account sweep (`store.ts:522-531,574`). Every one of those is wrong for a mock: Task 4's mock lane skips all four, which is also what keeps mocks out of the scoring pipeline, auto-lineup and enforcement without touching any of them. |
| Deleting a mock is a `DELETE` | **The audit spine forbids deletion at the database.** `audit_events` carries `BEFORE UPDATE`/`BEFORE DELETE` triggers that raise (`drizzle/0019_audit_spine.sql:41-52`), and the checkpoint table refuses deletion too (`0021`). So retention is only possible if mocks never write audit rows in the first place — the carve-out (ruling 2) is what makes the sweep (Task 6) a clean cascade off `leagues` (`teams`, `drafts` → `draft_actions`/`draft_nudges`, `scoring_settings`, `chat_messages`, `mock_rooms` all cascade; verified against the FK declarations in `schema.ts`). |
| The league creation writer can be reused | **Yes, and it must be.** `writeLeagueInTx` is "the one write shape a league ever gets" (`creation.ts:231-308`), already shared by `createLeague` and the house factory precisely so a second creation path cannot drift; it takes an injected `AuditLogger` (parameter, not import), so the mock creation passes a no-op logger under ruling 2 rather than forking the writer. The tier gate does not bite (`tierJoinPrecondition` short-circuits for non-public leagues), and `leagueMoneyOrRefuse` passes untouched because a mock is fee-0 by construction. |
| The mock lobby needs new fill machinery | **The sit-and-go shape exists; the mock wants its own numbers, not its own mechanism.** `fireWhenFullInTx` stamps `kickoff_at = now + MATCHMAKING_CONFIG.sitAndGo.graceSeconds` (300s) and sends notices/audit (`fill-trigger.ts:32-70`) — the notices/audit halves are exactly what mocks must not do, and `dueDraftsQuery` only starts FULL public rooms (`auto-start.ts:118-133`). So Task 5 gives mocks their own two-line kickoff stamp (same guarded-UPDATE shape, no notice, no audit) and Task 6 gives the ticker a mock due-scan that starts a due mock REGARDLESS of fill by topping up bots first — the roll's "never start short" law is a real-league law; a mock's whole premise is that bots make short impossible. |
| The ticker can carry another lane | **It already carries three.** `tick()` runs auto-start, then the interval-gated house reconcile, then the expiry scan, each in its own try/catch so one lane's failure never starves another (`ticker.ts:131-191`), with per-lane bounds (`maxDraftsPerTick: 50`, `houseReconcileIntervalMs: 30_000`, `config.ts`). The mock lanes (due-start, bot driver, interval-gated sweep) copy that exact shape, and the expiry scan needs NO change: `liveDraftsQuery` is status-keyed (`ticker.ts:34-41`), so a live mock's human-seat clock already expires into the real autopick path. |
| The room requires a signed-in member | **True at every layer.** The room page calls `requireCurrentUser()` (`src/app/app/(room)/drafts/[draftId]/page.tsx:35`), middleware redirects all of `/app` except the one tight invite-terms exemption (`src/middleware.ts:20`), and every draft API resolves the actor from the session via `resolveDraftActor` → `resolveLeagueMembership` (`authz.ts:29-50`) — teamId never from a body. Ruling 4 (sign-in-first, mock as the landing reward) is argued from these three citations. |
| RoomTour is the practice stand-in | **It is a three-stop modal, not a rehearsal** (`room-tour.tsx:32-41`): static copy about the clock, the queue and the pick button, mounted by the draft room once-ever and by the waiting room's checklist as a repeatable preview (`room-tour.tsx:43-61`). Task 9 upgrades the checklist item and the tour's closing stop to offer the real thing. |
| Rankings exist for bots to draft from | **`rankedPlayers` is the platform's own board:** every player scored by the league's own settings via the real scoring engine, cached per league (`pool.ts:45-72`), snapshotted into `START_DRAFT` as the pool (`pool.ts:84-86`) — so `state.pool` order IS the ranking, available to the bot brain pure, off the state, with no extra read. The cache is a module-level `Map` keyed by leagueId with an explicit invalidator (`pool.ts:27-38`); the sweep must call `invalidateRankedPlayersCache` per swept league or every mock leaks one cached ranking forever (Task 6 Step 3). |
| Counts this plan must not hardcode | The coverage gate list is at **24** (`docs/conventions.md:599`); migrations end at `0040`; the e2e suite is **12** spec files (`e2e/`, counted); the realtime event union lives in `src/lib/realtime/events.ts`. The executor reads each count off the file at execution time, per the standing lesson. |

---

## File Structure

**New — pure (`src/mock-draft/`, coverage gate 25, BLOCKED for rooms — ruling 8):**

| File | Responsibility |
|---|---|
| `src/mock-draft/config.ts` | `MOCK_CONFIG`: modes tuple, team-count options, pick-clock presets, bot think-delay bounds, temperature, reach cap, run-reaction window, fill window, retention windows, per-tick bounds, the bot roster (24 named practice opponents), `MOCK_COPY` (the practice banner, the swept-room sentence, the results vocabulary). |
| `src/mock-draft/rng.ts` | The `Rng` seam: `interface Rng { next(): number }` (unit interval), `createSeededRng(seed)` (mulberry32-class, pure), `rngFor(seed, streamKey)` deriving a per-bot stream so two bots never share a sequence. |
| `src/mock-draft/archetypes.ts` | `BOT_ARCHETYPES` and the per-draft assignment draw (Task 3). |
| `src/mock-draft/bots.ts` | `chooseBotPick(state, teamId, archetype, rng)` — the strategy layer, pure over `DraftState` + `Rng`. |
| `src/mock-draft/lobby-view.ts` | `MockRoomSummary` and the pure formatters the lobby renders (seat sentence, countdown sentence). |

**New — server-only (`src/mock-draft-service/`, coverage gate 26, banned value-import):**

| File | Responsibility |
|---|---|
| `creation.ts` | `createMockRoom` — `writeLeagueInTx` with `isMock`, the `mock_rooms` insert, host seat, solo-mode bot fill, one transaction. |
| `claim.ts` | `claimMockSeat` — the lobby/link door: `leagues FOR UPDATE`, capacity, idempotent re-entry, the early-start stamp. |
| `start.ts` | `topUpBots` + `startMockDraft` — bot seating then `store.startDraft`, crash-safe across the two transactions. |
| `driver.ts` | `driveBotPicks(db, deps)` — the ticker lane that submits bot `MAKE_PICK`s through `store.applyAction`. |
| `sweep.ts` | `sweepExpiredMocks(db, deps)` — retention deletes, cache invalidation. |
| `lobby.ts` | `listOpenMockRooms`, `myMockRooms` — the lobby reads (builders, EXPLAIN-tested). |
| `schemas.ts` | Zod v4 request schemas, every bound derived from `MOCK_CONFIG`, never retyped. |

**Modified:** `src/db/schema.ts` (+`leagues.isMock`, `users.isBot`, `mock_rooms`), `src/league-service/proof.ts` (`leaguesFilledQuery` + `NOT is_mock`), `src/league-service/read.ts` (`myLeaguesOverview` excludes mocks — read the current query off the file), `src/draft-service/setup.ts` (mock clock schedule), `src/draft-service/store.ts` (the mock lane), `src/draft-service/ticker.ts` (three mock lanes), `src/draft-service/teams.ts` (+`isBot` on `TeamCard`), `src/draft-room/components/` (bot marker, practice banner, results panel — read current component names off the directory), `src/league-room/components/front-door-hero.tsx` + `waiting-checklist.tsx` + the browse page (entry points), `src/integrity/copy-rules.ts` (+ the banned bot-vocabulary terms), `vitest.config.mts` (two gates), `eslint.config.mjs` (banned lists), `docs/conventions.md`.

**New routes:** `src/app/app/(shell)/practice/page.tsx` (the lobby + setup), `src/app/api/mock-drafts/route.ts` (GET lobby, POST create), `src/app/api/mock-drafts/[code]/route.ts` (GET room summary, POST claim). The room itself is the EXISTING `/app/drafts/[draftId]` — no mock room route exists, on purpose.

**New migration:** `drizzle/0041_mock_drafts.sql`. **New docs:** `docs/mock-drafts.md`, `docs/decisions/mock-drafts.md`. **New e2e:** `e2e/mock-draft.spec.ts`.

---

## Task 1: The mock vocabulary — config, RNG seam, honest words

**Files:**
- Create: `src/mock-draft/config.ts`, `rng.ts` (+ tests)
- Modify: `src/integrity/copy-rules.ts` (+ its test), `vitest.config.mts` (gate 25), `eslint.config.mjs` (`src/mock-draft` onto the room-banned list beside `@/integrity`), `docs/conventions.md`

**Interfaces:**
- Consumes: nothing but TypeScript.
- Produces: `MOCK_CONFIG`, `MOCK_COPY`, `Rng`, `createSeededRng`, `rngFor`, `MockMode`.

- [ ] **Step 1: Write the failing vocabulary and RNG tests**

```ts
// src/mock-draft/rng.test.ts
it("produces the identical sequence for the identical seed, and a different one for the next seed", () => {
  const a = createSeededRng(42);
  const b = createSeededRng(42);
  const c = createSeededRng(43);
  const seqA = [a.next(), a.next(), a.next()];
  expect(seqA).toEqual([b.next(), b.next(), b.next()]);
  expect(seqA).not.toEqual([c.next(), c.next(), c.next()]);
});

it("derives independent, reproducible per-bot streams from one draft seed", () => {
  const a1 = [rngFor(42, "team_a").next(), rngFor(42, "team_a").next()];
  expect(rngFor(42, "team_a").next()).toBe(a1[0]);          // same seed + key: same stream
  expect(rngFor(42, "team_b").next()).not.toBe(a1[0]);      // different key: distinct stream
});

// src/mock-draft/config.test.ts
it("keeps every bot think-delay inside the fastest pick clock, with room for the human safety net", () => {
  const fastest = Math.min(...MOCK_CONFIG.pickClockSecondsOptions);
  expect(MOCK_CONFIG.botDelay.maxSeconds).toBeLessThan(fastest * MOCK_CONFIG.botDelay.maxFractionOfClock);
});

it("holds a bot roster larger than the largest room, so the seat draw never runs dry", () => {
  expect(MOCK_CONFIG.botRoster.length).toBeGreaterThanOrEqual(Math.max(...MOCK_CONFIG.teamCountOptions) + 4);
  expect(new Set(MOCK_CONFIG.botRoster.map((b) => b.id)).size).toBe(MOCK_CONFIG.botRoster.length);
});
```

- [ ] **Step 2: `MOCK_CONFIG` — every number a docblock defends**

```ts
export const MOCK_CONFIG = {
  /** The three founder-required modes. `solo` seats bots at creation; the other two top up at start. */
  modes: ["solo", "lobby", "link"] as const,
  teamCountOptions: [8, 10, 12] as const,
  /** Practice clocks. 30s is Underdog's fast-mock pace; 60s default; 90s matches the real floor
   *  (DRAFT_CLOCK_SCHEDULE's own last tier) for a true dress rehearsal. */
  pickClockSecondsOptions: [30, 60, 90] as const,
  defaultPickClockSeconds: 60,
  /** Bot think-delay, seeded per pick: a live lobby sees a realistic cadence, never an
   *  11-pick burst. Max stays under maxFractionOfClock of the fastest clock so a bot can
   *  never be autopicked by its own dawdling and never collides with the moderator's nudge. */
  botDelay: { minSeconds: 3, maxSeconds: 9, maxFractionOfClock: 0.5 },
  /** Rank-weighted sampling temperature and the hard reach cap (founder: varied, never absurd).
   *  A bot considers at most reachDepth eligible players and samples softmax-ish by rank. */
  strategy: { temperature: 3.0, reachDepth: 8, runReaction: { window: 4, threshold: 3, needBoost: 2.0 } },
  /** Lobby/link rooms start this long after creation, bots topping up whatever is empty. */
  fillWindowSeconds: 180,
  /** All human seats full => start this soon instead (the sit-and-go grace, mock-sized). */
  earlyStartGraceSeconds: 10,
  retention: {
    /** A finished room and its results page live this long, then the sweep clears them. */
    completedMs: 24 * 60 * 60 * 1000,
    /** A room nobody started (host bailed before the window fired and nothing ticked it) lives this long. */
    unstartedMs: 2 * 60 * 60 * 1000,
    /** An in-progress room abandoned mid-draft (every human skipped out) is cleared after this. */
    inProgressMs: 6 * 60 * 60 * 1000,
  },
  /** Ticker-lane bounds, following DRAFT_SERVICE_CONFIG.maxDraftsPerTick's precedent. */
  maxMockStartsPerTick: 20,
  maxBotPicksPerTick: 100,
  sweepIntervalMs: 60_000,
  botRoster: [
    { id: "bot_park", name: "Park Bench Bot" } /* ...24 total, named in Task 1, drawn per room */,
  ],
} as const;
```

- [ ] **Step 3: `MOCK_COPY` — the honest words, named once.** The practice banner: *"This is a practice draft. Nothing here counts, and this room clears itself after a day."* The bot marker label: `practice opponent`. The swept-room sentence, the results heading, the lobby empty state (with an action — never a dead end). All sweep-clean: no contractions, no dashes, nothing accusatory or passive.
- [ ] **Step 4: Extend the copy rulebook.** `copy-rules.ts` gains the bot-vocabulary ban beside the C3 family: `"ai opponent"`, `"smart ai"`, `"learns from"`, `"machine learning"` — the phase's honesty floor (no claim of learning until Phase 6 ships learning), enforced by the same four sweeps that enforce C3, and the rulebook's own test grows the cases.
- [ ] **Step 5: Wire gate 25 and the boundary entries; commit.**

---

## Task 2: The schema — one column, one sidecar, one seeded roster

**Files:**
- Create: `drizzle/0041_mock_drafts.sql`
- Modify: `src/db/schema.ts`, `src/db/index-plans.test.ts`, `src/league-service/proof.ts` (+ `proof.test.ts`), `src/league-service/read.ts` (+ its tests), `src/data/seed` (bot roster upsert)

**Interfaces:**
- Consumes: `MOCK_CONFIG.botRoster`, `MockMode`.
- Produces: `leagues.isMock`, `users.isBot`, `mockRooms`; the excluded aggregates.

- [ ] **Step 1: Write the failing exclusion tests**

```ts
// src/league-service/proof.test.ts (integration)
it("never counts a drafted mock in leagues filled this season", async () => {
  await seedDraftedLeague(db);                      // count 1
  await seedCompletedMockRoom(db);                  // a mock that drafted to completion
  const [row] = await leaguesFilledQuery(db);
  expect(row!.count).toBe(1);
});

it("keeps every mock off the wire, the browse shelf and the locker room", async () => {
  await seedCompletedMockRoom(db);
  expect(await listWireItems(db, clock)).toHaveLength(0);
  // browse and myLeaguesOverview assertions beside it, each against the real exported builder
});
```

- [ ] **Step 2: The schema.** `leagues.isMock boolean NOT NULL DEFAULT false`; `users.isBot boolean NOT NULL DEFAULT false`; `mock_rooms`: `leagueId text PK` FK → `leagues` ON DELETE CASCADE, `hostUserId text NOT NULL` FK → `users`, `mode mock_mode NOT NULL` (pg enum over `MOCK_CONFIG.modes`), `pickSeconds int NOT NULL`, `botSeed int NOT NULL`, `shareCode text NOT NULL UNIQUE`, `startsAt timestamptz NOT NULL` (the fill-window deadline; solo rooms stamp `now`), `createdAt timestamptz NOT NULL DEFAULT now()`. A `CHECK (pick_seconds > 0)`. Indexes, each with its query named in `index-plans.test.ts`: `mock_rooms (starts_at)` (the ticker's due scan and the sweep), partial `leagues (created_at) WHERE is_mock` only if the lobby EXPLAIN needs it — measured, not assumed (the lobby joins `mock_rooms`, whose PK may already serve it; the executor keeps whichever the EXPLAIN defends).
- [ ] **Step 3: The bot roster seed.** An idempotent upsert (`ON CONFLICT (id) DO NOTHING`) of `MOCK_CONFIG.botRoster` into `users` with `isBot: true`, deterministic ids (`bot_*`), reserved emails (`<id>@bots.commish.internal` — satisfies `users.email NOT NULL UNIQUE`, `schema.ts:117-163`, routable nowhere), run from the seed AND from `createMockRoom`'s own ensure step (Task 5) so a fresh database needs no manual step. Bot users hold no session, no preferences, no reviews; a test asserts `isBot` users never appear in any identity surface the executor greps for `users` joins on.
- [ ] **Step 4: The aggregate fixes.** `leaguesFilledQuery` gains `eq(leagues.isMock, false)`; `myLeaguesOverview` (read off `read.ts` at execution time) excludes mocks so the locker room stays a room of real leagues (practice re-entry lives in the lobby, Task 9). A belt test pins `completedSeasonsFor` at zero after a completed mock (no matchups can exist — Task 4 — but the test outlives that reasoning).
- [ ] **Step 5: Migration forward-applied against a cold `npm run infra:up` stack; commit.**

---

## Task 3: The bot brain — archetypes, temperature, need, runs

Pure over `DraftState` and `Rng`. No I/O, no clock, no `Math.random` — the DI law, so a draft's seed replays its bots exactly.

**Files:**
- Create: `src/mock-draft/archetypes.ts`, `bots.ts` (+ tests)

**Interfaces:**
- Consumes: `DraftState`, `availablePool`, `assignSlot`, `rosterFor`, `queuedEntriesFor` (`@/draft-engine`), `Rng`, `MOCK_CONFIG.strategy`.
- Produces: `BOT_ARCHETYPES`, `assignArchetypes`, `chooseBotPick`.

- [ ] **Step 1: Write the failing strategy tests**

```ts
it("always returns a pick the engine will accept", () => {
  // Property harness: drive whole 12-team drafts on random seeds; every chooseBotPick result,
  // applied as MAKE_PICK through reduceDraft, must come back ok — the same legality oracle
  // bestAvailableFor uses (assignSlot over the live roster) is the sampler's own filter.
});

it("is deterministic under a fixed seed and varied across seeds", () => {
  const a = runFullMockDraft({ seed: 7 });
  const b = runFullMockDraft({ seed: 7 });
  const c = runFullMockDraft({ seed: 8 });
  expect(a.pickLog).toEqual(b.pickLog);
  expect(a.pickLog).not.toEqual(c.pickLog);
});

it("never reaches past the configured depth", () => {
  // For every bot pick in the harness: the chosen player's index among the ELIGIBLE
  // (rosterable) remainder of the board is < MOCK_CONFIG.strategy.reachDepth.
});

it("reacts to a position run", () => {
  // Seed a state where 3 of the last 4 picks are RB (strategy.runReaction.threshold hit):
  // across 200 seeds, the RB-pick rate with the run present must exceed the rate without it.
  // A statistical assertion with a wide margin, not a flaky exact count.
});
```

- [ ] **Step 2: The archetypes — seven, each one line of heuristic**

```ts
/** Weight tweaks over the shared sampler, per bot per draft. Names are internal; the room
 *  shows only the practice-opponent marker (Task 8) — an archetype is texture, not a claim. */
export const BOT_ARCHETYPES = [
  { name: "best_available",  needWeight: 1.0, posBias: {} },                       // trusts the board
  { name: "rb_heavy",        needWeight: 1.0, posBias: { RB: 1.6 } },              // hammers RB early
  { name: "zero_rb",         needWeight: 1.0, posBias: { RB: 0.4, WR: 1.5 } },     // fades RB, feasts WR
  { name: "qb_early",        needWeight: 1.0, posBias: { QB: 1.8 } },              // takes the QB room scoffs at
  { name: "te_premium",      needWeight: 1.0, posBias: { TE: 1.7 } },              // pays up at TE
  { name: "need_filler",     needWeight: 2.0, posBias: {} },                       // drafts the roster sheet
  { name: "run_follower",    needWeight: 1.0, posBias: {}, followsRuns: true },    // panics with the room
] as const;
```

`assignArchetypes(draftSeed, botTeamIds)` draws one per bot with `rngFor(seed, "archetypes")` — the same room never fields seven copies of one brain, asserted by a spread test.

- [ ] **Step 3: `chooseBotPick` — one sampler, four inputs.** Build the eligible list exactly as `bestAvailableFor` does (available AND `assignSlot` ok — reuse the selectors, never a second legality rule); take the top `reachDepth`; score each as `exp(-index / temperature) × posBias[position] × needMultiplier(roster, slotConfig) × runMultiplier(recentPicks)`; sample by weight with the bot's own `rngFor(seed, teamId)` stream. `needMultiplier` reads open starting slots off `state.config.slotConfig` minus `rosterFor` — a bot with no starting RB late weights RB up, scaled by `archetype.needWeight`. `runMultiplier` reads the last `runReaction.window` picks off `state.picks`; at `threshold` same-position picks it multiplies that position by `needBoost` for archetypes with `followsRuns` (and mildly for all — the founder's real-world scenario). Every constant from `MOCK_CONFIG.strategy`.
- [ ] **Step 4: Commit.**

---

## Task 4: The store's mock lane — the real engine, none of the consequences

**Files:**
- Modify: `src/draft-service/setup.ts`, `store.ts`, `ticker.ts` (nudge targeting only) (+ their tests), `src/draft-engine/state.ts` only if `DraftConfig` needs the field threaded (it does: `isMock`)

**Interfaces:**
- Consumes: `mockRooms`, `leagues.isMock`.
- Produces: `DraftConfig.isMock`, `DraftConfig.clockSchedule` per-draft for mocks; an `applyAction` that leaves no trace machinery behind a mock.

- [ ] **Step 1: Write the failing trace tests — the phase's central law**

```ts
it("runs a complete mock draft without one audit, notice, money or season statement", async () => {
  const { draftId } = await seedStartedMockRoom(db, { seed: 7 });
  const statements = await recordStatements(() => driveToCompletion(db, draftId));
  expect(statements.filter((s) => /audit_|member_notices|money_|draft_picks|roster_slots|matchups/.test(s))).toHaveLength(0);
});

it("keeps every real-league consequence for a real league, byte-identical", async () => {
  // The mirror test: the identical drive over a REAL league still writes picks audit events,
  // the autopick notice, draft_picks and the schedule — the mock lane cannot leak backward.
});

it("gives a mock the configured clock and a real league the real schedule", async () => {
  const config = await loadDraftConfig(db, mockDraftId);
  expect(config!.clockSchedule).toEqual([{ untilHoursBeforeKickoff: 0, pickSeconds: 60 }]);
  expect((await loadDraftConfig(db, realDraftId))!.clockSchedule).toBe(DRAFT_CLOCK_SCHEDULE);
});
```

- [ ] **Step 2: `loadDraftConfig`.** Join `mock_rooms` (left) alongside the existing `leagues` join; when a row exists, set `isMock: true`, `clockSchedule: [{ untilHoursBeforeKickoff: 0, pickSeconds: row.pickSeconds }]`, `pauseWindow: null` (type widened; the selectors already treat the window as a courtesy applied where deadlines are computed — a null window computes plain deadlines). `DraftConfig.isMock: boolean` defaults false everywhere else; the reducer never reads it (the reducer-purity rule is untouched — this is config the same way `clockSchedule` is).
- [ ] **Step 3: The `applyAction` mock lane.** Behind `state.config.isMock`, skip: the autopick/skip notice blocks, `auditEventsForPicks` + `audit.recordAll`, the `draft_completed` audit record, `commitDraftState`, and the post-commit `sweepQuietly`. The action append, the row locks, the cache, `broadcast` and `deliverNotice`-for-nothing all run unchanged — SSE is how the room stays live, and the lock order is how two humans in a lobby mock stay serialized. `startDraft`'s `alsoInTransaction` claim (`claimAutoStart`) runs unchanged; its `auto`-mode announcement is never reached for mocks because the mock starter calls `startDraft` without `auto` (Task 5) — asserted, not assumed.
- [ ] **Step 4: The nudger stays on, aimed only at humans.** `tickOne`'s nudge call is untouched; `createNudgeScheduler` gains one guard: resolve the on-clock team's `users.isBot` (one indexed read, cached per draft in the scheduler's existing shape) and skip bots. Config keeps it structurally moot (`botDelay.maxSeconds` under half the fastest clock, Task 1's test), but the guard is what makes "the moderator never talks to a bot" a fact instead of a coincidence. The moderator IS part of the showcase — a first-timer stalling in a mock gets the same nudge a real room gives, which is the trust argument for leaving it on (ruling 11).
- [ ] **Step 5: Lock-order suite entries for the mock-lane `applyAction` beside a concurrent mock seat claim; commit.**

---

## Task 5: The mock lifecycle writers — create, claim, top up, start

**Files:**
- Create: `src/mock-draft-service/creation.ts`, `claim.ts`, `start.ts`, `schemas.ts`, `test-support.ts` (+ tests)
- Modify: `src/league-service/creation.ts` (`CreateLeagueInput.isMock` threaded into `writeLeagueInTx`'s insert), `src/integrity-service/lock-order.test.ts`

**Interfaces:**
- Consumes: `writeLeagueInTx`, `DraftStore.startDraft`, `Clock`, `Rng`, `MOCK_CONFIG`.
- Produces: `createMockRoom`, `claimMockSeat`, `topUpBots`, `startMockDraft`, `MOCK_REFUSALS`, `expectNoMockRoomCreated`, `expectNoSeatClaimed`.

- [ ] **Step 1: Write the failing lifecycle tests**

```ts
it("creates a solo room fully seated and started in one call, and the caller lands on a live draft", async () => {
  const out = await createMockRoom(db, { hostUserId: "u1", mode: "solo", teamCount: 12, pickSeconds: 60, scoringPreset: "ppr", rosterShape: "standard" }, deps);
  expect(out.ok).toBe(true);
  const state = await deps.store.getDraftState(out.draftId);
  expect(state!.phase).toBe("in_progress");
  expect(state!.draftOrder).toHaveLength(12);
});

it("refuses the thirteenth claim with no seat taken and no row written", async () => {
  const room = await seedLobbyMock(db, { teamCount: 12, humans: 12 });
  const out = await claimMockSeat(db, { code: room.shareCode, userId: "u13" }, deps);
  expect(out).toEqual({ ok: false, status: 409, reason: MOCK_REFUSALS.full });
  await expectNoSeatClaimed(db, room.leagueId, "u13");
});

it("treats a second claim by the same person as re-entry, not an error", async () => {
  // The unique (leagueId, userId) index makes the double-click a lookup, not a 500.
});

it("survives a crash between bot top-up and start", async () => {
  // topUpBots commits, the process dies before startDraft: the room's draft is still
  // 'scheduled', the ticker's due scan (Task 6) finds it, topUpBots is idempotent
  // (count-based: seats needed = teamCount - seated), and the start completes on the next tick.
});
```

- [ ] **Step 2: `createMockRoom`.** One transaction: ensure the bot roster exists (Task 2 Step 3's upsert); `writeLeagueInTx` with `owner: { kind: "member", userId: host, teamName }`, `isPublicMatchmade: false`, `isMock: true`, entry fee fields untouched (fee-0 by omission — `leagueMoneyOrRefuse` passes with no money read), and a **no-op audit logger** (`MOCK_NOOP_AUDIT`, docblocked to ruling 2 — the one sanctioned no-op in the codebase, exported from this module so a grep finds its every consumer); insert `mock_rooms` with `botSeed` drawn once from `crypto.randomUUID()`-derived entropy at the edge (stored, never re-drawn), `shareCode` short and unambiguous, `startsAt = now + fillWindowSeconds` (`solo`: `now`). For `solo`, seat `teamCount - 1` bots in the same transaction (a seeded draw over `botRoster` — distinct users, satisfying the unique index). After commit, `solo` calls `startMockDraft` immediately; a failure there is not an error surface — the ticker retries (Step 4's crash test). Host is the league's commissioner by construction, so the existing manual-start door stays honest for `link` mode.
- [ ] **Step 3: `claimMockSeat`.** `leagues[id] FOR UPDATE` first (the lock law); refuse a started draft (`MOCK_REFUSALS.started` — read `drafts.status` under the lock), refuse a full room, welcome a repeat claimant back with `{ ok: true, alreadySeated: true }`; insert the `teams` row; when every seat is now human-held, stamp `startsAt = now + earlyStartGraceSeconds` on `mock_rooms` (the guarded-UPDATE shape, no notice, no audit). **No seat holds, no tier gate, no money gate** — a practice seat costs nothing and protects nothing, and the hold machinery exists to make a PAID seat race humane (ruling 9).
- [ ] **Step 4: `topUpBots` + `startMockDraft`.** `topUpBots`: own transaction, `leagues FOR UPDATE`, count seated, insert `teamCount - seated` distinct bots not already in the room (seeded draw), idempotent by arithmetic. `startMockDraft`: `store.startDraft(draftId)` — the real thunk draws the order over human and bot seats alike, snapshots the real pool, and the manual-press short-room guard does not bite (it is scoped to public matchmade member leagues, `store.ts:630-641`). Two transactions on purpose, with the crash window closed by the ticker's retry, exactly `claimAutoStart`'s own philosophy: status never lies, so the scan always finds unfinished work.
- [ ] **Step 5: Lock-order pairs (claim vs claim on the last seat; claim vs the ticker's top-up) driven on two real connections; commit.**

---

## Task 6: The ticker's three mock lanes — start, drive, sweep

**Files:**
- Create: `src/mock-draft-service/driver.ts`, `sweep.ts` (+ tests)
- Modify: `src/draft-service/ticker.ts` (+ `ticker.test.ts`), `src/draft-service/config.ts` (nothing — mock bounds live in `MOCK_CONFIG`; the ticker imports them)

**Interfaces:**
- Consumes: `DraftStore`, `chooseBotPick`, `assignArchetypes`, `rngFor`, `mockRooms`, `Clock`.
- Produces: `dueMockRoomsQuery`, `driveBotPicks`, `sweepExpiredMocks`, ticker wiring.

- [ ] **Step 1: Write the failing lane tests**

```ts
it("starts a due lobby mock short of humans by topping up bots first", async () => {
  const room = await seedLobbyMock(db, { teamCount: 12, humans: 2, startsAtOffsetMs: -1 });
  await ticker.tick();
  const state = await store.getDraftState(room.draftId);
  expect(state!.phase).toBe("in_progress");
  expect(await countBotTeams(db, room.leagueId)).toBe(10);
});

it("submits a bot pick only after the seeded think-delay, through the real single-writer path", async () => {
  const { draftId } = await seedStartedMockRoom(db, { seed: 7 });
  await ticker.tick();                                   // t=0: bot on clock, delay not elapsed
  expect((await store.getDraftState(draftId))!.picks).toHaveLength(0);
  clock.advance(MOCK_CONFIG.botDelay.maxSeconds * 1000);
  await ticker.tick();
  expect((await store.getDraftState(draftId))!.picks).toHaveLength(1);
});

it("sweeps an expired mock to zero rows and drops its ranking cache", async () => {
  const { leagueId } = await seedCompletedMockRoom(db);
  clock.advance(MOCK_CONFIG.retention.completedMs + 1);
  await ticker.tick();
  for (const table of ["leagues", "teams", "drafts", "draft_actions", "mock_rooms", "scoring_settings", "chat_messages"]) {
    expect(await countRowsFor(db, table, leagueId)).toBe(0);
  }
  // and invalidateRankedPlayersCache was called for leagueId (spy) — pool.ts:27-38's Map
  // otherwise holds one dead ranking per swept mock forever.
});

it("never lets one lane's failure starve another", async () => {
  // A driver that throws still leaves the expiry scan and the sweep running this tick —
  // the identical try/catch shape the auto-start and house lanes already keep (ticker.ts:143-170).
});
```

- [ ] **Step 2: The due-start lane.** `dueMockRoomsQuery`: `mock_rooms` where `starts_at <= now` joined to `drafts` on `status = 'scheduled'`, ordered by `league_id`, limited `MOCK_CONFIG.maxMockStartsPerTick` — a builder, EXPLAIN-tested against `mock_rooms (starts_at)`. Each row: `topUpBots` then `startMockDraft`, per-row try/catch. Wired into `tick()` after the house reconcile, before the expiry scan (a mock started this tick gets its first clock checked next tick — the same ordering argument `ticker.ts:139-142` records for auto-start).
- [ ] **Step 3: The bot driver lane.** For each live draft the expiry scan already fetched (reuse its rows — no second scan), when `state.config.isMock`: resolve the on-clock team; if it is a bot (one cached `users.isBot` read per team per draft) and `now >= turnStartedAt + delayFor(rngFor(seed, teamId + pickNumber))`, submit `store.applyAction(draftId, MAKE_PICK(chooseBotPick(...)))` with `actor` absent — attribution machinery is skipped in the mock lane anyway (Task 4), and the pick rides the same mutex, the same row locks, the same sequence-conflict backstop as every human pick. Per-pick delay is seeded by pick number so cadence varies pick to pick; bounded by `maxBotPicksPerTick` across all mocks. One bot pick per draft per tick is the natural pace at `tickIntervalMs: 1_000` and needs no extra throttle — stated in the docblock with the arithmetic.
- [ ] **Step 4: The sweep lane.** Interval-gated by `MOCK_CONFIG.sweepIntervalMs` (the `houseReconcileIntervalMs` shape, `ticker.ts:160-170`): delete `leagues` rows (cascade does the rest — the FK map in the What-is-true table) for mocks past their retention window, derived per state: completed drafts by `completedMs` (completion instant read from the draft state's last action timestamp — read off `draft_actions MAX(timestamp)`, never a wall-clock guess), never-started by `unstartedMs` from `created_at`, in-progress by `inProgressMs` from the last action. Call `invalidateRankedPlayersCache(leagueId)` per deletion. The sweep deletes ONLY `is_mock` rows — the `WHERE` carries `is_mock = true` twice (join and belt), and a test proves a real league one millisecond older than every window survives.
- [ ] **Step 5: e2e checkpoint 1 — `league-lifecycle`, `formats-and-lobby` (both must pass untouched: the real product cannot tell this phase happened). Commit.**

---

## Task 7: The doors — routes and schemas

**Files:**
- Create: `src/app/api/mock-drafts/route.ts`, `src/app/api/mock-drafts/[code]/route.ts` (+ route tests), `src/mock-draft-service/lobby.ts` (+ tests)
- Modify: nothing else

**Interfaces:**
- Consumes: `requireCurrentUser` via `getCurrentUser` (JSON 401, never a redirect — the API rule), `parseJson`, `respond`, `createMockRoom`, `claimMockSeat`, `listOpenMockRooms`.
- Produces: `POST /api/mock-drafts` (create → `{ draftId, leagueId, shareCode }`), `GET /api/mock-drafts` (the lobby: open rooms + the caller's own active rooms), `GET /api/mock-drafts/[code]` (one room's summary for the link landing), `POST /api/mock-drafts/[code]` (claim).

- [ ] **Step 1: Failing route tests** — a signed-out `POST` is a JSON 401; a create body with `teamCount: 14` is a 400 naming the field (bounds derived from `MOCK_CONFIG.teamCountOptions` in `schemas.ts`, never retyped); a claim on a full room surfaces `MOCK_REFUSALS.full` with status 409; the lobby lists only `lobby`-mode, unstarted, open-seat rooms (never `link` rooms — a share code is an invitation, not a listing), each with `seatsOpen`, `startsInMs`, `pickSeconds`, `teamCount` — request-time truth, the wire's own honesty model (ruling 10).
- [ ] **Step 2: `listOpenMockRooms`** — a builder joining `mock_rooms` + `leagues` + a `teams` count, `mode = 'lobby'`, draft `'scheduled'`, seats open, ordered soonest-start first, bounded; EXPLAIN-tested. `myMockRooms` — the caller's own unswept rooms for lobby re-entry.
- [ ] **Step 3: Routes, changed-files verification + build; commit.**

---

## Task 8: The room, honestly labeled — bot markers, the practice banner, results

The mock renders THE room: `/app/drafts/[draftId]`, `DraftRoom`, the clock, the queue, the celebration, the chat, the moderator. This task adds only what honesty requires and what a finished practice deserves.

**Files:**
- Modify: `src/draft-service/teams.ts` (+`isBot` on `TeamCard`), the draft API route that serves team cards (read the current shape off `src/app/api/drafts/[draftId]/route.ts`), `src/draft-room/components/` — the rail/roster surface that renders `TeamCard`s (read current names off the directory; Phase 3.x owns them), `draft-room.tsx` (practice banner slot, results panel slot), `src/integrity/rendered-copy.test.tsx` (roster additions)
- Create: `src/draft-room/components/practice-banner.tsx`, `mock-results.tsx`, `share-link-panel.tsx` (+ tests)

**Interfaces:**
- Consumes: `TeamCard.isBot`, `DraftStateView` (the completed state: picks, rosters, pool order), `MOCK_COPY`.
- Produces: the labeled room and the results page.

- [ ] **Step 1: Failing component tests** — every bot team card renders the `practice opponent` marker (a quiet hairline chip, ink not color — rule 1 spends color on money and live only) and never renders for a human; the practice banner renders exactly `MOCK_COPY.banner` in both themes with axe clean; the room's every existing surface renders unchanged for a real draft (snapshot the real-room render before and after — byte-identical DOM).
- [ ] **Step 2: The results panel — facts, no grade.** On `phase === "complete"` in a mock, the room's board yields to `MockResults`: your roster grouped by slot; your pick list with each pick's **board delta** — "you took him at pick 14; the board ranked him 9" — computed from `state.pool` order (the ranking snapshotted at start, so the number is a fact of this draft's own log, real by construction); the room's next actions ("run it again", "open the lobby", "browse real leagues" — never a dead end); and the retention sentence. **No letter grade** (ruling 5): a grade manufactures authority this platform has not earned and the real-only rule forbids — the delta list is the honest version of the same itch.
- [ ] **Step 3: `ShareLinkPanel`** — the `link`-mode waiting surface: the share code as a copyable URL, seat fill (the existing `SeatMeter` primitive — centralize-the-first-time says reuse it, not a new meter), the countdown to `startsAt`. Rendered in the waiting shell for an unstarted mock (read the current pre-start room shape off `DraftRoom` and mount beside it).
- [ ] **Step 4: Persona-adjacent copy sweep additions; both themes; 360px; changed-files tests + build; commit.**

---

## Task 9: The entry points — front door, browse, locker, lobby page, RoomTour's upgrade

**Files:**
- Create: `src/app/app/(shell)/practice/page.tsx`, `src/league-room/components/mock-lobby.tsx`, `mock-setup-form.tsx` (+ tests)
- Modify: `src/league-room/components/front-door-hero.tsx` (+ its tests), the browse page (read the current shelf composition off `src/app/browse`), `waiting-checklist.tsx`, `first-run-panel.tsx`, `room-tour.tsx` (closing stop), `src/integrity/rendered-copy.test.tsx`

- [ ] **Step 1: Failing entry-point tests** — the front door gains one quiet outlined action, "try a practice draft" (rule 5: the ink pill stays on the real product's primary action), pointing signed-out visitors at `/sign-up?returnTo=/app/practice` via the existing `SignInLink` intent rule (`docs/conventions.md:414` — intent carried, validated where it redirects) and signed-in ones straight at `/app/practice`; the two pinned hero sentences ("Every league is free this season.", `front-door-hero.tsx:12`) keep passing byte-for-byte; the browse page gains the same quiet entry above the shelf; `FirstRunPanel` (the empty locker) gains the practice path as its first suggestion for a leagueless account; `WaitingChecklist`'s "see how the draft room works" item now offers BOTH the tour and "run a practice draft" (row 18's ask, answered where the stand-in lived); `RoomTour`'s closing stop gains one sentence pointing at practice — using the C3 phrase for the safety net, verbatim, and `MOCK_COPY` for the rest.
- [ ] **Step 2: The lobby page.** A `(shell)` page: the setup form (mode, team count from `MOCK_CONFIG.teamCountOptions`, clock from `pickClockSecondsOptions`, scoring preset and roster shape reusing the create-league form's existing option vocabulary — read `create-league-form.tsx` and reuse its primitives, never a parallel picker), the open lobby rooms (`GET /api/mock-drafts`, request-time counts with a refresh affordance — no anonymous or pre-seat SSE, ruling 10), and "your practice rooms" for re-entry. `MOCK_CONFIG` values cross into the client form as props from the server page (ruling 8).
- [ ] **Step 3: e2e checkpoint 2 — `whole-site`, `mobile-360`, `money-dark`, plus Task 11's spec if landed; build. Commit.**

---

## Task 10: The persona checkpoint — first-timer and veteran decide

- [ ] **Step 1: The panel.** First-timer (row 18's own voice: is this actually a rehearsal — clock, queue, moderator, results — or another tour?), veteran (is the bot texture credible: no absurd reaches, runs happen, cadence feels human; is the fast clock fast enough?), commissioner (does the share link explain itself to the friend who lands cold?), casual (is one click really one click from the front door?), skeptic (does anything anywhere oversell the bots as AI? does a mock leak into any real number?). Findings triaged in-task or ledgered with owners — the standing delegation ruling: taste calls die here, only strategy or spend escalates.
- [ ] **Step 2: The founder's two requirements re-walked as acceptance:** live-against-others (lobby mode end to end with two real sessions), bots-vary (two same-settings solo mocks, different seeds, visibly different boards). Commit findings and fixes.

---

## Task 11: The e2e journey and mobile-360

**Files:**
- Create: `e2e/mock-draft.spec.ts`
- Modify: `e2e/mobile-360.spec.ts` (lobby + room at 360px)

- [ ] **Step 1: The journey** — front door → practice CTA → setup → instant solo mock → the REAL room asserts: practice banner, eleven `practice opponent` markers, a bot pick arriving without user action (the driver through SSE), the human making one pick, fast-forwarding to results (the seeded harness completes the draft server-side; the spec asserts the results panel's roster and delta rows), the "run it again" action. A second scenario claims a `link` seat from a share URL in a second session. Ordering-dependency comments per the suite's standing convention (`docs/conventions.md:616`); the spec count is read off `playwright` output, never this plan.
- [ ] **Step 2: mobile-360 additions; run the touched specs. Commit.**

---

## Task 12: Docs, the inert-deliverable sweep, and the closing battery

- [ ] **Step 1: Docs.** `docs/mock-drafts.md` (the three modes, the mock lane, the carve-out and its statement-spy proof, the bot strategy layer with the archetype table, the sweep, the seed-replay debugging recipe: "given `bot_seed` off any bug report, `runFullMockDraft({ seed })` reproduces every bot decision"); `docs/decisions/mock-drafts.md` (every ruling below); `docs/conventions.md` (gates 25/26, the two new directories on their lists, the audit-law carve-out cross-referenced); `plans/00-roadmap.md` (Phase 4.5 row); `README.md` if script tables moved.
- [ ] **Step 2: The inert-deliverable sweep.** Every `MOCK_CONFIG` key has a reader, every `MOCK_REFUSALS` sentence a thrower, every archetype an assignment path, every new component two-plus real props callers or the copy-sweep roster; a name the sweep finds unwired comes out.
- [ ] **Step 3: The closing battery.** Cold `npm run infra:up` · migration `0041` forward · `npm run seed` (bot roster present) · `npm run audit:verify -- --full` (unchanged — mocks wrote nothing to verify, which is the point) · full `npm test` · `npm run test:coverage` unfiltered with **26** gates at 100% · lock-order suite green at its own measured count through PgBouncer · `npm run typecheck && npm run lint && npm run build` · `npm run e2e` complete and green. Commit.

---

## Open questions, self-ruled

1. **A mock is a `leagues` row (`is_mock` + sidecar), never a parallel `mock_drafts` table set — the plan's biggest call, argued from the dependency graph.** The room the founder ordered showcased is welded to `drafts`/`leagues`/`teams`: `loadDraftConfig` joins `leagues` for the roster shape, `startDraft`'s thunk reads `teams` under the draft's own row lock, replay reads `draft_actions`, SSE rides `league:<id>:events`, chat and the moderator both key off the league. A parallel table set forks every one of those seams into a second implementation that drifts from the first — the exact drift `writeLeagueInTx`'s own docblock exists to prevent at one seam, multiplied by six. The cost of the column is the exclusion audit, and the audit came out SMALL because the codebase already routes every public aggregate through `ENFORCED_LEAGUE_SQL`: one query needed a predicate (`leaguesFilledQuery`), one read needed scoping (`myLeaguesOverview`), and the store needed the mock lane it needed under either design. The heavyweight parts of a real league (audit chains, notices, money, seasons, holds, tiers) are not table weight — they are WRITER behavior, and the mock lane turns each off at its one writer.
2. **The audit law is carved out for mocks, and that carve-out is what makes retention possible at all.** `audit_events` refuses `DELETE` at the database (migration 0019's triggers), deliberately and correctly — so "no permanent rows" and "mocks are audited" are jointly unsatisfiable. Choosing between them is easy once said aloud: the audit spine exists so money, seats and conduct in REAL leagues are tamper-evident; a practice room has no money, no standing, no conduct stakes, and an audit trail for it would be noise wearing a uniform. The carve-out is enforced positively (the statement-spy test, Task 4) rather than by convention, `MOCK_NOOP_AUDIT` is one named, docblocked, greppable value, and the mirror test proves the real-league path still audits byte-identically.
3. **Bots submit `MAKE_PICK` through `store.applyAction`; they do not ride `TIMER_EXPIRE`.** Three reasons. `admitTimerExpire` refuses early expiry by design (the check-then-act race guard), so bots-as-expiry means every bot waits the full clock — a dead room at any clock a human would tolerate. Second, expiry semantics are the SAFETY NET's semantics (skip-and-owe, catch-up) and overloading them with "the bot is thinking" would tangle two meanings in the log. Third, the driver path reuses the entire single-writer machinery — mutex, row locks, sequence backstop, broadcast — so a bot pick is exactly as safe as a human one. The engine's real expiry stays live in mocks as the human safety net, unchanged.
4. **Sign-in-first; the mock is the landing reward, not an anonymous toy.** Signed-out mocks would need a guest identity flowing through `requireCurrentUser` (page), `getCurrentUser` (every API's JSON 401), `resolveLeagueMembership` (SSE + every draft route), `teams.userId`'s FK, chat attribution and notices — a parallel identity system, against the standing law that WorkOS owns identity behind one seam. The acquisition math still works: the front-door CTA carries intent through the existing `returnTo` machinery, AuthKit's hosted sign-up is one screen, and the visitor lands INSIDE `/app/practice` with their click preserved — friction of one honest screen, versus a guest-session subsystem this phase would ship badly. The lobby VIEW for signed-out visitors (the `/app/join/<code>` middleware-exemption precedent) is the cheap future half, deferred (D1) rather than smuggled in.
5. **No draft grade.** A letter grade is manufactured authority: the platform has no outcome data on a draft that never plays, and the real-only founder rule ("a number is a query or it does not render") applies to invented judgments hardest. The results page ships facts derived from the draft's own log — roster by slot, pick-versus-board deltas from the pool snapshot — which give the first-timer the same "how did I do" answer without the platform pretending to know football better than its own rankings.
6. **Bots are seeded `users` rows, not a nullable `teams.userId`.** Making `userId` nullable would touch every consumer of the column (lineups, standings, notices, trades, chat, the name join) to handle a null that only mocks produce. A 24-name roster of `is_bot` users costs one column, one seed, and zero changes to any consumer — the unique `(leagueId, userId)` index even enforces one-seat-per-bot for free. Bot users have unroutable reserved emails, no sessions, and appear nowhere the exclusion tests sweep.
7. **The RNG is a thirty-line seeded PRNG behind an `Rng` interface, not a dependency.** The DI law's whole point: tests pass fixed seeds, the seed is stored on the row, and a bug report's draft is replayable to the pick. `Math.random` is banned from the mock path by review AND by the determinism property test, which would flake the moment ambient entropy leaked in.
8. **`src/mock-draft` is pure but BLOCKED (the `src/integrity` precedent), not the tenth exempt directory.** Its bot brain value-imports `@/draft-engine`, which rooms must never reach as a value; exempting the directory would make that reachable transitively. The two config values the setup form needs cross as props from the server page — the pattern `src/app/**` pages already use legally — so the exempt list stays at nine and the boundary stays sharp.
9. **No seat holds, no tier gate, no money gate on a mock seat.** The hold exists to make a paid, scarce seat race humane; a practice seat is free, plentiful (another room is one click away) and bot-backstopped. The claim is one guarded insert under the league lock, and losing the last-seat race reads as "that room just filled — here is another", not as a held-seat ceremony.
10. **The lobby shows request-time seat counts with a refresh, not a pre-seat SSE fan-out.** The wire's own honesty ruling (deferral D4: no anonymous SSE) applies verbatim: the lobby is a browse surface, its numbers are stamped at render, and the ONE place liveness matters — inside a claimed room — already has the league stream. A lobby socket is deferred with the same fact it was last time (D4 here).
11. **The moderator stays on in mocks, aimed only at humans.** The nudge is a differentiator the first-timer should meet BEFORE their real draft — that is what a rehearsal is for. Spend is bounded (one nudge per turn, `draft_nudges`-claimed, LLM behind a timeout with template fallback), bot turns are guarded off explicitly, and if August volume ever makes the spend real, `NudgeCopyDeps.enabled` is the existing kill switch — a config flip, not a redesign.
12. **Snake only this phase; auction mocks are deferred, not refused.** An auction bot is a second brain (valuation, budget pacing, nomination strategy) with none of it shareable from Task 3's sampler. The schema does not preclude it (`mock_rooms` carries no format assumption; `format` lives on `leagues` as always), and D2 names what it waits on. "Auction only if cheap" — it is not cheap, and shipping a bad auction bot would violate the credibility bar the veteran persona holds.
13. **The sweep deletes; it does not archive.** A practice draft's afterlife is the results page for a day. Archival tables for rehearsals would be the product keeping data nobody asked it to keep — the retention windows are config, the swept-room sentence tells the user the rule up front, and the delete is a cascade whose completeness is asserted table by table.

## Open questions, FOUNDER-GATED

**None require a decision to ship this plan.** One watch item, flagged not gated: mock volume multiplies moderator-LLM nudge calls and per-league ranking computations; both have existing bounds (nudge claim rows, the per-league cache) and both are metered in the logs the ticker already writes. If August traffic makes either a real cost line, the kill switch (`enabled: false`) and a preset-keyed ranking cache are the two named follow-ups — config changes, not redesigns.

---

## Deferred and refused, each with the fact it is waiting on

| # | Item | Decision | The fact it waits on |
|---|---|---|---|
| D1 | Signed-out mock drafts / guest sessions; signed-out lobby VIEW | **Deferred** | Ruling 4. The view half waits on a product call that browsing practice rooms anonymously earns its middleware exemption; the play half waits on an identity design that does not fork the WorkOS seam. |
| D2 | Auction mock drafts | **Deferred** | Ruling 12: an auction bot brain (valuation, budget pacing, nomination) with credibility the veteran persona would sign. Schema already permits it. |
| D3 | Bots that "learn from everyone's drafts" (ADP from real drafts, ML) | **Deferred to Phase 6, explicitly** | The strategy doc names it; this phase ships rankings + heuristics only, and the copy rulebook now BANS claiming otherwise (Task 1 Step 4). |
| D4 | Live SSE seat counts on the lobby shelf | **Deferred** | The wire's own no-anonymous-SSE ruling; request-time truth until a real liquidity problem shows up in the lobby's own numbers. |
| D5 | Mock-to-real conversion ("liked this room? make it a league") | **Deferred** | Needs the real creation flow's money/tier gates rethreaded from a mock context; the browse shelf is one click away meanwhile. |
| D6 | Draft grades / letter scores on results | **Refused** | Ruling 5: manufactured authority; the real-only rule. Pick-versus-board deltas are the honest ceiling. |
| D7 | "AI opponent" branding, difficulty tiers marketed as intelligence | **Refused** | The C3-family honesty law (Task 1 Step 4). Archetypes are texture; the product claims practice, not intelligence. |
| D8 | Mock results feeding proof stats, the wire, or any acquisition number | **Refused, permanently** | The founder's trust framing: a rehearsal never counts. `NOT is_mock` on `leaguesFilledQuery` plus the exclusion suite is the enforcement. |
| D9 | A second pick path or a bot-owned reducer branch | **Refused** | Ruling 3: one engine, one writer, one log. Bots are callers, never machinery. |

---

## Self-review

**Requirement coverage.** Strategy doc line 39: configurable to match real settings → Task 9's setup form reuses the real creation vocabulary (team count, scoring preset, roster shape, format-snake) plus the mock-only clock; shareable via link → `shareCode` + `ShareLinkPanel` (Task 8) and the `[code]` routes (Task 7); realistic bots → Tasks 3 and 6, with the learning half explicitly D3. Backlog row 18 → Task 9 upgrades the exact stand-in the row names (`RoomTour`/`WaitingChecklist`), and the first-timer chairs Task 10. Founder 2026-08-25 requirement 1 (live against others + bot mode) → modes `lobby`/`link`/`solo`, Tasks 5-7, walked in Task 10 Step 2; requirement 2 (intelligent, non-repeating) → archetypes × temperature × need × runs, seeded and replayable, with the variance and reach-cap property tests as the acceptance. The trust framing → the mock lane (Task 4), the exclusion suite (Task 2), the honest vocabulary (Task 1), the real room unchanged (Task 8's byte-identical snapshot).

**Placeholder scan.** No TODO, no TBD. Every refusal has a named home (`MOCK_REFUSALS`), every number a `MOCK_CONFIG` key with a docblock. Five places direct the executor to read current code before writing — the coverage/migration/e2e counts, `myLeaguesOverview`'s query shape, the team-card component names, the pre-start room shape, the draft API's team-card projection — each because another phase owns those files and measured counts go stale. One deliberately unfinished sketch is labeled as such (Task 1 Step 1's second `rngFor` assertion, with the real intent stated beside it).

**Type consistency.** `MockMode`, the archetype union, `Rng` — each declared once with unions derived from `as const` tuples. `isMock` appears on exactly two rows (`leagues`, `DraftConfig`) with one producer each; `isBot` on one (`users`) surfaced through the existing `TeamCard` rather than a second card type. No second team type, no second pick type, no mock-flavored `DraftState`: the state is the state.

**Collision check (files other phases own, verified in this worktree).** `store.ts`/`ticker.ts` — Phase 3.x's transaction order and lane structure are extended, never reordered; the mock lane is additive branches behind `config.isMock`, and the mirror test pins real-league behavior byte-identically. `creation.ts` — `writeLeagueInTx` gains one input field and no behavior change for existing callers (house factory and `createLeague` untouched, their tests re-run whole). `front-door-hero.tsx` — the two pinned sentences keep their assertions verbatim; the CTA is additive. `proof.ts` — one predicate on one query, its EXPLAIN re-measured. `join.ts`, `release.ts`, `roll.ts`, the money directories — untouched entirely.

**Boundary check.** `src/mock-draft` pure and blocked (ruling 8); `src/mock-draft-service` server-only, banned, reached over the wire; the lobby client components receive config as props from a server page; no room directory gains a new value-import; `import type` carries `MockRoomSummary` across.

**The exclusion contract, restated as the tests that hold it.** Task 2 Step 1 (proof, wire, browse, locker), Task 4 Step 1 (audit/notices/money/season statement spy + the real-league mirror), Task 6 Step 1 (sweep to zero rows, real league survives), `e2e/mock-draft.spec.ts` plus the untouched `money-dark`/`whole-site` passes. "A rehearsal never counts" is those tests, not this sentence.

**Execution order.** 1 → 2 → 3 ∥ 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12. Task 3 (pure brain) needs only Task 1 and may run beside Task 4 (store lane, needs Task 2's columns); Task 5 needs 2 and 4; Task 6 needs 3 and 5; everything UI (8, 9) needs 7's wire shapes; the persona checkpoint (10) sits after the surfaces exist and before the journey (11) freezes them. e2e checkpoint 1 after Task 6, checkpoint 2 after Task 9, the full battery in Task 12.
