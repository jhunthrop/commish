# Vegas laws close-out: win totals join the discovery family, plus the props archive begins

**Measured 2026-09-01.** Plan: `docs/superpowers/plans/2026-09-01-vegas-laws.md`. Spec:
`docs/superpowers/specs/2026-09-01-vegas-laws-design.md`. Ledger:
`.superpowers/sdd/2026-09-01-vegas-laws/progress.md`.

Every figure below is copied verbatim from the task reports this round produced
(`task-1-report.md` through `task-6-report.md`), from `scorecard-v7.txt`, or from the two addenda
appended to `docs/research/2026-08-31-market-edge-closeout.md`. Nothing here was recalled from
memory or re-derived by re-running a persist, a discovery pass, a fit, or the scorecard.

This is Task 5, the last task of the plan. Its job is to record what the round did, not to re-judge
it.

## 1. The sourcing story: the dataset

The primary source is the committed CSV in `github.com/greerreNFL/nfelosrs`
(`nfelosrs/Manual Data/win_totals.csv`), fetched once on 2026-09-01: 768 rows, 32 teams times 24
seasons, 2003-2026, columns `season/team/win_total/over_price/under_price/actual_wins/source/source_date`.
2026 rows are `draftkings`-stamped 2026-08-15 (real preseason publication); pre-2020 rows carry a
documented `not_tracked` convention date.

**The license ruling.** nfelosrs carries no license file. The rows are treated as factual betting
lines (facts, not copyrightable expression); use is internal model input with attribution in
`data/win-totals/README.md`, no redistribution surface, the same shape as this project's PFR/Stathead
ruling. If that reading is ever wrong, the schema is source-agnostic and the documented fallback is
a `covers.com` archive parse.

**Validation, full real run:**

```
Loaded 768 rows from data/win-totals/win-totals.csv across seasons 2003 to 2026.
Row count and team-set check: 0 violation(s).
Win total and price range check: 0 violation(s).
source_date precedes kickoff check: 0 violation(s).
actual_wins matches the store check: 0 violation(s).
PASS: all 768 rows across 24 seasons validated clean.
```

The Task 1 review independently reproduced this with a full 768-row programmatic diff against the
raw source (0 mismatches) and independently recomputed all 479 verifiable team-season `actual_wins`
values by hand against the store (0 mismatches). Team-code normalization (`LAR` -> `LA` from 2021,
`OAK` -> `LV` for any season 2020 or later) was verified against `team-eras.ts` across all 24
seasons. Three documented, non-silent gaps in `actual_wins`: 2003-2010 (no store schedule coverage,
256 rows empty), 2026 (unplayed, 32 rows empty), and 2022 BUF/CIN (2 rows empty, the Damar Hamlin
game cancellation that settled both teams at 16 games instead of 17).

## 2. The store

`src/projections/vegas/ingest.ts` writes three team-week metrics (`vegas_win_total`,
`vegas_win_total_over_price`, `vegas_win_total_under_price`) through the existing generic
`team_week_observations` table, no schema change. Real ingest:

```
Read 768 rows across 24 seasons (2003-2026).
New observations written: 2304 (of 2304 possible)
```

2,304 = 3 metrics x 32 teams x 24 seasons, exactly the expected count, zero gaps. A second run wrote
0 new observations (idempotent, collision guard proven not to trip).

**Publication stamps.** Each row is stamped at its own `source_date`: the book's own tracked date
for 2025-2026 (`draftkings`), and nfelosrs' `not_tracked` convention date (August 30 of that season)
for 2003-2024. Every stamp is validated to strictly precede that season's first kickoff.

**The week-1-only convention.** Vegas metrics are written once, at week 1, rather than replicated
across every week the team plays (unlike `coachObservations`). Every consumer of a preseason team
fact reads the whole `{ from: 1, to: LAST_POSSIBLE_WEEK }` range, which week 1 is always inside, so
replicating an unchanging value across 22 weeks would have bought nothing. This matched the brief's
expected row count exactly and was the flagged judgment call Task 3 confirmed its facts builder
respects.

**The four leakage audits** (`src/projections/vegas/stamp-visibility.test.ts`, written red before
`ingest.ts` was finalized):

- **(a) measurement-time read**: a historical season (2010) is fully visible at a far-future as-of.
- **(b) replay moment, 2021-2024**: the vegas row is visible at each season's own replay moment,
  for all four seasons.
- **(c) live 2026, ordinary gate, no carve-out**: a live 2026 board sees the vegas row through the
  same ordinary `teamObservations` read every other team source uses, with no special-casing;
  contrasted directly against the identical live board still throwing on a hypothetical
  game-derived row, proving vegas is not a hole in the live guard rather than assuming it.
- **(d) no CSV row**: a season the vegas ingest never touched reads `[]` and `null`, never a
  default.

The Task 2 ultracode review workflow (25 agents, 3 sequential lenses, adversarial verification) found
0 confirmed issues out of 11 raw findings and independently verified counts, values, stamps,
idempotency and null-reads clean end to end.

## 3. The harness re-run

Family size grew from **1,737 to 2,487 candidates** (testable family, the one Benjamini-Hochberg
corrects over, **1,249 to 1,800**). By template: threshold 111 -> 135, delta 222 -> 246, AND
1,404 -> 2,106.

**All four existing confirmed laws survived, byte-identical.** Every one of the ten previous BH
survivors kept its verdict, and every effect, CI, fold effect and pair count matched to the byte
under a testable family 44% larger, not merely staying in the file, but re-earning their place
under a stricter correction. The verdict-change table confirms not one pre-existing candidate's
verdict moved for any reason other than a new candidate entering the family:

| id | old verdict | new verdict | why |
| --- | --- | --- | --- |
| `and:WR:incomingTeamWinTotal:q70 + snapShare:q70` | not a BH survivor | **confirmed** | new-quantity candidate |
| `and:WR:incomingTeamWinTotal:q80 + snapShare:q70` | not a BH survivor | **confirmed** | new-quantity candidate |
| every other candidate in either file | unchanged | unchanged | family growth, not a moved verdict |

**The two confirmed laws, in full:**

```
and:WR:threshold:WR:incomingTeamWinTotal:q70+threshold:WR:snapShare:q70
  effect       +1.5166  ppg
  ci           [+0.8626, +2.1891]
  trainEffect  +1.2997
  sample       244 condition player-seasons
  folds        2021 +3.3704 (25 pairs)   2022 +2.3979 (28 pairs)   2023 +2.4080 (20 pairs)
  claim  A wide receiver whose share of his team's offensive snaps that season is 69.3% or more and
         whose team's Vegas win total for the season ahead is 9.0 or more gains points per game the
         following season.

and:WR:threshold:WR:incomingTeamWinTotal:q80+threshold:WR:snapShare:q70
  effect       +1.8172  ppg
  ci           [+1.1038, +2.5610]
  trainEffect  +1.5304
  sample       196 condition player-seasons
  folds        2021 +2.6920 (25 pairs)   2022 +3.1417 (24 pairs)   2023 +2.4080 (20 pairs)
  claim  Same shape, at a win total of 9.5 or more.
```

Both clear the bar the existing four do: full-window CI excluding zero, sign agreement in every
fold including 2023 (the fold outside the projection model's own fitting window), at least one
out-of-train fold above the pair floor, sample above `MIN_REPLICATION_PAIRS`. Both effects are
stronger out of train (fold effects +2.4 to +3.4 ppg) than the full-window figure, and the train
effect is the smaller number in both cases, the conservative direction for anything the board would
price off `trainEffect`.

**The delta null, stated with equal prominence.** `incomingTeamWinTotalDelta` (the win total minus
the team's actual season-N wins; negative means the market prices a collapse) produced **zero BH
survivors, at any position, level, or pairing.** No near-misses to report on either new quantity:
`incomingTeamWinTotal` produced exactly these two BH survivors and no others.

**The CANDIDATE_CAP ruling.** `CANDIDATE_CAP` rose from 2,000 to 3,000. The AND family grows
quadratically in the threshold-single count; at the old cap, `enforceCap`'s deterministic
ascending-id trim would have kept 2,000 AND candidates and silently deleted every threshold and
delta candidate in the family; the Task 3 review independently corrected an earlier ledger
estimate and established the precise fact: the old cap's trim would have deleted 2 of the 4
previously confirmed laws, not all 4. The ruling stands on that corrected basis. The cap is a
determinism-and-runtime bound on the generator, not the multiple-comparisons control; BH at q=0.10
over the testable family is that control, and it gets stricter as the family grows, never looser.
Raising the cap cannot make any candidate easier to confirm.

**`SCHEDULE_METRICS.gameResult`.** The store could not answer "how many games did this team win":
`team_week_observations` had never held a result or score anywhere. A new schedule metric
(`gameResult`: win 1, tie 0.5, loss 0, emitted only when both scores are present, stamped
game-derived) was added, backfilled via a dedicated script that writes result rows alone: 7,838
observations written (512 rows/256 wins across 2011-2020's 16-game seasons; 544 rows/272 wins for
17-game seasons; 542 rows/271 wins for 2022's BUF/CIN-short season; 0 rows for unplayed 2026). A
re-run writes 0. `seasonActualWinsByTeam` returns unknown rather than a partial total unless the
team's full game complement is visible, matching the CSV's own completeness rule.

**The `incomingAsOf` gate.** A win total publishes in August of the season it prices; every other
read in `discovery-facts.ts` was gated at `schedulePublishedAsOf(season + 1)`, the 20th of May.
Read on the May gate, both new quantities would have been null for every team in every season, and
the run would still have written a `discovered.json` with no error. The fix: an explicit
`incomingAsOf` parameter on `discoveryFactsForSeason`, threaded to every caller (`discover-laws.ts`
and `discovery-quantile-fit.ts` pass `preseasonMomentFor(season + 1)`; `loadPreseason` passes its own
`BoardMoment`). Every vegas stamp in the store was checked against every season's earliest
game-derived stamp; all 24 seasons fall between the two gates. The Task 3 ultracode review (17
agents) independently verified the gate honest across all four callers with no May/August
cross-wiring, and the audit is pinned as a behavioral test asserting the win total is invisible at
the May gate, visible at the preseason gate, and still refused when stamped after it.

**Null rates.** 97.8% resolved for the win total, 97.3% for the delta, both essentially the same
base rate as `incomingCoachTenureSeasons` (97.3%) and `teamPaceSecondsPerPlay` (95.0%) over the same
rows, driven by player-seasons with no team edge at all, not by any gate or convention failure. The
delta's extra 36 nulls are entirely the 2022 BUF/CIN cancellation, the same gap that leaves those two
rows blank in the source CSV.

## 4. The founder's Achane question, answered directly

**The Achane collapse direction was NOT directly testable this round.** The discovery generator has
exactly one threshold direction (`value >= threshold`); there is no low-side threshold template. The
only way the collapse hypothesis is reachable at all is as the mirror of a rise-side threshold, a
strongly negative effect on `incomingTeamWinTotalDelta >= 1.5`, and the complement of that
antecedent is "everything below +1.5," which lumps mild declines in with mild rises and cannot state
the collapse claim in plain words.

**What confirmed is the good-team direction.** Both new laws are positive AND-pairs of the win total
with WR snap share: a full-time receiver on a team the market expects to win nine or more games gains
points, not "a player on a team the market writes off collapses."

**The delta produced no survivor.** `incomingTeamWinTotalDelta` cleared zero BH survivors at any
position, level, or pairing this round.

A low-side threshold template is the right way to test the collapse shape directly, and building one
is a template-system change for a later round, not something this round's generator could answer as
a byproduct.

## 5. The v7 board

### The blend refit

`npm run projections:blend:fit` re-ran because the fit's own candidates now carry law reasons for
the two new laws.

```
BEST: lawCapPoints=2  availabilityCapPoints=20  totalCapPoints=40  (rho 0.6055 on train)
```

**The winning cell did not move** (lawCapPoints 2, availabilityCapPoints 20, totalCapPoints 40), and
not one fitted number changed a digit. Train rho 0.6054 -> 0.6055; the laws channel's share of the
train-time lift over pure market 4.6% -> 5.6%. The whole file diff is two comment lines.

### The bar verdict, v6 and v7 side by side

| | v6 | v7 |
| --- | --- | --- |
| 2024 blend rho (pooled) | 0.5293 | 0.5273 |
| **2024 blend vs ADP** | **+0.1021 [+0.0070, +0.2102] BEYOND NOISE** | **+0.1002 [+0.0041, +0.2089] BEYOND NOISE** |
| 2024 starter band | +0.2355 [+0.0421, +0.4377] WON BEYOND NOISE | +0.2345 [+0.0408, +0.4377] WON BEYOND NOISE |
| 2024 blend vs raw | +0.1161 [+0.0312, +0.1998] BEYOND NOISE | +0.1142 [+0.0289, +0.1969] BEYOND NOISE |
| 2024 blend vs ECR | +0.0312 [-0.0463, +0.1169] within noise | +0.0293 [-0.0503, +0.1160] within noise |
| 2023 blend rho (pooled) | 0.5318 | 0.5304 |
| 2023 blend vs ADP (in-fit) | +0.0566 [-0.0526, +0.1680] within noise | +0.0553 [-0.0551, +0.1676] within noise |

**THE BAR HOLDS.** The decisive 2024 pooled blend-vs-ADP gap is still BEYOND NOISE with its interval
excluding zero, and the starter band is still WON BEYOND NOISE. No line anywhere in either 404-line
scorecard run (`scorecard-v7.txt`) reads "lost beyond noise."

**The one flipped verdict, stated plainly.** Diffing all 404 lines with every number masked, exactly
one classification differs anywhere:

```
2024, WR only, blend vs naive, ELITE band (n=50)
  v6:  +0.2363 [+0.0042, +0.5048]  WON BEYOND NOISE
  v7:  +0.2226 [-0.0099, +0.4892]  within noise
```

The interval was already hugging zero (lower bound +0.0042) and slipped 0.0141 under it. Every other
classification, both seasons, every arm, every band, every position section, is identical.

### The nested-law property and per-law cap semantics

Both new laws are on the same quantity at different thresholds (`incomingTeamWinTotal:q70` and
`:q80`), and every team clearing q80 clears q70 by construction, so they are **nested**, not
independent. 103 of the 117 movers carry both chips.

`lawCapPoints` (2 points) caps **each law's own** exposure-scaled delta separately:
`clampAbs` applies inside the per-reason loop in `blend.ts`. It does not cap the pair's combined
movement, which only `totalCapPoints` (40) bounds. The combined movement on a double-qualifying
receiver is the sum of the two nested laws' train effects (1.2997 + 1.5304 = 2.8301 points before
exposure scaling) for what is structurally one underlying signal, not two independent ones. This is
the corrected framing: an earlier ledger description of the cap ("bounds exactly this risk") was
wrong about what the 2-point cap actually bounds, confirmed MEDIUM by the Task 4 ultracode review;
the correction changed the documented record (`task-4-report.md` section 6(b3) and the published
addendum both carry the corrected paragraph) but required no code change, because the refit and the
held-out scorecard both measured this exact configuration as shipped. The nested-law dedup / a
fitted per-player law-channel cap is queued for the next fit round, beside the rookie-cap question.

### The top 50 (v7, full)

```
commish_board_v7_ppr_12  season 2026  top 50 of 759
rank ptsRank   name                     pos  team       points  adp       laws
  1. pts#2     Jeremiyah Love           RB   ARI     330.8 pts  adp 27.4
  2. pts#1     Puka Nacua               WR   LA      331.0 pts  adp 2.9
  3. pts#3     Ja'Marr Chase            WR   CIN     311.3 pts  adp 3.9     winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
  4. pts#5     Jaxon Smith-Njigba       WR   SEA     292.3 pts  adp 5.5     winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
  5. pts#19    Bijan Robinson           RB   ATL     247.1 pts  adp 2.3
  6. pts#20    Jahmyr Gibbs             RB   DET     247.1 pts  adp 1.5
  7. pts#6     Amon-Ra St. Brown        WR   DET     275.9 pts  adp 6.4     winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
  8. pts#22    Jonathan Taylor          RB   IND     243.5 pts  adp 7.4     td_regression
  9. pts#7     CeeDee Lamb              WR   DAL     273.6 pts  adp 10.3    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
 10. pts#29    James Cook               RB   BUF     233.2 pts  adp 12.1
 11. pts#30    De'Von Achane            RB   MIA     233.2 pts  adp 10.2
 12. pts#32    Derrick Henry            RB   BAL     231.4 pts  adp 16.5    rb_age_curve, td_regression
 13. pts#12    Justin Jefferson         WR   MIN     262.3 pts  adp 11.7
 14. pts#13    Drake London             WR   ATL     260.5 pts  adp 12.3
 15. pts#14    George Pickens           WR   DAL     257.6 pts  adp 19.9    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
 16. pts#39    Christian McCaffrey      RB   SF      224.9 pts  adp 6.5     rb_age_curve
 17. pts#15    A.J. Brown               WR   NE      253.3 pts  adp 17.1    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70, threshold:WR:age:q70
 18. pts#44    Trey McBride             TE   ARI     213.6 pts  adp 29.0
 19. pts#45    Brock Bowers             TE   LV      213.6 pts  adp 34.8
 20. pts#16    Chris Olave              WR   NO      250.8 pts  adp 19.0
 21. pts#43    Ashton Jeanty            RB   LV      214.4 pts  adp 21.4
 22. pts#48    Kenneth Walker III       RB   KC      212.6 pts  adp 21.3
 23. pts#4     Josh Allen               QB   BUF     298.6 pts  adp 33.7
 24. pts#26    Zay Flowers              WR   BAL     237.2 pts  adp 25.7    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
 25. pts#53    Saquon Barkley           RB   PHI     205.0 pts  adp 18.8    rb_age_curve
 26. pts#27    DeVonta Smith            WR   PHI     233.7 pts  adp 29.5    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
 27. pts#31    Nico Collins             WR   HOU     232.0 pts  adp 21.1    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
 28. pts#38    Tetairoa McMillan        WR   CAR     227.8 pts  adp 31.3
 29. pts#40    Rashee Rice              WR   KC      221.6 pts  adp 16.1    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70, threshold:WR:touchdownPointsShare:q80
 30. pts#41    Ladd McConkey            WR   LAC     219.6 pts  adp 37.9    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
 31. pts#42    Emeka Egbuka             WR   TB      218.7 pts  adp 35.3
 32. pts#62    Travis Etienne           RB   NO      182.9 pts  adp 37.8
 33. pts#63    Kyren Williams           RB   LA      182.9 pts  adp 31.8
 34. pts#64    Breece Hall              RB   NYJ     182.9 pts  adp 33.2
 35. pts#46    Jameson Williams         WR   DET     213.6 pts  adp 45.2    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70
 36. pts#65    Javonte Williams         RB   DAL     182.2 pts  adp 36.8    td_regression
 37. pts#47    Garrett Wilson           WR   NYJ     212.8 pts  adp 26.7    threshold:WR:touchdownPointsShare:q80
 38. pts#49    Jaylen Waddle            WR   DEN     211.1 pts  adp 44.7
 39. pts#50    DJ Moore                 WR   BUF     210.8 pts  adp 47.7    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70, td_regression, threshold:WR:age:q70, threshold:WR:touchdownPointsShare:q80
 40. pts#8     Lamar Jackson            QB   BAL     270.0 pts  adp 57.0
 41. pts#68    Omarion Hampton          RB   LAC     178.5 pts  adp 22.5
 42. pts#51    Tee Higgins              WR   CIN     207.7 pts  adp 36.2    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70, td_regression, threshold:WR:touchdownPointsShare:q80
 43. pts#52    Carnell Tate             WR   TEN     206.5 pts  adp 79.8
 44. pts#9     Dak Prescott             QB   DAL     263.5 pts  adp 65.1
 45. pts#10    Joe Burrow               QB   CIN     263.5 pts  adp 56.3
 46. pts#11    Drake Maye               QB   NE      263.5 pts  adp 52.0
 47. pts#89    Colston Loveland         TE   CHI     162.5 pts  adp 55.5
 48. pts#90    Tyler Warren             TE   IND     162.5 pts  adp 65.4
 49. pts#55    Davante Adams            WR   LA      200.6 pts  adp 41.9    winTotal:q70+snapShare:q70, winTotal:q80+snapShare:q70, td_regression, threshold:WR:age:q70, threshold:WR:touchdownPointsShare:q80
 50. pts#86    Josh Jacobs              RB   GB      165.3 pts  adp 32.0    td_regression
```

The two new law ids are abbreviated above for width (`winTotal:qNN+snapShare:q70` stands for
`and:WR:threshold:WR:incomingTeamWinTotal:qNN+threshold:WR:snapShare:q70`). Against the v6 top 50
(`docs/research/2026-09-01-live-board-closeout.md`, section 4): the same 50 names, no entries, no
exits. Fifteen carry the new chips, each gaining 1.8 to 2.7 points (Chase +2.6, Smith-Njigba +2.6,
St. Brown +2.7, Lamb +2.5, Pickens +2.6, A.J. Brown +2.3, Flowers +2.7, DeVonta Smith +2.5, Collins
+2.4, Rice +1.8, McConkey +2.5, Jameson Williams +2.5, DJ Moore +2.6, Higgins +2.4, Adams +2.3). The
largest rank move is three places (Jameson Williams 38 -> 35).

### The replay proof, summarized

Read-only SQL against the live store, across all five re-persisted seasons (2021, 2022, 2023, 2024,
2026):

```
 season | rows | points_moved | value_rank_moved | max_abs_point_delta
   2021 |  661 |           26 |              429 |              2.6900
   2022 |  694 |           26 |               38 |              2.6000
   2023 |  654 |           27 |               48 |              2.6400
   2024 |  653 |           16 |              310 |              2.6700
   2026 |  759 |           22 |               39 |              2.6700
```

**117 rows moved on points across the five seasons, all wide receivers, all gaining one of the two
new chips.** Zero non-WR rows moved on points. Zero rows moved on points without a chip change.
Twenty-three receivers gained a chip without moving on points, all `market_unlisted`, whose price
comes from a fallback path that reads no law reasons at all, correct behavior rather than a leak. The
chip audit found 263 new chips, all on wide receivers, none below its own fitted threshold (q70's
floor 9.0, q80's floor 9.5), and none on a player whose team's line could not be resolved.

## 6. The ship-as-measured ruling

**Confirmed laws ship as measured, even though the held-out point estimate ticked down within
noise.** The pooled blend-vs-law-ablated figure moved -0.0021 -> -0.0041 on 2024 (both within
noise); the 2024 WR-only arm is where the direction concentrates: blend rho 0.4811 -> 0.4729, and
`blend vs law-ablated` went from +0.0049 to -0.0033. `law-ablated vs ADP` is unchanged to the digit
(+0.1043 [+0.0040, +0.2140] both arms), the control confirming that ablating the laws removes only
the new chips.

The ruling: reversing integration on a within-noise held-out wiggle would be selecting on the
held-out set, destroying its held-out-ness. The fitted 2-point-per-law cap bounds each law's own
exposure, and the flipped verdict (section 5 above) is stated prominently rather than buried. This
is not a contradiction of the laws' own confirming evidence (fold effects +2.4 to +3.4 ppg, sign
agreement in every fold including 2023, the one fold outside the model's fitting window). It is the
same lesson the channel decomposition already recorded: the board's held-out rank correlation is
dominated by the market anchor and the availability channel, and the whole law channel moves it by a
few thousandths of rho in either direction on 176 rows. The laws are confirmed on measured
points-per-game evidence; the scorecard measures something they barely touch. 2026 adjudicates for
real. A per-law held-out validation gate on board pricing is deferred (section 8) because it would
need a fresh held-out season, not 2024 re-use: using 2024 again to gate a decision already measured
against 2024 would be the same held-out-set violation the ship-as-measured ruling declined to commit.

## 7. The props archive

**What was captured.** `player_prop_observations`, a genuinely append-only store (no unique
constraint, no upsert, no update or delete: a repeated snapshot always inserts new rows). One real
week-1 snapshot: **967 observations, 16 events, 4 markets (player_pass_yds, player_reception_yds,
player_receptions, player_rush_yds), 6 bookmakers (draftkings, fanduel, fanatics, betonlineag,
betrivers, bovada), 72 credits spent** (19,991 remaining before the task's real calls, 19,919 after).
81 single-sided lines (one book's systematic one-sided receptions listings) were skipped and named
rather than thrown on or silently dropped.

**What it is NOT.** No name resolution to `nfl_players`. No consumption by any model, board, or law
this round; the store exists and nothing reads it yet.

**The designed next round.** A 2023-2025 historical backfill (roughly 3,000 credits per
season-snapshot pass, fitting inside the 20,000-credit/month budget with care), props-as-anchor
measurement on a held-out 2024, and name resolution to connect the raw outcome `player_name` strings
to `nfl_players`.

## 8. Deferrals, complete

1. **Low-side threshold templates.** No candidate can express "a large negative win-total delta":
   the generator has one threshold direction (`value >= threshold`) and adding a mirrored low-side
   template would double the threshold family and quadruple the AND family for all thirteen
   quantities. This is the fix that would make the Achane collapse direction directly testable
   (section 4).

2. **Nested-law dedup / a fitted per-player law-channel cap.** The two new laws are nested
   (q80 implies q70 by construction); `lawCapPoints` caps each law separately, not the pair's sum.
   Queued for the next fit round beside the rookie-cap question.

3. **Per-law held-out validation as a board-pricing gate needs a fresh held-out season.** 2024
   cannot be re-used to gate a decision already measured against 2024 (section 6).

4. **The before-kickoff stamp property is data-validated, not gate-enforced.** Every vegas stamp in
   the store is verified to precede kickoff by the validator script; there is no runtime gate that
   would refuse an offending row if one existed. No offending data exists today.

5. **The `schedule:results` run-order dependency is documented in the script's own README, not at
   the discovery entry point.** Anyone reproducing the discovery run from a fresh checkout needs
   `npm run projections:schedule:results` first, or `incomingTeamWinTotalDelta` reads null
   everywhere and the family's verdicts differ; nothing at `discover-laws.ts`'s own entry point says
   so today.

6. **No fetch timeout on the props snapshot script.** Parked as immaterial for an operator-run
   script, not fixed this round.

7. **Implied offense totals from game lines.** Not built this round; the win-totals dataset covers
   season-level market expectation, not week-level implied totals from spread/total lines.

8. **The Odds API historical props backfill round.** 2023-2025 season-snapshot passes at roughly
   3,000 credits each, designed but not executed (section 7).

## 9. Ultracode note

This round's reviews ran as multi-agent workflows, per the mid-round founder directive. Per-task
agent counts and confirmed/refuted tallies, all recorded in `progress.md`:

- Task 2: 25 agents, 3 sequential lenses (leakage/stamps, data fidelity, spec/quality) with 2
  adversarial verifiers per finding, 11 raw findings, 0 confirmed.
- Task 3: 17 agents (incomingAsOf leakage, statistics/BH/cap, the gameResult store change), 7 raw
  findings, 0 confirmed.
- Task 4: 9 agents (pricing/gating + replay proof, scorecard honesty + reproduction fidelity + the
  flipped verdict, addendum accuracy), 3 raw findings, **1 confirmed MEDIUM**, 2 refuted.
- Task 6: 10 agents (archive correctness/fidelity, API + secret hygiene), 4 raw findings, 0
  confirmed.

**One confirmed finding changed the documented record.** The Task 4 confirmed MEDIUM: `lawCapPoints`
caps each law's own delta, not the nested pair's combined movement (section 5's cap-semantics
paragraph is the corrected version). Not a code defect: the code matched its documented semantics,
and the refit and scorecard both measured exactly this configuration, but the ledger's own earlier
description of what the cap bounds was wrong, and the report and addendum were corrected in place.

## 10. The live-board close-out is superseded

A one-line pointer was added to `docs/research/2026-09-01-live-board-closeout.md` noting the v6
board recorded there is superseded by v7 as of this round, pointing here for the current top 50 and
board story. That document's own content (the 2025 sanity report, the live-moment audit inventory,
the position-gate fix) is untouched and remains the record of what that round shipped.

## Verification

```
$ npx tsc --noEmit
```

43 errors, the documented baseline, matching every task this round's own tsc run, 0 in any file
this task touched (this task touched no source file, only this document and the live-board
close-out's superseded-by pointer).
