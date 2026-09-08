# Fact Sheet Inventory

**Date:** 2026-09-07. **Spec:** `docs/superpowers/specs/2026-09-07-fact-sheet-depth-design.md` §3 (Task A).

Every table and metric this store holds, against the fact sheet `src/capsules/render.ts` hands the writer. Wired in the same round unless the last column says otherwise, and every fact wired in Task B cites its row here by number.

## Method

**DEV** coverage is one grouped `count(*)` per table over the local Postgres named by `.env.local` (`localhost:5432/commish`), plus one grouped count over `player_week_observations (source, metric)` and `team_week_observations (source, metric)`.

**PRODUCTION** coverage is the identical set of queries against the Neon production database, run once, on 2026-09-07. Counts only. No row content was read, no table was scanned for values, and nothing was written, per the standing "production is for backfills only" rule. Ten queries in total: seven per-table season counts, two metric-key counts, and one `capture_snapshots` source count, plus a plain `count(*)` for five small tables and one `adp_snapshots` grouping.

Raw figures, both databases:

| Table | DEV seasons | DEV rows | PROD seasons | PROD rows |
| --- | --- | --- | --- | --- |
| `nflverse_injuries` | none | 0 | 2013-2025 | 68,270 |
| `nflverse_roster_weeks` | none | 0 | 2013-2025 | 520,106 |
| `nfl_draft_picks` | 1980-2026 | 11,084 | none | 0 |
| `player_week_observations` | 2003-2026 | 3,010,403 | 2023-2026 | 509,408 |
| `team_week_observations` | 2003-2026 | 273,858 | 2003-2026 | 7,584 |
| `player_week_teams` | 2003-2025 | 141,428 | 2024-2025 | 15,082 |
| `preseason_rosters` | 2003-2026 | 53,138 | 2026 only | 2,941 |
| `nfl_players` | n/a | 25,106 | n/a | 25,106 |
| `adp_snapshots` | n/a | 0 | 2026-09-05 to 2026-09-07, 268 players | 741 |
| `nfl_games` | n/a | 272 | n/a | 272 |
| `player_capsules` | n/a | 0 | n/a | 659 |
| `capture_snapshots` | 11 sources, 2026-08-28 to 2026-09-07 | 66 | 4 sources, 2026-09-05 only | 4 |

The two databases hold DIFFERENT halves of the archive and neither is a superset of the other. Dev is the measurement machine: deep history, no live harvest, no market. Production is the live surface: shallow history, a real harvest, a real market. Every "needs a production backfill" entry below comes from that asymmetry rather than from a fact this product cannot compute.

## The inventory

Expert value is high / medium / low. Grounding shape is what the ledger must carry for the writer to quote the line.

| # | Fact | Source table and metric | DEV seasons | Production coverage | On the sheet today | Expert value | Grounding shape |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Season-ending absence, per prior season | `nflverse_injuries.report_status` / `primary_injury`, with `nflverse_roster_weeks.status` as the fallback anchor, through `deriveSeasonEnding` | none, 0 rows | 2013-2025, full | no | high: it is the single most-cited reason a prior season reads short, and the writer cannot say "he was hurt" without it | numbers (season, last played week, first missed week), a code (`Out`, `RES`), a word (`Knee`) |
| 2 | Games missed by season | `nflverse_roster_weeks` week rows the player appears in, against the weeks he played | none, 0 rows | 2013-2025, full | no | high: durability is a price input and the sheet carried no count of it at all | numbers (season, missed, possible) |
| 3 | Injury designations this season, as a dated history | `capture_snapshots` source `tank01_injuries_by_date`, payload `injList[].designation` / `.description` | 5 captures, 2026-08-30 to 2026-09-07 | 1 capture, 2026-09-05 | only the LATEST designation, as a single tri-state | high: a run of three straight questionable weeks is a fact; one designation is a snapshot | a code (`Q`), a word (`Hamstring`), two dates, a count |
| 4 | Head coach and offensive play caller, with a new-this-year flag | `data/play-callers/play-callers.csv` (`name`, `role`), plus the new `head_coach` column | 1999-2026, 945 rows, no head-coach column yet | file ships with the repo, identical in both | only the board's own `new_play_caller` beat, which names a TEAM and no person | high: "who is calling the plays" is the first question an expert asks about a changed offence | names, a season |
| 5 | Age on opening day, seasons played, draft year and pick, drafting club | `preseason_rosters.birth_date` / `draft_year` / `draft_pick` / `draft_club`, `nfl_players.rookie_season`, `nfl_games` week one for opening day | 2003-2026 | 2026 only, 2,941 rows: enough, this fact only needs the product season | only the board's own rookie beat's overall pick | high: age is the strongest single prior on this board and the sheet never stated it | numbers (age, seasons, year, pick), a team code |
| 5b | Draft ROUND | `nfl_draft_picks.round` | 1980-2026, 11,084 | ZERO rows | no | medium: the overall pick already carries most of the signal | a number |
| 5c | College | the `tank01_injuries` harvest capture's own `school` field, on the 32-request roster sweep | 8 captures, 2026-08-28 to 2026-09-05 | ZERO captures of this source | no | medium: it is the one biographical fact a manager recognises a rookie by | a name |
| 6 | Depth chart slot and who is listed around him | `player_week_observations` source `nflverse_depth_charts`, metric `depth_team`, joined through `player_week_teams` | 2003-2026, 11,795 | 2023-2026, 2,670 | no | high: a listed slot is the cleanest read on a role the play-by-play cannot see yet | a number (slot), names, a date |
| 7 | Role trend inside a season | `player_week_observations` source `nflverse_snap_counts` (`offensive_snaps`, `team_offensive_snaps`) and `nflverse_player_week` (`targets`, `team_targets`) | snaps 2013-2025, targets 2013-2024 | snaps 2023-2025, targets 2023-2024 | no, only the year-over-year trend | high: a role that grew through a season is the classic breakout tell, and a season average hides it | numbers (two shares, four week numbers, a season) |
| 8 | Target competition, the team's top two earners | the same `targets` / `team_targets` rows, grouped by `player_week_teams.team` | 2013-2024 | 2023-2024 | no | high: "who else eats" is half of a receiver's projection and the sheet named nobody | names, shares |
| 9 | Red-zone and inside-the-ten usage, and average depth of target | `player_week_observations` source `nflverse_pbp_player`, metrics `red_zone_carries`, `red_zone_targets`, `inside_ten_carries`, `inside_ten_targets`, `air_yards`, `air_yard_targets` | 2011-2025, 72,420 per metric | 2023-2025, 15,039 per metric | only the derived red-zone SHARE of his own touches, never the counts and never the depth | high: touches inside the ten are the touchdown story, and average depth of target separates a field stretcher from a checkdown | numbers with ranks and qualifier counts |
| 10 | Team pace, pass rate and RECORD last season (wins, not points scored: `schema.ts`'s own `points_allowed` docblock says a team's own points are deliberately not stored, being its opponent's points allowed one join away, and this store carries no prior-season schedule to join through) | `team_week_observations` source `nflverse_pbp`, metrics `pace_seconds_per_play`, `pass_rate`; points from source `nflverse_kickoff` | pace and pass rate 2011-2025, kickoff 2003-2025 | ZERO `nflverse_pbp` rows and ZERO prior-season `nflverse_kickoff` rows | no | high: pace and pass rate are the environment every projection sits inside | numbers |
| 10b | Week one implied team total and spread | `team_week_observations` source `nflverse_kickoff`, metrics `implied_team_total`, `point_spread` | 2003-2026 | 2026 only, 224 rows each: exactly the product season | no | high: it is the market's own view of the team this week | numbers |
| 10c | Team Vegas win total | `team_week_observations` source `vegas_win_totals` | 2003-2026, 768 | 2003-2026, 768 | YES | high | a number |
| 11 | Week one opponent, home and road split, dome games, weeks 15 to 17 | `nfl_games` (`week`, `home_nfl_team`, `away_nfl_team`), plus `team_week_observations` source `nflverse_schedule` metric `indoors` | 272 games, `indoors` 2003-2026 | 272 games, `indoors` 2026 only | only the bye week | medium: an opponent name without a measured strength is context, not an edge, but the fantasy playoff weeks are what a manager actually plans around | team codes, numbers |
| 12 | ADP now against the oldest capture held | `adp_snapshots.adp` / `captured_at` | ZERO rows | 741 rows, 268 players, three days (2026-09-05 to 2026-09-07) | no, only the current ADP | high: a moving market price is the one fact on the sheet that dates itself | numbers, two dates |
| 13 | Weekly volatility, weeks above a stated threshold and the worst week | the same prior-season weekly lines `lastSeasonStoriesFor` already reads (`statLinesAsOfForLiveSurface`) | 2003-2025 | 2023-2025 | only the BEST week and weeks above the position median | high: the floor a manager actually feels is the bad weeks, and the sheet only showed the good one | numbers |
| 14 | The three prior seasons at a glance | the same weekly lines, one pass per season | 2003-2025 | 2023-2025, so two prior seasons in production and three from 2027 | no, only last season | high: a career arc is the difference between a decline read and a bounce-back read | numbers with ranks |

## Candidates considered and NOT wired

| Fact | Source | Why not |
| --- | --- | --- |
| Offensive line quality (`line_adjusted_line_yards`, `line_stuffed_rate`, `line_sack_rate_allowed`) | `team_week_observations` source `nflverse_pbp` | Medium value and zero production rows, the same gap as row 10. It is a team fact a writer would state as a running back's context; it belongs to the same backfill and can be wired the round after it lands. |
| Line continuity (`line_same_starters_as_previous_week`, `line_starters_used_to_date`) | `team_week_observations` source `nflverse_line_continuity` | Low value on a preseason sheet: a continuity count from LAST season says little about the line he will run behind this one. |
| Opponent-adjusted defence (`opponent_pass_defence_adjusted`, `opponent_rush_defence_adjusted`) | `team_week_observations` source `commish_opponent_adjustment` | Medium value, but it is a per-opponent number and the sheet is a season document. It is the natural fact for a weekly capsule, not a draft one. |
| Weather (`temperature_f`, `wind_mph`) | `team_week_observations` source `nflverse_kickoff` | Low value: recorded, not forecast, and only for games already played. Nothing about a season yet to start. |
| DFS salaries, projections, changelog | `capture_snapshots` sources `tank01_dfs_salaries`, `tank01_projections`, `tank01_changelog` | Low value or off-limits. A rival projection is another engine's claim, not a measured fact, and this sheet exists to carry what THIS product measured. |
| Kicking and team-defence weeks | `nflverse_kicking_weeks`, `nflverse_team_defense_weeks` | Out of scope by the existing gate: a capsule is only built for a skill player (`isSkillPosition`), a scope line `facts.ts` already records. |
| Practice status | `player_week_observations` source `nflverse_injuries` metric `injury_practice_status` | Medium value and covered only 2023-2024 in production, both of them PRIOR seasons. A practice status from a past season is not a fact about this one; the live half is row 3's capture history. |

## Needs a production backfill

| Missing in production | What it costs on the sheet | The script that fills it |
| --- | --- | --- |
| `nfl_draft_picks`, zero rows (dev holds 1980-2026) | Row 5b: the draft ROUND is absent, so the pedigree line names the overall pick and stops. Every other pedigree field comes from `preseason_rosters` and is present. | `ingestDraftPicks` in `src/projections/nflverse/draft-picks.ts`, the same one dev was filled with. One nflverse `draft_picks` release read, then `recordDraftPicks`. |
| `team_week_observations` source `nflverse_pbp`, zero rows (dev holds 2011-2025) | Row 10: last season's team pace and pass rate render as absence, so the team-context line carries only the market half. | The play-by-play ingest, `PlayByPlayAggregator` plus `playProfileObservations` in `src/projections/nflverse/pbp.ts`, driven by `src/projections/nflverse/ingest.ts` for seasons 2024 and 2025. |
| `team_week_observations` source `nflverse_kickoff`, prior seasons absent (only 2026 present) | Row 10: last season's team points scored render as absence. | The schedule ingest, `mapSchedule` plus `gameResultObservations` and `pointsAllowedObservations`, for seasons 2024 and 2025. |
| `player_week_observations` source `nflverse_player_week` metrics `targets` / `team_targets`, stopping at 2024 | Rows 7 and 8 read the 2025 target share from nothing, so the role trend falls back to snaps alone and the target-competition line is absent for 2025. | The nflverse player-week ingest for 2025, `ingestSeason` in `src/projections/nflverse/ingest.ts`. |
| `capture_snapshots` source `tank01_injuries_by_date`, one capture | Row 3 renders one designation and no history until the harvest job has run for several days. This is not a backfill so much as time: the capture job is already registered and each run adds a point. | `src/jobs/defs/capture-harvest-job.ts`, already scheduled. No action beyond letting it run. |
| `capture_snapshots` source `tank01_injuries`, zero captures (dev holds 8) | Rows 3 and 5c: the injury designations carry no body part and the pedigree line names no college. The designation itself still comes from the cheap list, which production does hold. | The same harvest job. The roster sweep is the expensive feed in it (32 requests a day), so this is a budget question rather than a code one. |

Nothing in this list blocks the wiring. Every fact above is wired the same way regardless, and each one renders as absence rather than as a zero wherever its rows are missing, which is exactly what makes running the backfill a visible improvement rather than a silent correction.

## Prompt size

Measured on 2026-09-07 with `scripts/measure-fact-sheet-tokens.ts` against the dev board, on the five players our own board ranks first.

**Method, stated because it is an estimate.** There is no tokenizer in this repository and adding a dependency to answer "did the prompt get much bigger" would be the wrong trade, so the figure is CHARACTERS DIVIDED BY FOUR, the standard rough tokens-per-character ratio for English prose. What the measurement is for is the RATIO between before and after, and that ratio does not depend on the constant. The "before" is the same render with the appended section sliced off rather than a second run against an earlier commit: the change is additive by construction, so slicing reproduces the old output exactly, on the same five players.

| Player | Before | After | Depth lines |
| --- | --- | --- | --- |
| Puka Nacua | 532 | 796 | 7 |
| Ja'Marr Chase | 503 | 821 | 9 |
| Josh Allen | 457 | 743 | 9 |
| Jaxon Smith-Njigba | 533 | 846 | 9 |
| Amon-Ra St. Brown | 486 | 815 | 9 |

Mean 502 before, 804 after. **Growth 60%.**

**The cached prefix is untouched.** The whole depth group renders as one appended section under a single heading, after every section the sheet already had, so every byte ahead of it is identical to before and a provider's prefix cache is not invalidated by the sheet growing. That was the spec's own condition for letting it grow, and it is met by construction rather than by luck.

Two notes on what these numbers do NOT say. Dev holds no `nflverse_injuries`, no `nflverse_roster_weeks` and no `adp_snapshots`, so the season-ending, games-missed, designation-history and market-movement lines rendered as absence for all five and the production sheet will be somewhat longer. Dev's `nflverse_player_week` targets stop at 2024, so the target-competition line and the target half of the role trend were absent too, for the honest reason rather than a bug.
