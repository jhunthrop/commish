# Scheme elasticity, an exploration: the results

**Plan:** `2026-10-27-scheme-elasticity-exploration-plan.md`, committed alone and pushed at `30126c32`
(2026-10-27 12:57:47Z) before any outcome was read. **Record:** the JSON beside this file
(`2026-10-27-scheme-elasticity-exploration-results.json`). **Run by:** Lane 245, 2026-10-27, on
`lane245_scheme` (5433) and dev read only. This is an exploration, not a round: nothing here is
promoted, served or preregistered, and no sentence below claims the projection improved.

**Reproduce with one command** (from `research/`, after `download` has loaded the two files):

    uv run python -m research.explore.scheme_elasticity download --scratch postgres://commish:commish@localhost:5433/lane245_scheme
    uv run python -m research.explore.scheme_elasticity run --scratch postgres://commish:commish@localhost:5433/lane245_scheme --dev postgres://commish:commish@localhost:5432/commish --out results.json

Nothing in the run is random except the bootstrap (`default_rng(42)`, 10,000 resamples); the run takes
about 10 s.

## 1. The answer in one table

Baseline + all five scheme terms minus the baseline (the expert's three-fact spreadsheet), PPR Spearman
rho, round 4's statistic (mean over weeks of the four-position mean), 2022 and 2023 weeks 6 to 17,
lower bounds at the 1.667th percentile of the week-block bootstrap:

| Weeks | Pooled | Lower bound | QB | RB | WR | TE |
|---|---|---|---|---|---|---|
| **Both seasons (24)** | **-0.0009** | -0.0028 | **-0.0021** | -0.0005 | -0.0005 | **-0.0004** |
| 2022 (12) | +0.0000 | -0.0031 | +0.0031 | -0.0012 | -0.0012 | -0.0006 |
| 2023 (12) | -0.0018 | -0.0037 | -0.0074 | +0.0002 | +0.0002 | -0.0001 |

The bar (plan §7): condition 1 (pooled >= +0.030 with bound > 0) **fails**; condition 2 (QB or TE
positive, no position below -0.02) **fails** (QB and TE both negative, no position under the floor);
condition 3 (positive in each season) **fails** (2022 +0.0000, 2023 -0.0018). No single term clears
+0.030 on QB or TE alone. **The bar's answer is "no", and its recommendation is "drop".**

## 2. Why: the terms barely move the number

Each term's multiplier on the rows that used it, 5th / 50th / 95th percentile:

| Term | Position | 2022 | 2023 |
|---|---|---|---|
| blitz | QB | 0.990 / 1.000 / 1.008 | 0.995 / 1.000 / 1.006 |
| pressure | QB | 0.991 / 0.999 / 1.009 | 0.989 / 1.001 / 1.009 |
| play action | QB | 0.980 / 1.001 / 1.027 | 0.975 / 1.001 / 1.029 |
| man / zone | WR | 0.978 / 0.998 / 1.026 | 0.986 / 1.000 / 1.015 |
| man / zone | TE | 0.988 / 1.000 / 1.010 | 0.998 / 1.000 / 1.003 |
| box (8+) | RB | 0.959 / 0.999 / 1.042 | 0.977 / 0.999 / 1.024 |

No row reached the [0.80, 1.25] cap. Nine players in ten move by less than 3 per cent (QB pressure and
blitz, TE man/zone: less than 1 per cent), which reorders almost no one within a week's position list.

The house shrinkage (R4 §2.3's method-of-moments empirical Bayes) found no spread between players
beyond noise in most cells, so it pooled each player's split fully to his position's split. Weeks
whose moment fit pooled fully (of 12 per season):

| Term, position | 2022 | 2023 |
|---|---|---|
| blitz, QB | 7 | 12 |
| pressure, QB | 12 | 12 |
| play action, QB | 6 | 12 |
| man / zone, WR | 10 | 12 |
| man / zone, TE | 10 | 12 |
| box, RB | 0 | 1 |

With the split pooled, a term varies only through the player's own mix and the opponent's rate, and the
position-level splits are small: through each season, points per dropback blitzed minus not +0.033
(2022) and +0.039 (2023); pressured minus not -0.078 and -0.125; play action minus not +0.048 and
+0.079; a receiver's points per on-field dropback in man minus zone +0.083 / +0.051 (WR) and +0.036 /
+0.002 (TE); a back's points per carry against 8+ minus lighter boxes +0.216 / +0.221 (short-yardage
carries, the touchdown end of the field). Opponent rates spread widely (blitz rate 0.17 to 0.35 in
2022, 0.20 to 0.44 in 2023; man rate 0.18 to 0.41 and 0.28 to 0.55), so the opponent side carries
signal about scheme; the player side carries little about how differently each player responds to it.

**A view added after the plan (reported, never the bar):** the same terms with the splits unshrunk
(each player's own observed split). Pooled -0.0018 (bound -0.0044); QB -0.0032, RB -0.0002, WR +0.0004,
TE -0.0040; 2022 -0.0033, 2023 -0.0002. The shrinkage is not what hides a gain: unshrunk, the terms
are slightly worse.

## 3. The ablation (PPR, vs the spreadsheet, both seasons; QB and TE with their position bounds)

| Source | Pooled | Bound | QB (bound) | RB | WR | TE (bound) |
|---|---|---|---|---|---|---|
| all terms | -0.0009 | -0.0028 | -0.0021 (-0.0092) | -0.0005 | -0.0005 | -0.0004 (-0.0036) |
| blitz alone | +0.0004 | -0.0009 | +0.0016 (-0.0036) | 0 | 0 | 0 |
| pressure alone | -0.0001 | -0.0011 | -0.0004 (-0.0042) | 0 | 0 | 0 |
| play action alone | -0.0001 | -0.0019 | -0.0004 (-0.0076) | 0 | 0 | 0 |
| man / zone alone | -0.0002 | -0.0012 | 0 | 0 | -0.0005 | -0.0004 (-0.0036) |
| box alone | -0.0001 | -0.0009 | 0 | -0.0005 | 0 | 0 |
| without blitz | -0.0005 | -0.0025 | -0.0006 (-0.0079) | -0.0005 | -0.0005 | -0.0004 |
| without pressure | -0.0006 | -0.0024 | -0.0011 (-0.0077) | -0.0005 | -0.0005 | -0.0004 |
| without play action | -0.0007 | -0.0021 | -0.0015 (-0.0059) | -0.0005 | -0.0005 | -0.0004 |
| without man / zone | -0.0007 | -0.0024 | -0.0021 (-0.0092) | -0.0005 | 0 | 0 |
| without box | -0.0008 | -0.0026 | -0.0021 (-0.0092) | 0 | -0.0005 | -0.0004 |

By season (each term alone, QB or TE): blitz +0.0015 (2022) and +0.0018 (2023) on QB, the only term
positive in both seasons, at less than a tenth of the margin; play action +0.0047 then -0.0055;
pressure +0.0007 then -0.0015; man/zone on TE -0.0006 then -0.0001. Every per-season row is in the
JSON (`comparisons.2022`, `comparisons.2023`).

Half and standard formats, all terms vs the sheet, both seasons: half -0.0008 (bound -0.0035), standard
+0.0004 (bound -0.0018). Places off for starters, both seasons: sheet 12.964, all terms 12.970, form
12.748.

## 4. How many player-weeks could use each term

A term needs at least 10 opportunities in the smaller arm of the player's history (plan §5); otherwise
it stays at 1 (fallback).

| Term | Position | 2022 used / rows (fell back) | 2023 used / rows (fell back) |
|---|---|---|---|
| blitz | QB | 303 / 304 (0.3%) | 305 / 306 (0.3%) |
| pressure | QB | 302 / 304 (0.7%) | 306 / 306 (0%) |
| play action | QB | 301 / 304 (1.0%) | 304 / 306 (0.7%) |
| man / zone | WR | 968 / 999 (3.1%) | 1,074 / 1,075 (0.1%) |
| man / zone | TE | 328 / 332 (1.2%) | 340 / 340 (0%) |
| box | RB | 416 / 643 (35.3%) | 587 / 723 (18.8%) |

Population rows: 2022 QB 304, RB 643, WR 999, TE 332; 2023 QB 306, RB 723, WR 1,075, TE 340. No
population row lacked a sheet, form or damped number. History was thin for nobody but backs facing
8-man boxes, so the null result is not a coverage artifact.

## 5. QB calibration, before and after

Round 4's G4 measured its simulation's range, which this probe does not have. The plan's stand-in is
rounds 2 and 3's residual range (10th / 50th / 90th residual percentiles by quintile of the number),
fitted on one season and measured on the other. Shares below the floor / above the ceiling / below the
median, sheet then sheet + terms (G4's bands: tails [0.06, 0.14], median [0.44, 0.56]):

| Fit, measured | Format | Below floor | Above ceiling | Below median |
|---|---|---|---|---|
| 2022, on 2023 (n 306) | PPR | 0.127 / **0.150** | 0.114 / 0.111 | 0.533 / 0.523 |
| | half | 0.131 / **0.150** | 0.111 / 0.108 | 0.533 / 0.523 |
| | std | 0.131 / **0.150** | 0.114 / 0.114 | 0.536 / 0.526 |
| 2023, on 2022 (n 304) | PPR | 0.082 / 0.079 | 0.102 / 0.105 | 0.441 / 0.454 |
| | half | 0.082 / 0.079 | 0.102 / 0.105 | 0.441 / 0.447 |
| | std | 0.082 / 0.079 | 0.102 / 0.105 | **0.438** / 0.451 |

Bold is outside G4's band. The terms do not repair QB calibration: on 2023 they push the floor share
out of the band in all three formats, on 2022 they move the median share into the band in standard.
Every position's cells are in the JSON (`calibration`); TE on 2023 (PPR) sits at 0.150 below and 0.141
above with the sheet, 0.153 and 0.144 with the terms. This range is not round 4's simulation, so these cells say nothing about why
round 4's QB range failed; they say only that the terms do not change a point's error distribution.

## 6. The baseline reproduced

On 2023 weeks 6 to 17 the probe's population matched round 4's development check in all 48 (week,
position) cells (the same counts); the spreadsheet's rho was identical in 41 cells and form's in 38,
with mean differences +0.0012 (sheet) and +0.0003 (form). The probe's sheet trails form on 2023 by
-0.0117 against round 4's recorded -0.0126 (the round 5 preregistration's figure). The differences are
the probe's own reads of a week's club and of last season's lines (weeks 1 to 17 here), not repaired
after the fact. Per-cell values are in the JSON (`reproduction_2023`).

## 7. Context, reported only

- The sheet against form, both seasons: -0.0009 (bound -0.0167); QB +0.0535, RB -0.0192, WR -0.0159,
  TE -0.0217. 2022 +0.0100, 2023 -0.0117.
- The round 5 preregistration's damped sheet, form x (A x T / T-own)^(1/2), against the sheet: +0.0152
  (bound +0.0053), QB +0.0026, RB +0.0161, WR +0.0158, TE +0.0265; 2022 +0.0114, 2023 +0.0191; against
  form +0.0144 (bound +0.0052). This is a reported row on two development seasons, not a test of round
  5's gate, and it reads 2022 as well as the 2023 round 5 will be checked on; it is noted because it is
  the one comparison here that moved.

## 8. How the season filter was enforced

- **Files:** only `pbp_participation_{2022,2023}.csv` and `ftn_charting_{2022,2023}.csv` were
  downloaded. `fetch.participation_frame` and `fetch.ftn_frame` call
  `admit_season(season, frozenset(PROBE_SEASONS))` before building the file name, and `fetch.ftn_record`
  refuses a row whose `season` differs from its file.
- **Dev queries:** `db.dev_reader` opens dev with `set transaction read only` and
  `guard_queries(conn, CLOSED_SEASONS)` (round 2's guard, `CLOSED_SEASONS = {2024, 2025, 2026}`), which
  refuses any statement whose season bind parameter names a closed season. Every probe query binds
  `seasons` after `admit_season` (`where season = any(:seasons)`, `admitted(seasons)` in `db.py` and
  `inputs.py`); `READABLE_SEASONS = {2021, 2022, 2023}`, with 2021 read only as last season's stat lines
  for recent form (`inputs.lines_of(conn, FORM_SEASON, ...)`).
- **Stat lines:** read through round 2's `WeekOutcomeReader(frozenset(CLOSED_SEASONS))`, which refuses
  2024 to 2026 and the pristine season.
- **The scratch:** `check_scratch_url(url, ("lane245_",))` on 5433; no write reached dev, production or
  port 5440. Seasons read, as the JSON records them: outcomes 2021, 2022, 2023; files 2022, 2023.
- **Order:** the plan commit `30126c32` precedes every commit that reads or reports an outcome.

## 9. Caveats

- Two seasons, 24 judged weeks. The pooled difference's standard error is about 0.0009 (the method
  review's figure), so the probe resolves pooled gains of about +/-0.002 and rules out pooled gains
  above about +0.001 for this form of the terms. The bar's +0.030 is far beyond what this form could
  deliver even if it were right: the review's oracle check found that a perfectly known 3 per cent
  per-player-week multiplier gains only about +0.001 to +0.002 rho, and a +0.030 gain would need a true
  per-player-week spread of about 10 to 15 per cent.
- The RB box term measured points per carry, touchdowns included (8+ box carries +0.216 and +0.221 a
  carry over lighter boxes), which is confounded by goal-line carries. It is not the yards per carry
  by box count the brief intended, so the RB result does not test that idea.
- The defence-rate prior (6 games toward the league, R4 2.4's construction) over-shrinks scheme rates
  by about 1.3 to 1.6 times (the method review's estimate), because a defence's scheme rate varies
  more between clubs than its points allowed. Undoing it would still leave the terms near +0.001 rho at
  best, so it does not change the call.
- The history window differs by season: 2023 rows see 2022 as well, 2022 rows see only 2022 before the
  week. 2022's pressure and man/zone columns miss about 11 per cent of dropbacks, and the man share of
  charted dropbacks rises from 29 to 42 per cent between the seasons, which looks like a charting change.
- The probe tests one design of the idea: multiplicative terms on the spreadsheet, the player's split
  times the opponent's rate. A fitted model (a tree on the same play-level features, round 5's model
  class) could find interactions this form cannot, and receivers' routes are not charted in a permitted
  feed, so on-field dropbacks stand in for routes.
- The baseline is the spreadsheet, not round 4's system, because the system cannot be measured on 2022
  without refitting it in a form nobody preregistered. The system equalled the spreadsheet on 2023
  (G6 +0.0002), so this is the same matchup structure the hypothesis attacks, but it is not the system.
- Calibration uses the rounds' residual range, not round 4's simulation (§5).

## 10. What "drop" covers

It covers only the form tested here: a multiplicative term of the player's own split times how often
this week's opponent uses the scheme, on the spreadsheet, in fantasy points. It does not test:

- the opponent's allowance split by scheme (what a defence gives up when it blitzes, pressures, or plays
  man or zone, rather than how often it does);
- per-dropback EPA or yards allowed in place of fantasy points (which keeps the cost of a sack);
- interactions of a defence's weakness with a player's strength;
- player sensitivities estimated from longer histories, or with a weighted or minimum-count moment fit;
- scheme rates as plain inputs to a fitted model (round 5's trees).

## 11. Recommendation: drop

On 2022 and 2023, multiplying the spreadsheet by scheme-matchup terms (opponent blitz, pressure and
play-action context for quarterbacks, man/zone for receivers, 8-man boxes for backs) left the weekly
order where it was: pooled -0.0009 against the +0.030 bar, QB -0.0021 and TE -0.0004, every term alone
within ±0.002 and none positive on QB or TE by more than a tenth of the margin in both seasons. The
shrinkage found little real player-to-player difference in how players respond to these schemes beyond
what a position-wide split already says, and removing it made the terms slightly worse. Neither amending
round 5 before its lock nor holding the feature group for round 6 is supported by these numbers, so the
recommendation is to **drop** scheme elasticity as a preregistered feature group. The FTN and
participation files remain available if a later model class wants the defence-side rates as plain
inputs; that is a different question from this one.
