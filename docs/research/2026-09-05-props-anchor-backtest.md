# Props-anchor backtest — 2026-09-05

Fits: 2023-2024 (`propsAnchorWeight`, pooled, the only moving axis). Judge: 2025, scored once. 2026 never enters this fit or this score — see `scripts/props-anchor-fit.ts`'s own header for why the archive's own growing 2026 rows are structurally unreachable here.

Every other `BlendConstants` field (`lawCapPoints`, `availabilityCapPoints`, `totalCapPoints`, `impliedGamesByPosition`, `marketTailByPosition`) is carried unchanged from the committed `FITTED_BLEND_CONSTANTS` (`blend-fitted.ts`). This fit moves ONE axis.

## Coarse grid (0 to 1 by 0.1), fit evidence (2023+2024, pooled)

| weight | covered rho | covered MAE | board rho | board MAE |
|---|---|---|---|---|
| 0.00 | 0.5534 | 60.3078 | 0.8252 | 32.2886 |
| 0.10 | 0.5561 | 60.0818 | 0.8254 | 32.2333 |
| 0.20 | 0.5578 | 59.9120 | 0.8255 | 32.1916 |
| 0.30 | 0.5570 | 59.8365 | 0.8255 | 32.1731 |
| 0.40 | 0.5577 | 59.8792 | 0.8255 | 32.1836 |
| 0.50 | 0.5560 | 60.0457 | 0.8253 | 32.2244 |
| 0.60 | 0.5542 | 60.3433 | 0.8253 | 32.2974 |
| 0.70 | 0.5491 | 60.7985 | 0.8250 | 32.4089 |
| 0.80 | 0.5439 | 61.4127 | 0.8245 | 32.5595 |
| 0.90 | 0.5390 | 62.1830 | 0.8240 | 32.7483 |
| 1.00 | 0.5347 | 63.0291 | 0.8235 | 32.9557 |

## Fine grid around the coarse winner (0.2), same fit evidence

| weight | covered rho | covered MAE | board rho | board MAE |
|---|---|---|---|---|
| 0.12 | 0.5576 | 60.0410 | 0.8255 | 32.2232 |
| 0.14 | 0.5583 | 59.9994 | 0.8256 | 32.2131 |
| 0.16 | 0.5584 | 59.9651 | 0.8255 | 32.2047 |
| 0.18 | 0.5586 | 59.9347 | 0.8256 | 32.1972 |
| 0.22 | 0.5579 | 59.8885 | 0.8255 | 32.1859 |
| 0.24 | 0.5573 | 59.8722 | 0.8255 | 32.1819 |
| 0.26 | 0.5579 | 59.8606 | 0.8255 | 32.1790 |
| 0.28 | 0.5577 | 59.8486 | 0.8255 | 32.1761 |

## Winning weight: propsAnchorWeight = 0.18

Chosen on the props-covered subset's rank correlation (this engine's primary metric — fantasy is an ordering problem) against the FIT evidence only. Ties go to the incumbent (0); 2025 was not read to make this choice.

## Per-season fit-evidence breakdown (props-covered subset)

### 2023 (props-covered subset, n=130)

| | n | rho | MAE |
|---|---|---|---|
| incumbent (0) | 129 | 0.5417 | 60.4575 |
| weight=0.18 | 129 | 0.5525 | 60.0344 |

### 2024 (props-covered subset, n=197)

| | n | rho | MAE |
|---|---|---|---|
| incumbent (0) | 197 | 0.5558 | 60.2097 |
| weight=0.18 | 197 | 0.5549 | 59.8694 |

## The judge season (2025) — scored exactly once

| | n | rho | MAE |
|---|---|---|---|
| incumbent (0), whole board | 676 | 0.8252 | 31.2514 |
| weight=0.18, whole board | 676 | 0.8257 | 31.1233 |
| incumbent (0), props-covered | 211 | 0.6278 | 57.8548 |
| weight=0.18, props-covered | 211 | 0.6328 | 57.4445 |

### Per position, props-covered subset only

| position | n (incumbent) | incumbent rho | incumbent MAE | n (winner) | winner rho | winner MAE |
|---|---|---|---|---|---|---|
| QB | 31 | 0.3388 | 66.7755 | 31 | 0.3132 | 67.3806 |
| RB | 52 | 0.6818 | 67.6785 | 52 | 0.6798 | 66.7746 |
| WR | 91 | 0.6221 | 56.0266 | 91 | 0.6268 | 55.6808 |
| TE | 37 | 0.5127 | 41.0708 | 37 | 0.5186 | 40.3446 |

QB is the one position that gets WORSE on the judge season at this weight (rho 0.3388 -> 0.3132, MAE 66.7755 -> 67.3806, both worse) — the four verified prop markets (`props-anchor.ts`) price passing yards but never touchdowns or interceptions, which is a larger share of a QB's own fantasy total than of any other position's; RB, WR and TE all improve or hold on both metrics. This is reported as a real, disclosed tradeoff, not a footnote: the board-wide and props-covered aggregates both improve despite it, but a QB-specific reader should know the aggregate is not free.

## Gate verdict

**propsAnchorWeight = 0.18 beats the incumbent (0) on the 2025 judge season's own props-covered rank correlation. Wired into the fitted constants — see Task 2's persist-path plumbing.**

## Coverage

- 2025 props-anchor coverage: 212 players.
- 2023 props-anchor coverage: 130 players.
- 2024 props-anchor coverage: 197 players.

## Honesty notes

- Every grid cell above is printed regardless of which way it points, coarse and fine alike.
- `propsAnchorWeight` only ever moves a player whose season carries an archived pre-kickoff line for him; every other candidate's predicted points are bit-for-bit identical to the incumbent at every weight tested, which is why the whole-board numbers move far less than the props-covered ones and are reported for completeness rather than as the deciding metric.
- The fit evidence pools 2023 and 2024 rather than fitting on 2023 alone and validating on 2024 as a second, independent step — a genuine three-way split (fit strictly on 2023, select against 2024, judge on 2025) is the rookie round's own recommended follow-up protocol and would need more archive-covered seasons than exist today to run without a two-season fit evidence pool being thin on its own.
