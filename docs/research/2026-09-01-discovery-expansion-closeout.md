# Discovery expansion close-out: ten more seasons, a wider grammar, and the artifact review that cut 41 confirmations to 22

**Measured 2026-09-01.** Plan: `docs/superpowers/plans/2026-09-01-discovery-expansion.md`. Spec:
`docs/superpowers/specs/2026-09-01-discovery-expansion-design.md`. Ledger:
`.superpowers/sdd/2026-09-01-discovery-expansion/progress.md`.

Every figure below is copied verbatim from the round's task reports (`task-1-report.md` through
`task-3-report.md`, including its section 8 fix-round addendum and the corrected sections 5 and 7),
`task-3-rereview.md`, and `progress.md`. Nothing here was recalled from memory or re-derived by
re-running a measurement, a discovery pass, or a fit. This is Task 4, the round's last task. Its job
is to record what the round did, not to re-judge it.

## 1. The history extension: 2003-2012 joins the store

### The per-season audit and the ingest

Every asset was HEADed against the live nflverse release, with the two ambiguous ones re-checked by
a real GET, which is what caught the one surprise in the range.

| season | `stats_player_week` | `snap_counts` | `play_by_play` | source decision | stat lines landed | new observations | weekly-stats resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2003 | 200 | 404 | 200 | PUBLISHED | 5,059 | 70,826 | 100.0% |
| 2004 | 200 | 404 | 200 | PUBLISHED | 5,003 | 70,042 | 100.0% |
| 2005 | 200 | 404 | 200 | PUBLISHED | 5,027 | 70,378 | 100.0% |
| 2006 | 200 | 404 | 200 | PUBLISHED | 4,966 | 69,524 | 100.0% |
| 2007 | 200 | 404 | 200 | PUBLISHED | 5,059 | 70,826 | 100.0% |
| 2008 | 200 | 404 | 200 | PUBLISHED | 4,949 | 69,286 | 100.0% |
| 2009 | 200 | 404 | 200 | PUBLISHED | 5,219 | 73,066 | 100.0% |
| 2010 | 200 | 404 | 200 | PUBLISHED | 5,221 | 73,094 | 100.0% |
| 2011 | 200 | 404 | 200 | PUBLISHED | 5,316 | 74,424 | 100.0% |
| 2012 | 200 | 200 but EMPTY (154 bytes, header only, 0 data rows) | 200 | PUBLISHED | 5,289 | 74,046 | 100.0% |
| **total** | | | | | **51,108** | **715,512** | |

No derived seasons and no gap seasons in the range: `STAT_LINE_GAPS` stays `[2019, 2025]`. All ten
seasons are the published feed, resolution is 100.0% on the weekly stats for every one of them, and
the backfill is idempotent (a re-run wrote 0 new observations across all ten seasons).

**The snap-count asset floor discovery.** A HEAD request cannot see a file that returns 200 with zero
data rows, which is exactly what `snap_counts_2012.csv` does: 154 bytes, header only. The corrected
pass drew a new asset bound, `SNAP_COUNT_ASSET_FLOOR = 2013`, measured by ROWS rather than existence,
and dated the affected weeks from the schedule instead. 2011 and older are a clean 404; only 2012 is
the trap a HEAD would have missed.

Schedules for 2003-2010 were also ingested through the shipped `ingestSchedule`: **38,960 new
team-week observations**, every one carrying the `nflverse_kickoff` source and `kickoff_instant`.

### The method control, run inside the range

Two seasons were checked read-only against `computeDerivedStatLines`, never the writer, to confirm
the published rows agree with what the derivation would have produced:

| control season | rank correlation (bar 0.99) | MAE pts/player |
| --- | --- | --- |
| 2012 | **0.9999** across 313 players with >= 8 games | **0.28** |
| 2005 | **0.9999** across 272 players with >= 8 games | **0.32** |

2012 reproduces the 2018 control's own figures to the digit (0.9999 / 0.28). Nothing derived was
written for either season.

**The review's independent spot check.** The Task 1 lean review reproduced the round's claims itself
rather than trusting the report: 51,108 counts exact, **10/10 published-CSV spot checks across the
decade**, method controls re-run digit for digit, floors untouched, all five drift checks re-run exit
0, 1,349 tests green, tsc at the 43-error baseline.

### What did not move

`laws:discover -- --check` and `laws:measure -- --check` both stayed clean after this task. The
mechanism: `discoveryFactsForSeason` reads season N-1, so a 2012 row can only reach the 2013+ window
through the delta family's `prior` field, and every 2013 delta candidate that gained a 2012 pair was
already under the 20-train-pair floor and stayed there. `MEASURE_SEASONS.from` was a floor this task
deliberately did not move. No verdict changed, because no matched pair changed, because the window
had not moved yet. That extension is section 2.

## 2. The window extension to 2003 and the tribal re-measure

Task 3 moved `MEASURE_SEASONS.from` from 2013 to 2003 inside its own regeneration event, per the
controller's ruling (R1). `DISCOVERY_TRAIN_SEASONS.from` is defined as `MEASURE_SEASONS.from` and
moved with it. The top of the window, the train cutoff (2021) and the replication folds (2021, 2022,
2023) were untouched.

`npm run laws:measure` was re-run in write mode, then checked clean. **`td_regression` is the only law
that moved:**

| | n | effect | 95% CI | train effect | verdict |
| --- | --- | --- | --- | --- | --- |
| before (2013-2024 window) | 763 | -0.824 | [-1.172, -0.459] | -0.841 | confirmed |
| after (2003-2024 window) | **1,480** | **-0.683** | **[-0.939, -0.398]** | -0.675 | **confirmed** |

n rose 94%, the effect shrank 17%, the CI narrowed by about a quarter (width 0.713 to 0.541), and the
verdict held. Two decades of touchdown-luck regression pull slightly less hard than the last one did,
measured on twice the pairs.

**The other five tribal laws are byte-identical**, old to new: `play_caller_fingerprint` (-0.049,
debunked), `rb_age_curve` (-1.250, confirmed), `rb_workload_cliff` (-1.108, weak),
`target_share_persistence` (0.883, confirmed), `wr_target_competition` (-0.934, confirmed). **Zero
verdict changes anywhere among the six.** Each of the five was blocked by a specific missing input,
named per law in Task 1's read-only probe and confirmed exactly by the real re-measure: participation
(workload cliff, target share persistence, and the team edge target competition needs), preseason
birth dates (age curve, floored at 2013 regardless of the window), and coach history (play caller
fingerprint). All five matched exactly zero new pairs; every one of the 717 new matched pairs sits in
predictor seasons 2003-2012, on `td_regression` alone.

## 3. The grammar: low band, production conditional, wider vocabulary

### The low band

`QUANTILE_LEVELS` widened from three high levels to six: `[0.1, 0.2, 0.3, 0.7, 0.8, 0.9]`. The side of
a threshold is derived from the level, never stored: `sideOf(level)` is the whole mechanism, so no
clause shape changed and no existing candidate id moved. The three high levels are byte-identical to
what they were.

Both grammar directions are supported: a threshold reads `value >= T` on the high band and
`value <= T` on the low band; a `rose_into`/`fell_out_of` delta reads as entering or leaving whichever
band it names. The founder's collapse hypothesis became sayable on both team-market quantities as a
result, and is pinned by test at all three low levels.

### The production conditional, and the match-key reasoning that trimmed it

`pointsPerGame` was added as a condition quantity, per the brief. Task 2's review found the hazard was
not the season offset (the matched design already handles that for every quantity); it was the match
key itself, and it is an identity rather than a risk:

- `discovery/measure.ts`'s `populationForCandidate` sets `matchKey: row.pointsPerGame`.
- `harness.ts` pairs each condition row with the closest unclaimed control whose `matchKey` is within
  the 2.0-point caliper.
- The new `pointsPerGame` quantity reads the identical number the match key already reads: same gate,
  same rules, same `admitDerived`.

For a threshold candidate `pointsPerGame >= T`, every condition row's match key is therefore greater
than every control row's, in one direction, for every pair the matcher can build, before the
candidate's condition has said anything. The differenced outcome mean-reverts in `pointsPerGame`, so
a systematically higher-scoring condition arm carries a systematically more negative difference than
its controls purely from the matcher's own construction. A second, independent defect: the caliper
drops any condition row with no control within two points, which for a level condition on the match
key leaves only a thin sliver either side of `T`.

The guard: `QuantityDef.isMatchKeyQuantity`, true for `pointsPerGame` only, read by the generator
exactly the way `supportsYearOverYearDelta` is. No threshold candidate over it, no AND candidate
containing it on either half. Delta candidates are generated normally on both bands, because a
crossing condition (`was in the band last season, is out of it this season`) provably has controls on
both sides of `T`, so the one-sided inequality above does not hold. Four confirmed `pointsPerGame`
laws exist in the final family and every one of them is a delta.

### The vocabulary, five additions, coverage measured over the window

| quantity | coverage | resolved rows | worst season |
| --- | --- | --- | --- |
| `gamesPlayed` | 100.0% | 6,282 | 100.0% (every season) |
| `pointsPerGame` | 100.0% | 6,282 | 100.0% (every season) |
| `insideTenTouchShare` | 94.3% | 5,454 | 93.4% (2013/2014) |
| `teamAirYardsShare` | 94.3% | 5,454 | 93.4% (2013/2014) |
| `draftPick` | 65.3% | 6,282 | 60.7% (2018) |

For scale, the weakest quantity already in the family is `incomingCoachPriorPassRateOverExpected` at
46.7%; every addition clears that, and the weakest addition, `draftPick`, still beats it by a wide
margin.

### The trim: AND stays high-side only

The raw design explodes if the AND family is allowed onto the low band:

| AND policy | level combinations | AND candidates | family total |
| --- | --- | --- | --- |
| **high x high (implemented)** | 9 | 3,735 | 4,749 |
| same-side (high x high + low x low) | 18 | 7,470 | 8,484 |
| fully mixed (any level x any level) | 36 | 14,940 | 15,954 |

The mixed policy is a 3.4x family and a 3.4x tighter Benjamini-Hochberg threshold for a shape the plan
never asked for. `pointsPerGame` is delta-only, structurally, for the reason above.

### Ratified projection versus what actually landed

Task 2's read-only preview, on the window as it stood before Task 3 moved it:

| | candidates | testable | BH survivors | confirmed |
| --- | --- | --- | --- | --- |
| ratified projection (unmoved window) | 4,525 | 3,328 (1.85x today's 1,800) | 45 | 26 |

Task 3's real regeneration, first on the extended window with the widened grammar, then after the fix
round that section 4 covers:

| | candidates | testable | BH survivors | confirmed |
| --- | --- | --- | --- | --- |
| real regeneration, pre-fix | 4,509 | 3,306 | 67 | 41 |
| **final, post structural fix** | **4,045** | **2,913** | **41** | **22** |

The preview was honest about being a preview: 4,525/3,328 projected against 4,509/3,306 actually
measured is accurate to within 0.4%, with the small gap explained entirely by the window move working
through the quantile refit (different thresholds create and destroy a few degenerate-level ties that
the per-band dedupe then drops or keeps).

## 4. The artifact story: how 41 became 22, and why 22 is the number to trust

This is the centerpiece of the round, and it is told straight because the round's real deliverable is
not the confirmed-law count, it is the adversarial process that caught what the first regeneration
missed.

### The initial regeneration confirmed 41

Task 3's real regeneration (commit `187e0eb`), on the 2003-extended window and the widened grammar,
took the family from 2,487 candidates / 12 BH survivors / 6 confirmed to **4,509 candidates / 67 BH
survivors / 41 confirmed**. All six prior tribal-family laws and all six prior discovered laws
survived. 35 new confirmations appeared. This was the number the report shipped first, and it was
wrong in a specific, discoverable way.

### The ultracode review proved 12 of those confirmations were a match-key reliability artifact

A 24-agent ultracode review ran the statistics and leakage lenses against the regeneration, adversarially: 3 of 11 raw findings confirmed after independent verification (2 verifier seats were
lost to API safeguard false positives on unrelated findings, parked separately). The headline finding
was rated **CONFIRMED HIGH**: the 12 `gamesPlayed`-conditioned confirmations (7 thresholds, 5
conjunctions) were indistinguishable from a match-key reliability artifact, not a durability effect.

**The mechanism.** The matched design's match key is `pointsPerGame`, i.e. season points divided by
`gamesPlayed`. `gamesPlayed` is therefore the match key's own denominator, its reliability. The
2.0-point caliper equalizes the two arms' *observed* points per game; it cannot equalize their
*precision*, because precision is a function of the denominator, and the denominator is exactly what
a `gamesPlayed` level condition sorts pairs by. Two players sitting at 9.0 points per game, one over 3
games and one over 15, are not two draws that happen to agree, they are one precise and one imprecise
observation that agree by selection, and the imprecise one regresses harder toward the mean next
season. **Equal observed points per game is the artifact's precondition, not its cure**, so tightening
the caliper would have strengthened the artifact rather than weakened it. Unanimous fold agreement did
not rescue the confirmations either: an estimator-driven artifact is exactly as stable across seasons
as a real effect is, so fold replication is evidence against a fluke but no evidence at all against a
mechanism.

**The pair-level evidence.** The review's probe settled the question empirically rather than
theoretically: the effect concentrates at large `gamesPlayed` gaps between the matched arms, flips
sign at small gaps, and scales with distance above the mean. That is a reliability signature, not a
durability one. A real effect would not flip sign as the two arms converge on the same denominator; an
artifact built from unequal precision would, and does.

A second, related finding was rated **CONFIRMED MEDIUM**: the original report's claim that the
2003-2026 Vegas win-total rows arrived on a separate branch, and that the collapse-direction question
should wait on their merge, was factually wrong. Those rows (`fedf19e`) were already ancestors of this
branch, landed roughly six hours before Task 3's runs began. The report's stated evidential basis for
the zero-new-evidence result was nonetheless honest; the real cause, named in section 5 below, is one
layer further down. A third finding was rated **CONFIRMED NOTE**: the real decade blocker for the
collapse question is `player_week_teams`, not the win totals, also covered in section 5.

### The structural fix

`gamesPlayed` became delta-only, structurally, on the exact precedent `pointsPerGame` had already set.
A new flag, `isMatchKeyReliabilityQuantity`, was added rather than reusing `isMatchKeyQuantity`,
because the two defects are different: one quantity *is* the match key, the other is the match key's
*denominator*, and a reader deserves to know which applies. The generator now reads a single predicate,
`emitsLevelConditions(def)` (the conjunction of both negations), so it never branches on a candidate's
id. The 12 confirmed and 4 weak `gamesPlayed`-conditioned entries were withdrawn by regenerating, not
by hand-editing: `registry.ts`'s orphan guard throws if `discovered.json` holds an entry the generator
can no longer produce, so the exclusion and the regeneration landed in one commit (`6603c2a`) by
necessity.

### The Benjamini-Hochberg cut tightened, and ten more entries fell with it

Removing the 464 artifact-adjacent candidates from the family had two opposing effects on the
Benjamini-Hochberg cut: it loosened the denominator `m` (4,509 to 4,045 candidates, 3,306 to 2,913
testable), but it also removed a block of very small p-values, which tightens the rank `k` every
remaining candidate must clear. The second effect dominated:

```
realised BH cut (largest surviving p-value): 1.972e-3 -> 1.344e-3   (a 32% tightening)
```

**Ten further entries, none of them `gamesPlayed`-conditioned, fell out as a direct consequence.**
Each had a train p-value strictly inside the vacated band (1.344e-3, 1.972e-3], independently
recomputed and confirmed in the scoped re-review. These are the ten collateral withdrawals, named:

| id | prior verdict | prior effect | prior n | train p-value |
| --- | --- | --- | --- | --- |
| `and:WR:incomingTeamWinTotal:q70+targetShare:q80` | confirmed | 1.574 | 150 | 1.9616e-3 |
| `and:WR:snapShare:q70+teamAirYardsShare:q80` | confirmed | 1.319 | 280 | 1.8390e-3 |
| `and:WR:targetShare:q80+touchdownPointsShare:q80` | confirmed | -1.980 | 65 | 1.9203e-3 |
| `delta:WR:pointsPerGame:q70:rose_into` | confirmed | -1.181 | 251 | 1.4827e-3 |
| `threshold:RB:touches:q70` | confirmed | 1.662 | 186 | 1.9366e-3 |
| `threshold:WR:experienceYear:q10` | confirmed | 0.947 | 311 | 1.4566e-3 |
| `threshold:WR:touchdownPointsShare:q90` | confirmed | -1.092 | 313 | 1.9635e-3 |
| `and:WR:age:q70+incomingCoachTenureSeasons:q70` | weak | -1.326 | 285 | 1.9420e-3 |
| `delta:RB:pointsPerGame:q70:fell_out_of` | weak | 1.072 | 190 | 1.9037e-3 |
| `threshold:RB:draftPick:q70` | weak | -1.107 | 205 | 1.8987e-3 |

Note the first entry in this table: `and:WR:incomingTeamWinTotal:q70+targetShare:q80` was, briefly, a
third confirmed sibling to the two win-total laws (the pre-fix report described it that way). It did
not survive the honest cut, so the win-total family stands at two confirmed laws in the final
inventory, not three.

None of the 26 withdrawn entries (16 artifact-conditioned plus these 10 collateral) is retracted as
wrong. Each is a candidate whose evidence no longer clears the family's own multiple-comparisons bar
once that bar is computed without the artifact holding it open, which is the conservative direction
and the one to prefer. This is Benjamini-Hochberg's step-up geometry working correctly, not a defect,
per the controller's ruling.

### Verified independently, not just claimed

A scoped re-review of commit `6603c2a` reproduced every one of these claims against the committed
tree rather than trusting the report: the structural exclusion confirmed against the diff; the
withdrawn-26 computed as an exact set difference between the pre-fix and post-fix `discovered.json`
files and matched id-for-id against the report's own lists; all 41 surviving entries verified
byte-identical by full per-key JSON comparison, not a sample; the BH cut of 1.344e-3 independently
recomputed from the live database against all 4,045 committed candidates and matched to four
significant figures; all ten collateral p-values independently read and confirmed inside the vacated
band; both `--check` gates, the full test suite (1,417 tests), tsc (43, baseline) and the em-dash scan
all re-run clean. The verdict: **ALL ADDRESSED, no findings.**

### The final honest counts

```
candidates:  4,045
testable:    2,913
BH survivors:   41
  confirmed:    22
  weak:         19
```

**Adversarial verification is why 22 is trustworthy where 41 was not.** The first regeneration was
internally consistent, passed every mechanical gate, and was still wrong in a way no gate could have
caught: a family-wide statistical bias baked into the match key's own denominator, invisible to a
count, a drift check, or a fold-replication pass, because the bias was as stable across folds as a
real finding would have been. It took an adversarial review built to distrust the result, not merely
audit its arithmetic, to find the mechanism, demand the pair-level evidence, and force a structural
fix rather than a patch. The 19 entries beyond the artifact and its ten collateral casualties that
still did not clear the honest cut are proof the fix was not cosmetic: removing the artifact changed
what survives, not merely how many candidates are silently miscounted.

## 5. The final confirmed inventory

### The six original tribal laws

| law | claim shape | effect | 95% CI | n | verdict |
| --- | --- | --- | --- | --- | --- |
| `play_caller_fingerprint` | | -0.049 | [-0.606, 0.495] | 238 | debunked |
| `rb_age_curve` | an old running back declines | -1.250 | [-2.145, -0.394] | 171 | confirmed |
| `rb_workload_cliff` | | -1.108 | [-3.169, 0.958] | 43 | weak |
| `target_share_persistence` | | 0.883 | [0.012, 1.780] | 129 | confirmed |
| `td_regression` (updated on the 2003 window) | touchdown share regresses to the mean | **-0.683** | **[-0.939, -0.398]** | **1,480** | confirmed |
| `wr_target_competition` | | -0.934 | [-1.679, -0.246] | 251 | confirmed |

### The six prior discovered laws, all six survive

| id | effect | 95% CI | n | verdict |
| --- | --- | --- | --- | --- |
| `threshold:WR:age:q70` (an old receiver loses) | -1.139 | [-1.545, -0.692] | 483 | confirmed, byte-identical |
| `threshold:WR:touchdownPointsShare:q80` (a touchdown-heavy receiver regresses) | -0.851 | [-1.254, -0.460] | 646 | confirmed, moved (was -1.285, n=344) |
| `and:WR:incomingCoachTenureSeasons:q70+touchdownPointsShare:q70` | -1.058 | [-1.569, -0.590] | 342 | confirmed, moved (was -1.063, n=331) |
| `and:WR:incomingCoachTenureSeasons:q70+touchdownPointsShare:q80` | -1.719 | [-2.346, -1.099] | 224 | confirmed, moved (was -1.733, n=219) |
| `and:WR:incomingTeamWinTotal:q70+snapShare:q70` (win-total law 1) | 1.517 | [0.863, 2.189] | 244 | confirmed, byte-identical |
| `and:WR:incomingTeamWinTotal:q80+snapShare:q70` (win-total law 2) | 1.817 | [1.104, 2.561] | 196 | confirmed, byte-identical |

### The 16 new confirmations that survived the fix, by family

Every entry below is a survivor of both the window/grammar regeneration and the artifact fix; effect,
95% CI, n, all verbatim from `discovered.json`.

**Low-side age (the round's clearest new finding: the high-side law says an old receiver loses, the
low side now says a young one gains, at three nested levels, on two positions).**

| id | effect | 95% CI | n |
| --- | --- | --- | --- |
| `threshold:RB:age:q10` | 1.880 | [0.751, 2.987] | 126 |
| `threshold:RB:age:q20` | 1.397 | [0.612, 2.120] | 231 |
| `threshold:RB:age:q30` | 1.412 | [0.781, 2.056] | 351 |
| `threshold:WR:age:q10` | 1.417 | [0.700, 2.142] | 202 |
| `threshold:WR:age:q20` | 1.268 | [0.764, 1.748] | 376 |
| `threshold:WR:age:q30` | 0.814 | [0.400, 1.255] | 531 |

**The production conditional (every confirmed `pointsPerGame` law is a delta, i.e. a crossing, by
construction of the match-key guard).**

| id | effect | 95% CI | n |
| --- | --- | --- | --- |
| `delta:TE:pointsPerGame:q70:fell_out_of` | 1.015 | [0.510, 1.476] | 132 |
| `delta:WR:pointsPerGame:q20:fell_out_of` | 1.288 | [0.569, 1.884] | 117 |
| `delta:WR:pointsPerGame:q90:fell_out_of` | 2.098 | [1.249, 2.958] | 161 |

**The new vocabulary (`teamAirYardsShare`, `draftPick`, `targetShare`/`experienceYear` conjunctions).**

| id | effect | 95% CI | n |
| --- | --- | --- | --- |
| `and:WR:experienceYear:q70+targetShare:q70` | -1.138 | [-1.760, -0.539] | 273 |
| `and:WR:snapShare:q70+teamAirYardsShare:q70` | 1.652 | [1.055, 2.255] | 320 |
| `and:WR:targetShare:q70+teamAirYardsShare:q70` | 1.862 | [1.206, 2.576] | 249 |
| `and:WR:targetShare:q80+teamAirYardsShare:q70` | 1.703 | [0.943, 2.449] | 201 |
| `threshold:TE:draftPick:q90` (a late-round tight end loses) | -1.493 | [-2.169, -0.768] | 62 |
| `threshold:WR:teamAirYardsShare:q70` | 1.346 | [0.784, 1.934] | 347 |
| `threshold:WR:teamAirYardsShare:q80` | 1.351 | [0.704, 2.000] | 306 |

6 original + 16 new = **22 confirmed**, 19 weak, 41 total BH survivors.

## 6. The collapse-direction call-out

The founder's Achane-shaped hypothesis: a player on a team the market has written off, or has
downgraded against last season, scores differently the following year. Task 2 made it sayable (the
low-side win-total templates); Task 3 asked it, on the full 48-candidate family it generates
(low-side q10/q20/q30 thresholds on `incomingTeamWinTotal` and its delta, across all four positions).
**All 48 are testable**; the smallest has 28 matched train pairs, the largest 541. This is a measured
negative, not a shrug.

**The hypothesis, stated as the founder stated it, is dead on measurement in the tested window.**
`threshold:RB:incomingTeamWinTotal:q10` (a running back on a team in the bottom 10% of win totals) has
116 matched train pairs and a train effect of **+0.144** with **p = 0.786**: not underpowered,
measured at essentially nothing, and pointing the wrong way for a collapse story. Its q20 and q30
siblings are -0.076 (p=0.831) and -0.309 (p=0.345). **All twelve `incomingTeamWinTotalDelta` low-side
thresholds are null**, the best of them p = 0.283. The high side of both quantities is also dead as a
single (all 48 high-side singles screened out, best p = 8.3e-2). The market line is not a standalone
law in either direction at any band; it only adds signal conditioned on a role quantity, which is
exactly the shape the two confirmed win-total laws already take.

**One weak survivor, and it is the mirror image, not the hypothesis.** Only
`delta:QB:incomingTeamWinTotal:q20:rose_into` cleared Benjamini-Hochberg. Full window: effect
**-2.887**, 95% CI **[-4.800, -1.011]**, **n = 57**, train effect -3.883, folds 2021: 5 pairs/-0.97,
2022: 13 pairs/+0.96, 2023: 7 pairs/-4.76. Verdict **weak**: fold 2022 disagrees in direction, which
caps it below confirmed. Its claim: a quarterback whose team's win total rose above 6.5 after being
at or below that mark the season before loses points per game the following season. That is the
market *upgrading* a previously written-off team, and the incumbent losing production, the mirror of
what the founder's hypothesis names, on 57 pairs, with a disagreeing fold.

**The evidential caveat, corrected in the fix round.** The original report attributed the old decade's
contribution of zero new evidence to the 2003-2026 Vegas win-total backfill living on a separate,
unmerged branch. That was factually wrong: those rows (`fedf19e`) were already in the shared store
roughly six hours before Task 3's runs began. The real cause is one layer down and is fixable.
`incomingTeamWinTotal` resolves a player to a team through `player_week_teams`, which is derived
solely from the snap-count file, whose asset floor is 2013. For 2003-2012 the win-total row exists but
the team edge does not, so the quantity reads null for every player in the extended decade and every
collapse-direction candidate matches on 2013-2021 exactly as it did before the window moved.

**The unblock, and it genuinely reopens the question.** Backfill `player_week_teams` for 2003-2012
from the published weekly stats' own team column, the same feed the history extension already landed
51,108 stat lines from and which carries a team per player-week. That unblocks `incomingTeamWinTotal`
for the whole decade. Queued for Round C, riding with the roster ingestion and floor decisions below.

## 7. Deferrals: what Round C (and one item, Round D) inherits

1. **The blend refit, on a family whose drift is already flagged.** `projections:blend:fit -- --check`
   reported drift mid-round (measured against the pre-fix, 41-confirmed family; the fix round did not
   re-run this check against the final 22-confirmed family, so a fresh fit is still owed):
   `availabilityCapPoints` 20 to 10 as the winning preview value, rho 0.6085 versus the committed
   rho 0.6055 (fitted), pure-market baseline rho 0.5892, availability alone 0.6032, laws admitted (the
   winner) 0.6085, 12 of 343 cells within 1e-4 of the winner (a plateau). Two causes, both expected:
   `td_regression`'s `trainEffect` moved (-0.841 to -0.675) and the confirmed-discovered-law membership
   changed. `blend-fitted.ts` is untouched; the working tree is clean. Round C's regeneration, not this
   round's.

2. **Rookie-curve refit, roster ingestion, and the floor decisions, with consumers enumerated.**
   `HISTORICAL_ROSTER_FLOOR = 2013` was not moved. Its consumers, per Task 1's audit: `preseason/ingest.ts`'s
   `historicalWeek1RosterAsOf` (the throw that blocks a 2003-2012 roster backfill; the kickoff stamps it
   needs now exist back to 2003 from this round's schedule ingest), `model/efficiency.ts`'s
   `careerStage` (moving the floor reclassifies veterans currently right-censored into `other`, a fitted
   model input change), `scripts/rookie-curve-fit.ts` (train seasons start at the floor; this is the
   named refit), `scripts/market-curve-fit.ts` and `scripts/blend-fit.ts` (both need ADP boards the
   store does not have before 2013; lowering the floor alone would silently produce empty older
   seasons). Task 2 additionally enumerated why the roster ingestion itself was skipped rather than
   performed this round: `seasonContext`'s season-gated read is not floor-gated and would have silently
   moved Task 3's own regeneration inputs; the ungated aggregate `firstRosterSeasonsThrough` feeds
   `experienceCohort`'s career-censoring boundary in `backtest.ts` and the fitted `experienceMultiplier`
   prior in `scripts/projection-fit.ts`, both of which would change behavior from the data alone; and
   the ingestion path itself throws below `ROSTER_SOURCE_CONFIG.earliestSeason`. The asset exists
   (`ROSTER_ASSET_FLOOR = 2002`); the ingestion is a scope decision, not a data hunt, whenever Round C
   wants it.

3. **`player_week_teams` backfill for 2003-2012**, from the published weekly stats' own team column.
   Section 6's unblock for the collapse-direction question, ledgered as a Round C queue item alongside
   the roster ingestion and floor decisions.

4. **The play-by-play context widening correction step, for 2003-2010.** Deliberately not run this
   round: `ingestCoaches` and `ingestOpponentDefence` derive a season's facts from a history window
   computed off the seasons they are called with, and `recordTeamObservations` is insert-if-absent on
   `(season, week, team, source, metric, as_of)`, so a later re-run over a widened history would compute
   new values for seasons whose rows already exist and silently keep the old ones. Widening that history
   needs a correction pass, not an additive backfill, and belongs to whoever moves that window.

5. **The `delta:pointsPerGame` shrinkage-sign observation, parked and unadjudicated.** Two ultracode
   verifier seats were lost to API safeguard false positives during Task 3's review and their finding
   was parked rather than adjudicated. One half of that parked finding, the `and:WR:targetShare:q80+
   touchdownPointsShare:q80` two-pair-fold fragility, resolved itself: that entry was one of the ten
   collateral withdrawals in section 4. The other half, a shrinkage-sign observation about the
   `delta:pointsPerGame` confirmations, was not independently re-verified and is recorded here exactly
   as the ledger carries it: a caution, not a finding, for whoever next touches that quantity.

6. **The 2-pair-fold fragility class, as a general concern rather than a specific withdrawal.** The
   round's two named thin-fold examples (the `targetShare`+`touchdownPointsShare` conjunction and the
   two QB `gamesPlayed`+`snapShare` conjunctions, all 2-to-5-pair out-of-train folds) are gone, withdrawn
   by the fix round for unrelated reasons. The underlying class is not gone: within the final 22,
   `delta:TE:pointsPerGame:q70:fell_out_of` has a 3-pair 2022 fold and `threshold:TE:draftPick:q90` has
   a 4-pair 2022 fold. Both clear the replication rule as written (>= 5 pairs on at least one
   out-of-train fold, direction agreement on every fold that matched anything), but they are among the
   thinnest confirmations in the file. A future round tightening `MIN_OUT_OF_TRAIN_FOLD_PAIRS` would
   take these first.

7. **`/player-laws` nesting at 22-law scale, to the UX ledger.** Flagged at 26 as a projection, arrived
   at 41 in fact, and settles at 22 after the fix. Still heavily nested: three RB age levels, three WR
   age levels, several `teamAirYardsShare` variants alone and in conjunction. The count of distinct
   findings is smaller than 22. `groupIntoFamilies` and `quantityIdsOf` were written for exactly this
   presentation problem and have never been exercised at this scale. It is a presentation question, not
   an evidence question: BH and the replication gate are what decide what is true, and neither moved.

8. **The read-layer one-generation assertion, to Round D.** A mid-round hotfix (commit `955479e`, see
   section 8) made `writePreseasonBoard` the one place a board is written, so a LIVE moment now retires
   an entire prior generation of projection and reason rows in one transaction before writing the fresh
   one. That fix guarantees the invariant at the write side: only one live generation is ever visible to
   a read at a given bound. The read layer itself (`preseasonProjectionsAsOf` and
   `preseasonProjectionsFor`, both resolving `DISTINCT ON (player_id)` over `as_of <= bound`) still
   *assumes* that invariant rather than asserting it; its correctness now depends entirely on discipline
   at the single write chokepoint rather than on anything the read query itself can verify. Whether that
   assumption needs a query-time assertion, or whether the single-chokepoint guarantee is durable enough
   on its own as more write paths are added, was not audited this round and is deferred to Round D.

## 8. Mid-round interjections: the roster and board staleness hotfix

Recorded per the ledger's note, not because this task touched it. A founder-reported, urgent issue
arrived mid-round: the 2026 board still ranked a player 118th whom upstream had already marked
DEN/CUT, traced to a captured 2026-09-01T00:00 roster snapshot that a same-day re-ingest could not
overwrite (`onConflictDoNothing` treating the fresh capture as a duplicate of the stale one). Two
fixes landed on `main` outside this round's task sequence:

- `303c633 fix(projections): live-season roster ingest supersedes itself; stale statuses cannot survive a refresh`,
  splitting live-season roster ingestion so a LIVE season deletes and rewrites its rows in one
  transaction instead of silently discarding a fresh capture that collides on the existing conflict
  key.
- `955479e fix(projections): a live board retires its stale generation on re-persist`, closing the gap
  the first fix left open: the roster hotfix cleared the stale input but left the stale output
  standing, because the read layer's `DISTINCT ON (player_id)` over `as_of <= bound` still returned
  yesterday's board rows for a player absent from today's smaller one. `writePreseasonBoard` is now the
  one place a board is written; a LIVE moment retires the season's prior projection and reason rows
  before writing the fresh generation.
- `26566c6 docs(research): the board reflects post-cutdown reality, corrections noted`, the closing
  documentation commit for that hotfix.

Both fixes are scoped to preseason ingest, store and persist; this round touched only the laws engine,
so no textual conflict is expected between the two. `main` moved during this round as a result, and per
the ledger's standing note, this branch's merge is not a fast-forward: `main` must be merged into this
branch before the final whole-branch review, with the five drift checks re-run after the merge-in
regardless of the expectation that nothing textually conflicts. That merge-in had not yet happened as
of this close-out; the branch head at the time of writing is `6603c2a`, the fix-round commit, and does
not yet include `303c633`, `955479e` or `26566c6`.
