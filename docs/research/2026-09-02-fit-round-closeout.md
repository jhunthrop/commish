# Fit round close-out: the decade that joined the evidence, and the fit that did not ship

**Measured 2026-09-02.** Plan: `docs/superpowers/plans/2026-09-02-fit-round.md`. Spec:
`docs/superpowers/specs/2026-09-02-fit-round-design.md`. Ledger:
`.superpowers/sdd/2026-09-02-fit-round/progress.md`.

This round did five things: it fixed a crosswalk bug that had been silently dropping fullbacks from
the store since 2003; it raised the roster floor and rebuilt the player-team map back to 2003; it
re-measured every law on the completed decade; it fit a new blend and a new rookie curve on that
completed evidence; and it did not ship either fit. THE BAR (beat ADP on 2024, held out, beyond noise)
broke twice, once on searched constants and once on a corrections-only rebuild. Both breaks were
honored exactly as the plan requires: no tuning, no third read, `BOARD_SOURCE` reverted to
`commish_board_v7_ppr_12` both times. Mid-round, the founder pushed launch to 2027 and reshaped the
next round from a shipping sprint into a data-year machine. This document is the record of all of it,
including the part where the system worked by refusing to ship.

---

## 1. The data prep

### 1a. The crosswalk class

Every nflverse mapper gated its rows on a four-string list (`QB`, `RB`, `WR`, `TE`) matched against
the published file's OWN `position` column, before ever consulting the universe's `projectedPosition`.
Wherever a file's spelling disagreed with the universe's, the file won silently, and the row never
reached the universe, not even into the unresolved report that exists to make a silent drop visible.
Richardson's 2012 file publishes his fifteen weeks with an EMPTY `position` column; `""` is not in the
four-string list, so his rookie season vanished at the gate although his gsis id was byte-identical to
the store's own.

**The class, measured before the fix: 4,828 skill player-weeks dropped 2003-2024**, every one a
position SPELLING disagreement, not an identity problem. The dominant case is the fullback:
`projectedPosition` maps FB to RB deliberately, but `scoredPositions` never carried FB, so 4,704 of
the 4,828 are fullbacks and the league's fullbacks were absent from the store as skill players
entirely, in every season 2003-2024, not only the old decade. The fix, `isProjectedCandidate` (one
gate read by all three mappers, universe position first and file spelling only as fallback), was
landed across the whole window rather than the old decade alone, because a store with fullbacks in
one half and not the other would bias every law comparing the halves. 97,322 new observations landed,
all additive: every pre-existing observation collided on its own fact index and was kept unchanged.
The class audit re-run comes back at zero missing across all 21 published seasons.

### 1b. Floors: 2013 to 2003

`HISTORICAL_ROSTER_FLOOR` moved to `MEASURE_SEASONS.from`, now two decisions agreeing rather than a
definition. Every consumer was adjudicated by name rather than swept:

| consumer | effect of the raise |
| --- | --- |
| `preseason/ingest.ts` `historicalWeek1RosterAsOf` | accepts 2003, stamped from that season's own kickoff |
| `model/efficiency.ts` `experienceCohort` | first-roster seasons 2004-2013 stop being right-censored and become real measurements in the year-4-to-6 cohort: a deliberate fitted-input change |
| `preseason/store.ts` `firstRosterSeasonsThrough`, `scripts/projection-fit.ts`, `backtest.ts` | wider cohort membership, fit and prediction moving together |
| `laws/populations.ts` `seasonContext` | `age`, `experienceYear`, `draftPick` now resolve for 2003-2012: the point of the exercise |
| `scripts/rookie-curve-fit.ts` | trains on 2003-2021 (nineteen rookie classes) instead of 2013-2021 (nine) |
| `scripts/market-curve-fit.ts`, `scripts/blend-fit.ts` | deliberately did NOT follow the roster floor; split into a new `BENCHMARK_BOARD_FLOOR` (2013, unchanged in value) because no ADP board exists before 2013 and pooling ten empty seasons would have reported a curve with a decade of evidence it never had |

One incidental ingest was reported rather than buried: the shipped preseason-ingest path also pulls
week-one depth charts, and nflverse publishes them back to 2002 despite a stale docblock claim of
"back to 2019," so 2003-2012 depth charts landed too: additive, correctly stamped, accepted as
shipped-ingest behavior.

### 1c. The team map: 54,196 edges

`player_week_teams` was rebuilt for 2003-2012 off the published weekly file's own `team` column,
matching `mapPlayerTeams`'s shape exactly (same gate, same universe resolution), differing only in id
space (gsis, not pfr) and stamp source (`weekAsOf`, the same map that already dates those seasons'
stat lines). **54,196 edges** across ten seasons, spot-checked against upstream week by week for five
players chosen for shape, all five matching exactly, including Randy Moss's 2010 three-club season
(NE, MIN, TEN), resolved correctly per week, which is exactly what a season-level roster join would
have gotten wrong.

### 1d. The bust cohort, fully resolved

All six running backs taken in the top five picks 2003-2012, rookie season, read straight out of the
completed store:

| season | pick | player | games | approx PPR | rush yds | rush TD | rec |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2005 | 2 | Ronnie Brown | 15 | 167.9 | 907 | 4 | 32 |
| 2005 | 4 | Cedric Benson | 9 | 26.5 | 272 | 0 | 1 |
| 2005 | 5 | Cadillac Williams | 14 | 177.9 | 1178 | 6 | 20 |
| 2006 | 2 | Reggie Bush | 16 | 263.6 | 558 | 6 | 89 |
| 2008 | 4 | Darren McFadden | 13 | 129.4 | 499 | 4 | 29 |
| 2012 | 3 | Trent Richardson | 15 | **254.7** | 950 | 11 | 51 |

Six of six. Richardson resolves at 254.7 approximate PPR points, 950 rushing yards, 11 rushing
touchdowns: the real-world shape the round set out to restore.

---

## 2. The re-measure

### 2a. The tribal six: unchanged, and one interval halved

Six laws in, six laws out, same six verdicts. `rb_age_curve` tripled its sample, 171 to 504 pairs, and
kept its answer (effect -1.250 to -1.265): **its 95% interval narrowed from 1.75 points wide to
0.95**, roughly halved, on evidence that is no longer thin. `td_regression` gained pairs in every
fold, including the modern ones (n 1,480 to 1,616), because the crosswalk fix, not only the roster
backfill, restored player-seasons across the whole window. `play_caller_fingerprint`'s replication
folds did not move at all while its window-wide n grew 238 to 263; every pair it gained sits in
2003-2012, and it stays debunked, on more evidence. The other three (`rb_workload_cliff`,
`target_share_persistence`, `wr_target_competition`) are byte-identical: they need participation, and
the snap-count asset floor is still 2013.

### 2b. The family: 4,165 / 177 / 90, with nine suspects

The quantile table was refit on 10,890 train player-seasons (2003-2021): 222 of 378 thresholds moved,
all checked mechanically (0 order violations, 0 band overlaps across 315 adjacent pairs). Candidates
regenerated from the refit table: **4,165 candidates, 177 BH survivors, 90 confirmed**, not the
**206 survivors / 94 confirmed** the Task 1 preview reported, which reproduced to the digit against
the STALE pre-round quantile table and were formally superseded. [CORRECTED 2026-09-02, final
review: this sentence previously read "the 41/94 figures", which paired the PRE-ROUND survivor count
with the PREVIEW's confirmed count and so named a pair that never existed. The three states, said
plainly: the committed pre-round file held **41 survivors / 22 confirmed**; the Task 1 preview, on
the stale quantile table, jumped to **206 / 94**; the refit landed at **177 / 90**.] The refit is a
net restraint: it removes 23
confirmations the stale thresholds would have granted and adds 19 the stale thresholds would have
missed.

**The decomposition method.** `runDiscoveryPipeline` is pure (it reads no database once its rows are
dumped), so the whole trial reruns under a counterfactual store state by masking rows, at about three
seconds a run. Four causes were each undone in turn (crosswalk, roster facts, team map, quantile
refit) against the identical row dump, and the masks were validated: undoing all four reproduces the
committed pre-round file to within 5 candidates of 41. The attribution buckets over the 71 new
confirmations:

| bucket | new confirmations |
| --- | --- |
| crosswalk alone | 24 |
| no single cause necessary | 24 |
| roster facts alone | 10 |
| crosswalk + roster facts | 10 |
| crosswalk + roster + team map | 2 |
| team map alone | 1 |

Two readings a count of 90 cannot give on its own: **the crosswalk fix, not the decade, is the largest
single driver, and its work is done in the MODERN half**: removing the 217 restored 2013-2023
player-seasons costs 29 confirmations, removing the 348 restored 2003-2012 ones costs 4. And **the
team map, built specifically to reopen the collapse question, is necessary for exactly 3
confirmations** (its removal actually raises the confirmed count to 92, because Benjamini-Hochberg is
a family-wide ranking and a smaller family has a looser line). It bought the one thing it was built
for (the WR collapse law) and almost nothing else.

**Artifact vigilance, the full record.** Four adversarial checks ran over all 90 confirmations:

- **The fullback check.** 84 of 90 keep sign and a CI excluding zero with the 565 restored
  player-seasons removed from the population. One does not: `threshold:RB:snapShare:q20` goes from
  +1.037 to +0.130 (CI grazing zero): a fullback law outright, marked SUSPECT.
- **The era split.** 40 laws have 40+ pairs in both old-decade and modern halves; 39 agree in sign.
  One disagreement, `and:WR:incomingCoachTenureSeasons:q70+touchdownPointsShare:q70` (old decade
  +0.245 n=44, modern -1.061 n=343), marked SUSPECT for era instability. **49 of 90 confirmations
  carry fewer than 40 old-decade pairs at all**: more than half the confirmed family has no
  old-decade evidence whatsoever, because the play-by-play and snap-count quantities still floor at
  2013.
- **`draftPick`, given its own scrutiny.** The coverage boundary that moved (0% to ~65-70%) is not
  where the six confirmed `draftPick` laws' effects concentrate: all six agree in sign across both
  eras, five of six carry a modern-era interval excluding zero on their own, and the direction is
  monotone (early picks gain, late picks lose). Not marked suspect.
- **The match-key trajectory class.** Seven `delta:*:pointsPerGame:*` confirmations are sign-perfect
  for mean reversion (every riser loses, every faller gains, at every level and every position), which
  is exactly what a pure regression-to-the-mean process on the match key's own noise would produce
  with no football content at all. **Marked SUSPECT as a family (7 laws).**

**Summary: 9 of 90 marked suspect**: `threshold:RB:snapShare:q20`, the seven-law
`delta:*:pointsPerGame:*` family, and the one era-flip AND-law. The other 81 passed every check run
against them. The pricing-eligible set (Task 3, Task 4) is the confirmed 90 minus these 9, composed by
subtraction from the existing chip-eligibility seam rather than as a second definition.

Also worth stating plainly: **90 confirmations are not 90 facts.** 40 touch the goal-line/touchdown
cluster (a restatement of `td_regression` at finer granularity), 33 touch the age/experience cluster
(`age` and `experienceYear` are near-restatements of one another at RB), 13 touch both, and 30 touch
neither. The family got 4.1 times bigger; the number of distinct claims in it did not.

---

## 3. The collapse

The founder's founding hypothesis (a player on a team the market has written off collapses) could
not be tested below 2013 in the previous round because `incomingTeamWinTotal` resolves a player to a
team through `player_week_teams`, which did not exist there. This round built that map back to 2003,
and Task 2's review corrected the resulting paragraph twice in place (a TE fold-count error and a
season-span endpoint error). This is the corrected paragraph verbatim:

> The market-abandoned-team signal is real, it is small, and it lives at exactly one position. A wide
> receiver whose team opens the next season with a Vegas win total of 6.0 or less scores 0.81 points
> per game FEWER the following season than a matched receiver who scored the same amount that season
> but whose team was priced above that line: roughly twelve to fourteen PPR points across a full
> season, measured on 368 matched pairs whose predictor seasons span 2003 to 2023 (outcomes 2004 to
> 2024; CORRECTED by review, the original said "across 2004 to 2023" which matched neither axis), with
> a 95% interval of [-1.34, -0.31] that
> does not touch zero and with all three replication folds agreeing. For running backs the same
> question, asked the same way on more pairs (288 at the bottom band alone), answers at essentially
> nothing: -0.18 points per game with a p-value of 0.56, and the two looser bands are just as flat. For
> quarterbacks it is nothing. For tight ends there is a shallow negative at the bottom 30% band
> (-0.46 points per game) whose replication folds ALL point the other way, which holds it well below
> confirmed (CORRECTED by review: the original said one disagreeing fold; the committed entry's three
> folds are +0.063, +0.050 and +1.123 against the expected negative, a far shakier reading). And the
> DOWNGRADE version of the question, the one that asks whether the market marking a team DOWN relative
> to what it actually won last season hurts its players, is dead at every position and every band: all
> twelve of those candidates screened out, the best of them at p = 0.17. So: the founder's collapse
> hypothesis is now CONFIRMED IN DIRECTION, for receivers only. It is not the running-back-flavoured
> version the hypothesis was originally told through, and that version remains dead on measurement with
> the whole decade now in evidence rather than for lack of it.

**Two things carried alongside this paragraph, not buried under it.** First, an earlier drift note
(Task 1) had described this confirmation as pointing "in the direction OPPOSITE to the founder's
hypothesis." That was wrong and formally corrected: the founder's hypothesis is that a written-off
player loses points, the measured effect is negative, meaning he loses points: the finding AGREES
with the hypothesis. What is opposite is something else: the previous round's two confirmed win-total
laws were good-team laws (a receiver on a nine-win-or-better team gains); this is their mirror at the
other end of the line. Both can be true at once and both now are.

Second, and binding on every founder-facing framing: **the WR collapse law is a MARGINAL BH survivor**:
it sits in the last two ranks of the 177-candidate cut. It survived the fold-agreement gate cleanly
and it is not concentrated where the coverage boundary moved (the modern half is the STRONGER half,
-0.956 vs -0.614), but its position at the edge of the family-wide cliff means a slightly different
family size or a slightly different quantile table could have left it out. It is confirmed evidence,
not settled certainty.

---

## 4. The fit and the two breaks

### 4a. The grid, and the winner's margin

Task 3 widened the blend grid 54x over the incumbent's cell count, 343 cells to 18,522 (7³ cap cells
× 3 recency × 3 props weights × 2 dedup × 3 per-player caps), after rebuilding the scoring loop
around a single reused context so the grid could run in about two minutes rather than billions of map
inserts. The winner: `lawCapPoints=2, availabilityCapPoints=10, totalCapPoints=40, recency=0.5,
props=0, dedup=false, playerLawCap=20`, train rho 0.5980 against the incumbent's 0.5976 on the same
widened grid, a margin of roughly **4e-4** of train rank correlation, on a search 54 times wider than
the one that produced v7. 126 of 18,522 cells scored within 1e-4 of the winner, but the incumbent
configuration itself sits outside that plateau by more than three times the tolerance, so the tie rule
does not save it. Read plainly: the win is real by the letter of the rule and small enough that Task
3's own multiple-comparisons warning (a wider search finds a higher maximum even when nothing real was
added) applies to it almost by name.

### 4b. The bar, all three configurations

| | v7 (published, pre-correction store) | v8 (searched constants) | v9 (corrections only, v7's constants) |
| --- | --- | --- | --- |
| **2024 blend vs ADP (THE BAR)** | **+0.1002 [+0.0041, +0.2089] BEYOND NOISE** | **+0.0982 [-0.0065, +0.2201] within noise** | **+0.0979 [-0.0068, +0.2203] within noise** |
| 2024 law-ablated vs ADP | not published | +0.1056 [+0.0055, +0.2177] BEYOND NOISE | +0.1063 [+0.0052, +0.2177] BEYOND NOISE |
| 2024 blend vs law-ablated | not published | -0.0074 [-0.0275, +0.0123] | -0.0083 [-0.0261, +0.0092] |
| 2024 starter band | +0.2345 [+0.0408, +0.4377] WON | +0.2515 [+0.0447, +0.4751] WON | +0.2521 [+0.0357, +0.4734] WON |
| 2024 blend vs raw | +0.1142 [+0.0289, +0.1969] BEYOND | +0.1028 [+0.0150, +0.1850] BEYOND | +0.1025 [+0.0193, +0.1829] BEYOND |

No line anywhere in either full run (v8: 404 lines, v9: 404 lines) reads LOST BEYOND NOISE. Both bars
broke on exactly the same line: 2024 pooled blend vs ADP, the one the plan names decisive.

### 4c. Constants exonerated

**v8 and v9 differ in exactly one thing, the searched blend constants versus v7's own, and their
decisive gaps are +0.0982 and +0.0979: statistically the same number.** The searched cell was not the
cause of the break, and the corrections-only rebuild did not rescue it because there was nothing there
to rescue. Whatever moved the bar is something v8 and v9 share, and the only things they share are the
three corrections (crosswalk, roster floor, team map) flowing through the re-measured law set and the
rebuilt rookie curve.

### 4d. The law-ablated diagnostic

On BOTH boards, the board with its laws ablated clears the bar and the board with its laws priced does
not: v8's law-ablated arm is +0.1056 [+0.0055, +0.2177] BEYOND NOISE against blend's +0.0982 within
noise; v9's is +0.1063 [+0.0052, +0.2177] against +0.0979. The law channel costs 0.0074 to 0.0083 of
held-out rank correlation on the decisive season under both constant sets, including v7's own. The
candidate cause is the priced law family growing from 22 laws to 87 (six tribal laws plus 81 of the 90
confirmed discovered laws, the nine suspects refused): v7 spent 2 points per law with no per-player
ceiling and 5.6% of the train lift; v8/v9 spend up to 20 points per player and 20.8%/7.8% of the train
lift respectively. The fit made the law channel more expensive on train, and held-out 2024 charged for
it. This is not a refutation of the laws' own point-per-game evidence, replicated across folds. It is
a finding about the fit's decision to let them spend more, and it is recorded as the leading
hypothesis, not tested by tuning against the read that surfaced it.

### 4e. The store-change confound

**The thing that bounds every sentence above: v7's published verdict was taken on the
PRE-CORRECTION store.** 653 stored 2024 evaluation rows then, 664 now: a different evaluation
population as well as a different board. **v7's own configuration has never been scored on today's
completed store.** So "v7 clears and v9 does not" is not yet a like-for-like comparison. The honest
set of live hypotheses is at least three: the enlarged law family costs held-out ordering; or the
completed store's own 2024 population is slightly harder and v7 would no longer clear on it either; or
the v7 verdict was always marginal (its own lower bound was +0.0041) and any perturbation tips it.
Nothing in this round distinguishes them, and distinguishing them costs another look at 2024, which
is exactly why it is deferred to the 2027 fit round under the 2026 quarantine (section 5) rather than
improvised here.

### 4f. Both STOPs honored

The plan's rule has no discretion in it: an interval that includes zero on the decisive 2024
blend-vs-ADP line is a STOP, full stop, whether the break is caused by the point estimate moving or by
the interval widening. It fired twice. Both times the sequence stopped exactly where the plan says it
must: no tuning, no third scorecard run chasing the number, no quiet adoption of v8's `+0.0982` on
the reasoning that it is "close enough." `BOARD_SOURCE` reverted to `commish_board_v7_ppr_12` on both
occasions (`b456ed3` after v8, `bd7888d` after v9); the tree at close-out is `9f73df2`, and the live
board today serves v7's configuration, the one whose published verdict still stands.

**Not shipping is the discipline working, not the discipline failing.** A round that widened the
evidence base by a decade, re-measured every law, quadrupled the confirmed family, and searched a grid
54 times larger than the incumbent's produced two candidate configurations, and both of them, honestly
measured on the one held-out season the plan reserves for judgment, failed to clear a bar the
incumbent cleared. The alternative to stopping was either shipping a configuration that does not
demonstrably beat the market it competes against, or re-reading 2024 until one did, and the second of
those is the specific failure mode multiple-comparisons discipline exists to prevent. The system was
built to be able to say "this round's fit does not ship" and mean it, and this round is the first time
it had to.

### 4g. The complete 2024 read history

[CORRECTED 2026-09-02, final review: this section previously began "2024 has now been read exactly
twice this round" and listed only this round's two reads, which is true of THIS ROUND and false of
the season. Outcome 2024 had already been scored three times before this round opened. A "complete
read history" that starts at this round's own first read is exactly the accounting error the
spent-judge ruling exists to prevent, so the earlier three are restored below, from
`docs/research/2026-08-31-market-edge-closeout.md` and its two addenda.]

**Before this round, three reads:**

1. **The original market-edge scorecard** (2026-08-31 close-out, section 1). The bar's first
   statement: 2024 blend vs ADP **+0.1029 [+0.0081, +0.2099] BEYOND NOISE**, blend rho 0.5301. This
   is the read that established the bar and the discipline every later one inherited.
2. **The gate-fix re-measure** (2026-09-01, live-board plan Task 4 fix round 2 addendum), after the
   cross-position law-reason defect was closed and the board bumped to v5: **+0.1021 [+0.0070,
   +0.2102] BEYOND NOISE**, blend rho 0.5293. Every classification identical to the read before it.
3. **The win-total re-measure** (2026-09-01, vegas-laws Task 4 addendum), after two new
   `incomingTeamWinTotal` laws entered pricing. This one ran the full 404-line scorecard TWICE, since
   the v6 arm was reproduced on the same store to make the comparison a measurement rather than a
   memory: v6 **+0.1021 [+0.0070, +0.2102]** reproducing read 2 exactly, and v7 **+0.1002 [+0.0041,
   +0.2089] BEYOND NOISE**. The v7 figure is the published verdict this round's two breaks are
   measured against, and it is the last time the bar was cleared.

**This round, two more:**

4. **v8, the searched-grid read.** The full 54x grid was scored on train (2013-2021); the winning
   cell's board was persisted and scored once against 2024, held out. Broke.
5. **v9, the corrections-only confirmatory read.** Dispatched under the founder's own
   corrections-only choice, built with a single-cell "grid" carrying v7's exact constants (no
   search), scored once against 2024. Broke again, at a statistically identical gap to v8, which is
   what bought the constants-exoneration finding above.

**So: six scorecard runs (five distinct reads; the third read executed the scorecard twice, a v6
reproduction beside v7) against outcome 2024, across three rounds, and the point estimate has
walked monotonically down through every one of them (+0.1029, +0.1021, +0.1021, +0.1002, +0.0982,
+0.0979) while the interval's lower bound walked to zero and through it.** No single read selected
anything, every one was taken after its own round's changes rather than to choose among them, and no
sixth was taken after the fifth came back negative. But a season read five times is not a fresh judge
in any meaningful sense, and the last two reads also changed the evaluation population underneath the
comparison (section 4e). **2024 is spent as a judge.** No future configuration reads it again until
the 2027 fit round, under the 2026 quarantine below.

### 4h. The founder rows: what v8 and v9 would have priced

Read-only rows, produced despite both breaks, because they describe what the store already holds and
change nothing by existing. The 2026 live board, v7 rows beside v8 rows:

| player | v7 points | v8 points | v7 rank | v8 rank | v7 value rank | v8 value rank | chips |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Jeremiyah Love (RB ARI, rookie) | 330.8 | 254.7 | 2 | 14 | 1 | 4 | none either way |
| Christian McCaffrey | 224.9 | 208.9 | 39 | 43 | 16 | 19 | +26 law chips, 0 lost |
| Derrick Henry | 231.4 | 203.2 | 32 | 51 | 12 | 22 | +26 law chips, 0 lost |
| De'Von Achane | 233.2 | 223.2 | 30 | 37 | 11 | 13 | none gained, 0 lost |
| Jordan Love (QB GB) | 175.3 | 185.3 | 73 | 63 | 174 | 169 | none gained, 0 lost |

Both Loves appear because the brief that requested this table named only "Love": the rookie RB is the
one the live-board close-out originally flagged (value rank 1 on 330.8 points, the rookie channel
uncapped), and he is the row the rookie-curve refit was built to move.

**Jeremiyah Love: the founder's own confirmed defect, made visible.** 330.8 to 254.7 points, value
rank 1 to 4. This is not a hypothetical correction, it is the founder-flagged survivorship defect in
the previous curve (section 7) resolving on a real 2026 row. He falls off the top of the board without
being erased from it, and the whole 2026 rookie cohort moves the same way behind him.

**McCaffrey and Henry: what the 4.1x law family and the per-player cap look like on a real row.** Each
gains 26 law chips, every one of them from the age/experience and goal-line clusters section 2b names
as redundant, and each loses points on net (McCaffrey -16.0, Henry -28.2). Henry falls 19 places on
points and 10 on value. Nothing was lost from either man's reason list: v8's reasons are a strict
superset of v7's for all five founder rows.

**Achane: no new chip, still repriced** (-10.0 points, 7 places), from the availability cap and
recency decay rather than the law channel. The WR-only collapse law (section 3) has nothing to say
about a running back; no RB collapse law exists to price him with.

**What this table is, stated exactly.** These are not the live board's rows. They are what v8's
configuration would have priced, read out of the store where v8's replay was persisted before the bar
broke. v9's founder rows were never produced as a separate table, because v9's persist changed only the
blend constants against v8 (recency, the availability cap, the per-player law cap); the rookie curve
and the priced law set, the two inputs that move Love, McCaffrey, Henry and Achane by these margins,
are identical between v8 and v9. The shape of this table therefore holds under v9 as well, though the
exact point totals would differ by the same small margins section 4b's bar table shows between the two
configurations. **The live board serves v7's rows, unchanged, today.** Nothing in this table is on the
product a manager sees; it is the record of what the round measured and did not ship.

---

## 5. The strategic turn

Mid-round, during the v9 confirmatory run, the founder gave this directive, verbatim:

> "We likely won't be live before this season starts and can push for next year. Do what needs to be
> done for the long term success and accuracy of the product."

This reshaped the round's remainder and the next one.

**Ruling: THE 2026 QUARANTINE.** No fit, law verdict, anchor test, or model selection reads 2026
outcomes until the 2027 preseason fit round. 2026 is the pristine held-out season, binding on every
future round, stated here and carried into the next round's spec.

**Ruling: 2024 read discipline.** The v9 confirmatory read completed and stands as the record either
way (section 4g). After it, 2024 is spent for selection purposes: future configurations wait for the
2026 judge.

**Ruling: Round D reshaped.** The in-season loop that would have carried live-shipping pressure
becomes instead the DATA YEAR machine: no user-facing shipping pressure, all evidence-accumulation.
Its design centers on a **prospective register**: weekly pre-kickoff frozen predictions, graded after
the fact, the launch-evidence spine the 2027 round will need that no retrospective backtest can
substitute for. Alongside it, the full data-year machine list:

- **Weekly props snapshots** (roughly 100 credits per week, well inside the 20,000-credit monthly
  budget the props archive already operates under; a single week-1 snapshot this year cost 72
  credits for 967 observations across 16 events).
- **Weekly stat ingestion**, keeping the store current through the season rather than backfilled after.
- **The Sep 9 depth ingest**, named explicitly in the founder's own reshaping.
- **October props backfill**, extending the 2023-2024 archive already captured toward 2025 once the
  October credit refresh lands (the resume command from the vegas-laws round is unchanged).
- **The participation-floor extension** to the old decade: the pbp/snap-count asset floor still sits
  at 2013, which is why 49 of this round's 90 confirmations carry no old-decade evidence at all
  (section 2b); this is the next equivalent unlock to the crosswalk and roster fixes this round made.
- **The pbp-context correction**: `ingestCoaches` and `ingestOpponentDefence` derive a season's facts
  from a history window computed off the seasons they're called with, while `recordTeamObservations`
  is insert-if-absent, so a re-run over a widened history silently keeps stale values for seasons
  whose rows already exist. Carried forward again; still needs a correction pass, not an additive
  backfill.
- **Test-infrastructure debt**: the test Postgres's 1.4 GB tmpfs is undersized for a single serial
  619-file run and fails intermittently on `TRUNCATE`; the two-half workaround (`suite-halves.sh`)
  works today but a per-lane database or a larger tmpfs is the real fix.
- **Committing full scorecard texts**, not only headline rows, to `docs/research/` alongside future
  close-outs. This round's own v7 arm illustrated the cost: its 404-line scorecard does not survive
  anywhere, so this document's flip-list comparisons (section 4b) are complete only over the seven
  headline rows the previous close-out published, not the full run.
- **Board-clutter cleanup**: the store holds **nine sources per archive season** (`commish_board_v1`
  raw through `commish_board_v9`, all `_ppr_12`), of which one is read. 2026 holds **seven** (v1, v4,
  v5, v6, v7, v8, v9), and v4 there is the odd one: **2,277 rows across three stamps**, a live board
  from before the retire-on-live rule existed, so it appended three generations instead of replacing
  them. v5 and v6 hold 759 rows each, the pre-cutdown universe. Inert clutter, not a correctness
  problem, but Round D's cleanup brief needs the real shape rather than the round's own most recent
  four. [CORRECTED 2026-09-02, final review: this bullet previously said "four boards per archive
  season (v1 raw, v7, v8, v9)", which counted only the boards THIS round touched and would have
  scoped the cleanup brief to less than half the rows. Counts above are read directly from
  `preseason_projections`.]

---

## 6. The frozen state

**The data year runs on v7's configuration exactly as committed: every fitted file as-is.** No
fitted-file regeneration happens until the 2027 fit round. Regenerating any fitted file now would
create a curve no stored board uses and would desync the shadow register's own consistency with
what's actually live.

### 6a. The freeze is now a guard, not a note

[ADDED 2026-09-02, final review, the CRITICAL finding.] The paragraph above described an intention
that one bare command could have destroyed. `BOARD_SOURCE` points at v7 while every fitted file on
the tree is the v9 configuration, so `npm run projections:preseason:persist` with no arguments would
have taken the LIVE 2026 path, and that path RETIRES THE STORED GENERATION BEFORE IT WRITES: the 546
rows the product serves would have been deleted and replaced by rows this tree's constants produce,
under v7's name, with no second copy and no `as_of` to recover from. The replay path carried the
quieter version of the same defect, since `preseason_board_reasons` has no `as_of` and is written
with `onConflictDoUpdate`: an archive re-run would leave the archived POINTS alone, their unique key
already existing, while silently replacing their EXPLANATIONS with the 87-law family's, producing an
archive whose reasons describe numbers it is not showing.

`FROZEN_BOARD_SOURCES` (`src/projections/preseason/board-store.ts`) names both served boards, and
`writePreseasonBoard` refuses before it builds a single row, on both paths, so no script can route
around it. The refusal names the ruling, says why the write is unsafe, and points at the `--unfreeze`
flag that lifts it, which prints what it is overriding. The live refusal covers EVERY season rather
than only 2026, deliberately: the live arm deletes by `(season, source)`, so a live-moment write
aimed at an archive season under a served name would delete that archive outright. 2026 also comes
off the persist script's default season list, so a no-argument run does not reach for it at all.

The lift condition is the same one everything else in this section waits for: **the 2027 fit round
bumps `BOARD_SOURCE` to a fresh name**, at which point these two constants name boards nobody serves
and the set should be re-pointed at the new served names rather than emptied.

Proven end to end rather than asserted: `npm run projections:preseason:persist 2026` exits non-zero
with the refusal, and the 2026 v7 row count reads 546 before and 546 after.

One check remains deliberately unresolved rather than silently drifted: `npm run
projections:market:fit -- --check` still exits 1. It has been drifted since Task 1 completed the
store, and no task in this round owned its regeneration (Task 4's brief named `blend-fitted.ts` and
`rookie-curve-fitted.ts` only). It was sized, not guessed: regenerated into a scratch copy, diffed
through the shipped interpolator, and the committed file restored, tree unchanged.

- **The drift is RB-only and small.** Zero movement at 30 of 36 sampled (position, ADP rank) pairs;
  every QB, WR and TE sample identical to the digit. The RB samples move by **at most 4.01 points**
  (at rank 5; 1.1 at rank 1, 0.9 at ranks 75 and 100).
- **Attribution: T1 store growth.** The same crosswalk and roster-floor fixes that moved everything
  else in this round moved this curve too; nothing about it is a code regression.
- **It does not confound v7/v8/v9.** All three boards were built against the identical committed
  curve, so the three-way comparison in section 4b is internally consistent.
- **It does mean v9 was "corrections minus one."** One fitted file that should move with the store did
  not, so the corrections-only board is not quite complete, and nobody knows whether including it
  would change the bar. Given the size and the RB-only shape, unlikely to move a pooled rank
  correlation on 176 rows, but that is an argument, not a measurement.

Regenerating it now would either desynchronize the committed code from the stored v9 rows and verdict
this record rests on, or require re-persisting and a THIRD held-out read of 2024 inside a round that
had already spent two. Neither is this round's to choose after a STOP. It is the first item the next
round should clear, before anything else is measured, and it clears under the 2027 fit round like
every other fitted-file regeneration, not sooner.

---

## 7. The rookie-curve finding for the 2027 round

Even though it did not ship, the rookie-curve refit is a real measurement the next round inherits.
Fit on 1,489 rookie-season observations across nineteen classes (2003-2021), against v7's 720
observations across nine (2013-2021). Every position's top end came down, RB hardest:

| pick | QB v7 | QB v8/v9 | RB v7 | RB v8/v9 | WR v7 | WR v8/v9 | TE v7 | TE v8/v9 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 201.9 | 171.8 | **383.8** | **271.1** | 206.5 | 179.5 | 176.6 | 176.6 |

RB pick 1 383.8 to 271.1 is the headline: the previous curve's top knots rested on a handful of
post-2013 survivors (this is the founder-flagged survivorship defect the vegas-laws round named), and
the completed decade's much larger bust cohort (section 1d) pulls the ceiling down hard. QB pick 1
201.9 to 171.8, WR 206.5 to 179.5, TE unchanged (176.6 to 176.6, its first knot is still pick 4 and
the old decade added no earlier TE pick that outscored the incumbent). On the live 2026 board this
moved Jeremiyah Love from 330.8 points at value rank 1 to 254.7 points at value rank 4, off the top of
the board without being erased from it, and the whole 2026 rookie cohort with him.

**A genuine property of the corrected curve, not a test artifact: the refit is a step function whose
RB plateau runs from about pick 16 to pick 40.** The full-cohort curve cannot separate two round-one
running backs across that whole range; three committed test fixtures had to be inverted or updated to
match (`9f73df2`), including moving the curve-beats-buckets demonstration from RB to QB because the RB
case no longer demonstrates separation. This is recorded as the 2027 round's own open question (knot
placement across that plateau), not resolved here, since resolving it means fitting, and no fitted
file regenerates before 2027 (section 6).

---

## 8. Deferrals, complete

1. **The market-curve check's frozen exit-1** (section 6): RB-only, max 4.01 points, attributed to
   T1's store growth. Regenerates only at the 2027 fit round.
2. **The store-change confound** (section 4e): establishing whether v7's own configuration clears the
   bar on today's completed store, rather than the pre-correction store its published verdict was
   measured on, requires another held-out read of 2024. Deferred to the 2027 fit round under the 2026
   quarantine.
3. **The pbp/snap-count participation floor**, still at 2013: the next equivalent unlock to this
   round's crosswalk and roster-floor fixes, needed before `rb_workload_cliff`,
   `target_share_persistence`, and `wr_target_competition` can move, and before the 49 of 90
   confirmations with no old-decade evidence can gain any. Round D's data-year machine, not this
   round.
4. **The pbp-context correction** (`ingestCoaches`, `ingestOpponentDefence` silently keeping stale
   values on a widened history window under insert-if-absent semantics): carried forward from the
   previous round's own deferral, untouched again this round. Round D.
5. **The test-database tmpfs**: undersized for a single serial 619-file run, intermittently failing on
   `TRUNCATE`. Two-half workaround in place; the real fix (per-lane database or larger tmpfs) is Round
   D ops.
6. **Board-clutter cleanup**: **nine sources per archive season** (v1 raw through v9), one of them
   read; **seven for 2026** (v1, v4, v5, v6, v7, v8, v9), where v4 alone holds 2,277 rows across
   three stamps because it predates the retire-on-live rule, and v5 and v6 hold 759 each from the
   pre-cutdown universe. Inert, correct under the standing source-bump rule, cleanup rides with Round
   D ops. [CORRECTED 2026-09-02, final review: previously "four boards per archive season", which was
   the count of the boards this round touched, not the count in the store.]
7. **Committing full scorecard texts** to `docs/research/` alongside future close-outs, not only
   headline rows: this round archived `scorecard-v8.txt` and `scorecard-v9.txt` in-workspace only, so
   the next round that wants a full v8/v9-vs-future comparison has them, but the discipline of
   committing scorecard text alongside the close-out itself starts with the next round, not this one.
8. **The informational props-anchor comparison: gated correctly, never run.** Stage 6 of the plan
   (constructing a props-anchored 2024 board variant and scoring it, loudly labeled non-selective) was
   gated on the bar holding, and the bar broke twice. Running it anyway would have added a third read
   of 2024 to a round that had already spent two, and a sixth to the season overall (section 4g), in
   service of a comparison that could not have changed the STOP either way. Correctly not run.
9. **Props-anchor adoption waits for the 2026 judge.** Unchanged from the vegas-laws and Task 3
   rulings: the props archive holds 2023-2024, the blend trains on 2013-2021, and on this train window
   the axis is a structural no-op (every train row's anchor map is empty, coverage prints 0 of 1,323
   rows). Adoption needs 2023+2024 as train and a fresh held-out season, 2025 under the original
   design, now folded into the 2027 round's own held-out discipline under the 2026 quarantine, since
   using 2024 again would burn a season already spent.
10. **Cluster dedup semantics** (Task 3 concern 4): an AND law joins exactly one cluster, so a player
    firing both an age-plus-goal-line AND and a separate pure goal-line law still gets both. The
    grid measured that cluster dedup LOSES on train at every axis combination regardless (the fit
    chose the incumbent semantics), so this is now a settled measurement rather than an open question,
    but the single-assignment cluster design itself (versus multi-cluster membership with allocation)
    remains unrevisited.
11. **UX ledger items**: the nine suspect laws fire visible reasons on 14 to 36 moved rows per archive
    season while spending nothing: the designed policy, working, but a product surface nobody has
    reviewed the copy for. The `ReasonChip`'s "Market NNN pts" wording is exactly right while the
    props weight is null-celled and needs a persona pass the day a props weight ever ships nonzero.
    Neither addressed this round.

---

## Verification

```
$ npx tsc --noEmit
```

43 errors, the round's documented baseline throughout every task, 0 in any file this task touched
(this task touched no source file, only this document).
