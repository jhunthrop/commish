# The Weekly Projection Round: Preregistration

**Written:** 2026-10-13, before any fit of this round ran and before any 2025 outcome was read by
anything in it.
**Brief:** `.superpowers/sdd/2026-10-12-prep-site/lane-12-brief.md` (Lane 12), spec
`docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md` §2.9.
**Pattern:** the kicker and defense round (`2026-09-05-kicker-defense-preregistration.md` and its
results): a round that fails its gates ships nothing.
**Results:** `docs/research/2026-10-13-weekly-projection-results.md`, written after the judgment run,
reporting every number named here whether it passes or not.

## Founder rulings this document is bound by

- In-season tools carry equal weight to the draft tools, and **no weekly number reaches a screen
  before this round passes its gates** (2026-10-13). Until it does, the in-season screens show the
  season projection and the stat lines, labelled.
- **2026 outcomes are the pristine held-out year** (2026-09-02). No fit, no tuning and no gate in
  this round reads a 2026 outcome. 2026 is registered prospectively through the register's existing
  weekly pass, and only if the gates pass.

## What the oracle had, established before this was written

The TypeScript oracle never computed and stored a weekly board. Its weekly model (opportunity times
efficiency, composed into a stat line, with the context groups it measured and shipped:
`SHIPPED_FEATURES` = scheme and game context) ran only inside `replay` and the operator reports
(`projection-report.ts`, the ablations), scored and discarded. `preseason_projections` holds season
boards only (2021-2024 and 2026), and the register's weekly pass (`register/freeze.ts`, ported in
phase D) freezes the **season** boards (`commish_board_v9_ppr_12` served, `v7` shadow) before each
week's first kickoff. No weekly board was ever frozen.

So there are no stored weekly rows to port against. The weekly layers were instead ported and
proven against the oracle running (commit `bd204f9b`, `research.parity model`):

- `weekly-projection-2025`: weeks 1, 6, 11 and 17 of 2025 through the oracle's own `replay` (its
  reads, its as-of gate, its committed `FITTED_MODEL`) on the dev copy's legacy schema, against the
  port's reads of the research schema (the two hold identical 2024 and 2025 rows). 637 players a
  week, every stat field, 0 differences.
- `weekly-layers-2024`: weeks 2, 7, 12 and 16 of 2024, the port's reads handed to the oracle's
  `modelProjection`. 681, 730, 755 and 768 players, 0 differences.
- `weekly-fit`: the oracle's four shipped fits against the port's on the oracle's own seasons
  (2021-2022, 2020 as history). Run after this document is committed, because it is a fit.

## The model: `commish_weekly_v1`

The oracle's weekly model exactly as ported, with one correction, refit on this round's seasons:

1. **Layer 1, opportunity.** Each player's snap, target, carry and pass-attempt shares, the prior
   season's level shrunk toward his position's role prior and this season's recency-weighted form
   shrunk toward that level; his club's team volume the same way toward the league mean.
2. **Scheme** (shipped by the oracle): the club's situation-neutral pace and pass lean scale its
   team volume through fitted elasticities, bounded to [0.8, 1.25].
3. **Layer 2, efficiency.** Each per-opportunity rate regressed toward the position's rate by a
   fitted number of opportunities of prior.
4. **Game context** (shipped by the oracle): this week's opponent's pass and rush defence, adjusted
   for the offences it faced (`commish_opponent_adjustment`, computed from completed weeks only),
   and the club's rest days, move yards per carry, per target and per attempt through fitted
   elasticities, bounded to [0.8, 1.25]. The implied total, spread and weather are not used: they
   are stamped at kickoff and no projection made before kickoff can see them.
5. **Composition.** Volume times rate into one predicted stat line, scored through each format's
   own rules (12-team PPR, half PPR, standard).

Not used, as in the oracle: the line composite, redistribution, red zone, target depth and the
news pass (each measured by the oracle and not shipped). Kickers and team defenses are not
projected by this model and are not on the weekly board.

**The one correction, made before any fit.** The oracle's `latestTeams` keeps each player's club
of his highest week across the two seasons a projection reads, without comparing seasons, so an
offseason mover is projected with his old club's scheme and opponent until he passes last season's
final week (114 of 784 players at 2024 week 7). `commish_weekly_v1` takes each player's club at his
latest (season, week) edge (`model/weekly/teams.py`, `latest_teams_by_season`). The parity cases
run the oracle's rule.

**Reads.** A week is projected at one millisecond before its first kickoff, seeing every fact
stamped at or before that instant: both seasons' usage, lines and club edges up to the week before,
the prior season's and this season's team facts through the target week. The gap season 2025 (no
published weekly file in the dev copy) admits its play-by-play lines and touch counts exactly where
the live preseason board admits them (`ROUND_READER`); see "The data" for how the judgment avoids
depending on that.

**Interval.** Floor, median and ceiling come from the model's own residuals on the fit seasons.
For each position (QB, RB, WR, TE) and format, every fit-season player-week the model projected
and the player recorded a line in is bucketed by projected points into quintiles (edges at the
20th, 40th, 60th and 80th percentiles of those projections); within each bucket the 10th, 50th and
90th percentiles of (actual minus projected) are taken (linear interpolation between order
statistics, numpy's default). A player's floor is max(0, projected + p10), median max(0,
projected + p50), ceiling max(0, projected + p90), from his bucket. The board's numbers describe a
week he plays; a player who does not play is not scored.

## Fit seasons, held-out weeks, never read

- **Fit:** 2021, 2022, 2023, 2024, with 2020 read as history (week one of 2021 shrinks toward it).
  Every fit refuses 2025 and 2026 by name (`assert_held_out`). The four fits are the oracle's own
  procedures (`fit.ts`, `scheme-fit.ts`, `context-fit.ts`): role priors and league team volume
  are descriptive means, the recency decay and two share shrinkages are searched over the oracle's
  grid (8 x 9 x 10 cells) against next-week share RMSE, the rate regression constants are variance
  ratios, the scheme elasticities are fitted against layer 1's residual and the game-context
  elasticities against the league-relative team rate. The interval is then fit on the same seasons
  with the fitted priors.
- **Judgment:** 2025 weeks 1 through 17, read once. Week 18 is excluded before reading it (rested
  starters, and most leagues' seasons end at 17).
- **Never read:** 2026 outcomes.

## The data

The dev copy holds 2025 only from play-by-play: nflverse published no `player_stats` file for 2025
under the tag the oracle read, so 2025 has no target, carry or pass-attempt counts and no team
totals, and its stat lines are derived (`nflverse_pbp_derived`). A model judged on that would be a
different model from the one that would run in 2026 (whose weeks carry every count), with its
in-season shares blind. nflverse now publishes 2025 under `stats_player`, and the house's own
season ingest reads it (phase D report, owed item 7).

So the fit and the judgment run on **a scratch copy of the dev copy**: database `lane12_weekly` on
the local test server (port 5433), restored from a dump of the dev copy's `research` schema taken
2026-10-13, to which the house's own ingest adds 2025's published weekly stats before any fit
(`ingest_player_universe`, which also refreshes the player universe as that ingest always does,
and `ingest_season(..., 2025)`: the functions behind
`python -m research.pipeline season --first 2025 --last 2025`, called through this round's command
line with the scratch URL). The dev copy itself is not written by this round's fit or judgment.
Every other season is the dev copy's as it stood. The judgment's outcomes are the published 2025
lines (`stat_lines_for_measurement`, which prefers a published line to a derived one).

## Benchmarks

1. **ADP order** (gated). The 2025 `ffc_adp_ppr_12` ranks as published before the season (stamped
   2025-09-02, read as of each week's moment), ordered within position. Static all season, which is
   exactly the comparison a drafter already trusts.
2. **Recent form** (gated). For week W: the player's mean points per game over this season's weeks
   before W in which he recorded a line; before he has one, his mean over last season's lines; with
   neither, no opinion. The oracle's naive benchmark (last season's points per game), carried into
   the season.
3. **The season board scaled to a week** (named by the brief; **refused, not scored**). The store
   holds no 2025 season board (`preseason_projections` has 2021-2024 and 2026), and cannot build
   one: it holds no 2025 week-one rosters (`preseason_rosters`). A board built some other way would
   be a different benchmark than the one named.
4. **The stats provider's weekly projection** (named by the brief; **refused, not scored**). The
   store holds one provider projection capture, 2026-09-09, and nothing for 2025.

## Statistics

The **population** for ordering and places-off, per week W and position p: players at p with a
2025 ADP rank, a model projection, a recent-form value and a recorded 2025 week-W line. Every
statistic compares the model and a benchmark on the same players. All gated statistics are in
12-team PPR, the register's and the ADP's format.

- **S1, rank agreement with the finish within position.** Spearman's rho (Pearson on average
  ranks) between each source's order and actual points, per (W, p) with at least 8 players; the
  mean over weeks; the gated quantity is the mean over weeks of (model rho minus benchmark rho).
- **S2, places off for the typical starter.** Within each (W, p) population, each player's
  projected rank and actual rank (average ranks, highest points first). For every player whose
  actual rank is within the position's starters (QB 12, RB 24, WR 24, TE 12: the dedicated slots of
  the house's standard 12-team roster), the absolute difference between the two ranks; the mean
  over all such players in all weeks and all four positions.
- **S3, calibration of the floor and ceiling.** Over every player-week the model projected and the
  player recorded a line in (the whole board, not only the ADP population), per position and
  format: the share of actual points below the floor and the share above the ceiling. Each is 10%
  by construction on the fit seasons.

**Uncertainty.** A week-block bootstrap: the 17 held-out weeks resampled with replacement 10,000
times (numpy `default_rng(12)`, the same resampled weeks for every comparison), each statistic
recomputed on the resampled weeks; the one-sided lower bound is the 0.5th percentile of the
bootstrap distribution of the difference.

## Gates

All must pass. **A gate that cannot answer fails** (a position with no week of 8 players, a cell
with fewer than 100 player-weeks).

- **G1, ordering against ADP.** For each of QB, RB, WR, TE: mean (model rho minus ADP rho) at least
  **+0.03**, and its bootstrap lower bound above **0**.
- **G2, ordering against recent form.** For each of QB, RB, WR, TE: mean (model rho minus form rho)
  at least **+0.02**, and its bootstrap lower bound above **0**.
- **G3, places off for the starters.** Pooled over the four positions, the model's mean places off
  at least **0.5** places fewer than ADP's and than recent form's, each with its bootstrap lower
  bound of (benchmark minus model) above **0**.
- **G4, calibration.** For each position and each of PPR, half PPR and standard (12 cells): the
  share below the floor and the share above the ceiling each within **[0.05, 0.15]**, over at least
  100 player-weeks.
- **G5, isolation.** The judgment run, which builds every held-out week's board, leaves every row of
  `preseason_projections`, `preseason_board_reasons`, `register_freeze_rows`,
  `register_grade_rows` and `model_artifacts` as it was (a digest of each table before and after).

The thresholds live in one constant (`model/weekly/round/gates.py`), and the judgment and any later
harness read the same one.

## Multiple comparisons

Ten comparisons are tested with a bootstrap: four in G1, four in G2, two in G3. Each is held at a
one-sided level of 0.05 / 10 = 0.005 (Bonferroni), which is why the lower bound is the 0.5th
percentile. The gates are conjunctive, so testing more of them can only make passing harder; G4
and G5 are tolerances, not tests. The judgment is run once.

Reported and **not** gated, so that reading them cannot move a gate: each source's rho over the
whole scored population; mean absolute error and RMSE of points; per-week rho; half PPR and
standard orderings; S2 per position; and the same statistics for the oracle's own published priors
(fit 2021-2022) with the oracle's team rule, so the refit and the correction are visible.

## Development check, and what it may change

Before the judgment, the identical code is run once as a development check: fit on 2021-2023 (2020
history), judge 2024 weeks 1-17 against 2024 ADP (`ffc_adp_ppr_12`, 189 players) and recent form.
2024 is a fit season of the final model, so its numbers decide nothing; they are recorded in the
results file. After the check, only **defects** may change: code that does not do what this
document says. Each is recorded as an amendment, with the check's numbers, and committed before the
judgment. No model choice, population, statistic, threshold or seed changes after the check.

## Decision rule

- **All gates pass:** the weekly board joins the nightly run (`weekly.json`: per player the week,
  projected points by format, floor, median, ceiling, the opponent and the basis sentence, added
  to `web/src/lib/run/schema.ts` and validated by the nightly's schema gate), its rows are written
  beside the preseason boards with `model_version` and `implementation = 'python'`, and the
  register's weekly pass freezes it as a tracked board, so 2026 is graded prospectively.
- **Any gate fails:** no weekly number reaches a screen. The results file reports every number, the
  in-season screens keep the season projection and the stat lines, labelled, and the model is not
  retuned and rerun against 2025.

## What would make this document wrong

A judgment run more than once, or after any change to the fit, the model or the statistics not
recorded as a defect amendment here, voids it; the results file must then say so.
