# Projection Engine — Spec

**Status:** approved by the founder 2026-08-27. Plan: `docs/superpowers/plans/2026-08-27-projection-engine.md`.
**Rendered form:** https://claude.ai/code/artifact/9043f065-7d9e-4ef2-8df3-0db25caef467

## Why this exists

The tiering matrix marks a block of Pro features — tier cliffs, upside and floor, season projections,
start/sit, the trade calculator — as waiting on one thing. Not a vendor and not a licence: a
projection engine we own. Founder direction, 2026-08-27: *"I'm talking about building something
better than humans ever could analyze."*

It also removes a dependency we do not want. Licensing expert consensus means depending on a company
we compete with. Building it means the only recurring data cost is the Tank01 subscription we already
hold.

## The two decisions everything else follows from

**1. Predict components, not points.** Project targets, receptions, carries, yards and touchdowns
separately; compose fantasy points through each league's real scoring rules. Components are far more
stable than points; per-component error says *where* we are wrong rather than merely *that* we are;
and one model serves every format. A superflex TE-premium league is not an adjustment, it is a
different composition of the same components — and we can do that only because we own the league and
know its scoring exactly.

`StatLine` (`src/domain/player.ts`) and `computeFantasyPoints` (`src/scoring/compute.ts`) already
exist. A projection IS a predicted `StatLine`. No parallel type.

**2. Every fact carries an as-of stamp.** The backtest replays history and must see only what existed
before kickoff. Leakage is the single most common way projection work fools itself: one stray
end-of-season column and the model looks brilliant and is worthless. Point-in-time is not a later
refinement — retrofitting it means rebuilding the store.

## Why the harness comes before the model

You can only learn what you measure. A projection you cannot score is a projection you cannot
improve, and every question that follows — does this feature earn its place, does the news pass add
anything, do we beat the market — is answered by the harness or not at all. `src/projections/metrics.ts`
landed first for this reason (commit `08cc768`).

Benchmarks, all three, always: **naive** (last season's points per game — if we cannot beat it we have
nothing), **ADP** (the market; beating it is the commercial claim), **ECR** (the consensus we replace;
beating it is the marketing claim). Tank01's own projections and DFS salaries arrive with the
subscription and earn scoreboard lines too — salaries being the only weekly market consensus, they
are the right benchmark for start/sit rather than for the draft board.

Primary metric is **rank correlation**, because fantasy is an ordering problem: a projection wrong
about everyone by the same twelve points costs a manager nothing.

## The layers

0. **Point-in-time store** — as-of snapshots. Everything above reads through it.
1. **Opportunity forecast** — snap share, route participation, target share, carry share, red-zone
   share. *The keystone.* Volume predicts fantasy points far better than efficiency: opportunity is
   stable, efficiency is noise. This is also where a trade resolves — a receiver leaves, target share
   vacates, the model redistributes it given scheme, depth chart and competition.
2. **Efficiency priors** — regressed hard to role means. Touchdown rate regresses hardest; TD variance
   is where amateur models overfit and look foolish by week six.
3. **Component projection** — as distributions, which is what makes floor and ceiling free later
   instead of a bolted-on guess.
4. **Context** — opponent, game script from implied total and spread, weather, rest.
5. **Qualitative pass** — an LLM that *weighs retrieved facts and never generates them*. Structured,
   cited, confidence-scored, expiring, bounded to a multiplier on opportunity. No citation, no ship.
   In a product where entry fees ride on the output, an invented injury is unacceptable. Built LAST,
   because it is the layer most likely to look impressive and add nothing — and only the harness can
   tell the difference.
6. **Composition and ranking** — through the league's real scoring. Tiers fall out of the
   distribution: a cliff is where the gap exceeds the overlap, not a hand-drawn line.
7. **Explanation** — SHAP over the component model, rendered as language. Diagnostics and product are
   the same artifact: what tells us the model is wrong tells the manager why a player ranks there.

## Sources

**Tank01 (subscribed)** covers live operations, betting odds (layer 4 game script), news (layer 5
retrieval), injuries and inactives (feature *and* label — inactives are ground truth on whether our
availability assumption held), depth charts (weak role prior), ADP and DFS salaries (benchmarks), and
Changelog (layer 0: stat corrections must be timestamped or the backtest quietly becomes dishonest).
Their fantasy projections are a **benchmark only, never a feature** — consuming them makes our board
derivative of theirs.

**nflverse (free)** covers the one thing Tank01 cannot: **participation and snap counts**. A box score
reports five catches on eight targets; it cannot say whether he played twenty snaps or sixty, and
those are two different players. Layer 1 forecasts opportunity, so it needs the denominator. Also
play-by-play to 1999 (the backtest needs depth to hold a feature out twice), Next Gen Stats, and
derived models including CPOE.

**Derived by us:** the offensive line composite (adjusted line yards, stuffed rate, sack rate,
time-to-throw, and line continuity from snap participation), the scheme and pace table, and our own
ADP from real drafts in our own house — which nobody outside the platform can compute.

**PFF grades: development-time calibration only.** Founder ruling 2026-08-27, after weighing the
copyright argument (correct: extraction is not redistribution) against the residual contract exposure.
Never a runtime dependency: no live scrape to break during draft week.

## How it learns

Not "which feature matters most" but **"where are we wrong, and what would fix that segment?"** Cut
error by position, rank band and situation (post-trade, new coordinator, rookie, returning from
injury). Quarterly ablation on held-out seasons answers impact honestly — importance to a model is not
the same as value out of sample — and a feature must help across two independent seasons or it is
noise.

Expect the first real win in the **151–400 rank band**. Everyone ranks the top fifty correctly; human
analyst attention runs out in the deep pool, and that is where leagues are won.

The public accuracy record and the learning loop are the **same artifact**: the scoreboard that earns
trust is the instrument that tells us what to fix.

## The honest ceiling

Injury and game script are substantially irreducible. The promise is beating consensus by a small
margin, consistently, which compounds over a season into a real edge. Not omniscience. We make the
true claim and then publish the scoreboard proving it.
