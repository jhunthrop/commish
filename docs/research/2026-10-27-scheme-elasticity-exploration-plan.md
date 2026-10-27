# Scheme elasticity, an exploration: the plan (written before any outcome is read)

**Written:** 2026-10-27 by Lane 245, before the probe read any fantasy point, any stat line, any
play's yards, touchdowns or completions, or any metric computed against outcomes. Up to this commit
the probe has read: the round 4 preregistration and results record, the round 5 preregistration's
backtest section, the house code (`research/model/weekly2`, `weekly3`, `weekly4`), the dev schema's
table and column names, the play table's role columns (who dropped back, carried, was targeted; no
yards, no result), and the two downloaded nflverse files' scheme columns (counts of populated values
only, section 2).

**What this is.** An exploration for the founder, not a round. It promotes nothing, serves nothing,
amends nothing and touches no served path, production database or schedule. Its one output is a
recommendation of exactly one of: amend round 5 before its lock, hold for round 6, or drop.

**The question.** Round 4's development check (results record §2) roughly tied the expert's three-fact
spreadsheet and failed G2 and G6, with quarterbacks and tight ends the failing positions (QB
calibration failed in all three formats). The hypothesis under test: the weakest link is the single
"the opponent allows X to position Y" number, and a matchup-elasticity term (the player's production
split by a scheme feature, times how often this week's opponent uses that feature) helps QBs and TEs
most.

## 1. Seasons, and how the window is enforced

- **Seasons read: 2022 and 2023 only**, plus 2021 stat lines for one purpose: the rounds' recent form
  falls back to last season's lines for a player with no game yet this season (round 4's benchmark,
  verbatim). No 2024, 2025 or 2026 outcome or feature row is read.
- **Files:** only `pbp_participation_2022.csv`, `pbp_participation_2023.csv`, `ftn_charting_2022.csv`
  and `ftn_charting_2023.csv` are downloaded (`research/explore/scheme_elasticity/fetch.py`: each
  file's season passes `admit_season` against {2022, 2023} before its name is built; an FTN row whose
  `season` differs from its file is refused).
- **Queries:** dev (`localhost:5432`) is opened in a `set transaction read only` connection carrying
  round 2's `guard_queries` on {2024, 2025, 2026}, which refuses any statement whose season bind
  parameter names a closed season before it runs; every probe query binds its seasons as `seasons`
  after `admit_season`. Stat lines are read through round 2's `WeekOutcomeReader` with
  {2024, 2025, 2026} refused. Writes go only to `lane245_scheme` on 5433 (`check_scratch_url` with the
  `lane245_` prefix).
- **Why 2022 to 2023:** FTN charting begins in 2022, so a blitz or play-action split has no earlier
  season. Round 4 judged 2023 weeks 6 to 17 in its development check (its fit used 2021 and 2022);
  2023 was never judged by any round's single judgment, and reading it here is allowed by the brief.
  The brief's premise "round 4's development check ran on 2021 and 2022 rows" is corrected: the check
  fitted on 2021 and 2022 and was measured on 2023 weeks 6 to 17 (results record §2). It changes
  nothing in this plan.

## 2. Column coverage (measured before this design, no outcome read)

Share of the plays each column applies to that carry a value, regular season, weeks 1 to 17. Scored
dropbacks (a dropback that is no two-point try, kneel or spike) for the pass columns; designed runs (a
carry that is no dropback, two-point try or kneel) for the box counts. Participation and FTN rows are
joined to the play table on `(game_id, play_id)`.

| Column | Plays | 2022 populated | 2022 share | 2023 populated | 2023 share |
|---|---|---|---|---|---|
| participation `was_pressure` | dropbacks | 17,006 / 19,074 | 0.892 | 19,589 / 19,589 | 1.000 |
| participation `defense_man_zone_type` | dropbacks | 16,980 / 19,074 | 0.890 | 19,509 / 19,589 | 0.996 |
| participation `defense_coverage_type` | dropbacks | 16,980 / 19,074 | 0.890 | 19,509 / 19,589 | 0.996 |
| participation `number_of_pass_rushers` | dropbacks | 19,052 / 19,074 | 0.999 | 19,583 / 19,589 | 1.000 |
| participation `offense_players` | dropbacks | 19,074 / 19,074 | 1.000 | 19,589 / 19,589 | 1.000 |
| FTN `n_blitzers` | dropbacks | 19,074 / 19,074 | 1.000 | 19,589 / 19,589 | 1.000 |
| FTN `is_play_action` | dropbacks | 19,074 / 19,074 | 1.000 | 19,589 / 19,589 | 1.000 |
| participation `defenders_in_box` | designed runs | 12,597 / 12,614 | 0.999 | 12,323 / 12,323 | 1.000 |
| FTN `n_defense_box` | designed runs | 12,614 / 12,614 | 1.000 | 12,323 / 12,323 | 1.000 |

Every feature the brief names is available for both seasons; none is dropped. Two cautions recorded
before any outcome: 2022's pressure and man/zone columns miss about 11 per cent of dropbacks (a play
without the value is left out of that feature's rates and splits, never filled), and the man share of
charted dropbacks moves from about 29 per cent (2022) to about 42 per cent (2023), which looks like a
charting change between seasons, not a league change. Rates are therefore always measured against the
same season's league rate, never across seasons.

## 3. The baseline, and why this one

**The expert's three-fact spreadsheet, as round 4 preregistered it (R4 §3.1), term for term,** computed
by round 4's own functions (`research/model/weekly4/benchmarks.py`: `points_allowed`, `baseline`):
form x A x (T / T-own). Form is the rounds' recent form (mean PPR points a game this season before W,
else last season's), in each format. A is the opponent's PPR points allowed to the position per game in
its games of weeks before W over the league mean per team-game over the same weeks, shrunk toward 1
with 6 games of prior. T is the club's implied points (`nflverse_kickoff` `implied_team_total`); T-own
is the club's mean implied points over its games of weeks before W this season (the league mean when it
has none). A player with no club or opponent that week takes A and T / T-own at 1, counted.

**Why not round 4's system.** The full system needs its feature store, the play and team models fitted
on 2016 to 2022, and about 4,000 s of fit per check; it is not built for 2022 as a measured season (its
player models fit 2021 and 2022), so it cannot be reproduced on 2022 to 2023 without refitting it in a
form no one preregistered. The spreadsheet can be computed point-in-time on both seasons with no fit,
and round 4 found the system equal to it (G6 pooled +0.0002), so it carries the same matchup structure
the hypothesis attacks: the single "A" number per opponent and position.

**Reproduction check.** On 2023 weeks 6 to 17 this probe's spreadsheet is compared with round 4's
recorded spreadsheet (its development-check JSON, per week and position, read only after this commit).
The round 5 preregistration records the sheet's lead over form on 2023 as -0.0126. The results report
the probe's figure beside it and every week where they differ; a difference is a population or form
detail of this probe (section 4), and is reported, not fixed after the fact.

**Reported beside it, not part of the bar:** the damped sheet of the round 5 preregistration,
form x (A x T / T-own)^(1/2), and the rounds' recent form.

## 4. The population and the metric (round 4's, verbatim where it can be)

- **Population (R4 §3.1, "round 3's, unchanged"):** "Players with a week-W line in the union of ADP's
  top K and the season-to-date top K, K = QB 36, RB 72, WR 108, TE 36." ADP is `ffc_adp_ppr_12` from
  `preseason_rankings`, the season's newest row per player, ranked within position (round 2's
  `population` function is called with it). Season-to-date is PPR points over weeks before W. A
  week-W line is a stat line in week W read through round 2's outcome reader. The probe builds this
  population itself from those definitions (round 3's own reader needs round 3's rate artifacts for
  2022, which no round fitted); the reproduction check of section 3 is where any difference shows.
- **Weeks:** 6 to 17 of 2022 and of 2023, 24 weeks. Week keys are season x 100 + week.
- **S1:** Spearman rho per (week, position) with at least 8 players, PPR (the gated format); half and
  standard reported. **Pooled = the mean over weeks of the four-position mean**, round 2's
  `ordering_difference`. A source with no number ranks the row below every row it has, ties averaged
  (the fill rule), identically for every source.
- **Uncertainty:** the week-block bootstrap over the 24 weeks, 10,000 resamples, `default_rng(42)`, the
  lower bound read at the **1.667th percentile** (round 4's level, `weekly4.gates.DEVELOPMENT_CHECK`
  statistics). Each season's 12 weeks are also reported alone with their own bootstrap.
- **Places off** for starters (QB 12, RB 24, WR 24, TE 12): reported.

## 5. The elasticity terms, defined exactly

Common to every term. Play-level PPR points use the house scoring (`domain.py`): 0.04 a passing yard,
4 a passing touchdown, -2 an interception, 0.1 a rushing or receiving yard, 6 a rushing or receiving
touchdown, 1 a reception (PPR). Sacks score 0. Fumbles are left out of play-level points (the play
table does not name the fumbler). "History" for a player at week W of season s is his plays in weeks
before W of season s, plus all of 2022 when s = 2023 (2021 has no FTN file in the window, so 2022 rows
use this season only; the results report the two seasons apart because of it). "Defence rates" use
season s weeks before W only, since schemes change with coordinators. All plays are regular season.

**Defence rates are shrunk with the house matchup shrinkage:** rate_D = (g x raw_D + 6 x league) /
(g + 6), g the defence's games before W this season, league the same-season rate over weeks before W
(`ALLOWANCE_PRIOR_GAMES` = 6, R4 §2.4's construction).

**Player splits are shrunk with the house efficiency shrinkage (R4 §2.3, `weekly4.shrinkage`):**
the empirical-Bayes normal posterior, posterior = (n / (n + k)) x observed + (k / (n + k)) x prior,
k = noise / tau^2, tau^2 by the method of moments (`moment_fit`, unweighted, as 2.3 is written), full
pooling when tau^2 <= 0 (counted). For a split, observed d = e_c - e_n (mean points per opportunity
in the condition minus out of it), n = n_c x n_n / (n_c + n_n) (the effective count of a difference of
two means), noise = the position's pooled within-arm variance of points per opportunity, prior = the
position's pooled d (all players at the position, the same history window). The moments are fitted
per (position, term, week W) on that week's histories, so every input is point-in-time.

**The multiplier of one term** for player i against opponent D:

    m = 1 + s_i x r_i x (r_D / r_league - 1) x d_post / e_i

r_i is the share of his own history's opportunities in the condition, r_D / r_league the opponent's
shrunk rate over the league rate (so his own mix is scaled by how much more or less D uses the
feature), d_post his shrunk split, e_i his mean points per opportunity, and s_i the share of his
history's play-level points that came from the term's opportunity kind (so a term that only touches
his carries moves only that part). r_i x r_D / r_league is capped at 1. The play-action term has its
own form below. Every m is capped to [0.80, 1.25]; the results count the capped rows.

| Term | Positions | Opportunity | Condition | Opponent rate |
|---|---|---|---|---|
| `blitz` | QB | his scored dropback | FTN `n_blitzers >= 1` | share of D's opponents' dropbacks blitzed |
| `pressure` | QB | his scored dropback with `was_pressure` populated | `was_pressure` true | share of D's opponents' dropbacks pressured |
| `play_action` | QB | his scored dropback | FTN `is_play_action` | (defence-side, below) |
| `man_zone` | WR, TE | a scored dropback of his club with him in `offense_players` and `defense_man_zone_type` populated | `MAN_COVERAGE` | share of D's charted dropbacks in man |
| `box` | RB | his designed carry | `defenders_in_box >= 8` (FTN `n_defense_box` when the participation value is missing) | share of D's designed runs faced with 8 or more in the box |

The receiver's points per on-field dropback combine target share and yards per target, the nearest
measure to yards per route that the permitted feeds allow (no feed names who ran a route).

**The play-action term** follows the brief's wording (the opponent's play-action-allowed context and
the QB's play-action rate): a_D,pa and a_D,np are the points per dropback D allowed to quarterbacks
on play action and off it (weeks before W, each shrunk toward its league value with the 6-game
construction), p_i the quarterback's play-action share of his history's dropbacks, p_league the
league's. m = [(1 - p_i) a_D,np + p_i a_D,pa] / [(1 - p_league) a_D,np + p_league a_D,pa], times s_i
as above (m = 1 + s_i x (ratio - 1)), capped the same way.

**The minimum split history, and the fallback.** A term is used for a player-week only when the
smaller arm of his history holds **at least 10 opportunities** (blitzed and not, pressured and not,
play action and not, man and zone, 8+ box and lighter) and e_i > 0. Otherwise that term's m is 1 (the
row keeps the baseline's number for that term). The results report, per term, position and season, the
rows that used it and the share that fell back.

**The combined number:** baseline x the product of the player's terms' m, the same m in every format.

## 6. The comparison

- **Primary:** baseline + all terms against the baseline, on the same population rows (PPR rho,
  pooled over the 24 weeks with the bootstrap bound, and by position).
- **Ablation, reported in full:** each term alone (baseline x that term's m), and each term removed
  (baseline x every other term).
- **Beside it, for context:** each source against recent form (round 4's G2 framing), the damped
  sheet, the per-season tables, half and standard formats, places off.
- **QB calibration, before and after,** the way rounds 2 and 3 measured a point's range (the
  residual-percentile range of `weekly2.band`): per position and format, the residuals (actual minus
  number) of one season's weeks 6 to 17 cut into quintiles of the number, each quintile's 10th, 50th
  and 90th percentiles giving floor max(0, x + q10), median max(0, x + q50), ceiling max(0, x + q90);
  applied to the other season's rows (fit 2022 measure 2023, and fit 2023 measure 2022), the shares
  below the floor, above the ceiling and below the median are reported for the baseline and for
  baseline + all terms, against round 4's G4 bands ([0.06, 0.14] for the tails, [0.44, 0.56] for the
  median). Round 4's G4 measured its simulation's range; this probe has a point only, so the range is
  the rounds' earlier residual range, stated as the nearest reproducible form. All four positions are
  reported; QB is the one the brief asks for.
- Seeds: the bootstrap's `default_rng(42)`; nothing else in the probe is random.

## 7. The bar, fixed here

Recommend a preregistered feature group ("amend round 5 before lock" or "hold for round 6") only if
**all** of:

1. Baseline + all terms minus the baseline, pooled PPR rho over the 24 weeks, **>= +0.030** (round 4's
   G2 margin) with the bootstrap lower bound (1.667th percentile) **> 0**;
2. **QB or TE individually improves past its floor:** the QB difference or the TE difference is
   positive, and no position's difference is below round 4's position floor of **-0.02** ("each
   position >= -0.02", R4 §3.2);
3. the pooled difference is positive in each season alone (a reading added here because the history
   windows differ between the seasons, section 5).

Anything less is reported as **"no"**.

Which one of the three recommendations follows:

- **Amend round 5 before lock:** conditions 1 to 3 hold, and the QB or TE difference that satisfies
  condition 2 is positive in each season alone. (An amendment would add the two files as an ingest,
  since neither is in round 5's store; the results say what that costs.)
- **Hold for round 6:** conditions 1 to 3 hold but the QB/TE gain is not positive in both seasons; or
  the bar fails but one term alone, on its own position (QB or TE), shows a difference of at least
  +0.030 with a bootstrap lower bound above 0 and a positive sign in each season.
- **Drop:** otherwise.

## 8. What the results will hold

`docs/research/2026-10-27-scheme-elasticity-exploration-results.md` and a JSON record beside it: the
reproduction check, the coverage table, per-term use and fallback counts, capped counts, fully pooled
shrinkage cells, the primary comparison and the ablation by position and pooled with bounds, the
per-season tables, the comparison with form and the damped sheet, the calibration tables, the season
filter lines, the caveats, the one-command reproduction and one recommendation, written as an
exploration: no sentence claims the model improved.
