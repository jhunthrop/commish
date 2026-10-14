# The Rest-of-Season Board Round: Preregistration

**Written:** 2026-10-14, before any fit of this round ran and before any 2025 outcome was read by
anything in it.
**Brief:** `.superpowers/sdd/2026-10-12-prep-site/lane-18-brief.md` (Lane 18). Founder ruling
2026-10-14: "we can't leave stale rankings during the season so it needs to be accurate and fresh -
ship it."
**Pattern:** the weekly projection round (`2026-10-13-weekly-projection-preregistration.md`): a
round that fails its gates ships nothing, and a failed judgment is final, never rerun on 2025. That
round failed; this is a new model with a new preregistration, not a rerun of it.
**Results:** `docs/research/2026-10-14-rest-of-season-results.md`, with every number in
`2026-10-14-rest-of-season-results.json` beside it, reported whether the gates pass or not.

## Founder rulings this document is bound by

- **2026 outcomes are the pristine held-out year** (2026-09-02). No fit and no gate of this round
  reads a 2026 outcome (G4 below tests it).
- **No mock data, no file-sourced data at runtime.** Every input is a stored observation; the
  fitted numbers, if the round passes, live in `model_artifacts`, versioned and pinned.

## What the store holds, established before this was written

- **The stale board.** The board a drafter sees all season today is the preseason board,
  `commish_board_v9_{ppr,half,std}_12`, built by `model.preseason.persist.build_season`. For a past
  season the same builder takes the replay moment (one millisecond before the season's earliest
  game-derived observation) and reads only what was stamped before it. In the round's scratch copy
  it builds 2023 (545 players per format), 2024 (529) and 2025 (542, moment
  2025-09-05T23:59:59.999Z). It cannot build 2021 or 2022: the store holds no week-one roster for
  either (`preseason_rosters` has 2003-2020, 2023, 2024, 2026). The archived 2021-2024 rows in
  `preseason_projections` were made by the oracle's older code, PPR only, and differ from today's
  builder on the same season (2024: 528 players compared, 2,495 point fields off by more than
  1e-6), so a model fit on them would shrink toward a different board from the one it runs on.
- **2025's season.** The dev copy holds 2025 only from play-by-play. The round's scratch copy
  (`lane18_ros` on the local test server, port 5433, restored from a dump of the dev copy's
  `research` schema taken 2026-10-14) adds, through the house's own ingests
  (`model/ros/scratch.py`): 2025's published weekly stats (`ingest_season`: 6,655 stat lines, 7,565
  participation rows, resolution 0.997) and its week-one roster (`ingest_week1_rosters`: 2,908
  written of 3,047). The injury-filing ingest wrote **0** observations for 2025: nflverse's 2025
  `injuries_2025.csv` carries no `date_modified`, so no 2025 filing can be placed in time. The dev
  copy itself is only read.
- **Designations.** The archive table `nflverse_injuries` holds 2025's weekly report statuses with
  no publication time (5,783 rows, every `date_modified` null). The weekly roster statuses
  (`nflverse_roster_weeks`, the IR list) carry no stamp either, and the store holds 2026's only for
  week 1: nothing refreshes them in season. A model that read either could not be replayed on 2025
  honestly, nor run nightly the same way. So **the round's model does not read designations**; it
  reads absence where the lines show it (below). This is the one place the model departs from the
  brief's wording, and the reason is the store, not a choice.
- **In-season consensus.** The only consensus the store holds for 2025 is one FantasyPros ECR
  capture stamped 2025-09-08 (`preseason_rankings`, `fantasypros_ecr_ppr`), the preseason ranking
  the register's ECR column reads. There is no 2025 in-season consensus capture, so **G5 is not a
  gate** (as the brief provides). The preseason ECR is reported beside the stale board, ungated.
- **Red-zone touches** come from play-by-play (`nflverse_pbp_player`), which the store holds through
  2025 and not for 2026 (no 2026 play-by-play is ingested in season). A model that read them could
  not run nightly, so they are not used.

## The model: `commish_ros_v1`

For a season S and a week W, the projection is made at **one millisecond before week W's first
kickoff** (`model.weekly.inputs.week_moment`) and sees every observation stamped at or before it:
the published stat lines and usage of S's weeks 1 to W-1, the club edges, the schedule (published
in May), and the stale board. It projects each player's points over his club's games in weeks W
through 17 (week 18 is outside most leagues' seasons), in each format f of PPR, half PPR and
standard.

**The universe** at (S, W) and position p: every player on the stale board at p, and every player
at p (`players.position`) who has played a game of S before W. A game is *played* when the player
has a published stat line that week or offensive snaps.

**His club and his games.** His club is the club of his latest (season, week) edge in
`player_week_teams` as of the moment (the season-aware rule Lane 12 named,
`latest_teams_by_season`), else the stale board's club. His remaining games are his club's
scheduled games in weeks W..17 (`nflverse_schedule`, so byes are already out), H of them. His
club's games so far are T; he played G of them; his *absence streak* s is how many of his club's
most recent games in a row he did not play (0 if he played the last one).

**Per-game rate.** With p_f his stale board's points a game in f (projected points over expected
games), r_f his season-to-date points a game in f over the games he played, and o_f his
season-to-date *opportunity points* a game (below):

    u_f = alpha * r_f + (1 - alpha) * o_f
    m_f = (k * p_f + G * u_f) / (k + G)

so the shrinkage weight toward the season so far is G / (k + G), set by games played. A player off
the stale board takes p_f = the fitted off-board rate of his position (`offboard_rate`). With G = 0,
m_f = p_f.

**Opportunity points.** Per position and format, an ordinary least-squares line of a game's points
on that game's targets, carries, pass attempts and offensive snap share (with an intercept), over
every played game of 2021-2024 weeks 1-17 at the position. o_f is that line at the player's
season-to-date means. (Snap share is the share of his club's offensive snaps; a game with no
participation row takes snap share 0.)

**Availability.** With a his stale board's expected games over 17 (capped at 1; off the board, the
fitted `offboard_availability` of his position):

    q = (k_q * a + G) / (k_q + T)

If s = 0 every remaining game is played with probability q. If s >= 1, his next game takes the
fitted return rate `return_next[min(s, 3)]` and each game after it `return_later[min(s, 3)]`
(pooled over positions). Expected remaining games E is the sum over his H games.

**Projection.** R_f = m_f * E. The board in f ranks by R_f; value over replacement, tiers and ranks
are the house's (`model.decide.value`) on R_f, so the board keeps its fields.

**Interval.** Floor, median and ceiling are R_f times the 10th, 50th and 90th percentiles of
(actual rest-of-season points / R_f) over the fit population with R_f > 0, per position, format
and horizon band: early (W 2-5), middle (W 6-10), late (W 11-15). numpy's linear interpolation. A
player with R_f = 0 has floor, median and ceiling 0. The 80% interval is [floor, ceiling].

## Fitted quantities and the fit seasons

| Quantity | Per | Fit on |
|---|---|---|
| opportunity line (5 coefficients) | position, format | 2021-2024, weeks 1-17, every played game |
| k, alpha | position, format | 2023, 2024 |
| k_q | position | 2023, 2024 |
| return_next, return_later | streak 1, 2, 3+ | 2023, 2024 |
| offboard_rate | position, format | 2023, 2024 |
| offboard_availability | position | 2023, 2024 |
| interval ratios (p10, p50, p90) | position, format, band | 2023, 2024 |

Everything that shrinks toward the stale board fits on **2023 and 2024**, the seasons today's
builder can make that board for (2021 and 2022 cannot be used, above). Both are out of sample for
the preseason board itself (`preseason/priors` fitted on 2021-2022, held out 2023-2024), as 2025 is.
The opportunity line needs no board and fits on all four of the brief's seasons.

**Fit weeks:** W = 2..15 of each fit season, the projection at W and its outcome over W..17.
**Fit population** at (S, W, p): the population defined under Statistics, so the fit and the gates
see the same kind of player.

**Searches.** k over {0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 32} and alpha over
{0, 0.1, ..., 1.0}, minimising the sum over the fit population of RoS games played times (m_f
minus the actual RoS points a game played)^2, over players with at least one RoS game. k_q over
{1, 2, 3, 4, 6, 8, 12, 16, 24, 32}, minimising the sum of (E minus actual RoS games played)^2 over
fit-population players with s = 0. return_next is the share of streak-s players who played their
next club game; return_later is games played over club games scheduled after the next one. The
off-board rate and availability are the fit population's off-board players' mean RoS points a game
and RoS games over club games. A tie in a search takes the smaller k, alpha or k_q.

**Refused by name:** every fit refuses 2025 and 2026 (`assert_fit_seasons`).

## Judgment

**Season 2025, weeks 4, 8 and 12**, named here before the fit: each at its moment, against the
actual points of weeks W..17 (`stat_lines_for_measurement`, read at the far future so a correction
counts; a player with no line in a week scored 0 that week). Read once.

## Baselines

1. **The stale preseason board** (gated, G1 and G2): `commish_board_v9_{f}_12` for 2025 as built at
   its replay moment, ordered by its season projected points, in the same format.
2. **Season-to-date form** (reported): r_f times his remaining club games H.
3. **The preseason consensus** (reported): the 2025-09-08 FantasyPros ECR (PPR) rank.
4. **An in-season consensus** (named by the brief, **refused, not scored**): the store holds none for
   2025 (above).

## Statistics

**Population** at (S, W, p, f): the union of the stale board's top K at p by projected points in f
and the top K at p by season-to-date points in f (weeks before W), with K = QB 36, RB 72, WR 108,
TE 36 (three times the brief's starter counts). It is defined without the model, so it favours
neither source. Every source is scored on the same players; a player no source has an opinion on
(off the stale board, for the board) ranks below every player it has.

- **S1, ordering.** Spearman's rho (Pearson on average ranks, `model.backtest.spearman`) between a
  source's order and actual RoS points, per (W, p, f).
- **S2, starters' rank error.** Within the population, ranks by each source and by actual RoS points
  (average ranks, highest first); over the players whose actual rank is within the top N (QB 12,
  RB 24, WR 36, TE 12, the brief's starters), the mean of |source rank minus actual rank|.
- **S3, coverage.** The share of the population whose actual RoS points lie within [floor, ceiling].

## Gates

All must pass. **A gate that cannot answer fails.**

- **G1, ordering against the stale board.** For each W in {4, 8, 12}, p in {QB, RB, WR, TE} and f in
  {PPR, half, standard} (36 cells): model rho minus stale-board rho **>= +0.02**, over a population
  of at least 20.
- **G2, the starters.** In the same 36 cells: the model's mean rank error among the top-N finishers
  **<=** the stale board's.
- **G3, calibration.** For each p and f (12 cells), pooled over the three judged weeks: the 80%
  interval's coverage **within [0.75, 0.85]**, over at least 60 player-weeks. The brief's "at each
  judged week" is honoured by reporting each week's coverage; the gate pools the three weeks
  because a single week's cell (36 quarterbacks) carries a sampling error of about 0.07, wider than
  the tolerance itself, so a per-week cell could not tell a calibrated interval from a broken one.
- **G4, isolation.** No 2026 outcome is read by any fit or gate: every outcome read of the round
  goes through one reader that refuses 2026 always and 2025 inside a fit, and records each season
  it served; the gate passes when the record holds only the fit seasons and 2025, and when the
  judgment leaves every row of `preseason_projections`, `preseason_board_reasons`,
  `register_freeze_rows`, `register_grade_rows` and `model_artifacts` as it was (a digest before
  and after). Tested by unit tests at the reader.
- **G5, consensus:** not a gate. The store holds no 2025 in-season consensus.

The thresholds live in one constant (`model/ros/gates.py`), read by the judgment and any later
harness; tests sit at each threshold.

## Multiple comparisons

No bootstrap and no confidence statement: each gate is a conjunctive point comparison across all
its cells, so adding cells can only make passing harder. The judgment is run once.

Reported and **not** gated: every cell's rho, rank error and coverage for each source; per-week
coverage; points MAE of R_f; the form and preseason-ECR baselines; the fitted numbers.

## Development check, and what it may change

Before the judgment, the identical code runs once as a development check: fit on 2023 alone,
judged on 2024 weeks 4, 8 and 12 (2024 is a fit season of the final model, so its numbers decide
nothing; they are recorded in `2026-10-14-rest-of-season-dev-check.json`). After it, only
**defects** may change (code that does not do what this document says), each recorded here as an
amendment with the check's numbers and committed before the judgment. No model choice, grid,
population, statistic, threshold or judged week changes after the check.

## Decision rule

- **All gates pass:** once the product season has kicked off (the run date against the first
  kickoff, never a flag), the nightly's board step serves `commish_ros_v1` in every format the run
  carries; the rows keep their fields and become rest-of-season figures, and the row and the
  format's basis say "rest of the 2026 season from week N, refreshed <run date>". The fitted numbers
  are published to `model_artifacts` and pinned. Preseason runs are unchanged.
- **Any gate fails:** nothing ships. The board stays the preseason projection with its caption; the
  results file reports every number; the model is not retuned and rerun against 2025.

## What would make this document wrong

A judgment run more than once, or after any change to the model, the fit or the statistics not
recorded as a defect amendment here, voids it; the results file must then say so.
