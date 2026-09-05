# Availability model upgrade backtest — 2026-09-05

Founder-approved 2026-09-05, motivated by two converging facts: the season-band backtest
under-covers real outcomes (`docs/research/2026-09-04-rookie-calibration-backtest.md` measures
0.646 board-wide coverage against the 0.80 a p10-p90 claims), and Nate Silver's QBERT team
published that a comparable model understated weekly injury rates by roughly half — fixed with a
simple feature set: past injuries predict future ones, career longevity is evidence of avoidance,
age raises risk, workload raises risk.

## Task 1 — the injury-history features (shipped)

`src/projections/preseason/injury-history.ts` derives, purely from `SeasonAvailability` records
(themselves derived from real per-player-week presence: a player with a stat line played, the
schedule says his team played):

- `gamesMissedInSeason` / `recentGamesMissed` — games missed in each of the prior two seasons,
  combined. A season absent from the record contributes zero rather than a lost year.
- `careerAvailabilityRate` / `careerSeasonsOfRecord` — games played over games his teams played,
  summed across every season the history carries (not only the seasons the shrinkage itself
  weighs — see Task 2's `AVAILABILITY_CAREER_SEASONS` widening, below).
- `priorSeasonWorkloadShare` — his own snap share the season immediately before this one, reusing
  `roleBracketFor`'s existing, documented boundaries rather than inventing a new touch-count scale
  (touches are not comparable across positions; snap share already is).

This module is pure, fully tested (13 tests, `injury-history.test.ts`), and independent of the
Task 2/3 gate outcome below — it is kept regardless of what follows.

## Task 2 — the refit (attempted, then reverted — see Task 3)

The availability model was extended to condition expected games AND the games distribution on the
three features above, following the codebase's existing discipline:

- Three new residual multipliers — `injuryMultiplier`, `durabilityMultiplier`,
  `workloadMultiplier` — fitted in the SAME chain as `ageMultiplier`/`statusMultiplier`: each a
  ratio of actual-to-expected on the residual of everything fitted before it, shrunk toward 1
  (`CELL_PRIOR_SEASONS = 40`) and bounded, exactly as `ageMultiplier` already is.
- Brackets chosen from what the underlying number MEANS (clean/minor/moderate/major games missed;
  fragile/average/durable career rate; the existing `ROLE_BRACKETS` reused for prior-season
  workload), the same discipline `AGE_BRACKETS`/`ROLE_BRACKETS` already state for themselves —
  never a quantile search, never an eyeballed magnitude cutoff.
- The games DISTRIBUTION (not just the mean): a new `concentrationInjuryAdjustment` scalar,
  solved by fitting the existing overdispersion-ratio concentration line a second time on only the
  recently-injured cohort and comparing its intercept to the whole population's, bounded to widen
  (never narrow) the distribution — the same structural-bound discipline
  `concentrationPerSeason`'s own slope already carries.
- `AVAILABILITY_CAREER_SEASONS = 10`: `PreseasonInputs.gamesPlayed` widened from the model's
  `HISTORY_SEASONS` (3) to 10 seasons, SCOPED to that one field alone, so `careerAvailabilityRate`
  reads a genuine career rather than the same three-year window the shrinkage already uses. This
  changed nothing about the existing shrinkage, which still slices to `historySeasons` internally.
- Fit on 2021-2022 (the availability model's own unchanged `FIT_SEASONS`) — 2025 and 2026 held out,
  `fitAvailabilityPriors` throws if handed either, unchanged from before this round.

Fitted magnitudes (2021-2022, printed by `npm run projections:preseason:fit`):

| | clean/unknown/none | minor/fragile/bench | moderate/average/rotation | major/durable/committee | featured |
|---|---|---|---|---|---|
| Injury (QB/RB/WR/TE) | 1.038 / 0.996 / 0.993 / 0.963 | 1.068 / 1.003 / 0.974 / 1.008 | 1.027 / 0.986 / 1.031 / 0.998 | 0.805 / 1.022 / 0.995 / 1.077 | — |
| Durability (QB/RB/WR/TE) | 0.964 / 0.994 / 0.987 / 1.012 | 0.957 / 0.996 / 1.002 / 1.014 | 1.046 / 1.021 / 0.993 / 0.985 | 1.042 / 0.989 / 1.014 / 1.003 | — |
| Workload (QB/RB/WR/TE) | 0.952 / 0.988 / 0.984 / 1.002 | 0.990 / 1.019 / 1.008 / 0.971 | 0.970 / 1.003 / 1.048 / 1.033 | 1.005 / 0.977 / 0.986 / 0.979 | 1.043 / 1.025 / 0.989 / 1.011 |

Concentration: 2.37 baseline (versus the incumbent's 1.94, moving in the WIDER direction the whole
round intends), plus 0.00 per season of record on this fit, minus 0.17 for a recent injury
pattern — real, correctly-signed (widening), but small.

**Every multiplier landed within about 5% of neutral, at every position except a thin QB "major"
injury cell (0.805, n small).** This is the honest measurement, not a bug: with only two fit years
(2021-2022) and four-way bracket splits on top of an already-shrunk population, there is not much
room for a strong, reliable signal to surface through `CELL_PRIOR_SEASONS = 40` shrinkage. QBERT's
own reported fix operated on weekly injury-designation data across many more seasons; this engine's
`player_week_observations` gives season-level presence/absence over a two-year fit window, which is
a coarser and thinner signal.

## Task 3 — THE GATE (FAILED, reverted)

`scripts/availability-calibration-backtest.ts` (deleted after the revert — its full output is
captured here) built the CURRENT (post-refit) 2025 raw model board against a RECONSTRUCTED
incumbent board (`INCUMBENT_AVAILABILITY_PRIORS`, the pre-refit `FITTED_AVAILABILITY_PRIORS`
captured verbatim and run through the identical, unchanged `preseasonCandidates`/`preseasonBoard`
machinery — the same reconstruction discipline `rookie-calibration-backtest.ts` uses for its own
pre-fix arm). Raw, unblended board; market blend excluded; 2025 real outcomes; 2026 untouched.

### Board-wide and by class (n = 525 raw-board candidates with a real 2025 outcome)

| population | n | coverage (p10-p90) | mean band width (pts) | MAE | rank correlation |
|---|---|---|---|---|---|
| Incumbent — whole board | 525 | 0.651 | 86.7 | 39.78 | 0.769 |
| Current — whole board | 525 | 0.665 | 84.4 | 39.45 | 0.769 |
| Incumbent — veterans | 432 | 0.655 | 90.9 | 40.94 | 0.783 |
| Current — veterans | 432 | 0.671 | 88.6 | 40.44 | 0.784 |
| Incumbent — rookies | 93 | 0.634 | 67.2 | 34.38 | 0.684 |
| Current — rookies | 93 | 0.634 | 65.1 | 34.83 | 0.684 |

Target band coverage is 0.80. Rookies (who have no NFL injury/durability/workload history by
construction — their bracket is always the neutral "unknown"/"clean"/"none" cell) see essentially
no change, as expected: the new terms have nothing to read for a player with no NFL seasons behind
him. Veterans, who DO carry real history, moved a little further (+0.016) than the board as a
whole (+0.013) — the right population for the effect to land on, just not by enough.

### Per position

| position | n | incumbent coverage | current coverage | incumbent MAE | current MAE | incumbent rank | current rank |
|---|---|---|---|---|---|---|---|
| QB | 71 | 0.704 | 0.690 | 53.76 | 53.26 | 0.757 | 0.757 |
| RB | 131 | 0.618 | 0.634 | 44.62 | 45.62 | 0.735 | 0.731 |
| WR | 206 | 0.631 | 0.646 | 39.21 | 38.15 | 0.778 | 0.778 |
| TE | 117 | 0.692 | 0.718 | 26.89 | 26.43 | 0.816 | 0.814 |

Printed as measured, whichever way it points: QB coverage and rank correlation both moved
slightly WORSE (coverage -0.014, on a thin position where the one meaningfully-sized injury
multiplier cell sits); RB MAE moved worse by one point while its coverage improved; WR and TE
both improved on every column shown. No position moved by enough to matter on its own.

### Gate decision

Coverage moved **+0.0133** (incumbent 0.651 -> current 0.665; target 0.80 — a gap of 0.149, of
which this round closed about 9%). MAE moved **-0.335 points** (incumbent 39.78 -> current
39.45), an improvement, comfortably inside a 3%-of-incumbent-MAE noise allowance (1.193 points).

**GATE FAILED.** MAE did not degrade — if anything it improved slightly — but coverage did not
move MATERIALLY toward 0.80: a thirteen-thousandths move against a fifteen-point gap is noise-scale,
not the "materially toward 0.80" the merge condition requires. Per the task's explicit instruction,
the new availability model is reverted to the incumbent rather than shipped on a result this thin.

## Disposition

Reverted in full: `src/projections/preseason/availability.ts`, `fit.ts`, `source.ts`,
`scripts/preseason-fit.ts` and `availability.test.ts` are back to their pre-Task-2 state (`git
checkout` against the last commit, which predates any Task 2 edit), and
`src/projections/preseason/fitted.ts` is byte-identical to the committed incumbent
(`FITTED_AVAILABILITY_PRIORS.concentration = 1.938315267549189`, `priorGames = 25`, verified by
diff). `scripts/availability-calibration-backtest.ts` and its
`scripts/fixtures/incumbent-availability-priors.ts` fixture were deleted along with the reverted
mechanism, since a harness comparing a type shape that no longer exists in `availability.ts` has
nothing left to run — their full output is preserved verbatim above.

**Kept:** `src/projections/preseason/injury-history.ts` and its test. Task 1 was scoped as a
standalone, tested derivation layer independent of whether Task 2/3's application of it cleared the
gate, and the founder-approved plan names it as such. It is currently unused by the shipped model.

**What would need to change for a future round to pass this gate:**

1. **More fit years.** Two years (2021-2022) split four ways by position and again four-or-five
   ways by bracket leaves most cells in the "thin, heavily shrunk toward neutral" regime. The
   rookie durability prior in the 2026-09-04 round got its own, fresher 2023-2024 window
   specifically to have more to work with; the SAME move (fit `injuryMultiplier`/
   `durabilityMultiplier`/`workloadMultiplier` on a wider or fresher window, scored against 2025 as
   this backtest already does) is the most direct next step and was not attempted this round to
   keep the comparison to the model's own existing `FIT_SEASONS` clean.
2. **A genuine injury designation feed**, rather than season-level presence/absence derived from
   who has a stat line. `player_week_observations` already carries `nflverse_injuries` rows
   (17,194 of them) that this round did not read at all — a real weekly injury-report status is a
   sharper signal than "did he appear in a box score this week," and QBERT's own reported fix
   operated on data closer to that shape.
3. **Coverage may simply need a wider base concentration more than a covariate.** The 2026-09-04
   round's own Task 4 (per-game performance variance) moved board-wide coverage from 0.478 to
   0.646 — a much larger jump than any covariate this round measured — which suggests the
   remaining 0.15 gap to 0.80 may be more of a base-spread problem than a "which players are
   riskier" problem. Worth checking before another covariate-conditioning round.

## Honesty notes

- Every number in this report was printed by the backtest script exactly as it came out, including
  the QB coverage and rank-correlation regressions and the RB MAE regression — nothing here is
  cherry-picked to the pass direction.
- The gate's "material" bar (a coverage move of at least 0.02) is a judgment call, not a number the
  founder specified; it is disclosed here rather than picked after seeing the result. Even at a much
  more permissive bar the measured move (0.013) reads as noise against a 0.15 gap, so the qualitative
  conclusion — this round's features are not enough on their own — does not depend on where exactly
  that line is drawn.
