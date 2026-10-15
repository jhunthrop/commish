# The Weekly Projection, Round 3: Preregistration (the usage regression)

**Written:** 2026-10-15, before any code, fit or judgment of this round, and before any outcome was
read by anything in it. Its author read documents, code and the two development records. Its only
database reads were of the dev copy (port 5432), read-only: row counts and season coverage of the
inputs, the 2021-2023 filing stamps against kickoffs (section 3), the spread of the stored 2023
opponent ratings (section 1), and the `model_artifacts` versions and their `fitted_on` text
(section 4). No outcome of any season was read and no 2024 row beyond a count.
**Revised** the same day after the pre-lock review
(`.superpowers/sdd/2026-10-12-prep-site/reviews/lane-47-prereg-review.md`, 7 HIGH, 8 MEDIUM, 8 LOW)
and the coordinator's rulings on it. Every threshold is as first written.
**Brief:** `.superpowers/sdd/2026-10-12-prep-site/lane-47-brief.md` (Lane 47), under the
coordinator's ruling of 2026-10-15 and the founder's directive that in-season tools carry equal
weight (2026-10-13).
**Round 1:** `2026-10-13-weekly-projection-preregistration.md` (lock `3beb44d1`) and its results.
`commish_weekly_v1` failed on 2025 and never ships.
**Round 2:** `2026-10-15-weekly-projection-round2-preregistration.md` (lock `86ca79d6`) and
`2026-10-15-weekly-projection-round2-dev-check.md` with its JSON. `commish_weekly_v2` failed its
development check on 2023 at the gate named as decisive, and its judgment on 2024 was not run.
**The lock:** the coordinator's commit of this document. No fit of this round runs before it.
**Results:** `docs/research/2026-10-15-weekly-projection-round3-results.md` and `.json` beside it,
reporting every number named here whether it passes or not.

## Rulings this document is bound by

- **2026 outcomes are the pristine held-out year** (founder, 2026-09-02). No fit, tuning or gate of
  this round reads a 2026 outcome. G5 tests it at the reader.
- **A failed judgment is final** and is never rerun on the same season. 2025 is closed (three
  rest-of-season judgments and round 1). 2024 carries one rest-of-season judgment (round 3 of that
  record, weeks 8 and 12, a different target) and no weekly judgment. Its other exposures are named
  in section 4.
- **Preregistered thresholds never move after a check.** This round's numbers are set here, from
  rounds 1 and 2's measured gaps, before any fit of round 3.
- **No weekly number reaches a screen until a weekly round passes** (founder, 2026-10-13).
- **No mock data, no file-sourced data at runtime.** Every input is a stored observation, and on a
  pass the fitted numbers live in `model_artifacts`, versioned and pinned.

---

## 1. Diagnosis of round 2, from its own results

Every number here is from `2026-10-15-weekly-projection-round2-dev-check.json` (fit 2021-2022,
checked on 2023 weeks 6 to 17, PPR, 2,444 population rows), or this document's arithmetic on its
`per_week_rho` rows (48 rows, 12 weeks by 4 positions) and its ablation block. Nothing was refit.

**The result.** Model minus recent form, pooled: **+0.0033 rho**, bootstrap lower bound -0.0237,
against a margin of +0.0200. Per position: QB -0.0014, RB -0.0048, WR +0.0140, TE +0.0056. The other
25 lines passed: against ADP the model led by +0.0729 pooled (lower bound +0.0558), and every
calibration cell sat inside [0.05, 0.15].

**What recent form already carries.** The model's rate is the rest-of-season model's points a game,
m = (k p + G u) / (k + G), with u = alpha r + (1 - alpha) o (`model/ros/model.py`, `shrunk_rate`). In
the rest-of-season round 3 fit (PPR, 2021-2023, round 3 results "The fit") k is QB 3.0, RB 2.0, WR 1.5,
TE 3.0 and alpha is QB 0.6, RB 0.5, WR 0.5, TE 0.3. After five games the season so far carries
G / (k + G) of the rate: QB 0.63, RB 0.71, WR 0.77, TE 0.63. After eleven: 0.79, 0.85, 0.88, 0.79.
Of that weight, alpha is r, which **is** recent form (round 1's benchmark: his mean PPR points a game
this season before week W), and the rest is o, opportunity points over the same games. So from week 6
the rate is mostly form plus a usage-weighted copy of form, plus a shrinking share of the preseason
prior. The ablation shows it: the rate alone against form was **+0.0045** pooled (lower bound
-0.0234). **The in-season part of the rate is what beats ADP, and it is form's own information.** The
preseason board's points a game, as a source on its own, trailed ADP by -0.0601 pooled (lower bound
-0.0803) and form by -0.1297 (lower bound -0.1760), while form led ADP by about +0.070 (model minus
ADP +0.0729, less model minus form +0.0033).

**Where the opponent factor's cap bound: nowhere.** The factor c_W = bounded(D_pass ^ e_pass x
D_rush ^ e_rush) was capped at [0.8, 1.25]. With the development check's fitted elasticities (QB pass
0.6, RB rush 0.5, WR pass 0.3, TE pass 0.9, every other 0) applied to the stored 2023 weeks 6 to 17
ratings (`commish_opponent_adjustment`, 356 club-weeks, read from the dev copy for this document),
the uncapped factor ran QB 0.888 to 1.086, RB 0.922 to 1.090, WR 0.942 to 1.042, TE 0.836 to 1.132,
with standard deviations 0.038, 0.034, 0.019 and 0.057. **Zero club-weeks reached either bound.** The
ratings themselves are yards per dropback and per carry against what the offences faced usually
gain, shrunk with 6 games of prior (`context.py`, `_RATING_SHRINKAGE_GAMES`), and in 2023 ran 0.820 to
1.148 (pass, SD 0.063) and 0.850 to 1.189 (rush, SD 0.068). A factor of a few per cent reorders only
players whose rates are already within a few per cent of each other.

**What the factor did, per position.** Model minus the rate alone (the factor's own contribution to
the gap with form): QB **+0.0123**, RB +0.0001, WR +0.0003, TE **-0.0174**, pooled **-0.0012**, with a
per-week SD of the pooled difference of 0.0206. It helped quarterbacks, did nothing for backs and
receivers, and hurt tight ends (the largest elasticity, 0.9). It priced the opponent on yards per
play, where most of a week's points are volume and touchdowns.

**Why +0.02 was out of reach.** The pooled model-minus-form difference had a per-week SD of 0.0506
over the 12 weeks. The bootstrap's half-width came to 0.0270 (+0.0033 minus -0.0237), so the lower
bound clears zero only from about **+0.027** pooled. Round 1's weeks 6 to 17 lead over form on 2025
was +0.0008 pooled (round 2 preregistration, section 1). Two different models, one built on shares and
one on a shrunk rate, both landed on form, because both are, from week 6, functions of the same
season-to-date box scores.

**What a weekly number would need that form lacks.** Form cannot see anything that happens between
the last box score and the kickoff: a teammate ruled out, a starter returning, the opponent's
position-level funnel, or touchdown equity that a few box scores record noisily. Round 2 could not
use the first of these either: its instant was Thursday's kickoff, by which only 39 of 260 Out or
Doubtful filings for 2023 weeks 6 to 17 existed (round 2 dev-check doc, "Two things the replay
showed"). Round 3 moves the instant to each game's own kickoff and spends its fitted numbers on
volume, not on yards per play.

---

## 2. The basis: `commish_weekly_v3`, a per-game usage regression

### The input rule (what every read may see)

For a season S, a week W in 6..17, a player i at position p and his club's week-W game g, the
projection is made at **t_g, one millisecond before game g's kickoff** (section 3). **Every input row
is from a week before W and stamped at or before t_g, except filings, which are the latest filing for
week W stamped at or before t_g.** Three schedule facts for week W are read as schedule knowledge, not
as stamped observations: the club's `kickoff_instant` row (which defines t_g), its `home_field` row,
and the pairing (below). Under this rule every game of a week sees the same box-score history, and
only the filings move between Thursday and Monday. A same-week game already played (Thursday's, as
seen from Sunday) is never an input, although its rows are stamped before a later kickoff (stat lines
and play-by-play rows are stamped per game, 22.5 hours to 34.5 hours after their own kickoff, per the
pre-lock review's count over 2021-2024 weeks 6 to 17). A player whose club has no game in week W (a
bye) has no number that week and is not scored.

### The model (candidate A, the one judged)

1. **The rate.** m_f, the rest-of-season model's points a game in format f (`model.ros.model.per_game`),
   with `commish_ros_v3`'s fitted numbers exactly as recorded (artifact `model/ros-priors` v1, fit
   2021-2023, and for the development check the round 3 development priors, fit 2021-2022,
   `2026-10-14-rest-of-season-round3-dev-check.json`). Not refit or retuned. It carries the preseason
   prior and the player's own efficiency. **It is read at the week's first kickoff, not at t_g:**
   `ros.reads.week_inputs` computes its own moment (`week_moment`, one millisecond before the week's
   first kickoff). That is safe under the input rule: m reads only lines of weeks before W and the
   preseason board, a player plays once a week, and the first kickoff is at or before every t_g of the
   week, so m sees a subset of what the rule admits, never more. The one row it can miss is a
   correction to an earlier week's line stamped between the first kickoff and t_g, which m then reads
   a week later, as the served rest-of-season board does. The same holds for the universe.
2. **Expected opportunity for game g (stage 1, fitted).** For each position, one ordinary least-squares
   line with an intercept and **no penalty** per opportunity kind: **targets**, **carries**, **red-zone
   opportunities** (red-zone targets plus red-zone carries), **snap share**, and for quarterbacks
   **pass attempts** (17 lines: QB 5, RB, WR and TE 4 each). Each line regresses the game's actual
   count on:
   - his season-to-date mean of the kind over his games this season in weeks before W,
   - his mean over his last three games played in weeks before W (byes and absences skipped, and over
     the games he has when he has fewer than three),
   - his prior-season mean (0 with a no-prior-season indicator when he has none),
   - **vacated volume**: the sum, over club teammates whose week-W filing at t_g lists them Out or
     Doubtful and who played in one of the club's last three games, of their last-three-games mean of
     the kind,
   - the club's season-to-date pace (seconds per play) and pass rate, each the unweighted mean over the
     club's games of weeks before W that carry a value,
   - the opponent's **position-level allowance** of the kind (item 3), for every kind but snap share,
   - home field (1 home, 0 away).
   That is 10 coefficients a line (9 for snap share), **166 in all**. Each is fit on counts, not
   points, which carry far less noise per row.
3. **The opponent's position-level allowance.** For defence D, kind k and position p: **the position
   group's total of kind k per team-game, summed over players at p on the offence, in D's games of
   weeks before W stamped at or before t_g, over the same offences' position-group totals of k per
   game in their games of weeks before W, stamped at or before t_g, other than their games against D,
   shrunk toward 1 with 6 games of prior** (the context ingest's own constant,
   `_RATING_SHRINKAGE_GAMES`): A = (n x ratio + 6) / (n + 6), n being D's games counted. The
   quarterbacks' pass-attempt version is the same with D's `defence_dropbacks_faced` per game in
   the numerator and those offences' `dropbacks` per game in their other games of weeks before W in
   the denominator (`nflverse_pbp`). D's games and each offence's opponents in weeks before W come from
   the pairing. The store holds no position-level allowance table, so the round computes it from the
   stored inputs in the table below.
4. **Expected opportunity points (stage 2, mostly reused).** For a set of expected counts E,
   O_f(E) = L_p,f(E's targets, carries, pass attempts, snap share) + delta_p,f x (E's red-zone
   opportunities), where L_p,f is the rest-of-season model's fitted opportunity line
   (`OpportunityLine`, in the same priors, unchanged) and delta_p,f is the one new stage-2 number: the
   slope, from an ordinary least-squares line with an intercept, of (actual points minus L_p,f at actual
   usage) on actual red-zone opportunities, over the fit population, per position and format
   (**12 numbers**). Non-quarterbacks' expected pass attempts are their season-to-date mean. **For
   quarterbacks** the store holds no red-zone pass attempts (`nflverse_pbp_player` carries red-zone
   targets and carries only), so a quarterback's red-zone opportunities are almost all his red-zone
   carries and his delta prices rushing touchdowns only.
5. **The game's number, against a neutral game.** Let E_g be stage 1's prediction for game g and E_n
   its prediction for **a neutral game**: vacated volume 0, every allowance 1, home 0.5, the last-three
   mean set to the season-to-date mean, everything else (his season-to-date and prior-season means,
   the indicator, his club's pace and pass rate) as for game g. Then
   **x_g,f = max(0, m_f + O_f(E_g) - O_f(E_n))**. Since stage 1 and O_f are linear, the difference is
   exactly what this game and his recent role add: the last-three-against-season term, vacated volume,
   the allowances and home field, each through its stage-1 coefficient and valued at his position's
   line. Stage 1's pull toward the prior season and the population cancels, so m is not shrunk a
   second time. Pace and pass rate cancel too: they are season-level facts that m already carries, and
   in stage 1 they are controls only.
6. **The designation filter.** A player whose latest week-W filing stamped at or before t_g lists him
   Out or Doubtful gets **no number** (spec section 4.2 keys 1 and 2, round 2's filter,
   `weekly2/designation.py` unchanged). Questionable keeps the number and the flag. No filing is clear.
7. **The range and the chance sentence.** Round 2's methods (`weekly2/band.py`, the 99 residual
   percentiles per position, format and quintile of x, floor at q10, ceiling at q90, the 99 x 99
   chance), on round 3's x. The sentence stays conditional on both playing and says so.

**Fitted in this round, and nothing else:** the 166 stage-1 coefficients, the 12 delta numbers and
the range percentiles. **Fit seasons 2021, 2022, 2023, weeks 6 to 17**, each game at its t_g, refused
2024, 2025 and 2026 by name. The fit population is round 2's population definition on the fit
seasons, players with a number. **Every week-W count that stage 1 or delta reads as a target, and
every week-W line, goes through the round's seasoned, ledgered outcome reader** (round 2's
`WeekOutcomeReader`, extended to usage), never through an input read.

**Why this differs from round 1, which was also a usage model.** Round 1 shrank shares toward last
season with a recency decay, moved only yards per play by the opponent, used no red-zone term, saw
filings only at Thursday's kickoff, and stood on its own rate rather than the judged rest-of-season
rate. Round 3 keeps round 2's anchor (the rate m, which alone beat ADP by +0.0741 pooled on 2023) and
spends every new number on what form cannot see at the moment of the game: who is out, how much work
the opponent leaves for his position, his last three games against his season, and his red-zone share.

### Missing inputs: each case has a stated default, none is dropped silently

| Case | Rule |
|---|---|
| No game this season in weeks before W (back from reserve, signed mid-season, a rookie yet to play) | x_g,f = m_f (the rest-of-season model's own rule for a player with no line: his preseason or off-board rate). His club is `latest_clubs`' edge, else the preseason board's club (round 2's `board.py` rule). With neither, no number, counted |
| Fewer than three games this season | The last-three mean is over the games he has |
| No prior season | Prior-season mean 0 and the no-prior-season indicator 1 |
| A line-week with no `nflverse_pbp_player` row (rows exist only for player-weeks with a target or carry: 5,044 of 7,595 line-weeks in 2023, per the review) | 0 red-zone opportunities, for the target and for the means |
| A line-week with no snap row | Snap share 0 (snap rows equal line rows in 2021-2024: 7,694 / 7,577 / 7,595 / 7,534 each) |
| A club-week with no pace or pass-rate value (2021 week 17 CHI, 2024 week 7 WAS) | The mean over the club's games that carry a value. With none, the fit population's mean, counted |
| An opponent with no game against the position group in weeks before W | Allowance 1 (the shrinkage's prior) |
| A teammate withheld who played none of the club's last three games | Contributes 0 to vacated volume |
| No filing for week W at t_g | Clear (round 2's rule) |
| A club-week with no kickoff row or no pairing row | Refused before any fit (a precondition, section 6) |
| A player outside the rest-of-season universe | No m, no number (round 2 counted 0 such population rows) |

The results report the count of rows under each default.

### Players the usage feeds have not seen, trades and byes

- **Rookies and anyone with no prior season:** the indicator carries them. From week 6 a rookie who has
  played has season-to-date and last-three means. One who has not has x = m_f (table above).
- **Trades:** his club is his latest club edge at t_g (`ros.reads.latest_clubs`), and club edges come
  only from lines he has played (`player_week_teams` rows equal line rows). **So in his first game for
  a new club, his club is still the old one** for vacated volume, the allowance and home field. From
  his first line for the new club on, they are the new club's. His own means travel with him. This is
  a limitation of the store, named, and the results count the player-games it touches.
- **Byes:** no game, no number, not scored. The last-three mean counts his last three games played, so
  a bye or an absence never enters as a zero.

### The inputs, every one already in the store

Coverage below is from the dev copy (5432), counted 2026-10-15. Rows are per metric per season,
except where the cell says otherwise.

| Input | Table, source and metrics | Seasons the store holds | 2021 / 2022 / 2023 / 2024 rows |
|---|---|---|---|
| Targets, carries, pass attempts, and the club's totals | `player_week_observations`, `nflverse_player_week` (`targets`, `carries`, `pass_attempts`, `team_targets`, `team_carries`, `team_pass_attempts`) | 2003-2024, not 2019 (2019 and 2025 are play-by-play derived only) | 7,694 / 7,577 / 7,595 / 7,534 |
| Snap share | `player_week_observations`, `nflverse_snap_counts` (`offensive_snaps`, `team_offensive_snaps`) | 2013-2025 | 7,694 / 7,577 / 7,595 / 7,534 |
| Red-zone and inside-the-ten targets and carries | `player_week_observations`, `nflverse_pbp_player` (`red_zone_*`, `inside_ten_*`) | 2003-2025 | 5,085 / 5,093 / 5,045 / 4,974 |
| Club pace, pass rate, dropbacks, defence dropbacks faced | `team_week_observations`, `nflverse_pbp` (13 metrics) | 2003-2025 | 7,071 / 7,046 / 7,072 / 7,071, **all 13 metrics together** (pace alone 543 / 542 / 544 / 543, per the review) |
| Kickoffs (the instant) and byes | `team_week_observations`, `nflverse_kickoff`, `kickoff_instant` (stamped at the kickoff) | 2003-2026 | every club-week with a game |
| Home field | `team_week_observations`, `nflverse_schedule`, `home_field` (stamped at the schedule's release, for example 2023-05-20) | 2003-2026 | as above |
| The pairing | `nflverse_team_defense_weeks`, columns `season`, `week`, `team`, `opponent_team` only | 2019-2025 | 544 / 542 / 544 / 544 club-weeks |
| Clubs | `player_week_teams` | 2019-2026 (2019: 6,977, 2026: 2,233, per the review) | 7,694 / 7,577 / 7,595 / 7,534 |
| Designations | `player_week_observations`, `nflverse_injuries`, `injury_report_status` (stamped `date_modified`) | 2016-2024, not 2017 | 1,778 / 1,710 / 1,719 / 1,787 |
| Opponent ratings (reported ablation only) | `team_week_observations`, `commish_opponent_adjustment` | 2003-2025 | 1,088 / 1,084 / 1,088 / 1,088 (both metrics) |
| The rate m and the line L | `model/ros-priors` v1 and the round 3 dev-check record | fit 2021-2023 (2021-2022 for the check) | |
| The preseason board at the replay moment | built by `model.preseason.persist.build_season` | 2021-2023 built by round 2 (`board_moments`), 2024 by the rest-of-season round 3 | |
| ADP (benchmark only) | `preseason_rankings`, `ffc_adp_ppr_12` | 2013-2026 | 2023: 188, 2024: 189 |

The prior season of the first fit season, 2020, is held in every player table above.

**The pairing is a box-score table read for its four pairing columns only.** `nflverse_team_defense_weeks`
is built from box scores (its other columns are points, yards, sacks and touchdowns allowed), holds a
row only for a game that was played, and has no `as_of` column. It is the only source in the store
that names each club's opponent for 2021-2024: `nflverse_kickoff` and `nflverse_schedule` carry no
opponent, `provider_games` holds 2026 only, and the nflverse schedule file read over the network
would be a file source at runtime (pre-lock review, H4). Who played whom is schedule knowledge, fixed
when the league publishes its schedule in May. The round reads only `season, week, team,
opponent_team`, and a guard test asserts that the query selects exactly those four columns. Live in
2026 the pairing comes from `provider_games`, the stats provider's slate.

**The usage feeds Lane 23 added are not used.** The brief names `usage_*` tables. There are none:
Lane 23 stored FTN charting, Next Gen Stats, PFR advanced stats and passer dropbacks as sources in
`player_week_observations` (`nflverse_ftn_charting`, `nflverse_ngs`, `nflverse_pfr_advstats`,
`nflverse_pbp_passer`), for the current season only. The dev copy holds **0 rows of any of them for
2016 to 2025** (counted). Upstream, FTN charting starts in 2022, PFR's weekly files in 2018 and Next
Gen Stats in 2016 (`docs/research/data-sources.md`), but no history pass has ingested them. A fit on
2021-2023 cannot read a feed that is absent from all three seasons, and FTN could never cover 2021.
**Routes run** are published by no feed (data-sources doc, "Routes run"), so the brief's routes input
is dropped. A later round that wants these feeds needs a history ingest first and its own
preregistration.

**No input is a 2026 outcome.** The fit reads 2021-2023 (and 2020 as the prior season), the judgment
2024 (weeks before W as inputs, week W's counts and lines as outcomes through the reader). Live in
2026 the inputs are the weeks before W, written by the weekly pass's `stats-ingest`, `play-by-play`
and `opponent-ratings` steps, and the Tank01 designations the API already reads.

### Candidate B, for comparison (not judged)

**A direct per-game points regression:** per position and format, an ordinary least-squares line of a
game's points on the same inputs as stage 1 (season, last-three and prior-season means of every
kind, vacated volume, pace, pass rate, the allowances, home) plus m_f, at the same per-game instant,
fit on 2021-2023 weeks 6 to 17. It targets the week directly and may order better. A is judged instead
because its fitted lines predict counts, which are far steadier than points, and its stage 2 reuses the
rest-of-season line already fitted. Its number is also anchored on m, so the served rest-of-season
order and the week's number agree about a player's level. B fits 25 to 30 coefficients in each of
12 position-format cells (315 in all) on the noisiest target the store has. Judging both on 2024
would double the comparisons and invite picking the winner on the judgment season. B is recorded so a
later round may preregister it on a clean season.

---

## 3. The projection instant

**Per game, one millisecond before that game's kickoff.** For a player on club c in week W, t_g is
the `as_of` of c's week-W `kickoff_instant` row (`nflverse_kickoff`, whose stamp is the kickoff
itself) minus one millisecond. Every stamped read applies the input rule of section 2 at t_g, through
the as-of reads rounds 1 and 2 already use (`observations_as_of`, `team_observations_as_of`), with a
week bound of W - 1 on everything but the week-W filings. The rate m and its universe are the one
exception in moment, read at the week's first kickoff (section 2, item 1).

**How the replay reconstructs it.** The store holds one filing per player-week (`nflverse_injuries`,
keyed season, week, player), the final one, stamped at its `date_modified`. At t_g the replay sees
that filing if its stamp is at or before t_g, and otherwise sees none. Because every other input is
from weeks before W, recent form, the rate and every season-to-date and last-three mean are the same at
every kickoff of the week. What changes between Thursday and Monday is the filings, and with them the
filter and the vacated volume. Facts stamped at the kickoff (the implied total, the spread, the
weather) stay invisible, as in rounds 1 and 2.

**What the filter catches at that instant, counted on the dev copy** (2021-2023 weeks 6 to 17, every
filing the store holds, which is the projected universe's players). A filing's game needs his club, and
two club rules give two counts. The **loose rule** (his latest club edge in any season, week at most W)
places more filings. The **model's rule** (this season's edges, weeks before W) is the one the round
uses, and it is the one vacated volume sees, since a teammate counts only if he played in one of the
club's last three games.

| Season | Out or Doubtful filings | by the week's first kickoff | by own kickoff, loose rule | by own kickoff, model's rule | Questionable filings | by first kickoff | by own kickoff, loose | by own kickoff, model's |
|---|---|---|---|---|---|---|---|---|
| 2021 | 253 | 35 | 252 | **240** (12 unplaced, 1 stamped after his kickoff) | 336 | 61 | 336 | 331 |
| 2022 | 267 | 45 | 267 | **267** | 313 | 46 | 313 | 312 |
| 2023 | 260 | 39 | 254 | **247** (13 unplaced) | 353 | 38 | 348 | 336 |
| All | 780 | 119 (15%) | 773 (99%) | **754 (97%)** | 1,002 | 145 (14%) | 997 (99.5%) | 979 (98%) |

The 2023 first-kickoff counts reproduce round 2's 39 of 260 and 38 of 353 exactly, which checks the
method, and the pre-lock review reproduced both own-kickoff columns. An unplaced filing belongs to a
player with no club edge this season before W, who has no recent games and so adds nothing to vacated
volume. The median filing is stamped 46.2 to 47.2 hours before its own game's kickoff (by season and
kind), the Friday report for a Sunday game. **At the per-game instant the filter and the vacated volume
see 97 per cent of the Out or Doubtful filings under the model's rule,** against 15 per cent at
Thursday's kickoff. Which of those players fall in the scored population needs their week-W lines, so
the development check and the judgment report it (withheld population rows, Questionable flags, and
club-games with nonzero vacated volume), and this document does not.

**Live,** the weekly pass computes each game's number at every run before that game's kickoff. A
number from an earlier run (Wednesday to Saturday) is the same function at that run's moment, with the
filings stamped by then. **Only the number at t_g is judged.** The evidence for earlier numbers is the
reported Thursday view (section 5), and the start screen marks a number computed before his club's
final injury report as not yet final. The register freezes each game's numbers before its own kickoff,
and the job system runs one pass per kickoff slot (Thursday, Sunday early, late and night, Monday, and
any Saturday or international slot).

---

## 4. The judgment season, weeks and fit

**Judgment: 2024, weeks 6 to 17**, each game at its t_g, against each player's published week-W line
(`stat_lines_for_measurement`, read at the far future through the judgment's reader). Read once. Week 18
is excluded before reading.

**What 2024 has already been exposed to, completely.**

1. **No weekly model has been judged on 2024.** Round 2's judgment was not run: no
   `2026-10-15-weekly-projection-round2-results.json` and no judgment claim file exist in
   `docs/research/`, and its development check read outcomes of 2021-2023 only (`outcome_seasons_read`:
   fit 2021 and 2022, check 2023).
2. **The rest-of-season judgment** (round 3 of that record, `9cff3fdd`) gated rest-of-season rho and
   starters' rank error at weeks 8 and 12 of 2024, a different target, and failed 3 of 49 lines (week-8
   receiver starters). No cell of it is recomputed here and no verdict changes. The two are not
   independent: weeks 8 to 17's single-week outcomes are parts of its sums. Weeks 6 and 7 it read only
   as inputs.
3. **The rest-of-season rounds 1 and 2 development checks computed 2024 ordering** at weeks 4, 8 and 12
   (round 1, fit 2023) and weeks 8 and 12 (round 2, fit 2023), and their numbers were read (rest-of-season
   round 3 preregistration, "2024's exposure, named"). 2024 was also a fit season of those two rounds.
4. **The rest-of-season round 3 results recorded that on 2024 season-to-date form ordered about as well
   as the model** (better at week 8 for QB, RB and WR rho, and at week 12 for QB and TE: "Reading the
   result"). That is the comparison G2 makes, on rest-of-season points rather than single weeks, and
   this round's design (beat form) was chosen knowing it.
5. **Round 1's development check** computed 2024 single-week ordering for round 1's model, ADP and form
   (fit 2021-2023). Its gate summary is printed in round 1's results and was read in writing this. Its
   per-week rows were not opened. 2024 was a fit season of round 1, none of whose numbers is used here.
6. **Three model artifacts fitted on 2023 and 2024 stand behind m's 2024 inputs** (pre-lock review, H7,
   from `model/preseason/build.py` and `model/ros/reads.py`). `preseason/priors` v1 fits its rookie
   games rate on 2023 and 2024, and that rate enters the raw board's expected games, from which the raw
   points a game (m's prior, `prior_source` "raw" in the rest-of-season round 3 record) is taken.
   `market/props-anchor-weight` v1 is fitted on "2023 and 2024 pooled" and enters the served board, which
   sets the universe and the availability (`build_stale_board`). `preseason/game-variance-skill` v1
   (2023 and 2024) enters the preseason board build. **The artifact store holds only version 1 of each**
   (counted on the dev copy, `model_artifacts`), and no preregistered procedure can produce a version
   fitted on 2023 and earlier without a new procedure: the props anchor weight and the preseason priors
   are unported oracle fits whose records say they are not re-runnable on the store as it stands
   (`model/fit_inputs.py`, the artifacts' `fitted_on`), and the game-variance fit
   (`model/fits/game_variance.py`) has `TRAIN_SEASONS = (2023, 2024)` as its procedure. So the 2024
   replay uses v1, and the exposure is stated: **a 2024 outcome sits inside a 2024 input of m. Its
   direction is to flatter m on 2024, which favours the model against form in G2.** The development
   check on 2023 carries the same artifacts with 2023 in their fit too. The effect on per-game rates is
   expected to be small (the raw prior's weight is k / (k + G): after five games 0.38 at QB and TE, 0.29 at
   RB, 0.23 at WR, and after eleven 0.21, 0.15 and 0.12, from the shrinkage in section 1), but it is not measured here.

**A pass on 2024 is therefore weaker evidence than a first look at an untouched season, and is read
with every caveat above, item 6 first.** The results will print these caveats beside the verdict.
2024 is still the cleanest season the store holds: 2023 and earlier are fit seasons, 2025 is closed,
2026 is pristine.

**Fit: 2021, 2022, 2023, weeks 6 to 17**, with 2020 read only as the prior season of 2021. Every input
in section 2's table covers all three fit seasons and 2024 (counts above). No input starts late inside
the window, so the fit needs no rule for a late feed. The two store gaps (no `nflverse_player_week` for
2019, no filings for 2017) sit outside stage 1's window. **m carries the 2019 gap:** its 2021 and 2022
preseason boards read three prior seasons of lines, which include 2019 (rest-of-season round 3
preregistration), exactly as in the record it is taken from. The feeds that start late or are absent
(FTN from 2022 upstream, and FTN, NGS and PFR not ingested for any past season) are not inputs.

**Development check: 2023 weeks 6 to 17, fit on 2021 and 2022**, with 2020 and 2021 as prior seasons,
the rate from the round 3 development priors, against 2023 ADP and form, the identical code once,
before the judgment, as round 2 did. 2023 is a fit season of the final model, so its numbers decide
nothing on their own. After it only **defects** may change (code that does not do what this document
says), each recorded here as an amendment and committed before the judgment. No model choice, input,
coefficient list, default, population, statistic, threshold, seed or judged week changes.

**The stop rule (round 2's, written down this time):** **if the development check fails G2 pooled
against recent form, the deciding gate, the round ends there, the judgment is not run, 2024 stays
unjudged for the weekly target, and no threshold moves.** A failure of any other line on the check is
recorded and examined for a defect, and does not by itself stop the round.

---

## 5. The gates

### Population and statistics (round 2's, unchanged)

**Population** at (W, p): players at p who recorded a 2024 week-W line and are in the union of ADP's
top K at p and the top K by season-to-date PPR points before W, K = QB 36, RB 72, WR 108, TE 36. A
player a source has no opinion on (off ADP, withheld by the filter, no form) ranks below every player
it has, ties averaged. **Sources:** the model's x_g,ppr, ADP (2024 `ffc_adp_ppr_12`, within position),
and recent form (mean PPR points a game this season before W, else last season's). S1 ordering
(Spearman rho per week and position, at least 8 players, pooled as the mean over weeks of the
four-position mean), S2 places off (starters QB 12, RB 24, WR 24, TE 12), S3 range shares and S4 chance
bins, all as defined in round 2's section 4. **Uncertainty:** a week-block bootstrap over the 12
judged weeks, 10,000 resamples, numpy `default_rng(42)`, the lower bound the 2.5th percentile.

### Gates (all must pass, and a gate that cannot answer fails)

| Gate | Threshold | Basis for the number |
|---|---|---|
| **G1, against ADP** | Pooled model minus ADP rho **>= +0.04**, lower bound **> 0**, each position **>= -0.02** | +0.04 is the rest-of-season rounds' doubled margin, kept from round 2. Measured: round 2's check led ADP by +0.0729 (lower bound +0.0558, per-week SD 0.0326), its smallest positions QB +0.0077 and TE +0.0084. Round 1's weeks 6 to 17 lead on 2025 was +0.059. -0.02 is round 1's quarterback miss (-0.018) rounded. |
| **G2, against recent form** | Pooled model minus form rho **>= +0.02**, lower bound **> 0**, each position **>= -0.02** | +0.02 is round 1's margin, kept by round 2. Measured: round 2 +0.0033 with per-week SD 0.0506, so the lower bound clears zero only from about +0.027 (its half-width was 0.0270). Round 1 on 2025 weeks 6 to 17, +0.0008. Neither model would pass, and the bar is not lowered for a model built to clear it. |
| **G3, places off** | Pooled model places off at least **0.25** fewer than ADP's and than form's (point comparisons) | Round 2 measured 12.116 against ADP 14.445 and form 12.374, a lead over form of 0.258, the narrowest pass of its 25. Round 1 measured 0.31 against each. 0.25 kept. |
| **G4, calibration** | Each of 12 cells (4 positions by 3 formats): below floor and above ceiling each within **[0.05, 0.15]**, n >= 100. Chance bins with at least 200 pairs: observed minus mean chance within **+-0.05**, at least three bins gated | Round 1's band. Round 2's check: all 12 cells inside, the closest QB below floor 0.141. Chance bins within 0.020 at worst ([0.7, 0.8): 0.748 against 0.768). Kept. |
| **G5, isolation** | The outcome readers (points and usage alike): the fit's serves only 2021-2023 and refuses 2024-2026, the judgment's serves only 2024 and refuses 2025 and 2026. **The per-game clause:** every row read for a game from the covered reads below is from a week before W (week W for filings) and stamped at or before its t_g. `preseason_projections`, `preseason_board_reasons`, `register_freeze_rows`, `register_grade_rows`, `model_artifacts` digest the same before and after | Rounds 1 and 2's isolation gate, with the readers' seasons moved and the per-game clause added. |

**What G5's per-game clause covers, and how each read is checked.** Covered: `player_week_observations`
(sources `nflverse_player_week`, `nflverse_snap_counts`, `nflverse_pbp_player`, `nflverse_injuries`),
`team_week_observations` (sources `nflverse_pbp` and `commish_opponent_adjustment`), and
`player_week_teams`. Each covered read goes through one recording wrapper that keeps, per game, the
largest `as_of` and the largest week among the rows it returned (filings kept apart), and the gate
compares them with t_g and W - 1 (W for filings) for every game of the fit and the judgment. The rate
m's read is covered too: its moment, the week's first kickoff, is at or before every t_g of the week.
**Exempt by name, each covered by another clause or by being schedule knowledge:** the `kickoff_instant`
rows (stamped at the kickoff, t_g + 1 ms) and the `home_field` rows (stamped at the schedule's release),
both schedule knowledge for week W. The pairing (`nflverse_team_defense_weeks`, no `as_of`), schedule
knowledge whose four-column read is held by its guard test. The fitted artifacts (`model/ros-priors`
and the preseason artifacts) and the preseason board (built at its own preseason moment, recorded as
`board_moments`), whose provenance section 4 states and whose table digests G5 checks. The outcome
readers, which read at the far future by design and whose ledgers G5 checks.

Gate lines: G1 5, G2 5, G3 2, G4 13, G5 1: **26**. Thresholds in one constant (`ROUND_THREE` in the
round's `gates.py`, beside `ROUND_TWO`), read by the judgment and any later harness, with a test at
each threshold.

**Multiple comparisons.** Two comparisons are tested with the bootstrap, the pooled G1 and G2, each at
a one-sided 0.05 / 2 = 0.025. Every other line is a tolerance or a point guard, and the gates are
conjunctive.

**Reported, not gated:** each position's rho for every source and format, half PPR and standard, S2
per position, S4 in half and standard and for flex pairs, MAE and RMSE of x, the rate alone (m_f), the
rate times round 2's opponent factor (`commish_weekly_v2`'s centre, as an ablation, with the
elasticities refit on this round's fit seasons, reported only), round 3 without vacated volume and
without the allowances (each ablation), the stage-1 coefficients, each kind's stage-1 RMSE against the
season-to-date mean (on the fit seasons, and on the judged weeks through the judgment's reader), the
counts under each missing-input default, the withheld and flagged population rows, the first-game-after-
a-trade rows, and every number at Thursday's instant as a second view (the evidence for the numbers a
member sees before the last run, section 3).

### Decision rule

**If every one of the 26 lines passes on the one judgment of 2024 weeks 6 to 17, the weekly number
ships, and if any line fails or cannot answer nothing ships, with G2 pooled against recent form the
gate this document expects to decide, as it decided round 2.**

- **On a pass:** each player's per-game `week_points` per format with floor and ceiling on the start
  screen (`PlayerLine`, spec section 9), the start-and-sit chance sentence ("White scores more than
  Bigsby in about 62 of 100 games like this, if both play", no betting words), and the waivers screen's
  week-ahead number. As in round 2's pass case, the order key in spec section 4.2 becomes `week_points`
  after the hard facts, and the honesty line "We do not project a week's points" is replaced by the
  number's basis. The fitted numbers go to `model_artifacts`, pinned, with `model_version` and
  `implementation = 'python'` on every row. The register's weekly pass freezes each game's numbers
  before its own kickoff, so 2026 is graded prospectively. Build items first: one weekly pass per
  kickoff slot in the job system, the allowance and pairing reads in the weekly pass (pairing from
  `provider_games`), the API's Tank01 designations through `status_of_tank01`, and the start screen's
  not-yet-final mark (section 3).
- **On a fail:** nothing ships. The screens keep the rest-of-season order and this week's facts with
  no weekly point number and no chance sentence, as the in-season spec's section 10.1 says. The results
  report every number. Neither this model nor a retune of it is judged on 2024 again.

A judgment run more than once, or after any change not recorded as a defect amendment here, voids it,
and the results file must then say so.

---

## 6. Cost, time and who runs it

**Measured baseline.** Round 2's development check took **165.7 s** in all on the founder's laptop:
the rate 46.0 s, the reads 73.2 s, the fit 0.2 s (its JSON, `seconds`). Round 1's share search took
2,342 s (round 1 results), and this round has no search.

**Estimate.** Under the input rule only the filings differ between a week's kickoff slots, so the
box-score reads are made once a week and the filings once per slot (about five a week). Add the usage,
play-by-play and pairing reads round 2 did not make, estimated at the same order as its 73 s of reads.
The 17 stage-1 lines and 12 delta numbers are closed-form least squares over a few thousand rows each
(seconds). The bootstrap is round 2's. **Estimate: under 15 minutes for the development check and under
15 for the judgment, under 30 minutes together.** The results report the measured times. No model call
and no prose: the round spends nothing.

**Who runs it:** the coordinator, never a subagent, on a scratch copy named **`lane47_weekly`** on the
local test server (port 5433), restored from a dump of the dev copy's `research` schema. Never dev
(5432), never 5440, never production. The round's scratch guard admits only a `lane47_` database on
5433 (`model/ros/scratch.py`'s rule, its prefix changed).

**Preconditions, checked on the scratch copy before any fit and recorded in the results:**
- every input in section 2's table present for 2020-2024 as counted above,
- a `kickoff_instant` row for every club-week with a game in 2021-2024 weeks 6 to 17,
- **the pairing matches those kickoff club-weeks one to one and is symmetric** (D faces c exactly
  when c faces D). The pre-lock review counted 352 / 350 / 356 / 356 paired club-weeks for 2021-2024
  weeks 6 to 17, every kickoff club-week paired, and 0 asymmetries over 2020-2024,
- stamped filings for every fit and judged week,
- `ffc_adp_ppr_12` for 2023 and 2024,
- `commish_ros_v3`'s priors refit on 2021-2023 equal to their record, and on 2021-2022 equal to the
  round 3 development record.

A missing one refuses the run and is named.

**The commit that must exist before any fit:** this document, committed by the coordinator. That
commit's hash is the lock, and the judgment refuses to run unless it is an ancestor of the tree's
HEAD (round 2's `preregistration_committed` rule). Order, each step committed before the next: (1)
this document, (2) the round's code and tests, (3) the development check on 2023 and its record, with
any defect amendment, and the stop rule applied, (4) the judgment, once, claimed by an exclusive file
before any 2024 row is read, (5) the results.
