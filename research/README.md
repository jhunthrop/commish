# research

The Python research lane (spec `docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md`
§2.3). Phase A is here: every ingest the TypeScript core runs, ported; the `research` schema,
designed from scratch for the prep site and owned by alembic; the one-shot loader that carries the
legacy tables' data into it; and the parity harness that proves each port row for row against the
TypeScript on the same recorded input. Phases B to D (`model`, `capsules`, `advisor`, `nightly`)
are empty packages whose docstrings say what lands in them.

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
export PARITY_DATABASE_URL=postgres://commish:commish@localhost:5433/commish_test
uv run python -m research.parity schema                     # migrations vs declared schema, the legacy map
uv run python -m research.parity schema --against $URL      # plus a live research schema, read only
uv run python -m research.parity ingest all                 # every ingest, recorded inputs, every pass
uv run python -m research.parity record <fixture-set> --env-file ../.env.local   # re-record from the provider
```

Databases. Production is the Neon database `commish`, schema `research`, owned by the role
`commish_research` (`RESEARCH_DATABASE_URL`, also Secret Manager `RESEARCH_DATABASE_URL`). The legacy
database (`neondb`, schema `public`) keeps serving the old app and the TypeScript oracle until
cutover, then is deleted. In development the `research` schema sits beside the legacy `public`
tables in the dev Docker database (`localhost:5432/commish`), loaded from them by `load_legacy`.

## Layout

| Path | What |
|---|---|
| `db/schema/` | the 27 research tables by group: `identity`, `nflverse`, `observations`, `provider`, `market`, `boards` |
| `db/migrations/`, `alembic/` | revision `0001` creates the schema, its DDL split by the same groups |
| `db/legacy.py` | each research table's legacy counterpart, column by column: the single map parity and the loader read |
| `load_legacy.py` | the one-shot copy, the manifest, the per-table fingerprints |
| `pipeline/http.py` | the HTTP boundary: a `Fetcher` protocol, httpx live; every ingest reaches a provider only through it |
| `pipeline/jscompat.py` | JavaScript's semantics where a port must reproduce them: `Number()`, `trim`, `localeCompare` (printable ASCII, anything else refused), `Date` parsing, `JSON.stringify`, a left-fold sum |
| `pipeline/nflverse/` | the nflverse client and strict CSV reader, the universe, seasons, schedule, play-by-play, coaches observations, opponent adjustment, injuries, rosters, draft picks, kicking and defense weeks, derived stat lines |
| `pipeline/tank01/` | the stats provider's client, mappers, provider, roster and box scores, fixtures, ADP, headshots, the capture archive |
| `pipeline/odds/` | player props: the strict parser, snapshot, name resolution, historical backfill |
| `pipeline/preseason/` | week-one rosters and depth charts, the published boards and their thin-run gate, the nightly ADP capture |
| `pipeline/commands.py`, `pipeline/__main__.py` | the command line: every ingest, its transaction, its exit status |
| `parity/` | the harness: scratch databases, replay, recording, the passes, the row diff, the cases, the TypeScript driver in `parity/ts/` |
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
   record page says so. The loader sets `typescript` on every legacy row.
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
--against` the Neon database; start the Python nightly. Run 2026-10-12 against the dev copy:

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
`parity_*` leftover when a run starts.

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

Rows compared per case add every table of every pass of every case, so a shared prerequisite (the
25,000-person universe several cases land first) counts once per case and pass; the deduplicated
total counts each tested table per pass and each prerequisite table once, at its largest.

| Case | Pass | Tables (rows compared) | Differences |
|---|---|---|---|
| nflverse-universe | first | players 24,853 | 0 |
| nflverse-universe | rerun | players 24,853 | 0 |
| nflverse-universe | prior | players 58 | 0 |
| nflverse-universe | later | players 24,853 | 0 |
| nflverse-season-2024 | first | players 24,853 (setup); player_week_observations 151,240; player_week_teams 7,551; team_week_observations 1,056 | 0 |
| nflverse-season-2024 | rerun | players 24,853 (setup); player_week_observations 151,240; player_week_teams 7,551; team_week_observations 1,056 | 0 |
| nflverse-season-2024 | prior | players 58 (setup); player_week_observations 898; player_week_teams 44; team_week_observations 5 | 0 |
| nflverse-season-2024 | later | players 24,853 (setup); player_week_observations 151,590; player_week_teams 7,551; team_week_observations 1,056 | 0 |
| nflverse-season-2012 | first | players 24,853 (setup); player_week_observations 10,696; player_week_teams 764 | 0 |
| nflverse-season-2012 | rerun | players 24,853 (setup); player_week_observations 10,696; player_week_teams 764 | 0 |
| nflverse-season-2025 | first | players 24,853 (setup); player_week_observations 1,954; player_week_teams 977; team_week_observations 132 | 0 |
| nflverse-season-2025 | rerun | players 24,853 (setup); player_week_observations 1,954; player_week_teams 977; team_week_observations 132 | 0 |
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
| tank01-roster-and-lines | first | provider_players 1,373; provider_stat_lines 944 | 0 |
| tank01-roster-and-lines | rerun | provider_players 1,373; provider_stat_lines 944 | 0 |
| tank01-schedule | first | provider_games 272 | 0 |
| tank01-schedule | rerun | provider_games 272 | 0 |
| tank01-adp | first | provider_players 1,373 | 0 |
| tank01-adp | rerun | provider_players 1,373 | 0 |
| tank01-headshots | first | provider_players 1,373 | 0 |
| tank01-headshots | rerun | provider_players 1,373 | 0 |
| crosswalk | first | players 24,885 (setup); provider_players 1,373 (setup); player_crosswalk 1,373 | 0 |
| crosswalk | rerun | players 24,885 (setup); provider_players 1,373 (setup); player_crosswalk 1,373 | 0 |
| tank01-capture-all | first | capture_snapshots 11 | 0 |
| tank01-capture-all | rerun | capture_snapshots 11 | 0 |
| tank01-capture-harvest | first | capture_snapshots 5 | 0 |
| tank01-capture-harvest | rerun | capture_snapshots 5 | 0 |
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
