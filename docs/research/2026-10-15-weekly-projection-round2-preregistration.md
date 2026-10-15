# The Weekly Projection, Round 2: Preregistration

**Written:** 2026-10-15, before any code, fit or judgment of this round, and before any outcome was
read by anything in it. Its author read documents and code only, and no database.
**Brief:** `.superpowers/sdd/2026-10-12-prep-site/lane-42-brief.md` (Lane 42), under the
coordinator's ruling of 2026-10-15 and the founder's directive that in-season tools carry equal
weight (2026-10-13).
**Round 1:** `2026-10-13-weekly-projection-preregistration.md` (committed `3beb44d1`) and
`2026-10-13-weekly-projection-results.md`. Its model, `commish_weekly_v1`, **failed on 2025 and
never ships**; nothing here reruns it, retunes it, or judges anything on 2025.
**Spec:** `docs/superpowers/specs/2026-10-15-in-season-tools-design.md` §2, §4, §9 and §10.1 (the
start-and-sit chance sentence, waiting on a weekly round that passes).
**The lock:** the coordinator's commit of this document. No fit of this round runs before it.
**Results:** `docs/research/2026-10-15-weekly-projection-round2-results.md` and `.json` beside it,
reporting every number named here whether it passes or not.

## Rulings this document is bound by

- **2026 outcomes are the pristine held-out year** (founder, 2026-09-02). No fit, tuning or gate of
  this round reads a 2026 outcome. G5 tests it at the reader.
- **A failed judgment is final** and is never rerun on the same season. 2025 is closed (three
  judgments, 178 cells: round 2 of the rest-of-season record, "The cost of looking at 2025 three
  times"). 2024 carries one rest-of-season judgment (round 3).
- **No weekly number reaches a screen until a weekly round passes** (founder, 2026-10-13; spec §2).
- **No mock data, no file-sourced data at runtime.** Every input is a stored observation; the fitted
  numbers, on a pass, live in `model_artifacts`, versioned and pinned.

---

## 1. Diagnosis of round 1, from its own results

Every number in this section is from `2026-10-13-weekly-projection-results.md` or its JSON
(`numbers.reported.per_week_rho`, 2025 weeks 1 to 17, PPR, round 1's population of players with an
ADP rank). The week splits are this document's arithmetic on that file's per-week rows, means over
weeks of the per-week differences. Nothing was refit and no 2024 number of round 1 was opened beyond
the gate summary its results document already prints.

**Where G1 (against ADP) failed: the first five weeks.** Model rho minus ADP rho, weeks 1 to 5 and
weeks 6 to 17:

| Position | Weeks 1-5 | Weeks 6-17 | All 17 (gated) |
|---|---|---|---|
| QB | -0.122 | +0.026 | -0.018 |
| RB | +0.042 | +0.115 | +0.094 |
| WR | -0.025 | +0.053 | +0.030 |
| TE | +0.009 | +0.043 | +0.033 |

ADP knows what a model shrunk toward last season's shares does not: rookies, new starters, players
who changed clubs. In weeks 1 to 5 that knowledge beats the model at quarterback by 0.12 rho. From
week 6 the model is ahead of ADP at every position, pooled +0.059 (the four positions' means
averaged).

**Where G2 (against recent form) failed: everywhere, because the model is recent form by week 6.**
Weeks 6 to 17, model minus form: QB -0.041, RB -0.003, WR +0.020, TE +0.027, pooled +0.0008. The fit
chose recency decay 0.7 and in-season shrinkage 0.25 (results, "The fit"), so after five games a
player's projected shares are mostly his own recent shares, and the rates are regressed toward his
position. The one input recent form lacks, the game context, moved only yards per carry, target and
attempt (elasticities 0.4357 passing, 0.4646 rushing), not the touchdowns or volume that carry most
of a week's points.

**Why so few gates could pass at all: the test asked for more than the data could show.** Round 1
gated each position separately with a Bonferroni level for ten comparisons, the 0.5th percentile of a
17-week block bootstrap, about 2.6 standard errors. The per-week differences have a standard
deviation of 0.04 to 0.18 rho by position (weeks 6 to 17: QB 0.163 against ADP and 0.138 against
form, RB 0.078 and 0.047, WR 0.106 and 0.069, TE 0.174 and 0.103), because a week's quarterback or
tight-end population is 16 to 27 players. At 2.6 standard errors over 17 weeks, a quarterback or tight
end needed about +0.10 rho to clear zero, more than ADP and form differ from each other at any
position (results, mean rho table). Running backs against form (+0.018, lower bound -0.016) show the
same: a real but small lead cannot clear that bar.

**G3 (places off) failed the same way.** Pooled 10.67 for the model against 10.98 for ADP and form, a
lead of 0.31 places with lower bounds of -0.25 and -0.22.

**G4 failed at quarterback only.** Below the floor 0.166 in all three formats, above the ceiling 0.126
to 0.123, n = 604; the other nine cells ran 0.072 to 0.108. On 2024 (development check) all twelve
cells passed, so the quarterback left tail moves from season to season: a quarterback who records a
line but leaves hurt or is benched scores far below any bucket's 10th percentile.

**What the rest-of-season model does differently, and what its rounds showed.**

1. Its prior is the preseason board's points a game (from round 2 on, the raw board's line), which
   carries ADP's knowledge, not last season's shares. That is the thing round 1 lacked in weeks 1-5.
2. It shrinks a per-game rate, not shares: m = (k p + G u) / (k + G), u = alpha r + (1 - alpha) o,
   with r points a game so far and o *opportunity points* (an ordinary least-squares line of a game's
   points on its targets, carries, pass attempts and snap share). Opportunity points are a less noisy
   reading of a player's role than his points.
3. It is served only from week 6 (founder, 2026-10-15; round 3 results, "Switch week moved to 6"),
   and judged at weeks 8 and 12, where round 3 beat the stale board in all 24 cells by +0.066 to
   +0.284 rho.
4. Its target sums many weeks, so week-to-week noise averages out. Its edge over the stale board is
   large; its edge over form is not: on 2024 (round 3), season-to-date form ordered about as well
   as the model, better at week 8 for QB, RB and WR rho (round 3 results, "Reading the result").

**What follows for round 2.** Start from the rest-of-season model's rate, which carries the preseason
board, the opportunity line and a fitted shrinkage, and add the one thing a single week has that a
season does not: this week's opponent, on points. Judge only the weeks it is served (6 to 17). Gate
the claim a member relies on, "better than ADP and better than his recent form, and no position
worse", with a test that 12 weeks can answer. The hard gate remains G2: nothing in round 1 or the
rest-of-season record shows a source beating recent form on single weeks, and this document
expects G2 to be the gate that decides.

---

## 2. The basis: `commish_weekly_v2`

### The model (candidate A, the one judged)

For a season S, a week W in 6..17 and a player i at position p, the projection is made at **one
millisecond before week W's first kickoff** (`model.weekly.inputs.week_moment`) and sees only what is
stamped at or before it.

1. **The rate.** m_f, the rest-of-season model's points a game in format f
   (`model.ros.model.per_game`), with `commish_ros_v3`'s fitted numbers exactly as judged in round 3
   (fit 2021-2023; artifact `model/ros-priors` v1, which `model/ros/ship.py` publishes only when equal
   to the judged record). Nothing in it is refit or retuned. The universe, the season-aware club rule,
   the raw-line prior and the off-board rate are round 3's.
2. **This week's opponent.** c_W = bounded(D_pass ^ e_pass,p x D_rush ^ e_rush,p), bounded to
   [0.8, 1.25] by round 1's `bounded`. D_pass and D_rush are the opponent's pass and rush defence
   ratings for week W, `commish_opponent_adjustment` (`pipeline.nflverse.context.defence_ratings`: yards
   allowed per dropback and per carry against what the offences it faced usually gain, shrunk; this
   season's completed weeks, last season's before any), as stored for his club's week-W game. A
   missing rating takes 1.
3. **The week's number.** x_W,f = m_f x c_W: his points in format f **if he plays**. Its sum over his
   club's remaining weeks is m_f x (sum of c_w); the served rest-of-season figure R_f = m_f x E is not
   changed by this round, and the two differ by the remaining schedule's strength, which the board
   does not price.
4. **The week's designation.** A player whose latest filing stamped at or before the moment lists him
   Out or Doubtful for week W gets **no weekly number** (spec §4.2 keys 1 and 2, as a rule of the
   board). Questionable keeps the number and the flag. The designation is a filter, not a fitted
   multiplier: in replay it comes from nflverse's filings (stamped `date_modified`, present for 2013
   to 2024 per `pipeline/nflverse/injury_archive.py`), live from the Tank01 captures the API already
   reads, and a multiplier fitted on one source and run on the other would not be the model judged.
5. **The range.** Residuals (actual minus x) over the fit population, per position, format and
   quintile of x (edges at the 20th, 40th, 60th and 80th percentiles of the fit population's x),
   stored as the 1st to 99th percentiles (numpy linear). Floor max(0, x + q10), median
   max(0, x + q50), ceiling max(0, x + q90). Round 1's method, on round 2's centre.
6. **The chance sentence.** For two players A and B: the share of the 99 x 99 pairs of their buckets'
   residual percentiles in which max(0, x_A + a) exceeds max(0, x_B + b), ties counted half. The
   residuals are taken as independent (two players in one game are not); the sentence is conditional
   on both playing and says so.

**Fitted in this round, and nothing else:** e_pass,p and e_rush,p for each of QB, RB, WR, TE, by grid
search over {0, 0.1, ..., 1.0} x {0, 0.1, ..., 1.0} (121 cells), minimising the sum over the fit
population of (actual PPR points minus m_ppr x c_W)^2, ties to the smaller e_pass then e_rush, used in
all three formats; and the range percentiles. **Fit seasons 2021, 2022, 2023, weeks 6 to 17**,
refused 2024, 2025 and 2026 by name. The fit population is the judgment population (below) on the fit
seasons, with m from the round-3 priors (in sample for the rate on those seasons, named as such).

### The inputs, every one already in the store

| Input | Table or artifact | Seasons read |
|---|---|---|
| Stat lines and participation before week W | `player_week_observations` (published lines) | fit 2021-2023, judged 2024 weeks 1 to W-1 |
| Club edges | `player_week_teams` | the same |
| Schedule, opponents, kickoffs, byes | `nflverse_schedule`, `team_week_observations` | 2021-2024 |
| The preseason board and raw line at the replay moment | built by `model.preseason.persist.build_season` from `preseason_rosters` and history | 2021-2024 (round 3 built each) |
| The rest-of-season priors | `model/ros-priors` v1 (round 3's record) | fit 2021-2023 |
| Opponent ratings | `team_week_observations`, source `commish_opponent_adjustment` | 2020-2024 |
| Designations | `player_week_observations` metric `injury_report_status` (nflverse filings) | 2021-2024 |
| ADP (benchmark only) | `preseason_rankings` `ffc_adp_ppr_12` | 2023, 2024 |

**No input is a 2026 outcome.** The fit reads 2021-2023, the judgment 2024. Live in 2026 the inputs
are the weeks before W, the same season-so-far store the served rest-of-season board already reads.

### Candidate B, for comparison (not judged)

**A weekly opportunity line:** per position and format, an ordinary least-squares line of a week's
points on the player's season-to-date mean targets, carries, pass attempts and snap share, the same
over his last three games, the preseason board's points a game, and log D_pass and log D_rush, fit on
2021-2023 weeks 6 to 17. It targets the week directly and may order better within a week.

**Why A is the one judged.** A adds 8 fitted numbers (two elasticities per position) to a rate that
was judged on held-out data; B fits 10 coefficients per position and format (120), none judged. A's
week number and the served order share one rate, so start-and-sit and waivers cannot disagree about a
player's level (the FantasyPros complaint in spec §2); B's could. Judging both on 2024 would double
the comparisons and invite picking the winner on the judgment season. B is recorded here so a later
round may preregister it on a clean season.

---

## 3. The judgment season and weeks

**2024, weeks 6 to 17**, each at its moment, against each player's published week-W line
(`stat_lines_for_measurement`, read at the far future so a correction counts). Read once. Week 18 is
excluded before reading (rested starters; most leagues end at 17). Weeks 1 to 5 are not judged and
carry no weekly number: the rate is served from week 6.

**Why 2024, and what it already carries.**

- **The rest-of-season judgment on 2024 (round 3)** gated rho and starters' rank error of
  rest-of-season points at weeks 8 and 12 (24 G1 cells, 24 G2 cells, G4). This round's statistics are
  single-week rho, places off and calibration at weeks 6 to 17. **No round-3 cell is recomputed and no
  round-3 verdict can change.** The two are not independent: the week-8 and week-12 rates are the
  same, and weeks 8 to 17's single-week outcomes are the parts of the round-3 sums. Weeks 6 and 7 were
  read by round 3 only as inputs.
- **Round 1's development check on 2024** (fit 2021-2023) computed single-week ordering for round 1's
  model, ADP and form at weeks 1 to 17; its gate summary is printed in the round-1 results and was
  read in writing this. Its per-week rows (`2026-10-13-weekly-projection-dev-check.json`) were not
  opened. ADP's and form's 2024 single-week orderings are therefore on record, and this design was
  chosen by people who have read that summary.
- **2024 was a fit season** of round 1 (2021-2024) and of rest-of-season rounds 1 and 2 (2023-2024).
  None of those fitted numbers is used: the rate is round 3's (2021-2023), and this round fits on
  2021-2023.

A pass on 2024 is therefore weaker evidence than a first look at an untouched season, and the results
will say so beside the verdict. It is the cleanest season the store holds for this target:

- **2023 is excluded** as the judgment: it is a fit season of the rate (round 3) and of round 1. It
  serves as the development check, where it is out of sample (below).
- **2021 and 2022** are fit seasons of the rate and of the preseason priors.
- **2020 and earlier** cannot build the preseason board as a live board is built (it reads three prior
  seasons of published lines, and 2019 has none: `STAT_LINE_GAPS`).
- **2025** is closed. **2026** is pristine and, on a pass, is registered prospectively: the register's
  weekly pass freezes each week's numbers before its first kickoff, graded only after the season.

---

## 4. The gates

### Population and statistics

**Population** at (W, p), defined without the model: players at p who recorded a 2024 week-W line
and are in the union of ADP's top K at p and the top K at p by season-to-date PPR points (weeks before
W), K = QB 36, RB 72, WR 108, TE 36 (the rest-of-season rounds' K). Every source is scored on the
same players; a player a source has no opinion on (off ADP, filtered by the designation rule, no line
this season or last for form) ranks below every player it has, ties averaged. Round 1's population
(ADP-ranked players only) favoured ADP by dropping the breakouts it missed.

**Sources:** the model's x_W,ppr; **ADP** (2024 `ffc_adp_ppr_12`, ordered within position, static);
**recent form** (round 1's: mean PPR points a game over this season's weeks before W with a line,
else last season's).

- **S1, ordering.** Spearman's rho between a source's order and actual PPR points, per (W, p) with at
  least 8 players. Per position, the mean over weeks of (model rho minus benchmark rho). **Pooled:**
  the mean over weeks of the per-week mean over the four positions, over weeks where all four answer.
- **S2, places off.** Round 1's: within (W, p), ranks by source and by actual points; over players
  whose actual rank is within the starters (QB 12, RB 24, WR 24, TE 12), the mean absolute rank
  difference, pooled over positions and weeks.
- **S3, range.** Over every player-week with a number and a line (the whole board), per position and
  format: share below the floor and share above the ceiling.
- **S4, chance.** Over every same-position pair in each week's population, both with a number, PPR:
  the favourite's chance from item 6 in five bins ([0.5, 0.6), [0.6, 0.7), [0.7, 0.8), [0.8, 0.9),
  [0.9, 1.0]); per bin, the mean chance and the share of pairs the favourite outscored (ties half).

**Uncertainty:** a week-block bootstrap over the 12 judged weeks, 10,000 resamples, numpy
`default_rng(42)`, the same resampled weeks for every comparison; the lower bound is the 2.5th
percentile of the bootstrapped difference.

### Gates (all must pass; a gate that cannot answer fails)

| Gate | Threshold | Basis for the number |
|---|---|---|
| **G1, against ADP** | Pooled model minus ADP rho **>= +0.04**, bootstrap lower bound **> 0**; each position's mean **>= -0.02** | +0.04 is the rest-of-season rounds' doubled margin (rounds 2 and 3). Round 1's weeks 6-17 pooled lead on 2025 was +0.059 with a per-week SD of 0.065 (section 1). -0.02 is round 1's quarterback miss (-0.018) rounded: no position may trail ADP by more than round 1's worst. |
| **G2, against recent form** | Pooled model minus form rho **>= +0.02**, bootstrap lower bound **> 0**; each position's mean **>= -0.02** | +0.02 is round 1's G2 margin, unchanged. Round 1's weeks 6-17 pooled lead was +0.0008 (per-week SD 0.044), so round 1's model would fail this gate. At that SD over 12 weeks the lower bound clears zero from about +0.025. |
| **G3, places off** | Pooled model places off at least **0.25** fewer than ADP's and than form's (point comparisons) | Round 1's measured lead was 0.31 against each, which its 0.5 margin with a bootstrap bound could not confirm. G3 here is a guard that the starters are not placed worse, as the rest-of-season G2 was a point comparison. |
| **G4, calibration** | Each of 12 cells (4 positions x 3 formats): below floor and above ceiling each within **[0.05, 0.15]**, n >= 100. Chance bins: in each bin with at least 200 pairs, observed minus mean chance within **+-0.05**; at least three bins gated | [0.05, 0.15] is round 1's band (9 of 12 cells inside on 2025, 12 of 12 on 2024's check). +-0.05 is the same half-width applied to the chance the sentence prints. |
| **G5, isolation** | The fit's outcome reader serves only 2021-2023 and refuses 2024-2026; the judgment's serves only 2024 and refuses 2025 and 2026; `preseason_projections`, `preseason_board_reasons`, `register_freeze_rows`, `register_grade_rows`, `model_artifacts` digest the same before and after | Rounds 1 to 3's isolation gate, with the readers' seasons moved. |

Gate lines: G1 5, G2 5, G3 2, G4 13 (12 cells and the chance line), G5 1: **26**. Thresholds in one
constant (a `ROUND_TWO` in the round's `gates.py`), read by the judgment and any later harness, with
a test at each threshold.

### Multiple comparisons

Two comparisons are tested with the bootstrap, the pooled G1 and G2. Each is held at a one-sided 0.05
/ 2 = 0.025, the 2.5th percentile. Every other line is a tolerance or point guard; the gates are
conjunctive, so adding lines only makes passing harder. Pooling is the change from round 1: a pass
says "better than ADP and than form across positions, and no position worse than 0.02 rho", not
"better at every position". Round 1's per-position test needed about +0.10 rho at quarterback and
tight end (section 1), which no weekly source shows.

**Reported, not gated:** each position's rho for every source and format; half PPR and standard; S2
per position; S4 in half and standard and for cross-position flex pairs; MAE and RMSE of x; the rate
without the opponent factor (m_f alone, the factor's ablation); the preseason board's points a game
as a source; the fitted elasticities and percentiles; round 1's population as a second view.

### Development check, and what it may change

The identical code once, before the judgment: the rate from round 3's development-check priors (fit
2021-2022, `2026-10-14-rest-of-season-round3-dev-check.json`), the elasticities and range fit on
2021-2022, judged on **2023 weeks 6 to 17** against 2023 ADP and form. 2023 is a fit season of the
final model, so its numbers decide nothing. Recorded in
`2026-10-15-weekly-projection-round2-dev-check.json`. After it only **defects** may change (code that
does not do what this document says), each recorded here as an amendment and committed before the
judgment. No model choice, grid, population, statistic, threshold, seed or judged week changes.

### Decision rule

**If every one of the 26 lines passes on the one judgment of 2024 weeks 6 to 17, the weekly number
ships; if any line fails or cannot answer, nothing ships and neither this model nor a retune of it is
judged on 2024 again.**

- **On a pass:** the nightly writes, from week 6 of the product season (the run date against the
  first kickoff, never a flag), each player's `week_points` per format with floor and ceiling onto
  `PlayerLine` (spec §9), and rows beside the boards with `model_version` and
  `implementation = 'python'`; the register's weekly pass freezes them before each week's first
  kickoff, so 2026 is graded prospectively. The order key in spec §4.2 becomes `week_points` after the
  hard facts. Each start-and-sit change gains the chance sentence ("White scores more than Bigsby in
  about 62 of 100 weeks like this, if both play"; no betting words). The honesty line "We do not
  project a week's points" is replaced by the number's basis. The fitted numbers go to
  `model_artifacts`, pinned. Two build items come first: the in-season pass gains the opponent
  adjustment step (`ingest_opponent_defence`, reading the play-by-play `season-week` already ingests),
  and the API maps Tank01's designations to the filter.
- **On a fail:** nothing ships. The screens stay as they are; the results report every number.

### What would make this document wrong

A judgment run more than once, or after any change not recorded as a defect amendment here, voids it;
the results file must then say so.

---

## 5. Cost, time and who runs it

**Compute, estimated from the earlier rounds' measured times on the founder's laptop:** round 1's
fit took 2,342 s, nearly all its share search (720 cells over 72 weeks); this round has none. Round 3's
fit and judgment together ran in under two minutes (each season's stale board about 12 s, each week's
inputs under a second; results, "The fit" and round 1's "Cost"). This round builds four boards
(about 50 s), reads 36 fit weeks and 12 judged weeks of inputs (under a minute), searches 121 cells for
each of four positions over arithmetic already in memory (seconds), and bootstraps 10,000 resamples of
12 weeks. **Estimate: under 10 minutes for the development check and the judgment together;** the
results report the measured times. No model call and no prose: the round spends nothing.

**Who runs it:** the coordinator, never a subagent, on a scratch copy named `lane42_weekly` on the
local test server (port 5433), restored from a dump of the dev copy's `research` schema. Never dev
(5432) and never production. The round's scratch guard admits only a `lane42_` database on 5433
(`model/ros/scratch.py`'s rule, its prefix changed).

**Preconditions, checked on the scratch copy before any fit and recorded in the results:** stamped
2021-2024 filings in `injury_report_status` (if absent, the house's `ingest_injury_reports` adds them;
if 2024's cannot be stamped, the round stops with nothing read); `commish_opponent_adjustment` rows for
2021-2024; 2023 and 2024 `ffc_adp_ppr_12` rows; the four preseason boards building at their replay
moments; and round 3's priors refit on 2021-2023 equal to its record.

**Order, each step committed before the next:** (1) this document, the lock; (2) the round's code and
tests; (3) the development check on 2023 and its record, with any defect amendment; (4) the judgment,
once; (5) the results.
