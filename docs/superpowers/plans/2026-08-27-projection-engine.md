# Projection Engine — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the foundation the whole engine rests on — a point-in-time store, nflverse ingestion, opportunity features, and a working backtest that can score the naive benchmark. Phase 1 ends when we can answer, with evidence, "does last season's points-per-game beat guessing, and by how much, in each rank band." No model ships in this phase. The harness does.

**Spec:** `docs/design/2026-08-27-projection-engine-spec.md` (written alongside this plan; the artifact at `claude.ai/code/artifact/9043f065-7d9e-4ef2-8df3-0db25caef467` is its rendered form). Read the spec first — it carries the layer model and the reasoning this plan only executes.

**Architecture:** Four modules under `src/projections/`. `metrics.ts` already landed (commit `08cc768`) and is the contract everything scores against. Ingestion is an injectable client on the exact shape `src/stats/tank01/client.ts` established, so tests never touch the network. Features are pure functions over stored rows. The store is Postgres with an `as_of` stamp on every row — the one thing that cannot be retrofitted.

**Tech Stack:** as the repo. Branch `worktree-projection-engine` (from main @ `08cc768`), worktree `.claude/worktrees/projection-engine`. No e2e in this phase — do not start a Playwright server.

## Global Constraints

- **Point-in-time or it is worthless.** Every stored observation carries `as_of` — the moment that fact became knowable. A backtest replaying week 7 must be unable to see a row stamped later. This is the single most important constraint in the plan; a feature that violates it makes every downstream measurement dishonest.
- **`StatLine` and `computeFantasyPoints` already exist** (`src/domain/player.ts`, `src/scoring/compute.ts`). A projection is a predicted `StatLine`. Do NOT introduce a parallel component type.
- Metrics come from `src/projections/metrics.ts`. Do not write a second correlation or error function anywhere.
- Migration process law: applied migrations are never amended; journal `when` monotonic; generate with `npx dotenv -e .env.local -- npx drizzle-kit generate --name=<name>` (schema-derived, NOT `--custom`).
- No network in tests. Ingestion clients are injected; fixtures live beside their mapper, in the `src/stats/tank01/fixtures.ts` shape.
- Never touch `/Users/jh/code/fantasy`'s working tree. Stage explicit paths.
- nflverse is ingested into our own store and never called at runtime by a product surface — it is a community project, and a draft-week feature may not depend on it being up.

---

### Task 1: The point-in-time store

**Files:**
- Modify: `src/db/schema.ts` — add `playerWeekObservations` (id, season, week, playerId, source, metric, value, asOf, ingestedAt) and `playerWeekSnapshots` if a wide row proves cleaner after reading the existing schema style. Prefer the narrow/tall shape: metrics arrive from different sources at different times, and a wide row forces a write to know every column at once.
- Create: `drizzle/00XX_projection_observations.sql` (generated, not hand-written)
- Create: `src/projections/store.ts` + `src/projections/store.test.ts`
- Test DB: run `npm run db:migrate` and `db:migrate:test`

**Interfaces:**
- Produces: `recordObservations(db, rows)`, and `observationsAsOf(db, { season, week, asOf })` — the reader every backtest goes through. It MUST filter `as_of <= asOf`; that predicate is the leakage defence and deserves its own test.
- Consumes: `Db` from `@/db/client`.

- [ ] **Step 1: Write the failing test** — `store.test.ts` against a real test DB (the `createTestDb` idiom every service test uses). The load-bearing case: write one observation stamped Tuesday and one stamped Sunday; read as-of Wednesday; only the Tuesday row comes back.
- [ ] **Step 2: Run it, watch it fail** for the right reason (no table).
- [ ] **Step 3: Schema, generated migration, `store.ts`.** Index on `(season, week, as_of)` — the backtest scans this range on every replayed week and will be the hottest read in the system.
- [ ] **Step 4: Green.** Battery: `npx vitest run src/projections src/db` + `npx tsc --noEmit` + `npx eslint src/projections src/db`
- [ ] **Step 5: Commit** `feat(projections): a point-in-time observation store — as-of is the leakage defence`

### Task 2: nflverse ingestion

**Files:**
- Create: `src/projections/nflverse/client.ts` (injectable fetcher, `src/stats/tank01/client.ts` shape — read it first and copy its failure taxonomy), `src/projections/nflverse/map.ts`, `src/projections/nflverse/fixtures.ts`, plus `.test.ts` for each
- Modify: `src/projections/store.ts` only if the mapper reveals a missing field

**Interfaces:**
- Consumes: nflverse release files. Start with **participation and snap counts only** — the one dataset Tank01 cannot supply and the reason this module exists. Play-by-play is a later task; do not ingest it here.
- Produces: `PlayerWeekParticipation { playerId, season, week, offensiveSnaps, teamOffensiveSnaps, routesRun | null, targets }` mapped into observations.

- [ ] **Step 1: Failing mapper test** over a real-shaped fixture (capture one real row's shape by hand into `fixtures.ts`; do not fetch in the test).
- [ ] **Step 2: RED**, for the right reason.
- [ ] **Step 3: Implement** client + mapper. Player identity is the hazard: nflverse uses its own player ids (`gsis_id`). Write the crosswalk to our `players` table now — name+team+position match with an explicit unresolved list, never a silent drop. An unmatched player must be *reported*, because silently missing players look exactly like a player who did not play.
- [ ] **Step 4: Green.** Battery as Task 1, plus `src/stats`.
- [ ] **Step 5: Commit** `feat(projections): nflverse participation ingestion — the denominator Tank01 cannot give us`

### Task 3: Opportunity features

**Files:**
- Create: `src/projections/features/opportunity.ts` + test

**Interfaces:**
- Consumes: observations from Task 1.
- Produces: pure functions — `snapShare(playerSnaps, teamSnaps)`, `targetShare(playerTargets, teamTargets)`, `targetsPerRouteRun(targets, routes)`, and a `rollingOpportunity(history, window)` that weights recent weeks more heavily.

- [ ] **Step 1: Failing tests.** Include the division-by-zero cases explicitly — a player on a team with zero pass attempts is real (weather games happen), and `0/0` must answer null rather than NaN. Follow `metrics.ts`'s existing "null is not zero" discipline and say so in the docblock.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** Pure, no I/O, no dates.
- [ ] **Step 4: Green + battery.**
- [ ] **Step 5: Commit** `feat(projections): opportunity features — share, not count`

### Task 4: The backtest and the naive benchmark

**Files:**
- Create: `src/projections/backtest.ts` + test, `src/projections/benchmarks/naive.ts` + test

**Interfaces:**
- Consumes: `observationsAsOf` (Task 1), `scoreCard`/`rankBandFor` (`metrics.ts`).
- Produces: `naiveProjection(history, { season, week })` — last season's points per game, the floor every future model must clear; and `replay(db, { season, weeks, source })` returning a `ScoreCard` per week AND per rank band.

- [ ] **Step 1: Failing test.** The important one is not the arithmetic — it is that `replay` cannot see the future. Seed observations stamped after the replayed week and assert they never reach the projection. This test is the reason the whole phase exists.
- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement.** `replay` walks weeks in order, calls the source with only as-of data, scores against actuals.
- [ ] **Step 4: Green + full battery** `npx vitest run` (whole repo) + tsc + eslint.
- [ ] **Step 5: Commit** `feat(projections): backtest replay and the naive benchmark — the floor everything must clear`

### Task 5: Report the first result

**Files:**
- Create: `scripts/projection-report.ts` (the `scripts/` conventions — `dotenv -e .env.local`, fail fast on missing env)
- Create: `docs/research/2026-08-27-naive-baseline.md` — the actual numbers

- [ ] **Step 1:** Script prints a `ScoreCard` per rank band for the naive benchmark over the most recent complete season available in the store.
- [ ] **Step 2:** Run it. Write the numbers into the research doc, including sample sizes.
- [ ] **Step 3: Commit** `docs(projections): the naive baseline, measured`

## Self-review notes for the executor

- If Task 2's crosswalk resolves under ~90% of skill-position players, STOP and report rather than proceeding — a bad join silently poisons every downstream number, and it is far cheaper to fix at the boundary.
- Phase 1 ships no model and no product surface. If you find yourself editing `src/draft-room/**`, you have left the plan.
