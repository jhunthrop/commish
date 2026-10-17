# Weekly projection round 4: the results record

Preregistration: `2026-10-16-weekly-projection-round4-preregistration.md`, locked at b56c05d8, amended
at 65cc5b96, 6364b50f, f358f375 and 42d0f440 (§7). This file holds the coordinator's recorded runs in
the order §6.4 states. Nothing here is a fit result until the development check's section exists.

## 1. The depth chart stamp check (§5), run before any fit

- Run 2026-10-17 00:05Z by the coordinator on `lane70_weekly` (port 5433), restored from dev's
  `research` schema at revision 0010 after lanes 66a and 66b's history (plays 462,818, weekly charts
  89,713, game weather 2,911, games 3,033), with `python -m research.pipeline depth-chart-check` at
  main 42d0f440. Seasons 2021 to 2023, weeks 6 to 17, reading depth charts and filings only.
- Injured group: 120 of 124 retained at depth 1 (0.9677), 23 on a bye week.
- Comparison group: 4,039 of 4,331 retained at depth 1 (0.9326), 447 on a bye week.
- Excluded: 0 depth-1 player-weeks the filing ingest does not cover. Never filed: 877 comparison
  player-weeks of a covered player with no filing all season.
- Margin 0.05: **PASS**. The injured group's retention is not below the comparison group's, so the
  replay reads the week-W chart (stamped at week W's Wednesday 18:00 ET pass) for the fit and the
  judgment, and the feature store's `--depth-chart week` build is the one the fit reads.
- Note: the injured group holds 124 players, fewer than the several hundred §5 expected, because the
  group needs a week W+1 filing of Out after no week-W filing; the verdict rule does not depend on the
  count. The gap between the groups runs the other way (injured retained more often), consistent with
  a chart compiled before the week's game.

## 2. The development check (§3.2), run once: the stop rule is met

- Run 2026-10-17 by lane 69 on `lane69_weekly` (port 5433, a fresh read-only dump of dev at revision 0010),
  code at the lane's 8a031c55 with main merged at e33b60d6, the feature files rebuilt with
  `--depth-chart week` (digests equal to lane 68's fix-round-2 digests), round 3's 26 recorded lines
  reproduced exactly before its number was used. Player models fit 2021 to 2022, play and team models
  2016 to 2022, checked on 2023 weeks 6 to 17. The full record is
  `2026-10-16-weekly-projection-round4-development-check.json` beside this file. Fit time 4,018 s.
- **G1 vs ADP:** PASS pooled +0.0572 (margin +0.0400, lower bound +0.0208); QB −0.0015, RB +0.1656,
  WR +0.1250 pass; TE −0.0604 fails the −0.02 floor.
- **G2 vs recent form:** **FAIL** pooled −0.0124 (margin +0.0300, lower bound −0.0531); QB −0.0107,
  RB +0.0139, WR +0.0102 pass the floor; TE −0.0632 fails. The last-three guard +0.0201 fails +0.0300.
- **G6 vs the expert's spreadsheet:** **FAIL** pooled +0.0002 (margin +0.0150, lower bound −0.0326);
  QB −0.0447 fails; RB +0.0325, WR +0.0171, TE −0.0042 pass.
- **G7 vs round 3's number:** FAIL −0.0230 (margin +0.0150).
- **G3 places off** (model 12.307): PASS vs ADP (+2.137 fewer); FAIL vs form (+0.067, needs 0.75);
  FAIL vs the spreadsheet (+0.221, needs 0.25).
- **G4 calibration:** QB fails all three formats (floor 0.079, ceiling 0.125, median 0.433); RB passes
  ppr, fails half and std; WR passes all three; TE fails all three (ceiling share about 0.174); the
  chance bins pass (five bins within ±0.04).
- **G5 isolation:** PASS (every reader on its seasons, the five tables unchanged, the per-game clause
  held; no 2024 to 2026 outcome read).
- **Decision, by §3.2's rule:** the check fails G2 pooled and G6 pooled, so **the stop rule is met: the
  round ends and 2024 is not judged.** No weekly number from round 4 reaches a screen. 2024 stays
  unjudged by any weekly round and remains available to a future round's single judgment.
- Defects the document itself names, recorded: 14 simulation mean-against-point breaches (low-volume
  players whose point sits above a ceiling of 0). They are not repaired for a rerun: the check runs
  once.
- Readings taken where the text was silent (the lane's fourteen questions, in its report; none moved a
  threshold, seed, population or judged week), the two that matter most for the next round: the
  "projected set" the identities normalise over is undefined in §2.6 (read as the population's own
  lists before the line filter, less the withheld; the other reading left lined players 20 to 30 per
  cent low), and §2.3's unweighted moments pool 21 cells fully. A reported view without the identities'
  normalisation reaches +0.0033 vs form and +0.0159 vs the spreadsheet, still short of G2.
- What the numbers say for the next design: the raw model shares beat the season-to-date share and the
  identities' normalisation gives the gain back; running backs and receivers beat form and the
  spreadsheet, quarterbacks and tight ends do not; the whole system equals the three-fact spreadsheet
  (form times the opponent's allowance times the club's implied points over its average).
