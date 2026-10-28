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
| `nightly` | `research.nightly run`: ingest (capture harvest, ADP in four formats, pre-kickoff props, win totals), fit check, capsules, the run to R2, the gates, the headshots | 05:30 UTC (after the 00:00 ET capture pass, which is 05:00 UTC once daylight time ends) | `adp-snapshot`, `props-preseason-snapshot`, `win-totals`, `capsule-sweep`, the board's nightly check |
| `nightly-publish` | `research.nightly publish`: the passed run public an hour after it passed, the web build dispatched, and `published_boards` set to the public run's boards (the API's read of the site's order); the newest injury capture written beside the run (`designations.json`) and into the table, the build dispatched again when the run's players on a season-long list move (Lane 63) | hourly, all day | nothing (new: early access, spec §4) |
| `inseason` | `research.inseason --task season-week`: on the Thursday pass, the Tank01 player list before the freeze (`player-list`, Lane 160), stats (nflverse `stats_player`), the season's play-by-play and charted feeds (FTN charting, Next Gen Stats, PFR advanced stats; `inseason/usage_steps.py`), opponent ratings, the game table, kicking and team-defense weeks and their stat lines, ESPN's public weekly projection for the coming week (`espn-projections`, Lane 114: one request a pass, three a week), props, grade, freeze, the ESPN fill of a freeze that kept no ESPN read (`espn-fill`, Lane 146), scoreboard | Tue 08:00, Wed 18:00, Thu 14:00 America/New_York, September through February; the season is the one the stored schedule places today, and a date none places fails the pass | `season-week` |
| `inseason-capture` | `research.inseason --task capture-harvest`, and while a kicked-off game has no final one `getNFLGamesForWeek` call for the games' statuses (Lane 80, at most two an hour, about 390 a season with the 9:30 ET and late Saturday windows); a game that answer still has scheduled or under way 3 h 30 m past its kickoff (so the 00:00 ET pass reaches an 8:15 pm ET kickoff before the nightly), or a stored schedule game it leaves out (named `<gameID> absent from the week feed`), with no final held, gets its own `getNFLBoxScore` in the same pass (Lane 101, B75: at most two a pass, the longest waiting first, on what is left of the pass's ten requests; kept under `tank01_game_box_score`, read through the same status mapper, the week's read standing; a provider failure fails the pass every time, while a refused answer is asked at most three times a game (Lane 116, B76): the first refusal in a row fails the pass, so the job alerts once, and the later refusals and every capped pass log `FAILED` for that game without failing the pass, until its final lands or an answer that reads starts the count again) | hourly 06:00-23:00, 00:00 and 02:00 America/New_York (the 00:00 pass reads a Monday or Thursday night final before the 05:30 UTC nightly) | `capture-harvest` |
| `inseason-status` | `research.inseason --task capture-status` (Lane 263): the injury designations and the inactives alone (two requests), the newest injury capture dated for the API, then the hourly week reads pass | 15, 30 and 45 past the hour, Sunday 10:00-20:45, Thursday 18:15-20:15, Monday 17:15-20:15 America/New_York, September to February (the hourly harvest is the :00) | `capture-harvest`, the status feeds only; a harvest running past 15 minutes overlaps a status pass, and both read the hourly day budget before either records, so the day can overshoot by one pass ($0.05), accepted |
| `headshots` | `research.headshots sync`: every provider player's headshot copied once a season into the images bucket `commish-images` as webp at eight widths, at most two fetches a second, a copy never fetched twice, a curated one never overwritten (Lane 241, `research/README.md` "Our headshot copies"); `research.headshots curate` by hand or through `ops.yml` | daily 04:00 ET in August, Wednesday 04:00 ET September through February | nothing (new: the faces were the provider's images, read at request time) |

The round 4 history (Lane 66b) is four operator commands, each idempotent and run once per store for
2016 on: `pbp-plays` (nflverse's plays into `nflverse_pbp_plays`), `depth-chart-weeks` (the weekly
charts into `nflverse_depth_chart_weeks`), `charted-history` (Next Gen Stats from 2016 and PFR
advanced stats from 2018 through the weekly pass's own ingests) and `game-weather` (`game_weather`,
from the game table, the gamebook line and NOAA ISD; it reads `research.stadiums` for the stations).
The live season keeps them current through the weekly pass (`play-by-play` writes the play table, the
`depth-charts` step adds the season's newer dated snapshots) and the hourly `inseason-capture`, which
in each kickoff slot's two hours takes Tank01's projection for the slot's week, the anytime-touchdown
market from the us, us2 and eu books (three credits an event), and the depth charts again, then parses
every stored projection snapshot in a transaction of its own (`pipeline/kickoff_slots.py`). It also
reads the week ahead's projection once a day (Lane 97, `pipeline/tank01/projections.py`
`daily_capture_due`): the week ahead is the first week with a game still to come, from the stored
kickoffs, never the calendar; its read is due from 06:00 Eastern on the day after the previous week's
last kickoff (at most six days before its own first kickoff's day) until that first kickoff, on the
first pass at or after 06:00 each day, and never in a pass that takes a slot's read. A read equal to
the newest stored snapshot writes none and the earlier snapshot stands. A week the provider has not
published yet (a 404, an `error` envelope, an entirely empty body, or the week with its player map
present and empty) is logged as `tank01_projections: unpublished, ... week N not published yet`, stores
nothing, counts as no read and never fails the pass, so the next hour reads again; any other failed
read is the pass's failure and is retried the next hour. A non-empty payload without the player map,
or one that is not an object, is drift: stored, and refused by the parse (its FAILED line, exit 1). An
empty payload is never stored, so none can fail a later pass. A slot's read treats an unpublished week
and an empty body as failures, stores neither and reads again in its window. A slot whose read matched
the morning's snapshot (unchanged) counts as read and is not repeated. One provider request a day:
three a week for a Thursday week (Tuesday, Wednesday, Thursday), at most seven for a week after a long
gap, plus one an hour, at most 17 a day, while unpublished.
`depth-chart-check` is the round 4 stamp check (it writes nothing; its recorded run is the
coordinator's).

The return dates (Lane 110, B79). The player list (`getNFLPlayerList`, source `tank01_player_list`) is
the one Tank01 feed carrying each listed player's expected return (`injury.injReturnDate`, YYYYMMDD); the
hourly injuries by date carries none, and the 32-request roster sweep does not fit a pass.
`inseason-capture` reads it once an Eastern day, on the first pass at or after 06:00 that has a request
left: last in the pass, after the game status, on what the capture and the status left of the ten
(`pipeline/tank01/capture.py` `capture_return_dates`). A pass with none left logs
`tank01_player_list: budget-refused, 0 requests, left for a later pass, ...` and the next hour asks. A
read equal to the newest stored list writes none and counts as the day's; a failed read or a list with
no players stores nothing and fails the pass, and the next hour asks again. Lane 160 (B138) reads it twice
more where a moved date costs a lineup: on a game day of the current week the first pass at or after 09:00
Eastern reads it again the same way (`return_dates_due`), and the Thursday 14:00 `season-week` pass reads
it first, before its freeze (step `player-list`, one request, `read_player_list`; any other pass skips it by
name, a failure fails that step alone). About eleven requests a week, some 200 a regular season (plus one
an hour while a read fails). The API reads the newest list within
48 hours of the injury list beside each designation (`api/internal/boards/designations.go`
`returnDates`): a return date counts only under the same status, as a real day no earlier than the
list's own, and becomes the designation's `return_week`.

The weekly kicker and team-defense sub-round's data (Lane 156, Amendment 7 items 3 and 9). Three
operator commands, each idempotent and run once per store after revisions 0020 and 0021: `pbp-plays
--first 2016 --last 2026` fills the play table's new kick columns (`kick_distance`, the field-goal,
extra-point and two-point results, `kicker_player_id`, `td_team`, the punt-block, return and safety flags)
on every stored play that holds them NULL, never rewriting a stored value, and inserts any play not yet
stored (a re-run writes nothing; the weekly `play-by-play` step writes the columns from then on);
`espn-kdef-archive` reads ESPN's archived weekly kicker and D/ST projections for 2023 and 2024, weeks 1
to 18, once each (36 public requests, no sign-in; a week already held is not read again) into
`espn_kdef_archive_rows`, a benchmark never read by a fit, every row stamped `archive_unstamped` (ESPN
publishes no stamp for an archived split; it is taken as ESPN's last pre-game version, which can only
favour ESPN); `team-defense-ids` gives each of the 32 synthetic `team-def:<code>` rows its D/ST's ESPN id
(`-16000 - <ESPN club id>`, `-16026` the Seahawks), so ESPN's D/ST projections join a defense through
`players.espn_id` as a kicker's join him (the `kdef` and `crosswalk` commands' seed does the same from
now on). The kicking and team-defense weeks the sub-round reads are the tables `kdef` and the weekly
`kicking-defense` step already keep; the input rule stamps them at read time
(`model/weekly4/features/kdef_weeks.py`), so they need no backfill.

The player's club (Lane 122). The same read, captured or unchanged, writes each listed player's club onto
his existing `provider_players` row in the snapshot's savepoint (`pipeline/tank01/player_clubs.py`,
`CaptureFeed.on_read`), and the line names the count (`tank01_player_list: captured, 1 requests, 2 clubs
changed`). Nothing is inserted or retired; a player off the list and a code outside the 32 keep their
club. A player the list carries as a free agent has none: his club becomes NULL (Lane 123, B101, revision
0018), counted as a change under the same ceiling, and the API answers "FA" for him (no bye, no game). A read that would change more than 60 clubs writes none and fails the pass (the job
alerts) while its snapshot stands; the day's read is not taken, so the next hour asks again. The operator's
one-shot `python -m research.pipeline player-clubs [--dry-run]` applies the newest stored list with no
ceiling, its count first. A day with more than 60 club changes (cut-down day) refuses the write and
alerts every hour until an operator runs `python -m research.pipeline player-clubs`. The API, the nightly's board and the capsules read the column as before. The
parity case `tank01-capture-harvest` covers the write (its later pass lands the 2026-10-12 list on an
earlier one, `parity/fixtures/tank01-player-list-earlier`, that had McCarthy at MIN; Sharpe, listed a free
agent, is cleared on every pass).

A moved game (Lane 110, B77b). The `tank01-schedule` ingest (an operator command,
`python -m research.pipeline tank01-schedule`; no job runs it on a schedule, so run it once a game has
moved, as for week 18's flexed games) marks a stored game `superseded_by` the new id when the provider's week no longer lists its id but lists the same two clubs under another (a date
change); every schedule read, the API's and research's, leaves a superseded row out, and an id listed
again is a game to play again. A game the week drops with no such pair is left as it stands. The parity case
`tank01-schedule` covers it (Lane 116): its later pass lands the recording on an earlier week 18 that listed two
games a day earlier (`parity/fixtures/tank01-2026-week18-moved`), and both earlier rows are kept, retired.

The order of a Thursday's passes, all America/New_York (Lane 93 sets the register's order on the
Thursday pass, in the 12 hours before the first kickoff):

1. 06:00 `inseason-capture`: the day's read of the week ahead's projection (Tuesday's and Wednesday's
   06:00 reads already stand), parsed into `tank01_projection_rows` in the same execution.
2. 14:00 `inseason` (`season-week`): its `espn-projections` step reads ESPN's public projection of the
   week (Lane 114) and keeps it in `espn_projection_rows`; then the freeze sets the week's order, keeps
   `espn_points` from the newest such read at or before it, and keeps `published_points`
   from the newest projection snapshot captured at or before 14:00, that morning's or an earlier
   day's (`model/register/freeze.py` `week_published_points`). The capture also fires at 14:00, so
   the freeze is certain to see the reads up to the 13:00 pass; a 14:00 read (only if every earlier
   one found the week unpublished) may or may not land before it. When that pass's ESPN read failed, the
   freeze keeps no `espn_points`; the next pass before the first kickoff reads ESPN again and its
   `espn-fill` step fills the freeze's empty rows from the first read after it, keeping the read's
   instant in `espn_read_at` (Amendment 6, Lane 146). A read at or after the first kickoff never fills.
3. 19:00 `inseason-capture`: the first pass inside the Thursday slot's two hours (18:15 to 20:15 for
   a 20:15 kickoff) reads the slot's projection; it is after the freeze and never changes it. No scheduled pass runs between the Thursday 14:00 Eastern pass and the first kickoff, so when that pass's own ESPN read fails the fill needs a hand re-run of `season-week` before kickoff (`gcloud run jobs execute inseason --region us-east1 --wait`); it does not heal on its own.

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
`crosswalk`, `provider-names`, `team-defense-ids`, `capture-harvest`, `player-clubs`, `adp-snapshot`, `kdef-adp`, `current-ecr`, `props-snapshot`,
`props-resolve`, `win-totals-seed`, `win-totals`. Not atomic, committing where the TypeScript's
writes become durable, because the TypeScript writes outside a transaction there and a re-run is
how a stopped run finishes: `season`, `context`, `derived-stat-lines`, `kdef`, `kdef-lines`, `pbp-plays` (after each
season), `espn-kdef-archive` (after each week), `tank01-roster`
(after the roster and after each week), `preseason`, `props-backfill` (after each event). Inside a
command, each capture feed and each published board runs in its own savepoint, so one failed feed
or board is reported and the rest are kept, as the TypeScript carries on.

The Tank01 store holds one season: `tank01-roster` and `tank01-schedule` first retire every row
of any other season (`retire_other_seasons`, in the same transaction as the write), so the first
write of a new season starts it clean. `tank01-roster` never rewrites a stored club
(`provider_players.team`): the daily list (`player-clubs`) owns it, and the seed sets a club only on a
row it creates, as its printed report says (Lane 127). That club is the daily list's by its own rule
(Lane 144): none for a player the list marks a free agent, whose listed `team` is his last club. No job
runs the seed; it stays the operator's, as the only writer that inserts a `provider_players` row (the
daily list inserts none) and the remediation the register's grade names.

## Scheduled jobs (the registry)

| Job | Schedule today | What it ingests or does | Python destination |
|---|---|---|---|
| `season-week` step `stats-ingest` | Tue 08:00, Wed 18:00, Thu 14:00 ET | nflverse universe, snap counts, weekly stats into `players`, `player_week_observations`, `player_week_teams`, `team_week_observations` | `pipeline.nflverse.ingest.ingest_player_universe` + `schedule_week_as_of` + `ingest_season` (phase A, parity `nflverse-season-*`) |
| `season-week` steps `play-by-play`, `ftn-charting`, `next-gen-stats`, `pfr-advstats`, `depth-charts` | same | the season's play-by-play (team and player facts, passer dropbacks, the play table) and the three charted feeds into `player_week_observations` and `team_week_observations`, and the depth charts into `nflverse_depth_chart_weeks` | new in Python (Lane 23): `inseason.usage_steps`; `--task usage-backfill` runs them alone |
| `season-week` step `game-table` | same | nflverse's game table for the season into `nflverse_games` (kickoffs, venues, figures, roofs, recorded weather), one stamped row per game, the current state only, and each pass's read append-only: the venue and kickoff in `nflverse_game_reads`, each club's figures as the `nflverse_game_figures` team-week source | new in Python (Lane 66a): `pipeline.nflverse.games.ingest_games` |
| `season-week` step `opponent-ratings` | same | each club's opponent's pass and rush defence ratings (`commish_opponent_adjustment`) into `team_week_observations`, for every week whose earlier games are all in the stored play-by-play (a game that never gets play-by-play, a cancellation or a no contest, holds every later week back until an operator sees it in the step's counts) | new in Python (Lane 44): `pipeline.nflverse.context.ingest_opponent_defence_to_date`, the weekly number's opponent factor (`docs/research/2026-10-15-weekly-projection-round2-preregistration.md`) |
| `season-week` step `kicking-defense` | same | the season's kicking and team-defense weeks into `nflverse_kicking_weeks` and `nflverse_team_defense_weeks`, then both as stat lines (field goals made and missed by distance, extra points; sacks, interceptions, fumble recoveries, defensive and return touchdowns, safeties, blocks, points and yards allowed) into `player_week_observations` under `nflverse_kdef_week`, a defense keyed `team-def:<code>` (the crosswalk's `DST-<abbr>`), each line stamped as its club's lines that week; `python -m research.pipeline kdef-lines` is the same for a range of seasons | new in Python (Lane 70a): `pipeline.nflverse.kdef_lines.refresh_kdef_season` |
| `season-week` step `props-snapshot` | same | The Odds API props into `player_prop_observations` | `pipeline.odds.ingest.run_odds_snapshot` (phase A, parity `odds-snapshot-and-resolve`) |
| `season-week` steps `grade`, `freeze`, `espn-fill`, `scoreboard` | same | the register (`register_freeze_rows`, `register_grade_rows`); `espn-fill` sets `espn_points` and `espn_read_at` only on a standing freeze that kept no ESPN read (Lane 146) | `research.model` (phase B, register parity) |
| `season-week` steps `peek-facts`, `peek-documents` | same | the old app's peek tables | not carried: the research schema has no peek tables (README) |
| `capture-harvest` | 00:00, 02:00 and hourly 06:00-23:00 ET | five Tank01 feeds into `capture_snapshots`, the game lines feed asking for every game day left in the week (Lane 66a) | `pipeline.tank01.capture.run_capture_harvest` (phase A, parity `tank01-capture-harvest`) |
| `capture-harvest` (right after the feeds) | same | the newest injury capture the API reads, dated into the API's `app.designation_datings` (one row per capture digest, the run read and the digest the API's, pinned by `api/testdata/designation-dating.json`), so no API instance dates a capture behind a request; the dating commits with the capture, in a savepoint of its transaction, so a failed dating rolls back only itself and no instance sees the capture undated between two commits (Lane 141, B116); a capture dated already is one keyed read; the run read is bounded at 30 s; the step logs any failure on its own line and never fails the hour (the API dates the capture itself meanwhile), including when none of the 5 newest captures reads during a provider glitch, except a missing grant (`permission denied`), which fails the pass every hour until it is granted; the job's role needs `usage` on schema `app` and `select, insert, delete` on the table, kept in the API's migration 00030 (Lane 141); the nightly's capture does the same | new in Python (Lane 134, B115): `nightly.designation_dating.date_newest_capture` |
| `capture-harvest` (after the feeds) | same | the hour's game figures from the newest odds capture into the `tank01_lines` team-week source, stamped at the pass, then the weather service's kickoff forecasts for the games from the Tuesday of their week into the `nws_forecast` team-week source (one grid read per venue an hour, the cell cached in `nws_grid_points`) | new in Python (Lane 66a): `pipeline.tank01.lines.lines_after_harvest`, `pipeline.nws.forecast.run_forecast_pass` (the round 4 preregistration, section 2.5) |
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
| (new, Lane 66a) | `games --first 2016 --last 2026`: `nflverse_games`; `stadiums`: the reviewed seed `data/stadiums/stadiums.csv` into `stadiums`, validated against `nflverse_games`; `lines-backfill`: every stored odds capture into `tank01_lines`; `forecast`: one forecast pass | `pipeline.nflverse.games`, `pipeline.stadiums`, `pipeline.tank01.lines`, `pipeline.nws.forecast` |
| `coaches-ingest.ts` | the committed play-caller seed into `coaches` | `pipeline.coaches.ingest_play_callers_csv` (phase A, parity `coaches-seed`, run as is) |
| `npm run seed` (`seedPlayers`) | the Tank01 roster into `provider_players`, box scores into `provider_stat_lines` | `pipeline.tank01.ingest.ingest_roster_and_lines` (phase A, parity `tank01-roster-and-lines`) |
| `stats:schedule` | Tank01 fixtures into `provider_games` | `pipeline.tank01.ingest.ingest_schedule` (phase A, parity `tank01-schedule`) |
| `stats:adp` | Tank01 ADP onto `provider_players.adp` | `pipeline.tank01.ingest.ingest_adp` (phase A, parity `tank01-adp`) |
| `scripts/backfill-headshots.ts` | headshot URLs onto `provider_players` | `pipeline.tank01.ingest.backfill_headshots` (phase A, parity `tank01-headshots`, RE-ASSEMBLED, body hash pinned) |
| `stats:capture` | every capture feed into `capture_snapshots` | `pipeline.tank01.capture.capture_once` (phase A, parity `tank01-capture-all`) |
| `stats:ingest` (the live-scoring worker tick) | Tank01 box scores during a live week, then league settlement, lineups and score pushes | not ported: league platform machinery. The box-score write it shares with the seed is ported as `ingest_roster_and_lines`; phase D decides whether the nightly needs an in-season box-score cadence |
| `projections:*:fit`, `projections:preseason:persist`, `projections:register:*` | fits, the board, the register | `research.model` (phase B) |
