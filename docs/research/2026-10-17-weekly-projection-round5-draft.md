# Weekly projection round 5: design draft for the founder's approval

Status: DRAFT, 2026-10-17 05:00 UTC, written by the coordinator from round 4's development check
(`2026-10-16-weekly-projection-round4-results.md` §2) and its credibility review
(`.superpowers/sdd/2026-10-12-prep-site/reviews/round4-credibility-review.md`). Nothing here is locked.
On the founder's approval it becomes a preregistration in round 4's form (every threshold before any
fit, judged once on 2024, 2025 and 2026 outcomes never read), with a pre-lock review.

## 1. What four rounds have established

| Round | Design | 2023 check vs recent form | Fate |
|---|---|---|---|
| 1, 2 | linear, usage and opponent | below form | stopped |
| 3 | linear, usage, opponent, shrinkage | +0.0106 (needed +0.02) | stopped |
| 4 | team model, share models, play-level expected points, identities, simulation | −0.0124 (needed +0.030) | stopped |

Round 4's review found the failure credible: no implementation defect could reach the margin. What
measurably works: the team model (plays, dropbacks, designed rushes and targets far better than implied
points alone, about +0.016 rho from the game terms), the raw share models (better than each player's
season-to-date share on every kind), running backs and receivers (both beat form and the spreadsheet).
What loses: the normalisation of shares across every player on the roster, which spreads a starter's
share over teammates who will not play and gives the whole gain back; value per opportunity and
efficiency resting on two games (the share decay governed them too); quarterbacks and tight ends,
whose points are efficiency more than volume; touchdowns, where the team model equals implied points.

## 2. The design in one paragraph

Keep the data, the feature store and the team model exactly as round 4 built and measured them. Drop
the identities, the cross-player normalisation and the simulation as the way to a point. Fit, per
position, a small number of direct per-game expectations of the components a league scores (targets
and receptions, receiving yards, carries and rushing yards, passing attempts and yards, touchdowns of
each kind, interceptions), each as a boosted-tree model whose target is the player's component in the
game and whose inputs are round 4's feature row (his shares and their trend, the depth chart, the
teammates out, the opponent's allowances by role, the closing figure, roof and weather) plus the team
model's expected volume for his club in that game and his own season-level anchor (his season rate of
the component and the rate m). Score the components under the league's rules. The point is the sum;
the range comes from per-position empirical quantiles of the residual, not a simulation; the why lines
come from the same seven factor groups as round 4 by attribution over the trees.

## 3. What changes, item by item, against round 4

1. **No normalisation across players.** Who plays is the designation filter (round 2's), the week-W
   depth chart row and the snap evidence; a player with no evidence gets no number. Shares are inputs,
   never forced to sum to one.
2. **The anchor.** Each component model predicts the player's game component directly, with his season
   rate of that component and the rate m as inputs, so the tree can hold a player's season-long level
   and move it by the game. This is the reviewer's lesson 3 made concrete: form is inside the model, not
   rebuilt from parts.
3. **Windows by role, not one decay.** Volume inputs keep round 4's decays; value per opportunity and
   efficiency inputs are the player's season-to-date rates with a weighted shrinkage (the reviewer's
   (Σw)²/Σw² effective count) toward his position's rate, fitted on their own loss, never the share
   decay.
4. **Quarterbacks' own path.** Passing attempts from the team model's dropbacks less the sack rate and
   the scramble rate; passing yards from attempts times a season-long yards per attempt shrunk toward
   the position; rushing with kneel-downs excluded and unpooled efficiency; touchdowns from the club's
   expected touchdowns (the team model) times the quarterback's season-long passing share of them.
5. **Touchdowns.** The club's expected touchdowns stay the team model's; a player's are the club's
   times his modelled share of red-zone and inside-ten opportunities (round 4 fitted those shares and
   never connected them; here they are the touchdown input), shrunk toward the position's rate.
6. **The range.** Floor, median and ceiling are the 10th, 50th and 90th quantiles of the player's
   residual distribution by position and point band, estimated on the fit seasons; the chance of beating
   a number is read off the same bands. G4's calibration gates apply unchanged.
7. **A named rival inside the round.** A second candidate: one boosted-tree model per position whose
   target is the player's points less his recent form, from the same inputs. The development check runs
   both; the one with the higher pooled G2 goes to the judgment, ties to the simpler (the components).
   The choice is made once, on 2023, and recorded; 2024 judges only the chosen one.

## 4. What stays as round 4 had it

The data and the stamps (§5 isolation, the admitted pairs, the feature store's instants), the team
model and its fit windows (2016 to 2022 for the check, 2016 to 2023 for the judgment, forward-chained),
the player models' windows (2021 to 2022, then 2021 to 2023), the development check on 2023 weeks 6 to
17 once, the judgment on 2024 weeks 6 to 17 once, the populations and statistics (round 3's), the fill
rule, the benchmarks (draft position, recent form season and last three, the expert's three-fact
spreadsheet, round 3's number as the best earlier model), the gates and every threshold (G1 +0.04, G2
+0.030 with a positive lower bound, the last-three guard +0.030, G6 +0.015, G7 +0.015, G3's places,
G4's bands, G5 isolation), the multiple-comparisons control, the stop rule, the prospective register
from week 7 against the published projection and the props-implied number, and the served refit on a
pass. One addition: a G8 against round 4's development-check number is not needed, since round 3's
number is the stronger earlier model and G7 keeps it.

## 5. Two questions for the founder

1. **The spreadsheet benchmark (G6).** As written it trailed recent form on 2023 (−0.0126), so the
   "expert" bar was the easier one. Keep it as the preregistered form, or replace it with a damped
   version (form times the square root of the two ratios) that the review expects to sit nearer form?
   My recommendation: keep both lines, gate on the stronger of the two.
2. **The margin.** +0.030 over form followed from the measured weekly noise and has stopped two rounds.
   It is the right bar for a number worth paying for. I recommend keeping it, with the honest
   consequence that the Proj column keeps the published projection until a round clears it.

## 6. Calendar

Preregistration written and reviewed within a day of approval; build two to three days (the feature
store and team model are reused, the component models are small); the development check once; the
judgment once; week 9 live on a pass stays possible only if the build starts by October 19.
