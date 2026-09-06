# Kicker and Team Defense Projections: Preregistration

**Written:** 2026-09-05, before the 2025 judgment season had been read by anything in this round.
**Spec:** `docs/superpowers/specs/2026-09-05-kicker-defense-projections-design.md` §5 Phase B.
**Plan:** `docs/superpowers/plans/2026-09-05-kdef-phase-b-model-round.md`.
**Results:** `docs/research/2026-09-05-kicker-defense-preregistration-results.md` (written after, by
running `npm run projections:kdef:judgment` exactly once and committing its output verbatim).

## Blocked on

Nothing. Phase A is merged, the two history tables are backfilled 2013 through 2025, the market
benchmark now carries both positions, and the components are fit on 2013 through 2024 and committed
as `src/projections/preseason/kdef-fitted.ts`.

## Hypothesis

A kicker's and a team defense's season, composed from measured per-game components under the
league's own scoring, orders those two positions better than last season's points order does, and no
worse than the market's own draft order does.

The mechanism the hypothesis rests on is different for each position.

For a kicker: attempts travel with the club and make rates travel with the man. A kicker attempts a
field goal because his offense stalled at the thirty, which is a fact about the offense; he makes it
because he is a good kicker, which is a fact about him. A last-season-points order cannot separate
those two, so it cannot move a good kicker who signed with a bad offense.

For a team defense: sacks and takeaways per game are moderately persistent, and the points and yards
a defense allows are scored through nonlinear step tables whose expectation over a distribution is
not the value at the distribution's mean. A model that averages the tier function over a defense's
own shrunk per-game distribution is claiming to read something a points order structurally cannot.

## Features

Every component is a shrinkage blend of the unit's own recent evidence toward the league mean,
weighted by how much evidence there actually is. The one searched parameter per position is the
recency decay, searched over `[0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]` and scored on the components rather
than on fantasy points, so no scoring preset is baked into a model whose whole claim is that it
composes through the league's own rules. Every shrinkage weight is a documented floor of roughly one
season's evidence, not a searched parameter.

**Kicker.** Field-goal attempts per game and extra-point attempts per game, from the club he is on
for the projected season. Field-goal make rate and extra-point make rate, from his own attempts.
Share of his club's games played, from his own record. Fitted values: league field-goal attempts
1.9287 a game, extra-point attempts 2.3265, field-goal make rate 0.8458, extra-point make rate
0.9518, games rate 0.7843, recency decay 0.6.

**Team defense.** Sacks, interceptions, fumble recoveries, defensive touchdowns and safeties per
game, from the club's own recent games. Points allowed and yards allowed enter as a DISTRIBUTION,
not a mean: the tier function is averaged over the club's own recency-weighted games, mixed with the
league's pooled games at a weight set by the club's own game count. Fitted values: league sacks
2.3719 a game, interceptions 0.8185, fumble recoveries 0.5483, defensive touchdowns 0.0804, safeties
0.0313, points allowed 22.8075 a game over 6,270 games, yards allowed 361.1073, recency decay 0.8.

**Distribution.** Per-game performance variance is fit for both positions (13.40 for a kicker, 35.93
for a defense, in points squared) and composed with the games-played distribution and with the
model's own projection-error variance (1387.9 for a kicker, 1180.6 for a defense) through the law of
total variance.

**Team quality** enters through the club's own recent points and yards allowed, which IS the
measurement of it. The spec names prior-season point differential as the team-level signal held
historically; a club's own points allowed per game is half of that differential and is already the
quantity the tier tables score, so it is used directly rather than through a second derived
regressor. A season-win-total market, if one ever lands in the harvest, is a named amendment and not
a quiet addition.

## Fit and judgment

- **Fit:** 2013 through 2024 inclusive. Every fit function throws if handed a later season rather
  than filtering it out quietly.
- **Judgment:** 2025, read exactly once, by `scripts/kdef-judgment.ts`.
- **Never read:** 2026. It is the held-out data year and the judgment script refuses it outright.

**Baselines.**

1. **Last season's points order.** Each candidate's own 2024 season points under the league's rules.
   The arm gate G1 measures against.
2. **The market's own order.** The published average draft position for 2025, on the subset it
   covers. The arm gate G2 measures against.
3. **The league mean, a flat board.** Reported for context and deliberately NOT gated: a rank
   correlation against a constant is undefined by construction, so it is the thing an ordering beats
   by existing rather than a bar it clears.

## Gates

All four must pass, per position. Copied verbatim from the spec:

> - G1 Ordering. Spearman of model rank against 2025 actual season points beats the last-season-order baseline by at least 0.05.
> - G2 Market. On the ADP-covered subset, the model's Spearman is no worse than the ADP baseline by more than 0.02.
> - G3 Calibration. The "most seasons" band (p25 to p75) covers between 40% and 60% of 2025 actuals.
> - G4 Isolation. The QB, RB, WR, TE rows of the 2025 judgment board are byte-identical before and after the change.

They are implemented as pure functions in `src/projections/preseason/kdef-scorecard.ts`, with the
thresholds as one exported constant, so the judgment run and the ongoing harness cannot disagree
about what a gate measures. **A gate that cannot answer FAILS.** Every function returns `false` for a
sample too thin to measure, never `true`: shipping a labelled market order because the evidence was
absent is honest, and shipping projected points because a gate was vacuously satisfied is not.

## Decision rule

A position that passes all four gates ships as projected rows. A position that fails any of them
ships in market order, labelled as market order on the board, with no projected points and no tier,
and the failure is recorded here and in the register. The founder chose measured-first; the fallback
is what keeps rosters fillable if the measurement says no.

The fallback path is built whether or not it is taken. It is the failure branch, and a failure
branch nobody built is a failure branch that does not work.

## UX rider

Autopick's late-round policy ships regardless of this document's outcome. Whatever the measurement
says, a seat must finish a draft with a kicker and a team defense, and neither should be reached for
early. It landed as `3f2c92f`, before this was written, and depends on none of it.

## Amendments, all written before the judgment season was read

**A1. G3 is measured on p25 to p75, which is not the band the board renders.** The spec names the
"most seasons" band as p25 to p75. `seasonPointsBand` computes p10 to p90, and that is what a board
row shows. Rather than measure the gate on a wider interval than the spec wrote down, which would
make it easier to pass, the judgment computes the p25/p75 interval from the same composed mean and
variance (`Z75 = 0.6744897501960817`). This is the stricter of the two readings.

**A2. K and DEF do not join `FITTED_POSITIONS` in `fit.ts`.** The spec's Phase C bullet names it and
the honest implementation refuses. That table is the availability fit, whose label is
`gamesPlayedBySeason` off `player_week_observations` — which has never held a kicker row and can
never hold a team-defense row — and whose features are the projected snap share and the role
bracket, neither of which exists for either position. Adding them there would fit a cell against a
label that is structurally zero. Expected games is estimated inside this round's own modules
instead, from the tables Phase A ingested.

**A3. Two things the spec assumed existed did not, and both were built before this was written.**
The spec says "game scores by team and week are already ingested from the schedule file, so points
allowed exists historically". They were not: `mapSchedule` has parsed each game's points for and
against since the beginning, and `scheduleObservations` wrote neither, so the store held only who
WON. `SCHEDULE_METRICS.pointsAllowed` and a narrowed backfill were added (`a8e7993`). Separately,
the market benchmark held no kicker and no team-defense rows at all — 249 rows published for 2025
and 205 resolved, every one of the 44 misses one of these two positions, because a kicker is
published as `PK` and spelled `K` on the roster the resolver joins against, and a defense is not a
person and has no roster row. Both were fixed and backfilled (`540faf9`). Without the second, gate
G2 could not be measured and the market-order fallback could not be built.

**A4. Two development iterations were run on 2024, both recorded in the build ledger before this
document was committed, and 2025 was not read by either.**

- *Iteration 1* fitted on 2013-2023 and scored 2024. It found gate G3 failing badly for kickers: 8
  of 34 outcomes inside a band meant to hold half of them, 23.5%.
- *Iteration 2* fixed the cause, which was a real modelling defect rather than a tuning opportunity.
  `seasonPointsInterval` composed two sources of spread, both about OUTCOMES given a correct
  projection, and carried no term at all for how wrong the projection itself can be. Both fits now
  measure that residual variance directly, leave-one-season-out, squared about zero so an unfixed
  bias widens the interval rather than being subtracted out of the model's own error estimate. It is
  the dominant term: sd 37.3 points for a kicker against 15 from the outcome noise. Coverage moved
  to 61.8% for kickers and 50.0% for defenses on 2024.

Iteration stopped there. Kickers sit 1.8 percentage points past the 60% bar on a sample of 34, which
is one player either way, and narrowing further would be tuning a band to a threshold rather than to
a measurement.

**A5. What iteration 2 already showed about team defenses, stated here so the results document
cannot be read as a surprise.** On 2024, the model's defense ordering correlated NEGATIVELY with the
outcome (-0.1195), and last season's defense points correlated more negatively still (-0.2109). A
defense's season looks close to unpredictable from its own past, and last season's points look
actively misleading. The model was less wrong than the baseline, which is what G1 asks, and worse
than the market, which is what G2 asks. If 2025 repeats that shape, DEF fails G2 and ships in market
order, and that is the honest outcome rather than a disappointment.

## What would make this document wrong

If the judgment run is taken more than once, or taken after any change to the fitted priors, this
preregistration no longer describes what happened and the results document must say so explicitly.
The single run is the whole point of writing this first.
