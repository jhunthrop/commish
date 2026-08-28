# The starter band, and the market: a diagnosis first, then one change that earned its place

**Measured 2026-08-28.** Reproduce with `npm run projections:backfill 2020 2024`,
`npm run projections:context 2016 2024`, `npm run projections:preseason:ingest 2021 2024`,
`npm run projections:preseason:fit`, then `npm run projections:preseason` and
`npm run projections:preseason:diagnose`.
Code: `src/projections/preseason/career.ts`, `src/projections/preseason/availability.ts`,
`src/projections/preseason/fit.ts`, `scripts/preseason-diagnose.ts`.
Previous: `docs/research/2026-08-28-beating-consensus.md`.

The previous document named two honest losses and left them on the scoreboard. The starter band
(ranks 51 to 150) was the only band the board lost on both held-out seasons, and against the market
we had gone BACKWARDS. This document diagnoses both before changing anything, reports one
diagnosis that turned out to be an artifact of its own measurement, ships one change, and leaves a
second one in as a correctness fix that measured at zero.

## The headline

| | 2023 | 2024 |
|---|---|---|
| expert consensus (ECR) | 0.7387 | 0.7725 |
| our board, previous document | 0.6484 | 0.7593 |
| **our board, now** | **0.6659** | **0.7598** |
| gap, before | 0.0903 | 0.0132 |
| **gap, now** | **0.0728** | **0.0127** |

Against the real market, Fantasy Football Calculator's twelve-team PPR average draft position:

| | 2023 | 2024 |
|---|---|---|
| market (ADP) | 0.4752 | **0.4272** |
| our board, previous document | 0.4701 | 0.4036 |
| **our board, now** | **0.4759** | 0.4186 |

**We beat the market in 2023 and we still lose it in 2024**, by 0.0086 where the previous document
lost by 0.0236. The direction is reversed: the last document went backwards against ADP on both
seasons and this one goes forwards on both.

And the band the whole document is about, banded by the benchmark's own rank:

| starter band (51-150) | 2023 | 2024 |
|---|---|---|
| ECR | 0.2648 | 0.3303 |
| ours, previous document | 0.2309 | 0.2390 |
| **ours, now** | **0.2485** | **0.2685** |
| gap | −0.0163 (was −0.0339) | −0.0618 (was −0.0913) |

**The starter band improves on both held-out seasons and is still lost on both.** Half of one
deficit and a third of the other.

## 1. Is the band real, or is it the banding?

The brief for this work asked this first and it was right to. A band cut by the BENCHMARK'S own rank
selects on the benchmark's predictor, which is textbook range restriction — and it does not restrict
the two arms equally, so it is not obviously a fair fight in either direction.

The theory says the cut FLATTERS US rather than the reverse. Selecting on ECR truncates ECR's own
variance inside the band while ours is truncated only through our correlation with it; in the limit
of a razor-thin band ECR's within-band correlation goes to zero and ours goes to the partial
correlation, which is generally positive. A loss under this cut is therefore worse than it looks,
not better.

So `scripts/preseason-diagnose.ts` cuts the identical population four ways. Each cell reads
`ECR rho / our rho = our margin`:

**2024**, 479 players both sources ranked:

| cut | elite | starter | deep | fringe |
|---|---|---|---|---|
| by ECR's own rank | −0.1867 | **−0.0619** | −0.0058 | +0.0569 |
| by our own rank | −0.2188 | **−0.2262** | −0.0842 | +0.0324 |
| symmetric (mean of the two ranks) | −0.1873 | **−0.1707** | −0.0316 | +0.1601 |
| by a third party (ADP, 176 priced) | −0.1225 | **−0.1195** | — | — |

**2023**, 414 players:

| cut | elite | starter | deep | fringe |
|---|---|---|---|---|
| by ECR's own rank | +0.0696 | **−0.0163** | −0.0702 | −0.4879 |
| by our own rank | −0.0295 | **−0.1387** | −0.1556 | +0.3134 |
| symmetric | +0.0791 | **−0.1701** | −0.1641 | +0.1078 |
| by a third party (ADP, 171 priced) | +0.0809 | **+0.0895** | — | — |

**The starter-band loss survives every cut that is not the market's own.** It survives the cut that
disadvantages US (our own rank), which is the one that would expose it as an artifact, and it is
LARGER under the symmetric cut than under either one-sided one. Only the third-party cut splits, and
it splits by season.

The pre-change board gave the same answer on the three source-based cuts — 2023 at −0.0339, −0.0222
and −0.2621, and 2024 at −0.0913, −0.0788 and −0.2007 — so the conclusion is not a property of what
shipped since.

**Range restriction is real and it is not the explanation.** The outcome's spread inside the band is
80 points against 92 over the whole population, so the band is only mildly restricted in the
quantity being predicted; what is heavily restricted is the PREDICTOR, and restricting ours hurts us
more than restricting theirs hurts them. That is the interesting part of the symmetric result: under
a cut that truncates both arms, ECR keeps 0.38 and 0.25 and we fall to 0.21 and 0.08. Where we
deviate from consensus in the middle of the board, the deviation was mostly wrong.

## 2. Which half of the product is wrong

A board's projection is expected games times per-game points. Replacing each half with the truth
bounds the problem, and neither arm is a proposal — nobody knows a player's games in August.

Starter band, cut by ECR's rank, on the board as it stood:

| | 2023 | 2024 |
|---|---|---|
| ECR, the arm to beat | 0.2648 | 0.3303 |
| the board | 0.2309 | 0.2390 |
| **oracle games x our rate** | 0.6067 | 0.5726 |
| **our games x oracle rate** | **0.7902** | **0.8232** |
| per-game rate alone | 0.2481 | 0.2876 |
| expected games alone | 0.1000 | −0.0525 |

**The per-game rate is the bigger half, on both seasons.** A perfect games model with our rate
reaches 0.57 to 0.61; our games model with a perfect rate reaches 0.79 to 0.82. Both oracles carry
outcome information and neither number is achievable, but the ORDER of the two is the finding, and
it pointed the work at the rate rather than at availability.

The second row worth reading is the last one. **Expected games alone is uncorrelated to negatively
correlated with outcome inside the top bands**, on both seasons. Availability is the largest single
feature this engine has measured and at the top of the board it carries no ordering information at
all — which is exactly what it should do if it is working, since among established starters almost
everybody is expected to play almost everything.

## 3. A diagnosis that was wrong, reported because it was nearly shipped

The first pass at cell-by-cell calibration found what looked like the sharpest defect in the model:
players whose club filed them under a reserve list at cutdown were projected at 2.1 games and played
5.2 to 7.1, on all four seasons. It named real players — Alvin Kamara at 2.5 expected games in 2023
against 13 played, Jonathan Taylor at 2.6 against 10, DeAndre Hopkins at 2.4 in 2022 against 9 —
and it had a mechanism to blame, which is section 4 below.

**It was an artifact of the measurement.** The population was board players WITH A STAT LINE, and a
man on injured reserve who never dressed has no stat line and drops out. The cell was being scored
on the subset of it that recovered. Re-measured over every man the board projects with the absent
ones at zero — the discipline `news/adjust.ts` already writes down for exactly this reason — the
reserve cell comes out at −0.49, +0.30, −0.22 and −0.53 games across the four seasons. **It is one of
the best-calibrated cells in the model.**

Recorded here in full because it would have shipped a feature that fixed nothing, and because the
same selection is available to anybody who measures a games model on the men who played.

## 4. The availability fit was measuring against a quantity it does not multiply — SHIPPED, and it measured at zero

The mechanism the artifact pointed at is a real defect, independently of the number that led to it.

`expectedGamesPlayed` builds a rate by blending a role prior with the player's own record and then
multiplies by a cutdown-status factor. `fitStatusMultipliers` computed that factor as the group's
actual availability over its BASELINE — the role-and-age prior, before any blending. Fitting a ratio
against one quantity and applying it to another is not a correction, and the two differ most for the
population that matters: a club does not put a camp body on a reserve list in week one, it puts a
starter there, and a starter's record pulls his blended rate well above his role cell.

The age multiplier had the mirror-image problem in the other direction — fitted against the prior
and applied to the prior, but the prior is then diluted by a record that carries the age signal
straight back in, because an old player's record is a run of full seasons and a young player's is a
rookie year spent behind somebody.

Both are now fitted against `shrunkAvailabilityRate`, the number they multiply, and both are refitted
INSIDE the shrinkage grid, because the quantity they correct is what that grid decides.

**And it measured at zero.** Held out, against the previous document's board:

| | 2023 | 2024 |
|---|---|---|
| consensus population | 0.6484 → 0.6489 | 0.7593 → 0.7594 |
| market population | 0.4701 → 0.4697 | 0.4036 → 0.3992 |
| starter band | 0.2309 → 0.2339 | 0.2390 → 0.2290 |

Between −0.0044 and +0.0030 on six comparisons, in both directions. **It ships as a correctness fix
and is claimed as nothing else.** The parameters barely moved — the reserve multiplier from 0.198 to
0.207, the recency decay from 0.6 to 0.7 — which is itself the evidence that the mismatch was not
where the board's error lives. It is kept because a fitted parameter whose docblock describes a
different quantity from the one it estimates is a trap for the next person, not because it helped.

The residual age gradient it did NOT remove is real and is left named: across four seasons the games
model gives players of 24 and under 0.6 to 1.3 fewer games than they play and players of 29 and over
0.6 to 1.6 more, and it gives a man who played sixteen or more games last year 1.2 to 1.7 more than
he plays. The shrinkage does not regress hard enough on last season's availability. That is a
one-game effect on seventeen and it is a lead, not a defect that was fixed here.

## 5. The career-stage curve — SHIPPED

This is the change that moved the band.

### The defect, on four seasons

Projected points per game against what a man actually scored per game, by seasons in the league:

| season in the league | 2021 | 2022 | 2023 | 2024 |
|---|---|---|---|---|
| 1 (rookie) | 0.86 | 0.85 | **0.73** | 0.87 |
| 2 | 0.92 | 1.03 | 0.91 | 0.97 |
| 3 | 1.10 | 1.10 | 1.23 | 1.10 |
| 4 to 6 | 1.05 | 1.14 | 1.23 | 1.13 |
| 7 and up | **1.16** | **1.16** | **1.25** | **1.13** |

**Monotone increasing on every season, with no crossings.** The board under-projects young players
and over-projects old ones, by about thirty per cent end to end. This table conditions on having
played six games, which selects the successful members of every cohort and pushes every ratio DOWN —
so the veteran over-projection is understated by it and the rookie figure is the one the selection
could explain. The fit below uses the unconditioned population instead.

The market's own residual says the same thing from the other side. Mean signed rank residual inside
the ADP-priced population, where positive means "ranked worse than he finished":

| | 2021 | 2022 | 2023 | 2024 |
|---|---|---|---|---|
| age 24 and under — market | +7.1 | −1.5 | +6.3 | +7.3 |
| age 24 and under — **ours** | **+27.5** | **+9.6** | **+23.2** | **+30.5** |
| age 29 and over — market | +14.4 | +4.4 | +12.3 | −1.3 |
| age 29 and over — **ours** | **−12.0** | **−9.6** | **−2.0** | **−20.0** |

Two independent measurements, four seasons each, agreeing on the sign.

### Why nothing below it can see this

The test model v3 set for a feature is that it must separate players by a quantity the layers below
have not already used. Every rate and every share this engine emits is a shrinkage of a player's own
past toward a population mean. That is the right estimator for a stationary quantity and a career is
not stationary: a second-year receiver's rookie tape understates the player he now is, and a
thirty-two-year-old back's three good seasons overstate the player he now is. The shrinkage is
symmetric and the truth is not, so the error is signed — and it is signed the same way for everybody
at the same stage. **No amount of a player's own history can correct it, because his own history is
the thing that has gone stale.**

### The mechanism

One multiplier on the composed per-game line, per position and experience band, **normalised within
the position** so it reorders and never relevels — the depth chart's own pattern, for the depth
chart's own reason. Fitted on 2021 and 2022 only, over every man the board projects with the absent
ones scoring zero, as a ratio of totals rather than a mean of ratios.

|  | year 1 | year 2 | year 3 | year 4-6 | year 7+ |
|---|---|---|---|---|---|
| QB | 0.966 (n=25) | 1.037 (n=17) | 0.982 (n=18) | 1.004 (n=49) | 0.996 (n=63) |
| RB | **1.350** (n=77) | 0.937 (n=57) | 0.938 (n=47) | 0.981 (n=113) | 0.933 (n=41) |
| WR | **1.350** (n=122) | 1.127 (n=80) | 1.002 (n=74) | 0.948 (n=171) | 0.899 (n=90) |
| TE | **1.350** (n=73) | 1.041 (n=36) | 1.040 (n=40) | 0.991 (n=103) | 0.876 (n=59) |

**The bound is load-bearing and that is a weakness, stated rather than argued away.** Three of the
four year-one cells are clamped at it. The bound was swept on the fit seasons, on the starter band,
and 0.35 was chosen by the rule the rookie cell prior was chosen by — best on both and best on the
worse of the two:

| bound | 2021 starter | 2022 starter |
|---|---|---|
| 0.20 | +0.0115 | +0.0099 |
| **0.35** | **+0.0314** | **+0.0240** |
| 0.60 | +0.0632 | +0.0008 |
| unbounded | +0.0632 | +0.0008 |

The quarterback row is the control. It is the one position whose rookies were already corrected —
`capitalGameRate` fixed them in the previous document — and it is the one row that comes out flat.
A table that had been fitting noise would not have known that.

### What it measured, held out

On top of the availability fix, on seasons no parameter has seen:

| | 2023 | 2024 |
|---|---|---|
| **starter band (by ECR's rank)** | 0.2339 → **0.2485** | 0.2290 → **0.2685** |
| market population, overall | 0.4697 → **0.4759** | 0.3992 → **0.4186** |
| consensus population, overall | 0.6489 → **0.6659** | 0.7594 → **0.7598** |
| **the whole board, pooled** | 0.7146 → **0.7263** | 0.7724 → **0.7723** |

**Three of the four are positive on both seasons and the fourth is +0.0117 and −0.0001.** The
targeted band is up by 0.015 and 0.040, which is the first two-season movement the starter band has
had. The elite, deep and fringe bands are mixed and are not claimed.

**It ships, and the pooled 2024 no-op is the honest headline beside the good one.** By the gate model
v3 applied to the news pass — pooled DOWN on both seasons, so it ships off — this passes, and it
passes with less room than the depth chart had. It is a band-level effect on the players a manager
actually drafts, exactly as the news pass was, and unlike the news pass it does not cost the pooled
figure anything.

### The mechanism moved, not just the score

The check that this is a correction rather than a coincidence: the bias it was built to remove
shrinks on the two seasons the fit never saw.

| | 2023 before → after | 2024 before → after |
|---|---|---|
| year 1, projected over actual per game | 0.734 → **0.925** | 0.867 → **1.102** |
| year 7+, projected over actual per game | 1.247 → **1.152** | 1.126 → **1.041** |
| rookie rank residual against the market | +46.5 → **+37.2** | +52.7 → **+46.2** |
| age 24 and under, rank residual | +23.2 → **+15.9** | +30.5 → **+23.5** |
| age 29 and over, rank residual | −2.0 → +4.0 | −20.0 → **−11.8** |

Every one narrows. The 2024 rookie cell overshoots to 1.102, which is the clamp working in the wrong
direction on one season, and it is the first thing to look at next.

## 6. A second leakage defect, found by audit — FIXED, and it was inert

The brief said to assume another one exists until it has been checked. One does.

The preseason moment is one millisecond before the earliest GAME-DERIVED stamp the season carries. A
box score is stamped a day and a half after its game, so on every season the moment lands on the
SATURDAY of week one — and the previous document restamped the closing line at kickoff, which is
Thursday night. **Every preseason board this engine builds can therefore see the opener's two closing
lines**, and the module docblock has always said in bold that it cannot.

Nothing reads them: `features/context.ts` builds its game context from the opponent's defensive
rating and rest days, and `gameContext` is off on the preseason board anyway. So nothing failed —
which is precisely the state the injury feed was in when it silently gated itself out of every board
this engine had ever built, and the betting line is named in the previous document as the next
feature this board should grow.

The refusal is now BY SOURCE rather than by arithmetic on the moment: `loadPreseason` drops
`nflverse_kickoff` rows for the target season. A test seeds a kickoff-stamped line inside the gate,
asserts it really is inside the gate, and asserts the board does not receive it while the
May-stamped schedule fact still arrives. The boards are unchanged to four decimal places, because
nothing was consuming it.

## 7. Against the market: where it is wrong, and where it only looks wrong

The market's largest systematic bias is enormous, four-season consistent, and **not an error**. Mean
signed rank residual by position, inside the priced population:

| | 2021 | 2022 | 2023 | 2024 |
|---|---|---|---|---|
| QB — market | +57.3 | +39.3 | +37.2 | +52.0 |
| RB — market | −22.6 | −15.5 | −9.3 | −14.5 |

The market ranks quarterbacks some forty to fifty places below where they finish and running backs
ten to twenty above. That is not the market being wrong about football; **it is the market answering
a different question.** An average draft position is a price, and a price is about what a pick is
WORTH, which is value over replacement — the same distinction this board made when it stopped
ordering by VOR and started ordering by points. Scoring ADP against season points penalises it for
being correctly scarcity-aware. It is the single biggest thing in the ADP comparison and it is not
exploitable, and a strategy built on "the market is wrong about quarterbacks" would have been built
on a measurement error.

**What was exploitable was our own bias, not theirs.** On the career axis both sources are
pessimistic about young players and the market is pessimistic by a third as much as we were; on old
players the market is roughly neutral and we were optimistic. Closing our own gap on that axis is
what moved the market population by +0.0062 and +0.0194 and flipped 2023 from a loss to a win. We did
not find a market inefficiency; we found ours.

The remaining 2024 deficit of 0.0086 is almost entirely the elite band, where we score 0.0616 against
the market's 0.2301 on the same 176 players. The board's top fifty is now the worst band it has, on
both benchmarks, in 2024 and not in 2023.

## What is left, in the order this evidence puts it

1. **The elite band in 2024.** It is now the largest single deficit on the board (−0.1867 against
   ECR, −0.1685 against ADP) and it is the whole of the remaining market loss. It was a WIN in 2023
   (+0.0696), so it has never been a two-season finding and it has now survived four looks.
2. **The year-one clamp.** Three of four year-one cells sit on the bound and 2024 overshoots to
   1.102. The honest next step is not a wider bound, it is separating what the rookie table already
   knows from what the career curve is adding, because the two are correcting the same players.
3. **The availability shrinkage.** Four seasons of a 1.2-to-1.7-game over-projection for men who
   played sixteen or more last year, and a 0.6-to-1.3-game under-projection for players of 24 and
   under. The prior of 25 team-games leaves 57 per cent of the weight on a record that is barely
   autocorrelated year to year.
4. **Target competition**, still the lead the previous document named for the starter band and still
   unbuilt: who else on this offence is claiming the same work, from the published chart's own slots.
   The career curve moved this band without it.
5. **The betting line as a feature.** Reachable at kickoff for every team-week, and now safely
   refused by the preseason board rather than accidentally visible to it.

## The claim this document supports

**The starter-band loss is real and it is not a range-restriction artifact.** It survives every cut
that treats the two arms alike and is largest under the symmetric one.

**The board's per-game rate is stale in one direction along a career**, on four independent seasons
and on two independent measurements, and no amount of a player's own history can fix it because his
own history is the stale thing.

**One correction for it improves the starter band on both held-out seasons**, by 0.015 and 0.040,
takes the market comparison forwards on both after a document that took it backwards on both, and
does nothing at all to the pooled 2024 figure.

**And against consensus we still lose**, by 0.0728 and 0.0127. One diagnosis in this document was an
artifact of its own measurement and is written up as one. One change measured at zero and is shipped
as a correctness fix claiming nothing. One leakage defect was inert and is closed anyway.
