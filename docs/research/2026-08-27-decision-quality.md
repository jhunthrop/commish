# Decision quality, measured separately from prediction

**Measured 2026-08-28.** Reproduce with `npm run projections:decisions` (needs the store backfilled;
`npm run projections:backfill` first). Code: `src/projections/decide/**`,
`scripts/decision-report.ts`. Plan: `docs/superpowers/plans/2026-08-27-projection-engine-phase5-decisions.md`.

Prediction accuracy is not decision quality. `docs/research/2026-08-27-model-v1.md` measured whether
the engine orders players correctly; it beat the naive floor by +0.108 rank correlation in 2024 and
+0.117 in 2023. This document measures something else entirely, and gets a worse answer.

## The headline, and it is negative

**Following our draft recommendation would not have produced a better roster than following a plain
projected-points ranking.** Across the eight configurations measured (two held-out seasons, two
preseason boards, two opponent models), the full recommendation's mean improvement is **−33 season
points per team**, and it is positive in one configuration out of eight.

Season points added to a team's best starting lineup, mean across all twelve seats:

| season | board | opponents | value over replacement | full recommendation |
|---|---|---|---|---|
| 2023 | naive | plain points ranking | **−83.7** (3/12) | **−94.9** (5/12) |
| 2023 | naive | starters first, then points | **−317.5** (2/12) | **−100.3** (4/12) |
| 2023 | model | plain points ranking | **−259.1** (1/12) | **−67.7** (5/12) |
| 2023 | model | starters first, then points | **−119.4** (3/12) | **+1.2** (6/12) |
| 2024 | naive | plain points ranking | **−315.4** (1/12) | **−156.6** (3/12) |
| 2024 | naive | starters first, then points | **−181.5** (1/12) | **−10.0** (7/12) |
| 2024 | model | plain points ranking | **−328.9** (0/12) | **+191.3** (9/12) |
| 2024 | model | starters first, then points | **−93.0** (3/12) | **−25.2** (4/12) |

Bracketed figure is how many of the twelve seats improved. A typical roster in this replay is worth
roughly 1,400 to 1,700 points, so −33 is about two percent.

The engine's own standing rule is that a result needs two independent seasons or it is noise. **No
configuration here is positive on both seasons.** The single strong positive (+191.3, nine seats of
twelve) does not reproduce: the same board and opponent in 2023 gives −67.7.

## Value over replacement alone is a valuation, not a strategy

The clearest result in the document, and it is consistent across all eight configurations: drafting
by highest value over replacement, with no survival term and no roster need, is **worse than a plain
points ranking every single time**, by 84 to 329 points.

The mechanism is visible in one line of a replayed roster. Tight end has the lowest replacement
level of any position, so tight ends carry high value over replacement all the way down the board.
A seat that simply takes the highest number available drafts **seven tight ends**, one of whom
starts.

This is not an argument against replacement level. Replacement level is right, and the
quarterback-versus-back test in `replacement.test.ts` is right. It is an argument that **a valuation
is not a decision**: a number that says what a player is worth in the abstract says nothing about
what he is worth to a roster that already holds three better men at his position. That gap is
exactly what Task 3 exists to close, and the measurement says Task 3's contribution is real (it
recovers 100 to 400 points against the value-only strategy in every configuration) while still not
being enough to beat a plain ranking.

## The sleeper list is a horoscope by its own test

| season | named | hits | hit rate | base rate |
|---|---|---|---|---|
| 2023 | 15 | 7 | **47%** | 46% |
| 2024 | 15 | 6 | **40%** | 44% |

A hit is finishing at least twelve places above where the market drafted him, which is the same gap
the list required to name him. The base rate is that identical test applied to **every priced
player**.

**We hit at the base rate on one season and below it on the other.** A manager who threw a dart at
the player pool would have done as well. Publishing the hit rate beside the base rate is what makes
that visible; a hit rate alone would have read as "we called seven of fifteen" and sounded like
skill.

The misses are large and they are not near misses. In 2024 the top two names finished 124 and 111
places *below* their market price. The list is not mildly uninformative, it is noisy in both
directions.

One caveat that cuts in our favour and is not enough to rescue it: **the disagreements had no
attributable causes attached**, because the features that would supply them (Phase 3
redistribution, scheme and play-caller change) do not exist yet. `sleepers.ts` halves the score of
an unexplained disagreement, but with no causes available at all, every candidate was halved
equally and the discount did no work. The plan's own instruction was "if sleepers cannot be given a
reason from the model's own features, ship fewer sleepers", and this measurement says: **ship none
yet.**

## Start and sit changes nothing measurable

Decision regret, points left on the bench against the best lineup available in hindsight, per
team-week:

| season | matchup aware | plain ranking | difference |
|---|---|---|---|
| 2023 | 15.50 | 15.53 | +0.03 |
| 2024 | 19.74 | 19.34 | **−0.40** |

Better by three hundredths of a point on one season and worse by four tenths on the other. Against a
regret of fifteen to twenty points a week, both are indistinguishable from zero.

This is the least surprising line in the document and the most honest about its cause. The floor and
ceiling driving the decision are built by `realizedDispersion` from a player's own completed weeks,
because **nothing in the engine emits a distribution** (`outlook.ts` argues this at length: the
whole prediction surface is point estimates). A start/sit rule that trades expected points against
spread can only be as good as the spread it is given, and a spread read off eight noisy weeks of
one player carries very little. The arithmetic is right and the pin in `lineup.test.ts` holds. The
input is not there yet.

## What the measurement rests on, and where it is weak

**The paired design.** Comparing a room of one strategy against a room of another measures the room,
not the strategy. Every seat is replayed twice against the same eleven opponents drafting the same
board, once with the strategy under test in that seat and once without, at all twelve seats. The
difference is the advice and nothing else, and running all twelve seats retires draft position as a
confound.

**Point in time.** The preseason moment is the first instant anything about the target season was
recorded, so a board built from it cannot have read a game it is scored on. Weekly start/sit
replays week W from the moment week W−1's numbers landed, the same discipline `backtest.ts` holds
itself to. Outcomes are never visible to a seat, and a test pins that inverting every outcome
changes no pick.

**Three weaknesses that matter, in order.**

1. **There is no real average draft position anywhere in this repository.** `players.adp` is a
   current-value column with no history and no join to the historical player universe. The market
   price in the draft replay is therefore the projected-points rank, which is exactly how the
   opponents draft. The survival model is being asked to predict a synthetic room rather than a
   real one, so **survival is the least-tested part of the layer**, and the plan's instruction to
   calibrate it against real draft logs is not merely deferred, it is unmet.

2. **The board is weak, and the board is what the decision layer stands on.** Both preseason boards
   are extrapolations: last season's points per game times seventeen, or model v1 at week one times
   seventeen. Model v1's own research states plainly that it "adds nothing before kickoff of week 1"
   and that draft-day projection is a different problem, owned by Phase 6. Value over replacement
   *amplifies* board error rather than absorbing it, because it subtracts a replacement level
   estimated from the same noisy board and then re-ranks aggressively across positions. A points
   ranking does neither and is more robust to a bad board. **This is the most likely single reason
   the result is negative**, and it is testable: run this same harness against Phase 6's preseason
   board.

3. **The opponent model swings the answer by more than the effect being measured.** Changing the
   opponents from a plain points ranking to a starters-first ranking moves the full
   recommendation's mean by up to 348 points, which is ten times the effect size. That is itself a
   finding: **these numbers are not robust, and no strong claim in either direction is available
   from them.** The plain points ranking is an honest strawman but it is a strawman, and worse, it
   invalidates the premise value over replacement rests on: a replacement level says "the twelfth
   quarterback is free", and he is only free in a room that rosters starters rationally. A room that
   spends four to six picks a seat on quarterbacks is a world where our central assumption is false.

**Also not measured.** Bench depth is worth nothing to a roster's score, which is generous to a
hoarding strategy. Byes and injuries are not simulated. Kickers and defences are excluded from the
roster shape entirely, because Phase 2 projects neither and their slots would be two guaranteed
blanks for every seat.

## Two defects this harness caught, which is what it is for

Both were invisible to every unit test in `src/projections/decide/**`, and both would have shipped.

**Eight tight ends.** The first version of the roster-need term scored a candidate at his own value
over replacement, discounted by a fraction when he could only sit. No fixed discount was ever going
to stop a strategy that kept finding the best remaining number at the position with the lowest
replacement level. The replay showed every seat drafting eight tight ends and losing about eighty
points a season. The fix is that a player is worth what he adds to the **starting lineup you can
field**, which is zero for a fourth tight end however good he is. Each individual comparison the old
rule made was defensible, which is precisely why no unit test caught it.

**An optional field with a plausible default.** `RosteredPlayer.valueOverReplacement` was optional,
defaulting to replacement level, and `replayDraft` did not populate it. Every rostered man therefore
scored zero, every candidate looked like a starting upgrade, and the marginal rule silently
collapsed back into the standalone-value rule it had just replaced. The symptom was identical:
eight tight ends, a second time. The field is now required and the compiler refuses the mistake.

## What to do next, in order

1. **Re-run this harness against Phase 6's preseason board.** The decision layer is standing on a
   board its own model research says is not fit for the purpose. This is the cheapest thing that
   could turn the result around, and it needs no new code here.
2. **Get a real, as-of-stamped average draft position into the store**, either from Tank01's feed
   with a timestamp or from the house's own completed drafts. Without it the survival term is
   unmeasured and the sleeper list has no market to disagree with.
3. **Do not ship sleepers.** The list hits at its own base rate. Revisit when Phase 3 can attach a
   cause to a disagreement, and re-measure before shipping.
4. **Do not ship matchup-aware start/sit as a distinct feature.** Revisit when layer 3 emits
   distributions rather than point estimates.
5. **Replace the replay's opponent with the mock lane's own bot archetypes** (`src/mock-draft/bots.ts`),
   which already model a room that reaches, follows runs and reacts to need. The opponent model
   moves the answer more than the treatment does, so it is the largest single source of error in
   this measurement.
6. **Ship replacement level and the recommendation as a board and an explanation, not as an
   instruction**, until a later measurement says otherwise. The reasons are structured, testable and
   correct about the roster; what is not yet established is that acting on the ranking beats acting
   on projected points.

## The claim this document supports

Replacement level is right, the recommendation's structure is right, and the two of them together
recover most of what a naive value ranking throws away. **What is not established is that any of it
beats a plain projected-points ranking on a real season**, and on the evidence here it does not. The
public accuracy record and the learning loop are meant to be the same artifact. This is the loop
working: the number is bad, it is published, and it names the next thing to fix.
