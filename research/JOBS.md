# Jobs and ingests: where each one runs today, and where it lands in Python

The TypeScript core's job registry (`src/jobs/registry.ts`, schedules in `src/jobs/schedules.ts`,
driven by the Vercel cron `/api/jobs/tick` every minute) and the operator scripts that write the
research tables. The TypeScript bodies now live in `research-ts/` (the oracle; its own inventory is
`research-ts/JOBS.md`). "Python destination" is the function this lane ported (phase A) or the
phase that ports it. The nightly chain that will call these on Cloud Run is phase D; until it is
live, the Vercel cron keeps running the TypeScript on the schedules below, into the legacy tables.

## Where each job runs from cutover (phase D)

Cloud Run Jobs from the `research` image, each started by a Cloud Scheduler job (`infra/README.md`,
created paused until cutover). Every invocation is one pass; the scheduler owns the cadence.

| Job (Cloud Run) | Command | Schedule | Replaces |
|---|---|---|---|
| `nightly` | `research.nightly run`: ingest (capture harvest, ADP in four formats, pre-kickoff props, win totals), fit check, capsules, the run to R2, the gates, the headshots | 05:00 UTC | `adp-snapshot`, `props-preseason-snapshot`, `win-totals`, `capsule-sweep`, the board's nightly check |
| `nightly-publish` | `research.nightly publish`: the passed run public an hour after it passed, and the web build dispatched | hourly 06:00-12:00 UTC | nothing (new: early access, spec §4) |
| `inseason` | `research.inseason --task season-week`: stats (nflverse `stats_player`), props, grade, freeze, scoreboard | Tue 08:00, Wed 18:00, Thu 14:00 America/New_York | `season-week` |
| `inseason-capture` | `research.inseason --task capture-harvest` | hourly 07:00-23:00 and 02:00 America/New_York | `capture-harvest` |

`research.pipeline history` re-creates the seasons the store lost (an operator command, run once
per store; `pipeline/history.py`).

Table names are the research schema's (`research.db.schema`); `research.db.legacy` maps each to
the legacy table the TypeScript writes (`players` was `nfl_players`, `provider_players` was
`players`, `provider_stat_lines` was `player_stat_lines`, `provider_games` was `nfl_games`,
`provider_weeks` was `stat_weeks`).

## Transactions

`python -m research.pipeline <command>` runs each command in the transaction `commands.py`
declares. Atomic (one transaction, nothing written on failure): `universe`, `schedule`,
`roster-weeks`, `draft-picks`, `coaches`, `tank01-schedule`, `tank01-adp`, `headshots`,
`crosswalk`, `capture-harvest`, `adp-snapshot`, `kdef-adp`, `current-ecr`, `props-snapshot`,
`props-resolve`, `win-totals-seed`, `win-totals`. Not atomic, committing where the TypeScript's
writes become durable, because the TypeScript writes outside a transaction there and a re-run is
how a stopped run finishes: `season`, `context`, `derived-stat-lines`, `kdef`, `tank01-roster`
(after the roster and after each week), `preseason`, `props-backfill` (after each event). Inside a
command, each capture feed and each published board runs in its own savepoint, so one failed feed
or board is reported and the rest are kept, as the TypeScript carries on.

The Tank01 store holds one season: `tank01-roster` and `tank01-schedule` first retire every row
of any other season (`retire_other_seasons`, in the same transaction as the write), so the first
write of a new season starts it clean.

## Scheduled jobs (the registry)

| Job | Schedule today | What it ingests or does | Python destination |
|---|---|---|---|
| `season-week` step `stats-ingest` | Tue 08:00, Wed 18:00, Thu 14:00 ET | nflverse universe, snap counts, weekly stats into `players`, `player_week_observations`, `player_week_teams`, `team_week_observations` | `pipeline.nflverse.ingest.ingest_player_universe` + `schedule_week_as_of` + `ingest_season` (phase A, parity `nflverse-season-*`) |
| `season-week` step `props-snapshot` | same | The Odds API props into `player_prop_observations` | `pipeline.odds.ingest.run_odds_snapshot` (phase A, parity `odds-snapshot-and-resolve`) |
| `season-week` steps `grade`, `freeze`, `scoreboard` | same | the register (`register_freeze_rows`, `register_grade_rows`) | `research.model` (phase B, register parity) |
| `season-week` steps `peek-facts`, `peek-documents` | same | the old app's peek tables | not carried: the research schema has no peek tables (README) |
| `capture-harvest` | 02:00 and hourly 07:00-23:00 ET | five Tank01 feeds into `capture_snapshots` | `pipeline.tank01.capture.run_capture_harvest` (phase A, parity `tank01-capture-harvest`) |
| `adp-snapshot` | 03:00 ET nightly | Fantasy Football Calculator ADP, three formats, into `adp_snapshots` | `pipeline.preseason.boards.ingest_adp_snapshot` (phase A, parity `adp-snapshot`) |
| `props-preseason-snapshot` | 03:30 ET daily, self-disabled after the season's first kickoff | the props snapshot, then name resolution into `props_player_map` | `pipeline.odds.ingest.run_props_preseason_snapshot` (phase A, parity `props-preseason-job`) |
| `capsule-sweep` | 04:00 ET nightly | facts and capsules (LLM) into `player_capsules` | `research.capsules` (phase C) |
| `win-totals` | Wed 05:00 ET, self-disabled after kickoff | the publisher's win totals into `team_week_observations` | `pipeline.vegas.run_win_totals` (phase A, parity `win-totals-job`) |
| `peek-document` | event-driven (no schedule) | the old app's peek documents | not carried |
| `draft-sweep` | every minute, wake-gated | live draft rooms | league platform; the prep site's rooms are Go (Lane 4/6), not research |
| `sim-run` | on request | draft simulations | Go engine port (Lane 4) |
| `draft-grades` | on a real draft's completion | `draft_grades` | league platform, not ported |

## Operator scripts that write research tables (run by hand today)

"Run as is" means the parity harness runs the TypeScript script itself, unmodified, as the oracle.

| Script (`research-ts/scripts/`) | What it ingests | Python destination |
|---|---|---|
| `projections:backfill` | universe and seasons over a range, derived gap seasons with a control-season validation | `ingest_season` per season and `pipeline.nflverse.derived_stat_lines.ingest_derived_stat_lines` (phase A); the control-season points agreement needs the scoring engine (phase B) |
| `projection-context.ts` | schedule, play-by-play, coaches observations, opponent adjustment, injury reports, injury archive, weekly rosters | `python -m research.pipeline context` (phase A, parity `nflverse-context`, run as is) |
| `projections:schedule:results`, `projections:schedule:points-allowed` | the two narrowed schedule backfills | `pipeline.nflverse.ingest_schedule` (phase A, parity) |
| `draft-picks-ingest.ts` | `nfl_draft_picks` | `pipeline.nflverse.draft_picks.ingest_draft_picks` (phase A, parity `nflverse-draft-picks`, run as is) |
| `roster-weeks-ingest.ts` | `nflverse_roster_weeks` | `pipeline.nflverse.roster_weeks` (phase A, parity `nflverse-roster-weeks`, run as is) |
| `kdef-backfill.ts` | 32 synthetic defenses, `nflverse_kicking_weeks`, `nflverse_team_defense_weeks` | `python -m research.pipeline kdef` (phase A, parity `nflverse-kdef`, run as is) |
| `kdef-adp-ingest.ts` | kicker and defense ADP into `preseason_rankings` | `pipeline.preseason.boards.ingest_kdef_adp` (phase A, parity `preseason-2025`, run as is) |
| `preseason-ingest.ts` | week-one rosters, depth charts, ADP x3, ECR; exit 2 when thin | `pipeline.preseason.boards.ingest_preseason` (phase A, parity `preseason-*`, run as is, exit status compared) |
| `ingest-current-ecr.ts` | the live season's consensus onto the crossed roster; exit 2 when thin | `pipeline.preseason.boards.ingest_current_ecr` (phase A, parity `current-ecr`, run as is) |
| `build-crosswalk.ts` | `player_crosswalk` | `pipeline.crosswalk.build_crosswalk` (phase A, parity `crosswalk`, run as is) |
| `projections:odds:snapshot`, `projections:odds:resolve` | props and their names | `pipeline.odds.ingest` (phase A, parity) |
| `odds-props-backfill.ts` | the historical props archive, budgeted | `pipeline.odds.backfill.backfill_props` (phase A, parity `odds-backfill`, run as is, first run and resume) |
| `vegas-win-totals-ingest.ts` | the committed win-totals seed | `pipeline.vegas.ingest_win_totals_csv` (phase A, parity `win-totals-seed`, run as is) |
| `coaches-ingest.ts` | the committed play-caller seed into `coaches` | `pipeline.coaches.ingest_play_callers_csv` (phase A, parity `coaches-seed`, run as is) |
| `npm run seed` (`seedPlayers`) | the Tank01 roster into `provider_players`, box scores into `provider_stat_lines` | `pipeline.tank01.ingest.ingest_roster_and_lines` (phase A, parity `tank01-roster-and-lines`) |
| `stats:schedule` | Tank01 fixtures into `provider_games` | `pipeline.tank01.ingest.ingest_schedule` (phase A, parity `tank01-schedule`) |
| `stats:adp` | Tank01 ADP onto `provider_players.adp` | `pipeline.tank01.ingest.ingest_adp` (phase A, parity `tank01-adp`) |
| `scripts/backfill-headshots.ts` | headshot URLs onto `provider_players` | `pipeline.tank01.ingest.backfill_headshots` (phase A, parity `tank01-headshots`, RE-ASSEMBLED, body hash pinned) |
| `stats:capture` | every capture feed into `capture_snapshots` | `pipeline.tank01.capture.capture_once` (phase A, parity `tank01-capture-all`) |
| `stats:ingest` (the live-scoring worker tick) | Tank01 box scores during a live week, then league settlement, lineups and score pushes | not ported: league platform machinery. The box-score write it shares with the seed is ported as `ingest_roster_and_lines`; phase D decides whether the nightly needs an in-season box-score cadence |
| `projections:*:fit`, `projections:preseason:persist`, `projections:register:*` | fits, the board, the register | `research.model` (phase B) |
