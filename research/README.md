# research

The Python research lane (spec `docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md`
§2.3). Phase A is here: every ingest the TypeScript core runs, ported, the research schema owned by
alembic, and the parity harness that proves each port row for row against the TypeScript on the
same recorded input. Phases B to D (`model`, `capsules`, `advisor`, `nightly`) are empty packages
whose docstrings say what lands in them.

## Running

```sh
cd research
uv sync
uv run ruff check . && uv run ruff format --check . && uv run mypy -p research && uv run pytest -q

# one ingest, against DATABASE_URL, over the live network (provider keys from the environment)
uv run python -m research.pipeline season --first 2026 --last 2026
uv run python -m research.pipeline coaches --check          # validate a committed seed, write nothing

# the schema: alembic owns the research tables from here
DATABASE_URL=... uv run alembic stamp 0001_baseline         # once, on a database drizzle built (dev, prod)
DATABASE_URL=... uv run alembic upgrade head                # then, and on any fresh database

# parity (needs a Postgres where it may create parity_* databases, and the root node_modules)
export PARITY_DATABASE_URL=postgres://commish:commish@localhost:5433/commish_test
uv run python -m research.parity schema                     # alembic vs drizzle, catalog for catalog
uv run python -m research.parity schema --against $DEV_URL  # plus a live database, read only
uv run python -m research.parity ingest all                 # every ingest, recorded inputs
uv run python -m research.parity record <fixture-set> --env-file ../.env.local   # re-record from the provider
```

## Layout

| Path | What |
|---|---|
| `pipeline/http.py` | the HTTP boundary: a `Fetcher` protocol, httpx live; every ingest reaches a provider only through it |
| `pipeline/jscompat.py` | JavaScript's semantics where a port must reproduce them: `Number()`, `trim`, `localeCompare`, `Date` parsing, `JSON.stringify`, a left-fold sum |
| `pipeline/nflverse/` | the nflverse client and strict CSV reader, the universe, seasons, schedule, play-by-play, coaches observations, opponent adjustment, injuries (features and archive), rosters, draft picks, kicking and defense weeks, derived stat lines |
| `pipeline/tank01/` | the stats provider's client, mappers, provider, roster and box scores, fixtures, ADP, headshots, the capture archive |
| `pipeline/odds/` | player props: the strict parser, snapshot, name resolution, historical backfill |
| `pipeline/preseason/` | week-one rosters and depth charts, the published boards, the nightly ADP capture |
| `pipeline/coaches.py`, `crosswalk.py`, `vegas.py` | the play-caller seed, the two id spaces joined, win totals |
| `db/schema.py`, `alembic/` | the 29 research tables; `0001_baseline` equals drizzle's catalog, `0002` adds `register_freeze_rows.implementation` |
| `parity/` | the harness: scratch databases, replay, recording, the row diff, the cases, the TypeScript driver in `parity/ts/` |
| `JOBS.md` | every job and operator ingest, its schedule today, its Python destination |

## Ingests

| Ingest (`python -m research.pipeline`) | Source | Tables written |
|---|---|---|
| `universe` | nflverse `players` release | `nfl_players` |
| `season` | nflverse snap counts, weekly stats, `games.csv` | `player_week_observations`, `player_week_teams`, `team_week_observations` |
| `schedule` (and the results, points-allowed narrowings) | nflverse `games.csv` | `team_week_observations` |
| `context` | play-by-play, `games.csv`, injuries, weekly rosters, the `coaches` table | `team_week_observations`, `player_week_observations`, `nflverse_injuries`, `nflverse_roster_weeks` |
| `derived-stat-lines` | play-by-play (gap seasons) | `player_week_observations` |
| `draft-picks` | nflverse `draft_picks` | `nfl_draft_picks` |
| `kdef` | nflverse `stats_player`, `stats_team`, `games.csv` | `nfl_players` (32 synthetic defenses), `nflverse_kicking_weeks`, `nflverse_team_defense_weeks` |
| `coaches` | the committed play-caller CSV (seed) | `coaches` |
| `tank01-roster`, `tank01-schedule`, `tank01-adp`, `headshots` | Tank01 | `players`, `player_stat_lines`, `nfl_games` |
| `capture-harvest` (and `capture_once` with every feed) | Tank01 | `capture_snapshots` |
| `crosswalk` | `players` and `nfl_players` | `player_crosswalk` |
| `preseason`, `adp-snapshot`, `current-ecr` | nflverse rosters and depth charts, Fantasy Football Calculator, FantasyPros | `preseason_rosters`, `player_week_observations`, `preseason_rankings`, `adp_snapshots` |
| `props-snapshot`, `props-resolve`, `props-backfill` | The Odds API | `player_prop_observations`, `props_player_map` |
| `win-totals-seed`, `win-totals` | the committed CSV (seed), the publisher's file | `team_week_observations` |

## Parity results

Run 2026-10-12 against the recorded fixtures (`parity/fixtures/`, 17 MB gzipped, every response
recorded from the live provider, a large CSV narrowed by rows kept byte for byte with the filter
stated in its manifest). Every column of every row is compared except a surrogate serial `id` and
a timestamp Postgres fills with `now()` that neither side writes. No float tolerances are used:
every compared value is equal to the bit. A case also fails if its two sides asked for different
recordings or if it compared no rows.

**Schema gate:** 748 catalog facts (columns, defaults, constraints, indexes, enums, sequences) equal
between drizzle at `0089` and alembic at `0001_baseline`; at head the only difference is the
`implementation` column; the dev database (a copy of production) equals the baseline, 748 of 748.

**Ingests: 30 cases, 30 matching, 498,052 rows compared, 0 differences.**

| Case | Tables (rows compared) | Differences |
|---|---|---|
| nflverse-universe | nfl_players 24,853 | 0 |
| nflverse-season-2024 | nfl_players 24,853; player_week_observations 151,240; player_week_teams 7,551; team_week_observations 1,056 | 0 |
| nflverse-season-2012 (below the snap-count floor) | nfl_players 24,853; player_week_observations 10,696; player_week_teams 764; team_week_observations 0 | 0 |
| nflverse-season-2025 (gap season) | nfl_players 24,853; player_week_observations 1,954; player_week_teams 977; team_week_observations 132 | 0 |
| nflverse-schedule | team_week_observations 20,272 | 0 |
| nflverse-game-results | team_week_observations 1,788 | 0 |
| nflverse-points-allowed | team_week_observations 1,788 | 0 |
| nflverse-injury-reports | nfl_players 24,853; player_week_observations 3,574 | 0 |
| nflverse-injury-archive | nflverse_injuries 11,735 | 0 |
| nflverse-roster-weeks | nflverse_roster_weeks 11,028 | 0 |
| nflverse-draft-picks | nfl_draft_picks 11,081 | 0 |
| nflverse-kdef | nfl_players 24,885; nflverse_kicking_weeks 1,086; nflverse_team_defense_weeks 1,088 | 0 |
| coaches-seed | coaches 944 | 0 |
| nflverse-context | team_week_observations 16,132; player_week_observations 10,080; coaches 944 | 0 |
| nflverse-derived-stat-lines | player_week_observations 9,212 | 0 |
| tank01-roster-and-lines | players 1,373; player_stat_lines 944 | 0 |
| tank01-schedule | nfl_games 272 | 0 |
| tank01-adp | players 1,373 | 0 |
| tank01-headshots | players 1,373 | 0 |
| crosswalk | nfl_players 24,885; players 1,373; player_crosswalk 1,373 | 0 |
| tank01-capture-all | capture_snapshots 11 | 0 |
| tank01-capture-harvest | capture_snapshots 5 | 0 |
| preseason-2025 | preseason_rosters 363; player_week_observations 73; preseason_rankings 230 | 0 |
| preseason-2026-live | preseason_rosters 341; player_week_observations 109; preseason_rankings 127 | 0 |
| adp-snapshot | preseason_rosters 341; adp_snapshots 36 | 0 |
| current-ecr | player_crosswalk 1,373; preseason_rankings 545 | 0 |
| odds-snapshot-and-resolve | nfl_players 24,853; player_prop_observations 551; props_player_map 59 | 0 |
| odds-backfill | team_week_observations 5,604; player_prop_observations 209 | 0 |
| win-totals-seed | team_week_observations 2,304 | 0 |
| win-totals-job | team_week_observations 3,680 | 0 |

The harness was checked against itself: with one Python constant changed on purpose (four line
starters instead of five), `nflverse-season-2024` reported every line-continuity row that moved and
failed.
