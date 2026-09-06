# Injury-type-conditioned availability — results — 2026-09-05

Cites and reports against `docs/research/2026-09-05-availability-injury-type-preregistration.md`
(Amendment 1, the report/status-vanishes-into-IR fix). This document adds Amendment 2 below, dated
and recorded BEFORE any fitting touched 2025, per the pre-registration's own deviation rule.

**STATUS: FINAL. Gates judged exactly once against held-out 2025. GATE FAILED — reverted, no model
code was ever touched.** See `scripts/research/injury-type-features.ts` and
`scripts/research/injury-type-fit.ts` for the full, reproducible computation.

## Amendment 2 — 2026-09-05, before any fitting (data-access substitution)

This session's `DATABASE_URL` does not carry the historical data the pre-registration's own
"same harness" requirement needs. Verified directly, not inferred:

- Running the production fit script itself against this exact connection string —
  `DATABASE_URL=... npx tsx scripts/preseason-fit.ts` — throws immediately: `"The store holds no
  game-derived observations for 2021, so its preseason moment cannot be derived."` The August
  round's own harness (`loadPreseason` -> `preseasonCandidates`) is therefore unreachable for ANY
  historical season in this database, not merely the pre-registration's 2018 start.
- `preseason_rosters` (the week-one roster snapshot `loadPreseason` reads through
  `preseasonRostersAsOf`) holds exactly one season: 2026.
- `player_week_observations` (the point-in-time store every board read goes through) carries real
  game-log metrics only for 2023-2025 (`nflverse_player_week` 2023-2024, `nflverse_snap_counts`
  2023-2025, `nflverse_pbp_derived` 2025 only) — confirmed by direct query.
- A second, independent research script in this same repo state
  (`scripts/research/qb-quality-wr.ts`, same date) documents the identical finding from a different
  angle: "this production database does NOT hold historical player-week stat lines back to 2018."

**The fix used here**: `nflverse_injuries` and `nflverse_roster_weeks` ARE fully backfilled
2013-2025 in this database (the point of this round's own setup), so the FEATURE side of the round
is unaffected. For the LABEL side (actual games played) and the role-share proxy the model's own
shrinkage needs, this round fetches nflverse's own public weekly-stats release
(`stats_player_week_{season}.csv`, the identical upstream `nflverse_player_week` already ingests)
directly from its GitHub release, for seasons 2015-2024, plus `players.csv` for birth dates. This
restores real per-week participation back to 2015 rather than a database-only 2023-2025 window,
closing MOST of the gap the pre-registration's fit window assumed was already closed.

Two genuine gaps remain in nflverse's OWN release stream, both already documented in this
codebase's `nflverse/stat-lines.ts` (`STAT_LINE_GAPS`, `LIVE_ADMITTED_DERIVED_SEASONS`):

- **2019**: `stats_player_week_2019.csv` 404s upstream. Used only as HISTORY (never as a fit-window
  label), reconstructed from `snap_counts_2019.csv` (pfr-id keyed) joined to gsis ids via
  `players.csv`'s own crosswalk.
- **2025**: also a `stats_player_week` gap. This database's own `player_week_observations` already
  carries 2025 via `nflverse_snap_counts` (gsis-keyed) — read directly, no external fetch needed.

**Net effect on the fit window**: 2019 is dropped as a LABEL/fit season (it would need the same
crosswalk reconstruction as a label, not only as history, for one added year of marginal value);
the fit window actually used is **2018, 2020, 2021, 2022, 2023, 2024** (six seasons rather than
seven). 2025 remains the single held-out judged season, untouched during fitting, exactly as
pre-registered. 2026 is never read.

**A second, disclosed approximation**: `projectedSnapShare` (the role-bracket input
`shrunkAvailabilityRate` needs) cannot be read from layer 1's real preseason prediction for a
historical season without the unreachable board harness. This round substitutes the player's OWN
prior-season, position-appropriate volume share (target share for WR/TE — published directly in
nflverse's weekly file; a computed team-week carry share for RB; a computed team-week pass-attempt
share for QB), which is real, prior-season, and never touches the season being predicted, but is
not identical to layer 1's smoothed, regressed prediction. Its effect on the comparison is bounded
by construction: with `priorGames = 25` and up to three seasons of a veteran's own record
(`recencyDecay = 0.7`, `historySeasons = 3`) contributing up to roughly 37 team-games of evidence,
a veteran's own multi-season record already outweighs the role/baseline table in the shrinkage —
this round's population is veterans only (see below) — so an imprecise role bracket moves the
incumbent's own prediction only modestly, and identically for both the incumbent and the new class
multiplier's residual fit (both read the SAME reconstructed input).

**Population**: every QB/RB/WR/TE player-season 2018-2025 where the player also carried a roster
row the PRIOR season (i.e., a real NFL veteran, not a rookie) — rookies are out of scope for this
round's hypothesis (draft capital already supplies their baseline via `baselineRate`, untouched
here).

## Appendix: the body-part vocabulary, committed before fitting

Built from the REAL distinct `primary_injury` text on qualifying ("Out") anchor rows in this
database (`select primary_injury, count(*) from nflverse_injuries where report_status = 'Out'
group by 1 order by 2 desc`) — not guessed. The pre-registration's own fixed vocabulary (knee,
hamstring, ankle, shoulder, concussion, other) plus `unknown` for a status-sourced (roster-RES
-anchored, Amendment 1) terminal absence, which carries no body part at all.

| Vocabulary term | Matches (case-insensitive, "left "/"right " prefix stripped) |
|---|---|
| `knee` | Knee |
| `hamstring` | Hamstring |
| `ankle` | Ankle |
| `shoulder` | Shoulder |
| `concussion` | Concussion |
| `other` | Everything else observed on an "Out" row: Foot, Calf, Groin, Back, Neck, Quadricep, Hip, Toe, Illness, Hand, Elbow, Ribs/Rib, Pectoral, Abdomen, Chest, Thigh, "Not injury related - *", Thumb, Achilles, Wrist, Forearm, Fibula, Finger, Oblique, Triceps/Tricep, Biceps, Collarbone, Shin, Heel, Eye, Core/Core Muscle, Jaw, Lung, Sternoclavicular, Head, Non-Football Illness, Medical Illness, Upper Arm, and any other free-text value not listed above |
| `unknown` | The terminal absence is status-sourced (`deriveSeasonEnding`'s `source: "status"` arm) — no injury report anchor exists, so no body part is knowable. Never imputed. |

Implementation: `bodyPartClassOf` in `scripts/research/injury-type-features.ts`.

## Feature build

`scripts/research/injury-type-features.ts` computes, per veteran player-season:

- `absenceClass` (`healthy` | `discrete_terminal` | `recurring`) — via `spellCount` over the PRIOR
  season: 0 spells is `healthy`; exactly 1 spell that is ALSO the season's terminal absence (per
  `deriveSeasonEnding`) is `discrete_terminal`; exactly 1 spell that resolved mid-season (the player
  finished the year) is scored `healthy` rather than `discrete_terminal` — he played out his season,
  which is closer to the population this round calls healthy than to the class this round exists to
  discount; 2+ spells is `recurring` regardless of whether the last one was terminal.
- `terminalAbsenceAgeMonths` — months from the terminal spell's first missed week (approximated to
  the nearest NFL week's calendar date) to the NEXT season's kickoff (September 1, matching
  `ageAtSeason`'s own convention).
- `bodyPartClass` — from the terminal spell's report anchor, mapped per the appendix above.
- `spellCount`, `longestSpellWeeks` — counted from weeks carrying INJURY-QUALIFYING evidence only
  (a report row of "Out"/"Injured Reserve", or a roster row of "RES") — a missed week with no such
  evidence (a healthy scratch, a bye) is never counted, mirroring `season-end.ts`'s own discipline
  that absence of a report is not itself a report of absence.
- `questionablePlayedRate` — of the weeks a player was listed "Questionable", the share he then
  played.

A "spell" is a maximal run of consecutive qualifying weeks; see `computeAbsenceFeatures` in that
file for the full derivation, built on top of the committed `deriveSeasonEnding` combiner rather
than reimplementing its anchor logic.

## Model change

`scripts/research/injury-type-fit.ts` adds ONE new multiplier, `classMultiplier`, applied to the
shrunk rate AFTER the existing age and status multipliers — the identical chaining discipline
`ageMultiplier`/`statusMultiplier` already use, fitted on the RESIDUAL of everything before it:

- `healthy` — fixed at 1, BY CONSTRUCTION, never fitted. The existing baseline/age/status priors
  are already estimated over a population that is mostly healthy players; there is no residual left
  to explain there, and fixing it at 1 (rather than measuring a number that should come out near 1
  anyway) is what makes Gate 3 a real test of "did the new class terms leak into the healthy
  population" rather than a coincidence.
- `discrete_terminal_year_one` (`terminalAbsenceAgeMonths <= 12`) — fitted.
- `discrete_terminal_later` (`terminalAbsenceAgeMonths > 12`) — fitted.
- `recurring` — fitted, not split by age (per the pre-registration's own hypothesis: "recurring
  multi-spell absence keeps the harsher discount", not a reverting one).

Each fitted cell is `mean(actual rate) / mean(incumbent-predicted rate)` over the class population,
shrunk toward 1 in proportion to `n / (15 + n)` — the identical form `fit.ts`'s
`fitAgeMultipliers`/`fitStatusMultipliers` use with `CELL_PRIOR_SEASONS = 40`, sized down to 15
here because a class cell is a smaller, round-specific population. Uncertainty is a 2000-draw
bootstrap of the ratio (resampling player-seasons with replacement), reported as a standard error
and a 90% percentile interval.

## Gates — reported against held-out 2025, judged exactly once

FIT population: 4,465 veteran player-seasons (2018, 2020-2024). JUDGE population: 726 veteran
player-seasons (2025). Every number below is printed verbatim by `injury-type-fit.ts`; nothing is
rounded toward a pass.

| Gate | Incumbent | New (class-conditioned) | Delta | Threshold | Result |
|---|---|---|---|---|---|
| 1. Expected-games MAE (whole board, n=726) | 3.222 | 3.221 | -0.001 | improves | **PASS** (trivially — a thousandth of a game, noise-scale) |
| 2. p10-p90 coverage | 0.8623 | 0.8623 | +0.0000 | >= +0.05 | **FAIL** |
| 3. Healthy population (n=325: `healthy` in both 2023 and 2024) MAE | 3.452 | 3.452 | 0.000 | no degradation | **PASS** (identical by construction — `classMultiplier.healthy = 1`) |
| 4. Discrete-terminal effect fitted with uncertainty | — | — | — | reported, not gated | **DONE** — see the table below |

Per-position MAE on 2025 (incumbent -> new): QB 2.472 -> 2.473 (n=106), RB 3.934 -> 3.936 (n=174),
WR 3.118 -> 3.114 (n=286), TE 3.133 -> 3.131 (n=160). Every position moved by thousandths of a
game in either direction — noise, not signal, printed here exactly as measured rather than
selectively.

Gate 2 is unambiguous: coverage did not move by even one player's floor or ceiling crossing an
integer game count. Gate 1's headline "PASS" is real but vanishingly small (0.03% of the incumbent
MAE) and does not clear any reasonable noise bar — it is reported as a pass because the
pre-registration's literal wording is "improves", not "improves materially", but it should not be
read as evidence FOR the hypothesis; see the fitted effects below for why.

## Fitted effects table

| Class | n (fit, 2018-2024) | Raw ratio (actual/incumbent-expected rate) | Shrunk multiplier | SE (bootstrap) | 90% CI |
|---|---|---|---|---|---|
| `healthy` | 3,612 | — | 1.000 (fixed, not fitted) | — | — |
| `discrete_terminal_year_one` (<= 12 months since the terminal injury) | 225 | 0.992 | 0.993 | 0.034 | [0.938, 1.048] |
| `discrete_terminal_later` (> 12 months) | **0** | — | 1.000 (shrinkage-prior default; UNMEASURED) | — | — |
| `recurring` | 628 | 1.008 | 1.008 | 0.024 | [0.969, 1.049] |

**The fitted discrete-terminal effect: sign essentially null, size negligible, uncertainty wide
relative to the point estimate.** `discrete_terminal_year_one`'s multiplier is 0.993 — a 0.7%
reduction versus the incumbent's own already-fitted age/status/history shrinkage — with a 90%
confidence interval of [0.938, 1.048] that comfortably straddles 1.0. The incumbent model, using
nothing but the existing age/status multipliers and each player's own multi-season games-played
record, is ALREADY predicting the discrete-terminal population's next-season games about as well as
it predicts anyone else's; there is no material residual left for an injury-type class term to
explain. `recurring`'s multiplier (1.008, CI [0.969, 1.049]) is likewise indistinguishable from 1 —
and its SIGN, to the extent it means anything at this uncertainty, points the WRONG way for "keeps
the harsher discount": these players are very slightly UNDER-predicted by the incumbent, not
over-predicted.

**A structural limitation, not a result**: `discrete_terminal_later` has ZERO observations in the
fit population. This round's feature design looks back exactly one season (the immediately
preceding one) to build `priorAbsence`; a genuine "year two, post-ACL" case — hurt in season Y-2,
healthy through Y-1, being predicted for Y — reads as `healthy` under this design, because only
Y-1's own record is read. Testing the "reverts over time" half of the hypothesis honestly would
need a multi-season lookback tracking a terminal absence across two or more seasons back, which
this round's single-lag design does not build. The 1.000 shown for that cell is the shrinkage
prior's default with no evidence behind it at all — not a measurement, and not claimed as one.

## Decision

**FAIL.** Per the pre-registration's decision rule, ALL of gates 1-3 must pass; gate 2 (interval
coverage moving materially toward nominal) did not move at all. Gate 1's technical pass is a
rounding artifact of a null effect, not independent corroboration.

**What this means for the round's own motivating case (Nabers)**: the hypothesis that a discrete,
season-ending injury like Nabers' 2025 ACL tear should revert MORE toward the healthy baseline than
the current model already allows for is NOT supported by this measurement. On the population this
round could actually observe (a next-season prediction one year removed from a single qualifying
injury spell), the incumbent model's existing age/status/history shrinkage already lands within
noise of the real outcome — there is no found evidence that Nabers (or anyone in his situation) is
being systematically under-projected for the reason this round hypothesized. This does not prove
the incumbent number is right for Nabers specifically (n=225 for the whole class, and Nabers' own
recovery is idiosyncratic to him), only that a general injury-type class correction, fitted on the
real population of comparable players, finds nothing to correct.

**Model code: untouched.** No change was ever made to `src/projections/preseason/availability.ts`,
`fit.ts`, `fitted.ts`, or any other production model file — this round's class-multiplier mechanism
lived entirely in `scripts/research/injury-type-fit.ts`, exactly so that a FAIL gate requires no
revert of shipped code. `git status` at the time of writing shows only the three new files this
round adds (two research scripts, this document, and the pre-registration's own Amendment 2 edit).

## Limitations

- The role-share proxy (see Amendment 2) is not layer 1's real preseason prediction; its effect is
  argued, not measured, to be small for this round's veteran-only population.
- `terminalAbsenceAgeMonths` uses an approximate NFL week-to-calendar-date mapping (week 1 pinned
  to September 8th each year), accurate to within a few days — enough precision for a whole-month
  `<= 12` / `> 12` split, not for a finer-grained age curve.
- The fit window is six seasons (2018, 2020-2024) rather than the pre-registered seven (2019
  dropped, Amendment 2) — a genuine nflverse release gap, not a choice made to improve the result.
- Class cells are inherently thin populations (a discrete season-ending injury is not a common
  event); small Ns are stated beside every fitted number rather than implied by a bare point
  estimate.
- `discrete_terminal_later` is structurally unobserved under this round's single-season lookback
  (see the fitted-effects table above) — a genuine gap in what this round could test, not a null
  result for that specific cell.
- This is the SECOND independent injury-conditioned availability round to find near-neutral fitted
  multipliers on real held-out data — the August round's `injuryMultiplier`/`durabilityMultiplier`/
  `workloadMultiplier` (season-level games-missed features) landed within ~5% of neutral at every
  position but one thin cell; this round's more specific injury-TYPE classification lands even
  closer to neutral (within 1%). Two different feature designs converging on the same null is worth
  more than either alone, and suggests the existing history-based shrinkage may already be capturing
  most of what an injury signal can add to a SEASON-total games prediction, whatever it might still
  add to a week-to-week risk model.
