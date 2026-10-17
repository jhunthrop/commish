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
