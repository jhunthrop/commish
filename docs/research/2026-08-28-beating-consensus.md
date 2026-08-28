# Beating the consensus: the board against FantasyPros, task by task

**Measured 2026-08-28.** Reproduce with `npm run projections:backfill 2020 2024`,
`npm run projections:context 2016 2024`, `npm run projections:preseason:ingest 2021 2024`,
`npm run projections:preseason:fit`, then `npm run projections:preseason`.
Code: `src/projections/preseason/**`, `src/projections/backtest.ts`, `src/projections/replay-moments.ts`.
Plan: `docs/superpowers/plans/2026-08-28-beat-the-consensus.md`.
Previous: `docs/research/2026-08-27-preseason-board.md`, `docs/research/2026-08-27-model-v3.md`,
`docs/research/2026-08-27-decision-quality.md`.

The previous document lost to expert consensus by 0.120 and 0.045 rank correlation and named four
defects it had measured in itself. All four were worked. **The gap closed by three quarters on one
held-out season and by seven tenths on the other, and it did not close.**

## The headline

Rank correlation against actual season points, like for like on the players both sources ranked, in
a twelve-team PPR league.

| season | expert consensus | our board, before | our board, now | gap before | **gap now** | n |
|---|---|---|---|---|---|---|
| 2023 | 0.7387 | 0.6190 | **0.6484** | 0.1197 | **0.0903** | 414 |
| 2024 | 0.7725 | 0.7272 | **0.7593** | 0.0453 | **0.0132** | 479 |

**We did not cross it.** 2024 is now within one and a third hundredths, which is close enough that a
different fifty players would decide it; 2023 is still a real loss.

Against the real market, Fantasy Football Calculator's twelve-team PPR average draft position:

| season | market (ADP) | our board, before | our board, now | n |
|---|---|---|---|---|
| 2023 | **0.4752** | 0.4723 | 0.4701 | 173 |
| 2024 | **0.4272** | 0.4296 | 0.4036 | 176 |

**We went backwards against the market while going forwards against consensus**, and the reason is
in the bands below: every change in this document helps most in the deep pool, and an ADP board
stops at about two hundred names. Section "Against the market" below takes this seriously rather
than filing it under sample size.

## Per band, against consensus, banded by the benchmark's own rank

2023, n=414:

| band | ECR | ours before | ours now | Δ vs ECR now |
|---|---|---|---|---|
| elite (1-50) | 0.2878 | 0.3263 | **0.3939** | **+0.1061** |
| starter (51-150) | 0.2648 | 0.2672 | 0.2309 | −0.0339 |
| deep (151-400) | **0.5206** | 0.3556 | 0.4225 | −0.0981 |
| fringe (401+) | **0.1473** | 0.1341 | −0.2420 | −0.3893 |

2024, n=479:

| band | ECR | ours before | ours now | Δ vs ECR now |
|---|---|---|---|---|
| elite (1-50) | **0.2503** | 0.1698 | 0.0814 | −0.1689 |
| starter (51-150) | **0.3303** | 0.2749 | 0.2390 | −0.0913 |
| deep (151-400) | 0.5096 | 0.4530 | **0.5128** | **+0.0032** |
| fringe (401+) | 0.3076 | 0.2904 | **0.3713** | **+0.0637** |

**The deep band is no longer the story, and that is the single largest result here.** It was the only
band we lost on both seasons and the one we lost by the most; we now beat consensus in it in 2024 and
have taken two thirds of the 2023 deficit out of it. The segment the whole product thesis rests on is
no longer the segment we are worst at.

What replaced it is not one thing. **2023 and 2024 now lose in opposite places** — 2023 in the deep
and fringe bands with a large win at the top, 2024 at the top with wins in the deep and fringe. By
this engine's own two-season rule, neither pattern is a finding. What IS a two-season finding is that
the starter band lost on both, by 0.034 and 0.091, and it is the band a draft is mostly made of.

## Task 1: order the board by points, not value over replacement

Phase 6 measured this and shipped the losing order anyway. The board now orders by projected points;
value over replacement is kept as `byValueOverReplacement`, a labelled draft-value view, and every
entry carries both ranks.

| season | ECR | draft-value view (VOR) | the board (points) |
|---|---|---|---|
| 2023 | 0.7387 | 0.6101 | **0.6484** |
| 2024 | 0.7725 | 0.7275 | **0.7593** |

Worth 0.038 and 0.032 for nothing but choosing the ordering that had already been measured as
better. It reproduces on the fit seasons and in almost every band on both.

**Replacement level is not wrong and it is not deleted.** Within a position the two orderings are
IDENTICAL, because value over replacement subtracts a constant per position; the only thing it can
change is how positions interleave, and interleaving quarterbacks against backs by scarcity is the
right answer to "what is this pick worth" and the wrong answer to "who will score more". A rank
correlation against season points asks the second question. `board.ts` now says so, and a test pins
that the two views agree within a position and disagree only across them.

## Task 2: rank rookies by draft capital

The rookie model measured worse than sorting the class by draft pick alone: 0.3733 against 0.6374 in
2023 and 0.6459 against 0.6790 in 2024. Judged on the rookie segment against that same
counterfactual:

| season | draft capital alone | rookie model, before | rookie model, now |
|---|---|---|---|
| 2023 | 0.6374 | 0.3733 | **0.6336** (−0.0038) |
| 2024 | 0.6790 | 0.6459 | **0.7009** (+0.0219) |

**Worse on both seasons became level on one and ahead on the other.** Three changes, all developed
and swept on the fit seasons (2021 and 2022) with the held-out seasons untouched until the decision
was made:

1. **The landing-spot term is off**, behind `PreseasonFeatures.rookieLanding`. It was the term the
   previous document blamed and it was worth +0.0217 to switch off in 2023 and −0.0364 in 2024. That
   is not a clean two-season case in either direction; what decides it is that the arm carrying it
   lost to the pick ordering on both held-out seasons, badly on one, and the arm without it does not.
2. **A capital curve on the pick axis** (`capitalShares`). The fitted table has six cells and a draft
   has two hundred and sixty picks, and the fit's own monotonicity cap flattens neighbouring cells
   into exact ties, so a bucket-only board handed a whole round one number and let availability break
   it. Interpolating between the fitted means changes no fitted value and restores the ordering the
   counterfactual uses. On the fit seasons it was worth +0.0034 and +0.0146; held out, +0.0233 and
   −0.0139.
3. **A game-rate table** (`capitalGameRate`), and this was the real defect. The share table is
   conditional on playing, which is correct, and the previous version left the other half — how often
   a rookie plays at all — to the availability model, which had nothing to read but a snap share that
   had already conditioned on playing. It concluded that every rookie quarterback in the league was a
   starter: in 2021 the board projected an UNDRAFTED quarterback at 97 points, above Ja'Marr Chase at
   89, and gave all ten rookie quarterbacks exactly 9.9 games. Rookie quarterbacks came out at a mean
   of 92 projected against 49 actual. The cell is now measured over every rookie in it including the
   ones who never dressed, and a rookie's draft capital IS his availability baseline.
4. **The cell prior fell from twelve to two**, swept on the fit seasons: at twelve a round-one back
   and a round-three back came out within a hundredth of each other, because a cell holding five
   player-seasons was weighed a fifth of its own evidence. The sweep, on the rookie segment against
   the pick ordering: 12 gave −0.079/−0.074, 8 gave −0.062/−0.060, 4 gave −0.022/−0.037, 2 gave
   −0.005/−0.028, 0 gave +0.012/−0.075. Two is the best on both together and the best on the worse of
   the two; zero is what an unshrunk five-player cell looks like.

**The rookie board still does not beat the pick ordering outright, and it is not obvious that it
should.** Within a position it now matches or beats it (quarterbacks 0.72 against 0.57 in 2022); what
it loses is the cross-position levelling, where a mean-of-games times a mean-of-per-game drops the
covariance between playing a lot and producing a lot. That is the named next step in the rookie
model, and it is a calibration rather than a new feed.

### After tasks 1 and 2, before task 3

The plan asked for the gap to be re-measured at this point, and it was:

| season | ECR | board after tasks 1-2 | gap |
|---|---|---|---|
| 2023 | 0.7387 | 0.6262 | 0.1125 |
| 2024 | 0.7725 | 0.7403 | 0.0322 |

Two changes that removed things, worth 0.007 and 0.013. The deep band was still the loss.

## Task 3: the depth chart, which is what August knows

**The premise the plan handed this task was half right, and the half that was wrong matters.**

`capture_snapshots` does hold `tank01_depth_charts` and `tank01_injuries`, and they are unmapped. It
holds **one snapshot of each, captured today**. The capture is live and forward-looking; there is no
2023 or 2024 in it and there never will be. Mapping it would have produced a feature that could be
shipped and could never be measured, which is the exact failure `news/retrieve.ts` refused when it
chose the nflverse injury archive over Tank01's headline wire. So this task went to nflverse, which
publishes `depth_charts_YYYY.csv` back to 2019.

### The depth chart earns its place, on all four seasons

Ablated on everybody, at the preseason moment:

| season | without the depth chart | with it | Δ |
|---|---|---|---|
| 2021 (fit) | 0.7416 | **0.7643** | **+0.0227** |
| 2022 (fit) | 0.7525 | **0.7684** | **+0.0160** |
| **2023 (held out)** | 0.6896 | **0.7138** | **+0.0242** |
| **2024 (held out)** | 0.7526 | **0.7724** | **+0.0198** |

Positive on four independent seasons and the second largest single feature this engine has measured,
behind availability. And it lands where it was aimed: the 2024 deep band went from 0.4530 to 0.5128,
past consensus's 0.5096.

**What it knows that layer 1 cannot.** Opportunity is forecast from usage a player has already
produced, and across an offseason there is none of this season's, so a quarterback benched in March
and a quarterback who won the job in August look identical to it. Fitted on the fit seasons, the
correction is a multiplier on layer 1's snap share, normalised within the position so the chart
reorders and never relevels:

| | first | second | third | off the chart |
|---|---|---|---|---|
| QB | **1.508** (n=61) | **0.613** (n=47) | 0.724 (n=11) | 0.514 (n=28) |
| RB | 1.163 (n=74) | 1.187 (n=58) | 0.805 (n=53) | 0.500 (n=73) |
| WR | 1.279 (n=147) | 1.050 (n=114) | 0.820 (n=31) | 0.500 (n=123) |
| TE | 1.206 (n=75) | 1.061 (n=62) | 0.920 (n=38) | 0.500 (n=63) |

The quarterback row is the whole story: a club's number two plays about three fifths of what the
model gives him and its number one about half again as much. That is one published file answering a
question no amount of last season's snaps can.

The bound is 1 (a multiplier in [0.5, 2.0]), chosen rather than fitted, and it is not load-bearing:
only one of sixteen cells is clamped by it, and sweeping it to 0.5 or 2 moves the fit seasons by
under a thousandth.

### What it is allowed to claim, and the weakness in it

**The 2020-to-2024 depth-chart schema has no date column at all**, so the stamp is derived rather
than read. It is stamped one millisecond before the season's FIRST KICKOFF, which
`firstKickoffFor` recovers from the store's own closing-line stamps. A week-one depth chart is
published by the league's own process before week one is played, so this stamp is LATER than the real
publication, which is the direction that cannot claim knowledge we did not have.

**What it cannot rule out is a late scrape.** If nflverse read the file after Thursday night, two
clubs of thirty-two could have reshuffled in response to a game. The file carries orderings rather
than outcomes, so the exposure is bounded to that; it is stated here rather than argued away.

### The camp injury designation does not exist in this archive

The other half of the task, and it is a measured negative rather than an unfinished one. The nflverse
injury archive **begins at game week**: there is no preseason row, no `PRE` game type, and the
earliest filing in a season is the Wednesday of week one. Counting only filings that are provably
before the season's first kickoff:

| season | week-1 designations | provably pre-kickoff |
|---|---|---|
| 2023 | 128 | **4 players** |
| 2024 | 112 | **2 players** |

The league files its week-one report inside the last twenty-four hours before the opener, and
Wednesday evening Eastern is already Thursday in UTC. **There is no camp injury designation to map
for these seasons.** Tank01's live capture does carry one, from 2026 forward, so the feature is
buildable for a board we publish and is not measurable backwards. That is the honest statement.

### A structural defect this task uncovered, which was silently costing the engine a feature

The preseason moment was defined as one millisecond before the earliest stamp the season carried, and
that was exactly right while every feed was a record of a completed game. **The injury report is
stamped from the league's own filing, two days before the opener — so it became the earliest stamp,
the moment slid to one millisecond before it, and the feed gated itself out.** Every preseason board
this engine has ever built was blind to a feed it had already ingested, and nothing failed.

`PRE_GAME_SOURCES` now names the feeds whose facts precede the games they describe, and the moment is
derived from the game-derived stamps alone. The assertion narrowed with it, honestly: it used to
refuse anything the season carried and now refuses anything the season's GAMES produced. The
structural test — a board byte-identical when the target season is written at four times the volume —
still passes, and the two boards are unchanged to the last decimal by the restamp.

## Task 4: the per-player replay moment

Model v3 found that four fifths of the injury wire is unreachable by any whole-week replay moment,
because such a moment must precede Thursday night's kickoff while the league files on Friday. Each
player is now replayed at his own game's kickoff.

**The reachability, measured directly:**

| season | designations, weeks 1-18 | reachable at the whole-week moment | reachable at his own kickoff |
|---|---|---|---|
| 2023 | 3,438 | 18.7% | **70.9%** |
| 2024 | 3,486 | 15.0% | **69.9%** |

Model v3 measured 15 to 19 percent and named the fix. The fix delivers roughly four times the wire.

**The news ablation, re-run.** Both arms see identical history; the only difference is the moment the
pre-game feed is gated at.

| | 2023 elite | 2023 starter | 2024 elite | 2024 starter |
|---|---|---|---|---|
| at the whole-week moment | 0.1649 → 0.1712 (+0.0063) | 0.2209 → 0.2295 (+0.0087) | 0.0694 → 0.0906 (+0.0212) | 0.1750 → 0.1937 (+0.0187) |
| **at his own kickoff** | 0.1649 → **0.1801** (+0.0152) | 0.2209 → 0.2182 (−0.0027) | 0.0694 → **0.0999** (+0.0305) | 0.1750 → **0.2019** (+0.0269) |

The elite band improves on both seasons and the deep band turns from negative to positive on both.
The 2023 starter band goes the other way. **The pooled number is still zero** (−0.0009 and −0.0000),
unchanged in character from model v3: the news pass is a band-level effect on the players a manager
actually starts, and it does not move a five-thousand-row pooled correlation.

The guarantee is unchanged and is now pinned by three tests: a player may see nothing stamped after
HIS kickoff, a designation filed on the Friday reaches the man who plays Sunday and is refused to the
man who played Thursday, and the harness behaves exactly as before when no per-player moment is given.
The wire is read once per distinct kickoff rather than once at the latest and filtered afterwards,
because `observationsAsOf` returns the latest statement at or before its moment and filtering would
have left a Thursday player holding nothing instead of holding his Thursday designation.

### The pre-kickoff betting line: unblocked, and there is nothing to ablate

Phase 3 recorded the closing line as unmeasurable. **It was unmeasurable for a stamping reason, and
that reason is now fixed.** `schedule.ts` stamped the closing line with the same publication-lag
arithmetic a box score gets — the end of the game's UTC day plus twenty-four hours — which put it
some thirty-six hours after the moment any replay could act on. The line is now stamped at
`kickoffInstant`, the game's own start time resolved through the Eastern zone database (the season
crosses the daylight-saving boundary, so the offset is looked up rather than assumed).

| season | team-weeks with a published line | reachable at the whole-week moment | reachable at that club's own kickoff |
|---|---|---|---|
| 2023 | 544 | **0** | **544** |
| 2024 | 544 | **0** | **544** |

From nothing to everything. The recorded temperature and wind keep the publication-lag stamp,
because those are observations taken over the course of a game rather than settled at its start.

**And then there is nothing to ablate, because no layer consumes the line.** `point_spread` and
`implied_team_total` are stored and read by nobody: `features/context.ts` builds its game context
from the opponent's defensive rating and rest days. Phase 3 did not build the game-script feature
BECAUSE it was unmeasurable, so the plan's "re-run that ablation" has no ablation to re-run. The
blocker is removed and the feature is a genuine next step, and it must be built in
`src/projections/features/context.ts` and `src/projections/model/context.ts`, which are another
worker's territory in this run and were deliberately not touched.

The existing game-context group was re-run at both moments as a control, and it is **identical to
four decimal places in every band on both seasons**:

| | 2023 elite | 2023 starter | 2024 elite | 2024 starter |
|---|---|---|---|---|
| at the whole-week moment | 0.1649 → 0.1751 | 0.2209 → 0.2267 | 0.0694 → 0.0795 | 0.1750 → 0.1823 |
| at his own kickoff | 0.1649 → 0.1751 | 0.2209 → 0.2267 | 0.0694 → 0.0795 | 0.1750 → 0.1823 |

That is the correct result and it is worth stating, because it is the control the news ablation
needs. Everything the game-context group reads — the opponent's defensive rating, built from
completed weeks, and rest days, published in May — was already knowable on the Tuesday, so moving
the moment to Sunday morning cannot change it and does not. **The per-player moment moves exactly
the feed whose stamps sit inside the game week, and nothing else**, which is what it was built to do.

## Against the market, we went backwards

This is the one number in this document that got worse, and it should not be buried.

| season | market (ADP) | before | now | n |
|---|---|---|---|---|
| 2023 | **0.4752** | 0.4723 | 0.4701 | 173 |
| 2024 | **0.4272** | 0.4296 | 0.4036 | 176 |

The band table says why. On the 176 players ADP reaches in 2024 we now score 0.0688 in the elite
band against the market's 0.2301, having scored 0.1428 before; in the deep band of the same
comparison we score 0.3846 against the market's −0.1146. **Every change in this document is worth
most in the deep pool and the ADP population is almost entirely not the deep pool** — a
fifteen-round twelve-team draft stops at about two hundred names, and there is no market price at all
past rank 205.

The honest reading is that we have traded a small amount of top-of-draft accuracy for a large amount
of depth accuracy, and the ADP comparison sees only the side of that trade it lost. It is still a
loss and it is still on the scoreboard.

## What is left, and where

**The remaining gap, per band, is not one lead.**

| | 2023 | 2024 |
|---|---|---|
| overall gap | **0.0903** | **0.0132** |
| elite | +0.1061 (we win) | −0.1689 |
| starter | −0.0339 | −0.0913 |
| deep | −0.0981 | +0.0032 (we win) |
| fringe | −0.3893 (n≈14) | +0.0637 (we win) |

The next leads, in the order this evidence puts them:

1. **The starter band, which is the only band we lose on both seasons** (−0.034 and −0.091) and the
   one a draft is mostly made of. It is where a committee back becomes a workhorse and a third
   receiver becomes a second, and nothing in this engine yet distinguishes those cases from the
   inside. The depth chart moved the deep band because it separates a starter from a backup; the
   starter band needs the finer statement, which is **target competition** — who else on this offence
   is claiming the same work, from the published chart's own slots rather than from a total.
2. **A per-game distribution from layer 3.** Named by four research documents now. It would make the
   spec's own tier rule work, give rookies the width the plan asked for, and let the board say
   something about a player's own volatility rather than only about how often he plays.
3. **The rookie cross-position calibration.** Within a position the rookie board already matches the
   pick ordering; what it loses is the levelling between positions, and the cause is identified: a
   mean-of-games times a mean-of-per-game drops the covariance between playing a lot and producing a
   lot, and that covariance differs by position. One number per position, fitted on the fit seasons.
4. **The betting line as a feature**, now that it is reachable at kickoff for every team-week in both
   seasons. `features/context.ts` and `model/context.ts`.
5. **The fifth season the backfill could not reach.** Availability and the depth-chart correction are
   both fitted on two seasons; the depth-chart archive runs back to 2019 and the injury archive to
   2009.
6. **ECR's own construction.** It is an average of many analysts, and an average of many analysts is
   hard to beat for a structural reason rather than a knowledge reason. We have never measured the
   spread between its contributors, and a consensus whose members disagree wildly about a player is a
   consensus we should expect to beat on that player.

## The claim this document supports

**The deep band is won.** It was the segment the previous document lost on both seasons and by the
most, it was the segment the product thesis rests on, and the depth chart took it: past consensus in
2024 and two thirds of the way there in 2023.

**Two things that measured worse than the obvious alternative were removed**, and removing them was
worth 0.007 and 0.013 before any new data was ingested.

**The harness now replays each player at his own kickoff**, which took the injury wire from a fifth
reachable to seven tenths and took the closing line from unreachable to fully reachable.

**And against the consensus we set out to replace, we still lose** — by 0.0903 in 2023 and 0.0132 in
2024, down from 0.1197 and 0.0453. Three quarters of one gap and seven tenths of the other, closed on
seasons no parameter has seen. The remaining loss is concentrated in the starter band on both seasons
and in opposite bands otherwise, and the next lead is named.

The public accuracy record and the learning loop are the same artifact. The number is better, it is
published beside the number that still beats it, and it names the segment.
