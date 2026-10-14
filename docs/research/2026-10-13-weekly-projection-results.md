# The Weekly Projection Round: Results

**Run:** 2026-10-14 (UTC), once, by
`uv run python -m research.model.weekly.round judge --database <scratch copy> --out <file>`.
**Preregistration:** `docs/research/2026-10-13-weekly-projection-preregistration.md`, committed as
`3beb44d1` before any fit of this round ran.
**Tree:** `47719c12` (`model_version` `research@47719c12`), arithmetic `v8-fdlibm-fused/pow-apple-libm`.
**Data:** the scratch copy `lane12_weekly` (local test server, port 5433): the dev copy's `research`
schema as dumped 2026-10-13, plus 2025's published weekly stats from the house's season ingest
(6,655 stat lines, 7,565 participation rows, resolution 0.997).
**Every number:** `2026-10-13-weekly-projection-results.json` (the judgment's whole output: the
fitted priors, the interval, every gate, every reported number, per-week rho, table digests).

## Decision

**A gate failed. No weekly number reaches a screen.**

Twelve of the twenty-three gate lines failed: three of four positions against ADP (G1), all four
against recent form (G2), both places-off comparisons (G3) and quarterback calibration in all three
formats (G4). Isolation (G5) passed. Under the preregistered decision rule the weekly board does not
join the nightly, writes no rows and is not frozen by the register; the in-season screens keep the
season projection and the stat lines, labelled. The model is not retuned and rerun against 2025.

## The run, verbatim

```
fit: 2341.9s, read 6.2s, interval over 72 weeks 148.4s
search: decay 0.7, shrinkage OpportunityShrinkage(season=2.0, in_season=0.25, team_volume=4.0), share RMSE 0.10453 over 118960 shares
board: 11901 rows over 17 weeks, 5594 scored, 2.23s a week
FAIL  G1 QB vs ADP              difference -0.0179 against a margin of +0.0300, lower bound -0.1136 against 0, over 17 weeks
PASS  G1 RB vs ADP              difference +0.0939 against a margin of +0.0300, lower bound +0.0367 against 0, over 17 weeks
FAIL  G1 WR vs ADP              difference +0.0303 against a margin of +0.0300, lower bound -0.0255 against 0, over 17 weeks
FAIL  G1 TE vs ADP              difference +0.0332 against a margin of +0.0300, lower bound -0.0686 against 0, over 17 weeks
FAIL  G2 QB vs recent form      difference -0.0138 against a margin of +0.0200, lower bound -0.1088 against 0, over 17 weeks
FAIL  G2 RB vs recent form      difference +0.0180 against a margin of +0.0200, lower bound -0.0161 against 0, over 17 weeks
FAIL  G2 WR vs recent form      difference +0.0332 against a margin of +0.0200, lower bound -0.0166 against 0, over 17 weeks
FAIL  G2 TE vs recent form      difference +0.0096 against a margin of +0.0200, lower bound -0.0569 against 0, over 17 weeks
FAIL  G3 places off vs adp      difference +0.3075 against a margin of +0.5000, lower bound -0.2541 against 0, over 17 weeks
FAIL  G3 places off vs form     difference +0.3062 against a margin of +0.5000, lower bound -0.2198 against 0, over 17 weeks
FAIL  G4 QB ppr                 below floor 0.166, above ceiling 0.126, each against [0.05, 0.15], n=604
FAIL  G4 QB half                below floor 0.166, above ceiling 0.126, each against [0.05, 0.15], n=604
FAIL  G4 QB std                 below floor 0.166, above ceiling 0.123, each against [0.05, 0.15], n=604
PASS  G4 RB ppr                 below floor 0.101, above ceiling 0.102, each against [0.05, 0.15], n=1509
PASS  G4 RB half                below floor 0.108, above ceiling 0.101, each against [0.05, 0.15], n=1509
PASS  G4 RB std                 below floor 0.107, above ceiling 0.103, each against [0.05, 0.15], n=1509
PASS  G4 WR ppr                 below floor 0.092, above ceiling 0.090, each against [0.05, 0.15], n=2298
PASS  G4 WR half                below floor 0.094, above ceiling 0.091, each against [0.05, 0.15], n=2298
PASS  G4 WR std                 below floor 0.099, above ceiling 0.094, each against [0.05, 0.15], n=2298
PASS  G4 TE ppr                 below floor 0.073, above ceiling 0.098, each against [0.05, 0.15], n=1183
PASS  G4 TE half                below floor 0.072, above ceiling 0.101, each against [0.05, 0.15], n=1183
PASS  G4 TE std                 below floor 0.083, above ceiling 0.101, each against [0.05, 0.15], n=1183
PASS  G5 isolation              every table as it was
DECISION: a gate failed; no weekly number ships
```

The bootstrap lower bound is the 0.5th percentile of 10,000 week-block resamples (seed 12), the
Bonferroni level for ten comparisons. Weekly population sizes in the ordering population: QB 16 to 27,
RB 42 to 55, WR 51 to 73, TE 17 to 23.

## Reported, not gated

Mean weekly Spearman rho with the finish, within position, on the ordering population (2025 weeks
1 to 17):

| Format | Position | Model | ADP | Recent form | Oracle's own fit and team rule |
|---|---|---|---|---|---|
| PPR | QB | 0.1830 | 0.2009 | 0.1968 | 0.1741 |
| PPR | RB | 0.5916 | 0.4977 | 0.5736 | 0.5860 |
| PPR | WR | 0.4478 | 0.4175 | 0.4146 | 0.4463 |
| PPR | TE | 0.3180 | 0.2849 | 0.3084 | 0.3014 |
| Half | QB | 0.1826 | 0.2023 | 0.1954 | |
| Half | RB | 0.5760 | 0.4840 | 0.5574 | |
| Half | WR | 0.4297 | 0.4042 | 0.3886 | |
| Half | TE | 0.3272 | 0.2785 | 0.3184 | |
| Std | QB | 0.1810 | 0.2023 | 0.1970 | |
| Std | RB | 0.5492 | 0.4541 | 0.5289 | |
| Std | WR | 0.4056 | 0.3806 | 0.3507 | |
| Std | TE | 0.3107 | 0.2541 | 0.2871 | |

Mean places off for the week's starters (PPR): QB model 6.52, ADP 6.41, form 6.76; RB 10.43, 10.97,
10.56; WR 15.79, 16.08, 16.39; TE 5.17, 5.47, 5.32; pooled 10.67, 10.98, 10.98 (the oracle's own
fit and team rule: 10.74).

Points error over every scored player-week (PPR): QB MAE 6.49, RMSE 8.09 (n 604); RB 4.17, 6.07
(1,509); WR 4.18, 5.87 (2,298); TE 3.42, 5.03 (1,183).

## Reading the result

The model orders every position but quarterback a little better than both benchmarks on average,
in every format, and the refit with the corrected team rule is a little better than the oracle's own
fit at every position. None of it is enough. The margins are a few hundredths of rho, and over
17 weeks the week-to-week spread of those margins is wider than the margins themselves, so at the
level ten comparisons demand only running backs against ADP clear zero. Quarterbacks are the clear
failure: the model orders them worse than ADP and recent form, and its floor misses one quarterback
week in six. The interval's other nine cells landed within a point or so of their nominal ten per
cent.

The development check (below) said the same thing before 2025 was read, which is the useful part:
the shape of this failure is a property of the model on two independent seasons, not of 2025.

## The fit

Fit on 2021-2024 with 2020 as history, the oracle's four procedures, ported and proven bit for bit
(`weekly-fit` parity case). The search chose the same cell as the oracle's own 2021-2022 fit: decay
0.7, season shrinkage 2, in-season shrinkage 0.25, team-volume shrinkage 4. League team volume per
game: 32.15 targets, 26.95 carries, 33.55 pass attempts. Scheme elasticities (tempo, pass lean):
targets 0.0800, 0.1255; carries 0.2068, -0.1631; pass attempts 0.0284, 0.1339 (league pace 32.76
s/play, neutral pass rate 0.5518). Game context (opponent, rest): passing 0.4357, -0.0543; rushing
0.4646, -0.0082. Every fitted number, and the interval's edges and offsets, are in the JSON file.

## Development check, run before the judgment

Fit 2021-2023 (2020 history), judged on 2024 weeks 1 to 17 against 2024 ADP and recent form, same
code (`2026-10-13-weekly-projection-dev-check.json`). Its gates read: G1 passed for RB only (QB
+0.0169, RB +0.1248, WR +0.0548, TE +0.0673 against ADP, lower bounds -0.1045, +0.0706, -0.0180,
-0.0777); G2 failed for all four (QB -0.0497, RB -0.0000, WR +0.0286, TE +0.0513, every lower bound
below zero); G3 passed against ADP (+0.7627, bound +0.2520) and failed against form (-0.0295); G4
passed all twelve cells; G5 passed. It found no defect, so the preregistration carries no
amendment and nothing changed between the check and the judgment.

## Refused benchmarks

The season board scaled to a week and the stats provider's weekly projection were refused by name,
as preregistered: the store holds no 2025 season board and no 2025 week-one rosters to build one,
and one provider projection capture (2026-09-09).

## Cost

On the founder's laptop (Apple silicon, one core): the fit reads in 6 s and fits in 39 min (the
share search, 720 cells over 72 weeks, is nearly all of it); the interval takes 2.5 min; one week's
board, reads included, takes 2.2 s. The priors are fixed once fitted, so an in-season job would run
the board build only: about 2 s a week. No model call, no prose: this round spent nothing.
