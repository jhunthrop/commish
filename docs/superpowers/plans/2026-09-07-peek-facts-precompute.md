# Peek Facts Precompute — implementation plan

**Spec:** `docs/superpowers/specs/2026-09-07-peek-facts-precompute-design.md` (approved by the founder 2026-09-07, "go").
**Branch:** this worktree, off `main` at `346d35c`.
**Ledger:** `.superpowers/sdd/peek-facts/progress.md` (gitignored), one line per task and every ruling.

## Global Constraints (copied from the spec)

- Honest data is absolute. A fact that has not been computed yet renders as ABSENCE, never as a stale
  or guessed value. Every stored number carries its basis (source keys, peer population size) in the
  row.
- Point-in-time. Rows carry `as_of` and `computed_at`. The peek reads the latest row with
  `as_of <= now`, the same shape every reader in the engine uses.
- The writer REFUSES to store a touches rank computed against an empty line set. It stores absence
  with the reason in `basis`.
- Never a parallel system. The writer is the existing capsule pass. The peers reader is one function.
  The substitution is the existing one.
- The population is the ACTIVE population, not the historical universe: players who hold a row in the
  current board generation, or a stat line in the current or prior season, at that position.
  `allPositions(db)` stays what it is for the backtest.
- Copy: no em-dashes, no semicolons, no competitor names, no tips.
- Code: functions under 50 lines, files under 800 lines, immutability, explicit errors, no `any`.
- Non-goals: what the capsule says or when it is generated, the projection engine, the board, the
  register, a materialized view.
- Targets: at most eight queries and under 1.5 s for a skill player's peek, measured by
  `scripts/peek-timing.ts` against the dev database, before and after, recorded in the ledger.

## Gates (every task)

```
npx tsc --noEmit -p .
npx eslint <touched dirs>
npx vitest run <touched test files>
```
plus `npm run db:migrate:test` once, after the migration exists.

Known pre-existing failures on `main` that this round does not own and does not fix: trade-routes,
trades/page, activity/page, league-rules/page, join hold confirm, public-footer, reading-frame,
account-room/*, admin-room/*, chat-room/*, integrity/*, and
`projections/decide/replay.test.ts` "shuffling it changes no pick".

---

## Task 1 — The timing harness

**Files**
- new `scripts/peek-timing.ts`

**Interfaces**

```ts
interface PeekTiming {
  readonly playerId: string;
  readonly label: string;
  readonly pass: "cold" | "warm";
  readonly milliseconds: number;
  readonly queries: number;
}
```

The script takes a league id and one or more product player ids as positional arguments, opens its
own `postgres` client with a `debug` counter, wraps it in `drizzle(client, { schema })`, and calls
`playerSeason` twice per player (cold then warm). It prints one line per pass: player name, position,
milliseconds, query count. It never writes.

**Steps**
1. Write the script. There is no unit test for a measurement harness: its output IS its assertion,
   and a test that mocked the database would be measuring the mock. The script fails loudly on a
   missing argument or an unknown league or player rather than measuring nothing.
2. Run it on the dev database for a receiver, a back and a kicker. Record the numbers in the ledger
   under "before".
3. `git commit -m "feat(scripts): peek timing harness, time and query count per playerSeason call"`

---

## Task 2 — `activePeersFor` and the touches gap-season fix

**Files**
- `src/projections/nflverse/derived-stat-lines.ts` (extract the live-surface predicate)
- `src/projections/laws/populations.ts` (`seasonParticipation` gap fill)
- new `src/capsules/peers.ts` (`activePeersFor`)
- new `src/capsules/peers.test.ts`
- `src/projections/laws/populations.test.ts` (or a new gap-season test beside it)

**Interfaces**

```ts
/** Whether a live product surface may read derived rows for this season — the one predicate
 *  `statLinesAsOfForLiveSurface` and the participation gap fill both ask. */
export function admitsDerivedForLiveSurface(season: number): boolean;

/** The ACTIVE population at one position: every nflverse player id that either holds a row in the
 *  board generation for `season` or a stat line in `season` or `season - 1`, mapped to his
 *  position. Never the historical universe. */
export async function activePeersFor(db: ReadonlyDb, position: Position, season: number): Promise<ReadonlyMap<string, Position>>;
```

**TDD steps**

1. RED — `src/capsules/peers.test.ts`: seed one receiver with a 2025 stat line and one receiver whose
   only lines are 2016, plus a back with a 2025 line. Assert `activePeersFor(db, "WR", 2026)` holds
   the active receiver and not the retired one and not the back.

```ts
it("leaves a retired receiver out of the active population", async () => {
  const peers = await activePeersFor(db, "WR", PRODUCT_SEASON);
  expect([...peers.keys()]).toEqual(["wr-active"]);
});
```

2. GREEN — implement `activePeersFor` as one union read over `preseason_projections` (the current
   board generation) and `player_week_observations` (the current and prior season), narrowed to the
   position by a join on `nfl_players.position`.
3. RED — a gap-season touches test: seed a 2025 season with `nflverse_pbp_derived` stat lines and
   `nflverse_pbp_player` `pbp_carries`, no `nflverse_player_week` rows at all, and assert
   `usageTouchesAndTrendFactsFor` returns a NON-EMPTY `touchesRankByPlayerId`.
4. GREEN — `seasonParticipation` falls back to the play-by-play participation feed for exactly the
   seasons `admitsDerivedForLiveSurface` admits, and only for players the published read did not
   place. A published row always wins, the same rule `statLinesAsOfForLiveSurface` keeps.
5. RED — a non-gap season keeps reading published participation only, and 2019 (a gap season outside
   the live allowlist) is unchanged.
6. `git commit -m "fix(projections): touches reads the pbp participation feed on a live gap season"`

**Ruling recorded in the ledger:** the gap fill is the pbp participation feed rather than a derived
stat line, because `carries` is deliberately outside `STAT_FIELDS` and `nflverse_pbp_derived`
therefore carries none. It is gated on the live-surface predicate so the laws harness's 2019
measurements do not move.

---

## Task 3 — The table, the schema and the migration

**Files**
- `src/db/schema.ts` (`playerPeekFacts`)
- new `drizzle/0081_*.sql` (generated, never hand-numbered; `drizzle/meta/_journal.json` latest is 0080)

**Interfaces**

```ts
export const playerPeekFacts = pgTable(
  "player_peek_facts",
  {
    playerId: text("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
    season: integer("season").notNull(),
    /** The full `PlayerDossierFacts` the peek renders, one source of truth. */
    dossier: jsonb("dossier").notNull(),
    /** Promoted out of `dossier` so the refusal is queryable. Written by one function with it. */
    touchesRank: integer("touches_rank"),
    touchesQualifierCount: integer("touches_qualifier_count"),
    priorSeasonsHeld: integer("prior_seasons_held").array().notNull(),
    lastSeasonLine: jsonb("last_season_line"),
    basis: jsonb("basis").notNull(),
    asOf: timestamp("as_of", { withTimezone: true }).notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    source: text("source").notNull(),
  },
  (t) => [
    uniqueIndex("player_peek_facts_fact_idx").on(t.playerId, t.season, t.asOf),
    index("player_peek_facts_as_of_idx").on(t.playerId, t.season, t.asOf),
  ],
);
```

**Steps**
1. Add the table with full docblocks: what each column is, why `dossier` is one blob and
   `touches_rank` is a promoted projection of it, why `as_of` is never `defaultNow()`.
2. `npx drizzle-kit generate` and read the produced SQL before committing it.
3. `npm run db:migrate:test` once, five minute cap.
4. `git commit -m "feat(db): player_peek_facts, one precomputed peek row per player and season"`

---

## Task 4 — The writer

**Files**
- new `src/capsules/peek-facts.ts` (`peekFactsRowFor`, `writePeekFacts`, `readPeekFacts`)
- `src/capsules/collect.ts` (`collectAllPlayerFacts` yields what the writer needs)
- `src/jobs/defs/capsule-sweep-job.ts` (the sweep writes the rows)
- `src/jobs/defs/season-week-job.ts` (a post-finalize step for the current season)
- new `src/capsules/peek-facts.test.ts`
- `src/jobs/defs/capsule-sweep-job.test.ts`, `src/jobs/defs/season-week-job.test.ts`

**Interfaces**

```ts
export const PEEK_FACTS_SOURCE = "peek_facts_v1";

export interface PeekFactsBasis {
  /** Every source key each stored number was computed against. */
  readonly sourceKeys: readonly string[];
  /** How many peers the ranks were taken over, per ranked quantity. */
  readonly peerPopulation: Readonly<Record<string, number>>;
  /** Why a fact is absent, when it is. Empty when nothing was refused. */
  readonly refusals: readonly string[];
}

export interface PeekFactsRow {
  readonly playerId: string;
  readonly season: number;
  readonly dossier: PlayerDossierFacts;
  readonly touchesRank: number | null;
  readonly touchesQualifierCount: number | null;
  readonly priorSeasonsHeld: readonly number[];
  readonly lastSeasonLine: PeekLastSeasonLine | null;
  readonly basis: PeekFactsBasis;
  readonly asOf: Date;
}

/** Upserts on the natural key with `excludedSetFor` / `changedRowWhere`, returning how many rows
 *  actually changed. A second identical pass changes zero. */
export async function writePeekFacts(db: Db, rows: readonly PeekFactsRow[]): Promise<number>;

/** The latest row with `as_of <= asOf`, or `null`. */
export async function readPeekFacts(db: ReadonlyDb, playerId: string, season: number, asOf: Date): Promise<PeekFactsRow | null>;
```

**TDD steps**

1. RED — one sweep writes one row per board player.
```ts
it("writes one row per board player", async () => {
  await runCapsuleSweepStep(db, clock, deps, {});
  const rows = await db.select().from(playerPeekFacts);
  expect(rows).toHaveLength(2);
});
```
2. GREEN — build the row inside the sweep from the same pass `collectAllPlayerFacts` already runs.
3. RED — a second sweep at the same `as_of` writes zero changed rows.
4. GREEN — `changedRowWhere` on the upsert, count the `RETURNING` rows.
5. RED — the writer refuses a touches rank computed against an empty line set: `touches_rank` is
   null and `basis.refusals` names the reason.
6. RED — the season-week trigger touches only the current season's rows.
7. GREEN — a `peek-facts` step at the end of `season-week-job`, after `scoreboard`.
8. `git commit -m "feat(capsules): the capsule pass writes player_peek_facts, sweep and post-finalize"`

---

## Task 5 — The peek reads the row

**Files**
- `src/league-service/player.ts`
- `src/league-service/dossier-facts.ts` (a read-the-row path beside the live computation)
- `src/league-service/player.peek-facts.test.ts` (new: query count and parity)

**TDD steps**
1. RED — a counting client asserts the query count for a skill player's `playerSeason` is at or below
   the ceiling this task lands on, and that `collectPlayerFacts` is never called.
2. RED — parity: the `dossier` a fixture player renders from the row equals what the live computation
   produced for the same fixture before the change (a golden object captured in the test).
3. RED — a player with no row renders `dossier: null` and every other field unchanged.
4. GREEN — `playerSeason` reads `readPeekFacts` once, drops `dossierFactsFor` from the request path,
   replaces the three serial `priorSeasonHasData` calls with the row's `prior_seasons_held`, reads
   board reasons once, injuries once, and runs the remaining independent reads in one `Promise.all`.
5. `git commit -m "perf(peek): playerSeason reads one precomputed row, remaining reads parallelized"`

---

## Task 6 — After numbers and gates

**Steps**
1. Re-run `scripts/peek-timing.ts` for the same three players. Record "after" in the ledger.
2. Full gates: `npx tsc --noEmit -p .`, `npx eslint src scripts`, targeted vitest over every touched
   suite.
3. `git commit -m "chore(peek): after numbers and gate run"` if anything moved.
