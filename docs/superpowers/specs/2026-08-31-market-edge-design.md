# Market Edge: anchored blending, calibration fixes, law discovery, and stronger evidence

Date: 2026-08-31
Status: approved direction (founder: "Let's do all of them"; design calls delegated)
Owner: engine
Predecessor: docs/superpowers/specs/2026-08-31-prediction-laws-design.md (shipped; board ties
ADP 2023, trails 0.0098 in 2024; losses diagnosed in
docs/research/2026-08-31-prediction-laws-closeout.md)

## The goal and the bar

Make the preseason board beat ADP on held-out seasons. The bar (spec-binding, reported
honestly either way, same as last round): the BLENDED board's scorecard beats the ADP
benchmark on BOTH held-out seasons on rank correlation, and never loses to the market in the
starter bands (top-100 by position groups) by more than noise. Parity is the floor by
construction (see Part 1); the edge comes from confirmed deviations.

## Part 1 — Market-anchored blend (the structural change)

The current board prices all ~300 players from scratch and pays for every miscalibration.
The blend inverts the stance: ADP is the prior; the model spends disagreement only where it
holds quantified evidence.

- **Market prior**: a module converting the ADP feed (already ingested, `players.adp`,
  historical ADP snapshots in the projections store for backtests) into a baseline board:
  rank → expected-points curve fit per position per season (the "market curve"), so market
  and model speak the same unit (projected season points), never raw rank arithmetic.
- **Deviation engine**: final board points = market curve + capped, evidence-gated deltas.
  A delta is admitted only from named sources: a CONFIRMED law whose condition holds for the
  player (registry-measured effect, the existing `lawReasonsFor` machinery), availability
  (expected games from the existing model, which the market prices lazily), and rookie
  draft-capital priors (Part 4). Each admitted delta is capped (tunable constant, fit on
  train seasons only) and carries a `BoardReason` — the deviations ARE the explanation chain.
- **Where the model has no admitted evidence, the board IS the market.** That sentence is
  the design.
- **Validation**: the existing backtest/benchmark scorecard, blended vs raw-model vs ADP vs
  ECR vs naive, on held-out seasons. Blend parameters (caps, shrinkage) are fit on
  2013–2021 only; 2022–2024-outcome seasons stay untouched until the final scorecard.

## Part 2 — Calibration fixes (the diagnosed losses)

From the close-out's diagnosis, three targeted fixes to the RAW model (which supplies
deviation candidates even under the blend):

- **WR starter-band miscalibration**: recalibrate the opportunity model's target-share
  shrinkage for WRs (the confirmed persistence law's own feature, `predictOpportunity`);
  measured against the starter band specifically.
- **TE starter band** (worst positional loss both held-out seasons): same treatment; if TE
  remains behind the market after recalibration, the blend simply admits fewer TE deviations,
  which is the honest fallback.
- **Years-4–6 over-projection**: an experience-year term in the per-game rate priors
  (career year from the historical rosters already ingested), fit on train seasons.

Each fix lands only if the backtest shows the position/cohort improving without degrading the
rest; otherwise it is reverted and the negative result recorded.

## Part 3 — Law discovery (the unpriced edge)

Confirmed tribal laws are priced into ADP; discovery hunts for patterns the market has not
named. Memory ruling honored: discovery needs a stricter bar than single-law trials.

- **Candidate generator**: enumerate conditions from templates over the existing
  `LawConditionFacts`-style quantities plus the facts store's other gated reads (usage,
  red-zone, air-yards, scheme, play-caller, age/experience, team context): threshold
  crossings, year-over-year deltas, and combinations of at most TWO conditions (caps the
  search space and keeps claims speakable). Position-scoped. Expected sign derived from the
  train-window measurement, not asserted.
- **Discovery harness**: measure every candidate with the EXISTING matched-DiD harness
  (stratified matching, seeded bootstrap) on the train window; control false discovery with
  Benjamini–Hochberg at q = 0.10 across the full candidate set; survivors must then
  replicate direction on the held-out subset (same rule as tribal laws) AND clear a minimum
  sample floor. Survivors get auto-generated plain-words claims from their template
  (template → sentence rendering, no hand prose per law) and land in the registry with
  `origin: "discovered"` provenance.
- **Product**: discovered-confirmed laws flow into the same registry → chips → laws page
  pipeline; the laws page gains a discovered section with the same honest framing plus one
  sentence on how discovery is controlled. Discovered laws are deviation sources for Part 1
  only after replication, same as tribal confirmed laws.
- **Report every count**: candidates tested, BH survivors, replication survivors — on the
  laws page and in the close-out. A reader can see the multiple-comparisons discipline.

## Part 4 — Stronger evidence

- **Birth dates pre-2021**: extend the preseason-roster ingestion back through 2013 (nflverse
  rosters carry birth dates historically) so `rb_age_curve` and the experience term measure on
  the full window; re-run `laws:measure` and commit whatever the verdicts become.
- **2019 stat lines from play-by-play**: the 2019 pbp IS ingested; derive gap-season stat
  lines from pbp aggregation as a clearly-labeled second source (`derived_pbp`), filling the
  window hole for measurement only (never for display). Validate the derivation by comparing
  a non-gap season's derived lines against its published lines (agreement bar: rank
  correlation ≥ 0.99 on season points; report the number).
- **Rolling replication folds**: replication checks use 2021+2022 predictor-season folds in
  addition to 2022+2023, so verdicts stop hinging on two years; the verdict rule generalizes
  to "direction holds on every fold with pairs" (capped at weak when any fold disagrees).
- **Rookie draft-capital prior**: ingest nflverse draft picks; rookie baseline becomes a
  draft-slot curve fit on historical rookie outcomes (train seasons), replacing the flat ADP
  anchor for rookies inside the blend, with a `rookie` reason already in the union.

## Sequencing

1. Part 4 data first (birth dates, 2019 derivation, draft picks) — everything downstream
   reads it.
2. Rolling folds + re-measure tribal laws on the strengthened window.
3. Part 2 calibration fixes on the raw model (train-window fitting, backtest validation).
4. Part 3 discovery (generator → BH → replication → registry/page/chips).
5. Part 1 blend (market curve → deviation engine → reasons) and the final held-out scorecard.
6. Close-out doc: the bar met or missed, stated plainly, with every count.

## Out of scope this round

Weekly in-season projections (separate instrument; laws-for-weeks is a later round), FAAB,
new UI surfaces beyond the laws page's discovered section and existing chips, any new
database engine, ECR/FantasyPros as a model input (licensing gate stands), Tank01 quota
spends (nflverse only).

## Test and copy rules

Same as last round: engine suites TDD and green serially; UI suites stay on the deferred
ledger; leakage discipline absolute (as-of-gated reads, train/held-out separation for every
fitted constant); no em-dashes in user-facing or printed copy; every published figure renders
from measured objects; debunked/failed results ship as content, never hidden.
