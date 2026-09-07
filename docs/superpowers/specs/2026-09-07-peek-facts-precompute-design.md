# Peek Facts Precompute

**Status:** approved by the founder 2026-09-07 ("go"), after "The player peek loads incredibly slow, why?" and "Can we create a view?".
**Measured on production, 2026-09-07,** with the exact server function the peek calls (`playerSeason` in `src/league-service/player.ts`):

| Peek for | Time | Queries |
|---|---|---|
| A receiver (Nabers) | 13.8 s | 73 |
| A back (Gibbs) | 15.7 s | 69 |
| A kicker (Aubrey) | 1.8 s | 23 |

Of that, `collectPlayerFacts` (`src/capsules/collect-one.ts`) is 14.9 s and 43 queries. Inside it, `usageTouchesAndTrendFactsFor` is 10.3 s on its own and `lastSeasonStoriesFor` 1.0 s, because both are handed the position's peers from `allPositions(db)`, which is the whole historical universe: 3,293 receivers back to 1999, of whom 228 have a 2025 season. The reads are chunked `IN` lists over `player_week_observations`, 16 of them at about half a second each. And the touches rank comes back EMPTY in production (0 entries) while usage (228) and trend (171) come back populated: the touches reader asks the observation store for `nflverse_player_week` in 2025, a gap season whose lines live under the derived sources, and unlike the other two it does not apply the gap-season substitution (`statLinesAsOfForLiveSurface`). The rest of the 14 s is about fifty further round trips run one after another, several of them whole-table reads made twice (board reasons, universe positions, injuries) and three serial "does a prior season exist" checks.

## 1. Goal

The peek and the full player page open in about a second for any position, with the same facts they show today and with the touches rank actually populated. No fact is fabricated to get there: a fact that has not been computed yet renders as absence, never as a stale or guessed value.

## 2. Why a stored answer and not a view

A plain view is a saved query; the population aggregation would still run per open. The facts that cost the time are about last season (immutable once it ends) and about this season's played weeks (they change once a week, when stats finalize). Those are the two moments the job system already fires on. So the answer is computed by a job and stored per player, with as-of and computed-at stamps the point-in-time discipline needs and a materialized refresh cannot carry per row, refreshable per position and season rather than all or nothing. The job system is the owned, Postgres-backed one that runs on Vercel ([[job-system-owned-postgres]]); nothing here is a cron or an interval.

## 3. Design

### 3.1 The table: `player_peek_facts`

One row per (product player id, season, as_of). Columns, all nullable except the keys and stamps:

- `touches_rank`, `touches_qualifier_count`, `usage` (JSON, the `PlayerFactsUsage` shape), `trend` (JSON), `last_season_story` (JSON, the `PlayerFactsLastSeasonStory` shape without the rank fields duplicated), `per_game_rank` facts (the `boardWidePerGameFacts` shape), `prior_seasons_held` (int[]; which of the three prior seasons the observation store, or the kicker and defense archive, holds a week for), `last_season_line` (JSON: points, games, points per game under PPR, the league-agnostic basis; the league-scored figure stays a live computation because it depends on the caller's league).
- `basis` (JSON): the source keys and the peer population size each fact was computed against, so the peek can name them.
- `as_of`, `computed_at`, `source` (`peek_facts_v1`).

Point-in-time reads keep working: the peek reads the latest row with `as_of <= now`, the same shape every reader in the engine uses.

### 3.2 The writer

`collectAllPlayerFacts` (`src/capsules/collect.ts`) already computes the color facts for the whole board every night in the capsule sweep. It becomes the writer: the same pass persists one `player_peek_facts` row per board player. No second heavy job. Two triggers:

- The nightly capsule sweep (already scheduled).
- After weekly stats finalize (`season-week-job`), for the current season's facts only.

Both idempotent: the same inputs write the same row (COALESCE upsert on the natural key, changed-row counting, the pattern every ingester uses).

### 3.3 The population

Peers are the ACTIVE population, not the historical universe: players who hold a row in the current board generation, or a 2025 or 2026 stat line, at that position. `allPositions(db)` stays what it is for the backtest; the collector gets a `activePeersFor(db, position, season)` reader and uses it. Qualifier counts in the stored facts reflect the population actually ranked, and the basis names it.

### 3.4 The touches-rank fix

The touches reader applies the same gap-season substitution the usage and story readers apply, so 2025 (and any season in `STAT_LINE_GAPS`) reads the derived lines. A test pins a gap season producing a non-empty rank, and the writer refuses to store a rank computed against an empty line set (absence, with the reason in `basis`).

### 3.5 The peek

`playerSeason` reads one `player_peek_facts` row and stops calling `collectPlayerFacts` at request time. The remaining reads are parallelized and de-duplicated: board reasons once, universe positions never (the row carries what the peek needs), injuries once, the three prior-season checks replaced by `prior_seasons_held`, `everyone` narrowed to the position's peers for the percentile. Target for a skill player: at most eight queries and under 1.5 s against the dev database with production-shaped data; the timing harness that measured the table above is committed as `scripts/peek-timing.ts` and the numbers are recorded in the plan's ledger before and after.

A player with no row (new signing, or a fresh deploy before the first sweep) renders the facts as absent with the existing absence copy. The peek never computes the population at request time again.

### 3.6 Copy and honesty

Every stored number carries its basis in the row and the surfaces already name bases. No em-dashes, no semicolons, no competitor names, no tips. Functions under 50 lines, files under 800, immutability, no `any`.

## 4. Non-goals

- Changing what the capsule (the Read) says or when it is generated.
- Changing the projection engine, the board, or the register.
- A materialized view. If a later round wants one for a read-only analytics surface, this table is its source.

## 5. Testing

- Writer: one sweep writes one row per board player; a second sweep writes zero changed rows; the current-season trigger touches only current-season rows.
- Population: a fixture with a retired receiver and an active one asserts the retired one is not a peer.
- Touches rank on a gap season: non-empty, and the empty-line refusal path.
- Peek: reads the row, renders absence with no row, query count asserted with a counting client in the test (the harness pattern), parity test that the rendered facts for a fixture player equal what the live computation produced before the change.
- Gates: tsc, eslint, targeted vitest, design guards.

## 6. Production rollout

Deploy (migration in the build), then run the capsule sweep once by hand so every board player has a row before anyone opens a peek, then confirm the timing harness against production reads under 1.5 s for the three players in the table above.
