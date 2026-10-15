# Weekly Projection Round 2: the development check, and why the judgment was not run

**Preregistration:** `docs/research/2026-10-15-weekly-projection-round2-preregistration.md`, committed as `86ca79d6` before any fit ran.
**Code:** `research/model/weekly2/` (Lane 44), `model_version` stamped on every row.
**Run:** `python -m research.model.weekly2.round develop` on a scratch copy of the development store (`lane44_weekly`, local port 5433), fit on 2021 and 2022, checked on 2023 weeks 6 to 17, once, on 2026-10-15. Every number is in `2026-10-15-weekly-projection-round2-dev-check.json`.

## Result

25 of 26 gate lines pass. The one that fails is the one the preregistration named as the gate expected to decide the round:

| Gate | Result | Basis |
|---|---|---|
| G1, pooled against ADP | pass | +0.0729 rho against a margin of +0.0400, lower bound +0.0558 above 0, over 12 weeks |
| G1, every position against ADP | pass | QB +0.0077, RB +0.1468, WR +0.1288, TE +0.0084, each above the floor of -0.0200 |
| G2, pooled against recent form | **fail** | +0.0033 rho against a margin of +0.0200, lower bound -0.0237, below 0 |
| G2, every position against recent form | pass | QB -0.0014, RB -0.0048, WR +0.0140, TE +0.0056, each above the floor |
| G3, places off | pass | model 12.116 against ADP 14.445 and recent form 12.374 |
| G4, calibration in 12 cells and the chance bins | pass | every cell's floor and ceiling shares inside 0.05 to 0.15; five chance bins within 0.05 of observed |
| G5, isolation | pass | fit read 2021 and 2022 only, the check read 2023 only, every table unchanged |

## The ruling

The judgment on 2024 was not run. The preregistration's decision rule needs G2 to pass, the development check shows the model equal to recent form within positions (+0.0033 pooled), and nothing in the preregistration allows the threshold to move after the check. Judging would spend 2024, the one clean season left before 2026, on a model the check already says would fail. 2024 stays untouched for a later round on a different basis. The usage regression named as the second candidate in the preregistration is that round's starting point.

What the check did establish, for the record: against ADP, the rest-of-season model's points a game with a capped opponent factor leads at every position and by +0.073 pooled, and its calibration holds in every cell. Against a plain recent-form baseline it adds nothing measurable at the week level. A weekly number worth showing has to beat the member's own eyes on the last three box scores, and this one does not.

## Two things the replay showed about the data

- The Out and Doubtful filter barely acts at the preregistered projection instant (just before the week's first kickoff, usually Thursday night): only 39 of 260 Out or Doubtful filings and 38 of 353 Questionable filings for 2023 weeks 6 to 17 exist by then, because Sunday's final reports come on Friday. In the check no population player was withheld and 16 were flagged Questionable. Any later round that projects at Thursday's kickoff should expect the same, or project per game.
- A player withheld by his filing has no weekly number and was left out of both the opponent-factor fit and the range fit; the preregistration's "judgment population on the fit seasons" was read as the players who have a number.

## What ships

Nothing from this round reaches a screen. The in-season screens keep the rest-of-season order and this week's facts, with no weekly point number and no start-and-sit odds, as the in-season spec's §10.1 says. The weekly pass gained an opponent-ratings step for the current season (Lane 44), which future rounds and the capsule facts can use.
