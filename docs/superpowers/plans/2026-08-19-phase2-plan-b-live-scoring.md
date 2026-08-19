# Phase 2 Plan B — Live-Scoring Ingestion, Caching & the Cross-League Home

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the stats seam Plan A built into a running pipeline: a background worker that polls the configured provider on a budgeted cadence, writes only what changed, knows the difference between a week in progress and a week that is final, and fans the result out over the one real-time mechanism this product has — plus the read-side caching that keeps a Sunday's page views off Postgres, and a cross-league home that answers "what do I need to do, in every league I am in" on one screen.

**Architecture:** Four strands. **(1) The seam grows a cadence.** `StatsProvider` gains `listGames(week)` and `getGameStatLines(game)` beside the existing `getWeeklyStatLines(week)`, so the unit of work is a game rather than a week and the unit of cost is one upstream request. A `GameStatus` of `scheduled | in_progress | final` is the finality signal the whole plan hangs off; an unrecognized upstream spelling maps to `in_progress`, the only safe default, because it means "keep polling" rather than "stop". **(2) The worker.** `src/stats-pipeline/**` polls through the registry, diffs each poll against the prior tick's digest snapshot in Redis, resolves the affected rosters with a Postgres index lookup rather than a second hand-maintained index, upserts absolute stat values (so re-ingesting a week is arithmetically incapable of double-counting), advances a `stat_weeks` row that is the ingestion state of record, and publishes one batched `score.update` per league per tick. A monthly request-budget ledger sits in front of every upstream call, because the Tank01 dev tier is 1,000 requests a month and a full NFL Sunday polled naively is 1,400. **(3) The read side.** One Redis key per `(leagueId, week)` holds the computed matchup scores plus the `stat_weeks.version` they were computed at; a stale version is discarded on read, a lineup write deletes the key, and a Redis outage falls through to Postgres, slower and still correct. The whole-table `players` read that every matchup page does today becomes one cached index. **(4) The surfaces.** Live scoring now EXISTS, so the copy and the controls that said otherwise are retired deliberately rather than left to contradict the product: the commissioner's manual "Score week" button goes, the "There's no live scoring yet" line goes, the scoreboard learns three states, the lineup lock finally has a clock to track, and `/app` becomes a real cross-league home with a per-league next action.

**Tech Stack:** TypeScript strict · Next.js 15 App Router · React 19 · Drizzle ORM over Postgres 17 (`drizzle-orm/postgres-js`) through PgBouncer in transaction mode · Redis 7 (Streams → SSE, plus the score cache and the budget ledger) · WorkOS AuthKit · Zod v4 · Vitest + happy-dom + @testing-library/react + vitest-axe · Playwright.

**Spec:** `plans/phase-2-accounts-and-data-foundation.md` — **Step 7** (lines 285–319) and **Step 8** (lines 323–354). Phase split and plan boundaries: `docs/superpowers/plans/2026-08-19-phase2-overview.md`. What Plan A landed, and the four items it deferred to this plan with rulings: `.superpowers/sdd/2026-08-19-phase2-plan-a-data-foundation/progress.md` (final-review block, lines 58–59).

**Depends on Plan A for:** the `STATS_PROVIDER` registry and the provider-agnostic contract suite (Task 1 extends both), `DB_POOL_CONFIG.backgroundJobPoolSize` (Task 10 is its named consumer, as Plan A's final review ruled), the `EXPLAIN (ANALYZE, FORMAT JSON)` gate in `src/db/index-plans.test.ts` (Task 2 adds two hot paths to it), the balance-as-rollup convention in `docs/decisions/data-layer-hardening.md` (Task 5 applies it to week finalization), and the per-draft `FOR UPDATE` lock (the ingestion worker is the second writer that made multi-writer safety load-bearing).

**Depends on Plan D for nothing.** Every task here runs against the local docker-compose stack. No founder-supplied key, no deployed URL, no object store, no paid API tier. The one place a paid tier would change behavior is named explicitly and is config, not code: `STATS_INGESTION_CONFIG.mode`.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied verbatim from the codebase's own rules.

**From `docs/conventions.md`:**

- **Directive: no MVP.** *"I don't want an MVP. Let's work towards the end solution."* Phases sequence **scope** (money, tax, native apps come later), not quality. Nothing gets built in a form a later phase plans to throw away.
- **Stack is pinned.** Postgres 17 via Drizzle ORM (`drizzle-orm/postgres-js`, `postgres` driver). Redis 7 Streams → Server-Sent Events is *"the one and only real-time mechanism"*. Auth is WorkOS AuthKit: *"We do not roll our own auth."* Validation is Zod v4 (`z.email()`, not the deprecated `z.string().email()`).
- **`docker-compose.yml` pins a top-level `name: fantasy`**, so every git worktree resolves to the **same** Compose project. Run `npm run infra:up` from any worktree; they all talk to one shared stack.
- **Immutability.** Domain types are `readonly`; use `readonly T[]` / `Readonly<Record<…>>`. Update by spreading into new objects. Enforced for `src/domain/**` by `eslint-plugin-functional` (`functional/prefer-readonly-type`, `functional/immutable-data`, `functional/no-let`).
- **Timing — no ambient clock in domain/reducer code.** Anything time-dependent takes a `Clock` (`src/domain/timing.ts`) and calls `clock.now()`. Actions carry an explicit ISO `timestamp`. Tests inject a fixed clock. `Date.now()` / `new Date()` are only allowed at the outermost edge (route handlers, `current-user.ts`, `publisher.ts`).
- **Identity — one seam, WorkOS underneath.** Server code reads "who is this" **only** via `getCurrentUser()` / `requireCurrentUser()` from `src/lib/auth/current-user.ts`. `users.id` **is** the WorkOS user id. API and SSE routes never redirect — they return a JSON 401 themselves.
- **Real-time — one mechanism.** Writes are plain HTTP: validate → persist to Postgres → then `getPublisher().publish(...)`. **Postgres is authoritative; publishing is best-effort and must never fail the write.** Delivery is Redis Streams over SSE, stream key `league:<id>:events`, read with plain `XREAD BLOCK`. **Never `XREADGROUP`.** Event types are enumerated once in `src/lib/realtime/events.ts`. No Socket.io, no managed realtime vendor, no second transport — ever.
- **Draft state — the action log is the source of truth.** An in-progress draft's state is *derived*, by replaying `draft_actions` through the pure reducer in `src/draft-engine/`. *"Any in-memory materialization is a cache and must be safe to drop at any moment."* Every accepted action is persisted before it is cached or published, and `teamId` is always resolved from the authenticated session, never from a request body.
- **Client boundary.** Everything under `src/draft-room/**`, `src/league-room/**` and `src/chat-room/**` is BROWSER code. Each talks to its service layer ONLY over the wire — never by importing `@/draft-engine`, `@/draft-service`, `@/league`, `@/league-service`, `@/chat-service`, `@/ai-advisor`, `@/db`, `@/lib/realtime`, `@/lib/auth`, `@/lib/leagues`, `@/lib/llm`, `@/lib/api/respond` or `@/data/seed` as VALUES. `import type` stays allowed. The rule is deliberately **not** applied to `src/app/**`.
- **API responses.** Every JSON route returns the envelope from `src/lib/api/respond.ts`: `{ ok: true, data }` or `{ ok: false, error }` with a meaningful HTTP status. Bodies are parsed with `parseJson(request, ZodSchema)`; a bad body is a 400 naming the field. **Error strings are user-facing plain language — never raw DB/exception text.**
- **Config over magic numbers.** Thresholds, limits, durations, key formats live in a `config.ts` next to the module that uses them (`LEAGUE_CONFIG`, `REALTIME_CONFIG`, `DRAFT_QUEUE_CONFIG`, `UI_CONFIG`, …). No inline literals for tunables.
- **Tests.** **Test-first.** Tests live beside the code: `src/<feature>/**/*.test.ts`. Verification commands filter by directory: `npm test -- src/scoring`, never by a guessed filename. Integration tests hit the **real** test Postgres / Redis from docker-compose — not mocks. Use `createTestDb()` + `truncateAll(db)` in `beforeEach`. Test files run serially (`fileParallelism: false`).
- **Coverage threshold: 100%** for `src/scoring/**`, `src/draft-engine/**`, `src/draft-room/state/**`, `src/league/**`, `src/chat/**`, `src/matchmaking/**` and `src/stats/**` (configured in `vitest.config.mts` with `coverage.include` **and** a matching `thresholds` block — Plan A's fix wave proved an `include` entry with no threshold is not a gate). Verify with an **unfiltered** `npm run test:coverage`.
- **Browser end-to-end** lives in `e2e/` and runs under Playwright against a production build and the real docker-compose stack (`npm run e2e`). **There is no dev auth bypass and none may be added.**
- **Any step shipping a user-visible surface additionally requires:** a design review against `docs/design-system.md`; loading/empty/error/success states all designed; an automated a11y check plus a keyboard-only walkthrough of the primary flow; a plain-language copy review; renders and operates at 360px width.
- **Migrations.** `ADD COLUMN … NOT NULL` without a `DEFAULT` is acceptable only while the table is empty (pre-first-deploy, as in `drizzle/0001`); once deployed, add with a DEFAULT or backfill in a separate migration.
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Commit after every completed step; commit bodies explain *why* and record any deviation from the plan.
- **Environment.** `.env.example` is committed; `.env.local` is gitignored. Fail fast with a clear message when a required var is missing (see `db/client.ts`, `realtime/redis.ts`).
- **Verification commands (every step):** `npm run typecheck && npm run lint && npm test && npm run build`

**From `docs/design-system.md`:**

- **No raw hex, no raw px, no arbitrary values in feature code.** `src/design/tokens.ts` is the only file allowed to contain a color literal.
- **Never a dead end.** Empty and error states always offer an action (`StatePanelProps.action` is required, not optional, and `EmptyState`/`ErrorState` inherit that).
- **Both themes are first-class.** Every surface is designed and tested in light and dark, via `inBothThemes` from `src/components/ui/test-utils.tsx`. **Mobile-first**, minimum viewport 360px. WCAG 2.2 AA.
- **Copy.** Plain language, active voice, specific. Errors say what happened and what to do next.
- **`Icon` is the one icon entry point. Feature code never imports `lucide-react` directly.** Available `IconName`s today: `trophy`, `users`, `clock`, `alert-triangle`, `inbox`, `refresh-cw`, `check`, `x`, `chevron-right`, `search`.
- Tunables for primitives live in `src/components/ui/config.ts` — never inline in a component.

**From `docs/decisions/data-layer-hardening.md` (Plan A):**

- **Balance as rollup.** Any running total is a rollup row updated **in the same transaction** as each contributing write, over an append-only source table that stays the reconciliation source of truth. Never a `SUM()` on the read path. The threshold is unbounded growth: derive over a bounded set, roll up over an unbounded one.
- **PgBouncer transaction pooling forbids session state.** No `pg_advisory_lock`, no named prepared statements (`prepare: false` is unconditional), no `SET` outside a transaction, no session-scoped temp tables, **no `LISTEN`/`NOTIFY`**. DDL goes through the direct port, never the pooler.
- **The background pool is separate by arithmetic, not by hope.** `DB_POOL_CONFIG.backgroundJobPoolSize` is subtracted from the connection budget *before* the per-instance division precisely so a batch job can never starve the request path. This plan's ingestion worker is that batch job and must draw from that number.

**Founder rules (binding, from the phase overview):**

- **No em-dashes in user-facing copy.** Not in component text, not in error strings, not in seed data, not in `.env.example` comments a developer reads as product copy. Source comments may use them; the codebase already does.
- **Persona-panel pass on every new user-facing surface**, marked as an explicit step. The controller runs the panel (high-stakes veteran, social casual, commissioner, first-timer); the plan only marks where.
- **Centralized primitives always.** No one-off component that duplicates something already in `src/components/ui/`.

**Plan-B-specific constraints (each ruled in "Open questions, self-ruled" at the end):**

- **The inverted `playerId → rosters` index is a Postgres index, not a second data structure.** A hand-maintained Redis map of player to roster is a copy of `lineup_slots`/`roster_slots` that can drift from them; a composite index cannot.
- **Idempotence comes from absolute values, not from a dedup table.** Stat lines are upserted by `(player_id, week)` with absolute totals, and a week's matchup scores are recomputed from those totals. Re-ingesting a week is arithmetically incapable of double-counting, and there is a test that proves it rather than a comment that claims it.
- **Every upstream call passes a budget ledger.** The Tank01 dev tier is 1,000 requests a month. The ledger is the thing that makes that a bound rather than a hope, in every mode, for every provider.
- **Live scoring exists after this plan, so the surfaces that said it did not are changed, not left alone.** The `matchup-panel` "never implies live scoring" test, the matchups page disclaimer, the commissioner's manual score button and its route are all deliberately retired in this plan, each with the persona panel run over the replacement.
- **`src/stats-pipeline/**` joins the 100% coverage gate as the eighth gated directory**, with a matching `thresholds` block, because it is the highest-load path in the product and Plan A's fix wave proved an `include` without a threshold is decorative.

---

## What is already true (read before touching anything)

| The spec assumes | Reality on `main` today (c0da2e9) |
|---|---|
| Step 8 is a new `/dashboard` route (line 333) | `/app` already exists and already lists every league the user fields a team in, via `listLeaguesForUser` (`src/league-service/read.ts:25`). It is one query per table, not one per league. What is missing is the per-league *matchup*, *record* and *next action* the spec's own task list asks for, and any notion of live score. **This plan upgrades `/app`; it does not add a second home at `/dashboard`.** |
| `StatsProvider` has a per-week pull only | True, and deliberate — Plan A's final review deferred the per-game read and the finality flag here with an explicit ruling: *"guessing the read shape now risks baking in the wrong cadence."* Task 1 is that shape. |
| Scores need a place to be stored (Step 7) | `matchups.home_score` / `away_score` already exist and `computeStandings` already reads them. What does not exist is any record of whether a week is *done*: `MatchupSummary.final` is inferred from both scores being non-null, which after this plan would call an in-progress week final. |
| A cache layer is needed for standings/matchup reads (I6) | True, and worse than the spec knew: `matchupWeek` (`read.ts:127`) runs `db.select().from(players)` with **no `WHERE` clause** on every matchup page view, reading the whole ~2,000-row player table to build a position map. |
| The ingestion worker is a new kind of thing | It is not. `src/draft-service/ticker.ts` is already a `tick()` / `start()` / `stop()` background worker with an injected clock, an overlap guard, per-entity error isolation and rate-limited failure logging, started from `src/instrumentation.ts`. The ingestion worker follows that shape rather than inventing a second one. |
| `score.update` needs adding to the taxonomy | Already there. `src/lib/realtime/events.ts:23` lists `score.update`, published by nothing. This plan is what makes it a real event. |
| A lineup lock needs a clock | `isWeekLocked` (`src/league-service/lineups.ts:75`) says so in its own docblock: *"There is deliberately no clock-based lock: this phase has no live game data for a clock to track."* This plan supplies the clock. |

---

## File Structure

**New — the pipeline:**

| File | Responsibility |
|---|---|
| `src/stats-pipeline/config.ts` | `STATS_INGESTION_CONFIG`: mode, cadence, budget, batch caps, Redis key formats, every env var the pipeline reads. |
| `src/stats-pipeline/contract.ts` | Types only: `ScoreUpdatePayload`, `TeamScore`, `IngestOutcome`. Imported by the worker and by `src/league-room/**` as a type, so the wire shape cannot drift. |
| `src/stats-pipeline/digest.ts` | Pure: `statLineDigest(line)` and `diffStatLines(previous, next)` → the changed lines and the ids to drop. |
| `src/stats-pipeline/budget.ts` | `createRequestBudget({ redis, clock })` — a monthly `INCRBY`-backed ledger with `reserve(n)`, `remaining()`, and a documented open-on-outage rule. |
| `src/stats-pipeline/affected.ts` | `affectedTeams(db, week, playerIds)` — the one query that turns changed players into the leagues and teams that started them, plus the default-lineup fallback. |
| `src/stats-pipeline/persist.ts` | `persistTick(db, { week, changed, dropped, status, games })` — the single transaction that upserts stat lines and advances the `stat_weeks` rollup. |
| `src/stats-pipeline/finalize.ts` | `finalizeWeek(db, leagueId, week)` — the settlement write that stamps `matchups.home_score`/`away_score` once a week is final. Moved out of `league-service/results.ts`. |
| `src/stats-pipeline/score-cache.ts` | `createScoreCache({ redis })` — one key per `(leagueId, week)`, version-stamped, with the Redis-outage fallthrough. |
| `src/stats-pipeline/reference-cache.ts` | The player index and per-league scoring settings, with explicit write-through invalidation. |
| `src/stats-pipeline/worker.ts` | `createIngestionWorker(deps)` — `tick()` / `start()` / `stop()`, modeled on `src/draft-service/ticker.ts`. |
| `src/stats-pipeline/index.ts` | `getIngestionWorker()` — the edge wiring, and the only place the background DB pool is constructed. |
| `src/stats-pipeline/test-support.ts` | `fakeStatsProvider(script)` — a provider whose game statuses and stat lines a test drives tick by tick. |

**New — domain and service:**

| File | Responsibility |
|---|---|
| `src/league/week-status.ts` | Pure: the `WeekStatus` union, `weekStatusFromGames(games)`, and `isLineupLocked(status)`. Lives in the gated `src/league/**`. |
| `src/league/next-action.ts` | Pure: `nextAction(card)` → the one thing this league wants from this manager right now. |
| `src/league-service/home.ts` | `crossLeagueHome(db, userId, deps)` — every league, its current week, its live or final score, its record, its next action. One query per table. |
| `src/app/api/home/route.ts` | `GET /api/home` — the cached JSON the home board polls. |

**New — client:**

| File | Responsibility |
|---|---|
| `src/league-room/hooks/use-live-scores.ts` | Folds `score.update` frames from the shared league stream into the matchup view. |
| `src/league-room/components/home-board.tsx` | The cross-league home's client shell: renders the server's initial payload, refreshes it on a visible-document interval. |
| `src/league-room/components/home-league-card.tsx` | One league's card: name, record, this week's score with its state, and the next action. |
| `src/league-room/components/week-status-badge.tsx` | The one place a `WeekStatus` becomes a `Badge`. Used by the scoreboard and the home card, so the two can never disagree. |

**New — decision docs:**

| File | Responsibility |
|---|---|
| `docs/decisions/live-scoring-pipeline.md` | Worker cadence, mode, the budget arithmetic, delta-diff strategy, the affected-roster query, the cache-key scheme, and the degradation rules. |

**Modified:** `src/stats/provider.ts`, `src/stats/config.ts`, `src/stats/registry.ts`, `src/stats/test-support.ts`, `src/stats/mock/mock-stats-provider.ts`, `src/stats/tank01/config.ts`, `src/stats/tank01/map.ts`, `src/stats/tank01/tank01-stats-provider.ts`, `src/stats/tank01/fixtures/*.json`, `src/stats/tank01/fixtures/manifest.json`, `src/db/schema.ts`, `src/db/index-plans.test.ts`, `src/league/index.ts`, `src/league-service/read.ts`, `src/league-service/results.ts`, `src/league-service/lineups.ts`, `src/league-service/index.ts`, `src/league-service/creation.ts`, `src/league-room/contract.ts`, `src/league-room/components/matchup-scoreboard.tsx`, `src/league-room/components/matchup-panel.tsx`, `src/league-room/components/league-home.tsx`, `src/league-room/components/league-list.tsx`, `src/app/app/page.tsx`, `src/app/app/leagues/[leagueId]/matchups/[week]/page.tsx`, `src/instrumentation.ts`, `src/data/seed/seed-players.ts`, `vitest.config.mts`, `docker-compose.yml`, `.env.example`, `package.json`, `e2e/season.spec.ts`, `docs/conventions.md`, `docs/league.md`, `docs/decisions/stats-provider-adapter.md`, `docs/decisions/data-layer-hardening.md`, `README.md`.

**Deleted:** `src/app/api/leagues/[leagueId]/weeks/[week]/score/route.ts`, `src/league-room/components/score-week-button.tsx`, `src/league-room/components/score-week-button.test.tsx`.

**New migrations:** `drizzle/0013_stat_weeks_and_ingestion_indexes.sql`.

---

## Task 1: The seam grows a per-game read and a finality signal

Plan A's final review deferred exactly this, with a ruling: `StatsProvider` has no per-game read and no finality flag, both implementations are in-repo so extending it here is contained, and guessing the shape before the cadence was designed risked baking in the wrong one. The cadence is now designed (see Task 3's budget arithmetic), and it dictates the shape: **the unit of work must be a game, because the unit of cost is one upstream request and a game that is already final never needs a second one.**

Three additions, no removals. `getWeeklyStatLines(week)` stays exactly as it is — `seedPlayers` walks weeks upward through it and must keep working unchanged — but it stops being a primitive and becomes the composition of the two new methods, which is what keeps the aggregate and the per-game read from drifting.

**Files:**
- Modify: `src/stats/provider.ts`
- Modify: `src/stats/test-support.ts`
- Modify: `src/stats/config.ts`
- Modify: `src/stats/registry.ts`
- Modify: `src/stats/mock/mock-stats-provider.ts`
- Create: `src/stats/mock/games.ts`
- Create: `src/stats/mock/games.test.ts`
- Modify: `src/stats/mock/mock-stats-provider.test.ts`
- Modify: `src/stats/tank01/config.ts`, `src/stats/tank01/map.ts`, `src/stats/tank01/map.test.ts`, `src/stats/tank01/tank01-stats-provider.ts`, `src/stats/tank01/tank01-stats-provider.test.ts`
- Modify: `src/stats/tank01/fixtures/games-week-1.json`, `src/stats/tank01/fixtures/manifest.json`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `Player`, `StatLine`, `Position` from `@/domain/player`; `envOr`/`envOrUndefined` from `@/lib/env`; `TANK01_CONFIG` from `@/stats/tank01/config`.
- Produces:
  - `type GameStatus = "scheduled" | "in_progress" | "final"` from `@/stats/provider`.
  - `interface GameSummary { readonly gameId: string; readonly week: number; readonly status: GameStatus; readonly homeNflTeam: string; readonly awayNflTeam: string }` from `@/stats/provider`.
  - `StatsProvider` gains `listGames(week: number): Promise<readonly GameSummary[]>` and `getGameStatLines(game: GameSummary): Promise<readonly StatLine[]>`.
  - `describeStatsProviderContract(label, factory)` keeps its signature; the suite grows by six cases.
  - `MOCK_STATS_LIVE_WEEK` becomes a recognized env var (`STATS_CONFIG.envVars.mockLiveWeek`).

Every later task consumes `GameSummary`/`GameStatus`: Task 2 stores the status, Task 3 budgets one request per `listGames`/`getGameStatLines` call, Task 5 drives the worker off it, Tasks 7 through 9 render it.

- [ ] **Step 1: Write the failing contract cases first**

The contract suite is the thing that must grow — Plan A's own rule is that a future licensed feed is verified by this same suite unchanged. Add these to `describeStatsProviderContract` in `src/stats/test-support.ts`, after the existing `"only reports stats for players it also lists"` case. The existing cases (every position present, negative yardage allowed on yardage fields only, listed-players-only, week stamping, no duplicate ids, out-of-season empty) must all still be there and still pass, untouched.

```ts
const GAME_STATUSES: readonly GameStatus[] = ["scheduled", "in_progress", "final"];

    it("lists games for the week that was asked for, each with a known status and two teams", async () => {
      const games = await (await factory()).listGames(1);
      expect(games.length).toBeGreaterThan(0);
      for (const game of games) {
        expect(game.gameId).toMatch(/\S/);
        expect(game.week).toBe(1);
        expect(GAME_STATUSES).toContain(game.status);
        expect(game.homeNflTeam).toMatch(/\S/);
        expect(game.awayNflTeam).toMatch(/\S/);
        expect(game.homeNflTeam).not.toBe(game.awayNflTeam);
      }
    });

    it("never lists the same game id twice in one week", async () => {
      const games = await (await factory()).listGames(1);
      const ids = games.map((game) => game.gameId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("answers a week outside the season with no games, the same way it answers with no stat lines", async () => {
      // `seedPlayers` terminates on an empty stat-line array and the ingestion worker terminates
      // on an empty game list. Two loops, one boundary — they must agree.
      const provider = await factory();
      await expect(provider.listGames(0)).resolves.toEqual([]);
      await expect(provider.listGames(99)).resolves.toEqual([]);
    });

    it("stamps a game's stat lines with that game's week", async () => {
      const provider = await factory();
      const [game] = await provider.listGames(1);
      expect(game).toBeDefined();
      const lines = await provider.getGameStatLines(game!);
      for (const line of lines) expect(line.week).toBe(1);
    });

    it("only reports a game's stats for players it lists, on one of that game's two teams", async () => {
      // The per-game read's own version of the listed-players rule, plus the assertion the
      // week-level read cannot make: a box score keyed to the wrong game would still pass the
      // week-level check and would silently attribute a player's points to the wrong fixture.
      const provider = await factory();
      const teamById = new Map((await provider.listPlayers()).map((player) => [player.id, player.nflTeam]));
      for (const game of await provider.listGames(1)) {
        for (const line of await provider.getGameStatLines(game)) {
          expect(teamById.has(line.playerId)).toBe(true);
          expect([game.homeNflTeam, game.awayNflTeam]).toContain(teamById.get(line.playerId));
        }
      }
    });

    it("returns the same week from the per-game reads as it does from the week read", async () => {
      // THE anti-drift device for this task. `getWeeklyStatLines` is what `seedPlayers` uses and
      // the per-game reads are what the ingestion worker uses; two independent expressions of
      // "week 1's stats" is exactly how a seeded season and a live season end up disagreeing.
      const provider = await factory();
      const games = await provider.listGames(1);
      const perGame = (await Promise.all(games.map((game) => provider.getGameStatLines(game)))).flat();
      const weekly = await provider.getWeeklyStatLines(1);
      const key = (line: StatLine): string => `${line.playerId}:${line.week}`;
      expect(new Set(perGame.map(key))).toEqual(new Set(weekly.map(key)));
      const byKey = new Map(perGame.map((line) => [key(line), line]));
      for (const line of weekly) expect(byKey.get(key(line))).toEqual(line);
    });

    it("returns a final game's stat lines identically on a second read", async () => {
      // The property the worker's request budget is built on: once a game is final its box score
      // is a fixed fact, so the worker fetches it once and never again. If this is ever false for
      // a provider, that provider must not be run in final-only mode.
      const provider = await factory();
      const finals = (await provider.listGames(1)).filter((game) => game.status === "final");
      expect(finals.length).toBeGreaterThan(0);
      const first = await provider.getGameStatLines(finals[0]!);
      const second = await provider.getGameStatLines(finals[0]!);
      expect(second).toEqual(first);
    });
```

- [ ] **Step 2: Run the suite and watch both implementations fail**

Run: `npm test -- src/stats`
Expected: FAIL in both `src/stats/mock/mock-stats-provider.test.ts` and `src/stats/tank01/tank01-stats-provider.test.ts` — `provider.listGames is not a function`. Two failing implementations from one suite edit is the point: the contract is written against the interface, not against either of them.

- [ ] **Step 3: Extend `src/stats/provider.ts`**

```ts
import type { Player, StatLine } from "@/domain/player";

/**
 * Where a fixture is in its life. Three values, because three is what any downstream decision
 * actually needs: do not poll it yet, poll it again, never poll it again.
 *
 * An UNRECOGNIZED upstream spelling maps to `in_progress`, never to `final` and never to
 * `scheduled` — see `mapGames` in `src/stats/tank01/map.ts`. `in_progress` is the only safe
 * default because it is the one value that costs a request and changes nothing else: a game
 * wrongly called `final` is never fetched again and its points are lost for the season, and a
 * game wrongly called `scheduled` locks nothing and is never fetched at all.
 */
export type GameStatus = "scheduled" | "in_progress" | "final";

export interface GameSummary {
  /** Stable for the life of the fixture. The unit of caching, and of request cost. */
  readonly gameId: string;
  readonly week: number;
  readonly status: GameStatus;
  /** NFL team abbreviations, matching `Player.nflTeam`. */
  readonly homeNflTeam: string;
  readonly awayNflTeam: string;
}

/**
 * The seam between the app and its stats source. Phase 1 used the deterministic mock; a licensed
 * feed (SportsDataIO / SportRadar / Genius — a business decision, Phase 8) plugs in as another
 * implementation of this interface, not a rewrite.
 *
 * REQUEST COST is part of this contract, because the whole ingestion cadence is built on it and
 * the dev tier of the adapter that exists today is 1,000 requests a month:
 *
 * | method                | upstream requests                                    |
 * |-----------------------|------------------------------------------------------|
 * | `listPlayers()`       | 2, memoized for the life of the provider instance     |
 * | `listGames(week)`     | 1                                                     |
 * | `getGameStatLines(g)` | 1                                                     |
 * | `getWeeklyStatLines(w)` | 1 + one per game in the week                        |
 *
 * An implementation that cannot honor that table must say so in its own docblock rather than
 * quietly costing more, because `src/stats-pipeline/budget.ts` reserves against these numbers.
 */
export interface StatsProvider {
  listPlayers(): Promise<readonly Player[]>;
  /** Empty outside the provider's season, which is what terminates the worker's week scan. */
  listGames(week: number): Promise<readonly GameSummary[]>;
  /** Only players `listPlayers()` also lists, only teams this game was played between. */
  getGameStatLines(game: GameSummary): Promise<readonly StatLine[]>;
  /**
   * Every stat line in the week, identical to the union of `getGameStatLines` over
   * `listGames(week)` — asserted by the shared contract suite, because two expressions of one
   * week is how a seeded season and a live season end up disagreeing.
   */
  getWeeklyStatLines(week: number): Promise<readonly StatLine[]>;
}
```

- [ ] **Step 4: Give the mock provider games it can derive**

Create `src/stats/mock/games.ts`. The committed dataset has players and stat lines but no schedule, so the schedule is derived from the data that exists, deterministically:

```ts
import type { Player, StatLine } from "@/domain/player";
import type { GameStatus, GameSummary } from "../provider";

/**
 * The mock dataset is a completed 2026 season: players and stat lines, no schedule. Rather than
 * committing a second fixture that could disagree with the stat lines, a week's fixtures are
 * DERIVED from them — the NFL teams that produced stats in that week, sorted and paired.
 *
 * This is not a real NFL schedule and does not pretend to be. It is a deterministic partition of
 * a week's players into fixtures, which is exactly the property every consumer of `listGames`
 * needs: a stable id, two disjoint teams, and the guarantee that every stat line in the week
 * belongs to exactly one of them.
 *
 * A team with an odd-one-out (an odd number of teams played in a week) is dropped from the game
 * list, and so are its stat lines, so the contract's "every line belongs to a listed game" case
 * holds rather than being papered over with a one-team fixture.
 */
export function deriveMockGames(week: number, players: readonly Player[], lines: readonly StatLine[], status: GameStatus): readonly GameSummary[] {
  const teamById = new Map(players.map((player) => [player.id, player.nflTeam]));
  const playing = [...new Set(lines.flatMap((line) => {
    const team = teamById.get(line.playerId);
    return team === undefined ? [] : [team];
  }))].sort();
  const games: GameSummary[] = [];
  for (let i = 0; i + 1 < playing.length; i += 2) {
    games.push({
      gameId: `mock-${week}-${playing[i]}-${playing[i + 1]}`,
      week,
      status,
      homeNflTeam: playing[i]!,
      awayNflTeam: playing[i + 1]!,
    });
  }
  return games;
}
```

Then rewrite `src/stats/mock/mock-stats-provider.ts` so all four methods agree:

```ts
import type { StatsProvider } from "../provider";
import type { Dataset } from "./generate-dataset";
import { deriveMockGames } from "./games";
import committed from "./dataset.json" with { type: "json" };

export interface MockProviderOptions {
  /**
   * Which week, if any, is treated as still being played. Every other week is `final`.
   *
   * The dataset is a finished season, so without this the mock can never exercise a live state
   * and a developer with no API key could never see the live surfaces at all. It is
   * configuration (`MOCK_STATS_LIVE_WEEK`), not a default: leaving it unset keeps the mock
   * byte-identical in behavior to what Plan A shipped.
   */
  readonly liveWeek?: number;
}

export function createMockStatsProvider(dataset: Dataset = committed as Dataset, options: MockProviderOptions = {}): StatsProvider {
  const linesFor = (week: number): readonly StatLine[] => dataset.statLines.filter((line) => line.week === week);
  const statusFor = (week: number): GameStatus => (week === options.liveWeek ? "in_progress" : "final");
  const gamesFor = (week: number): readonly GameSummary[] =>
    deriveMockGames(week, dataset.players, linesFor(week), statusFor(week));

  return {
    async listPlayers() {
      return dataset.players;
    },
    async listGames(week) {
      return gamesFor(week);
    },
    async getGameStatLines(game) {
      const teams = new Set([game.homeNflTeam, game.awayNflTeam]);
      const teamById = new Map(dataset.players.map((player) => [player.id, player.nflTeam]));
      return linesFor(game.week).filter((line) => teams.has(teamById.get(line.playerId) ?? ""));
    },
    async getWeeklyStatLines(week) {
      // Composed, not filtered independently: the contract asserts these agree, and the cheapest
      // way to keep them agreeing forever is for one of them to BE the other.
      const games = gamesFor(week);
      const teams = new Set(games.flatMap((game) => [game.homeNflTeam, game.awayNflTeam]));
      const teamById = new Map(dataset.players.map((player) => [player.id, player.nflTeam]));
      return linesFor(week).filter((line) => teams.has(teamById.get(line.playerId) ?? ""));
    },
  };
}
```

Note the deliberate behavior change hiding in `getWeeklyStatLines`: a player on a dropped odd-one-out team no longer appears. Add a case to `src/stats/mock/mock-stats-provider.test.ts` asserting the seeded row count is unchanged or, if it changed, that the drop is exactly the odd team — and record the number in the commit body. If the committed dataset has an even number of teams per week (it should, it was generated), the filter is a no-op and the count is identical.

- [ ] **Step 5: Teach the Tank01 adapter the same two methods**

`mapGameIds` becomes `mapGames`. Add the status vocabulary to `TANK01_CONFIG`:

```ts
  /**
   * Upstream's `gameStatus` spellings, lowercased, mapped to the domain's three. Anything not in
   * this table — a new spelling, a missing field, a null — becomes `in_progress`, which is the
   * safe direction: it costs one more request and nothing else. See `GameStatus`.
   */
  gameStatuses: {
    scheduled: ["scheduled", "not started", "pre-game"],
    final: ["completed", "final"],
    in_progress: ["live - in progress", "in progress", "halftime"],
  },
```

And in `map.ts`:

```ts
/** `/getNFLGamesForWeek` → the fixtures, with the composite `YYYYMMDD_AWAY@HOME` id the box-score call needs. */
export function mapGames(body: unknown, week: number): readonly GameSummary[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw): readonly GameSummary[] => {
    const record = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const gameId = str(record.gameID);
    const home = str(record.home);
    const away = str(record.away);
    if (gameId === "" || home === "" || away === "") return [];
    return [{ gameId, week, status: mapGameStatus(record.gameStatus), homeNflTeam: home, awayNflTeam: away }];
  });
}

function mapGameStatus(raw: unknown): GameStatus {
  const value = str(raw).toLowerCase();
  if (TANK01_CONFIG.gameStatuses.final.includes(value)) return "final";
  if (TANK01_CONFIG.gameStatuses.scheduled.includes(value)) return "scheduled";
  // Everything else, INCLUDING an absent or unrecognized value. See `GameStatus`.
  return "in_progress";
}
```

The provider composes them, and `getWeeklyStatLines` stops being a separate loop:

```ts
    async listGames(week) {
      if (week < TANK01_CONFIG.weeks.first || week > TANK01_CONFIG.weeks.last) return [];
      const body = await client.get(TANK01_CONFIG.paths.gamesForWeek, {
        week: String(week),
        season,
        seasonType: TANK01_CONFIG.seasonType,
      });
      return mapGames(body, week);
    },

    async getGameStatLines(game) {
      const listedPlayerIds = await fetchPlayers().then((list) => new Set(list.map((player) => player.id)));
      const box = await client.get(TANK01_CONFIG.paths.boxScore, { gameID: game.gameId });
      const teams = new Set([game.homeNflTeam, game.awayNflTeam]);
      const teamByPlayerId = new Map((await fetchPlayers()).map((player) => [player.id, player.nflTeam]));
      // The listed-players filter Plan A's fix wave added, plus the game's own two teams: a box
      // score keyed to the wrong fixture would otherwise attribute real points to a real player
      // in a game they did not play, which no week-level check can catch.
      return mapBoxScoreToStatLines(box, game.week, listedPlayerIds).filter((line) =>
        teams.has(teamByPlayerId.get(line.playerId) ?? ""),
      );
    },

    async getWeeklyStatLines(week) {
      // SEQUENTIAL, not `Promise.all` — unchanged reasoning: a week is around sixteen box scores,
      // issuing them at once is the fastest way to a 429 on any plan below Ultra, and a
      // rate-limit failure part way through a burst leaves you with no idea which games you got.
      const lines: StatLine[] = [];
      for (const game of await this.listGames(week)) {
        lines.push(...(await this.getGameStatLines(game)));
      }
      return lines;
    },
```

`this` inside an object literal method is legal and typed here, but if `noImplicitThis` or a lint rule objects, hoist `listGames`/`getGameStatLines` into named consts above the returned object and reference those. Do not duplicate the bodies.

- [ ] **Step 6: Add `gameStatus` to the fixtures and record it in the manifest**

`src/stats/tank01/fixtures/games-week-1.json` has no `gameStatus` field today. Add one to each of the two entries, and add a third entry carrying a spelling the table does not know, so the safe default is proved rather than asserted:

- `20260913_SF@SEA` → `"gameStatus": "Completed"`
- `20260913_CAR@WSH` → `"gameStatus": "Live - In Progress"`
- a new third fixture entry `20260913_KC@BUF` with `"gameStatus": "Weather Delay"`, no box-score fixture of its own (the map test covers it; the provider test never fetches it because a status-driven test drives which games it asks for).

Update `manifest.json`'s entry for `games-week-1.json` with a `note` naming what each status is there to prove, and leave `provenance` as it is — this is still authored, not recorded, and `npm run stats:tank01:record` is still what flips it. **The keyless-mergeable rule from Plan A stands: every test in this task must pass unchanged across that flip.**

- [ ] **Step 7: Wire the mock's live week through the registry**

In `src/stats/config.ts` add `mockLiveWeek: "MOCK_STATS_LIVE_WEEK"` to `envVars`, and in `registry.ts`'s `build`, read it the same way `TANK01_SEASON` is read — through `envOrUndefined`, validated as a positive integer with the same `parseSeason`-shaped fail-fast, reusing a single `parsePositiveInteger(name, raw)` helper rather than a second copy of the same four lines.

Add the var to `.env.example`, commented out, with copy that carries no em-dash:

```
# Optional, only for STATS_PROVIDER=mock. Treats one week of the fixed 2026 dataset as still
# being played, so the live scoring surfaces can be seen without an API key. Every other week
# stays final. Leave it unset for the behavior Plan A shipped.
# MOCK_STATS_LIVE_WEEK=
```

- [ ] **Step 8: Run the whole stats suite and the gate**

```bash
npm test -- src/stats
npm run test:coverage        # UNFILTERED. src/stats must stay at 100%.
npm run typecheck && npm run lint
```

Expected: green, with the contract suite's seven new cases running twice (once per implementation).

- [ ] **Step 9: Commit**

```bash
git add src/stats .env.example
git commit -m "feat(stats): a per-game read and a game-status signal on the provider seam

Plan A deferred this deliberately: guessing the read shape before the ingestion cadence was
designed risked baking in the wrong one. The cadence dictates the shape. The unit of cost is
one upstream request and a final game's box score is a fixed fact, so the unit of work has to
be a game: listGames(week) plus getGameStatLines(game), with getWeeklyStatLines now composed
from them rather than expressed a second time.

An unrecognized upstream gameStatus maps to in_progress, never final and never scheduled. It
is the only value that costs a request and changes nothing else; final would lose a game's
points for the season and scheduled would never fetch it at all. A fixture with an unknown
spelling proves it.

The contract suite grew by seven cases against the interface, so both implementations were
failing from one edit. The mock derives its fixtures from the week's own stat lines rather
than carrying a second schedule fixture that could disagree with them."
```

---

## Task 2: `stat_weeks`, and the two indexes that make "only affected rosters" an index lookup

Two things the schema does not have and this pipeline cannot work without.

**The ingestion state of record.** `MatchupSummary.final` is currently inferred from both scores being non-null. After this plan that inference is wrong: an in-progress week has scores. Finality is a property of the NFL week, and nothing stores it. `stat_weeks` does, along with the monotonic `version` that is the cache key's freshness component and the game counts the UI reports.

**The inverted index.** The spec asks for a `playerId → affected rosters` index "maintained incrementally as rosters change, not rebuilt from scratch per tick". A hand-maintained Redis map is a copy of `lineup_slots` and `roster_slots` that can drift from them and has no way to notice. A composite Postgres index is maintained incrementally by definition, by the database, on every roster and lineup write, and cannot drift. That is the ruling; this task adds the two indexes and puts both new query shapes into Plan A's `EXPLAIN` gate so "no full leagues × teams scan" is a build failure rather than a comment.

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/0013_stat_weeks_and_ingestion_indexes.sql` (via `npm run db:generate`)
- Modify: `src/db/schema.test.ts`
- Modify: `src/db/index-plans.test.ts`

**Interfaces:**
- Consumes: `pgTable`, `pgEnum`, `integer`, `timestamp`, `index` from `drizzle-orm/pg-core`; `explainPlan` / `planUsesSeqScanOn` from `@/db/explain` (Plan A, test-only).
- Produces: `weekStatusEnum` and the `statWeeks` table from `@/db/schema`, with columns `week` (PK), `status`, `version`, `gamesTotal`, `gamesFinal`, `updatedAt`. Task 5 writes it, Task 6 reads its `version` into the cache key, Task 7 puts it on the wire.
- Produces: `lineup_slots_player_week_idx` on `(player_id, week_number)` and `roster_slots_player_idx` on `(player_id)`. Task 4's resolver depends on both.

- [ ] **Step 1: Write the failing schema and plan tests**

Add to `src/db/schema.test.ts` a case asserting the enum's three values and the table's defaults round-trip (the file already has this shape for other tables; follow its existing spelling). Then add to `src/db/index-plans.test.ts`, inside its existing corpus harness, two plan assertions:

```ts
  it("finds the teams that started a changed player by index, not by scanning lineups", async () => {
    const plan = await explainPlan(
      db,
      db
        .select({ teamId: lineupSlots.teamId })
        .from(lineupSlots)
        .where(and(eq(lineupSlots.weekNumber, 3), inArray(lineupSlots.playerId, ["p-1", "p-2", "p-3"]))),
    );
    expect(planUsesSeqScanOn(plan, "lineup_slots")).toBe(false);
  });

  it("finds the teams that OWN a changed player by index, for teams with no saved lineup", async () => {
    // The fallback half of the resolver: `getLineup` derives a legal lineup from the roster when
    // a manager never opened the editor, so a changed player can affect a team that has no
    // lineup_slots row at all. Both halves have to be index lookups or the "only affected
    // rosters" guarantee is only half true.
    const plan = await explainPlan(
      db,
      db.select({ teamId: rosterSlots.teamId }).from(rosterSlots).where(inArray(rosterSlots.playerId, ["p-1", "p-2", "p-3"])),
    );
    expect(planUsesSeqScanOn(plan, "roster_slots")).toBe(false);
  });
```

The corpus these run against must be large enough for the planner to have a real choice. `index-plans.test.ts` already seeds 5,000 leagues and 15,000 teams; extend its seeding to write lineup and roster rows for a representative subset (target ≥ 50,000 `lineup_slots` rows and ≥ 50,000 `roster_slots` rows) and `ANALYZE` after. Plan A's own note applies: a plan assertion over a hundred rows asserts nothing.

- [ ] **Step 2: Run them and watch them fail**

Run: `npm test -- src/db/index-plans`
Expected: FAIL — `planUsesSeqScanOn(plan, "lineup_slots")` is `true`. `lineup_slots`'s only index today is its `(team_id, week_number, slot, slot_index)` primary key, whose leading column is the team, so a player-keyed lookup has nothing to use.

- [ ] **Step 3: Add the table and the indexes to `src/db/schema.ts`**

```ts
export const weekStatusEnum = pgEnum("week_status", ["scheduled", "in_progress", "final"]);
```

Place it beside the other enums at the top. Then, after `playerStatLines`:

```ts
/**
 * The ingestion state of record for one NFL week. One row per week, not per league: a week is
 * final when the NFL's games are over, which is a fact about the world rather than about any
 * league. Phase 1 already conflates league week number with NFL week number (`weeks.week_number`
 * indexes into `player_stat_lines.week` directly) and this table inherits that; a phase that runs
 * leagues on offset calendars is the phase that changes it.
 *
 * `version` is the rollup this table exists for, in the sense `docs/decisions/data-layer-
 * hardening.md` means: it is advanced in the SAME transaction as the stat-line writes it
 * summarizes, never after them and never on a schedule. It is what the computed-score cache keys
 * its freshness on, so a cache entry written against version 7 is discarded the instant version 8
 * commits. A version that could be advanced separately from its stat lines is a version that can
 * disagree with them, and a score cache that disagrees with the stats under it is worse than no
 * cache at all.
 *
 * The append-only source of truth remains `player_stat_lines`: this row is derived from it and
 * can be rebuilt from it, which is the second half of the same convention.
 */
export const statWeeks = pgTable("stat_weeks", {
  week: integer("week").primaryKey(),
  status: weekStatusEnum("status").notNull().default("scheduled"),
  /** Monotonic, advanced only on a tick that actually changed a stat line. */
  version: integer("version").notNull().default(0),
  gamesTotal: integer("games_total").notNull().default(0),
  gamesFinal: integer("games_final").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

And the two indexes, on their existing tables:

```ts
// lineupSlots:
  (t) => [
    primaryKey({ columns: [t.teamId, t.weekNumber, t.slot, t.slotIndex] }),
    /**
     * THE inverted index the live-scoring pipeline needs, maintained by the database rather than
     * by a second copy in Redis that could drift from this table. A stat change for one player
     * resolves to the teams that started that player in that week by an index range scan, which
     * is what keeps a tick O(changed players) instead of O(leagues x teams x starters). The
     * column order is (player, week) and not (week, player) because the worker always knows the
     * week and asks about a set of players: the players are the selective half.
     */
    index("lineup_slots_player_week_idx").on(t.playerId, t.weekNumber),
  ],

// rosterSlots:
  (t) => [
    primaryKey({ columns: [t.teamId, t.slot, t.slotIndex] }),
    /**
     * The fallback half. `getLineup` derives a legal lineup from the roster for any team whose
     * manager never opened the editor, so a changed player can affect a team with no
     * `lineup_slots` row for the week at all. No week column, because a roster is not versioned
     * by week.
     */
    index("roster_slots_player_idx").on(t.playerId),
  ],
```

- [ ] **Step 4: Generate and apply the migration against BOTH databases**

```bash
npm run db:generate       # writes drizzle/0013_stat_weeks_and_ingestion_indexes.sql
npm run db:migrate        # dev, pinned to the DIRECT port per Plan A's fix wave
npm run db:migrate:test   # test
```

Read the generated SQL before running it. It must contain `CREATE TYPE "public"."week_status"`, `CREATE TABLE "stat_weeks"` and two `CREATE INDEX`. If drizzle-kit produced anything else — a rename, a drop — stop and reconcile rather than applying it.

Add a Plan D runbook note to `docs/decisions/data-layer-hardening.md` in Task 11, matching the note migrations 0011 and 0012 already carry: both `CREATE INDEX` statements take a `SHARE` lock blocking writes to their table and should be `CREATE INDEX CONCURRENTLY` against a live table with real traffic. `lineup_slots` and `roster_slots` are written on every lineup save and every draft pick, so this one matters more than 0011 did.

- [ ] **Step 5: Run the plan gate and watch it pass**

Run: `npm test -- src/db`
Expected: PASS, including both new plan assertions. If either still reports a sequential scan, do **not** add a planner hint — follow the diagnostic Plan A documented (`SET LOCAL enable_seqscan = off`, compare estimated against measured) and record the finding in the decision doc, exactly as the `teams` seq-scan entry does.

- [ ] **Step 6: Commit**

```bash
git add src/db drizzle
git commit -m "feat(db): stat_weeks, and the two indexes that make an affected-roster lookup an index scan

MatchupSummary.final is inferred today from both scores being non-null, which live scoring makes
wrong: an in-progress week has scores. Finality is a property of the NFL week, so it gets a row
per week, carrying the monotonic version the score cache keys freshness on. That version is
advanced in the same transaction as the stat lines it summarizes, per the rollup convention: a
version that can be advanced separately is a version that can disagree with its own stats.

The spec asked for an incrementally-maintained playerId -> rosters index. This is that index, as
two composite Postgres indexes rather than a hand-maintained Redis map: a map is a copy of
lineup_slots and roster_slots that can drift from them with no way to notice, and an index is
maintained on every write by the database and cannot. Both new query shapes are now in the
EXPLAIN gate over a corpus large enough for the planner to have a real choice."
```

---

## Task 3: The delta diff, and the monthly request budget that makes the cadence honest

Two small, pure-ish pieces the worker is built out of, done together because they are the two halves of "do not do work you do not need to do".

**The diff.** The spec asks that only players whose stats actually changed trigger downstream work, with the prior tick's snapshot kept in Redis. A full `StatLine` per player per week is a lot of Redis for a comparison, so the snapshot holds a short digest per player and the diff returns the lines whose digest moved.

**The budget.** This is the part the plan has to be honest about rather than optimistic. Tank01's dev tier is **1,000 requests a month**. Work it out:

| Cadence | Requests per Sunday | Per month (4.3 weeks) | Fits 1,000? |
|---|---|---|---|
| Poll every game every 5 minutes across a 10.5h Sunday | 126 polls × (1 schedule + ~10 live games) ≈ 1,386 | ~5,960 | No, by 6× |
| Poll every game every 15 minutes | 42 × 11 ≈ 462 | ~1,990 | No, by 2× |
| Poll the schedule every 30 minutes, fetch each box score exactly once, when it first reports final | 24 schedule calls + 16 box scores = 40 | ~195 (with Thursday and Monday) | **Yes, with room** |

So the honest default on the tier that exists today is the third row, and it is a mode rather than a cadence tweak because the difference is behavioral: **`final-only`** fetches a game's box score once, when it first reports final, and **`live`** fetches every non-final game every tick. Both are implemented, both are tested, the mock runs either at zero cost, and the default is the one the free tier affords. Turning on `live` is a founder decision about a paid tier, which is Plan D's business — but it is a config value here, not undelivered infrastructure, so nothing in this plan waits on it.

The budget ledger is what makes either mode safe: it counts every upstream request against a monthly ceiling and denies the reservation that would exceed it, so a misconfiguration costs a skipped tick rather than a suspended API key.

**Files:**
- Create: `src/stats-pipeline/config.ts`
- Create: `src/stats-pipeline/digest.ts`, `src/stats-pipeline/digest.test.ts`
- Create: `src/stats-pipeline/budget.ts`, `src/stats-pipeline/budget.test.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `StatLine` from `@/domain/player`; `Clock` from `@/domain/timing`; `Redis` (type only) from `ioredis`; `envOr` from `@/lib/env`.
- Produces:
  - `STATS_INGESTION_CONFIG` — `mode`, `pollIntervalMs`, `maxWeeksPerTick`, `maxGamesPerTick`, `monthlyRequestBudget`, `reservedForBackfill`, `keys.snapshot(week)`, `keys.budget(month)`, `keys.finalGame(gameId)`, `envVars`.
  - `statLineDigest(line: StatLine): string` and `diffStatLines(previous, next): { readonly changed: readonly StatLine[]; readonly digests: ReadonlyMap<string, string> }` from `@/stats-pipeline/digest`.
  - `createRequestBudget({ redis, clock }): RequestBudget` with `reserve(count: number): Promise<boolean>` and `remaining(): Promise<number>` from `@/stats-pipeline/budget`.

Task 5's worker consumes all three.

- [ ] **Step 1: Write the failing digest test**

Create `src/stats-pipeline/digest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { StatLine } from "@/domain/player";
import { diffStatLines, statLineDigest } from "./digest";

const line = (playerId: string, over: Partial<StatLine> = {}): StatLine => ({
  playerId, week: 3, passingYards: 0, passingTouchdowns: 0, interceptions: 0, rushingYards: 0,
  rushingTouchdowns: 0, receivingYards: 0, receivingTouchdowns: 0, receptions: 0, fumblesLost: 0,
  fieldGoalsMade: 0, extraPointsMade: 0, sacks: 0, defensiveInterceptions: 0, defensiveTouchdowns: 0,
  ...over,
});

describe("statLineDigest", () => {
  it("is stable for the same numbers", () => {
    expect(statLineDigest(line("p1", { rushingYards: 40 }))).toBe(statLineDigest(line("p1", { rushingYards: 40 })));
  });

  it("moves when any single stat field moves", () => {
    const base = statLineDigest(line("p1"));
    // Every field, not a hand-picked two: a digest that silently omits one field is a whole
    // category of stat that can change all Sunday without anyone being told.
    for (const field of ["passingYards", "passingTouchdowns", "interceptions", "rushingYards",
      "rushingTouchdowns", "receivingYards", "receivingTouchdowns", "receptions", "fumblesLost",
      "fieldGoalsMade", "extraPointsMade", "sacks", "defensiveInterceptions", "defensiveTouchdowns"] as const) {
      expect(statLineDigest(line("p1", { [field]: 1 }))).not.toBe(base);
    }
  });

  it("distinguishes a half sack from a whole one", () => {
    // player_stat_lines.sacks is `real`, not `integer` (migration 0012). A digest that rounded
    // would call 1.5 and 1 the same line.
    expect(statLineDigest(line("p1", { sacks: 1.5 }))).not.toBe(statLineDigest(line("p1", { sacks: 1 })));
  });
});

describe("diffStatLines", () => {
  it("returns nothing changed when the week is identical", () => {
    const next = [line("p1", { rushingYards: 40 }), line("p2", { receptions: 3 })];
    const previous = new Map(next.map((entry) => [entry.playerId, statLineDigest(entry)]));
    expect(diffStatLines(previous, next).changed).toEqual([]);
  });

  it("returns only the lines whose numbers moved", () => {
    const before = [line("p1", { rushingYards: 40 }), line("p2", { receptions: 3 })];
    const previous = new Map(before.map((entry) => [entry.playerId, statLineDigest(entry)]));
    const after = [line("p1", { rushingYards: 62 }), line("p2", { receptions: 3 })];
    expect(diffStatLines(previous, after).changed.map((entry) => entry.playerId)).toEqual(["p1"]);
  });

  it("treats a player who has never been seen as changed", () => {
    expect(diffStatLines(new Map(), [line("p9")]).changed.map((entry) => entry.playerId)).toEqual(["p9"]);
  });

  it("hands back the digests for the whole incoming week, not only the changed ones", () => {
    // The returned map is what gets written back as the next tick's snapshot. Returning only the
    // changed digests would drop every unchanged player from the snapshot and make them all look
    // changed on the following tick, which is the same bug as having no diff at all.
    const next = [line("p1"), line("p2")];
    expect([...diffStatLines(new Map(), next).digests.keys()].sort()).toEqual(["p1", "p2"]);
  });
});
```

- [ ] **Step 2: Run it, watch it fail, then write `digest.ts`**

Run: `npm test -- src/stats-pipeline/digest` — FAIL, unresolved import.

`statLineDigest` is a stable string built from every numeric field in a fixed order (reuse the field list rather than restating it: export `STAT_FIELDS` from `src/stats/test-support.ts`? No — `test-support.ts` imports vitest and must never be imported by production code. Put the canonical ordered field list in `src/domain/player.ts` as `STAT_FIELDS`, have both the digest and the contract suite import it from there, and delete the local copy in `test-support.ts`. One list, two readers.) Hash with `node:crypto`'s `createHash("sha1")` over the joined values, or simply join them with a separator — a join is shorter than the hash for a 14-field line, so **join, do not hash**: the value is opaque either way and a plain join is debuggable in `redis-cli`.

- [ ] **Step 3: Write the failing budget test**

Create `src/stats-pipeline/budget.test.ts`. This one is a real-Redis integration test (per the constraints: integration tests hit the real Redis from docker-compose, not mocks). Follow the harness `src/lib/realtime/realtime.test.ts` already uses to get a connection and to clean up its keys.

Cases:
1. A fresh month grants a reservation and `remaining()` drops by exactly that many.
2. Reservations that together exceed `monthlyRequestBudget - reservedForBackfill` are denied, and a denied reservation consumes nothing — `remaining()` is unchanged after the denial.
3. The ledger key rolls over with the month: two reservations under an injected clock on either side of a month boundary do not share a budget.
4. The key carries a TTL, so an abandoned month's counter is not immortal.
5. **A Redis outage fails CLOSED**: with a connection that throws, `reserve()` resolves `false`. This is the opposite of the score cache's rule and is deliberate — see the ruling.

```ts
  it("refuses to spend when it cannot count what it has spent", async () => {
    // The score cache degrades OPEN on a Redis outage (slower, still correct). The budget
    // degrades CLOSED, because the two failures are not symmetrical: a missed cache read costs
    // milliseconds and a miscounted request budget costs the API key. A skipped tick is
    // recoverable in five minutes; a suspended key is not recoverable at all.
    const budget = createRequestBudget({ redis: throwingRedis(), clock: fixedClock });
    await expect(budget.reserve(1)).resolves.toBe(false);
  });
```

- [ ] **Step 4: Write `config.ts` and `budget.ts`**

`STATS_INGESTION_CONFIG` carries every number this plan quotes, with the arithmetic in the docblock — the table at the top of this task goes in as a comment so the next person does not have to re-derive it:

```ts
export const STATS_INGESTION_CONFIG = {
  /**
   * `final-only` fetches a game's box score exactly once, the first tick it reports final.
   * `live` fetches every non-final game every tick.
   *
   * The default is `final-only` because that is what the provider tier that exists today can
   * afford, and the plan states the arithmetic rather than hinting at it: [table]. `live` is a
   * config change and no code change, so a paid tier turns it on. Both modes are tested; the
   * mock provider runs either at zero request cost.
   */
  mode: "final-only",
  /** Ceiling per calendar month across every upstream call the pipeline makes. */
  monthlyRequestBudget: 1_000,
  /** Held back from the ingestion budget so a full-season backfill (`npm run seed`) is never starved by live polling. */
  reservedForBackfill: 150,
  pollIntervalMs: 30 * 60_000,
  /** Weeks examined per tick. A tick scans forward from the newest non-final week, not the whole season. */
  maxWeeksPerTick: 2,
  /** Ceiling on box scores fetched in one tick, so one tick cannot spend a week's budget. */
  maxGamesPerTick: 20,
  /** Minimum gap between two logs about the same stuck week, mirroring DRAFT_SERVICE_CONFIG.tickWarnIntervalMs. */
  warnIntervalMs: 60 * 60_000,
  keys: {
    snapshot: (week: number): string => `stats:snapshot:${week}`,
    budget: (month: string): string => `stats:budget:${month}`,
    finalGame: (gameId: string): string => `stats:game:${gameId}:final`,
    score: (leagueId: string, week: number): string => `score:${leagueId}:${week}`,
    playerIndex: "stats:players",
    scoringSettings: (leagueId: string): string => `stats:settings:${leagueId}`,
  },
  ttlSeconds: {
    /** Generous: a snapshot outliving its week costs one key, losing one mid-Sunday costs a full recompute. */
    snapshot: 14 * 24 * 60 * 60,
    budget: 40 * 24 * 60 * 60,
    finalGame: 200 * 24 * 60 * 60,
    score: 7 * 24 * 60 * 60,
    /** Belt and braces only. The player index has an explicit invalidation path; this bounds how wrong a missed invalidation can get. */
    playerIndex: 6 * 60 * 60,
    scoringSettings: 6 * 60 * 60,
  },
  envVars: {
    mode: "STATS_INGESTION_MODE",
    pollIntervalMs: "STATS_POLL_INTERVAL_MS",
    monthlyRequestBudget: "STATS_MONTHLY_REQUEST_BUDGET",
  },
} as const;
```

`createRequestBudget` uses `INCRBY` + `EXPIRE` on `keys.budget(YYYY-MM)` derived from the injected clock, checks the post-increment total against the ceiling, and **decrements back** if the reservation would exceed it — that is what makes a denial consume nothing. Wrap the whole body in `try/catch` returning `false`.

- [ ] **Step 5: Run both suites, then add the env vars**

```bash
npm run infra:up
npm test -- src/stats-pipeline
```

Add `STATS_INGESTION_MODE`, `STATS_POLL_INTERVAL_MS` and `STATS_MONTHLY_REQUEST_BUDGET` to `.env.example`, commented out, each with a one-line explanation of what it costs to change. No em-dashes.

- [ ] **Step 6: Commit**

```bash
git add src/stats-pipeline .env.example src/domain/player.ts src/stats/test-support.ts
git commit -m "feat(stats-pipeline): the delta digest, and a monthly request budget with the arithmetic behind it

A full NFL Sunday polled every five minutes is about 1,386 requests. The Tank01 dev tier is
1,000 a MONTH. So the cadence is not a tuning question, it is a mode: final-only fetches each box
score exactly once when it first reports final (about 195 requests a month, with room), and live
fetches every unfinished game every tick (about 5,960, which needs a paid tier). Both are built
and tested, the default is the one the free tier affords, and the difference is one config value.

The ledger is what makes either safe. It fails CLOSED on a Redis outage, deliberately the
opposite of the score cache: a missed cache read costs milliseconds and a miscounted budget costs
the API key. A skipped tick recovers in half an hour; a suspended key does not recover.

The digest moves on every one of the fourteen stat fields, proved field by field rather than by
two hand-picked examples, and keeps sacks' half values distinct since migration 0012 widened that
column to real."
```

---

## Task 4: The affected-roster resolver, proved by call count and not by hope

The spec's exit criterion for this is specific and worth quoting: *"only rosters containing a changed player are recomputed, verified by an instrumented call-count assertion, not just final correctness."* Final correctness passes even for the O(leagues × teams × starters) implementation the whole step exists to avoid, which is exactly why it says that.

Two halves, because `getLineup` has two halves: a team with saved `lineup_slots` rows for the week uses them, and a team with none derives its lineup from its roster. A changed player can reach a team through either.

**Files:**
- Create: `src/stats-pipeline/affected.ts`, `src/stats-pipeline/affected.test.ts`

**Interfaces:**
- Consumes: `Db`/`ReadonlyDb` from `@/db/client`; `lineupSlots`, `rosterSlots`, `teams` from `@/db/schema`; `BENCH_SLOT` from `@/domain/roster`.
- Produces: `affectedTeams(db: ReadonlyDb, input: { readonly week: number; readonly playerIds: readonly string[] }): Promise<readonly AffectedTeam[]>` where `AffectedTeam = { readonly leagueId: string; readonly teamId: string }`, deduplicated and ordered by `(leagueId, teamId)` so a tick's fan-out order is deterministic.

Task 5 consumes it.

- [ ] **Step 1: Write the failing test**

Create `src/stats-pipeline/affected.test.ts` against the real test Postgres, using `createTestDb()` + `truncateAll(db)` and the league/team seeding helpers `src/league-service/test-support.ts` already exports.

Cases, in this order:

1. **A started player reaches their team.** Seed two leagues, four teams; team A1 starts player `p1` in week 3 via a saved lineup. `affectedTeams(db, { week: 3, playerIds: ["p1"] })` returns exactly A1.
2. **A benched player does not.** Team A2 holds `p1` on its bench in week 3. It is not returned. This is the case that turns "who owns him" into "who is scoring him".
3. **A team with no saved lineup is reached through its roster.** Team B1 has `roster_slots` for `p1` and no `lineup_slots` rows for week 3 at all. It IS returned, because `getLineup` would start him. Missing this is a whole class of manager (the ones who never open the editor) whose scores would silently stop updating.
4. **A team with a saved lineup for the week is NOT also reached through its roster.** Team A2 (bench, case 2) owns `p1` on its roster; the roster fallback must not re-admit it, or the bench rule is defeated by the fallback.
5. **Deduplication.** Two changed players on the same team return that team once.
6. **The empty set short-circuits.** `playerIds: []` returns `[]` and issues **zero** queries, asserted with a counting proxy around the connection. A tick where nothing changed is the common case on a Tuesday and it must cost nothing.
7. **The call-count guarantee.** Seed 50 leagues × 12 teams, all rostering and starting a large shared player pool; change ONE player who is started by exactly three teams; assert the result is those three, and assert with a counting `ReadonlyDb` proxy that the resolver issues **at most two queries** regardless of how many leagues exist:

```ts
  it("costs the same two queries whether there are two leagues or fifty", async () => {
    // The spec's own exit criterion, and the reason it is phrased as a call count: an O(leagues x
    // teams x starters) implementation returns exactly the same three teams and passes every
    // correctness case above it. Only the counter can tell them apart.
    await seedLeagues(db, 50, { teamsPerLeague: 12 });
    const counting = countingDb(db);
    const affected = await affectedTeams(counting.db, { week: 3, playerIds: ["p-shared"] });
    expect(affected).toHaveLength(3);
    expect(counting.selectCount).toBeLessThanOrEqual(2);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- src/stats-pipeline/affected` — FAIL, unresolved import.

- [ ] **Step 3: Write `affected.ts`**

Two selects, unioned in application code (a SQL `UNION` across two different shapes buys nothing here and costs readability):

```ts
/**
 * Which teams' scores a set of changed players can move, in one week.
 *
 * This is the "inverted playerId -> rosters index" the spec asks for, and it is a pair of index
 * lookups rather than a maintained data structure: `lineup_slots_player_week_idx` and
 * `roster_slots_player_idx` (migration 0013) are maintained incrementally by Postgres on every
 * lineup save and every draft pick, which is what a hand-rolled Redis map would be trying to
 * imitate and could get wrong. `src/db/index-plans.test.ts` fails the build if either of these
 * plans ever sequentially scans.
 *
 * Both halves are needed because `getLineup` has two halves: saved lineup rows win, and a team
 * with none fields its roster (`defaultLineup`). A team in the second group has no `lineup_slots`
 * row to find, so a lineup-only resolver would silently stop updating the score of every manager
 * who never opened the lineup editor. The roster half is therefore restricted to teams with NO
 * saved lineup for the week, or a benched player would come back in through it.
 */
export async function affectedTeams(db: ReadonlyDb, { week, playerIds }: AffectedInput): Promise<readonly AffectedTeam[]> {
  if (playerIds.length === 0) return [];

  const started = await db
    .select({ leagueId: teams.leagueId, teamId: teams.id })
    .from(lineupSlots)
    .innerJoin(teams, eq(teams.id, lineupSlots.teamId))
    .where(and(eq(lineupSlots.weekNumber, week), inArray(lineupSlots.playerId, [...playerIds]), ne(lineupSlots.slot, BENCH_SLOT)));

  const owned = await db
    .select({ leagueId: teams.leagueId, teamId: teams.id })
    .from(rosterSlots)
    .innerJoin(teams, eq(teams.id, rosterSlots.teamId))
    .where(
      and(
        inArray(rosterSlots.playerId, [...playerIds]),
        // Only teams with NOTHING saved for this week; anything saved already answered above,
        // including a deliberate benching.
        notExists(
          db.select({ one: sql`1` }).from(lineupSlots)
            .where(and(eq(lineupSlots.teamId, rosterSlots.teamId), eq(lineupSlots.weekNumber, week))),
        ),
      ),
    );

  const byKey = new Map([...started, ...owned].map((row) => [`${row.leagueId}:${row.teamId}`, row]));
  return [...byKey.values()].sort((a, b) => `${a.leagueId}:${a.teamId}`.localeCompare(`${b.leagueId}:${b.teamId}`));
}
```

`notExists` is a correlated subquery, so re-run the plan gate: if it turns the `roster_slots` read into a scan, replace it with a second explicit query for the week's teams-with-lineups and an application-side filter, and record the change in the decision doc.

- [ ] **Step 4: Run it, run the plan gate, commit**

```bash
npm test -- src/stats-pipeline
npm test -- src/db/index-plans
```

```bash
git add src/stats-pipeline/affected.ts src/stats-pipeline/affected.test.ts
git commit -m "feat(stats-pipeline): resolve changed players to the teams actually scoring them, in two queries

The spec asks for the call count and not just the answer, because an O(leagues x teams x
starters) implementation returns exactly the same three teams and passes every correctness case.
Fifty leagues and two leagues cost the same two queries here, asserted with a counting connection.

Both halves of getLineup are covered. A benched player moves nothing, and a team that never
opened the lineup editor is still reached through its roster: missing that half would have
silently stopped updating the score of every manager who leaves their lineup on the default,
which is most of them."
```

---

## Task 5: The worker — one tick, idempotent by construction, honest about what a week is

Now the piece everything above exists for. It follows `src/draft-service/ticker.ts`'s shape exactly (an explicit `tick()` tests drive, `start()`/`stop()` as a `setInterval` around it, an overlap guard, per-entity error isolation, rate-limited failure logging) because a second background-worker idiom in one codebase is a second thing to get right.

**Files:**
- Create: `src/stats-pipeline/contract.ts`
- Create: `src/stats-pipeline/persist.ts`, `src/stats-pipeline/persist.test.ts`
- Create: `src/stats-pipeline/finalize.ts`, `src/stats-pipeline/finalize.test.ts`
- Create: `src/stats-pipeline/worker.ts`, `src/stats-pipeline/worker.test.ts`
- Create: `src/stats-pipeline/test-support.ts`
- Modify: `src/league-service/results.ts` (the scoring body moves to `finalize.ts`; `leagueStandings` stays)
- Modify: `src/league-service/index.ts`

**Interfaces:**
- Consumes: `affectedTeams` (Task 4), `diffStatLines`/`statLineDigest` (Task 3), `createRequestBudget` (Task 3), `STATS_INGESTION_CONFIG` (Task 3), `statWeeks`/`playerStatLines`/`matchups`/`drafts` from `@/db/schema`, `StatsProvider`/`GameSummary` from `@/stats/provider`, `PublishFn` from `@/lib/realtime/publish`, `Clock` from `@/domain/timing`, `scoreLineup`/`ScoringRules` from `@/scoring`, `excludedSetFor` from `@/db/upsert`.
- Produces:
  - `ScoreUpdatePayload = { readonly week: number; readonly status: WeekStatus; readonly version: number; readonly gamesFinal: number; readonly gamesTotal: number; readonly scores: readonly TeamScore[] }` and `TeamScore = { readonly teamId: string; readonly points: number }` from `@/stats-pipeline/contract`. Task 8's client hook imports these **as types only**, honoring the client boundary.
  - `persistTick(db, input): Promise<{ readonly version: number; readonly changedCount: number }>` from `@/stats-pipeline/persist`.
  - `finalizeWeek(db, leagueId, week): Promise<FinalizeResult>` from `@/stats-pipeline/finalize`.
  - `createIngestionWorker(deps): IngestionWorker` with `tick()`, `start()`, `stop()` from `@/stats-pipeline/worker`.
  - `fakeStatsProvider(script)` from `@/stats-pipeline/test-support`.

- [ ] **Step 1: Move week scoring out of `league-service/results.ts` into `finalize.ts`, unchanged**

`scoreWeek`'s body is already correct and already idempotent: it recomputes every team's total from stored lineups and stored stat lines and overwrites. It moves verbatim to `src/stats-pipeline/finalize.ts` as `finalizeWeek`, with its docblock rewritten — the current one says *"There is NO live scoring in this phase … Publishing no event is deliberate"*, which this plan makes false — and with one behavioral addition:

```ts
/**
 * The SETTLEMENT write: stamps a week's matchups with the totals that will stand.
 *
 * This is the rollup half of the balance-as-rollup convention. `player_stat_lines` and
 * `lineup_slots` are the append-only source and stay authoritative; `matchups.home_score` is the
 * derived total, written once the week's games are over so standings, clinch math and the season
 * record read one number instead of recomputing a season of lineups on every page.
 *
 * Called ONLY by the ingestion worker, when a week transitions to final. The commissioner's
 * manual score button and its route were deleted in Plan B Task 8: with a live feed, scoring is
 * not a thing a person triggers, and leaving a manual override in place would let a commissioner
 * stamp a week the games had not finished.
 *
 * Re-running is safe and produces identical numbers, which is the whole reason re-ingestion
 * cannot double-count: every number here is recomputed from absolute stored values and
 * overwrites. Nothing accumulates.
 */
```

Plus the guard the worker needs:

```ts
  // A league that has not drafted has no rosters, so every team would score zero and the
  // standings would show a season of phantom losses. An undrafted league is not behind on
  // scoring, it has not started.
  const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, leagueId));
  if (draft?.status !== "complete") return { ok: false, status: 409, reason: "That league hasn't finished its draft yet." };
```

Write the test for that guard FIRST (`finalize.test.ts`: an undrafted league is refused and its matchups keep null scores; a drafted league is stamped; running it twice produces byte-identical scores).

- [ ] **Step 2: Write the failing persistence test**

`src/stats-pipeline/persist.test.ts`, against real Postgres. The cases that matter:

1. A first tick inserts the changed stat lines and creates the `stat_weeks` row at `version: 1`.
2. **A tick that changed nothing does not advance the version.** The version is the cache's freshness signal; advancing it on a no-op tick invalidates every league's cached score every half hour for nothing.
3. **Re-ingesting the identical week is a no-op and does not double-count**, asserted on the stored values themselves:

```ts
  it("re-ingesting a week it has already ingested changes no number and no version", async () => {
    await persistTick(db, tick({ week: 3, changed: WEEK_3_LINES, status: "final", games: { total: 2, final: 2 } }));
    const afterFirst = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 3));
    const [weekAfterFirst] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));

    await persistTick(db, tick({ week: 3, changed: WEEK_3_LINES, status: "final", games: { total: 2, final: 2 } }));
    const afterSecond = await db.select().from(playerStatLines).where(eq(playerStatLines.week, 3));
    const [weekAfterSecond] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));

    // Absolute values, upserted on (player_id, week). Double-counting is not something this
    // guards against, it is something the storage model makes unrepresentable, and this is the
    // test that says so out loud rather than a comment claiming it.
    expect(afterSecond).toEqual(afterFirst);
    expect(weekAfterSecond!.version).toBe(weekAfterFirst!.version);
  });
```

4. **A partial week never deletes what a fuller tick already wrote.** Tick one carries eight players; tick two, simulating an upstream hiccup, carries three of them with identical numbers. Every one of the original eight is still stored afterward. The `dropped` parameter exists for a genuine correction (a player's line withdrawn upstream) and is only ever populated from an explicit upstream absence within a game the tick actually fetched, never from "this tick returned fewer rows".
5. The stat-line write and the `stat_weeks` advance happen in **one** transaction: assert by forcing a failure on the second write and confirming the first rolled back.

- [ ] **Step 3: Write `persist.ts`**

One `db.transaction`: upsert the changed lines with `excludedSetFor` (the helper `src/db/upsert.ts` already provides), then upsert `stat_weeks` with `version` advanced by `changed.length > 0 ? 1 : 0`, `status`, `gamesTotal`, `gamesFinal`, `updatedAt` from the injected clock. Return the resulting version.

- [ ] **Step 4: Write the failing worker test**

`src/stats-pipeline/worker.test.ts`, against real Postgres and real Redis, with `fakeStatsProvider` driving the script. The worker's deps are all injected — `db`, `provider`, `redis`, `publish`, `clock`, `budget`, `onOutcome` — so nothing here touches `process.env` or a wall clock.

The cases:

1. **A week whose games are all `scheduled` costs one request and writes nothing.** `listGames` is called, no box score is fetched, `stat_weeks` says `scheduled`.
2. **`final-only` fetches a game's box score the tick it turns final, and never again.** Drive the script: tick 1 in progress (no fetch), tick 2 final (fetch), tick 3 final (no fetch, because `stats:game:<id>:final` is set). Assert the provider's `getGameStatLines` call count is exactly 1 across the three ticks. This is the single most important assertion in the plan: it is what the whole budget arithmetic rests on.
3. **`live` fetches every non-final game every tick**, and the same script produces three fetches.
4. **Only affected leagues get a `score.update`.** Two leagues, one holding the changed player, one not; exactly one publish, carrying that league's id.
5. **The payload carries the week's honest state**: `status`, `version`, `gamesFinal`/`gamesTotal`, and one `TeamScore` per affected team.
6. **A week that turns final finalizes every drafted league in it**, and skips the undrafted one (Step 1's guard), and publishes a final-status `score.update` for each finalized league.
7. **A denied budget reservation skips the tick without writing anything**, and reports an outcome rather than throwing.
8. **One league's failure does not stop the tick**, mirroring the draft ticker's per-draft isolation: force `finalizeWeek` to throw for league A and assert league B is still finalized.
9. **Publishing failure never fails the write.** `publish` rejects; the stat lines and `stat_weeks` are still committed. This is the conventions rule verbatim and the worker is a new place to break it.
10. **`tick()` does not overlap itself** under `start()`, driven with fake timers exactly as `ticker.test.ts` does.

- [ ] **Step 5: Write `worker.ts`**

The shape, with the reasoning that has to survive in comments:

```ts
/**
 * The live-scoring ingestion worker. One tick is:
 *
 *   1. Pick the weeks worth looking at: the newest non-final week and the one after it
 *      (`maxWeeksPerTick`), never the whole season. A finished week is finished.
 *   2. Reserve budget for the requests this tick will make, BEFORE making any of them. A denial
 *      skips the tick whole; a tick that spent half its requests and then ran out is a tick that
 *      wrote a half-week.
 *   3. `listGames(week)`; decide per game whether it needs a box score (mode + the "already
 *      final and already fetched" marker in Redis).
 *   4. Diff the resulting lines against the prior tick's digest snapshot. Nothing changed is the
 *      common case and it exits here, having written nothing and advanced no version.
 *   5. `persistTick` — the stat lines and the week's rollup, one transaction.
 *   6. Resolve the changed players to affected teams, recompute those teams' scores, publish one
 *      batched `score.update` per league.
 *   7. If the week just became final, finalize every drafted league in it.
 *
 * Modeled on `src/draft-service/ticker.ts` deliberately: same explicit tick()/start()/stop(),
 * same injected clock, same overlap guard, same per-entity error isolation, same rate-limited
 * outcome logging. Two background-worker idioms in one codebase is two things to keep correct.
 *
 * It is the SECOND writer this database has, which is what made Plan A's per-draft row lock
 * load-bearing rather than theoretical. It deliberately touches no draft table: its writes are
 * `player_stat_lines`, `stat_weeks` and `matchups`, none of which the draft path writes.
 */
```

Batching detail worth being explicit about in the code: scores are recomputed **per affected team** and grouped **per league** before publishing, so a twelve-team league whose whole roster moved is one event and not twelve. `REALTIME_CONFIG.streamMaxLen` is 10,000 and the docblock already says it is sized for "a full live draft plus a Sunday of scoring updates" — one event per league per tick is what makes that true.

- [ ] **Step 6: Run everything, then commit**

```bash
npm run infra:up
npm test -- src/stats-pipeline
npm test -- src/league-service
npm run typecheck && npm run lint
```

```bash
git add src/stats-pipeline src/league-service
git commit -m "feat(stats-pipeline): the ingestion worker, and week finalization as a settlement write

One tick reserves its budget before it spends any of it, lists the week's games, fetches only the
box scores the mode says it needs, diffs against the prior tick's digests, writes the changed
lines and the week rollup in one transaction, and publishes one batched score.update per affected
league. A tick where nothing changed writes nothing and advances no version, which is most ticks.

Re-ingestion cannot double-count, and the test asserts it on the stored rows rather than a
comment claiming it: stat lines are absolute values upserted on (player_id, week), and a week's
matchup totals are recomputed from them and overwritten. Nothing accumulates anywhere.

finalizeWeek refuses a league that has not finished its draft. Without that guard the worker
would stamp a season of nil-nil results on every league still waiting to draft, and the standings
would show phantom losses that looked like real ones.

Shaped after draft-service/ticker.ts on purpose, down to the overlap guard and the rate-limited
outcome log. Publishing failure never fails the write; the conventions rule is one this worker is
a brand new place to break."
```

---

## Task 6: The computed-score cache, the player index, and what happens when Redis is gone

The spec asks for a Redis-cached computed-score layer keyed by `(leagueId, week, statsVersion)`, extended to the other read-heavy, rarely-changing data, with **explicit write-through invalidation rather than a blind TTL that could serve stale scoring settings mid-week**, and an explicit degradation rule matching Phase 1's Redis-outage convention.

One design choice worth stating before the code: the key is `score:<leagueId>:<week>` and the **version lives in the value**, not in the key. A version in the key means invalidating on a lineup change requires a `SCAN` for a pattern, or knowing every version ever written. A version in the value means a read compares and discards, and a lineup write is a single `DEL` of a key it can name exactly.

**Files:**
- Create: `src/stats-pipeline/score-cache.ts`, `src/stats-pipeline/score-cache.test.ts`
- Create: `src/stats-pipeline/reference-cache.ts`, `src/stats-pipeline/reference-cache.test.ts`
- Modify: `src/league-service/lineups.ts` (invalidate on write)
- Modify: `src/league-service/creation.ts` (invalidate scoring settings on write)
- Modify: `src/data/seed/seed-players.ts` (invalidate the player index after a seed)

**Interfaces:**
- Consumes: `Redis` (type only) from `ioredis`; `STATS_INGESTION_CONFIG` (Task 3); `MatchupSummary` from `@/league-room/contract`.
- Produces: `createScoreCache({ redis }): ScoreCache` with `read(leagueId, week, version)`, `write(leagueId, week, version, scores)`, `invalidate(leagueId, week)`; `createReferenceCache({ redis }): ReferenceCache` with `players(load)`, `invalidatePlayers()`, `scoringSettings(leagueId, load)`, `invalidateScoringSettings(leagueId)`. Task 7 consumes both from the read paths.

- [ ] **Step 1: Write the failing cache tests**

Real Redis. The cases:

1. A write then a read at the same version returns the value.
2. **A read at a newer version returns a miss and does not return the stale value.** The whole point.
3. `invalidate` removes the key, so a subsequent read at the same version misses.
4. Keys carry the configured TTL.
5. **Every method degrades OPEN on a Redis outage**: with a throwing connection, `read` resolves to a miss, `write` resolves without throwing, `invalidate` resolves without throwing. A cache that can fail a page render is worse than no cache.
6. A corrupt value (not JSON, or JSON of the wrong shape) is treated as a miss and does not throw. Redis holds whatever the last deploy put there and a shape change must not take the site down.

And for the reference cache:

7. `players(load)` calls `load` once on a miss and zero times on a hit.
8. `invalidatePlayers()` makes the next call load again.
9. `scoringSettings` is per-league: invalidating league A does not evict league B.
10. Both degrade open, calling `load` on an outage — the correct value, slower.

- [ ] **Step 2: Write both modules**

The read shape that carries the version:

```ts
interface CachedScores {
  readonly version: number;
  readonly scores: readonly TeamScore[];
}

/**
 * One key per (leagueId, week). The version lives in the VALUE and not in the key, on purpose:
 * a version in the key would make invalidating on a lineup change either a SCAN over a pattern or
 * a bet that you know every version ever written. With it in the value, a read compares and
 * discards, and a lineup write is a single DEL of a key it can name exactly.
 *
 * Every method degrades OPEN. Phase 1's convention is that Postgres is authoritative and Redis is
 * an accelerator, so a Redis outage makes reads slower and never wrong, and never an error. This
 * is the deliberate opposite of `budget.ts`, which fails closed, for the reason recorded there.
 */
```

- [ ] **Step 3: Wire the three invalidation points**

- `setLineup` (`src/league-service/lineups.ts`): after the lineup transaction commits, `void cache.invalidate(leagueId, weekNumber)`. After, not inside — an invalidation inside the transaction can evict a key for a write that then rolls back, and the failure mode of a slightly-late eviction is one stale read, while the failure mode of an early one is a cache that says a lineup changed when it did not.
- `createLeague` (`src/league-service/creation.ts`): invalidate that league's scoring settings. Add a comment naming the obligation for the future: *any* route that edits scoring settings must invalidate here too, and the day one exists is the day this becomes a shared helper rather than two call sites.
- `seedPlayers` (`src/data/seed/seed-players.ts`): invalidate the player index after the upsert, because the seed is the only writer of `players` today.

Each of these takes the cache as an **injected dependency with a no-op default**, not a module-level singleton, so every existing test in those files keeps passing without a Redis connection.

- [ ] **Step 4: Run and commit**

```bash
npm test -- src/stats-pipeline
npm test -- src/league-service
```

```bash
git add src/stats-pipeline src/league-service src/data/seed
git commit -m "feat(stats-pipeline): a version-stamped score cache, a player index, and open degradation

The score cache is one key per (leagueId, week) with the stat version in the VALUE rather than in
the key. A version in the key makes invalidating on a lineup change either a SCAN over a pattern
or a bet that you know every version ever written; in the value, a read compares and discards and
a lineup write is a single DEL of a key it can name.

Everything here degrades OPEN: a Redis outage makes a read slower and never wrong and never an
error, matching Phase 1's rule that Postgres is authoritative. That is the deliberate opposite of
the request budget, which fails closed, and both reasons are written down where they apply.

The player index closes a real cost the spec did not know about: matchupWeek reads the WHOLE
players table with no WHERE clause on every matchup page view, to build a position map. Scoring
settings are cached per league with explicit invalidation on write, not a TTL, because a blind
TTL can serve a league its old scoring rules in the middle of a week."
```

---

## Task 7: The read paths tell the truth, and the lineup lock finally has a clock

Three changes that all follow from the same fact: a week now has a state, and the code that inferred one from null scores must stop.

**Files:**
- Modify: `src/league-room/contract.ts`
- Modify: `src/league-service/read.ts`
- Modify: `src/league-service/lineups.ts`
- Create: `src/league/week-status.ts`, `src/league/week-status.test.ts`
- Modify: `src/league/index.ts`
- Modify: `src/league-service/league-read-routes.test.ts`, `src/league-service/lineups.test.ts`, `src/league-service/lineup-routes.test.ts`

**Interfaces:**
- Produces: `WeekStatus` (re-exported from `@/league`, structurally the same union as `GameStatus`, defined once), `weekStatusFromGames(games)`, `isLineupLocked(status)` from `@/league/week-status`.
- Produces: `MatchupSummary`, `MatchupDetail` and `MatchupWeekBody` gain `readonly weekStatus: WeekStatus`; `LeagueHomeBody` gains `readonly weekStatus: WeekStatus`; `LineupBody.locked` keeps its name and changes its meaning.
- Consumes: `createScoreCache` / `createReferenceCache` (Task 6), `statWeeks` (Task 2).

- [ ] **Step 1: Write the failing tests for the lock**

The current rule is in `isWeekLocked`: a week is locked once both scores are non-null. With live scoring that is a hole an integrity review would fail us on — a manager could watch their running back get hurt at 1:15pm and swap him out. Write these first, in `src/league-service/lineups.test.ts`:

```ts
  it("locks a week the moment its first game kicks off, not when it finishes", async () => {
    await setWeekStatus(db, 3, "in_progress");
    const result = await setLineup(db, validLineupInput({ weekNumber: 3 }));
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(result.ok ? "" : result.reason).toBe("Week 3 has started, so its lineup can't change.");
  });

  it("leaves a week open while it is still scheduled", async () => {
    await setWeekStatus(db, 4, "scheduled");
    await expect(setLineup(db, validLineupInput({ weekNumber: 4 }))).resolves.toMatchObject({ ok: true });
  });

  it("treats a week with no stat_weeks row at all as open", async () => {
    // A week the ingestion worker has never reached is a week whose games have not been listed,
    // which is not the same as a week in progress. Locking on absence would freeze every league's
    // lineups the first time the worker was down.
    await expect(setLineup(db, validLineupInput({ weekNumber: 9 }))).resolves.toMatchObject({ ok: true });
  });
```

- [ ] **Step 2: Write `src/league/week-status.ts`**

A pure module in a 100%-gated directory:

```ts
/**
 * A week's state, derived from its games. Structurally identical to `GameStatus` and defined once
 * here rather than twice: a week is `final` when every game is, `scheduled` when none has started,
 * and `in_progress` for everything between, including the long tail of a Sunday night where
 * fifteen games are done and one is not.
 */
export function weekStatusFromGames(games: readonly { readonly status: GameStatus }[]): WeekStatus {
  if (games.length === 0) return "scheduled";
  if (games.every((game) => game.status === "final")) return "final";
  if (games.every((game) => game.status === "scheduled")) return "scheduled";
  return "in_progress";
}

/**
 * Lineups lock when the week starts, not when it ends.
 *
 * Phase 1 locked on "both scores exist", which was correct when a score only appeared because a
 * commissioner pressed a button, and is a hole the moment scores move on their own: a manager
 * could watch a running back leave the field at 1:15pm and swap him out at 1:16. Locking on the
 * week's start is the coarse version of the rule; a per-player lock at each player's own kickoff
 * is the finer version and needs a per-game kickoff time this seam does not carry yet. Coarse and
 * correct beats fine and absent, and the coarse rule errs toward locking early, which costs a
 * manager some flexibility and costs nobody their money.
 */
export function isLineupLocked(status: WeekStatus | null): boolean {
  return status !== null && status !== "scheduled";
}
```

Test it exhaustively (it is a gated directory): every combination of zero, all-scheduled, all-final, mixed, and a single game in each state.

- [ ] **Step 3: Replace `isWeekLocked` and thread `weekStatus` through the contracts**

`isWeekLocked` reads `stat_weeks` and delegates to `isLineupLocked`. `leagueHome` and `matchupWeek` read the week's `stat_weeks` row and put `weekStatus` on the body. `MatchupSummary.final` stays but its docblock changes to say it now means the settlement write has happened, and every UI decision about "is this live" reads `weekStatus` instead.

While in `matchupWeek`, swap its two heavy reads onto Task 6's caches: the whole-table `players` read becomes `referenceCache.players(...)` and the settings read becomes `referenceCache.scoringSettings(leagueId, ...)`. Both take the cache as an injected dependency with a no-op default so every existing test in `league-read-routes.test.ts` keeps working untouched.

- [ ] **Step 4: Run the full league suites**

```bash
npm test -- src/league
npm test -- src/league-service
npm run test:coverage   # src/league is gated at 100% and just grew a file
```

Expect several existing assertions to need updating (the lineup-lock message changed, `LineupBody.locked` now derives differently, `MatchupWeekBody` grew a field). Update them; do not weaken them.

- [ ] **Step 5: Commit**

```bash
git add src/league src/league-service src/league-room/contract.ts
git commit -m "feat(league): a week has a state, and lineups lock when it starts

isWeekLocked's own docblock said there was deliberately no clock-based lock because the phase had
no live game data for a clock to track. There is now. Locking on 'both scores exist' was right
when a score only appeared because a commissioner pressed a button and is a hole the moment
scores move on their own: a manager could watch a back leave the field at 1:15 and swap him at
1:16. Weeks now lock at kickoff, and a week the worker has never reached stays open rather than
freezing every league's lineups the first time the worker is down.

weekStatus rides the contracts so the UI never re-derives 'is this live' from a null check, and
matchupWeek's whole-table players read is now a cached index instead of two thousand rows on
every matchup page view."
```

---

## Task 8: The live matchup surface, and retiring the controls that said live scoring did not exist

This is the deliberate product transition, and it is a deletion as much as an addition. The founder rule is no half-states: a manual "Score week" button next to a live feed is a commissioner able to stamp a week the games have not finished, and a page footer reading "There's no live scoring yet" under a moving score is a lie in the product's own voice.

**Files:**
- Create: `src/league-room/components/week-status-badge.tsx`, `week-status-badge.test.tsx`
- Create: `src/league-room/hooks/use-live-scores.ts`, `use-live-scores.test.tsx`
- Modify: `src/league-room/components/matchup-scoreboard.tsx` (+ test)
- Modify: `src/league-room/components/matchup-panel.tsx` (+ test — including the "never implies live scoring" case)
- Modify: `src/league-room/components/league-home.tsx` (+ test)
- Modify: `src/app/app/leagues/[leagueId]/matchups/[week]/page.tsx`
- Modify: `e2e/season.spec.ts`
- Delete: `src/app/api/leagues/[leagueId]/weeks/[week]/score/route.ts`, `src/league-room/components/score-week-button.tsx`, `src/league-room/components/score-week-button.test.tsx`
- Modify: `src/league-service/league-read-routes.test.ts` (drop the score-route suite)

**Interfaces:**
- Consumes: `ScoreUpdatePayload` / `TeamScore` from `@/stats-pipeline/contract` **as a type only** (client boundary); `subscribeLeagueStream` from `@/event-stream/league-stream`; `Badge` from `@/components/ui`.
- Produces: `WeekStatusBadge({ status })`; `useLiveScores(leagueId, initial)` returning `{ readonly scores: ReadonlyMap<string, number>; readonly status: WeekStatus; readonly connection: "connecting" | "live" | "reconnecting" }`.

- [ ] **Step 1: Rewrite the "never implies live scoring" test into what it should now assert**

`src/league-room/components/matchup-panel.test.tsx:19` currently asserts the panel never says "in progress", "live now" or "updating". That test was right and is now wrong, and it gets **replaced deliberately in its own step so the change is visible in the diff rather than buried**:

```tsx
  // Phase 2 Plan B: live scoring EXISTS. This case used to assert the opposite, and it was
  // correct while the stat set was a fixed file a commissioner scored by hand. Inverting it is
  // the point of the change, not a casualty of it: the panel must now say which of the three
  // states a week is in, and must never show a moving number with no state beside it.
  it("says which state the week is in, and never shows a score with no state", async () => {
    renderInLeague(<MatchupPanel matchup={inProgressMatchup} myTeamId="t1" weekStatus="in_progress" />, deps);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("Final")).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Build `WeekStatusBadge` as the one place a status becomes a badge**

Three states, three tones, plain-language copy with no em-dashes: `scheduled` → "Not started" (neutral), `in_progress` → "In progress" (accent), `final` → "Final" (positive). Both the scoreboard and Task 9's home card render it, so the two can never disagree about what a week looks like. Test it in both themes and axe-clean via `inBothThemes`.

Delete the inline badge in `matchup-scoreboard.tsx` (`{matchup.final ? "Final" : "Not scored yet"}`) and render this instead. That inline ternary is exactly the page-local visual mapping the founder correction from 2026-08-18 bans.

- [ ] **Step 3: Write `useLiveScores`, folding `score.update` off the shared stream**

It follows `useLeagueChat`'s shape — one shared `EventSource` per league url via `subscribeLeagueStream`, a refetch on `open` to cover the mount gap, the generation guard Plan A added so a slow refetch cannot clobber a newer one. It owns exactly one frame type, `score.update`, and ignores draft and chat frames on the same stream, mirroring `CHAT_EVENT_TYPES`.

The one new behavior worth its own test: **a frame for a stale version is dropped.** Frames can arrive out of order across a reconnect, and folding an older version over a newer one would make a score go backwards on screen, which in a money product reads as a bug at the worst possible moment.

- [ ] **Step 4: Fix the copy on the matchups page**

Replace:

```
{"Scores come from this preview's fixed 2026 stat set. There's no live scoring yet."}
```

The replacement is driven by the configured provider, not hardcoded, because the sentence's truth depends on it. Add a small server-side helper that maps the active provider name to one sentence, and render it. Copy (no em-dashes, plain language, active voice):

- mock: `"Scores come from this preview's 2026 stat set, not from live games."`
- tank01: `"Scores update from live game data while games are being played."`

- [ ] **Step 5: Delete the manual scoring path**

```bash
git rm src/app/api/leagues/[leagueId]/weeks/[week]/score/route.ts
git rm src/league-room/components/score-week-button.tsx
git rm src/league-room/components/score-week-button.test.tsx
```

Remove the `ScoreWeekButton` render and import from `league-home.tsx` (line 61 and line 11), remove the `POST /api/leagues/[leagueId]/weeks/[week]/score` suite from `league-read-routes.test.ts`, and update the comment in `league-home.test.tsx:11` that explains why that file mocks `next/navigation`.

Then update `e2e/season.spec.ts`, which drives the button today (its third assertion block, `getByRole("button", { name: /^Score Week/ })`). The replacement asserts the honest thing: the seeded season's weeks carry a state badge, and the lineup editor's lock message matches that state. Keep the existing disjunction discipline the file already uses — assert the set of possible states first, so a regression that removed all of them cannot skip into a vacuous pass.

- [ ] **Step 6: Persona-panel pass**

**CONTROLLER STEP.** Three changed user-facing surfaces (the scoreboard's states, the matchup page's provider-driven line, the league home with its commissioner control removed), at 360px and desktop, in light and dark, with the four personas. The commissioner persona is the load-bearing one here: a control they had is gone, and the panel's job is to confirm the page explains *why* rather than just lacking the button. Record findings in the SDD ledger; fix rounds land as follow-up commits on this task.

- [ ] **Step 7: Run everything and commit**

```bash
npm test -- src/league-room
npm test -- src/league-service
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
```

```bash
git add -A src/league-room src/app src/league-service e2e
git commit -m "feat(league-room): three week states, a live score fold, and the manual scoring path retired

Live scoring exists after this plan, so the code that said otherwise is changed rather than left
to contradict the product. The matchup panel's 'never implies live scoring' test is inverted in
its own step so the decision is visible in the diff. The page footer's 'there is no live scoring
yet' is now one sentence chosen by the configured provider, because whether it is true depends on
which provider is running.

The commissioner's Score Week button and its route are deleted. With a feed that finalizes a week
when the games end, manual scoring is not a control, it is the ability to stamp a week the games
have not finished. WeekStatusBadge is the single place a status becomes a badge, so the scoreboard
and the cross-league home cannot disagree about what a week looks like.

useLiveScores drops a frame carrying a stale version. Frames reorder across a reconnect, and a
score that goes backwards on screen reads as a bug at the worst possible moment."
```

---

## Task 9: The cross-league home

Spec Step 8. `/app` already lists the user's leagues; what it does not answer is the question the page exists for, which is *what needs me right now, across all of them*. That answer is a record, this week's matchup with its live or final score, and one next action per league.

**Files:**
- Create: `src/league/next-action.ts`, `src/league/next-action.test.ts`
- Create: `src/league-service/home.ts`, `src/league-service/home.test.ts`
- Create: `src/app/api/home/route.ts`
- Create: `src/league-room/components/home-board.tsx`, `home-board.test.tsx`
- Create: `src/league-room/components/home-league-card.tsx`, `home-league-card.test.tsx`
- Modify: `src/league-room/contract.ts`, `src/league-room/config.ts`
- Modify: `src/app/app/page.tsx`
- Modify: `src/league-service/index.ts`

**Interfaces:**
- Produces: `HomeLeagueCard` and `HomeBody` on `@/league-room/contract`; `crossLeagueHome(db, userId, deps)` from `@/league-service/home`; `nextAction(card): NextAction` from `@/league/next-action` (gated, pure); `GET /api/home`.
- Consumes: `listLeaguesForUser`'s query shape (extended, not duplicated), `computeStandings` from `@/league`, `createScoreCache` (Task 6), `statWeeks` (Task 2), `WeekStatusBadge` (Task 8).

- [ ] **Step 1: Write `nextAction` test-first, in the gated directory**

Pure, total, exhaustive over the union — a gated directory means every branch has a test anyway, so make the union small and the rule readable:

```ts
export type NextActionKind =
  | "join-draft"        // the draft is live and you have a seat in it
  | "open-draft-room"   // scheduled, not started
  | "invite-managers"   // you are the commissioner and seats are empty
  | "set-lineup"        // the week is still scheduled and you have a team
  | "watch-scores"      // the week is in progress
  | "review-week"       // the week is final
  | "none";
```

Precedence is the whole rule and the test names it as such: a live draft beats everything, then an unfilled league for its commissioner, then the week's own state. Copy for each, plain and active, no em-dashes: "Join the draft", "Open the draft room", "Invite managers", "Set your lineup", "Watch the scores", "See how the week went", and for `none` the card simply renders no action rather than a disabled one.

- [ ] **Step 2: Write the failing service test**

`src/league-service/home.test.ts`, real Postgres. The cases:

1. **A user in three leagues of mixed format sees exactly those three** (the spec's own seeded scenario, line 338).
2. **An authorization case: no other user's leagues leak in.** Seed a second user with their own leagues and assert the first user's payload names none of them. The spec calls this out explicitly and it is the one case that matters most.
3. A user in zero leagues gets an empty list and not an error.
4. The record and this week's matchup are correct against a seeded, partially-played season.
5. **A live week's score comes from the cache, and a cache miss still returns the right number.** Both paths, one assertion each.
6. **Query-count discipline: a user in ten leagues costs a bounded number of queries, not thirty.** Same counting-connection device as Task 4. `listLeaguesForUser`'s docblock already commits to this ("a manager in ten leagues must not cost thirty round trips") and this is the query that would break it first.

- [ ] **Step 3: Write `crossLeagueHome`**

One query per table over the league-id set — leagues, teams, drafts, matchups, `stat_weeks` — then `computeStandings` per league over the matchup rows already in hand, then one `MGET` across the score cache for the current weeks. It **extends** `listLeaguesForUser`'s pattern rather than duplicating it; if the two end up sharing more than half their body, extract the shared read and have both call it.

- [ ] **Step 4: Build the route and the board**

`GET /api/home` returns the same `HomeBody` the page server-renders, through the standard envelope, behind `requireCurrentUser()`. `HomeBoard` renders the server's payload immediately and refreshes it on `LEAGUE_ROOM_CONFIG.homeRefreshIntervalMs`, with two conditions that keep it honest and cheap:

```tsx
  // Two guards, both about not being a poll that pretends to be a subscription:
  //
  // 1. Only while the document is VISIBLE. A backgrounded tab refreshing every minute all
  //    Sunday is somebody's battery and our request budget for nothing they can see.
  // 2. Only while at least one league's week is actually in progress. On a Tuesday nothing on
  //    this page can change, so nothing on this page should be asking.
  //
  // This is not a second real-time transport. Redis Streams over SSE remains the one mechanism,
  // and it is where the per-league live surface lives: a manager in ten leagues cannot hold ten
  // SSE connections (REALTIME_CONFIG.maxStreamsPerUser is 8, and each one pins a Redis socket and
  // an fd server-side), so the cross-league view reads a cached summary on an interval and every
  // card links into the league page where the real stream is.
```

The empty state is the one Plan C extends with the onboarding fork, so per the overview's caveat this plan builds it as a plain, correct `EmptyState` and does not design the onboarding content into it.

- [ ] **Step 5: Persona-panel pass**

**CONTROLLER STEP.** A new primary surface, so all four personas at 360px and desktop, both themes. The high-stakes veteran (ten leagues, wants density and the score first) and the first-timer (one league, wants to know what to do) pull this layout in opposite directions and the panel is how that gets resolved rather than guessed. Record findings in the ledger.

- [ ] **Step 6: Run and commit**

```bash
npm test -- src/league
npm test -- src/league-service
npm test -- src/league-room
npm run test:coverage
npm run typecheck && npm run lint && npm run build
```

```bash
git add src/league src/league-service src/league-room src/app
git commit -m "feat(app): the cross-league home answers what needs you right now, in every league

/app already listed leagues. It never answered the question the page exists for. Each card now
carries the record, this week's matchup with its live or final state, and exactly one next action,
whose precedence rule is a pure function in the gated league directory rather than a ladder of
ternaries in JSX.

It refreshes on an interval, only while the tab is visible and only while some week is actually in
progress, and that is deliberately not a second real-time transport: a manager in ten leagues
cannot hold ten SSE connections (the per-user cap is eight and each pins a Redis socket and an fd),
so the cross-league view reads a cached summary and every card links into the league page where
the one real stream lives.

The authorization case is the one that matters: a second user's leagues never appear, asserted
directly rather than implied by the query shape."
```

---

## Task 10: The worker at the edge, its own connection pool, and the e2e proof

Everything above is driven by tests calling `tick()` directly. This is where it runs by itself, and where `DB_POOL_CONFIG.backgroundJobPoolSize` finally has the consumer Plan A's final review named it for.

**Files:**
- Create: `src/stats-pipeline/index.ts`, `src/stats-pipeline/index.test.ts`
- Create: `scripts/ingest-once.ts`
- Modify: `src/instrumentation.ts`
- Modify: `package.json`
- Modify: `docker-compose.yml` (nothing new; confirm nothing is needed and say so in the commit)
- Modify: `e2e/season.spec.ts`

**Interfaces:**
- Consumes: `createIngestionWorker` (Task 5), `createStatsProvider` from `@/stats/registry`, `createDb` and `DB_POOL_CONFIG` from `@/db`, `getSharedRedis` / `createRedisConnection` from `@/lib/realtime/redis`, `getPublisher` from `@/lib/realtime/publisher`.
- Produces: `getIngestionWorker(): IngestionWorker`.

- [ ] **Step 1: Write the failing wiring test**

`src/stats-pipeline/index.test.ts` is small and asserts the two things that can only be got wrong here:

```ts
  it("draws its connections from the background job budget, never from the request path's", () => {
    // Plan A subtracted backgroundJobPoolSize from the connection budget BEFORE dividing by
    // instance count, specifically so a batch job could never borrow from the request path on the
    // busiest day of the week. That arithmetic is only true if the worker actually uses it, and
    // this is the only place it can be made false.
    expect(ingestionPoolOptions()).toEqual({ max: DB_POOL_CONFIG.backgroundJobPoolSize });
  });

  it("is a singleton, so two calls never mint two pools", () => {
    expect(getIngestionWorker()).toBe(getIngestionWorker());
  });
```

`ingestionPoolOptions()` is exported for exactly this reason: the alternative is asserting on a live pool's internals, which would be asserting on `postgres`.

- [ ] **Step 2: Write `index.ts`**

Mirrors `src/draft-service/index.ts` — a module singleton, a system clock at the outermost edge, publishing via `getPublisher()` — with one difference stated in the docblock: it constructs its **own** `createDb(undefined, { max: DB_POOL_CONFIG.backgroundJobPoolSize })` rather than calling `getDb()`, because sharing the request path's pool is precisely the thing the pool formula was written to prevent.

The budget's Redis connection uses `getSharedRedis()` (non-blocking commands only, per that module's own rule).

- [ ] **Step 3: Start it from `src/instrumentation.ts`**

Beside the draft ticker, inside the same `NEXT_RUNTIME === "nodejs"` guard, and — this matters — inside the same `if` block rather than behind an early return, for the bundler reason that file's docblock already explains at length. Add the worker's start and extend the docblock to say why there are now two.

- [ ] **Step 4: Add `npm run stats:ingest`**

`scripts/ingest-once.ts` runs exactly one `tick()` and exits, reporting the outcome and the remaining monthly budget. It is what a developer runs to see the pipeline work without waiting half an hour, and what the founder will run first with a real key. It reuses `getIngestionWorker()` rather than building a second wiring, and it prints the budget so the first thing anyone sees is what a tick cost.

```json
"stats:ingest": "dotenv -e .env.local -- tsx scripts/ingest-once.ts",
```

- [ ] **Step 5: The e2e journey**

Add one spec to `e2e/season.spec.ts` (or a new `e2e/live-scoring.spec.ts` if the season file is getting long — the file is already four tests, so a new file is the better call):

1. `global-setup` seeds with `MOCK_STATS_LIVE_WEEK` set to the seeded season's current week, so the mock reports that week in progress.
2. Manager A opens `/app` and sees a card for the seeded league carrying "In progress" and the "Watch the scores" action.
3. Manager A opens the league page and sees the same state on the scoreboard, and the lineup editor refusing the change with the plain-language locked message.
4. The board's refresh is asserted by its consequence rather than by a timer: assert the `/api/home` request happens (Playwright `waitForRequest`) rather than sleeping for the interval.

The e2e run needs the worker to have ticked. `npm run stats:ingest` runs in `global-setup` after the seed, deterministically, rather than waiting on the interval — a browser test that waits thirty minutes is a browser test nobody runs.

- [ ] **Step 6: Full battery**

```bash
npm run infra:up
npm run db:migrate && npm run db:migrate:test
npm run seed
npm run stats:ingest          # expect: an outcome line and a remaining-budget line
npm test
npm run test:coverage         # UNFILTERED
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
```

- [ ] **Step 7: Commit**

```bash
git add src/stats-pipeline src/instrumentation.ts scripts package.json e2e
git commit -m "feat(stats-pipeline): run the worker at the edge, on its own connection pool

Plan A subtracted backgroundJobPoolSize from the connection budget before dividing by instance
count, precisely so a batch job could never borrow from the request path on the busiest day of
the week. This is the consumer that arithmetic was written for, and it constructs its own pool at
exactly that size rather than calling getDb(): the formula is only true if the worker honors it,
and this is the only place it could be made false.

It starts beside the draft ticker in instrumentation.ts, inside the same nodejs guard and inside
the same if block, for the bundler reason that file already documents.

npm run stats:ingest runs a single tick and prints what it cost, so the first thing anyone sees
with a real key is the request budget rather than a surprise invoice. The e2e journey drives it
that way too: a browser test that waits out a thirty-minute interval is a browser test nobody
runs."
```

---

## Task 11: Docs, the gate, and the closing battery

**Files:**
- Create: `docs/decisions/live-scoring-pipeline.md`
- Modify: `vitest.config.mts`
- Modify: `docs/conventions.md`, `docs/league.md`, `docs/decisions/stats-provider-adapter.md`, `docs/decisions/data-layer-hardening.md`, `README.md`, `.env.example`

- [ ] **Step 1: Add the eighth coverage gate**

`src/stats-pipeline` joins `COVERAGE_GATED_DIRS` **and** gets its own `thresholds` block. Plan A's fix wave found `src/stats` in `include` with no threshold, which is not a gate at all, so both edits land together and the verification is an unfiltered `npm run test:coverage` showing eight directories at 100%.

If any file in the directory cannot reach 100% honestly, do not lower the threshold and do not add an ignore comment: either the untestable part belongs at the edge (move it to `index.ts` and give `index.ts` a real test, as Task 10 does) or the branch is genuinely unreachable and should be deleted.

- [ ] **Step 2: Write `docs/decisions/live-scoring-pipeline.md`**

The spec's own criterion for this document is specific: *"specific enough that swapping `MockStatsProvider` for a real vendor adapter later requires no change to the worker, index, or cache logic."* Sections:

1. **The request-cost contract**, as the table from `provider.ts`, and why the unit of work is a game.
2. **The budget arithmetic**, as the table from Task 3, with the two modes and what each costs per month. This is the section a founder reads before buying a tier.
3. **The unrecognized-status ruling** and why `in_progress` is the safe default.
4. **The delta diff** and the snapshot key.
5. **The affected-roster resolver**: why it is two Postgres indexes and not a maintained map, and both halves of the `getLineup` fallback.
6. **The cache-key scheme**: why the version is in the value.
7. **The two degradation directions**: the score cache fails open, the budget fails closed, and the asymmetry that makes both right.
8. **Idempotence**: absolute values, no dedup table, and where the test that proves it lives.
9. **What a real vendor swap changes**: the `StatsProvider` implementation and its `config.ts`. Nothing else. Say it as a list of what does *not* change, since that is the claim.

- [ ] **Step 3: Correct the drift in the existing docs**

A sweep, not a guess. Grep for every claim this plan made false and fix each:

```bash
grep -rn "no live scoring\|not live\|fixed 2026 stat set\|Score Week\|scoreWeek\|isWeekLocked\|never imply live" docs src e2e README.md
```

Known targets: `docs/conventions.md`'s event-taxonomy section (`score.update` is now published, by the worker), its coverage-gate enumeration (seven becomes eight), `docs/league.md`'s scoring and lock sections, `docs/decisions/stats-provider-adapter.md` (the seam grew two methods and a request-cost contract), `docs/decisions/data-layer-hardening.md` (migration 0013's `CONCURRENTLY` note, and `backgroundJobPoolSize` now has its named consumer — change "Plan B's stats-ingestion worker *will*" to what it *is*), `README.md` (the new scripts and the new env vars).

The em-dash rule binds **user-facing copy**, not engineering prose; these docs already use em-dashes pervasively and consistency with the surrounding text wins. The `.env.example` comments are the exception, because a developer reads those as product copy.

- [ ] **Step 4: The closing battery**

Run all of it, from a clean stack, and paste the output into the SDD ledger:

```bash
npm run infra:down && npm run infra:up
npm run db:migrate && npm run db:migrate:test
npm run seed && npm run stats:ingest
npm test
npm run test:coverage                 # UNFILTERED: eight gated dirs, all 100%
TEST_DATABASE_URL=$TEST_PGBOUNCER_URL npm test    # the whole suite through the pooler
npm run typecheck && npm run lint && npm run build
NEXT_DIST_DIR=.next-e2e npm run build && npm run e2e
npm run e2e                           # twice, back to back, per Plan A's precedent
```

The through-the-pooler run is Plan A's standing exit criterion and this plan adds a new writer, so it is not optional here: the ingestion worker's transaction is the newest thing in the codebase that transaction pooling could break.

- [ ] **Step 5: Commit**

```bash
git add docs vitest.config.mts README.md .env.example
git commit -m "docs: the live-scoring pipeline decision record, the eighth coverage gate, and the drift sweep

The decision doc's own criterion is the spec's: specific enough that a real vendor swap changes
the StatsProvider implementation and nothing else, stated as a list of what does not change since
that is the actual claim. The budget arithmetic is in there as a table, because it is the section
somebody reads before buying an API tier.

src/stats-pipeline joins the gate with BOTH an include entry and a thresholds block. Plan A's fix
wave found src/stats with the first and not the second, which is not a gate, and one instance of
that mistake per phase is enough.

The sweep is a grep and not a guess: every claim this plan made false is fixed, including the
event taxonomy now that score.update has a publisher, the gate count, and the pool doc where
backgroundJobPoolSize stops being described in the future tense."
```

---

## Open questions, self-ruled

Every judgment call this plan makes, numbered, with the reasoning that would have to be wrong for the ruling to be wrong.

1. **The `StatsProvider` extension is `listGames` + `getGameStatLines`, not a single `getWeekSnapshot(week)`.** A snapshot method hides the request count from the caller, and the request count is the entire constraint: 1,000 a month. With a per-game read, the worker can decline to fetch a game it already has, which is what turns 5,960 requests a month into 195. A snapshot API cannot express "fetch everything except these fourteen games".

2. **An unrecognized `gameStatus` maps to `in_progress`.** The three possible defaults are not symmetric. `final` means the game is never fetched again and its points are lost for the season. `scheduled` means it is never fetched at all and the lineup lock never engages. `in_progress` costs exactly one extra request per tick and is correct the moment the spelling is recognized or the game ends. A fixture carrying an invented spelling proves it rather than a comment claiming it.

3. **`getWeeklyStatLines` stays on the interface and becomes a composition of the other two.** Removing it would break `seedPlayers`, which walks weeks upward until it gets an empty array, for no gain. Keeping it as an independent implementation would be two expressions of "week 1's stats" that drift; the contract suite asserts they agree, and the cheapest way to keep them agreeing forever is for one to *be* the other.

4. **The inverted `playerId → rosters` index is two Postgres indexes, not a maintained Redis map.** The spec says "maintained incrementally as rosters change" and a composite index is the most incrementally-maintained structure available: Postgres updates it inside the same transaction as the roster write, with no code to forget and no drift to detect. A Redis map is a second copy of `lineup_slots` that a missed invalidation silently corrupts, and the corruption's symptom is a manager's score quietly not updating, which is the worst kind of bug to find in week 12. The cost of the ruling is one index lookup per tick instead of one Redis read; the `EXPLAIN` gate proves that lookup is a lookup.

5. **The resolver has a roster fallback, not just a lineup lookup.** `getLineup` fields a team's roster when no lineup rows exist for the week, so a lineup-only resolver would silently stop updating the score of every manager who leaves their lineup on the default. That is most managers. The fallback is restricted to teams with nothing saved for the week, so a deliberate benching is not undone by it.

6. **Idempotent re-ingestion comes from the storage model, not a dedup table.** Stat lines are absolute values upserted on `(player_id, week)`, and a week's matchup totals are recomputed from them and overwritten. There is no accumulator anywhere in the write path, so double-counting is unrepresentable rather than guarded against. A dedup table would add a thing to keep correct in exchange for protection against a bug the schema already forbids. The test asserts it on the stored rows across two identical ticks.

7. **A partial-week tick never deletes rows a fuller tick wrote.** "This tick returned fewer players" is indistinguishable from an upstream hiccup, and treating it as a correction would let one bad response erase a Sunday. Removal only ever comes from an explicit absence inside a game the tick actually fetched.

8. **The score cache fails open; the request budget fails closed.** They look inconsistent and are not. A missed cache read costs milliseconds and a page still renders correctly from Postgres, which is Phase 1's standing rule. A miscounted request budget costs the API key, and a suspended key does not come back in five minutes. The asymmetry is between "slower" and "unrecoverable", and each module's docblock names the other so the pairing reads as a decision rather than an oversight.

9. **The score cache's version lives in the value, not in the key.** A version in the key makes lineup-triggered invalidation either a `SCAN` over a pattern (slow, and a pattern scan on a shared Redis is antisocial) or a bet that you know every version ever written. In the value, a read compares and discards and a lineup write is a single `DEL` of a key it can name exactly. The cost is one wasted read per stale entry, which is bounded by the TTL.

10. **`stat_weeks` is global, one row per NFL week, not per league-week.** Finality is a fact about the NFL's games. Phase 1 already conflates league week number with NFL week number — `weeks.week_number` indexes straight into `player_stat_lines.week` — and this table inherits that conflation rather than inventing a mapping the rest of the schema does not have. The phase that runs leagues on offset calendars is the phase that changes it, and it will change more than this table.

11. **The `version` advances only on a tick that changed something.** Advancing it on every tick would invalidate every league's cached score every thirty minutes for nothing, which is the same as not having a cache on the busiest read path in the product.

12. **`finalizeWeek` refuses a league that has not finished its draft.** Without the guard, the first tick against the mock provider (a finished season, every week final) would stamp nil-nil results across every league still waiting to draft, and `computeStandings` would render them as a season of real losses. An undrafted league is not behind on scoring; it has not started.

13. **The commissioner's manual "Score week" button and its route are deleted, not kept as an override.** With a feed that finalizes a week when its games end, a manual score is not a control, it is the ability to stamp a week the games have not finished — in a product about to hold real money. Keeping it "just in case" is the half-state the no-MVP directive rules out. The cost is an e2e edit and a persona-panel round with the commissioner persona, both of which are in Task 8.

14. **The lineup lock moves from "the week was scored" to "the week has started", and a week the worker never reached stays open.** Locking on scores existing was correct when scores only appeared because a human pressed a button and is an integrity hole the moment they move on their own. Locking on the *absence* of a `stat_weeks` row would freeze every league's lineups the first time the worker was down, turning a background-job outage into a product outage. The coarse rule (week-level, not per-player kickoff) errs toward locking early, which costs a manager flexibility and costs nobody money; the per-player version needs a kickoff time the seam does not carry and is a deliberate later refinement.

15. **The cross-league home polls a cached JSON endpoint; it does not open one SSE stream per league.** `REALTIME_CONFIG.maxStreamsPerUser` is 8 and each stream pins a dedicated Redis socket and a file descriptor server-side, so a manager in ten leagues cannot have ten. A per-user stream key would mean fanning every league event out to every member, which at 12-team leagues is a 13× write amplification on the highest-volume path in the product. The poll is a periodic read of a cached summary, not a second real-time transport, and it is gated on document visibility and on some week actually being in progress so it costs nothing on a Tuesday. The per-league live surface still runs on the one mechanism.

16. **`/app` is upgraded rather than a second home built at `/dashboard`.** The spec names `/dashboard` because it was written against a Phase 1 that had no signed-in home. Phase 1 built one at `/app`, `src/middleware.ts` routes to it, and `error.tsx`/`not-found.tsx` both link to it as "Go to your leagues". Adding `/dashboard` would ship two homes and a redirect nobody asked for.

17. **`src/stats-pipeline` joins the coverage gate as the eighth directory, with both an `include` entry and a `thresholds` block.** It is the highest-load path in the product and the one whose bugs are silent (a score that quietly stops updating). Plan A's final review found `src/stats` in `include` with no threshold, which measured nothing; repeating that mistake in the plan that follows it would be hard to explain.

18. **A new client boundary directory is not created.** The home board and its card live in `src/league-room/**`, which already carries the client-boundary lint rule. A `src/home-room/**` would need `eslint.config.mjs` extended, and the content is a list of leagues, which is what the league room is.

19. **The mock provider gains an optional `liveWeek`, defaulting to unset.** Without it the mock is a finished season and the live surfaces are unreachable for anyone without an API key, which would mean the e2e suite could not cover them and a developer could not see them. Defaulting it to unset keeps the mock's behavior byte-identical to what Plan A shipped, so no existing test changes because of it.

20. **`final-only` is the default ingestion mode.** It is what the provider tier that exists today can pay for, and the plan states the arithmetic rather than gesturing at it. `live` is fully built and tested and is one config value away; turning it on is a founder decision about a paid tier, which is Plan D's table, but nothing in this plan waits on that decision because the mock runs either mode for free.

---

## Self-review

**Spec coverage — Step 7, task by task:**

| Spec task (lines 295–303) | Where |
|---|---|
| Dedicated ingestion worker, not inline, configurable cadence (`STATS_POLL_INTERVAL_MS`) | Task 5 (worker), Task 3 (`STATS_INGESTION_CONFIG.pollIntervalMs` + env var), Task 10 (edge) |
| Delta-diff each poll against the prior snapshot in Redis | Task 3 (`digest.ts`), Task 5 (step 4 of the tick) |
| Inverted `playerId → affected rosters`, maintained incrementally, never a leagues × teams scan | Task 2 (the two indexes + EXPLAIN gate), Task 4 (the resolver + the call-count assertion) |
| Batch per league, publish `score.update` through the existing Redis Streams mechanism | Task 5 (one event per league per tick), taxonomy already carries the type |
| Redis computed-score cache keyed by `(leagueId, week, statsVersion)` | Task 6 (version in the value, ruling 9), Task 2 (`stat_weeks.version`) |
| Extend the cache to player data and per-league `ScoringSettings`, write-through invalidation not a blind TTL | Task 6 (`reference-cache.ts`, three invalidation call sites) |
| Multi-tick test: only affected rosters recomputed (call count), cache hits outnumber misses, version bump returns the new value | Task 4 (call count), Task 5 (multi-tick script), Task 6 (hit/miss and stale-version cases) |
| Degradation rule: cache unavailable falls back to Postgres, with a test | Task 6 (every method, ruling 8) |
| `docs/decisions/live-scoring-pipeline.md` | Task 11 |

**Spec coverage — Step 8, task by task:**

| Spec task (lines 333–338) | Where |
|---|---|
| Route behind `requireAuth()`, used as the landing page | Task 9 — `/app`, which is already that route (ruling 16) |
| Every league via owned teams: name, format, standing/record snapshot, next-relevant-action prompt | Task 9 (`crossLeagueHome`, `nextAction`) |
| Zero-leagues case explicit, with a call to action | Task 9 (plain `EmptyState`; Plan C extends it, per the overview's caveat) |
| Link each card into the league's existing views | Task 9 (`home-league-card.tsx`) |
| "Leave league" only if trivial | **Not built.** It is not trivial: leaving mid-season orphans a team's matchups and its roster, which needs domain concepts (forfeit, replacement manager) Phase 1 does not have. The spec explicitly says skip it in that case. Recorded here rather than silently dropped. |
| Seed a test user in ≥ 3 leagues of mixed format | Task 9 (service test case 1) and the existing dev seed, which already produces mixed-format leagues |
| Authorization test: no other user's leagues leak | Task 9 (service test case 2) |

**Plan A's four deferred items:**

| Deferred | Ruled |
|---|---|
| `provider.ts` has no per-game read and no finality flag | Task 1, rulings 1–3 |
| The contract suite must grow to cover it, keeping every-position-present, negative-yardage and listed-players-only | Task 1 step 1 — seven new cases added *after* the existing ones, all of which stay and stay passing; the coverage run in step 8 is the check |
| `backgroundJobPoolSize` has no consumer | Task 10, with a test that asserts the pool size *is* that number |
| Tank01 rate-tier reality must shape the cadence | Task 3's arithmetic table, the two modes, and the budget ledger; ruling 20 |

**Placeholder scan:** no `TODO`, no `TBD`, no "figure out later", no unnamed file, no step whose expected output is unstated. Every file in the File Structure table appears in a task's Files block; every symbol in an Interfaces "Produces" line is consumed by a named later task.

**Type consistency:** `GameStatus` (`@/stats/provider`) and `WeekStatus` (`@/league/week-status`) are the same three-value union and are declared once, with the second re-exporting the first, so a fourth state cannot be added to one and not the other. `TeamScore`/`ScoreUpdatePayload` live in `src/stats-pipeline/contract.ts` and are imported by `src/league-room/**` as **types only**, which the client-boundary rule permits and which stops the wire shape from being written twice. `STAT_FIELDS` moves to `src/domain/player.ts` and is read by both the digest and the contract suite, so a fifteenth stat field cannot be added to the schema without both noticing.

**Boundary check:** nothing under `src/league-room/**` imports `@/db`, `@/stats-pipeline` (as a value), `@/league-service` or `@/lib/realtime`. `src/stats-pipeline/**` imports no React and no `@/league-room/**`. `src/league/**` stays pure and gains only pure modules. No `src/**` file imports `scripts/**` (Plan A's rule).

**Founder rules:** persona panel marked in Tasks 8 and 9, both as controller steps. Every string quoted in this plan for a user-facing surface is em-dash free. `WeekStatusBadge` exists so no page-local status-to-badge mapping does, per the 2026-08-18 correction. Nothing here is built in a shape a later phase plans to replace: the per-game seam is what a licensed vendor plugs into, and the decision doc's job is to say so.
