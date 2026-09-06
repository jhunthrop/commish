# Kicker and Team Defense Projections: Results

**Run:** 2026-09-05, once, by `npm run projections:kdef:judgment -- --isolation-before <path>`.
**Preregistration:** `docs/research/2026-09-05-kicker-defense-preregistration.md`, committed as
`5dddeaa` before this run was taken.
**Tree:** commit `018d133`, with the priors of `63cd8c6` fit on 2013 through 2024.
**G4 baseline:** emitted from the commit before `018d133`, which is the commit before
`projectedPosition` learned `K` and therefore the last point at which the four skill positions'
board could not have moved.

## Decision

**Kicker: market order. Team defense: market order.**

Neither position passed all four gates, so under the preregistered decision rule both ship in market
order, labelled as market order on the board, with no projected points and no tier. The model is not
retuned and rerun. This is the failure branch working as designed, not a result to be improved upon
after the fact.

## The run, verbatim

```
market/blend.ts: marketBoard for 2025 dropped 43 ADP row(s) whose position has no fitted market curve.

================================================================================================
KICKER AND TEAM DEFENCE JUDGMENT, 2025, 12-team PPR, board taken at 2025-09-05T23:59:59.999Z
================================================================================================

history read                        2022, 2023, 2024
defence games with no score         0
skill rows compared for G4          676
positions the model rated           K 39, DEF 32

------------------------------------------------------------------------------------------------
K: 39 candidates, 35 with a 2025 outcome to be scored against
------------------------------------------------------------------------------------------------
  FAIL  G1 ordering        model 0.5181 against last-season order 0.5007, margin +0.0174 against a bar of 0.05, n=29
  FAIL  G2 market          model 0.3240 against market 0.4179, margin -0.0939 against an allowed shortfall of 0.02, n=19
  PASS  G3 calibration     21 of 35 outcomes inside the band, 60.0%, against a target of 40% to 60%
  PASS  G4 isolation       676 rows byte-identical
  DECISION K: market order

  TOP 10 by the model, with what actually happened
    DAL  Brandon Aubrey          proj  124.4  tier 0  actual  149.0
    LAC  Cameron Dicker          proj  116.0  tier 1  actual  145.0
    TB   Chase McLaughlin        proj  115.5  tier 1  actual  125.0
    PIT  Chris Boswell           proj  115.0  tier 1  actual  119.0
    MIA  Jason Sanders           proj  114.9  tier 1  actual    n/a
    PHI  Jake Elliott            proj  112.4  tier 1  actual   94.0
    DEN  Wil Lutz                proj  112.3  tier 1  actual  120.0
    BUF  Tyler Bass              proj  112.0  tier 1  actual    n/a
    SEA  Jason Myers             proj  111.9  tier 1  actual  165.0
    HOU  Ka'imi Fairbairn        proj  110.8  tier 1  actual  157.0

------------------------------------------------------------------------------------------------
DEF: 32 candidates, 32 with a 2025 outcome to be scored against
------------------------------------------------------------------------------------------------
  FAIL  G1 ordering        model 0.0555 against last-season order 0.1926, margin -0.1371 against a bar of 0.05, n=32
  PASS  G2 market          model 0.0178 against market -0.1067, margin +0.1245 against an allowed shortfall of 0.02, n=23
  PASS  G3 calibration     17 of 32 outcomes inside the band, 53.1%, against a target of 40% to 60%
  PASS  G4 isolation       676 rows byte-identical
  DECISION DEF: market order

  TOP 10 by the model, with what actually happened
    BUF  team-def:BUF            proj  110.4  tier 0  actual   95.0
    BAL  team-def:BAL            proj  107.9  tier 0  actual   59.0
    PHI  team-def:PHI            proj  103.8  tier 0  actual   99.0
    DAL  team-def:DAL            proj  101.4  tier 0  actual   16.0
    SF   team-def:SF             proj  101.3  tier 0  actual   52.0
    DEN  team-def:DEN            proj   99.9  tier 0  actual  125.0
    GB   team-def:GB             proj   97.0  tier 0  actual   74.0
    PIT  team-def:PIT            proj   96.3  tier 0  actual   91.0
    KC   team-def:KC             proj   94.1  tier 0  actual   73.0
    NYJ  team-def:NYJ            proj   93.0  tier 0  actual   -2.0

------------------------------------------------------------------------------------------------
BASELINE FOR CONTEXT: the league mean is a flat board, whose rank correlation with any
outcome is undefined by construction. It is reported here as the thing an ordering beats
by existing, and it is not one of the four gates.
positions unknown to the market     K 23, DEF 9
================================================================================================
```

## What each gate said

**Kicker.** The model's ordering is genuinely good in absolute terms, 0.5181, and it did beat last
season's points order. It beat it by 0.0174 against a bar of 0.05, so G1 fails on the MARGIN rather
than on the direction. G2 fails outright: on the nineteen kickers the market covered, the market's
own draft order correlated 0.4179 against the model's 0.3240. The market knows something about
kickers that this composition does not, and the honest reading is that a kicker's fantasy season is
dominated by his club's offense being good, which the market prices directly and which three seasons
of shrunk attempt rates only approximates.

The band is right: 60.0% coverage against a 40% to 60% target, landing exactly on the upper bound
after the iteration-2 fix. The interval is honest even though the ordering did not clear its bar.

**Team defense.** G1 fails, and it fails in the opposite direction from the development check. On
2024 last season's defense points correlated -0.2109 with the outcome and the model was less wrong;
on 2025 last season's points correlated +0.1926 and the model managed only 0.0555. That sign flip
between two adjacent seasons is the most informative number in this document: a defense's
year-to-year persistence is not a stable quantity, so a baseline built on it is not a stable
baseline, and a model that must beat it by a fixed margin is being asked to beat a coin.

G2 passes comfortably, +0.1245, and it is worth stating plainly what that means: the model orders
defenses better than the market does, and both are close to useless in absolute terms (0.0178 and
-0.1067). Beating a near-zero correlation by a tenth is not evidence anyone should draft on.

The band is right here too, 53.1%.

**Isolation.** G4 passes for both, 676 skill rows byte-identical across the whole round. No QB, RB,
WR or TE row moved.

## What ships

Both positions ship in market order. On the board that is a labelled row carrying the market's own
draft order, no projected points and no tier, and copy that says so plainly rather than leaving a
blank a reader would take for a bug.

**Not every candidate has a market row.** 23 of the kickers and 9 of the defenses with a 2025 outcome
carry no published average draft position at all. A position shipping in market order therefore
shows only the players the market has an opinion about, and the rest are absent. Absence renders as
absence.

**Autopick is unaffected**, by design. Its late-round policy landed before this document was written
and depends on none of it: a seat still finishes every draft with a kicker and a team defense filled,
and still reaches for neither early. That was the spec's UX rider and it is why the rider exists.

## What a later round should try, and what it should not

Not worth retrying as-is: more shrinkage tuning, a wider recency grid, or a fourth component. The
kicker model already orders at 0.5181 and lost to the market by a tenth; the defense model is
measuring a quantity that barely persists.

Worth trying, in a new preregistration:

- **For kickers, the club's offense directly.** The single largest omitted variable is how good the
  2026 offense is, and the engine already projects every skill player on it. A kicker's attempt
  volume conditioned on his club's own projected scoring would be reading the thing the market is
  evidently reading.
- **For defenses, an incoming team-strength signal.** The spec named a season-win-total market as a
  named amendment rather than a quiet addition, and this result is the argument for taking that
  amendment: the club's own past is demonstrably not enough, and it is not enough in a way that
  changes sign between adjacent seasons.
- **A different bar for G1 on a position whose baseline is unstable.** Requiring a fixed margin over
  last season's points assumes that baseline means something similar every year. For defenses it
  provably does not. A future preregistration should either pick a stabler baseline or state the bar
  in terms of the baseline's own variability.
