# The preseason board, against the market and against the experts

**Measured 2026-08-28.** Reproduce with `npm run projections:backfill 2020 2024`,
`npm run projections:context 2016 2024`, `npm run projections:preseason:ingest 2021 2024`,
`npm run projections:preseason:fit`, then `npm run projections:preseason`.
Code: `src/projections/preseason/**`, `scripts/preseason-*.ts`.
Plan: `docs/superpowers/plans/2026-08-27-projection-engine-phase6-preseason-board.md`.
Previous: `docs/research/2026-08-27-model-v2.md`, `docs/research/2026-08-27-decision-quality.md`.

Model v1 said it plainly and model v2 repeated it: **the engine adds nothing before kickoff of week
1**. Every technique in Phases 2 and 3 leans on usage the player has already produced, and in August
there is none. This phase built the board that runs on different fuel, and measured it against the
two things it has to beat.

## The headline, and it is a loss

**Expert consensus beats our board on both held-out seasons.**

Rank correlation against actual season points, like for like on the players both sources ranked, in
a twelve-team PPR league. FantasyPros' archived preseason board against ours:

| season | expert consensus | our board (points) | our board (value over replacement) | n |
|---|---|---|---|---|
| 2023 | **0.7387** | 0.6190 | 0.5915 | 414 |
| 2024 | **0.7725** | 0.7272 | 0.6982 | 479 |

We lose by 0.120 in 2023 and 0.045 in 2024. The gap narrows but it does not close, and no
configuration of this board beats consensus on either season.

**The segment we lost is the deep band, and it is the one the spec expected to win.** Banded by the
benchmark's own rank, which is the exact comparison this engine has been unable to make until now:

| band | 2023 ECR | 2023 ours | Δ | 2024 ECR | 2024 ours | Δ |
|---|---|---|---|---|---|---|
| elite (1-50) | 0.2878 | **0.3263** | **+0.0385** | 0.2503 | 0.1698 | −0.0805 |
| starter (51-150) | 0.2648 | **0.2672** | +0.0024 | 0.3303 | 0.2749 | −0.0554 |
| **deep (151-400)** | 0.5206 | 0.3556 | **−0.1650** | 0.5096 | 0.4530 | **−0.0566** |
| fringe (401+) | 0.1473 | 0.1341 | −0.0132 | 0.3076 | 0.2904 | −0.0172 |

The deep band is the only band we lose on **both** seasons, and it is where we lose by the most. The
engine spec wrote that "human analyst attention runs out in the deep pool, and that is where leagues
are won", and model v1 and v2 both delivered on that expectation in-season. **In the preseason it is
the reverse: the experts are better than us at exactly the depth we claimed as our edge.** That is
the finding this document exists to record.

## Against the market, we are level

Fantasy Football Calculator's twelve-team PPR average draft position, drawn from real drafts run in
the last days of August and dated by the publisher:

| season | market (ADP) | our board (points) | our board (VOR) | n |
|---|---|---|---|---|
| 2023 | 0.4752 | 0.4723 | 0.4325 | 173 |
| 2024 | 0.4272 | **0.4296** | 0.3640 | 176 |

Behind by 0.003 on one season and ahead by 0.002 on the other. **That is a tie, and it should be
read as a tie rather than as half a win.**

It is a tie over a much shallower population than the consensus comparison, and the reason matters.
The market's board is fifteen rounds of a twelve-team draft, so it stops at about two hundred names
and there is no market price at all past rank 205. The deep band of an ADP comparison is therefore
roughly twenty-five players, and it behaves like a sample of twenty-five: we lose it by 0.68 in 2023
and win it by 0.55 in 2024. **Opposite signs, and by this engine's own two-season rule that is not a
finding in either direction.**

## Availability is the result of the phase

Expected games played, ablated against a board that assumes seventeen games for everybody, which is
what a site publishing season points with no games column is doing:

| season | 17 games for everyone | expected games | Δ | n |
|---|---|---|---|---|
| 2023 | 0.6408 | **0.6559** | **+0.0151** | 519 |
| 2024 | 0.6573 | **0.7075** | **+0.0502** | 525 |

Positive on two independent seasons, and **larger than any single feature group Phase 3 measured**.
Phase 3's four groups moved the pooled number by 0.000 to 0.003; this moves it by 0.015 and 0.050.

Phase 3's own recorded lesson predicted this: three of its four groups were team-level multipliers
that move a whole offence together and can barely reorder a ranking, and it wrote down that "the
features that will move this scoreboard are the ones that separate teammates from each other."
Availability separates teammates. It is the cheapest large win the plan said it would be.

**The role table is the load-bearing part, and the first two versions of it were wrong.** The
population a board projects is every man on a week-one roster, and at quarterback that is three per
club of whom one plays. Fitted on position and age alone the quarterback cell comes out at 0.42 of a
season, which is the truth about a randomly chosen rostered quarterback and a catastrophic lie about
the starter: it projected a man who had played every game for three years at thirteen. The first fix
was a linear term in layer 1's predicted snap share and it barely helped, because a slope fitted on
a share that has already been shrunk is attenuated by that shrinkage. The shipped version brackets
the role instead, which reproduces each group's own mean and cannot be attenuated by the regression
in its own input. A test now pins that a full-time starter with three clean seasons projects above
twelve games at every position.

The model still regresses hard, which is deliberate: twelve games of difference in a player's record
moves his projection by under six. Because a board is a ranking, a uniformly conservative games term
costs nothing — only the differences between players are read.

### The distribution, and what it does not cover

Games played is the first quantity in this engine that emits a real distribution rather than a point
estimate. It is an exact beta-binomial over the eighteen possible game counts, so a floor is a
number the model actually believes rather than a normal approximation putting mass on nineteen games
and on minus two. The fitted overdispersion is 1.87, which is a spread of about four games around a
typical starter — more than twice what a binomial would say, which is right, because one torn
ligament costs eight weeks at once.

**The fit found NO narrowing with length of record: 0.00 additional concentration per prior season.**
The plan asked for a rookie's distribution to be wider than a veteran's and the mechanism is present
and measured at zero. The honest reading is that games-played dispersion is dominated by things a
playing record does not predict. A rookie's genuine extra uncertainty is in how good he is, not in
how often he plays, and that is a per-game distribution this engine still does not emit.

## The offseason delta earns almost nothing

Judged on the segment it targets — the players who moved and their teammates on both ends:

| season | without the offseason log | with it | Δ | n |
|---|---|---|---|---|
| 2023 | 0.7081 | 0.7086 | +0.0004 | 427 |
| 2024 | 0.7248 | 0.7258 | +0.0011 | 434 |

The right sign twice and a thousandth of a point both times.

Phase 3 measured redistribution as not earning its place in season and diagnosed that layer 1's
shrinkage was already doing the job. Preseason was expected to be a different test, because there is
no in-season usage to shrink toward — every share a board projects comes from a season in which the
departed player was still there. **The different test gives the same answer.** The mechanism is
correct (the specification cases pass: a receiver whose team lost its primary target gains, a back
signing behind an entrenched starter takes work off him, a club that lost one man and signed another
nets out) and the effect is not measurable.

It ships regardless, and the reason is not accuracy. It composes machinery that already exists over
a transaction log the board ingests anyway, so it is free, and the reasons it attaches — 153
players changed team in 2023, 276 gained share, 159 lost it, 139 landed under a new play-caller —
are the explanation surface, which is the product.

**Worth recording: this is the transaction wire model v2 named as the bound on its whole
redistribution result.** "Every number above is bounded by the fact that this engine learns of a
trade one Sunday late." It now learns of an offseason move in late August, before the season, and
the effect is still a thousandth. The bound was not what was holding the feature back.

## Rookies are ordered worse than by draft pick alone

The honest counterfactual for a rookie model is not "no rookies" — it is what a board would do
instead, which is rank the class by draft capital. Judged on the rookie segment:

| season | draft capital alone | our rookie model | Δ | n |
|---|---|---|---|---|
| 2023 | **0.6374** | 0.3733 | **−0.2641** | 92 |
| 2024 | **0.6790** | 0.6459 | **−0.0331** | 91 |

**Worse on both held-out seasons, badly so on one.** The draft-capital table itself is monotone by
construction and is not the problem; the landing-spot term is. It is bounded to half in either
direction and it is enough to move a first-round pick below a third-round one, and on this evidence
that reordering destroys more information than it adds.

The plan asked for landing spot to matter. It matters, in the wrong direction.

It ships anyway, and this is the one flag in the engine that ships on a negative number. Switching
the group off does not fall back to a draft-capital ordering — it removes the entire rookie class
from the board, because `modelProjection` cannot emit a line for a player with no usage history. A
board a manager cannot draft a first-round back from is not usable at any accuracy. **Rookies are on
the board and they are ordered badly**, and the fix named below is to be measured on the fit seasons
before 2023 and 2024 are looked at again.

## Value over replacement is worse than points, again

Phase 5 found that drafting by highest value over replacement beat nothing, and that a plain points
ranking beat it every time. That was a result about a strategy. This is the same result about a
board:

| season | ranked by value over replacement | ranked by points | Δ |
|---|---|---|---|
| 2023 | 0.6559 | **0.6839** | +0.0280 |
| 2024 | 0.7075 | **0.7385** | +0.0310 |

And in every band except one, on both seasons. The same ordering holds against both published
benchmarks: our points ranking scores above our value ranking against ADP and against ECR, on both
seasons, in every band.

**This does not make replacement level wrong.** The quarterback-versus-back argument is right, the
test in `replacement.test.ts` is right, and a board that ranks a quarterback first because he scores
most is not a draft board. What the measurement says is that **value over replacement amplifies
board error**: it subtracts a replacement level estimated from the same noisy projections and then
re-ranks aggressively across positions, and a points ranking does neither. Phase 5 predicted exactly
this ("value over replacement *amplifies* board error rather than absorbing it") and named a better
board as the test. The board got better and the amplification did not go away.

The board ships ranked by value over replacement, because that is what a draft board is and the plan
required it. This number is published beside it.

## The tier rule the spec wrote down does not work yet

The engine spec's layer 6: "a cliff is where the gap exceeds the overlap, not a hand-drawn line."
`decide/tiers.ts` could not implement it and said so, because nothing emitted a distribution. This
board does, so it was implemented.

| position | players (2024) | gap rule | the spec's overlap rule |
|---|---|---|---|
| QB | 92 | 21 tiers | **1 tier** |
| RB | 155 | 47 tiers | **1 tier** |
| WR | 265 | 84 tiers | **1 tier** |
| TE | 141 | 48 tiers | **1 tier** |

2023 is identical but for one position (tight end, two tiers).

**The rule finds no cliffs at all**, and the reason is arithmetic rather than a bug. The only
distribution the engine emits is availability; its tenth-to-ninetieth span is about a sixth of a
player's season; and on a board carrying two hundred and sixty-five receivers the gap between
adjacent men is a fraction of that. Two adjacent players are genuinely indistinguishable given what
we can currently say about them, and the rule correctly says so. It becomes usable the day layer 3
emits a per-game distribution, because the interval will then be about how good he is rather than
only about how often he plays.

The board therefore ships `decide/tiers.ts`' gap rule, which compares a gap to the position's own
typical gap. Eighty-four tiers among two hundred and sixty-five receivers is too many to be useful
either, and neither rule is yet a product.

## What the measurement rests on

**Strict week-zero discipline, enforced in one place.** The preseason moment is one millisecond
before the earliest stamp the season carries, and `loadPreseason` asserts against the store that the
gate admits nothing the season produced. The 2023 board is taken at `2023-09-08T23:59:59.999Z` and
the 2024 board at `2024-09-06T23:59:59.999Z`; those are wall-clock dates a day or two past each
opener only because nflverse's publication lag puts the first game-derived stamp there, and no row
in either store falls between the opener and the moment.

**The structural test, moved to the preseason.** A board is byte-identical before and after the
season it predicts is written into the store at four times the volume
(`src/projections/preseason/source.test.ts`). This is the one defence that matters: a leak here
would fail nothing, it would simply make the scoreboard improve.

**What a board for season S is allowed to see, enumerated.** The week-one roster, stamped at the
league's cutdown deadline on the first of September, which is after the real cutdown in every season
from 2021 and before every opener since. The schedule facts stamped 20 May, which is how a new head
coach reaches the board. Nothing else about the season: every player-week observation is stamped
from a game day, every closing line and recorded temperature from kickoff, and `nfl_players`'
`latest_team` and `last_season` are refused outright because they are a current snapshot and
`last_season` would tell a 2023 board which players never played again.

**One deliberate discard, in the place it would have flattered us most.** nflverse's weekly roster
distinguishes active from game-day inactive, and an inactive list is published ninety minutes before
kickoff. Reading it would have smuggled a Sunday fact into a stamp claiming late August, straight
into the availability model. It is folded into `active` and a test pins it. Injured reserve and the
physically-unable-to-perform list are kept, because those are cutdown-day decisions.

**Bands are by a common prior for the first time.** Model v1 and model v2 both recorded that their
band comparisons were "indicative rather than exact" because the two arms did not hold the same
players in a band, and both named average draft position as the fix. It is ingested now, so every
band-by-band comparison against a published benchmark in this document is exact.

**Both parameter sets are fitted on 2021 and 2022 and on nothing else.** `fitAvailabilityPriors` and
`fitRookiePriors` take the held-out seasons explicitly and throw if handed one. Three of the five
availability parameter groups are direct estimates rather than searches; only the shrinkage and the
recency decay are searched, over a small grid.

### Where the measurement is weak

1. **The consensus benchmark's own date is not verifiable.** FantasyPros' archive embeds a bare
   month and day whose value is not consistent across seasons — 2024's reads as one day after that
   season's opener and 2023's reads as a February. The contents are unambiguously an
   end-of-preseason consensus (each carries that April's rookie class at the top), so the content is
   used and the stamp is recorded verbatim. We store it at the season's opening week, which is the
   **latest** it could honestly claim, which credits the benchmark with more information than it may
   have had. That is the direction that cannot flatter us, and it does not rescue the result: ECR
   would still beat this board if it were handicapped.

2. **Consensus sees things this engine has no feed for.** Preseason holdouts, training-camp injury
   designations, beat-reporter depth charts and coaching quotes are all real August information and
   we ingest none of them. That is an explanation for the loss and not an excuse: the gap is the gap.

3. **The market comparison is over two hundred players and the consensus comparison is over five
   hundred.** They are not measuring the same thing. The tie against ADP is a tie over the players a
   twelve-team draft actually reaches.

4. **Name resolution is a name join**, which this codebase otherwise refuses to do, because neither
   publisher emits a gsis id. It runs 86 to 92 percent on ADP and 88 to 90 on ECR, and the shortfall
   is dominated by the kickers and team defences this engine never projects. Where two people share
   a name, a position and no distinguishing team, neither is matched.

5. **Availability conflates injury, benching and being cut.** They have different causes and the
   same consequence for a season total, and separating them needs a designation feed we do not have.

6. **Kickers and team defences are excluded entirely**, unchanged from Phase 2.

## Should Phase 5's verdict be re-taken?

`docs/research/2026-08-27-decision-quality.md` found the draft recommendation produced worse rosters
than a plain points ranking (mean −33 season points across eight configurations) and named its own
first remedy: "Re-run this harness against Phase 6's preseason board. The decision layer is standing
on a board its own model research says is not fit for the purpose."

**Yes, re-take it, and expect it to move the number without reversing the finding.** Two things in
this document bear on it, and they point in opposite directions.

In favour of a re-take: the board Phase 5 stood on was last season's points per game times
seventeen, or model v1 at week 1 times seventeen, and this board beats a seventeen-games-for-everyone
extrapolation by 0.015 and 0.050 on the two seasons the replay uses. The input genuinely improved,
and the replay costs nothing to run again.

Against expecting a reversal: **Phase 5's central mechanism reproduces on the better board.** Value
over replacement ranked worse than points here too, on both seasons and in almost every band, which
is exactly the amplification Phase 5 diagnosed. A better board reduces the error being amplified; it
does not stop the amplification.

There is also a second thing to re-take that Phase 5 could not: it recorded that "there is no real
average draft position anywhere in this repository", so the survival term was fitted against a
synthetic room and the sleeper list had no market to disagree with. Both now exist, dated, for four
seasons.

## What to do next, in order

1. **Re-run the decision harness against this board**, with the real average draft position as the
   market rather than the projected-points rank. It is the cheapest outstanding item in the engine
   and two of its three blockers were removed by this phase.
2. **Fix the rookie ordering, on the fit seasons.** The landing-spot term measures worse than draft
   capital alone. Try the bound at zero (capital only), then a term fitted against the residual of a
   capital-only ordering rather than applied as a multiplier on top of it. Measure on 2021 and 2022
   and do not look at 2023 or 2024 again until a decision is made.
3. **Find out what consensus knows in the deep band that we do not.** It beats us there on both
   seasons and that is the segment the whole product thesis rests on. The candidates are all
   ingestion rather than modelling: training-camp injury designations, preseason snap counts, and
   published depth charts. `capture_snapshots` is already polling Tank01's depth charts and injuries
   daily; nothing maps them yet.
4. **A per-game distribution from layer 3.** It would make the spec's own tier rule work, give the
   rookie width the plan asked for, and unblock the start-and-sit finding Phase 5 parked. It is now
   named by three separate research documents as the missing piece.
5. **Extend the roster ingestion backwards** as nflverse's weekly rosters allow, so availability can
   be fitted on more than two seasons. Sixteen role-and-position cells over eighteen hundred
   player-seasons is a measurement, and it is a thin one.

## The claim this document supports

**Availability is real and it is the largest single feature this engine has measured.** The offseason
delta is correct and worth nothing measurable. The rookie model is worse than the draft order it is
built on. Value over replacement remains worse than points on a real board.

And **against the consensus we set out to replace, we lose** — by 0.120 and 0.045 rank correlation,
with the damage concentrated in the deep band we claimed as our edge. We are level with the market
over the two hundred players a draft reaches, and that is worth having, but it is not what was
promised.

The public accuracy record and the learning loop are the same artifact. This is the loop working:
the number is bad, it is published beside the number that beat it, and it names the segment.
