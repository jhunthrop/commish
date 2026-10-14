# The Rest-of-Season Board, Round 2: Preregistration

**Written:** 2026-10-14, after round 1's one judgment and before any fit of round 2.
**Brief:** `.superpowers/sdd/2026-10-12-prep-site/lane-18-brief.md` and the coordinator's round-2
rulings of 2026-10-14 (quoted where they bind). Founder ruling 2026-10-14: "we can't leave stale
rankings during the season so it needs to be accurate and fresh - ship it."
**Round 1:** `2026-10-14-rest-of-season-preregistration.md` and `...-results.md`. Its model,
`commish_ros_v1`, **failed and never ships**; nothing in this round reruns it.
**Results:** `docs/research/2026-10-14-rest-of-season-round2-results.md`, with every number in
`2026-10-14-rest-of-season-round2-results.json`, reported whether the gates pass or not.

## Round 1's result, which this round is designed from

2025, weeks 4, 8 and 12, 85 gate lines, 11 failed. Every failure but one sat at week 4 (G1 receivers
in all three formats by -0.016 to -0.024 rho against a +0.02 margin; G2 quarterbacks and receivers)
or was one cell of week 8 (G2 standard receivers, 19.39 against 19.28). From week 8 the model beat the
stale board in all 24 ordering cells, by +0.034 to +0.268 rho (smallest: week-8 standard receivers),
and in 23 of 24 rank-error cells. The interval passed pooled but was not calibrated week by week
(running backs 0.747, 0.619, 0.907 at weeks 4, 8, 12). The development check on 2024 had the same
shape. Two model choices were exposed and left in for round 1: points a game for a player the
preseason board capped for availability came from blended season points over few expected games
(2024 Nick Chubb 37.4 a game), and the fitted prior weight was near zero.

## This round's changes, and nothing else

1. **A switch week, S = 6.** The served board is the preseason board through week 6 and the
   rest-of-season model from week 7. Round 1 shows the model losing at week 4 and winning everywhere
   in ordering by week 8; the switch must fall between. S = 6 is the coordinator's prior and the
   season stands at week 6 now; nothing in round 1 argues for a later S (week 8's smallest ordering
   margin, +0.034, already clears even this round's doubled margin), and an earlier S would sit closer
   to the week that failed. So S = 6, fixed here and never tuned. Week 7 itself is not judged (below):
   the first served rest-of-season week rests on the week-8 evidence.
2. **Points a game from the raw board's line.** The stale prior p_f is the raw board
   (`commish_board_v1_ppr_12`)'s season line scored in format f over the raw board's expected games,
   so a capped player's availability lives only in expected games. Availability a stays the served
   PPR board's expected games over 17, capped at 1. A player the raw board lacks takes the off-board
   rate, as a player off the board does.
3. **The interval per week.** For projection week W, the 10th, 50th and 90th percentiles of (actual
   rest-of-season points over projected) are fitted per position and format on the fit seasons'
   population rows of weeks W-1, W and W+1 (clamped to the collected weeks 6..16), so the judged week
   8 reads weeks 7-9 and week 12 reads 11-13. Keys for weeks 7..17 are fitted, so every served week has
   one.
4. **Fit weeks match the served weeks.** k, alpha, k_q, the return rates and the off-board numbers fit
   on fit-season weeks 7..15 (round 1: 2..15). The k and alpha grids, the k_q grid and every search
   are round 1's.

Everything else is round 1's model, population and statistics, restated briefly: the universe at
(S, W), the season-aware club rule, the absence streak with fitted return rates, the opportunity line
(targets, carries, pass attempts, snap share; fit 2021-2024), u = alpha*r + (1-alpha)*o, m = (k*p +
G*u)/(k + G), expected games E, projection R = m*E, floor/median/ceiling = R times the cell's ratios.
The model is `commish_ros_v2`.

**Injuries, as in round 1:** the model reads absence from the stat lines (the streak of club games
missed) and no designation. The store cannot place a 2025 injury filing in time (nflverse's 2025 file
has no `date_modified`), and holds no stamped reserve list (2026's only at week 1). Red-zone share is
out (no 2026 play-by-play is ingested in season).

## Fit seasons, and seasons that cannot be used

- **2023 and 2024** for everything that shrinks toward the board or fits the interval: the seasons
  today's builder can make the preseason board for.
- **2021-2024** for the opportunity line, which needs no board.
- **2021 and 2022 cannot be used** for the board-dependent fits: the store holds no week-one roster
  for either (`preseason_rosters`), so the builder cannot make their boards; their archived rows were
  made by the oracle's older code, PPR only.
- **2003-2020** are not used: the opportunity line follows the brief's 2021-2024, and earlier boards
  are not buildable by today's code with the same history (2019 has no published weekly stats).
- **2025** is the judgment season, refused by every fit. **2026** is not used for anything.

## Baselines

1. **The stale preseason board** (gated, G1 and G2): in PPR the served board
   `commish_board_v9_ppr_12` built at 2025's replay moment; in half PPR and standard **the served PPR
   board carried to the format by the raw model's own ratio** (round 1's Amendment 1). That baseline
   is a decision from the boards' content: a past season's half and standard boards are flat market
   tails (the store holds 5 to 20 of their ADP rows a season), so the served half and standard boards
   cannot be rebuilt as a drafter saw them.
2. **Season-to-date form** and **the 2025-09-08 FantasyPros ECR** (reported, not gated).
3. **An in-season consensus**: refused, the store holds none for 2025. G5 is not a gate.

## Judgment

**2025, weeks 8 and 12** only: week 4 is the preseason board by construction under S = 6. Each week
at one millisecond before its first kickoff, against actual points of weeks W..17. Read once.

## Statistics

Round 1's, unchanged: the population (union of the stale board's top K and the top K by points so far;
K = QB 36, RB 72, WR 108, TE 36), Spearman's rho with actual rest-of-season points, the starters'
mean rank error (top N by actual: QB 12, RB 24, WR 36, TE 12), coverage of [floor, ceiling].

## Gates

All must pass; a gate that cannot answer fails.

- **G1, ordering:** for W in {8, 12}, p in {QB, RB, WR, TE}, f in {PPR, half, standard} (24 cells):
  model rho minus stale-board rho **>= +0.04** (round 1's +0.02, doubled because this is the third
  round to look at 2025), over a population of at least 20.
- **G2, the starters:** the same 24 cells: the model's rank error **<=** the stale board's.
- **G3, calibration, per week:** the same 24 cells: coverage of the 80% interval **within [0.75,
  0.85]**, over at least 30 players. With 40 to 45 players in a quarterback or tight-end cell the
  sampling error is about 0.06, wider than the tolerance, so a calibrated interval can fail a cell by
  chance; the ruling is to gate per week regardless, and the results will say which cells failed by
  how much.
- **G4, isolation:** round 1's: the outcome readers serve only 2021-2024 in the fit and 2025 in the
  judgment, refuse 2026 always, and the judgment leaves the five tables' digests unchanged.
- **G5:** not a gate.

73 gate lines. Thresholds in one constant (`model/ros/gates.py`, `ROUND_TWO`), tests at each.

## Development check

The same code, fit on 2023 (opportunity 2021-2023), judged on 2024 weeks 8 and 12, recorded in
`2026-10-14-rest-of-season-round2-dev-check.json`. After it only defects (code that does not do what
this document says) may change, each recorded here before the judgment. S, the model, grids,
population, statistics, thresholds and judged weeks do not change.

## Decision rule

- **All gates pass:** the nightly's board step serves `commish_ros_v2` from week S+1 = 7 of the
  product season (chosen by the run date against the first kickoff and the switch week, never a flag),
  in every format the run carries; rows keep their fields as rest-of-season figures with the basis
  "rest of the 2026 season from week N, refreshed <run date>"; the fitted numbers are published to
  `model_artifacts` and pinned; preseason runs and weeks 1-6 are unchanged.
- **Any gate fails:** nothing ships, the results report every number, and the model is not retuned
  and rerun against 2025.

## Development check, as run (before the judgment)

Run once on 2024 weeks 8 and 12 (fit 2023), `2026-10-14-rest-of-season-round2-dev-check.json`, tree
`7ba60cf6`. 19 of 73 lines failed: G1 passed in all 24 cells; G2 failed for week-8 receivers in all
three formats; G3 failed in 16 of 24 cells, on both sides of the band (week-12 running backs 0.92 to
0.94, week-12 receivers 0.73 to 0.74, week-8 tight ends 0.72 to 0.75). A scan of individual
projections found no defect (a capped player's points a game now come from the raw line: 2024
Christian McCaffrey 21.4 a game over 3.8 expected games at week 8). **No amendment; nothing changed
between the check and the judgment.**

## Note appended 2026-10-14 (after the record review): the authority for a second look at 2025

Round 1's decision rule says its model "is not retuned and rerun against 2025", and the brief says a
failed judgment is "never rerun on 2025". This round is a new model under a new preregistration, and
its judgment on 2025 was authorised by the coordinator of this session on 2026-10-14, after round 1
failed, in these words:

> "Round 2 dispatched with a new preregistration: switch week S (prior 6), raw-line points a game,
> per-week interval, judged at weeks 8 and 12 on 2025 with G1 margin doubled and the
> multiple-testing cost named."

The text above this note is unchanged.
