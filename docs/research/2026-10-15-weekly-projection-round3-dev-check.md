# Weekly Projection Round 3: the development check, and why the judgment was not run

**Preregistration:** `docs/research/2026-10-15-weekly-projection-round3-preregistration.md`, committed as `e58ae444` before any code or fit of the round.
**Code:** `research/model/weekly3/` (Lane 48), with `model_version` and `implementation = 'python'` stamped on every row. Commits `754164e0` (shared reads and round 2's pieces opened to the caller, behaviour unchanged), `fe03cade` (the round and its tests), `dc39efce` (the judged weeks' stage-1 error read over the rows with a number, a reported number only, fixed before the recorded run).
**Run:** `python -m research.model.weekly3.round develop` on a scratch copy of the development store (`lane48_weekly`, local port 5433, restored from a dump of the dev copy's `research` schema), fit on 2021 and 2022, checked on 2023 weeks 6 to 17, once, on 2026-10-15, from a clean tree at `research@dc39efce`. It took 183 s: the rate refit 38.7 s (equal to the rest-of-season round 3 development record), the reads 88.4 s, the fit 0.4 s. The fit population held 4,560 rows, 4,557 of them with a number and 4,556 with stage-1 inputs. The check scored 2,444 population rows, 2,443 with a number. Every number is in `2026-10-15-weekly-projection-round3-dev-check.json`. One earlier `develop` run, on the code at `fe03cade` before the reported-only fix in `dc39efce`, printed the same 26 gate lines, and its output was not kept. The preconditions were checked and passed, since the run refuses otherwise, but this run's record does not hold their counts. The code now writes them into the record for any later run.

## Result

25 of 26 gate lines pass. The one that fails is G2 pooled against recent form, the gate the preregistration named as deciding:

| Gate | Result | Basis |
|---|---|---|
| G1, pooled against ADP | pass | +0.0802 rho against a margin of +0.0400, lower bound +0.0611 above 0, over 12 weeks |
| G1, every position against ADP | pass | QB +0.0096, RB +0.1688, WR +0.1373, TE +0.0050, each above the floor of -0.0200 |
| G2, pooled against recent form | **fail** | +0.0106 rho against a margin of +0.0200, lower bound -0.0140, below 0 |
| G2, every position against recent form | pass | QB +0.0005, RB +0.0172, WR +0.0225, TE +0.0021, each above the floor of -0.0200 |
| G3, places off against ADP | pass | model 11.870 against ADP 14.445, 2.575 fewer against a margin of 0.25 |
| G3, places off against recent form | pass | model 11.870 against recent form 12.374, 0.505 fewer against a margin of 0.25 |
| G4, QB cells (PPR, half, standard) | pass | below floor 0.136, 0.136, 0.136 and above ceiling 0.126, 0.129, 0.126, each inside 0.05 to 0.15, n = 427 |
| G4, RB cells | pass | below floor 0.078, 0.075, 0.086 and above ceiling 0.082, 0.078, 0.075, n = 1,031 |
| G4, WR cells | pass | below floor 0.074, 0.076, 0.070 and above ceiling 0.076, 0.073, 0.078, n = 1,600 |
| G4, TE cells | pass | below floor 0.080, 0.083, 0.099 and above ceiling 0.101, 0.110, 0.094, n = 775 |
| G4, the chance | pass | five bins gated, each within 0.05: [0.5, 0.6) 0.549 against 0.553 observed, [0.6, 0.7) 0.649 against 0.653, [0.7, 0.8) 0.748 against 0.767, [0.8, 0.9) 0.847 against 0.862, [0.9, 1.0) 0.932 against 0.930 |
| G5, isolation | pass | the fit read outcomes for 2021 and 2022 only, the check for 2023 only, the five tables unchanged, and the per-game clause held for every read that computes x and the rate: 1,058 games, 531 recorded reads, every row from a week before W (week W for filings) and stamped before its game's instant, the closest 0.1 h before. Round 2's week board, read at the week's first kickoff for the benchmarks and the reported factor ablation, sits outside the clause: it read clubs, filings and the stored week-W opponent ratings, none of them feeding the number and none stamped after the instant |

## The ruling

The stop rule applies. The preregistration (section 4) says a development check that fails G2 pooled against recent form ends the round. G2 pooled measured +0.0106 against a margin of +0.0200, with a lower bound of -0.0140. The judgment on 2024 was not run. 2024 stays clean for the weekly target, and no threshold moves.

What the check established, for the record:

- **Against ADP** the model leads by +0.0802 pooled (lower bound +0.0611) and at every position.
- **Against recent form** it is ahead at every position (QB +0.0005, RB +0.0172, WR +0.0225, TE +0.0021) but under the margin pooled. Round 2 measured +0.0033 (lower bound -0.0237) on the same check. Round 3 added +0.0072 and did not clear +0.0200.
- **Places off** fell to 11.870, against round 2's 12.116. The lead over recent form doubled, from 0.258 to 0.505.
- **Calibration** held in all 12 cells and all five chance bins.
- **The per-game instant.** The preregistration counted 754 of 780 Out or Doubtful filings for 2021 to 2023 weeks 6 to 17 in reach at each game's own kickoff under the model's club rule, against 119 at the week's first kickoff. In the check the filter withheld 1 population row in 2023 and 0 in the fit seasons, and flagged 148 and 303 Questionable. At Thursday's instant it withheld none. The filings reached the number mostly through vacated volume. A withheld teammate counted in 343 club-games of the fit seasons and 164 of 2023.

## Stage-1 RMSE by position and kind

The RMSE is against the week's count, with the season-to-date mean beside it. The fit rows are the fit population's rows with stage-1 inputs. The 2023 rows are the population's rows with a number and stage-1 inputs, read through the judgment's reader.

| Line | Fit rows | Stage 1 | Season mean | 2023 rows | Stage 1 | Season mean |
|---|---|---|---|---|---|---|
| QB targets | 619 | 0.111 | 0.123 | 305 | 0.060 | 0.075 |
| QB carries | 619 | 2.445 | 2.480 | 305 | 2.322 | 2.363 |
| QB red zone | 619 | 0.726 | 0.748 | 305 | 0.750 | 0.772 |
| QB snap share | 619 | 0.162 | 0.172 | 305 | 0.166 | 0.175 |
| QB pass attempts | 619 | 8.918 | 9.804 | 305 | 9.351 | 9.365 |
| RB targets | 1,297 | 2.093 | 2.171 | 722 | 1.975 | 2.012 |
| RB carries | 1,297 | 5.264 | 5.548 | 722 | 4.951 | 5.283 |
| RB red zone | 1,297 | 2.017 | 2.077 | 722 | 1.917 | 1.995 |
| RB snap share | 1,297 | 0.160 | 0.172 | 722 | 0.148 | 0.163 |
| WR targets | 1,976 | 2.850 | 2.927 | 1,074 | 2.729 | 2.783 |
| WR carries | 1,976 | 0.543 | 0.563 | 1,074 | 0.472 | 0.478 |
| WR red zone | 1,976 | 0.975 | 1.009 | 1,074 | 0.961 | 0.981 |
| WR snap share | 1,976 | 0.167 | 0.183 | 1,074 | 0.164 | 0.181 |
| TE targets | 664 | 2.370 | 2.450 | 340 | 2.592 | 2.615 |
| TE carries | 664 | 0.554 | 0.713 | 340 | 0.895 | 0.806 |
| TE red zone | 664 | 0.953 | 0.997 | 340 | 0.994 | 1.026 |
| TE snap share | 664 | 0.146 | 0.155 | 340 | 0.134 | 0.146 |

Stage 1 beats the season-to-date mean on every line but 2023's tight-end carries. Its 17 lines carry 166 coefficients, each line's design at full rank. The red-zone slopes (PPR) are QB 0.750, RB 0.530, WR 0.621 and TE 0.839 points per red-zone opportunity.

## Missing-input counts (population rows)

| Default | Fit 2021 and 2022 (4,560 rows) | 2023 (2,444 rows) |
|---|---|---|
| No game this season, x = m | 1 | 2 |
| No club, no number | 0 | 0 |
| His club without a game that week (the old club's bye in his first game after a trade), no number | 3 | 0 |
| Fewer than three games | 42 | 32 |
| No prior season | 575 | 377 |
| A line-week with no play-by-play row among his inputs | 1,601 | 846 |
| A line-week with no snap row | 0 | 0 |
| A club game with no pace or pass rate | 0 | 0 |
| No pace at all, the fit population's mean | 0 | 0 |
| An opponent with no game against the group, allowance 1 | 0 | 0 |
| A group with no expected total (almost always a quarterback group's targets), allowance 1 | 227 | 109 |
| A withheld teammate who played none of the club's last three games, adds 0 | 192 | 174 |
| No filing, clear | 3,475 | 1,860 |
| Outside the universe | 0 | 0 |
| First game after a trade | 15 | 6 |

## Reported ablations (2023, PPR, pooled)

| Variant | Against recent form (lower bound) | Against ADP (lower bound) | Places off |
|---|---|---|---|
| Round 3 as checked | +0.0106 (-0.0140) | +0.0802 (+0.0611) | 11.870 |
| Without vacated volume | +0.0100 (-0.0150) | +0.0797 (+0.0622) | 11.931 |
| Without the allowances | +0.0072 (-0.0175) | +0.0768 (+0.0574) | 11.979 |
| Every number at Thursday's instant | +0.0105 (-0.0143) | +0.0801 (+0.0626) | 11.916 |
| m times round 2's opponent factor, elasticities refit on 2021 and 2022 (QB pass 0.6, RB rush 0.5, WR pass 0.3, TE pass 0.9) | +0.0034 (-0.0236) | +0.0731 (+0.0561) | 12.115 |

The last row is a reported number only. Nothing that computes x reads it, and its week-W read of the stored opponent ratings happened outside the recording wrapper. It comes within 0.0002 of round 2's development check (+0.0033, +0.0729, 12.116), the difference being the rows the per-game filter treats differently. The rate m alone measured +0.0045 against recent form (lower bound -0.0234) and +0.0741 against ADP (lower bound +0.0596). Of round 3's +0.0061 over the rate against recent form, removing the allowances takes away 0.0034 and removing vacated volume 0.0005.

## Two things the replay showed about the data

- Moving the instant to each game's kickoff brought the filings into reach but barely changed the scored population. A player listed Out or Doubtful rarely records a line, so the filter withheld 1 population row in 2023. The Thursday view and the per-game view differ by +0.0001 against recent form.
- A quarterback group's targets are zero in most games, so its allowance has no ratio. It took the prior, 1, in 227 fit-population rows and 109 in 2023, a reading the code and the lane report write down.

## What ships

Nothing. The in-season screens keep the rest-of-season order and this week's facts, with no weekly point number and no start-and-sit chance sentence, as the in-season spec's section 10.1 says. Neither this model nor a retune of it is judged on 2024.
