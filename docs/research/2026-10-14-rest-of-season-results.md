# The Rest-of-Season Board Round: Results

**Run:** 2026-10-14 (UTC), once, by
`uv run python -m research.model.ros judge --database <scratch copy> --out <file>`.
**Preregistration:** `docs/research/2026-10-14-rest-of-season-preregistration.md`, committed as
`58393132` before any fit; Amendment 1 and Defect 1 committed as `115c6b91` after the development
check and before the judgment.
**Tree:** `115c6b91` (`model_version` `research@115c6b91`), arithmetic `v8-fdlibm-fused/pow-apple-libm`.
**Data:** the scratch copy `lane18_ros` (local test server, port 5433): the dev copy's `research`
schema as dumped 2026-10-14, plus, through the house's own ingests, 2025's published weekly stats
(6,655 stat lines, 7,565 participation rows, resolution 0.997) and its week-one roster (2,908 rows
written of 3,047). The 2025 injury-filing ingest wrote 0 rows (the file carries no
`date_modified`). The dev copy was only read.
**Every number:** `2026-10-14-rest-of-season-results.json` (the judgment's whole output: the
thresholds, every fitted number, every gate line, every cell's numbers for every source, the
outcome seasons the readers served, the table digests).

## Decision

**A gate failed. Nothing ships.**

Eleven of the 85 gate lines failed, all of them at the season's early judged week or on one side of
a tolerance:

```
FAIL  G1 4|WR|ppr       rho 0.5966 against the stale board's 0.6126, difference -0.0160 against a margin of +0.0200, n=128
FAIL  G1 4|WR|half      rho 0.5989 against the stale board's 0.6187, difference -0.0198 against a margin of +0.0200, n=128
FAIL  G1 4|WR|std       rho 0.5920 against the stale board's 0.6163, difference -0.0243 against a margin of +0.0200, n=128
FAIL  G2 4|QB|ppr       rank error 8.000 against the stale board's 7.583
FAIL  G2 4|QB|half      rank error 8.000 against the stale board's 7.583
FAIL  G2 4|QB|std       rank error 8.000 against the stale board's 7.583
FAIL  G2 4|WR|ppr       rank error 17.361 against the stale board's 17.194
FAIL  G2 4|WR|half      rank error 17.667 against the stale board's 17.111
FAIL  G2 4|WR|std       rank error 18.778 against the stale board's 17.722
FAIL  G2 8|WR|std       rank error 19.389 against the stale board's 19.278
FAIL  G3 TE|half        coverage 0.854 against [0.75, 0.85], n=137
```

The other 74 passed: G1 in 33 of 36 cells (every cell at weeks 8 and 12, margins +0.034 to
+0.268), G2 in 29 of 36, G3 in 11 of 12, and G4. Under the preregistered decision rule the board
stays the preseason projection with its caption (Lane 16), no fitted number is published, and the
model is not retuned and rerun against 2025. The full gate list is the JSON's `report`.

**G4, isolation, passed:** the readers served outcomes for 2021-2024 (the opportunity line), 2023
and 2024 (the fit) and 2025 (the judgment), and nothing else; every row of
`preseason_projections` (26,855), `preseason_board_reasons` (187,631), `register_freeze_rows`
(3,409), `register_grade_rows` (1,351) and `model_artifacts` (15) digested the same before and after.
**G5 is not a gate:** the store holds no 2025 in-season consensus (one preseason FantasyPros ECR
capture, 2025-09-08), as preregistered.

## Every judged cell, PPR

Spearman rho with actual rest-of-season points (weeks W through 17), and the starters' mean rank
error, for the model, the stale board, season-to-date form (points a game times games left) and the
preseason ECR, on the cell's population (the union of the stale board's top K and the top K by
points so far: K = QB 36, RB 72, WR 108, TE 36). Coverage is the share inside [floor, ceiling];
MAE is the model's mean absolute error of rest-of-season points. Half PPR and standard are in the
JSON under `numbers.cells`, and read the same way.

| W | Pos | n | rho model | rho board | rho form | rho ECR | err model | err board | err form | err ECR | coverage | MAE |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4 | QB | 41 | 0.573 | 0.492 | 0.392 | 0.479 | 8.00 | 7.58 | 10.62 | 8.33 | 0.805 | 52.2 |
| 4 | RB | 87 | 0.675 | 0.612 | 0.661 | 0.663 | 9.83 | 10.50 | 11.12 | 9.79 | 0.747 | 42.3 |
| 4 | WR | 128 | 0.597 | 0.613 | 0.504 | 0.596 | 17.36 | 17.19 | 20.90 | 17.72 | 0.773 | 39.5 |
| 4 | TE | 46 | 0.680 | 0.581 | 0.577 | 0.636 | 8.75 | 10.58 | 9.58 | 9.42 | 0.870 | 30.1 |
| 8 | QB | 42 | 0.563 | 0.390 | 0.496 | 0.401 | 7.75 | 8.75 | 7.42 | 9.50 | 0.857 | 43.9 |
| 8 | RB | 84 | 0.667 | 0.489 | 0.636 | 0.539 | 9.04 | 11.75 | 11.38 | 10.71 | 0.619 | 31.2 |
| 8 | WR | 127 | 0.599 | 0.540 | 0.540 | 0.527 | 18.50 | 19.47 | 20.31 | 20.14 | 0.756 | 29.8 |
| 8 | TE | 46 | 0.612 | 0.474 | 0.525 | 0.557 | 8.58 | 11.58 | 9.83 | 11.00 | 0.870 | 25.2 |
| 12 | QB | 42 | 0.475 | 0.381 | 0.438 | 0.383 | 11.50 | 11.92 | 9.83 | 12.58 | 0.857 | 32.8 |
| 12 | RB | 86 | 0.750 | 0.496 | 0.701 | 0.548 | 9.62 | 11.83 | 9.83 | 11.04 | 0.907 | 17.8 |
| 12 | WR | 128 | 0.575 | 0.482 | 0.553 | 0.475 | 25.36 | 28.18 | 23.99 | 27.14 | 0.891 | 19.9 |
| 12 | TE | 45 | 0.526 | 0.261 | 0.423 | 0.337 | 8.17 | 11.08 | 8.25 | 10.67 | 0.800 | 18.2 |

Pooled coverage (G3) by position, PPR: QB 0.840 (n 125), RB 0.759 (257), WR 0.807 (383), TE 0.847
(137). By week the interval is not calibrated: running backs 0.747, 0.619, 0.907 at weeks 4, 8
and 12; receivers 0.773, 0.756, 0.891. The pooled gate passes on averages of misses in opposite
directions.

## Reading the result

From week 8 on, the model is the better board everywhere: it beats the stale board's rho in all 24
cells by +0.034 to +0.268, has the smaller starters' rank error in 23 of 24, and beats form and the
preseason ECR in most cells too. The founder's bar, "better than stale", is met for the second half
of the season by a wide margin.

At week 4 it is not. Three games of data move it too far: the fit gave the stale board almost no
weight for QB, RB and WR (k of 0.5 to 1 game, below), so a three-game sample sets most of a
week-4 projection, and receivers are where that costs most (rho 0.597 against the board's 0.613,
in every format). The quarterback rank error at week 4 (8.00 against 7.58) is the same effect on a
cell of 12 starters. The development check on 2024 (below) showed the same week-4 shape before 2025
was read, so this is a property of the model, not of 2025.

The one calibration failure (tight ends in half PPR, 0.854 against a ceiling of 0.85) is by a
hair; the per-week coverage above is the larger problem for a next round.

## The fit

Fit on 2023 and 2024 (everything that shrinks toward the stale board) and 2021-2024 (the
opportunity line), 8,735 population rows over fit weeks 2 to 15. Read and fit in 46 s (opportunity
4.8 s, collecting the rows 41.1 s, the searches 0.2 s). PPR numbers below; every format's in the
JSON's `priors`.

- **Shrinkage (k games of prior, alpha weight on points a game against opportunity points):**
  QB 0.5, 0.5; RB 1.0, 0.6; WR 1.0, 0.6; TE 3.0, 0.2 (the same cells in half and standard).
- **Availability shrinkage k_q:** QB 6, RB 4, WR 6, TE 12.
- **After an absence of 1, 2, 3+ games:** the next game played 0.337, 0.288, 0.216; later games
  0.609, 0.592, 0.472.
- **Off the stale board:** points a game QB 9.13, RB 7.74, WR 6.51, TE 2.42; play rate QB 0.330,
  RB 0.553, WR 0.846, TE 0.736.
- **Opportunity line** (intercept, per target, carry, pass attempt, unit of snap share): QB -1.234,
  2.046, 0.812, 0.258, 5.767; RB -0.181, 1.458, 0.696, 2.291, -0.872; WR -0.144, 1.711, 0.864,
  2.276, 0.217; TE -0.083, 1.668, 1.218, 0.143, 0.468.
- **Interval ratios** (p10, p50, p90 of actual over projected; early, middle, late): e.g. WR 0.29,
  0.97, 1.84 / 0.20, 0.95, 1.88 / 0.00, 0.93, 1.89.

## The stale board

`build_season` at 2025's replay moment, 2025-09-05T23:59:59.999Z, 542 players at QB, RB, WR and TE:
the served PPR board (`commish_board_v9_ppr_12`), carried to half PPR and standard by the raw
board's own ratio (Amendment 1). The archived `preseason_projections` rows were not used; the
store holds none for 2025.

## Development check, run before the judgment

Fit on 2023 (opportunity line 2021-2023), judged on 2024 weeks 4, 8 and 12, same code
(`2026-10-14-rest-of-season-dev-check.json`, the second run). 18 of 85 lines failed: G1 at week 4
for RB and WR in every format (PPR RB +0.0063, WR -0.0012); G2 at week 4 for RB and WR and at week
8 for WR; G3 for RB PPR (0.864), RB standard (0.878) and TE standard (0.703). Every week-8 and
week-12 G1 cell passed. G4 passed.

The check led to one amendment and one defect fix, both committed before the judgment and written
out in the preregistration: **Amendment 1** (a past season's half and standard boards are flat
market tails, because the store holds 5 to 20 of their ADP rows a season; the first run's half and
standard comparisons against them, +0.25 to +0.62 in rho, measured nothing) and **Defect 1** (the
results file was not written; no number changed). It also exposed two model choices the
preregistration had fixed, which stood for the judgment: inflated points a game for players the
preseason board capped for availability, and near-zero prior weight.

## What the next round should change

Each of these is a finding of this round, to be preregistered in a new round, not tried on 2025
here:

1. **The prior's weight by week, not one k.** The model wins from week 8 and loses at week 4. Fit k
   so that a three-game sample cannot outweigh the preseason board (a floor on k, or k fit per
   horizon band), or blend the rest-of-season board with the stale board by week. The cheapest
   honest product: serve the stale board until a preregistered week and the rest-of-season board
   after it, and gate exactly that.
2. **Points a game from the raw line, not from blended season points over capped games.** For a
   player the preseason board capped (PUP, reserve), take points a game from the raw board's line,
   so availability lives only in expected games.
3. **A per-week interval.** Coverage swings from 0.62 to 0.91 across weeks inside one position;
   fit the ratios per judged horizon (or scale by games left), and gate per week with enough
   players to answer.
4. **Designations, once they can be replayed.** The store cannot place a 2025 filing in time and
   holds no 2026 reserve list after week 1. Capturing the weekly roster status nightly (stamped)
   would let a later round use it.
5. **Half and standard ADP history.** The past seasons' boards in those formats are flat; the
   comparison there rests on Amendment 1's conversion.

## Cost

On the founder's laptop: the fit and the judgment together in under two minutes (each season's
stale board takes about 12 s to build, each week's inputs under a second). No model call, no prose:
this round spent nothing. Had it passed, the nightly would have needed no new table reads: the
season-so-far store the player pages already read (`read_season_store`) holds every input.
