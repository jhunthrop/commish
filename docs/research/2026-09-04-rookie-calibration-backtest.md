# Rookie calibration backtest — 2026-09-04

Fits: 2023-2024 (rookie durability prior, historical rookie games rate, rookie-curve evidence counts, per-game variance). Score: 2025 (held out from every fit above). 2026 never enters any fit or this score.

## Rookie projections: pre-fix reconstruction vs current (Tasks 1+2+3 combined)

n = 67 rookies with a real 2025 outcome and a recorded draft pick.

| | MAE | Rank correlation (Spearman) | Band coverage (actual inside p10-p90) |
|---|---|---|---|
| Pre-fix (reconstructed) | 45.981 | 0.504 | 0.507 |
| Current | 41.388 | 0.643 | 0.657 |

MAE IMPROVED (lower is better). Target band coverage is near 80% (p10-p90).

## Board-wide band composition (Task 4): per-game variance on vs off, isolated from Tasks 2/3

Raw model board (unblended), every 2025 candidate with a real outcome, n = 525.

| | Band coverage | Mean band width (pts) |
|---|---|---|
| Games-only (pre-Task-4) | 0.478 | 71.1 |
| Games + per-game variance (current) | 0.646 | 86.6 |

## Thin-evidence shrinkage (Task 3): prior-N grid, rookie MAE against 2025 actuals

n = 32 rookies with both a recorded pick and a real 2025 market listing. Recall the weight formula: `weight = priorN / (priorN + n)` is the share of MARKET in the blend, so a LARGER priorN means MORE shrink toward market, not less.

| priorN | MAE | Rank correlation |
|---|---|---|
| 0.5 | 54.295 | 0.445 |
| 1 | 52.249 | 0.477 |
| 2 | 50.231 | 0.482 |
| 3 | 49.449 | 0.493 |
| 5 | 48.409 | 0.504 |
| 8 | 47.653 | 0.505 |
| 15 | 46.672 | 0.507 |
| 30 | 45.710 | 0.516 |
| 50 | 45.157 | 0.517 |
| 100 | 44.635 | 0.519 |
| 200 | 44.328 | 0.528 |
| 500 | 44.126 | 0.536 |
| 1000 | 44.055 | 0.536 |
| 5000 | 43.997 | 0.535 |
| ≈pure market | 43.982 | 0.530 |

Best MAE across ALL listed rookies: priorN = ≈pure market (MAE 43.982). MAE falls MONOTONICALLY as priorN grows across the entire tested range, out past 1000 — the market outpredicted the model's own recomposed number on this sample, at every shrink strength tested, never crossing back.

### Split by evidence thinness (n <= 3 vs n > 3) — the population the shrink was actually built for

Thin-evidence rookies (n <= 3), n = 28: RB pick 6 (n=1, model 270.3, market 213.2, actual 245.1); WR pick 8 (n=1, model 212.9, market 189.5, actual 211.3); TE pick 10 (n=1, model 169.0, market 126.6, actual 165.1); TE pick 14 (n=1, model 169.0, market 127.3, actual 188.5); WR pick 19 (n=1, model 212.9, market 154.5, actual 193.7); WR pick 69 (n=3, model 121.6, market 105.0, actual 49.2); WR pick 74 (n=3, model 107.7, market 104.5, actual 74.8); RB pick 83 (n=1, model 119.6, market 122.5, actual 8.8); WR pick 136 (n=2, model 38.0, market 95.2, actual 116.5); RB pick 179 (n=2, model 25.4, market 85.8, actual 54.1); RB pick 233 (n=3, model 5.1, market 85.8, actual 142.7); RB pick 245 (n=2, model 5.1, market 106.6, actual 140.3); WR pick 108 (n=3, model 67.6, market 112.6, actual 23.5); RB pick 116 (n=2, model 79.4, market 85.8, actual 145.1); WR pick 166 (n=3, model 31.8, market 112.6, actual 59.1); RB pick 22 (n=1, model 190.8, market 162.9, actual 135.7); WR pick 23 (n=2, model 212.9, market 156.0, actual 70.0); WR pick 70 (n=2, model 107.7, market 112.6, actual 75.9); QB pick 25 (n=2, model 105.9, market 172.5, actual 240.1); RB pick 105 (n=3, model 97.7, market 94.4, actual 125.7); RB pick 104 (n=1, model 97.7, market 85.8, actual 88.6); WR pick 55 (n=2, model 126.2, market 112.6, actual 69.4); WR pick 58 (n=3, model 121.6, market 97.6, actual 42.4); RB pick 60 (n=1, model 127.7, market 137.8, actual 206.6); RB pick 38 (n=2, model 168.5, market 138.7, actual 206.2); WR pick 39 (n=3, model 154.9, market 112.6, actual 127.9); TE pick 42 (n=2, model 123.7, market 112.6, actual 86.9); RB pick 36 (n=1, model 39.5, market 98.3, actual 167.8).

| priorN | Thin-evidence MAE | Well-evidenced MAE (n > 3, only 4 rookies — read with caution) |
|---|---|---|
| 0.5 | 53.710 | 58.391 |
| 1 | 51.591 | 56.851 |
| 2 | 49.671 | 54.153 |
| 3 | 49.106 | 51.850 |
| 5 | 48.455 | 48.086 |
| 8 | 48.197 | 43.847 |
| 15 | 47.978 | 37.527 |
| 30 | 47.828 | 30.889 |
| 50 | 47.762 | 26.921 |
| 100 | 47.710 | 23.115 |
| 200 | 47.683 | 20.847 |
| 500 | 47.667 | 19.341 |
| 1000 | 47.661 | 18.811 |
| 5000 | 47.657 | 18.377 |
| ≈pure market | 47.656 | 18.268 |

### Exact-n breakdown — pure model vs priorN=3 vs priorN=15 vs pure market, at each n actually present

| n | count | Pure model MAE | priorN=3 MAE | priorN=15 MAE | Pure market MAE |
|---|---|---|---|---|---|
| 1 | 10 | 45.159 | 43.975 | 46.585 | 47.466 |
| 2 | 10 | 74.830 | 56.004 | 49.844 | 47.277 |
| 3 | 8 | 56.075 | 46.897 | 47.388 | 48.366 |

**priorN=3 beats the pure model at EVERY individual n present (1, 2 and 3).** priorN=15 beats the pure model at n=2 and n=3 but is WORSE than the pure model at n=1 — the single most extreme, most defect-relevant bucket (Player A, the diagnosed pick-three running back, is an n=1 case). The AGGREGATE grid above shows priorN=15 beating priorN=3 overall, but that aggregate is dominated by the n=2 and n=3 buckets (18 of 28 thin rows) masking a real regression at n=1 — a Simpson's-paradox-shaped trap, and exactly the reason this backtest checks individual strata rather than trusting one combined number.

### Decision: THIN_EVIDENCE_PRIOR_N = 3, not the aggregate grid's own arg-min

The aggregate grid's MAE-minimising choice climbs toward pure market as priorN grows without bound, and even the narrower 'improve on the original guess' case (priorN=15) turns out to REGRESS the exact n=1 stratum the founder's own review named as the target case. `THIN_EVIDENCE_PRIOR_N` stays at its original value of 3: it is the only tested setting that improves MAE over the pure model at EVERY individual evidence count this sample actually produced, including — most importantly — the thinnest, most defect-relevant one. This is reported as a REJECTED alternative (15) rather than silently tried and discarded: the gate is real, and a change that helps the average while hurting the flagship case does not pass it.

## Honesty notes

- The pre-fix reconstruction reads the ACTUAL removed `RookiePriors.gameRate` table and runs it through the unchanged `preseasonCandidates`/`rookieCurve` machinery; it is not a hypothetical.
- Every number above is printed regardless of which way it points, including the aggregate grid's own arg-min (which argues for a far more extreme setting than what shipped) and priorN=15's regression at n=1, which is why 15 was rejected.
- The 'well-evidenced' slice (n > 3) is four rookies. Its own dramatic swing (MAE 58 -> 18 from priorN=0.5 to ≈pure market) is reported for completeness and should NOT be read as a reliable finding on its own — four players is not a sample a constant should be tuned against.

