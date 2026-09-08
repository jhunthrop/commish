# Scoring-format boards: PPR, half PPR and standard, with the ADP anchor per format

**Run:** 2026-09-08, on the dev store, by `npm run projections:formats:scorecard` (held-out) after
`npm run projections:adp:ingest -- --formats=half,std 2013 2026` (the backfill) and
`npm run projections:market:fit -- --format=half` / `--format=std` (the curves).
**Ask:** the founder's "Can we have a selector for PPR / Half-PPR / Standard?", ruled by the
coordinator as per-format boards under exact scoring, anchored to each format's own ADP feed.
**Tree:** the scoring-formats round's branch, `worktree-agent-a95200254f2621e0c`.

## What a format changes, and what it does not

The projection engine carries a per-game stat line per player, receptions included, so scoring a
board under another preset is one scoring pass over the same lines. The market blend, though, does
not carry the line through: `market/blend.ts` encodes a blended season total into a points-only
line (`pointsOnlyPerGame`, receiving yards at 0.1 a yard in every preset), so re-scoring a blended
candidate under half PPR returns the PPR number. The format therefore enters the blend itself, in
exactly four places, and nowhere else:

1. **The raw arm's own points** (`seasonPointsOf`, the unlisted fallback) under the format's rules.
2. **The ADP anchor**: the format's own published board (`ffc_adp_half_12`, `ffc_adp_std_12`)
   priced through the format's own fitted curve (`curve-fitted-half.ts`, `curve-fitted-std.ts`).
3. **The rookie prior**: the PPR rookie curve, rescaled per candidate by the share of his own
   projected points that survives the format change (`formatRatioOf`; the identity under PPR).
4. **The unlisted tail**: the committed PPR tail restated at the two curves' exchange rate over
   draft slots 100-150 (`market/format-anchor.ts`; see "What is not format-clean").

Then `preseasonBoard` scores under the format's rules, and value, tiers and the reason rows follow
from that format's points. The PPR leg is byte-identical to the board before this round: the PPR
anchor is the committed objects by reference, the rookie ratio is `x / x`, the tail is untouched.

## The ADP feeds

Fantasy Football Calculator publishes all three formats. Probed live on 2026-09-08 and then
ingested into `preseason_rankings` under each format's own source:

| format | source | seasons published | rows a season | resolution |
| --- | --- | --- | --- | --- |
| PPR | `ffc_adp_ppr_12` | 2013-2026 (already held) | 184-255 | as before |
| half PPR | `ffc_adp_half_12` | 2018-2026 (2013-2017 return an empty board) | 124-222 | 98.5-100% |
| standard | `ffc_adp_std_12` | 2013-2026 | 163-226 | 93.8-100% |

The nightly `adp-snapshot` job now captures all three formats, three upstream requests a fire
where it was one, each under its own source and `format` (`ppr_12`, `half_12`, `std_12`). No
schema change was needed: the existing unique index on `(player_id, source, captured_at)` already
separates the formats because the source differs.

## The curves

Fit by the same isotonic (pool-adjacent-violators) regression as the PPR curve, over each format's
own boards with each season's outcome scored under that format's rules, inside the same structural
cutoff (`MARKET_CURVE_TRAIN_CUTOFF_SEASON`, 2021), held out 2023 and 2024.

| format | train seasons | player-seasons | QB rank 12 | RB rank 12 | WR rank 12 | TE rank 12 |
| --- | --- | --- | --- | --- | --- | --- |
| PPR (committed) | 2013-2021 | (committed file) | 301.1 | 220.9 | 243.8 | 208.6 |
| half PPR | 2018-2021 | 723 | 368.4 | 217.7 | 235.1 | 227.0 |
| standard | 2013-2021 | 1,511 | 310.4 | 176.5 | 168.5 | 166.4 |

The rank-12 figures are the curves read at slot 12; the PPR row is the committed file, which was
fit on an earlier state of the store. Half PPR pools four seasons where the other two pool nine, and
its quarterback knots are visibly noisier (its first fitted QB slot is 18, its deepest 175 at 74
points against PPR's 172); the deep band the tail exchange rate reads over (slots 100-150) is
dense in all three.

**A drift finding, not acted on.** `npm run projections:market:fit -- --check` on today's store
reports the committed PPR curve no longer reproduces (RB rank-1 knot 227.1 committed against 228.2
refit; the store's population has moved since the fit, the crosswalk class fix among the causes).
The served v9 board was measured under the committed curve, so it is not regenerated here; a refit
is a fit-round decision. The two new curves are fit on today's store, which the reader should hold
beside the PPR one.

## The held-out result, per format

`scripts/scoring-format-scorecard.ts`: the market-blended board for each format, built at the
replay moment exactly as the persist builds it, scored against every player's actual season under
that format's rules, bootstrapped against that format's own ADP (seed 20260901, 1,000 resamples,
Ruling P3's "beyond noise" is the 95% interval on the rank-correlation difference excluding zero).
The bar is the closeout's own: beat ADP on rank correlation on decisive 2024 (predicted from 2023,
out of fit), and never lose a band beyond noise.

### 2024, decisive

| format | n | blend rho | ADP rho | gap | 95% CI | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| PPR | 176 | 0.5659 | 0.4272 | +0.1387 | [+0.0273, +0.2603] | beyond noise |
| half PPR | 158 | 0.5743 | 0.4053 | +0.1690 | [+0.0513, +0.2831] | beyond noise |
| standard | 160 | 0.6149 | 0.3891 | +0.2258 | [+0.1175, +0.3445] | beyond noise |

Bands, 2024: the starter band (ADP 51-150) is won beyond noise in every format (PPR +0.3007
[+0.0911, +0.5170]; half +0.3405 [+0.1332, +0.5442]; standard +0.3775 [+0.1822, +0.5723]). The
elite band is within noise in every format and positive in every format. The deep band is within
noise everywhere and thin (26, 8 and 10 players); half PPR's deep band of eight is not a
measurement of anything. No band is lost beyond noise in any format.

### 2023, in-fit caveat (predictor 2022 sits inside `FIT_SEASONS`)

| format | n | blend rho | ADP rho | gap | 95% CI | verdict |
| --- | --- | --- | --- | --- | --- | --- |
| PPR | 173 | 0.5353 | 0.4752 | +0.0602 | [-0.0680, +0.1859] | within noise |
| half PPR | 169 | 0.5650 | 0.4461 | +0.1188 | [-0.0118, +0.2556] | within noise |
| standard | 162 | 0.5738 | 0.3769 | +0.1969 | [+0.0518, +0.3555] | beyond noise |

2023 standard wins the elite and starter bands beyond noise; the other two formats are positive
within noise overall and in every band but deep, where all three are negative within noise.

### Reading it

Both new formats clear the bar on the decisive season, and by wider margins than PPR. That is not a
claim that the half or standard model is better than the PPR one: the standard board's ADP is a
weaker benchmark (ADP rho 0.389 against PPR's 0.427), and a board whose raw arm scores receptions at
nothing simply disagrees with a room that drafts pass catchers as if they scored a point. The
honest statement is narrower: each format's board beats that format's own room on the season the
model never fit on, and loses nothing beyond noise in any band.

**A dated observation on the PPR row, recorded and not acted on.**

- 2026-09-02, the v9 confirmatory read (`board-store.ts`'s `BOARD_SOURCE` docblock): decisive 2024,
  blend vs ADP +0.0979 [-0.0068, +0.2203], within noise, on the store as it stood that day (664
  stored 2024 v9 rows).
- 2026-09-08, this round: the unchanged `scripts/market-edge-scorecard.ts 2024` on the dev store
  as it stands today (664-row 2024 board, 204 PPR ADP rows, n=176 scored) reads blend rho 0.5659,
  ADP rho 0.4272, gap +0.1387 [+0.0363, +0.2565]; this round's scorecard reads the identical rho
  and gap ([+0.0273, +0.2603] under its own bootstrap pairing).

The code path is the same in both readings and unchanged by this round; the store differs. Nothing
is re-fit on this observation.

## What is not format-clean, named rather than hidden

- The blend's caps (`lawCapPoints` 2, `availabilityCapPoints` 20, `totalCapPoints` 40) and the
  implied games per position were fit in PPR points (`blend-fitted.ts`) and are reused unchanged. A
  two-point law cap is a slightly larger share of a smaller standard-scoring number.
- The law registry's train effects are PPR per-game deltas, applied as they are.
- The rookie curve is PPR and is rescaled per candidate by his own stat mix, which is the honest
  shape of the difference (a receiving back keeps less of his total than a rushing one) but is not
  a refit.
- The unlisted tail is a converted PPR depth, not a measured one. The format curve's own deepest
  knot was rejected because it is a singleton: standard scoring's WR tail read as exactly 0 points
  (one receiver drafted at slot 172 who never scored), which would cap every unlisted receiver at
  nothing.
- The half-PPR curve pools four seasons.
- The capsule writer's fact sheet and the dossier's per-game ranks stay on the PPR board this round.
- `capsules/facts/depth-reads.ts`'s `adpHistoryFor` reads `adp_snapshots` with no source filter, so
  after the first three-format capture it will see three rows per player per night. Out of bounds
  this round; it needs `eq(adpSnapshots.source, BENCHMARK_SOURCES.adp)` before the job's next fire
  in production.

## The three boards on dev, 2026, top ten by value

Taken live at 2026-09-08T21:23:13Z, 546 rows under each source.

| # | PPR | pts | half PPR | pts | standard | pts |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Puka Nacua WR | 344.3 | Ja'Marr Chase WR | 315.4 | Ja'Marr Chase WR | 245.6 |
| 2 | Ja'Marr Chase WR | 329.4 | Puka Nacua WR | 312.1 | Puka Nacua WR | 242.3 |
| 3 | Jaxon Smith-Njigba WR | 310.1 | Jaxon Smith-Njigba WR | 298.2 | Jahmyr Gibbs RB | 222.8 |
| 4 | Jahmyr Gibbs RB | 257.2 | Amon-Ra St. Brown WR | 278.8 | Bijan Robinson RB | 221.1 |
| 5 | Bijan Robinson RB | 255.5 | CeeDee Lamb WR | 276.4 | Jaxon Smith-Njigba WR | 225.5 |
| 6 | Amon-Ra St. Brown WR | 293.6 | Jahmyr Gibbs RB | 249.5 | Amon-Ra St. Brown WR | 224.2 |
| 7 | CeeDee Lamb WR | 289.5 | Bijan Robinson RB | 247.7 | CeeDee Lamb WR | 221.8 |
| 8 | De'Von Achane RB | 240.0 | Drake London WR | 264.1 | De'Von Achane RB | 209.9 |
| 9 | Chris Olave WR | 275.2 | Justin Jefferson WR | 262.7 | James Cook RB | 200.1 |
| 10 | George Pickens WR | 270.0 | De'Von Achane RB | 243.7 | George Pickens WR | 208.0 |

By points rather than value, the standard board's top five are all quarterbacks (Allen 299, Jackson
298, Maye 288, Hurts 281, Williams 280), which is what a board that scores receptions at nothing
should say and why value order is the served order. The PPR generation also moved against the
2026-09-03 one (516 of 546 players' points moved, median 2.7, max 67.4; `expected_games` moved on
all 546): the live store moved over five days, and nothing in the format path touches expected
games.

## Where the selector lives, and where it does not

PPR / Half PPR / Standard segments on the league-free Draft HQ board (a server re-render on
`?format=`, remembered per browser and applied on the next unnamed load), on the HQ page's board
card (the same memory, three previews switched locally), and on `scripts/rankings-export.ts
--format`. Every one of them names its format in its basis line and its CSV carries a `Scoring`
column. Inside a league there is no selector: the league's scoring row decides
(`league-service/board-format.ts`), a custom sheet reads the nearest of the three by points per
reception and the basis line says so once, and the draft room's reasons, the player page's on-board
check, the simulator and the assistant all read that board. The site search's board-rank tiebreak
stays PPR.
