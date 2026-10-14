# The Rest-of-Season Board, Round 2: Results

**Run:** 2026-10-14 (UTC), once, by
`uv run python -m research.model.ros judge --round 2 --database <scratch copy> --out <file>`.
**Preregistration:** `2026-10-14-rest-of-season-round2-preregistration.md`, committed as `5cd3f1ff`
before any fit; the development check recorded as `2cd0da62` (no amendment) before the judgment.
**Tree:** `2cd0da62` (`model_version` `research@2cd0da62`), arithmetic `v8-fdlibm-fused/pow-apple-libm`.
**Data:** round 1's scratch copy `lane18_ros` (port 5433), unchanged: the dev copy's `research`
schema dumped 2026-10-14 plus 2025's published weekly stats and week-one roster through the house's
ingests. Nothing of 2026 was read.
**Every number:** `2026-10-14-rest-of-season-round2-results.json`.

## Decision

**A gate failed. Nothing ships.** 72 cells judged (G1, G2, G3 at weeks 8 and 12, four positions,
three formats) plus G4: **16 of 73 lines failed**.

- **G1 (rho over the stale board, >= +0.04): 22 of 24 passed.** Failed: week-8 standard receivers
  (+0.0297) and week-8 standard tight ends (+0.0385). Every PPR and half PPR cell passed; the
  passing margins run +0.052 to +0.269.
- **G2 (starters' rank error <= the stale board's): 21 of 24 passed.** Failed: week-8 receivers in
  half PPR (19.64 against 18.75) and standard (21.25 against 19.28), week-12 standard tight ends
  (12.25 against 11.67).
- **G3 (coverage per week within [0.75, 0.85]): 13 of 24 passed.** Failed: running backs at both
  weeks in all three formats (0.59 to 0.70, too narrow), week-12 quarterbacks (0.857, by 0.007),
  week-12 receivers in half PPR (0.744) and standard (0.715).
- **G4, isolation: passed.** Outcomes read for 2021-2024 (fit) and 2025 (judgment) only; the five
  tables' digests unchanged.

The board stays the preseason projection with its caption. Round 2's model, `commish_ros_v2`, is not
retuned or rerun against 2025. Step 4 (the nightly switch) was not built.

## Every judged cell, PPR

The same statistics as round 1 (half PPR and standard in the JSON, `numbers.cells`).

| W | Pos | n | rho model | rho board | rho form | rho ECR | err model | err board | coverage | MAE |
|---|---|---|---|---|---|---|---|---|---|---|
| 8 | QB | 42 | 0.572 | 0.390 | 0.496 | 0.401 | 7.58 | 8.75 | 0.786 | 43.5 |
| 8 | RB | 84 | 0.678 | 0.489 | 0.636 | 0.539 | 9.71 | 11.75 | 0.643 | 30.8 |
| 8 | WR | 127 | 0.604 | 0.540 | 0.540 | 0.527 | 19.44 | 19.47 | 0.772 | 29.4 |
| 8 | TE | 46 | 0.569 | 0.474 | 0.525 | 0.557 | 9.25 | 11.58 | 0.848 | 26.1 |
| 12 | QB | 42 | 0.482 | 0.381 | 0.438 | 0.383 | 11.50 | 11.92 | 0.857 | 32.8 |
| 12 | RB | 86 | 0.756 | 0.496 | 0.701 | 0.548 | 9.62 | 11.83 | 0.698 | 18.1 |
| 12 | WR | 128 | 0.587 | 0.482 | 0.553 | 0.475 | 25.19 | 28.18 | 0.758 | 19.5 |
| 12 | TE | 45 | 0.523 | 0.261 | 0.423 | 0.337 | 8.58 | 11.08 | 0.756 | 18.5 |

## Reading the result

The ordering is the round's success: in PPR and half PPR the rest-of-season model beats the stale
board by at least the doubled margin in all 16 cells, and in every PPR cell it also beats season
form and the preseason ECR. Its misses in ordering are week-8 standard scoring, where receivers and
tight ends score fewer points from receptions and the season-to-date sample is noisier, and three
rank-error cells, two of them standard.

The interval is the round's failure. Fitted per week on two seasons, it is too narrow for 2025's
running backs at both weeks (0.59 to 0.70 inside), the way round 1's pooled interval hid. The
development check on 2024 failed G3 in 16 of 24 cells on both sides of the band, so per-week
calibration from two fit seasons does not transfer from season to season at this tolerance. With
40 to 130 players a cell, the sampling error is about 0.035 to 0.06, but the 2025 running-back misses
(-0.05 to -0.16 below the band) are larger than sampling explains.

## The fit

2023 and 2024 (opportunity line 2021-2024), 6,834 population rows over weeks 6-16 (the searches on
weeks 7-15). PPR: k, alpha QB 1.0, 0.8; RB 1.5, 0.8; WR 2.0, 0.8; TE 3.0, 0.5. k_q QB 8, RB 6, WR 8,
TE 16. Return after an absence of 1, 2, 3+ games: next 0.326, 0.306, 0.213; later 0.595, 0.563,
0.433. Interval ratios (p10, p50, p90), PPR, week 8 / week 12: QB 0.01, 1.02, 2.03 / 0.00, 0.94,
1.96; RB 0.19, 0.92, 1.84 / 0.03, 0.92, 1.85; WR 0.18, 0.93, 1.90 / 0.05, 0.92, 1.88; TE 0.35,
1.08, 1.96 / 0.19, 1.02, 1.97. Every number in the JSON's `priors`.

## Development check

Fit 2023, judged 2024 weeks 8 and 12 (`2026-10-14-rest-of-season-round2-dev-check.json`): G1 passed
in all 24 cells; G2 failed for week-8 receivers in all three formats; G3 failed in 16 of 24. No
defect found, no amendment.

## The cost of looking at 2025 three times

2025 has now been judged by three rounds, each preregistered and each run once:

| Round | Model | Cells judged on 2025 | Failed |
|---|---|---|---|
| Lane 12, weekly projection | `commish_weekly_v1` | 22 (plus G5 isolation) | 12 |
| Lane 18, round 1 | `commish_ros_v1` | 84 (plus G4) | 11 |
| Lane 18, round 2 | `commish_ros_v2` | 72 (plus G4) | 16 |
| **Total** | | **178** | **39** |

Each round was designed knowing every earlier round's 2025 numbers: round 2's switch week came from
round 1's weeks 4, 8 and 12 on 2025, and its doubled margin was the only correction made for that.
A pass on a third look would have been weaker evidence than a pass on a first. The ordering result
(22 of 24 cells at twice round 1's margin, after round 1 already showed the week-8 and week-12
margins) is not independent confirmation. A fourth round on 2025 would be harder still to read. The
clean test left is 2026 itself, registered prospectively.

## What a next round would need

1. **An interval that holds from season to season**, not one fit per week on two seasons: for
   example, a wider quantile pair calibrated across 2023 and 2024 together, gated on the pooled
   season with a per-week report, or a ruling that the board ships ordering without a floor and
   ceiling until the interval passes.
2. **A decision on the judgment season.** The store holds no other clean season: 2021 and 2022
   cannot build the board, and 2023-2024 are the fit. Either 2026 is judged prospectively (the
   pristine-year ruling would have to allow a forward register of rest-of-season boards), or the
   store gains a rebuildable earlier season (week-one rosters for 2021-2022, which the house's
   ingest can add).
3. **Stamped weekly roster statuses**, captured nightly, so designations can enter a later model
   (the next lane's item).

## The ruling this judgment was taken under

Quoted from the coordinator of this session, 2026-10-14, after round 1 failed (also appended to
the round-2 preregistration):

> "Round 2 dispatched with a new preregistration: switch week S (prior 6), raw-line points a game,
> per-week interval, judged at weeks 8 and 12 on 2025 with G1 margin doubled and the
> multiple-testing cost named."

## Errata (2026-10-14, after the record review)

- **The switch week's rationale has an arithmetic error.** The preregistration says round 1's
  "week 8's smallest ordering margin, +0.034, already clears even this round's doubled margin". It
  does not: +0.034 is below +0.04. That cell, week-8 standard receivers, then failed G1 here at
  +0.0297. S = 6 was not supported by round 1's weakest week-8 cell.
- **2021 and 2022 could have been fit.** The preregistration names 2021 and 2022 as unusable for
  lack of a week-one roster. The store held both (2,721 and 2,873 rows), as round 3's
  preregistration corrects. The consequence: this round fit on 2023-2024 only.
