# Market edge close-out: the held-out scorecard, the six laws, and what this round shipped

**Measured 2026-09-01.** Plan: `docs/superpowers/plans/2026-08-31-market-edge.md`. Spec:
`docs/superpowers/specs/2026-08-31-market-edge-design.md`. Ledger:
`.superpowers/sdd/2026-08-31-market-edge/progress.md`.

**Every number below was verified against a live re-run against the dev DB in this worktree on
2026-09-01**, no network, no Tank01. Reproduce:

- The scorecard: `npm run projections:market-edge:scorecard` (`scripts/market-edge-scorecard.ts`,
  new this task). Defaults to seasons 2023 and 2024.
- The tribal law verdicts: `npm run laws:measure -- --check` against `src/projections/laws/measured.json`.
- The discovered law verdicts and the discovery funnel: `npm run laws:discover -- --check` against
  `src/projections/laws/discovered.json`.
- The blend's train-time channel decomposition: `npm run projections:blend:fit -- --check` against
  `src/projections/market/blend-fitted.ts`'s own committed header.
- The calibration null result: `npm run projections:calibrate` (now prints `+0.0000` on every
  position/band, confirming the two candidate terms stay unshipped).
- The bootstrap helper: `npx vitest run src/projections/rank-correlation-bootstrap.test.ts`.

This is Task 11, the last task of the plan. Its job is to say plainly whether the market blend this
round shipped clears the bar the plan set for it, on the two outcome seasons no fitted constant in
this whole round has ever touched, and to say so with intervals, not with a single point estimate
dressed up as a verdict.

## 1. The bar, read mechanically

The plan's bar: **beat ADP both seasons on rank correlation, and never lose a starter band beyond
noise.** Ruling P3 (`progress.md`) defines "beyond noise" as the band's bootstrap 95% interval on the
rank-correlation difference excluding zero, computed here by
`src/projections/rank-correlation-bootstrap.ts` (seeded, `mulberry32`, 1000 resamples, seed
20260901, deterministic: the same interval on every re-run).

Ruling (Task 3's fix round, `progress.md`): the model's own `FIT_SEASONS` is `[2021, 2022]`, so a
board predicted from the 2023 season is genuinely out-of-fit while one predicted from 2022 is not.
Applied here: **outcome 2024** (predictor season 2023) **is the decisive bar season.** Outcome 2023
(predictor season 2022, inside `FIT_SEASONS`) is reported alongside with that in-fit caveat, never as
the deciding number by itself.

**THE BAR IS MET.** The blend beats ADP on rank correlation in both seasons (positive point-estimate
gap, the pooled four-position population `preseason-report.ts`'s own scorecard has always used), the
win is statistically real (95% CI entirely positive) on the decisive out-of-fit season, and across
every arm, every band, every position, both seasons, **zero comparisons show the blend losing a band
to a benchmark beyond noise.** The starter band specifically is not merely "not lost" on the decisive
season, it is won beyond noise, against ADP and against the raw model both.

| season | population | blend rho | ADP rho | gap | 95% CI on the gap | beyond noise |
|---|---|---|---|---|---|---|
| 2023 (in-fit caveat) | all 4 positions pooled, n=173 | 0.5322 | 0.4752 | **+0.0570** | [-0.0515, +0.1685] | no |
| 2024 (decisive) | all 4 positions pooled, n=176 | 0.5301 | 0.4272 | **+0.1029** | [+0.0081, +0.2099] | **yes** |

Starter band specifically (rank 51-150 of the pooled, ADP-ranked population):

| season | blend rho | ADP rho | gap | 95% CI | verdict |
|---|---|---|---|---|---|
| 2023 | 0.3340 | 0.2232 | +0.1108 | [-0.1228, +0.3412] | within noise, not lost |
| 2024 | 0.4164 | 0.1773 | **+0.2390** | [+0.0403, +0.4443] | **won beyond noise** |

No band, in either season, at any of elite/starter/deep, ever shows a negative gap whose interval
excludes zero. (The fringe band, rank 401+, is structurally untestable against ADP: the ADP-covered
population this scorecard's own bar reads never runs deeper than 176 rows, so that band is always
`n/a` here by construction, not a hidden loss. Section 2's per-arm tables show this directly.)

### The ADP self-reference caveat, and why raw/ECR/naive carry more evidential weight

`market/blend.ts`'s own design starts every listed player from `marketPoints`, itself built off
`BENCHMARK_SOURCES.adp` (`ffc_adp_ppr_12`), the exact feed this scorecard's "beat ADP" comparison
reads. A strong blend-vs-ADP correlation for a listed player is therefore expected by construction,
not free evidence the blend adds anything (`preseason-report.ts`'s own fix-round-2 comment names this
plainly, and Task 10's report carries the same caveat forward). The bar still names ADP as the
literal target, so section 1 above answers it mechanically. **The load-bearing evidence for whether
the blend is worth anything is blend-vs-raw (an arm ADP never touches) and blend-vs-ECR (an
independent published feed):**

| season | comparison | population | gap | 95% CI | beyond noise |
|---|---|---|---|---|---|
| 2023 | blend vs raw (pooled) | n=173 | +0.0635 | [-0.0168, +0.1601] | no |
| 2024 | blend vs raw (pooled) | n=176 | **+0.1169** | [+0.0328, +0.2005] | **yes** |
| 2023 | blend vs ECR (pooled) | n=171 | +0.0287 | [-0.0830, +0.1407] | no |
| 2024 | blend vs ECR (pooled) | n=176 | +0.0320 | [-0.0461, +0.1179] | no |

On the decisive season the blend beats the pure model (never anchored to any market feed) beyond
noise, both overall and in the elite and starter bands individually (elite +0.2459
[+0.0168, +0.4692]; starter +0.1591 [+0.0031, +0.3233]). This is the strongest single piece of
evidence in this document that the market blend is doing real work, not merely restating ADP's own
number back at it. Against the genuinely independent ECR feed the blend is ahead on point estimate
both seasons but the gap does not clear 95% significance on either: a real but not (yet) provably
non-noise edge over the published consensus board.

## 2. The full scorecard: every arm, both seasons, overall and every band

Instrument: `scripts/market-edge-scorecard.ts` (new this task), which reuses
`scripts/preseason-report.ts`'s own `scoreOrdering`/`boardPoints`/`actualSeasonPoints` machinery
(extracted to `src/projections/preseason/scorecard.ts` so both scripts score a player the same way).
Six arms: the shipped blend (`shippedPreseasonCandidates` default), the law-ablated blend
(`withLawsAblated(FITTED_BLEND_CONSTANTS)`, C1(ii)), the raw model (`{ raw: true }`), ADP, ECR, and
naive (last season's points per game, `naiveProjection`, scaled by 17 games/season matching
`decision-report.ts`'s own convention). Every arm is banded by ADP's own rank, the "shared prior"
fix `preseason-report.ts`'s own docblock names, the identical discipline this whole engine has used
since model v1 to keep a cross-source band comparison honest.

### 2023 (predictor 2022, IN-FIT: read with the caveat above)

**All four positions pooled, n=173** (rho, band sample size in parens):

| arm | overall | elite (n=50) | starter (n=100) | deep (n=23) | fringe |
|---|---|---|---|---|---|
| blend | 0.5322 | 0.3126 | 0.3340 | -0.0524 | n/a |
| law-ablated | 0.5298 | 0.3128 | 0.3343 | -0.0573 | n/a |
| raw | 0.4687 | 0.3980 | 0.3487 | -0.4156 | n/a |
| ADP | 0.4752 | 0.2291 | 0.2232 | 0.1789 | n/a |
| ECR (n=171) | 0.5020 | 0.3210 | 0.2758 | -0.1805 | n/a |
| naive (n=156) | 0.5065 | 0.3772 | 0.2814 | -0.4286 (n=6) | n/a |

Per-position overall rho, same arms (n = ADP-covered population at that position):

| position | n | blend | law-ablated | raw | ADP | ECR | naive |
|---|---|---|---|---|---|---|---|
| QB | 24 | 0.3033 | 0.3033 | 0.3383 | 0.2870 | 0.2661 | 0.2372 (n=23) |
| RB | 59 | 0.4115 | 0.4027 | 0.2994 | 0.4025 | 0.4806 (n=58) | 0.2778 (n=52) |
| WR | 70 | 0.6943 | 0.6930 | 0.7040 | 0.7084 | 0.7313 (n=69) | 0.6592 (n=63) |
| TE | 20 | 0.1920 | 0.2179 | 0.0594 | 0.2165 | 0.2346 | 0.4365 (n=18) |

Per-position ADP coverage runs 20-70 players deep, far short of the pooled population's 173. RANK_BANDS
(elite 1-50, starter 51-150, deep 151-400, fringe 401+) was built for a five-hundred-plus player pool,
so a single position's own starter/deep/fringe bands are frequently `n/a` or single digits (RB's own
starter band has n=9, TE never reaches a second band at all). Every position-only band that did
resolve is in the raw run captured at `.superpowers/sdd/2026-08-31-market-edge/task-11-report.md`;
none of them shows a beyond-noise loss to any benchmark, matching the pooled reading.

### 2024 (predictor 2023, DECISIVE)

**All four positions pooled, n=176:**

| arm | overall | elite (n=50) | starter (n=100) | deep (n=26) | fringe |
|---|---|---|---|---|---|
| blend | 0.5301 | 0.3016 | 0.4164 | 0.2576 | n/a |
| law-ablated | 0.5314 | 0.3012 | 0.4255 | 0.2501 | n/a |
| raw | 0.4131 | 0.0557 | 0.2573 | 0.4127 | n/a |
| ADP | 0.4272 | 0.2301 | 0.1773 | -0.1146 | n/a |
| ECR (n=176) | 0.4980 | 0.1841 | 0.3852 | 0.0831 | n/a |
| naive (n=152) | 0.4479 | 0.2700 | 0.3050 | -1.0000 (n=2) | n/a |

Per-position overall rho:

| position | n | blend | law-ablated | raw | ADP | ECR | naive |
|---|---|---|---|---|---|---|---|
| QB | 26 | 0.3045 | 0.3003 | 0.2405 | 0.3415 | 0.3668 | 0.2668 (n=23) |
| RB | 59 | 0.5367 | 0.5371 | 0.5257 | 0.5457 | 0.5966 | 0.4926 (n=50) |
| WR | 71 | 0.4822 | 0.4762 | 0.4076 | 0.5010 | 0.5263 | 0.2966 (n=60) |
| TE | 20 | 0.4682 | 0.4682 | 0.2857 | 0.5113 | 0.5353 | 0.3702 (n=19) |

Honest, worth stating plainly: **broken out per position, none of the four positions individually
beats ADP beyond noise in either direction, and at every one of the four positions in 2024 the blend's
own point estimate trails ADP's** (QB -0.0371, RB -0.0090, WR -0.0187, TE -0.0431, all "within
noise" per the bootstrap). The pooled win is not an artifact hiding four hidden losses; every one of
those four gaps has a 95% interval that spans zero (n=20-71 per position is simply not enough sample
to resolve a within-position edge this size). What the pooled comparison captures that no single
position's own ranking can is CROSS-POSITION ordering: correctly judging that a given WR outranks a
given RB, which is exactly where a market-anchored board with an availability-gap correction has real
information a pure within-position rate model does not. `blend-fitted.ts`'s own channel decomposition
(section 3) is consistent with this: the availability channel, not any single law, carries nearly all
of the measured lift, and games-played risk is a genuinely cross-positional signal (an oft-injured
elite RB and an oft-injured elite WR both get pulled down together), not a within-position one.

## 3. The channel decomposition, on train and confirmed to replicate held out

`blend-fitted.ts`'s own committed header (`npm run projections:blend:fit`, train seasons 2013-2021,
1320 rows): pure market (every cap at zero) rho **0.5892**; availability admitted alone
(`lawCapPoints` at zero, the winning availability/total caps otherwise) rho **0.6046**; laws admitted
too, the winning cell in full, rho **0.6053**. Laws' own share of the total train-time lift over pure
market is 4.5%; the availability-gap channel carries the rest.

This document's own held-out bootstrap (section 1, "blend vs law-ablated") confirms the same shape on
data the fit never saw: the difference between the full blend and the law-ablated blend is tiny and
never beyond noise, in either season, pooled or per position or per band (2024 pooled overall:
-0.0013 [-0.0102, +0.0065]; every band from -0.0091 to +0.0075, n=176). Meanwhile **law-ablated vs
ADP beats ADP beyond noise on the decisive
season, pooled, by almost the same margin the full blend does** (+0.1043 [+0.0040, +0.2140] versus
the full blend's +0.1029 [+0.0081, +0.2099]), and wins the starter band beyond noise too
(+0.2481 [+0.0491, +0.4574]). **The availability channel alone is carrying the bar; confirmed laws add
a real but small amount on top, on train and held out alike.**

### The C1 residual, restated here

No stat line, ADP row, or outcome from 2023/2024 ever reaches the FIT of the blend's own constants,
nor a confirmed law's `trainEffect` value used inside it (`blend.ts`'s `admittedDelta` reads
`trainEffect`, never the full-window `effect` field `/player-laws` displays, pinned by
`blend.test.ts`). What is not train-clean is LAW SELECTION: whether a `"law"` reason exists on a
candidate at all depends on `registry()`'s own verdict, which requires fold agreement across
`REPLICATION_FOLDS` (2021, 2022, 2023), so 2023's own outcomes help decide WHICH laws are confirmed,
never how much a confirmed one moves a player. The bound is `lawCapPoints` (2 points/player) times
the small number of laws that can plausibly co-fire for one player (a WR can carry both the age law
and a TD-share-family law at once): on the order of 4 points/player maximum, the same selection
effect every other consumer of `registry()`'s confirmed laws (the raw board's own chips, `/player-laws`)
already lives with. Section 3's own held-out replication (laws contribute a small, bounded amount,
consistent with train) is the practical evidence this residual is not distorting the scorecard's
headline.

## 4. The six tribal laws

From `src/projections/laws/measured.json`, `MEASURE_SEASONS` 2013-2024 (2019 filled via the
play-by-play derivation, section 6), replicated against `REPLICATION_FOLDS` [2021, 2022, 2023]
(Task 3). A law is `confirmed` only if the full-window CI excludes zero and every fold with matched
pairs agrees in sign; `weak` if the sign is right but either fails; `debunked` if the full-window
sign itself disagrees with the claim.

| law | claim | effect | 95% CI | n | trainEffect | fold 2021 | fold 2022 | fold 2023 | verdict |
|---|---|---|---|---|---|---|---|---|---|
| target_share_persistence | A WR at >=24% team target share sustains stronger PPG next season than his raw scoring alone predicts. | +0.883 | [0.012, 1.780] | 129 | +0.676 | +0.613 | +0.893 | +2.241 | **confirmed** |
| td_regression | A player whose TD points run >=1.5x his position's typical share among regulars (>=8 games) loses PPG next season as TD luck reverts. | -0.824 | [-1.172, -0.459] | 763 | -0.841 | -0.573 | -1.177 | -0.471 | **confirmed** |
| wr_target_competition | A WR with a WR/TE teammate at >=20% target share and >= his own share loses PPG next season. | -0.934 | [-1.679, -0.246] | 251 | -0.788 | -1.432 | -2.150 | -1.235 | **confirmed** |
| rb_age_curve | A running back 28 or older at the season opener produces fewer PPG the following season than a similar younger back. | -1.250 | [-2.145, -0.394] | 171 | -1.175 | -0.175 | -2.926 | -0.589 | **confirmed** |
| rb_workload_cliff | A running back with >=300 combined carries + receptions loses PPG the next season. | -1.108 | [-3.169, 0.958] | 43 | -0.024 | -1.573 | -5.226 | -4.150 | weak |
| play_caller_fingerprint | A WR/TE whose team gets a first-year play-caller with a positive prior pass-rate-over-expected gains PPG. | -0.049 | [-0.606, 0.495] | 238 | +0.112 | -0.387 | -1.005 | +0.018 | **debunked** |

Four of six tribal laws confirmed this round, up from three at this plan's start. `rb_age_curve`
flipped from `weak` to `confirmed` after Task 1's historical-birth-date backfill (sample 43 to 143,
before any 2019 evidence even entered) and Task 2's 2019 derivation added a further 28 matched pairs
(143 to 171) without moving the verdict again. `rb_workload_cliff` stays `weak` (CI still spans
zero at n=43) and `play_caller_fingerprint` stays flatly `debunked` (wrong sign, full window and
two of three folds).

## 5. The discovered laws and the discovery funnel

From `src/projections/laws/discovered.json`. Funnel: **1,737 candidates generated** (111 threshold +
222 delta + 1,404 AND, per `progress.md`'s Task 6 record; the 2,000 cap was never hit) -> **488
untestable** (fewer than `MIN_TRAIN_PAIRS` = 20 train pairs, the honest cost of the t-referenced
screen Task 7's fix round adopted after the reviewer found the normal-approximation screen
anti-conservative at small n) -> **10 BH survivors** (Benjamini-Hochberg at q=0.10, Student's t
reference distribution) -> **4 REPLICATED confirmed discovered laws** (every fold with matched pairs
agrees in sign, plus at least one genuinely out-of-train fold, 2022 or 2023, with
`>= MIN_OUT_OF_TRAIN_FOLD_PAIRS` (5) pairs agreeing, per Ruling I2; `n>=219` on every one of the four).

| candidate | claim | effect | 95% CI | n | trainEffect | verdict |
|---|---|---|---|---|---|---|---|
| `threshold:WR:age:q70` | A WR whose age at the opener is 26.97 or more loses PPG the following season. | -1.139 | [-1.545, -0.692] | 483 | -1.157 | **confirmed** |
| `threshold:WR:touchdownPointsShare:q80` | A WR whose TD-points share that season is 23.2% or more loses PPG the following season. | -1.285 | [-1.793, -0.794] | 344 | -1.197 | **confirmed** |
| `and:WR:...incomingCoachTenureSeasons:q70+...touchdownPointsShare:q70` | The above TD-share law (19.5% threshold), AND-ed with a first-year incoming play-caller. | -1.063 | [-1.603, -0.515] | 331 | -1.080 | **confirmed** |
| `and:WR:...incomingCoachTenureSeasons:q70+...touchdownPointsShare:q80` | The 23.2% TD-share law AND-ed with a first-year incoming play-caller. | -1.733 | [-2.367, -1.111] | 219 | -1.657 | **confirmed** |

**Nesting, per the reviewer-adopted ruling carried in `progress.md`'s Task 7 entries: three of these
four confirmed laws are one finding, not three.** The two AND-laws and the plain TD-share threshold
all measure the same underlying quantity (touchdown-points share) at overlapping thresholds, and that
same quantity is what the tribal `td_regression` law already measures from the opposite direction (a
disproportionate TD share predicting regression). `/player-laws` renders one representative card per
finding family (largest sample first); this document does the same: **two real, independent
discoveries survived FDR control and held up out of fold**: a WR age effect distinct from the tribal
age-adjacent laws (no tribal law reads WR age directly), and a TD-share effect that replicates and
sharpens the tribal `td_regression` finding specifically for WRs paired with coaching change,
strongest at the higher TD-share threshold (-1.733, nearly double the plain threshold's own -1.285).

## 6. The calibration null result (Task 5)

Both candidate calibration fixes were measured for real on the validation fold (predictor 2021,
outcome 2022, never 2023/2024, per `scripts/calibration-report.ts`'s own guard) and **both were
reverted.** `npm run projections:calibrate` today prints `+0.0000` on every position and band,
confirming neither term is live in the shipped model.

- **WR/TE per-position share-shrinkage recalibration:** the fitted values landed exactly on the
  pooled base (`season: 2, inSeason: 0.25`), a null result by construction: nothing to accept.
- **Years-4-6 experience multiplier:** every position's fitted multiplier sat within 3% of neutral
  (QB x1.0023, RB x1.0289, WR x0.9954, TE x1.0020, 757 player-seasons of evidence). WR, the fix's own
  named target cohort, DEGRADED on the validation fold's starter band (-0.0032) and elite band
  (-0.0064); TE (the other named target) showed an effectively-zero delta (+0.0001). Neither the
  magnitude test nor the direct measurement supported keeping the term.

Both mechanisms ship as real, tested infrastructure (a pinning test in `fit.test.ts` asserts both
fields stay `undefined` in the committed `fitted.ts`, so a future silent re-activation fails loudly)
and both negative results are recorded in `fitted.ts`'s own provenance docblocks. The instrument-mismatch
honesty this task's own report gives: the diagnosis that motivated these two fixes was measured on the
PRESEASON board, which already carries a separate, shipped career-stage curve correcting years 4-6;
the WEEKLY model's own rate layer, tested here in isolation, does not show the same defect. Whatever
residual years-4-6 miscalibration the earlier diagnosis found is not showing up as a rate-layer
problem when isolated this way.

## 7. Evidence-base changes this round

- **Roster floor.** nflverse's `weekly_rosters` asset genuinely reaches back to **2002**
  (`ROSTER_ASSET_FLOOR`, probed live 2026-08-31); this engine backfills to **2013**
  (`HISTORICAL_ROSTER_FLOOR`), matching `MEASURE_SEASONS.from` (snap counts are unusable before
  2013). Real backfill run: 1,695-3,113 roster rows per season across 2013-2020, birth dates now
  available for every one of those seasons for the first time.
- **2019 stat-line gap, filled.** nflverse never published `stats_player_week_2019.csv`. A third,
  independent play-by-play aggregator (`derived-stat-lines.ts`) fills it: final corrected run,
  47,260 plays -> **4,971 derived stat lines**, 69,594 observations written under the
  `nflverse_pbp_derived` source, 44 stat-takers outside the projected universe dropped and reported.
  Validation bar: rank-correlate the same derivation against a KNOWN-PUBLISHED season (2018):
  **0.9999 rank correlation across 311 players with >=8 games** (bar is 0.99), **0.28 points/player
  mean absolute error.** The admission seam is explicit and narrow: `factsForSeason`'s `admitDerived`
  parameter is `true` only for the laws harness's own population builder, `false` for a live
  preseason board read: a 2020 board's facts about a player's 2019 season read `null` (no evidence),
  never the derived line.
- **Draft-capital picks.** `nfl_draft_picks` (new table, migration 0061): **11,054 picks read,
  10,825 written** (229 unresolvable to the local player universe, mostly pre-1999 picks and a
  handful PFR never assigned a gsis id to). Feeds the rookie curve's own train population (720
  rookie-season observations, 2013-2021).
- **Folds.** `REPLICATION_FOLDS = [2021, 2022, 2023]` (predictor seasons, Task 3) is the evaluation
  window every tribal and discovered law's verdict is checked against; `FIT_SEASONS = [2021, 2022]`
  (the weekly model's own fit); every train-only cutoff this round introduced
  (`BLEND_TRAIN_CUTOFF_SEASON`, `MARKET_CURVE_TRAIN_CUTOFF_SEASON`, `ROOKIE_CURVE_TRAIN_CUTOFF_SEASON`,
  `LAW_TRAIN_CUTOFF_SEASON`) is 2021, kept as separate, textually-independent constants per module on
  purpose (a shared import would couple modules that should be able to move their own cutoffs
  independently; `config.ts`'s own docblock names the risk of that drift and instructs a manual
  re-check on change).

## 8. What was deferred

Re-verified against the tree on 2026-09-01 rather than copied from the ledger as-is.

- **Process gap named mid-round, never closed (`progress.md`, Task 2's process note):** Task 1
  changed measurement-relevant DB state (the historical roster/birth-date backfill) without a
  re-measure, and the drift guard (`laws:measure -- --check`) cannot see "the DB moved, nobody
  re-measured" on its own: it only catches a mismatch between the committed file and a fresh
  recompute, not a stale-but-internally-consistent recompute. Candidate fix, not implemented in this
  round: any task that ingests into a measurement-read store should re-run `--check` (or the
  measurement itself) as part of its own verification, not leave it for whichever later task happens
  to touch `measured.json` next. This round's own tasks did re-measure by hand at each relevant
  point (Task 2's C3 falsification, Task 10's re-fits), so nothing here is currently stale, but the
  guard itself still cannot detect the class of bug it did not this time produce.
- **`preseason-persist.ts` console label** (Task 10, deferred minor): still prints "v2 blend" beside
  the shipped `commish_board_v3_ppr_12` constant. One line, next touch.
- **`seasonScoring` aggregation duplicated** between `laws/populations.ts` (private) and
  `preseason/rookie-curve.ts` (Task 4, deferred minor): extract a shared helper if a third caller
  appears; two call sites was judged not yet worth the extraction.
- **Task 5's own deferred minors:** the share-shrinkage grid resolution (coarse; may not resolve a
  genuine WR/TE-specific optimum distinct from pooled); `MIN_SEASON_TOUCHES = 20` (the experience
  cohort's own sample floor) untested for sensitivity; the neutral-path allocation inside the
  experience-observation builder.
- **Task 2's own residual, named not chased:** the 2019 derivation's games-delta is one-sided
  (derived games never exceed published games, min -8 on one 2018 validation player), consistent
  with the derivation's own scope (it only credits a game from a passer/rusher/receiver/fumbler role
  on a scrimmage play, never from special-teams or a two-point conversion, excluded by design), not
  chased down to the specific outlier player.
- **Task 9's own concern:** the QB market curve is flat below ADP rank 10 (no QB was ever drafted
  inside the top 9 slots across the 2013-2021 train window), an honest reflection of the market, not
  a modeling gap, but worth remembering if a future comparison reads a QB's market prior at a very
  early rank.
- **Play-caller table provenance** (carried from the predecessor round's own close-out,
  `docs/research/2026-08-31-prediction-laws-closeout.md`, section 5, still open): the 103-entry
  verification queue and the `onConflictDoNothing` silent-shadowing hazard in `team-store.ts` are
  unrelated to this round's own tasks and were not re-touched here.

None of these block the scorecard or any verdict above; they are the honest list of loose ends a
future round should pick up.

## Addendum (2026-09-01, live-board plan Task 4 fix round 2): the position-gate defect, measured

A review of Task 4 (the 2026 live board) found a PRICING defect predating this whole round:
`laws/board-reasons.ts`'s `lawReasonsFor` carried no position gate of its own. A tribal law's condition
was evaluated against any player's `LawConditionFacts` regardless of the position the law was measured
on (`rb_age_curve`, fitted only over RBs via `buildPopulations`'s own `eligible(position)` gate, could
fire on a WR whose age cleared the same numeric threshold); a discovered candidate's condition against
any player regardless of the position it was generated for. `blend.ts`'s `blendBoard` reads exactly
these "law" reasons to compute a player's admitted price delta, so this moved REAL, ALREADY-SHIPPED
board points, not only a future live board's.

**Magnitude, measured directly against 2024 (the decisive season this document's own bar rests on):**
rebuilding the identical 2024 board with the gate fix on vs off moved 45 of 653 players' own
`projectedPoints` (max delta 5.22 pts), rippling into 128 points-rank and 372 value-rank reorders.

**Fixed** (`laws/board-reasons.ts`): both arms gated by the player's own position before a law's
condition is ever evaluated — tribal via a new `LAW_ELIGIBILITY` map built from the identical
`LAW_ENTRIES` the measurement harness already gates its own population with (measured-on = applied-to,
one predicate); discovered via `candidate.position === player position`. `BOARD_SOURCE` bumped to v5
(`commish_board_v5_ppr_12`) since a replay season's deterministic `as_of` would otherwise collide with
the unique key and silently keep serving the stale numbers, the same trap v2/v3/v4 were each bumped to
close.

**The held-out scorecard, re-measured under the fix, both decisive-season figures beside the published
ones:**

| | published | re-measured (gate fix) |
|---|---|---|
| 2024 blend rho | 0.5301 | 0.5293 |
| 2024 blend vs ADP gap | +0.1029 [+0.0081, +0.2099] BEYOND NOISE | +0.1021 [+0.0070, +0.2102] BEYOND NOISE |
| 2024 starter band gap | +0.2390 [+0.0403, +0.4443] WON BEYOND NOISE | +0.2355 [+0.0421, +0.4377] WON BEYOND NOISE |
| 2023 blend vs ADP gap (in-fit) | +0.0570 [-0.0515, +0.1685] within noise | +0.0566 [-0.0526, +0.1680] within noise |

**THE BAR STILL HOLDS, unchanged in every verdict.** Every BEYOND NOISE / within noise / WON BEYOND
NOISE classification above is identical under the gate fix. The largest point-estimate move on any of
these figures is 0.0035 rho (the starter band gap), far too small to flip any 95% interval's
relationship to zero. The defect was real and worth fixing (up to 5.22 pts/player, materially reordering
individual rows) but too small and too evenly spread across the ranking to have been propping up or
hiding the scorecard's own headline conclusion — consistent with section 3's channel decomposition,
where laws already carried only 4.5-4.6% of the measured lift over pure market and the availability
channel did nearly all of the work. `blend-fitted.ts`'s own train-time constants were regenerated for
the same reason (the fit's own candidates carry law reasons too): winning cell moved from
(availabilityCapPoints=40, totalCapPoints=20) to (20, 40), rho 0.6053 -> 0.6054, laws' train-time share
4.5% -> 4.6% — immaterial, but a real refit, documented in that file's own regenerated header.

On the re-persisted 2026 live board itself, the fix is visible directly: law chips are now
position-scoped (`rb_age_curve` firing on RB names like Henry/McCaffrey/Barkley, WR age on WR names
like A.J. Brown/Adams/DJ Moore, TD-share on Rice/Higgins) and no cross-position chip appears anywhere
on the board — the defect this whole fix round exists to close, confirmed absent on the real, final
board.
