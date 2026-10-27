# research

The Python research lane (spec `docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md`
§2.3). Phase A is here: every ingest the TypeScript core runs, ported; the `research` schema,
designed from scratch for the prep site and owned by alembic; the one-shot loader that carries the
legacy tables' data into it; and the parity harness that proves each port row for row against the
TypeScript on the same recorded input. Phase B is `model`: the preseason board, the market blend,
the laws, the register and the backtest, proven against the oracle on the dev store (see "The
model"). Phase C is `model/decide` (survival, the recommendation, tiers, lineup, outlook), the
advisor service (`advisor`) and the capsule writer (`capsules`), see "The decide layer, the advisor
and the capsules". Phase D is the nightly run, the in-season jobs and the history rebuild, see "The nightly run, the in-season jobs and the history rebuild".

## Running

```sh
cd research
uv sync
uv run ruff check . && uv run ruff format --check . && uv run mypy -p research && uv run pytest -q
uv run mypy alembic/env.py alembic/versions

# the schema: revision 1 is the whole research schema; the env creates the schema itself
RESEARCH_DATABASE_URL=... uv run alembic upgrade head

# the one-shot copy of the legacy tables (source opened read only; --replace truncates first)
LEGACY_DATABASE_URL=... RESEARCH_DATABASE_URL=... uv run python -m research.load_legacy

# one ingest, into RESEARCH_DATABASE_URL, over the live network (provider keys from the environment)
uv run python -m research.pipeline season --first 2026 --last 2026
uv run python -m research.pipeline coaches --check          # validate a committed seed, write nothing

# parity (needs a Postgres where it may create parity_* databases, and the root node_modules)
# the URL's database names the scratch family: parity_<that name>__* (see Scratch databases below)
export PARITY_DATABASE_URL=postgres://commish:commish@localhost:5433/commish_test
uv run python -m research.parity schema                     # migrations vs declared schema, the legacy map
uv run python -m research.parity schema --against $URL      # plus a live research schema, read only
uv run python -m research.parity ingest all                 # every ingest, recorded inputs, every pass
uv run python -m research.parity record <fixture-set> --env-file ../.env.local   # re-record from the provider
```

Databases. Production is the Cloud SQL database `commish` on the instance `commish-pg`
(`infra/README.md`), schema `research`, owned by the role `commish_research` (Secret Manager
`RESEARCH_DATABASE_URL`). Production's URL is the socket form Cloud Run mounts,
`postgres://commish_research:<password>@/commish?host=/cloudsql/trycommish:us-east1:commish-pg`;
`research.db.url` and `make_engine` take it as they take the TCP form, which development, tests and
the parity harness keep (`localhost:5432`, `localhost:5433`). The legacy database (`neondb`, schema
`public`) keeps serving the old app and the TypeScript oracle until cutover, then is deleted. In
development the `research` schema sits beside the legacy `public` tables in the dev Docker database
(`localhost:5432/commish`), loaded from them by `load_legacy`.

## Layout

| Path | What |
|---|---|
| `db/schema/` | the 27 research tables by group: `identity`, `nflverse`, `observations`, `provider`, `market`, `boards` |
| `db/migrations/`, `alembic/` | revision `0001` creates the schema, its DDL split by the same groups; `0002` adds the model provenance columns; `0003` the board reasons' `ordinal` |
| `db/legacy.py` | each research table's legacy counterpart, column by column: the single map parity and the loader read |
| `load_legacy.py` | the one-shot copy, the manifest, the per-table fingerprints |
| `pipeline/http.py` | the HTTP boundary: a `Fetcher` protocol, httpx live; every ingest reaches a provider only through it |
| `pipeline/jscompat.py` | JavaScript's semantics where a port must reproduce them: `Number()`, `trim`, `localeCompare` (printable ASCII, anything else refused), `Date` parsing, `JSON.stringify`, a left-fold sum |
| `pipeline/nflverse/` | the nflverse client and strict CSV reader, the universe, seasons, schedule, play-by-play, coaches observations, opponent adjustment, injuries, rosters, draft picks, kicking and defense weeks, derived stat lines |
| `pipeline/tank01/` | the stats provider's client, mappers, provider, roster and box scores, fixtures, ADP, headshots, the capture archive, the weekly projection parsed per player (`projections.py`) |
| `pipeline/odds/` | player props: the strict parser, snapshot, name resolution, historical backfill, the anytime-touchdown market (`touchdowns.py`) |
| `pipeline/weather/` | the kickoff weather fill: the gamebook line's parser, NOAA ISD's nearest station, `game_weather` |
| `pipeline/kickoffs.py`, `pipeline/kickoff_slots.py` | the stored kickoffs per club, and the kickoff slots the two round 4 benchmarks are captured in |
| `pipeline/preseason/` | week-one rosters and depth charts, the published boards and their thin-run gate, the nightly ADP capture |
| `pipeline/commands.py`, `pipeline/__main__.py` | the command line: every ingest, its transaction, its exit status |
| `parity/` | the harness: scratch databases, replay, recording, the passes, the row diff, the cases, the TypeScript driver in `parity/ts/` |
| `headshots/` | our headshot copies (Lane 241): the `headshots` job's sync, the curation command, the run's faces |
| `JOBS.md` | every job and operator ingest, its schedule today, its transaction, its Python destination |

## The research schema

Designed 2026-10-12 for the prep site, by the founder's ruling: "we don't need to worry about
migrations - no one is using the site - just rip and replace - don't leave tech debt for migration
purposes." Only the tables the pipeline, the model, the capsules, the nightly run and the advisor
need; every `player_id` means a row of `players`.

| Group | Table | Primary key | Legacy table |
|---|---|---|---|
| identity | `players` | `id` (gsis) | `nfl_players` |
| identity | `provider_players` | `id` (Tank01) | `players` |
| identity | `player_crosswalk` | `provider_player_id` (unique `player_id`) | `player_crosswalk` |
| identity | `props_player_map` | `prop_name, season` | `props_player_map` |
| nflverse | `nflverse_injuries`, `nflverse_kicking_weeks`, `nflverse_roster_weeks` | `season, week, player_id` | same names |
| nflverse | `nflverse_team_defense_weeks` | `season, week, team` | same name |
| nflverse | `nfl_draft_picks` | `season, pick` | same name |
| nflverse | `coaches` | `season, team, role, start_week` | same name |
| observations | `player_week_observations` | `season, week, player_id, source, metric, as_of` | same name |
| observations | `team_week_observations` | `season, week, team, source, metric, as_of` | same name |
| observations | `player_week_teams` | `season, week, player_id, team, as_of` | same name |
| provider | `provider_stat_lines` | `season, week, provider_player_id` | `player_stat_lines` |
| provider | `provider_games` | `game_id` (indexed `season, week`) | `nfl_games` |
| provider | `provider_weeks` | `season, week` | `stat_weeks` |
| provider | `capture_snapshots`, `player_prop_observations` | `id` (identity) | same names |
| market | `preseason_rosters` | `season, player_id, as_of` | same name |
| market | `preseason_rankings` | `season, source, player_id, as_of` | same name |
| market | `adp_snapshots` | `player_id, source, captured_at` | same name |
| boards | `model_artifacts` | `name, version` | same name |
| boards | `preseason_projections` | `season, source, player_id, as_of` | same name |
| boards | `preseason_board_reasons` | `season, source, as_of, player_id, code, detail` | same name |
| boards | `register_freeze_rows` | `season, week, frozen_at, board_source, player_id` | same name |
| boards | `register_grade_rows` | `season, week, frozen_at, graded_at, board_source, player_id` | same name |
| boards | `player_capsules` | `player_id` (gsis) | same name |

What changed from the legacy tables, and why:

1. **One schema, `research`.** The research tables no longer share `public` with the league app;
   alembic's version table lives in it too, so the dev database holds both side by side.
2. **One player identity.** Legacy had two `players` tables (the provider's ids in `players`, the
   universe in `nfl_players`) and a `player_id` column whose meaning depended on the table. Now
   `players` is the universe, the provider roster is `provider_players`, and a provider id is
   always spelled `provider_player_id`; `player_crosswalk` is the only join between them.
   `player_capsules` keys on the universe id (the loader maps each legacy capsule through the
   crosswalk; every one of the 664 in dev maps).
3. **Natural primary keys.** Every table whose rows are facts with a unique natural key (the
   observations, the draft, the coaches, the boards, the register, the artifacts, the ADP history)
   loses its `bigserial id` and takes the key as its primary key: the id was a sequence draw no
   reader used, and the unique index it shadowed is now the key. Two tables keep an identity id
   because they are append-only and may hold identical rows: `capture_snapshots` (a re-run on a
   pinned clock) and `player_prop_observations` (an event's props fetched twice).
4. **Text checks instead of enum types.** `player_position`, `week_status`, `capsule_source` and
   `board_moment_kind` were Postgres enum types; they are text columns with a check constraint now,
   the same values, without a type whose lifecycle has to be migrated to add a value.
5. **No constant columns.** `nflverse_injuries`, `nflverse_kicking_weeks`, `nflverse_roster_weeks`
   and `nflverse_team_defense_weeks` carried a `source` equal to their own table name on every row;
   the column is gone (the loader verifies the constant before dropping it).
6. **No defaults that hide a missing value.** `adp_snapshots.captured_at`,
   `preseason_projections.moment_kind`, `preseason_board_reasons.detail`,
   `nflverse_roster_weeks.status_detail`, every `provider_stat_lines` stat and every
   `provider_weeks` column lost their defaults: every writer sets them, and a writer that forgot
   should fail, not store a guess. A box-score stat Tank01 leaves out is one the player did not
   record, so the writer states the zero; a game's date and kickoff time are nullable because the
   provider can omit them (the legacy default stored `''`, which the loader reads as no value).
   The bookkeeping instants (`ingested_at` and kin) keep `now()`: they are the database's own record
   of when a row landed, which no writer knows better.
7. **The register says who froze it.** `register_freeze_rows.implementation` is required and
   checked (`typescript`, `python`): 2026 weeks 1 and 2 were frozen by the TypeScript, and the
   record page says so. The loader sets `typescript` on every legacy row. Who froze a row is not
   who made the board it quotes, so freeze and grade rows also carry the board's `model_version`
   (and a grade row its own `implementation`), and a board row its `model_version` and
   `arithmetic` (revision `0002`, backfilled from `research.db.provenance`).
8. **Names by role.** `nfl_games` and `stat_weeks` were the provider's fixtures and its week state,
   so they are `provider_games` and `provider_weeks`; their columns `home_nfl_team`, `away_nfl_team`
   and `players.nfl_team` are `home_team`, `away_team` and `team`. The freeze rows' `adp_rank` and
   `ecr_rank` held what the market and the panel published (fractional), so they are `adp` and
   `ecr`; the grade rows' `adp_rank` and `ecr_rank` are ordinal places among the graded, integers.
9. **The provider store names its season.** The Tank01 tables hold one season (the founder's
   2026-09-04 ruling) but every row carries `season`, keyed by `(season, week)`, and a writer
   retires every other season before it writes (`retire_other_seasons`, the rollover rule in
   `db/schema/provider.py`, tested in `tests/test_rollover.py`): a new season starts clean, and a
   read by week can never mix two seasons. Legacy rows are the 2026 season's (checked by fixture
   date on load).
10. **A board's reasons name their board.** `preseason_board_reasons` carries the `as_of` of the
    board generation it explains, so a frozen board's reasons survive a later generation. It is not
    a foreign key onto a projection row, because a reason can explain an exclusion (`roster_status`:
    528 dev reasons explain a player the roster gate kept off the board). Legacy reasons take the one
    generation their `(season, source)` holds; the loader checks there is exactly one.
11. **Types, each on purpose.**
    - `real` is gone: every float is `double precision`. The legacy `real` columns (ADP, sacks, snap
      share) are read through their shortest decimal text, which is the value the provider published
      (`12.3`, not the float4 12.300000190734863).
    - Dates are `date`: the provider's `YYYYMMDD` and nflverse's `birth_date`. The one text time
      left, `provider_games.kickoff_et` (`8:20p`), is the provider's display string, kept verbatim:
      research reads kickoff instants from the nflverse schedule's observations.
    - Instants are `timestamptz`; counts, ranks, weeks and seasons are `integer`; ids and names are
      `text`; payloads and per-market detail are `jsonb`; `preseason_rankings.rank` is a double
      because a consensus rank is published fractional.

Not carried: `player_peek_documents` and `player_peek_facts`, the old app's peek page cache and its
facts; research-ts neither reads nor writes them, and the capsule sweep recomputes facts from the
store.

## The legacy loader

`python -m research.load_legacy` copies every research table from its legacy table through
`db/legacy.py`, in foreign-key order, in one target transaction. It reads the source in one
REPEATABLE READ, READ ONLY transaction, so every table is copied from the same snapshot; a snapshot
that cannot be held fails with `SnapshotError` and writes nothing. Before each table it checks that
the entry accounts for every legacy column, that a dropped constant column is constant, and that
every invariant a derivation relies on holds (one board generation per reason's `(season, source)`;
every legacy fixture dated in 2026). It prints per table the legacy rows, the rows kept by design
and the rows that landed, and a fingerprint check (an md5 over each row's text, sorted, hashed
again, on both sides). Any landed count that differs from what the legacy table holds, unless a
stated row filter explains it exactly, or any fingerprint that differs, fails the load.

Cutover, in order: stop the legacy writers (the Vercel cron's jobs and the operator scripts);
`alembic upgrade head` against `RESEARCH_DATABASE_URL`; `load_legacy` from production; `parity schema
--against` the production database (through the Cloud SQL Auth Proxy, `infra/README.md`); start the
Python nightly. Run 2026-10-12 against the dev copy:

```
research table                 legacy table                      legacy      kept    landed  rows  result
---------------------------------------------------------------------------------------------------------
capture_snapshots              capture_snapshots                   1638      1638      1638  same  ok
coaches                        coaches                              944       944       944  same  ok
model_artifacts                model_artifacts                        3         3         3  same  ok
nflverse_team_defense_weeks    nflverse_team_defense_weeks         6814      6814      6814  same  ok
player_prop_observations       player_prop_observations           65268     65268     65268  same  ok
players                        nfl_players                        25110     25110     25110  same  ok
provider_games                 nfl_games                            272       272       272  same  ok
provider_players               players                             1468      1468      1468  same  ok
provider_weeks                 stat_weeks                             2         2         2  same  ok
team_week_observations         team_week_observations             36349     36349     36349  same  ok
adp_snapshots                  adp_snapshots                      11762     11762     11762  same  ok
nfl_draft_picks                nfl_draft_picks                    11084     11084     11084  same  ok
nflverse_injuries              nflverse_injuries                  68270     68270     68270  same  ok
nflverse_kicking_weeks         nflverse_kicking_weeks              6840      6840      6840  same  ok
nflverse_roster_weeks          nflverse_roster_weeks             523056    523056    523056  same  ok
player_capsules                player_capsules                      664       664       664  same  ok
player_crosswalk               player_crosswalk                    1468      1468      1468  same  ok
player_week_observations       player_week_observations          509564    509564    509564  same  ok
player_week_teams              player_week_teams                  15112     15112     15112  same  ok
preseason_board_reasons        preseason_board_reasons           187631    187631    187631  same  ok
preseason_projections          preseason_projections              26855     26855     26855  same  ok
preseason_rankings             preseason_rankings                 13074     13074     13074  same  ok
preseason_rosters              preseason_rosters                   2941      2941      2941  same  ok
props_player_map               props_player_map                    1118      1118      1118  same  ok
provider_stat_lines            player_stat_lines                      0         0         0  same  ok
register_freeze_rows           register_freeze_rows                2312      2312      2312  same  ok
register_grade_rows            register_grade_rows                    0         0         0  same  ok
not carried: player_peek_documents (the old app's peek page cache; research-ts neither reads nor writes it)
not carried: player_peek_facts (the old app's peek facts; the capsule sweep recomputes facts from the store)
load: 27 tables, 1519619 legacy rows, 1519619 landed
```

## Parity

The TypeScript oracle (`research-ts/`, with the app modules under `src/` it still imports) writes
the legacy tables in a scratch database built by the root drizzle journal; the Python writes the
`research` schema in one built by alembic. The harness reads the TypeScript's rows through
`db/legacy.py`, so both sides are compared as research rows: every mapped column of every row,
keyed by the primary key, with no float tolerances. A legacy column the map does not account for
fails the table. Excluded, and only these: an identity `id`, and a bookkeeping instant Postgres
fills with `now()` that neither side sets.

Each case runs in passes: `first` into empty databases, `rerun` on top of its own first pass from
the same recordings (every upsert's conflict branch, every changed-row check, every insert-or-ignore,
and the props backfill's resume), and, where an earlier recording exists, `prior` then `later` on
a second pair. The live roster supersede has its own: the four-club week-one roster at August 20,
then a later release without Kansas City at August 27 (`preseason-2026-later`, derived from the
recording with the filter stated in its manifest), so a supersede that does not retire the earlier
claim leaves rows only one side holds. Proven: with the retire line removed, the case fails. A pass also fails on a declared
table empty on both sides, on the two sides asking for different recordings, or on different exit
statuses from the operator scripts. Every scratch database is dropped when its case ends, and any
leftover of its own family when a run starts.

**Scratch databases (B85).** The harness and pytest's database-backed tests make their scratch
databases on the server `PARITY_DATABASE_URL` points at, never in the database it names. A caller names
one by its role (`parity_test_designations`); the server's name carries the URL's database as a family,
`parity_<database>__<role without parity_>` (`parity_lane110_research_test__test_designations` for
`.../lane110_research_test`), shortened with a digest past Postgres's 63 bytes (`parity/databases.py`).
The leftover sweep at a run's start drops only its own family's. So two lanes sharing one server (5433)
never collide as long as each points `PARITY_DATABASE_URL` at a database of its own:

```sh
createdb -h localhost -p 5433 -U commish lane110_research_test
PARITY_DATABASE_URL=postgres://commish:commish@localhost:5433/lane110_research_test uv run pytest
PARITY_DATABASE_URL=postgres://commish:commish@localhost:5433/lane110_research_test uv run python -m research.parity schema
dropdb -h localhost -p 5433 -U commish lane110_research_test
```

The database the URL names is only the admin connection and the family's name: nothing is written in it.

Operator scripts the harness runs UNMODIFIED, as the oracle, exit status included:
`coaches-ingest.ts`, `projection-context.ts`, `roster-weeks-ingest.ts`, `draft-picks-ingest.ts`,
`kdef-backfill.ts`, `preseason-ingest.ts`, `kdef-adp-ingest.ts`, `build-crosswalk.ts`,
`ingest-current-ecr.ts`, `vegas-win-totals-ingest.ts`, `odds-props-backfill.ts` (all in
`research-ts/scripts/`). RE-ASSEMBLED, because running it as is cannot work: `scripts/backfill-headshots.ts`
(its provider is the app's Redis-metered ledger); `parity/ts/cases.ts` pins its sha256 and fails
the harness if the script changes. The jobs (`realIngestStats`, `realSnapshotProps`,
`harvestCaptures`, `refreshWinTotals`, `snapshotPreseasonProps`, `ingestAdpSnapshot`) and the
library ingests the remaining scripts are one-line wrappers around are called directly.

Run 2026-10-12 against the recorded fixtures (`parity/fixtures/`, every response recorded from the live
provider, a large CSV narrowed by rows kept byte for byte with the filter stated in its manifest).

**Schema gate:** a database migrated by alembic from nothing equals the declared schema two ways: alembic's metadata comparison finds no difference, and its catalog (658 facts: columns, every `pg_constraint` row including the CHECK constraints, indexes) equals that of a database built by `METADATA.create_all`, line for line (proven: widening `coaches_role_ck` in the declaration alone fails the gate); every legacy column of the 27 mapped legacy tables, as the root drizzle journal builds them, is read or dropped with a reason; the dev database's `research` schema equals the migrated one, 658 of 658.

**Ingests:** `parity: 31 ingest case(s) in 76 passes, 31 matching; 1382755 rows compared per case, 943239 deduplicated; 0 differences`

The headline above is the 2026-10-12 full run and predates Lane 78. The three `nflverse-season-*` cases
were re-run on 2026-10-19 (Lane 78) once the stats step wrote each season's game results with its lines,
2012 now comparing team_week_observations too: 3 matching in 8 passes, 0 differences; their rows below are
that run's, as are the `crosswalk` rows.
The `crosswalk` case declares one departure (Lane 78, `parity.diff.Departure`): the build writes provider
player 4569682 as nflverse spells him, "Audric Estimé", where the oracle keeps the provider's "Audric Estime".

Rows compared per case add every table of every pass of every case, so a shared prerequisite (the
25,000-person universe several cases land first) counts once per case and pass; the deduplicated
total counts each tested table per pass and each prerequisite table once, at its largest.

| Case | Pass | Tables (rows compared) | Differences |
|---|---|---|---|
| nflverse-universe | first | players 24,853 | 0 |
| nflverse-universe | rerun | players 24,853 | 0 |
| nflverse-universe | prior | players 58 | 0 |
| nflverse-universe | later | players 24,853 | 0 |
| nflverse-season-2024 | first | players 24,853 (setup); player_week_observations 151,240; player_week_teams 7,551; team_week_observations 1,600 | 0 |
| nflverse-season-2024 | rerun | players 24,853 (setup); player_week_observations 151,240; player_week_teams 7,551; team_week_observations 1,600 | 0 |
| nflverse-season-2024 | prior | players 58 (setup); player_week_observations 898; player_week_teams 44; team_week_observations 549 | 0 |
| nflverse-season-2024 | later | players 24,853 (setup); player_week_observations 151,590; player_week_teams 7,551; team_week_observations 1,600 | 0 |
| nflverse-season-2012 | first | players 24,853 (setup); player_week_observations 10,696; player_week_teams 764; team_week_observations 512 | 0 |
| nflverse-season-2012 | rerun | players 24,853 (setup); player_week_observations 10,696; player_week_teams 764; team_week_observations 512 | 0 |
| nflverse-season-2025 | first | players 24,853 (setup); player_week_observations 1,954; player_week_teams 977; team_week_observations 676 | 0 |
| nflverse-season-2025 | rerun | players 24,853 (setup); player_week_observations 1,954; player_week_teams 977; team_week_observations 676 | 0 |
| nflverse-schedule | first | team_week_observations 20,272 | 0 |
| nflverse-schedule | rerun | team_week_observations 20,272 | 0 |
| nflverse-game-results | first | team_week_observations 1,788 | 0 |
| nflverse-game-results | rerun | team_week_observations 1,788 | 0 |
| nflverse-points-allowed | first | team_week_observations 1,788 | 0 |
| nflverse-points-allowed | rerun | team_week_observations 1,788 | 0 |
| nflverse-injury-reports | first | players 24,853 (setup); player_week_observations 3,574 | 0 |
| nflverse-injury-reports | rerun | players 24,853 (setup); player_week_observations 3,574 | 0 |
| nflverse-injury-reports | prior | players 58 (setup); player_week_observations 22 | 0 |
| nflverse-injury-reports | later | players 24,853 (setup); player_week_observations 3,574 | 0 |
| nflverse-injury-archive | first | nflverse_injuries 11,735 | 0 |
| nflverse-injury-archive | rerun | nflverse_injuries 11,735 | 0 |
| nflverse-injury-archive | prior | nflverse_injuries 38 | 0 |
| nflverse-injury-archive | later | nflverse_injuries 11,735 | 0 |
| nflverse-roster-weeks | first | nflverse_roster_weeks 11,028 | 0 |
| nflverse-roster-weeks | rerun | nflverse_roster_weeks 11,028 | 0 |
| nflverse-roster-weeks | prior | nflverse_roster_weeks 52 | 0 |
| nflverse-roster-weeks | later | nflverse_roster_weeks 11,028 | 0 |
| nflverse-draft-picks | first | nfl_draft_picks 11,081 | 0 |
| nflverse-draft-picks | rerun | nfl_draft_picks 11,081 | 0 |
| nflverse-draft-picks | prior | nfl_draft_picks 77 | 0 |
| nflverse-draft-picks | later | nfl_draft_picks 11,081 | 0 |
| nflverse-kdef | first | players 24,885 (setup); nflverse_kicking_weeks 1,086; nflverse_team_defense_weeks 1,088 | 0 |
| nflverse-kdef | rerun | players 24,885 (setup); nflverse_kicking_weeks 1,086; nflverse_team_defense_weeks 1,088 | 0 |
| coaches-seed | first | coaches 944 | 0 |
| coaches-seed | rerun | coaches 944 | 0 |
| nflverse-context | first | team_week_observations 16,240; player_week_observations 13,526; nflverse_injuries 11,735; nflverse_roster_weeks 11,028; coaches 944 (setup) | 0 |
| nflverse-context | rerun | team_week_observations 16,240; player_week_observations 13,526; nflverse_injuries 11,735; nflverse_roster_weeks 11,028; coaches 944 (setup) | 0 |
| nflverse-derived-stat-lines | first | player_week_observations 9,212 | 0 |
| nflverse-derived-stat-lines | rerun | player_week_observations 9,212 | 0 |
| tank01-roster-and-lines | first | provider_players 1,373 (535 declared departures: a free agent's new row holds no club); provider_stat_lines 944 | 0 |
| tank01-roster-and-lines | rerun | provider_players 1,373 (535 declared departures: a free agent's new row holds no club); provider_stat_lines 944 | 0 |
| tank01-schedule | first | provider_games 272 | 0 |
| tank01-schedule | rerun | provider_games 272 | 0 |
| tank01-schedule | prior | provider_games 272 | 0 |
| tank01-schedule | later | provider_games 274 (2 declared departures: the moved games retired) | 0 |
| tank01-adp | first | provider_players 1,373 (535 declared departures: a free agent's new row holds no club) | 0 |
| tank01-adp | rerun | provider_players 1,373 (535 declared departures: a free agent's new row holds no club) | 0 |
| tank01-headshots | first | provider_players 1,373 (535 declared departures: a free agent's new row holds no club) | 0 |
| tank01-headshots | rerun | provider_players 1,373 (535 declared departures: a free agent's new row holds no club) | 0 |
| crosswalk | first | players 24,885 (setup); provider_players 1,373 (setup, 536 declared departures: Estimé's name, and the free agents' clubs); player_crosswalk 1,373 | 0 |
| crosswalk | rerun | players 24,885 (setup); provider_players 1,373 (setup, 536 declared departures: Estimé's name, and the free agents' clubs); player_crosswalk 1,373 | 0 |
| tank01-capture-all | first | capture_snapshots 11 | 0 |
| tank01-capture-all | rerun | capture_snapshots 11 | 0 |
| tank01-capture-harvest | first | capture_snapshots 6; provider_players 6 (Sharpe, a free agent, cleared to NULL) | 0 |
| tank01-capture-harvest | rerun | capture_snapshots 6; provider_players 6 | 0 |
| tank01-capture-harvest | prior | capture_snapshots 6; provider_players 6 | 0 |
| tank01-capture-harvest | later | capture_snapshots 7; provider_players 6 (McCarthy MIN to NYG) | 0 |
| preseason-2025 | first | preseason_rosters 363; player_week_observations 73; preseason_rankings 230 | 0 |
| preseason-2025 | rerun | preseason_rosters 363; player_week_observations 73; preseason_rankings 230 | 0 |
| preseason-2026-live | first | preseason_rosters 260; player_week_observations 109; preseason_rankings 104 | 0 |
| preseason-2026-live | rerun | preseason_rosters 260; player_week_observations 109; preseason_rankings 104 | 0 |
| preseason-2026-live | prior | preseason_rosters 341; player_week_observations 109; preseason_rankings 127 | 0 |
| preseason-2026-live | later | preseason_rosters 260; player_week_observations 220; preseason_rankings 231 | 0 |
| adp-snapshot | first | preseason_rosters 341 (setup); adp_snapshots 36 | 0 |
| adp-snapshot | rerun | preseason_rosters 341 (setup); adp_snapshots 36 | 0 |
| current-ecr | first | player_crosswalk 1,373 (setup); preseason_rankings 545 | 0 |
| current-ecr | rerun | player_crosswalk 1,373 (setup); preseason_rankings 545 | 0 |
| odds-snapshot-and-resolve | first | players 24,853 (setup); player_prop_observations 551; props_player_map 59 | 0 |
| odds-snapshot-and-resolve | rerun | players 24,853 (setup); player_prop_observations 1,102; props_player_map 59 | 0 |
| props-preseason-job | first | players 24,853 (setup); team_week_observations 3,584 (setup); player_prop_observations 551; props_player_map 59 | 0 |
| props-preseason-job | rerun | players 24,853 (setup); team_week_observations 3,584 (setup); player_prop_observations 1,102; props_player_map 59 | 0 |
| odds-backfill | first | team_week_observations 5,604 (setup); player_prop_observations 209 | 0 |
| odds-backfill | rerun | team_week_observations 5,604 (setup); player_prop_observations 466 | 0 |
| win-totals-seed | first | team_week_observations 2,304 | 0 |
| win-totals-seed | rerun | team_week_observations 2,304 | 0 |
| win-totals-job | first | team_week_observations 3,680 | 0 |
| win-totals-job | rerun | team_week_observations 3,680 | 0 |

## The model (phase B)

The preseason board, the market blend, the laws, replacement levels and tiers, the outlook band,
the register and the held-out backtest, ported from `research-ts/src/projections/` as pure
functions over typed rows. Every float operation is the TypeScript's, in its order: a sum is a left
fold, a sort is stable with the oracle's comparator, a map iterates in insertion order. Where V8's
arithmetic is not the platform's, the port reproduces V8 (`model/fdlibm.py`, `model/jsmath.py`):

- `Math.log`, `Math.exp` and `Math.sin` are fdlibm, not libm. On Apple silicon V8 was compiled
  with clang's `-ffp-contract=on`, so every `a * b + c` inside one C expression is a fused
  multiply-add; `madd(fused)` marks each place clang fuses. x86-64 builds have no FMA to fuse into.
- `**` is libm's `pow`, except `x ** 2` is `x * x` and `x ** 0.5` is `sqrt(x)`.
- `Math.round` rounds a tie up and keeps a negative zero; `Math.max(-0, 0)` is `+0` and
  `Math.min(0, -0)` is `-0`; `a || b` on a number falls through on `0`, `-0` and `NaN` (`js_or`).

**The arithmetic is a property of the boards, never of the host** (`model/arithmetic.py`). Every
stored 2026 board was made on arm64 and reproduces only with the fused arm, so `ARM64_BOARDS`
(fused) is what every board, the fit check and the nightly compute with, on any machine: a nightly
on x86-64 Cloud Run runs fused too. `fit_check --arithmetic unfused` exists to rebuild a board an
x86-64 V8 made. Each board this lane writes records `model_version` (`research@<sha>`) and
`arithmetic` (`v8-fdlibm-fused/pow-<host libm>`) on its rows.

`pow` is the one call the policy cannot pin: Python takes it from the host libm, as V8 on macOS
does. Apple's libm and glibc differ on 96 of 50,000 random inputs, so a Linux host can differ from
an Apple-made board by an ulp at a `pow` call (`decay ** weeks`, the scheme elasticities); never by
a printed decimal, and the recorded `arithmetic` names the libm. V8 on x86-64 Linux computes a
`pow` that matches neither glibc, nor Apple's libm, nor a correctly rounded `pow` (4,916 of 50,000
differ from glibc); no board was made there.

The `numerics` case proves all of it: the running node, judged with both arms, must match exactly
one; the committed vectors from an arm64 macOS node (`parity/fixtures/numerics-v8-arm64`) must
match the fused arm and those from an x86-64 Linux node (`numerics-v8-x64`, made in
`node:22-slim --platform linux/amd64` by `parity/ts/numerics-vectors.mjs`) the unfused arm. A
source's `pow` lines are judged only where its `**` is this host's libm, and are otherwise counted
as skipped. `parity/ts/check-pow-vectors.py` checks a vector file's `pow` lines against a bare
Python of another platform.

### Data flow

| | |
|---|---|
| Tables in | `player_week_observations` (box scores, usage, play-by-play touches, depth charts, injury filings), `team_week_observations` (schedule, kickoffs, pace and pass rate, coaches, win totals), `player_week_teams`, `players`, `preseason_rosters`, `preseason_rankings` (ADP per format, ECR), `nflverse_roster_weeks`, `nflverse_injuries`, `nfl_draft_picks`, `capture_snapshots` (the provider's roster sweep and player list), `player_crosswalk`, `player_prop_observations`, `props_player_map` |
| Artifacts | `model_artifacts`, pinned in `model/artifacts.py`'s `CATALOG`: `model/weekly-priors`, `preseason/priors`, `preseason/rookie-curve`, `preseason/rookie-history`, `preseason/kdef-priors`, `preseason/game-variance-skill`, `preseason/game-variance-kdef`, `market/blend-constants`, `market/props-anchor-weight`, `market/curve-{ppr,half,std}`, `laws/{measured,discovered,discovery-quantiles}`. Nothing the board reads comes from a file. |
| Tables out | `preseason_projections` (with `model_version` and `arithmetic`) and `preseason_board_reasons` (the fit step with `--persist-board`), `register_freeze_rows` (`implementation = 'python'`, and the `model_version` of the board each row quotes), `register_grade_rows` (`implementation`, and the `model_version` of its freeze row) |

```sh
# the oracle's committed fits into the artifact store, as version 1 (runs research-ts; each is
# stamped with the commit that last changed its fitted numbers (model/fit_history.py compares the
# numbers across the file's history, so a rename or a refactor never stamps a fit), and fitted_on
# names the oracle module, the seasons, the inputs the store lost and the re-fit path). A re-seed is
# a no-op, a changed payload is refused; --restamp corrects the provenance of identical v1 rows
RESEARCH_DATABASE_URL=... uv run python -m research.model.seed [--restamp]

# the fit step: check-only by default (rebuild and compare, 0.05 points); --persist-board retakes
# the product season's live board, which replaces what is served and what the register freezes
RESEARCH_DATABASE_URL=... uv run python -m research.model.fit_check [--persist-board] [--now ISO] [--arithmetic fused|unfused]

# the per-game variance fit (2023-2024; --publish writes the next version, the pin does not move)
RESEARCH_DATABASE_URL=... uv run python -m research.model.fits.game_variance [--publish]

# the model parity cases (the store-backed ones read the dev copy, read only)
export PARITY_SOURCE_DATABASE_URL=postgres://commish:commish@localhost:5432/commish
uv run python -m research.parity model all            # or one case; --no-store for numerics only
```

| Path | What |
|---|---|
| `model/fdlibm.py`, `model/jsmath.py` | V8's transcendentals and number semantics |
| `model/domain.py`, `model/instants.py` | stat lines, scoring rules, roster slots; millisecond instants |
| `model/reads/` | the point-in-time reads: observations, stat lines, usage, team facts, rosters, rankings |
| `model/weekly/` | layer 1 (opportunity), layer 2 (efficiency) and the scheme layer |
| `model/preseason/` | the board's inputs and moments, candidates, availability, career, depth chart, offseason, rookies, roster status and the gate, the board, the build of every leg, persist |
| `model/market/` | the ADP curves per format, the props anchor, the blend |
| `model/laws/` | tribal and discovered law facts, the candidate generator, the registry and its reasons, the measurement harness |
| `model/decide/value.py` | replacement levels, value over replacement, tiers |
| `model/register/` | the freeze and the grade |
| `model/backtest.py` | Spearman, the scorecard, the held-out backtest |
| `model/fit_check.py`, `model/fits/` | the fit step; the fits that run on today's store |
| `parity/model/` | the model cases: the store as it stood, both sides, the diff |

### The store as it stood

A board is rebuilt at a past moment, so each model case runs on a copy of the dev store as it
stood then (`parity/model/store.py` lists every table and how it is cut): each row whose own write
stamp is at or before the moment, the boards by their own `as_of`, and whole the tables that carry
no stamp (`nfl_players`, `players`, `player_stat_lines`, `player_capsules`, `stat_weeks`,
`model_artifacts`). `as_of` alone is not enough: the win totals are stamped with the publisher's
date, two days before the job that wrote them ran.

Where a stamp does not tell the truth, the copy says so. `nfl_players` is rewritten in place with
no stamp, so a copy holds today's universe; the one fact the week-1 board read that has changed
since (Velus Jones Jr. was a WR, now an RB) is restated by the week-1 case. `nfl_draft_picks` were
all re-ingested at 2026-09-08 00:48 and `player_week_teams` for 2024-2025 at 2026-09-07 22:04, so
the week-1 copy holds neither; for the teams that is correct (copying them makes 592 rows of the
week-1 board differ from what the register froze).

### Which model made each board

`research.db.provenance` names the tree behind every legacy board the store or the register still
holds, and how that is known; the loader and migration `0002` write it onto the rows:

| Board | Model | Known by |
|---|---|---|
| 2026 v9 ppr/half/std and v1 raw, 2026-09-09T02:20:29.697Z (register week 2, served) | `research-ts@7af71283`, fused | rebuilt bit for bit by that tree, unmodified, on the store as it stood |
| 2026 v9 ppr, 2026-09-07T21:57:33.121Z (register week 1, retired from the store) | `research-ts@800aef34`, fused | its points, ranks and value ranks rebuilt exactly by that tree, with the one restated fact |
| 2026 v7 ppr, 2026-09-02T03:20:39.21Z (the register's shadow) | `research-ts@6603c2ac` | main's last commit before it; not rebuilt |
| 2024 v9 and v7 ppr replay boards | `research-ts@5240ed99`, `research-ts@5b0a0ddd` | main's last commit before each `computed_at`; the store lost their inputs |

Any other legacy board keeps a NULL model version, and the freeze refuses to quote a board that
names none.

### Model parity

The latest run: **10 cases, 1,085,041 comparisons, 0 differences, every claim holding.** Every
comparison is exact; a refusal is compared whole, after a declared wording map for the names that
differ by design (`blend.REFUSAL_WORDING`, `grade.REFUSAL_WORDING`).

| Case | Compared | Differences |
|---|---|---|
| numerics | the running node: log, exp, sin, round, mulberry32 100,000 each, pow 400,000, max/min 10,000 each, the ordinal comparator 10,000 pairs (with NaN), 100 whole sorts; the arm64 vectors: log, exp, sin, pow 20,000 each (fused); the x86-64 vectors: log, exp, sin 20,000 each (unfused), pow skipped | 0; each source matches its arm and the other arm differs on 122 lines |
| board-2026-week2 | at 2026-09-09T02:20:29.697Z, all four legs (551 rows, every stored column and reason; 132 exclusions): the stored generation against the tree at `7af71283` run unmodified, against today's oracle (`persistSeason` itself), and the oracle against the port; the port's ppr against the register's week 2 | 0 |
| board-2026-week1 | the register's week 1 (669 points, ranks, value ranks) against the tree at `800aef34` with the restatement; the 668 other players against it without; oracle against port on the ppr leg, both refusing the half leg with the same words | 0; without the restatement only `00-0037745`'s points move, no rank moves, and exactly 122 value ranks move |
| register-freeze-week2 | the freeze retaken at 2026-09-10T18:00:17.177Z against the stored freeze and the oracle's, 1,097 rows; each row quotes its board's model | 0 (`implementation`, `model_version` excluded) |
| register-grade | 2026 weeks 1 and 2 on today's store | both refuse alike, compared whole: the store holds no 2026 outcomes |
| register-grade-2024-week2 | a scratch freeze of 2024 week 2 at 2024-09-10T12:00Z (1,317 rows) and every output of its grade, both sides: the rows (every field), the boards in order with their populations, each board's four column scores (Spearman, mean absolute rank error, graded), the skipped boards with their reasons, the served population | 0 |
| register-freeze-unknown-model | the 2024 served board with its model version removed: the freeze refuses (`unknown_model`, the message whole) and writes nothing | |
| held-out-backtest | rho and n, 2023 and 2024 | 0 |
| fit-check | the 2026 live board at its stored moment, 4 boards; after kickoff, no archived board is rebuildable | max delta 0.0000 |
| fit-game-variance | the 2023-2024 refit, oracle against port | 0 |

The register's week 1 is a different model, proven by construction in `board-2026-week1`: the
tree at `800aef34` (main's last commit before that board), run unmodified on the store as it stood
with the clock at the board's moment, reproduces all 669 frozen points, ranks and value ranks
exactly once one universe fact is restated (Velus Jones Jr., `00-0037745`, was a WR then and is an
RB now; `nfl_players` was rewritten in place). Without the restatement exactly that player's
points move (1.59 against 1.56) and his move shifts 122 value ranks; the case checks that he is the
only one. Today's oracle and the port are the 2026-09-09 model and agree with each other there.

### Unported fits

The nine fits behind the seeded version-1 artifacts, and the three the oracle published to the
store itself, except the per-game variance fit (ported, `model/fits/game_variance.py`), are carried
as their numbers, not as code. None can be re-run on the store as it stands: it no longer holds
`preseason_rosters` for 2021-2024, `player_week_observations` before 2023, `player_week_teams`
before 2024, or the schedule, kickoffs, play-by-play and coaches in `team_week_observations` before
2024. The re-fit path for each is the same: rebuild that history (`python -m research.pipeline history`, phase D; the dev copy holds it since 2026-10-13),
port the fit, compare its output with the version-1 numbers, and publish the result as version 2.

| Artifact | Oracle fit | Fitted on | The store lacks |
|---|---|---|---|
| `model/weekly-priors` | `npm run projections:fit` | 2021-2022 (2020 as history) | 2020-2022 weekly observations, teams, schedule |
| `preseason/priors` | `npm run projections:preseason:fit` | 2021-2022; the rookie games rate 2023-2024 | 2021-2024 preseason rosters, 2018-2022 weekly observations, 2018-2023 player teams |
| `preseason/rookie-curve` | `npm run projections:rookie-curve:fit` | rookie classes 2003-2021 | rookie-season outcomes before 2023 |
| `preseason/rookie-history` | `npm run projections:rookie-historical-games:fit` | rookie classes 2003-2021 | rookie-season games before 2023 |
| `preseason/kdef-priors` | `npm run projections:kdef:fit` | 2013-2024 | schedule and kickoffs before 2024 |
| `market/blend-constants` | `npm run projections:blend:fit` | predictor seasons 2013-2021 | the raw boards' inputs (preseason rosters, weekly observations) for 2013-2021 |
| `market/curve-{ppr,half,std}` | `npm run projections:market:fit [-- --format=half/std]` | ADP 2013-2021 (half 2018-2021) | season outcomes before 2023 |
| `laws/measured` | `npm run laws:measure` | 2003-2023 | weekly observations before 2023, player teams before 2024, coaches and schedule before 2024 |
| `laws/discovered`, `laws/discovery-quantiles` | `npm run laws:discover`, `npm run laws:discover:quantiles` | discovery 2003-2021, replication 2021-2023 | as `laws/measured` |
| `preseason/game-variance-kdef` | `research-ts/scripts/game-variance-fit.ts` (its kicker and defense arm) | 2023-2024 | schedule before 2024 |
| `market/props-anchor-weight` | `research-ts/scripts/props-anchor-fit.ts` | the props archive's seasons, 2023-2024 | the raw boards' inputs for 2023-2024 |

The law measurement harness's measuring half (`matchedPairs`, `bootstrapStatistics`,
`measureEffect`) serves only the law fits, so it is not ported either; `model/laws/harness.py`
keeps the verdict the board reads and the mulberry32 stream the numerics case proves.

### The backtest

The stored served board against regular-season outcomes, in the held-out seasons:

| Season | Spearman rho | n |
|---|---|---|
| 2023 | 0.7649 (0.7648668314705206) | 533 |
| 2024 | 0.7848 (0.7848118119491571) | 537 |

## The decide layer, the advisor and the capsules (phase C)

```sh
# the advisor: POST /advise, GET /healthz, GET /readyz on $PORT (8080), ADVISOR_WORKERS processes (2)
uv run python -m research.advisor
uv run python -m research.advisor.bench --url http://localhost:8080 --drafts 3 --rooms 1

# the capsules (RESEARCH_DATABASE_URL; AI_GATEWAY_API_KEY from the environment for write and sweep)
uv run python -m research.capsules facts <provider id>      # one sheet, the narrow read
uv run python -m research.capsules prompt <provider id>     # the user message the writer would get
uv run python -m research.capsules write --count 10 --spread 50   # write and gate a few: paid calls
uv run python -m research.capsules sweep                    # the nightly sweep
uv run python -m research.nightly run --out DIR --skip ingest,fit   # the nightly (phase D, "The nightly run")

# parity
uv run python -m research.parity decide all                 # room states, refusals, startSit, the numerics
uv run python -m research.parity decide record              # re-record the room states (dev copy)
PARITY_SOURCE_DATABASE_URL=... uv run python -m research.parity capsules all   # the facts, dev copy, against their recording (capsules record re-records)
# The capsule cases are a self-regression check, not parity: since phase D fix round 3 they compare the
# port with a recording of the port's own board pass (every facts hash, a 12-sheet sample, the narrow
# read) as of 2026-10-13, so they catch a change in the port's facts, never an error the port shares
# with its own recording. The oracle they once matched reads the legacy tables and retires at cutover.
```

### Module map

| TypeScript (research-ts/src) | Python |
|---|---|
| `projections/decide/normal.ts` | `model/decide/normal.py` |
| `projections/decide/survival.ts` | `model/decide/survival.py` (memoised per queue place and gap) |
| `projections/decide/draft.ts` (`recommendPick`, `fitFor`, `reasonsFor`) | `model/decide/{draft,roster_view,reasons,survivors,marginal}.py` |
| `projections/decide/slots.ts` | `model/decide/slots.py` |
| `projections/decide/tiers.ts` | `model/decide/tiers.py` (`value.py` re-exports it) |
| `projections/decide/{lineup,outlook}.ts` | `model/decide/{lineup,outlook}.py` |
| `draft-engine/{slotting,roster-need,order}.ts`, `domain/{roster-eligibility,must-pick,position-words}.ts`, `preseason/kdef-decision.ts` | `model/decide/roster.py` |
| `advisor/{request,advise,why,server}.ts` | `advisor/{request,checks,advise,why,wire,server,warm,__main__}.py`, `advisor/bench.py` |
| `capsules/{facts,facts/types}.ts` | `capsules/facts/{model,depth_model,build,evidence,ledger,depth_ledger}.py` |
| `capsules/{collect,collect-one,peers,rank,trend}.ts`, `board/service.ts` (projected half), `reference/{injuries,news}.ts` | `capsules/facts/{collect,collect_one,color,board,rank,reference}.py` |
| `capsules/facts/*.ts` (the depth pass) | `capsules/facts/{depth_collect,depth_reads,depth_absence,depth_role,depth_context}.py` |
| `capsules/{config,voice-rules}.ts` | `capsules/config.py`, `capsules/voice_rules.py` (every voice rule, one file) |
| `capsules/{validate,number-grounding}.ts` | `capsules/{validate,grounding}.py` |
| `capsules/{render,render-depth,prompt,narrative,narrative-slots,bundle,template,write,generate}.ts` | `capsules/{render,render_depth,render_words,prompt,narrative,bundle,facts_block,gateway,generate}.py` (the oracle's prose template is gone: `facts_block`) |
| `capsules/{repetition,sameness,store,sweep}.ts` | `capsules/{repetition,store,sweep}.py`, `capsules/trial.py` |
| `nightly/build/pull-figures.ts`, `nightly/gates.ts` (`capsuleFindings`) | `capsules/pull_figures.py`, `nightly/capsule_gate.py` (the unwritten share and shared-sentence gate, this lane's) |

### The advisor's contract

The contract is the Go rooms' (`api/internal/advisor/http.go`): the request is `research-ts/README.md`'s
(`teamCount`, `rosterSlots`, `pool` with `projectedPoints` null in market order, `picks`,
`seatOnClock`, `shortlistSize`), and the rooms read `pickNumber`, `nextPickNumber`,
`shortlist[].playerId`, `shortlist[].why` and `survival` from the envelope's `data`. The two agree, so
research-ts's README is unchanged. `/readyz` is new: it answers once a shape-only room state has been
advised. The service runs in the board's arithmetic (fused, `model/arithmetic.py`) on any host.

- **Refusals are the oracle's, word for word.** `advisor/checks.py` is zod 4's checks and messages
  for this schema (which issues abort and stop the `superRefine`, which do not, JavaScript's numbers),
  proven on 54 bodies by `parity decide advise-refusals`. Past the oracle, the service refuses a pool
  over 1,000 players, a slot count over 12 and a roster over 30 spots (400), so no body under the
  1 MB cap holds a worker for long; the Go rooms send at most 400 undrafted plus the drafted.
- **The closed form runs on the process's one advise thread**, never on the event loop, so
  `/healthz` answers during a call; `server-timing` runs from the first byte read through the
  response serialised.
- **Deployed with ingress all behind IAM** (`research.yml`): the invoker check is on and only
  `api-runtime` holds the invoker role, so a call needs a Google identity token for the service
  (`idtoken.NewClient(ctx, ADVISOR_URL)` on the Go side). It runs as `advisor-runtime`, which holds
  no role at all (no Secret Manager, no database). `ADVISOR_MIN_INSTANCES` is 1 in season, 0 otherwise.
- **Rooms that leave the snake are refused, as the oracle refuses them.** The request carries each
  pick's own number and the seat on the clock (`http.go`), and the oracle answers only a snake draft:
  after a skipped or owed pick (a slow room's clock running out) the next call is a 422 ("pick 8
  belongs to seat 8 ... not seat 9") and every later call a 400 ("picks must be numbered 1..n"), so
  **a skipped pick turns the advisor off for the rest of that draft today**; the rooms fall back to
  the engine's card. The recorded `slow2_10t_standard` shows it: 1 state 422, 15 states 400. This is
  oracle behaviour and stays while parity holds. **Answering owed-pick rooms is the first improvement
  after the oracle retires** (the pick numbers and the seat on the clock already arrive; the closed
  form needs the turn order the room actually ran).

### What changed from the oracle, and why

- **The capsule writer's register.** No sportsbook number reaches the writer (props lines, win
  totals, the week-one total and spread are not rendered); betting words, every "the honest ..."
  frame and every measured refrain are voice-rule violations, a sentence rewrite each; the long read
  must print one of the page's numbers (the pull-figure gate) or it is corrected, and a read may
  take two corrections inside the player's six calls (the oracle stopped at one correction inside
four calls). A read asked for a shorter version may run up to 10% over its word cap, and every
correction quotes the exact banned phrases the read was caught with. The fact sheet
  itself (`PlayerFacts`, its ledgers and its hash) is the oracle's, field for field, so the oracle's
  stored hashes stay valid.
- **No prose template; the fallback is a facts block** (the founder's rule: every non-stat
  sentence comes from the writer, and a frame with the name and numbers swapped is a stock
  sentence). A player the writer cannot serve within its ceiling gets his numbers with their basis
  as labelled facts, one `Label: value` line each and no sentence (the projection in his expected
  games, the middle and full ranges, the board rank, the ADP), on both sizes, stored
  `source = 'facts'` (revision 0004) and rendered by the page as a facts list. The sweep writes
  unwritten pages before changed ones, and the nightly then runs one retry pass over the pages still
  unwritten before its capsule gate. The gate fails the run when facts blocks, the oracle's leftover
  `template` rows and missing pages pass 2% of the board, or when a written sentence of four words
  or more sits on two pages ("Draft him." and "Let him go." are vocabulary, exempt).
- **The board reasons' order is stored** (`preseason_board_reasons.ordinal`, revision 0003). The
  oracle read a player's reasons in heap order, and a capsule's evidence depends on it.
- **The narrow read places every depth-chart room by the served board**, and reads an archive team
  code as one: the oracle's `collectPlayerFacts` threw on `LA` and `WAS` for most players.
- **Capsules key on the universe id** (`research.players.id`); the sheet's `identity.id` stays the
  board's provider id, as the oracle's does.

### Owed when the oracle retires

- **Answer owed-pick rooms** (above): the first improvement once parity no longer binds.
- **Ticket: the depth facts' injury history and college.** `capsules/facts/depth_reads.py` reproduces
  the oracle's defect: it looks the provider-keyed injury and college captures up by the universe id,
  so both fields are always empty and the writer never sees them. Read them through the crosswalk;
  every facts hash changes with it, so it ships as one hash bump that regenerates the board.

## The nightly run, the in-season jobs and the history rebuild (phase D)

```sh
# the nightly run, into a local directory laid out as the bucket (the web builds from it with
# PUBLIC_RUN_BASE_URL=DIR); without --out it writes R2 (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)
uv run python -m research.nightly run --out DIR [--skip ingest,fit,capsules,week-reads] [--regenerate-all] [--mend-only]
uv run python -m research.nightly publish --out DIR [--at ISO] [--no-dispatch]

# the in-season jobs, one pass each
uv run python -m research.inseason --task season-week [--skip props-snapshot]
uv run python -m research.inseason --task capture-harvest

# the seasons the store lost, re-created from nflverse (once per store)
uv run python -m research.pipeline history

# a run against the web's own reader and schemas (needs a web/ checkout with node_modules)
node --experimental-strip-types nightly/contract/run-contract.ts ../web DIR RUN_ID

# which unported fits the store can re-run, and what each still lacks
uv run python -m research.model.fit_inputs
```

### The chain

`research.nightly run` (`nightly/run.py`), every step isolated, every part named in the log:

1. **ingest** (`nightly/steps.py`): the provider capture, tonight's ADP in the four formats (the
   three scoring formats and two-quarterback drafts for superflex), the pre-kickoff props, the win
   totals. Fails only when the PPR ADP capture failed.
2. **fit** (`model.fit_check`): check only. After kickoff it rebuilds only boards made by a model
   this code reproduces; the 2021-2024 replay boards were made by older trees, so they are named and
   skipped (comparing them with today's model reports a model change, not drift).
3. **capsules** (`nightly/capsule_step.py`): the sweep, a retry pass over unwritten pages, a repair
   pass for written sentences on two pages, then the capsule gate. The sentences already shared are
   quoted to the writer from the first call. `--regenerate-all` rewrites the whole board. One player
   takes at most 12 calls a night across every pass (`NIGHT_CALLS_PER_PLAYER`). The writer's ADP is
   the run's own (`capsules/facts/market_adp.py`), and a stated ADP or pick that is not the page's is a
   violation and a page finding.
4. **assemble** (`nightly/assemble.py`): every artifact of `web/src/lib/run/schema.ts` at one
   instant: `boards/<format>.json`, `players/<id>.json`, `adp.json`, `record.json`, `index.json`,
   `clubs.json`, `schedule.json`, and the manifest with its sources block.
5. **gates** (`nightly/gates.py`), each failure a named reason: `held_out_backtest`,
   `board_depth`, `capsules`, `basis`, `adp`, and `schema`: the web's own reader and schema
   (`nightly/contract/run-contract.ts` under node, the web's `src/lib/run` copied into the image) over
   the run staged in a temporary directory, before anything is copied to the store. A player page the
   reader refuses is held, not the run (Lane 136, `nightly/held_pages.py`): up to ten pages, or 2% of
   them if fewer, each shown from the newest passed run's copy (`held/<id>.json`, with that run's
   stamp) or as its board figures alone, named in `held.json`, the gate's summary and one
   `nightly HELD:` line the research alerts email; past the line, or on any refusal that is not one
   page's, the run fails as before. **No CI run of the gate over real pages** (the coordinator's
   ruling, Lane 144, B117): CI runs it over the committed contract fixtures (`nightly/contract/fixture`)
   and the writer-made cases of `tests/test_season_contract.py`; the nightly's own gate run is the run over
   real pages, every night, and the held page is its safety net. No recorded night is kept in the
   repository or fetched in CI.
6. **faces**: every `headshot` the run carries is our copy's address,
   `https://images.trycommish.app/headshots/<season>/<player_id>/320.webp` (`headshots/faces.py`); the
   copies are the `headshots` job's (below, "Our headshot copies"), never fetched by the nightly.
7. **write**: every artifact, `report.json` (steps, gates and their reasons, the held-out scores,
   the capsule spend, every file's bytes and SHA-256), `manifest.json` last. A run id is claimed
   with a conditional write, so it is never reused (`2026-10-13T05`, then `2026-10-13T05-2`).
8. **promote**: a run that passed moves `runs/early.json` (early access, spec §4) and goes public an
   hour later, when `publish` moves `runs/latest.json` and dispatches `web.yml` with its id
   (`workflow_dispatch`, an Actions-only token). A step that raises is a failed step with a report.
9. **the published board**: every `publish` then makes `research.published_boards` hold exactly the
   board rows of the run `latest.json` names (`nightly/published_board.py`, one transaction a
   season; a run already there is left alone), so the API reads the order the site shows, the
   rest-of-season order from week 6, without reading R2. The pointer and the dispatch come first:
   a write that fails prints one `published board: FAILED (...)` line naming the run `latest` names
   and the run the table still holds (whole, never a mix), exits 1, and is retried at the next
   publish hour. Publish runs every hour, so a failure is made good within the hour; a run whose artifacts never read as a board stays failed until another run is published.

### What the run reads and decides

- **Formats** are the site's chooser at twelve teams: `ppr-12`, `half-ppr-12`, `standard-12`,
  `superflex-12` (the PPR board valued for a league that can start a second quarterback). A format
  is carried only when it has ADP; superflex's two-quarterback capture starts with phase D, so the
  2026 run (which reads ADP from before the first kickoff) does not carry it, and says so.
- **Boards** are the stored board's newest generation, valued per format's shape by the board
  service's rules (`nightly/reads/board.py`). Tiers run across the whole board: the service's tiers
  above replacement, the same rule over the rest.
- **ADP**: before the first kickoff the newest capture, after it the newest capture before it.
- **The record** is the register's served board by week, our order and ADP's graded on the same
  players, by position, and the season to date as the register's running score.
- **Schedule strength** is the mean of a slate's opponents' expected wins, set before the first
  kickoff; the window is each slate's own.
- **Capsules** on a page are the writer's long read with its pull figures; a facts block or no row
  is no capsule, and the gate counts it.

### The in-season jobs

`research.inseason` (`inseason/`) replaces the Vercel cron's `season-week` and `capture-harvest`.
Three changes from the oracle: weekly stats are read from nflverse's `stats_player` release, where
they are published from 2025 (the oracle's `player_stats` tag answers 404, so it never saw a 2026
outcome); a week is graded only once every game the game table lists for it holds both clubs' results and
stat lines as of the pass (Lane 244, `inseason/week_complete.py`); and a missed freeze (a week whose
first kickoff passed with none) or a grade still impossible four days after the games fails the
pass, so it is never silent.

A game cancelled but kept in games.csv with no result, or dropped from it and left as a stale
`nflverse_games` row, would hold its week forever; the overdue line names each game with no final and
the command that voids it. `python -m research.inseason void-game --season S --week W --game ID
--reason TEXT --by WHO [--lift]` (Lane 249, `inseason/game_voids.py`) checks the game is that week's,
writes one append-only row to `research.game_voids` (a lift is a later row, the latest at or before the
pass wins) and prints what it did; the check then skips the game and names it. No schedule runs it;
with gcloud lapsed, `gh workflow run ops.yml -f job=inseason -f
args=research.inseason,void-game,--season,<s>,--week,<w>,--game,<id>,--reason,<why>,--by,<who>`.

### The history rebuild

`research.pipeline history` (`pipeline/history.py`) re-creates, with phase A's ingests, what the
store lost, back to the first season any unported fit names: schedule and kickoffs 2003-2023, box
scores 2003-2022 (snap counts from 2012, nflverse's first; 2019 from play-by-play, nflverse never
published it), player teams 2003-2023, play-by-play context, coaches and opponent adjustment
2003-2023, injury filings 2009-2022 (a season nflverse cannot stamp, or whose filings contradict
themselves, is named and left out), depth charts 2003-2022, week-one rosters 2003-2024.
`--first`/`--last` narrow it. `python -m research.model.fit_inputs` names each fit as re-runnable or
the seasons it still lacks, and the nightly's fit step prints the same.

### The register's trail and the product season

The weekly pass claims its own run id in the bucket (`<hour>-weekly`, its lines in
`runs/<id>/inseason.json`), records it for each freeze in `register/frozen-by.json`, and its outcome
in `register/last-pass.json`, which the nightly copies into its manifest (`register`). The record's
`frozenBy` names those ids; a week frozen before the trail is named by the first passed run that
carries it, with a note in that run's manifest. The product season is named once,
`research/season.py`, with the rule for moving it.

### Our headshot copies (Lane 241)

Every face the site and the apps draw is a copy we hold in the R2 bucket `commish-images`, public at
`https://images.trycommish.app` (a custom domain on the site's zone; the runs bucket stays private),
keyed `headshots/<season>/<player_id>/<width>.webp` at the widths 48, 64, 96, 128, 160, 240, 320 and
480, each `Cache-Control: public, max-age=31536000, immutable`. The ledger is
`research.headshot_copies` (revision 0022): one row per player and season, `copied`, `curated`,
`refresh`, `missing` or `failed`. The API answers `.../320.webp` for a `copied` or `curated` row and
null otherwise; the run answers the same address for every player with a copy or a provider image
(`headshots/faces.py`); the web reads either and asks for the width it draws.

    uv run python -m research.headshots sync [--season 2026] [--limit N] [--out DIR]
    uv run python -m research.headshots curate --missing
    uv run python -m research.headshots curate --player <id> --url <https url> --by <who>
    uv run python -m research.headshots curate --refresh --player <id>

`sync` is the Cloud Run Job `headshots` (weekly in season, daily in August, `infra/research-schedule.sh`):
every provider player but the defenses, in ADP order; a `copied` row from the same source and every
`curated` row are skipped with no request; at most two fetches a second, from the provider's image host
only, no redirects, 2 MiB at most; each player's row committed on its own. `curate` takes any https
image a person chose, writes the copy and marks the row `curated` with who and when; the sync never
touches it again. With gcloud lapsed, `gh workflow run ops.yml -f job=headshots -f
args=research.headshots,curate,--player,<id>,--url,<url>,--by,<who>`. A replaced copy keeps its
address, so a browser that cached the old one keeps it up to a year; purge its eight URLs at the edge
when a wrong face is replaced.

