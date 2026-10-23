# The Weekly Projection, Round 5: Preregistration (the component models)

**Written:** 2026-10-23 by Lane 167, before any code, fit or check of this round, and before any
outcome was read by anything in it. Named for its planned lock date. Its author read the design draft
(`2026-10-17-weekly-projection-round5-draft.md`, cited as D:line), round 4's preregistration with its
seven amendments (cited as R4 §n), round 4's results record (cited as R4R §n), round 4's credibility
review (`.superpowers/sdd/2026-10-12-prep-site/reviews/round4-credibility-review.md`, cited as CR), the
kicker and team-defense results (`2026-10-23-weekly-kdef-results.md`), the key names and thresholds of
round 4's development-check JSON (no per-week row), the column list of round 4's feature store
(`research/model/weekly4/features/columns.py`), the play table's opportunity rule
(`research/model/weekly4/features/plays.py`) and the house scoring (`research/model/domain.py`). It made
no database read of any kind. It read no outcome value of any season, no 2024 number and no 2025 or
2026 number.
**Brief:** `.superpowers/sdd/2026-10-12-prep-site/lane-167-brief.md` (Lane 167): write round 5 in round
4's form from the draft, the two open questions taking the coordinator's recommended answers, each
marked for the founder.
**Rounds before it:** round 1 (lock `3beb44d1`, failed on 2025), round 2 (lock `86ca79d6`, stopped at
its development check), round 3 (lock `e58ae444`, stopped at its check), round 4 (lock `b56c05d8`,
amended at `65cc5b96`, `6364b50f`, `f358f375`, `42d0f440` and after, stopped at its check, R4R §2), and
round 4's kicker and team-defense sub-round (Amendment 7, stopped at its check on 2026-10-23).
**Status:** pre-lock review applied 2026-10-26, awaiting the founder's two answers. The review is
`.superpowers/sdd/2026-10-12-prep-site/reviews/round5-prelock-review.md` (4 BLOCK, 11 FIX, 11 NOTE),
every BLOCK and FIX applied, every NOTE recorded in section 7.
**The lock:** the coordinator's commit of this document after its pre-lock review. The two decisions
marked **FOUNDER DECISION PENDING, default as written** stand as written at the lock unless the founder
changes them before it. No fit of this round runs before the lock.
**Results:** `docs/research/2026-10-26-weekly-projection-round5-results.md`, with the JSON records
beside it (section 8 is its template), reporting every number named here whether it passes or not.

## Rulings this document is bound by

Every ruling of R4's "Rulings this document is bound by" is carried unchanged: 2026 outcomes are the
pristine held-out year; a failed judgment is final and never rerun on the same season, and 2025 is
closed; thresholds never move after a check; after the development check only defects change, each an
amendment committed before the judgment; no weekly number reaches a screen until a weekly round passes;
no file-sourced data at runtime; nflverse is the recurring charted-stats source; fantasy words, not
trading words. Added for this round:

- **2024 stays the single judged season.** No weekly round has judged it (R4R §2: "2024 stays unjudged
  by any weekly round and remains available to a future round's single judgment"), and the kicker and
  defense sub-round's judgment was refused by its stop rule and never ran. This round judges it once.
- **Ready means live** (founder, 2026-10-15). A preregistered switch week yields to the live board: on a
  pass the number replaces the published projection on the first in-season pass after the pin.
- **The projection provider is never named on the site.** It is "the week's published projection".
- **The game figures.** In every member-facing sentence the game's expected score and margin are "the
  game figures" or plain sentences about the score. No word of the banned list
  (`web/src/lib/format/banned-words.json`) appears in any excerpt of section 2.10 or section 4.

---

## 1. What round 4 established, what this round reuses and what it changes

**What four rounds measured** (D:11-15). Pooled model minus recent form on 2023 weeks 6 to 17: round 3
+0.0106 (needed +0.02), round 4 -0.0124 (needed +0.030, lower bound -0.0531, R4R §2). Round 4's review
found the failure credible (CR verdict): the cross-player normalisation over an undefined "projected
set" gave back about 0.016 rho (CR A.1), value per opportunity and efficiency rested on about two games
because the share decay of 0.5 governed them too (CR A.12), and quarterbacks and tight ends, whose
points are efficiency more than volume, trailed (CR C). What works: the team model (plays deviance 349
against 1,121 for implied points alone, game terms worth about +0.016, CR C), the raw share models (each
better than the season-to-date share, CR C), and running backs and receivers (both beat form and the
spreadsheet without the normalisation, CR C).

### 1.1 Reused exactly as round 4 built and measured it

| Part | As round 4 has it | Source |
|---|---|---|
| The data and the stamps | The play table, weekly depth charts, NGS, PFR, game figures, `game_weather`, `stadiums`, filings, snap counts, and the stamps of R4 §5 items 1 to 8 with Amendments 1 to 3 | R4 §2.9, §5, §7 |
| The feature store | Round 4's per-game as-of rows on round 3's instant t_g (one millisecond before kickoff), the columns of `research/model/weekly4/features/columns.py`, built with `--depth-chart week` (the depth chart check passed, R4R §1) | R4 §2.2 to §2.5, R4R §1 |
| The play model | Its targets, carries and dropbacks cells, forward-chained by season, 2016 to 2022 for the check and 2016 to 2023 for the judgment. Its xFP per target and per carry is an input under this round's windows (2.4), not the share decay | R4 §2.3, §2.6 |
| The team model | Plays, dropbacks, sacks, scrambles, designed rushes, team targets, rushing and receiving touchdowns, its inputs, monotone constraints, grid and tie rule, fitted forward-chained on 2016 to 2022 (check) and 2016 to 2023 (judgment) | R4 §2.5, §2.6, D:70-71 |
| The raw share models | Target, carry, air-yards, red-zone, inside-ten and dropback shares "if he plays", fitted 2021 to 2022 (check) and 2021 to 2023 (judgment), forward-chained per R4 §2.6's table, the joint decay-and-grid choice of 64 cells with decay in {0.5, 0.7, 0.85, 1.0}, and the 2021-alone exception. **Their outputs are never normalised** | R4 §2.2, §2.6, D:42-44 |
| The boosted model class | scikit-learn `HistGradientBoosting*`, `random_state` 0, early stopping off, the version pinned in `uv.lock` | R4 §2.6 |
| The grid and the tie rule | 16 cells: `max_leaf_nodes` 7 or 15, `l2_regularization` 0 or 1, `max_iter` 200 or 400, `min_samples_leaf` 50 or 200, learning rate 0.05. A tie is a summed validation loss within 0.1 per cent of the best (relative), the smaller cell winning in round 4's order | R4 §2.6 |
| Forward-chaining | Any component's output that is an input for a row of season s comes from that component fitted on seasons before s only | R4 §2.6 |
| The designation filter | Round 2's: Out or Doubtful at t_g gets no number, Questionable keeps it with a flag, no filing is clear for his own number | R4 §2.2 |
| The rate m | `commish_ros_v3`'s points a game, read from its records, never refit | R4 Amendment 2 item 6 |
| Populations and statistics | Round 3's: K = QB 36, RB 72, WR 108, TE 36, at least 8 players a week and position, S1 to S4, the fill rule | R4 §3.1 |
| Benchmarks, gates and every threshold | Section 3, with the one addition of 3.1's damped spreadsheet | R4 §3, D:73-79 |
| The prospective register and the served refit | Section 3.3 and section 4 | R4 §3.3, §4, Amendments 4 to 6 |

### 1.2 Changed, each with its exact value

| Item | Round 4 | Round 5 | Source |
|---|---|---|---|
| The point | Analytic mean of volume x share x value, reconciled by the identities | Per position, direct expectations of each scored component (2.5), scored under each format's rules and summed | D:28-36 |
| The identities and the normalisation | Shares of the projected set plus a residual sum to 1, touchdowns scaled to the team model's | **Dropped.** No share is normalised, no residual share is fitted, no touchdown is scaled | D:42-44, CR D.2 |
| The projected set | Undefined in R4 §2.6 (R4R §2's reading) | Defined in 2.2: not withheld, and a week-W depth chart row or an offensive snap in one of the club's last three games | D:42-44 |
| The anchor | The rate m among the share inputs | His season rate of the component and the rate m are inputs of every component tree | D:45-48, CR D.3 |
| Windows for value and efficiency | The share decay (0.5) and an unweighted moment estimator of tau squared (21 of 28 cells pooled fully, CR A.3) | Season-to-date rates, weighted within the season, shrunk with the effective count (sum w)^2 / sum w^2 toward the position's rate, the decay and prior strength chosen on their own loss (2.4). No moment estimator | D:49-52, CR D.4, D.5 |
| Quarterbacks | The shared chain | Their own path (2.6) | D:53-56, CR D.7 |
| Touchdowns | The player's own decayed xTD, scaled to the club's, the red-zone and inside-ten share models fitted and unused | The club's expected touchdowns (the team model) times his modelled red-zone and inside-ten share times his shrunk conversion (2.7) | D:57-59, CR A.8 |
| The range and the chance | A 10,000-draw simulation | Empirical residual quantiles by position, format and point band (2.9). **The simulation is dropped** | D:60-62 |
| A rival inside the round | None | A residual-over-form tree per position and format (2.8), chosen against the components once on 2023 | D:63-66, CR D.8 |
| G6's baseline | The three-fact spreadsheet | The preregistered spreadsheet and a damped one, each G6 line and G3's sheet line passing against both (3.1). **FOUNDER DECISION PENDING, default as written** | D:84-87, CR D.10 |

---

## 2. The system

### 2.1 The shape

For each game the system reads the game (the club's expected points and margin, the weather), the
team model's expected volume for his club, and for each player who gets a number his feature row,
his season anchors and his shrunk rates. Per position it predicts each scored component directly and
scores them. The point is the sum. The range is the residual's quantiles. The why is an exact Shapley
attribution over seven groups. No step forces players' numbers to add up to a club total.

### 2.2 Who gets a number (the projected set, defined)

A player of the population (3.1) gets a number for week W when both of these hold at t_g:

1. **Not withheld:** the designation filter (R4 §2.2, live through `status_of_tank01` per Amendment 2
   item 7) does not withhold him.
2. **Evidence he plays,** at least one of: (a) a row at his position on the week-W depth chart
   (`nflverse_depth_chart_weeks`, admitted under R4 §5 item 6, live per the same item), at any depth,
   or (b) at least one offensive snap in at least one of his club's last three games before W
   (Amendment 3's played game, from `nflverse_snap_counts`).

A player with neither (a) nor (b) gets no number, counted as `no_play_evidence` per position and week,
and ranks under the fill rule as any source's no-number row does (3.1). The rule reads only the week-W
chart and earlier weeks' snaps. It reads no week-W line. **Neither it nor the designation filter is
applied to fit rows** (a Doubtful player who played is a fit row, as in round 4): the
component models fit on rows with a line that week (2.11), as round 4's share models did, since the
expectation is "if he plays".

### 2.3 The inputs of every component tree

- **Round 4's player and game feature row:** every numeric column of `columns.py`'s `GAME_COLUMNS` and
  `PLAYER_COLUMNS` and every `default_<name>` indicator of `GAME_DEFAULTS` and `PLAYER_DEFAULTS`, with
  `roof` the one categorical input (`matrix.VOCABULARY`). These are excluded: the identifiers and text
  columns `player_id`, `position`, `status`, `figure_source` and `surface`; the bookkeeping columns
  `withheld`, `depth_chart_week` and `depth_rank_mapped`; and `precipitation_probability`, which is live
  only and enters through R4 §2.5's mixture rule. The list is one constant in `research/model/weekly5/`
  and is printed in the development check's record (D:33-35). It holds his shares and their trend
  (season, last three, each decay, prior season), snaps, the depth rank, vacated and returning shares,
  target depth and location, the charted features with their missing indicators, the opponent's
  allowances by role, the game figures, roof and weather, home, rest and division.
- **The team model's expected volume for his club in that game:** plays, dropbacks, sacks, scrambles,
  designed rushes, team targets, rushing touchdowns and receiving touchdowns, all eight in every tree,
  forward-chained (D:35).
- **His season-level anchor:** his season-to-date rate a game of the component the tree predicts (NaN
  with `no_game_this_season` 1 before his first game), and the rate m in PPR (D:35-36, D:45-48).
- **His shrunk rates of 2.4,** every one his position carries.

No input is a week-W outcome. Every input is read under R4 §5's rule with Amendments 1 to 3 (section 5).

### 2.4 Windows by role: value and efficiency

**Volume inputs keep round 4's decays** (the share features at decays 0.5, 0.7, 0.85 and 1.0, and the
raw share models' own chosen decay, D:49). **Value per opportunity and efficiency** are season-to-date
rates, weighted within the season and shrunk (D:49-52):

- **the quantities, per position:**

  | Quantity | Opportunity unit | Positions |
  |---|---|---|
  | Receptions per target | target | RB, WR, TE |
  | Receiving yards per target | target | RB, WR, TE |
  | Rushing yards per carry | carry | RB, WR, TE |
  | xFP per target (PPR, the play model) | target | RB, WR, TE |
  | xFP per carry (PPR, the play model) | carry | RB, WR, TE |
  | FPOE per target and per carry (PPR) | target, carry | RB, WR, TE |
  | Passing yards per attempt | pass attempt | QB |
  | Interceptions per attempt | pass attempt | QB |
  | Sacks per dropback | dropback | QB |
  | Scrambles per dropback | dropback | QB |
  | Touchdown conversions (2.6, 2.7) | the expected-touchdown weight of 2.6 and 2.7 | all |

- **the weight** of each opportunity is d^a, a the age of its game in his games with a line this season before W (0
  for his latest), so d = 1.0 is the plain season-to-date rate;
- **the effective count** n_eff = (sum w)^2 / sum w^2 over his opportunities (CR D.5);
- **the posterior** = (n_eff / (n_eff + k)) x his weighted rate + (k / (n_eff + k)) x the position's
  rate, the position's rate being the opportunity-weighted mean of the quantity over the fit window's
  lined rows of weeks 1 to 17. With sum w = 0, n_eff is 0, and with n_eff = 0 the posterior is the position's rate;
- **(d, k) are chosen per position and quantity on their own loss** (D:51-52): the opportunity-weighted
  squared error of the posterior at week W against his realised rate in game W, summed over the fit
  window's lined rows of weeks 4 to 17 with at least one opportunity of the unit in game W (u > 0 for the conversions). The grid:
  d in {0.85, 0.95, 1.0}, and k in {10, 20, 40, 80, 160, 320, 640} opportunities for every quantity but
  the conversions, k in {0.5, 1, 2, 4, 8, 16, 32} expected-touchdown units for the conversions. A tie is
  a summed loss within 0.1 per cent of the best (relative), and among tied cells the larger k wins,
  then the larger d;
- **the fit window** for (d, k) and the position's rates is the player window, 2021 to 2022 for the check
  and 2021 to 2023 for the judgment, applied to every row of the window (the band-fit rows of 2.9
  included) and to the checked or judged season, as round 4 fitted its shrinkage constants on the fit
  seasons (R4 §2.3, §2.6);
- **no prior season enters these rates** (D:50, "season-to-date rates"), and no role prior's charted
  term: the charted features are tree inputs (2.3);
- **quarterbacks' rushing yards per carry are unpooled** (D:55): the plain season-to-date rate (d = 1.0,
  k = 0), the position's rate only when he has no carry.

A carry excludes kneels, spikes and two-point tries, as the play table's opportunity rule does
(`plays.py`: "Two-point attempts, kneels, spikes, penalties without a play and special teams are no
opportunity"). Every opportunity and realised rate is read from the play table as 2.5's paragraph
"Where each realised quantity is read" states. The xFP of each earlier opportunity is its stored xFP,
not re-priced with week W's weather, which enters the trees directly.

### 2.5 The components per position

Every tree is fitted per position on that position's fit rows (2.11), one tree per component, with
round 4's grid and tie rule.

| Component | RB, WR, TE | QB |
|---|---|---|
| Targets | Tree, Poisson loss | 0 |
| Receptions | Tree, Poisson loss | 0 |
| Receiving yards | Tree, squared error | 0 |
| Carries (kneels excluded) | Tree, Poisson loss | Tree, Poisson loss (designed runs and scrambles) |
| Rushing yards | Tree, squared error | Carries x his unpooled yards per carry (2.4) |
| Pass attempts | 0 | 2.6 |
| Passing yards | 0 | 2.6 |
| Interceptions | 0 | 2.6 |
| Passing touchdowns | 0 | 2.6 |
| Rushing touchdowns | 2.7 | 2.7 |
| Receiving touchdowns | 2.7 | 0 |
| Fumbles lost | Expected touches (receptions plus carries) x the position's fumbles lost per touch over the fit window's lined rows of weeks 1 to 17 | (Expected dropbacks plus carries) x the position's fumbles lost per dropback or carry, the same window |
| Two-point conversions | 0 (the week-W line carries none, so the scored outcome holds none) | 0 |

**The tree's target** is the player's component in the game (D:32-33). A tree's output is used as it
is: no tree is constrained by another (receptions are not capped at targets), since each is an
expectation.

**Where each realised quantity is read.** Every tree target, every realised rate of 2.4, every
realised share and conversion of 2.6 and 2.7, and every position constant of 2.5 except fumbles lost
is read from the play table under `plays.py`'s rule. A target is `is_target`. A reception is a target
with `complete_pass`. Receiving yards are the `yards_gained` of his targets. A carry is
`is_designed_rush` with him as rusher, plus, for a quarterback, his `qb_scramble` dropbacks. Rushing
yards are those plays' `yards_gained`. A pass attempt is a dropback credited to him that is neither a
sack nor a scramble. Passing yards, interceptions and passing touchdowns are those attempts'
`yards_gained`, `interception` and `pass_touchdown`. Touchdowns are `rush_touchdown` and
`pass_touchdown` credited to the rusher and the receiver. Kneels, spikes and two-point tries are no
play. Fumbles lost come from the week-W line's `fumbles_lost`. The scored outcome every gate reads
stays the week-W line through round 3's outcome reader, unchanged.

**Scoring.** The point in format f is the house scoring of the expected components:
`research/model/domain.py`'s `STANDARD_SCORING`, `HALF_PPR_SCORING` and `PPR_SCORING` (0.04 a passing
yard, 4 a passing touchdown, -2 an interception, 0.1 a rushing or receiving yard, 6 a rushing or
receiving touchdown, 0, 0.5 or 1 a reception, -2 a fumble lost, and the two-point component 0, F1 of
the pre-lock review). Scoring is linear, so the expectation of the points equals the points of the
expected components. Live, the API scores the published expected components under each league's own
rules, held to the research scorer by a parity test, as Amendment 7 item 13 does. **What the point
omits** (pre-lock N3, the model's own choice, each small): kick and punt return touchdowns, the kneel
yards inside a quarterback's line rushing yards, and the house scorer's rounding (`round_points`). For a
league with yardage or 100-yard bonuses, scoring the expectation is not the expected score (pre-lock N4).
The serving lane names this beside the number, and no gate reads it.

### 2.6 Quarterbacks' own path (D:53-56)

- **Pass attempts** = the team model's expected dropbacks for his club x his raw modelled dropback share
  (the round 4 share model, never normalised) x (1 - his shrunk sack rate - his shrunk scramble rate).
- **Passing yards** = pass attempts x his shrunk yards per attempt (2.4).
- **Interceptions** = pass attempts x his shrunk interceptions per attempt.
- **Passing touchdowns** = the team model's expected receiving touchdowns for his club x his raw
  modelled dropback share x his shrunk passing conversion. The conversion's observations are, in each of
  his games with a line this season before W, his passing touchdowns over u = the club's realised receiving touchdowns x his
  realised dropback share, weighted by d^a x u and shrunk toward the position's rate (2.4).
- **Rushing:** carries from the QB carries tree, yards from carries x his unpooled yards per carry,
  touchdowns by 2.7.

### 2.7 Touchdowns (D:57-59)

For a player and kind k (rushing, receiving):

- **his modelled share** s = 0.5 x his raw modelled red-zone opportunity share + 0.5 x his raw modelled
  inside-ten share, both from round 4's share models, never normalised;
- **his expected touchdowns of kind k** = the team model's expected touchdowns of kind k for his club x
  s x his shrunk conversion c_k;
- **the conversion's observations:** in each of his games with a line this season before W, his touchdowns of kind k over the
  weight u = the club's realised touchdowns of kind k x his realised s in that game (realised red-zone
  and inside-ten shares, so the fit needs no modelled share for a 2021 row). The weighted rate is
  sum (touchdowns x d^a) / sum (u x d^a), the weights are d^a x u, and the posterior shrinks it toward
  the position's rate, sum (touchdowns) / sum u over the fit window's lined rows of weeks 1 to 17 of
  the position (2.4). With sum w = 0, n_eff is 0 and the posterior is the position's rate. A touchdown
  in a game with u = 0 counts in the numerator. The (d, k) loss rows for a conversion are those with
  u > 0 in game W;
- **for a quarterback,** for whom round 4 fitted no red-zone or inside-ten share model
  (`share_model.SHARE_KINDS`: dropbacks and carries), s for rushing touchdowns is 0.5 x his
  season-to-date red-zone share + 0.5 x his season-to-date inside-ten share (`share_season_red_zone`,
  `share_season_inside_ten` of the feature row), 0 with `no_share` 1 before his first game. His
  conversion's u uses his realised shares as for every position;
- the club's expected touchdowns stay the team model's (D:57). Nothing scales a player's touchdowns to
  the club's.

### 2.8 The named rival (D:63-66)

**The candidate:** one boosted tree per position and format (12 trees) whose target is the player's
points in the format less his recent form in the format (the rounds' recent form, 3.1, computed in each
format), with squared-error loss, round 4's grid and tie rule, and as inputs the union of 2.3's inputs
over the position's component trees. Its point is his recent form plus the tree's output. With no
game this season before W, his point is the rate m in that format under 2.12's row for both
candidates (`rival_no_form` counts these), and such rows enter no rival fit. The rival's fit rows are
lined rows of weeks 4 to 17 with a game this season before W, by the windows of 2.11, so no reader
leaves the player window G5 states (no 2020 line is read). His recent form in half PPR and standard
comes from the same function as the PPR benchmark's, with the format's scoring. It shares 2.2's projected set, 2.9's range construction and 2.10's why.

**The choice, made once on 2023 and recorded:** the development check computes both candidates' every
line of section 3. The candidate with the higher pooled G2 point difference (model minus recent form)
goes to the judgment. **A tie is equality at four decimals,** the precision the results record, and
ties go to the simpler, the components. The choice, both candidates' lines and the rule's arithmetic are
written in the development check's record before the judgment's claim file exists. **2024 judges only
the chosen candidate,** and the other is never computed on 2024.

### 2.9 The range and the chance (D:60-62)

- **Band-fit rows:** every lined row of weeks 4 to 17 of the band seasons (2022 for the check, 2022
  and 2023 for the judgment) of a player who gets a number under 2.2 and 2.12 (the projected-set rule
  applied as on judged rows, the rate-m rows included), at every position of the fit (round 4's
  dispersion rows, R4 §2.6). **Residuals:** actual points less the candidate's point, per format, on
  band-fit rows whose points are out of sample by forward-chaining for the trees (the shrinkage
  constants of 2.4 are fitted inside the window, so they are in sample for these rows, which narrows the
  bands and makes G4 harder, pre-lock N1): for the check, the 2022 rows scored by the models fitted on 2021 (a
  fit with no fold takes the cell its next refit chooses, round 4's stated exception, R4 §2.6), and for
  the judgment, the 2022 rows so scored and the 2023 rows scored by the models fitted on 2021 to 2022
  (the check's own models). This is round 4's dispersion window (R4 §2.6: 2022 for the check, 2022 and
  2023 for the judgment).
- **Point bands:** within each position and format, five bands at the quintiles of the point over the
  band-fit rows (edges at the 20th, 40th, 60th and 80th percentiles, a point on an edge in the upper
  band). A row takes the band of its own point.
- **Floor, median and ceiling** = the point plus the 10th, 50th and 90th percentiles of the residuals of
  his position, format and band (numpy's default linear interpolation). No clipping.
- **The chance of beating a number x** = the share of his band's residuals r with point + r > x, ties
  counting half.
- **The start-and-sit chance** for A and B = the share of all pairs (r_A, r_B) of their bands' residuals
  with point_A + r_A > point_B + r_B, ties half. **The two are taken as independent,** which the
  simulation did not assume for teammates. The sentence stays conditional on both playing.
- **G4's calibration gates apply unchanged** (D:61-62, 3.2). A player on the rate-m rule takes his
  position's bottom band (round 4's bottom-quintile rule, R4 §2.10).

### 2.10 The why (D:37-38)

Round 4's seven factor groups, its neutral values and its exact Shapley value over 2^7 = 128
coalitions of the deterministic point function (R4 §2.7), computed over the trees and the structural
paths of the chosen candidate. Groups 3 to 6 enter the team model, so their neutral setting applies to
the whole club and the team model's volume is recomputed under it. Groups 1, 2 and 7 apply to the
player alone. **No teammate is renormalised** (round 4's clause on the identities falls with them). The eight
team-model volumes are not neutralised directly. They are recomputed under groups 3 to 6. Every 2.4
shrunk rate belongs to group 7, whose neutral is n_eff = 0 (each rate at the position's rate, in place
of round 4's role prior). The season anchors (his season-to-date rate of each component, and the rate m)
belong to no group and stay at their values in every coalition. On
the screen: the three groups with the largest absolute contribution and any other of at least 0.5 PPR
points, each a fact with its source and read time. Excerpts, member-facing, checked against the banned
list:

- "At Buffalo, who allow the 4th most points to running backs"
- "His team is expected to score 25 and win by 3"
- "Wind 14 mph at kickoff, outdoors"
- "Gets 2.1 more targets with Jones out"
- "Gains 7.9 yards a pass this season, pulled toward the average"

### 2.11 The fit, the windows and the seeds

| Fit | Development check | Judgment | Source |
|---|---|---|---|
| Play and team models | 2016 to 2022, forward-chained | 2016 to 2023, forward-chained | R4 §2.6, D:70-71 |
| Raw share models | 2021 to 2022 (2021 alone for 2022's rows) | 2021 to 2023 | R4 §2.6 |
| Component trees and the rival | 2021 to 2022, weeks 4 to 17, lined rows | 2021 to 2023, the same | D:72, R4 §2.6 |
| (d, k), the position's rates, the minor constants | 2021 to 2022 | 2021 to 2023 | 2.4, 2.5 |
| Residual bands | 2022 rows | 2022 and 2023 rows | 2.9 |
| Checked or judged | 2023 weeks 6 to 17, once | 2024 weeks 6 to 17, once | D:72-73 |

**Tuning.** Each tree's cell is chosen by forward-chaining inside its own window: train on the seasons
before s and validate on s, for each s after the first, the loss summed over folds (Poisson deviance
for counts, squared error for yards and for the rival). The 2021-alone fits take the cell the
2021-to-2022 fit chooses (R4 §2.6's exception). The order: the play model, the team model and the share
models (each as round 4), then the shrinkage (2.4), then the component trees, then the rival.

**Seeds.** No simulation runs, so round 4's run_seed falls. Every tree takes `random_state` 0. The
bootstrap is 10,000 resamples with `default_rng(42)`. The weather sensitivity view (section 5) uses
seed 2024 as round 4 stated. Every other step is deterministic.

### 2.12 Missing inputs

Every row of R4 §2.10 holds as written, with Amendment 2's repairs, for the inputs it names. For a
tree, "missing" is NaN plus the indicator. Added, each counted for the fit seasons, the check and the
judgment:

| Case | Default |
|---|---|
| No evidence he plays (2.2) | No number, `no_play_evidence` 1 |
| No game this season before W, with evidence | The rate m in each format (R4 §2.10), with his position's bottom band (2.9) |
| n_eff = 0 for a quantity of 2.4 | The position's rate |
| A quarterback with no carry this season | The position's yards per carry for his rushing yards |
| The rival with no game this season before W | The rate m in each format, as for the components (2.8), `rival_no_form` 1 |
| No raw modelled share (a share model's output is NaN) | His season-to-date share of the kind, else 0, with `no_share` 1 |

---

## 3. Benchmarks and gates

### 3.1 The backtest

**Judgment: 2024, weeks 6 to 17, once,** each game at its t_g, against each player's published week-W
line through round 3's outcome reader. **Development check: 2023 weeks 6 to 17, once,** before the
judgment, identical code. Windows as 2.11.

**Population and statistics:** round 3's and round 4's, unchanged. Players with a week-W line in the
union of ADP's top K and the season-to-date top K, K = QB 36, RB 72, WR 108, TE 36. S1 Spearman rho per
week and position with at least 8 players, pooled as the mean over weeks of the four-position mean. S2
places off for starters (QB 12, RB 24, WR 24, TE 12). S3 range shares (10th, 50th, 90th). S4 chance bins
[0.5, 0.6), [0.6, 0.7), [0.7, 0.8), [0.8, 0.9), [0.9, 1.0]. **Uncertainty:** the week-block bootstrap over
the 12 weeks, 10,000 resamples, `default_rng(42)`. **The fill rule:** a source with no number for a row
ranks it below every row it has, ties averaged, identically for every source.

**Benchmarks:**

| Benchmark | Definition | Role |
|---|---|---|
| ADP | `ffc_adp_ppr_12` within position | G1 |
| Recent form, the rounds' | Mean PPR points a game this season before W, else last season's | G2 |
| Recent form, last three | Mean PPR points over his last three games played before W | G2's point guard |
| Round 3's number | `commish_weekly_v3`'s x by its committed code at `dc39efce`, its stage 1 fit as its own development check fitted it for 2023 (reproduced, 6.3) and on 2021 to 2023 for 2024 (R4 §3.1), a benchmark that judges nothing | G7 |
| **The spreadsheet, as preregistered** | form x A x (T / T-own), R4 §3.1 term for term (A the opponent's PPR allowed to the position per game over the league mean per team-game, weeks before W, shrunk toward 1 with 6 games, T the club's implied points at t_g, T-own its mean implied points over its earlier games this season) | G6 and G3's sheet line (decision (a)) |
| **The spreadsheet, damped** | form x (A x T / T-own)^(1/2), the same A, T and T-own (D:86) | G6 and G3's sheet line (decision (a)) |
| Props-implied yardage and receptions points | R4 §3.1 | Reported only |

**FOUNDER DECISION PENDING, default as written: (a) the spreadsheet benchmark.** The preregistered
spreadsheet is kept as it is AND the damped form (recent form times the square root of the two ratios)
is added. G6's five lines and G3's spreadsheet line are each computed against both sheets on the same
rows under the fill rule, and **each line passes only if it passes against both** (the stronger, line by
line). Each line's record prints both values. The pooled lower bounds are bootstrapped once per sheet at
the 1.667th percentile. Requiring both keeps each line's level (an intersection-union test), so the count
of comparisons stays three and the count of lines stays 34. The stop rule's "G6 pooled" is the pooled G6
line against both. Basis: the preregistered sheet trailed form on 2023 by -0.0126 (CR B), so it was the
easier bar, and the damped one is expected to sit nearer form (CR D.10). Requiring both can only make
each line harder.

**Under the other answers:** if the founder keeps the preregistered sheet only, the damped row is
reported only, and G6, G3's spreadsheet line and the stop rule's "G6 pooled" are against the
preregistered sheet. If the founder replaces it, the preregistered row is reported only, and the same
three are against the damped sheet. Nothing else changes in any answer.

**What the baseline is and is not:** as R4 §3.1. The claim "beats human predictors" is made only from
the prospective comparison of 3.3, never from G6.

### 3.2 The gates (all must pass, and a gate that cannot answer fails)

| Gate | Threshold | Basis |
|---|---|---|
| **G1, against ADP** | Pooled model minus ADP rho **>= +0.04** with lower bound **> 0**, each position **>= -0.02** | R4 §3.2. A research gate, conjunctive and only harder. It is not the shown record, which never grades a weekly order against ADP (founder 2026-10-21, Amendment 5 item 3 keeps ADP for the research record), so no conflict (pre-lock N6) |
| **G2, against recent form** | Pooled model minus form **>= +0.030** with lower bound **> 0**, each position **>= -0.02** | R4 §3.2. **FOUNDER DECISION PENDING, default as written: (b) the margin stays +0.030** (D:88-90). If the founder sets another margin before the lock, it replaces +0.030 in G2 pooled and in the last-three guard together, G7 stays +0.015, and the paragraph "Why G2's margin is +0.030" is replaced by the founder's basis. The multiple-comparisons rule does not change |
| **G2, the last-three guard** | Pooled model minus last-three form **>= +0.030**, a point comparison | R4 §3.2. Its margin is G2's, and moves with decision (b) |
| **G6, against the spreadsheets** | Pooled model minus baseline **>= +0.015** with lower bound **> 0**, each position **>= -0.02**, against both spreadsheets, each line | R4 §3.2, 3.1's decision (a) |
| **G7, against round 3's number** | Pooled model minus round 3 **>= +0.015**, a point comparison | R4 §3.2, D:79-80 (no G8 against round 4's number) |
| **G3, places off** | Pooled places off at least **0.25** fewer than ADP's, **0.75** fewer than form's, **0.25** fewer than each spreadsheet's (both must pass, decision (a)) | R4 §3.2 |
| **G4, calibration** | Each of 12 cells (4 positions by 3 formats) with n >= 100: below the floor and above the ceiling each within **[0.06, 0.14]**, below the median within **[0.44, 0.56]**. Chance bins with at least 200 pairs: observed minus mean chance within **+-0.04**, at least three bins gated | R4 §3.2, D:61-62 |
| **G5, isolation** | Section 5's rule, allow-list and per-game clause hold for every fit and judged game. The readers: play and team fits 2016 to 2023, the player fits 2021 to 2023, the judgment 2024 only, all refuse 2025 and 2026. `preseason_projections`, `preseason_board_reasons`, `published_boards`, `register_freeze_rows`, `register_grade_rows` and `model_artifacts` outside this round's keys digest the same before and after | R4 §3.2, Amendment 7 item 10 |

**Gate lines:** G1 5, G2 5, the last-three guard 1, G6 5, G7 1, G3 3, G4 13, G5 1: **34**, as round 4.
Each pooled line carries its point margin and its lower bound together, so "G2 pooled" fails when
either fails. Thresholds in one constant (`ROUND_FIVE` in `research/model/weekly5/gates.py`), with a
test at each threshold. The model name is `commish_weekly_v5`.

**Why G2's margin is +0.030:** R4 §3.2's arithmetic, unchanged: at the measured per-week SD of 0.0470
to 0.0506 over 12 weeks the standard error is 0.0136 to 0.0146, and at one-sided z(1 - 0.05 / 3) = 2.128
the bound reaches zero from +0.029 to +0.031. CR D.9: "The gates were set right." The honest
consequence (D:89-90): the Proj column keeps the week's published projection until a round clears it.

**Multiple comparisons.** Three bootstrapped comparisons, pooled G1, G2 and G6 (G6 against each
sheet, both required, which keeps the level). Each lower bound is the **1.667th percentile** (one-sided 0.05 / 3). The candidate choice
of 2.8 selects on 2023, the development season, and never on 2024, so it adds no comparison to the
judgment. It does make the 2023 check optimistic for the chosen candidate, which is why the check can
stop the round but never ships it.

**Reported, not gated:** every source's rho per position and format; both spreadsheets and their leads
over form; both candidates' every line on 2023; each component tree's validation loss against the
player's season-to-date rate of the component; each shrunk quantity's loss against its unshrunk
season-to-date rate and against round 4's share-decay form; the chosen (d, k) per position and
quantity; the ablations (without the game terms, without weather, without the charted features,
without the team volume inputs, without the anchors, without the rate m (bounding exposure item 6, pre-lock F11), without the touchdown share input, with the
efficiency windows at round 4's share decay, and round 3's input rule with the game figures hidden);
`no_play_evidence` by position and week, and the population rows it removes; the weather sensitivity
view and the retractable-roof live-rule view (R4 §5); every default count of 2.12; the Questionable
play chance and its calibration (R4 §2.6); the residual bands' edges and quantiles; the team model's
residual by season; and the run times.

**The decision rule.** If every one of the 34 lines passes on the one judgment of 2024 weeks 6 to 17,
the weekly number ships. If any line fails or cannot answer, nothing ships.

**The stop rule after the development check.** If the chosen candidate fails G2 pooled or G6 pooled on
2023, the round ends, the judgment is not run, 2024 stays unjudged and no threshold moves. A failure of
any other line is examined for a defect and does not by itself stop the round.

**On a fail:** no weekly number and no chance sentence. The screens keep the week's published
projection in the Proj column and the week facts, the results report every number, and neither this
system nor a retune of it is judged on 2024 again.

### 3.3 Prospectively, in the 2026 register

R4 §3.3 with Amendments 4 to 6, unchanged in its rule. From the first week the code runs the register
freezes each game's numbers before its own kickoff, pass or fail, as a shadow record. Only numbers
frozen by the pinned served version count toward "leads". **The prospective benchmarks:** the week's
published projection (`published_points`), ESPN's projection (`espn_points`, Amendment 5, the first
read before kickoff per Amendment 6), and the props-implied number (R4 §3.3 with Amendment 1 item 4).
Free weekly consensus stays out until the founder clears its terms. **"Leads":** a positive pooled
weekly rho lead with the week-block bootstrap lower bound above zero at two fixed looks only, after
week 13 and after week 17, each at the 1.25th percentile, at least 5 counted weeks at the first look,
each benchmark a separate claim. **On this calendar** (section 6) the first look answers only if the
switch lands by week 9, since a week 10 switch leaves four counted weeks (10 to 13) at it. Then the
week 17 look is the only one, and the page says so. A week counts only if the switch landed before its
Thursday freeze (Amendment 7 item 14's rule).

---

## 4. What ships on a pass

- **The served fit.** After a pass and before the first counted freeze, the judged procedure is refitted
  once: the player-level models and the shrinkage on 2021 to 2024, the play and team models on 2016 to
  2024, forward-chained as in 2.11, the residual bands on the 2022, 2023 and 2024 rows each scored out
  of sample, with **the hyperparameters, decays, (d, k) cells and grid cells the judged fit chose, and
  no selection of any kind**. It reads 2024 outcomes and none of 2025 or 2026. Pinned in
  `model_artifacts`, the judged artifacts kept beside it (R4 §4).
- **The week's points** in each format on the start, waivers and trades rows and in the trade builder
  (R4 §4), and the published expected components the API scores under each league's rules (2.5). The
  floor-to-ceiling range follows Amendment 7, the coordinator's rulings of 2026-10-22 (5): one row shape across positions, decided by the
  coordinator at the switch and recorded as an amendment.
- **The start-and-sit sentence:** "White scores more than Bigsby in about 62 of 100 games like this, if
  both play."
- **The why lines** (2.10), each a fact with its source and read time.
- **The record page's weekly comparison** under 3.3.
- **The switch, ready means live.** The planned switch week is **week 10** (the Thursday 2026-11-12
  pass). It yields to the live board: the number replaces the week's published projection on the first
  in-season pass after the pin, any day, never before the pin, so week 9 (the Thursday 2026-11-05 pass)
  if the pin lands before that pass. Rows whose game has kicked off keep the figure they had.
- `model_version` and `implementation = 'python'` on every row. On a fail only the facts ship.

---

## 5. Isolation and honesty

**The input rule.** R4 §5's per-game instant t_g, its rule (every input from a week before W and
stamped at or before t_g, except the explicitly listed (source, metric) pairs, never by source alone
and never by a stamp window) and its items 1 to 8, with Amendment 1 item 3 (`game_weather`), Amendment
2 item 1 (surface) and Amendment 3 (a played game is a snap), unchanged. **This round admits no new
(source, metric) pair.** The projected set's evidence (2.2) reads the week-W depth chart under item 6
and earlier weeks' snaps under round 3's admission. The kick columns and the kicking and defense weeks
of Amendment 7 are not read.

**The guard tests,** each in the round's suite before the check:

1. R4 §5 item 5's tests, carried: the selected `nflverse_kickoff` and `game_weather` metric list is
   asserted, and a week-W `game_result` row fed through each read kind raises `InputRuleError`;
2. a week-W stat line (each component a tree targets) fed through the feature, anchor and shrinkage
   reads raises `InputRuleError`;
3. the projected-set rule given a week-W snap row raises `InputRuleError`, and given only a week-W chart
   row admits him;
4. the shrinkage fit, the residual-band fit and the minor constants, given a row of 2025 or 2026 or of a
   season after their window, refuse it;
5. the rival's PPR recent form, computed at t_g, equals the G2 benchmark's on every row, and its half-PPR
   and standard forms come from the same function with the format's scoring.

**The flatteries,** R4 §5's, carried: the closing figure (it favours the model against form and ADP,
not against the spreadsheets, which read the same figure), the recorded weather as the forecast (it
favours the model against every benchmark, bounded by the weather ablation and the sensitivity view:
wind Normal SD 4 mph floored at 0, temperature SD 3 F, the precipitation flag flipped with probability
0.10, seed 2024, outdoor games only), a retractable roof's recorded state, and the charted features' and
depth charts' reconstructed stamps.

**2023's standing, said plainly.** 2023 has been read by the development checks of rounds 2, 3 and 4 and
of the kicker and defense sub-round, and this design was drawn from round 4's 2023 numbers (D:3-5). A
design made with knowledge of a season tends to suit it, and the candidate choice of 2.8 selects on it
too. The 2023 check is therefore a gate that can stop the round and never evidence for shipping.

**2024 and the read-discipline ruling.** As R4 §5 (the coordinator's ruling on H9): this judgment is not
a selection. Its thresholds are fixed here, it runs once, no variant is chosen on 2024 (the rival is
chosen on 2023, and every alternative on 2024 is a reported ablation), and a 2024 pass is read as
provisional, the ruling's sentence printed beside the verdict. The test that cannot be eroded is the
2026 register's two fixed looks.

**2024's exposure, in full.** R4 §5's items 6, 1, 2, 3, 4, 5, 7 and 8 carried by number (item 8: round
3's number is computed on 2024 inside this judgment as G7's benchmark, and none of its numbers carries a
verdict for round 3). Added:

- **Item 9:** round 4's development check read no 2024 to 2026 outcome (R4R §2, G5 PASS). Round 4 never
  ran its judgment, and its records hold no 2024 number.
- **Item 10:** the kicker and team-defense sub-round (Amendment 7). Its development check ran on 2023
  only. Its 2024 judgment was refused by its stop rule and never ran, and no claim file for it exists
  (`2026-10-23-weekly-kdef-results.md`). Its scratch copy holds the play table's kick columns for 2016
  to 2024 and ESPN's archived 2023 and 2024 projections, ingested and read by no fit, check or gate of
  2024 (its KD6 PASS). This round reads neither. Its feature store was built through 2024 on
  `lane157_kdef`, so 2024 team-game outcome columns exist in its files. No fit, check or gate loaded
  them, and this round builds its own.
- **Item 11:** the design draft, round 4's results and its credibility review, from which this document
  was written, hold no 2024 number. This author read no 2024 row.
- **Item 12:** Amendments 4 to 6's records grade 2026 weeks only. No 2026 grade enters any fit, tuning
  step, gate or choice of this round.

Nothing else of 2024 was read in writing this.

**2025 and 2026 outcomes are never read** by a fit, a tuning step, a gate or a model choice. The served
refit reads 2024 and nothing later.

**Each run once, each claimed by an exclusive file, each record named.** The development check's
record is `docs/research/2026-10-26-weekly-projection-round5-dev-check.json` and the judgment's is
`docs/research/2026-10-26-weekly-projection-round5-results.json`, the runner's constants naming exactly
these paths. Round 3's reproduction and every precondition of 6.3 run before the claim, as round 4's
runner ran them, and read no outcome of this round's model. The development check is then claimed by
`docs/research/2026-10-26-weekly-projection-round5-dev-check-taken.json`, created exclusively before any
2023 outcome row is read for this round's model. The judgment is claimed by
`docs/research/2026-10-26-weekly-projection-round5-judgment-taken.json`, created exclusively before any
2024 outcome row is read, and refused unless the development check's record exists at its named path,
its stop rule did not end the round, and the candidate choice is written in it. Each runs on a clean tree whose HEAD
descends from the lock (round 2's `preregistration_committed` rule). A second run, or any change not
recorded as a defect amendment, voids it, and the results must say so.

---

## 6. Plan, cost and time

### 6.1 The calendar

Today is Friday 2026-10-23. The draft's own calendar (D:94-96): the preregistration written and
reviewed within a day, the build two to three days since the feature store and team model are reused,
the check once, the judgment once, and week 9 possible only if the build started by October 19. It did
not, so week 9 is not planned. First kickoffs ahead (R4 §6.1, UTC): week 8 2026-10-30 00:15, week 9
2026-11-06 01:15, week 17 2027-01-01 01:15.

| Dates (2026) | Step | Who |
|---|---|---|
| Oct 23 | This document | Lane 167 |
| Oct 24 to Oct 26 | The founder's word on the two pending decisions, the pre-lock review, the lock | Coordinator |
| Oct 26 to Oct 29 | The build in `research/model/weekly5/`: the projected set, the shrinkage, the component trees, the quarterback path, the touchdown rule, the rival, the residual bands, the why, both spreadsheets, `ROUND_FIVE` and its tests, the guard tests, a pre-run review | A build lane |
| Oct 29 to Oct 30 | The development check, once, both candidates, the choice and the stop rule applied | Coordinator |
| Oct 30 to Oct 31 | The judgment, once, if the stop rule does not end the round, and the results | Coordinator |
| Nov 1 to Nov 4 | On a pass: the served refit pinned, the serving lanes | Coordinator, then lanes |
| Nov 12 | The planned switch week, week 10, yielding to the live board (section 4) | The in-season pass |

The shadow freeze runs from the build lane's end, internal only and excluded from every "leads" test.

### 6.2 Cost

Compute on the founder's laptop: round 4's check took 4,018 s with a 10,000-draw simulation (R4R §2).
This round drops the simulation and adds per-position trees on a few thousand rows each: the check and
the judgment are each estimated under two hours, and the results report the measured times. The served
refit, under 30 minutes. Money: none beyond round 4's captures. No model call and no prose in the fit
or the judgment.

### 6.3 Who runs what, and the preconditions

The coordinator, never a subagent, runs the development check, the judgment and the served refit once
each, on `lane70_weekly` on the local test server (port 5433), round 4's scratch copy of dev's
`research` schema at revision 0010 with lanes 66a and 66b's history (R4R §1), or a fresh restore of the
same dump. The round's scratch guard admits only a `lane70_` database on 5433. Never dev (5432), never
5440, never production.

**Preconditions, checked before any fit and recorded in the results:**

- R4 §6.3's preconditions, every one, counted as round 4 counted them;
- the feature files rebuilt with `--depth-chart week`, their digests equal to round 4's
  development-check JSON `features.digests` for 2016 to 2023. The 2024 files, which no earlier record
  names, are built by the same code at the lock and their digests recorded;
- **round 4's components reproduced exactly before use:** the check's play model, team model and share
  model fits on their round 4 windows equal round 4's development-check JSON `fitted.play_model_cells`,
  `fitted.team_model_cells`, `fitted.share_cells` and `fitted.share_fold_losses`. Round 4 recorded the
  team model only for its 2022 and 2023 rows, so the team model fitted on 2016 to 2020 for this round's
  2021 rows has no earlier record to equal: its cells are recorded in the development check's record
  (pre-lock N7);
- round 3's code at `dc39efce` reproducing its development check's 26 gate lines exactly before it is a
  benchmark;
- the judgment only: the 2024 rows of every input present by count (R4 §6.3's 2024 counts), counted
  without reading an outcome value. The development check's guard refuses 2024
  (`weekly2.guard.closed_seasons`), so this precondition does not run there.

A missing or unequal one refuses the run and is named.

### 6.4 The order and the lock

Each step committed before the next: (1) this document, committed by the coordinator: the lock, its
commit message repeating the windows of 2.11, and the runner's amendment list naming round 4's
amendment commits including Amendment 3's `b3796049` (pre-lock N9); (2) the build and its tests, with a pre-run review; (3)
the preconditions and round 3's reproduction, then the development check claimed by its file, its
record, the candidate choice, any defect amendment, the
stop rule applied; (4) the judgment, once, claimed by its file; (5) the results; (6) on a pass, the
served refit, pinned, before the first counted freeze. The judgment refuses to run unless the lock is an
ancestor of HEAD.

---

## 7. Readings this document made where the draft was silent

Each is a choice a fit or a gate turns on, stated here so the pre-lock review can rule on it. None reads
a judged outcome.

1. **The projected set's evidence** is a week-W chart row at any depth or a snap in one of the club's
   last three games, either sufficing (D:42-43 lists both without saying "and" or "or"), CR D.2's own
   wording ("players with recent snaps or a week-W depth-chart row"). It can only take numbers away.
2. **The tree inputs** are the numeric feature row of 2.3 plus all eight team-model volumes in every
   tree, not a per-component subset (reviewed: reasonable once the column list is fixed, pre-lock B1).
3. **The efficiency windows** weight opportunities by d^a within the season, with d in {0.85, 0.95, 1.0}
   and k in {10, 20, 40, 80, 160, 320, 640} opportunities ({0.5, 1, 2, 4, 8, 16, 32} expected-touchdown
   units for the conversions), and choose (d, k) on the fit window's rows directly, not by
   forward-chained folds, as round 4 treated its shrinkage constants. Ties go to more pooling.
4. **No prior season** enters the efficiency rates (the draft says "season-to-date", CR D.4 suggested
   season plus prior).
5. **The shrinkage target** is the position's opportunity-weighted rate. Round 4's charted role prior is
   dropped as a target, and its features stay as tree inputs.
6. **Quarterbacks are structural** for attempts, passing yards, interceptions and passing touchdowns
   (D:53-56 read as replacing the trees there), with a tree only for carries.
7. **Passing touchdowns** use the club's expected receiving touchdowns times his modelled dropback share
   times a shrunk conversion (D:56's "share of them" read as the receiving touchdowns he throws).
8. **The touchdown share** is the equal-weight mean of the modelled red-zone and inside-ten shares, the
   conversion fitted on realised shares and realised club touchdowns. A quarterback's s is his
   season-to-date share of the two kinds, since no model of them exists for quarterbacks (pre-lock B3).
9. **Fumbles lost** (absent from D:31-32) take a position constant over the fit window, per touch. The
   two-point component is 0, since the scored line carries none (pre-lock F1).
10. **The rival** is one tree per position and format (12). A row with no game this season before W
    takes the rate m for both candidates and enters no rival fit (pre-lock F5).
11. **A tie between candidates** is equality at four decimals.
12. **Point bands** are quintiles within position and format, and the start-and-sit chance treats
    teammates' residuals as independent.
13. **"G2 pooled" and "G6 pooled"** in the stop rule are the pooled lines with their lower bounds, as
    Amendment 7, the coordinator's rulings of 2026-10-23 (g), read KD1 and KD2.
14. **The spreadsheets:** each G6 line and G3's spreadsheet line must pass against both sheets (pre-lock
    F2), replacing the first reading's "stronger by pooled rho".
15. **A missing modelled share** falls back to the season-to-date share (2.12).
16. **The planned switch week** is week 10, since the draft's week 9 condition (a build started by
    October 19, D:96) did not hold. Week 9 remains reachable under ready means live.

**The pre-lock review's notes, recorded as readings**
(`.superpowers/sdd/2026-10-12-prep-site/reviews/round5-prelock-review.md`, N1 to N11):

17. **(N1) The shrinkage constants are in sample** for the trees' 2022 validation fold and the band rows.
    This narrows the bands (G4 harder) and does not reach the checked or judged season. 2.9's "out of
    sample by forward-chaining" holds for the trees, not for the shrinkage constants.
18. **(N2) Only his club's volume** enters his trees (2.3 governs 2.1, "for both clubs" struck).
19. **(N3) The point omits** kick and punt return touchdowns, the kneel yards in a quarterback's line, and
    the house scorer's rounding, each small and the model's own choice (2.5).
20. **(N4) Bonus scoring live:** for a league with yardage or 100-yard bonuses, scoring the expectation is
    not the expected score. The serving lane names it, and no gate reads it (2.5).
21. **(N5) The calendar:** the plan pins the served refit by Nov 4, before week 9's Thursday pass, so ready
    means live puts week 9 live under the plan's own dates and "planned week 10" is nominal. Amendment 7
    item 14's "landed before its Thursday freeze" reads as "a week counts when its graded freeze was made
    by the pinned version". Under either reading a week 10 switch leaves the first look short of 5 weeks.
22. **(N6) G1 against ADP** is a research gate, conjunctive and only harder, and no conflict with the
    founder's 2026-10-21 ruling on the shown record (3.2's G1 basis).
23. **(N7) The team model fitted on 2016 to 2020** for the 2021 rows has no round 4 record to equal, and
    its cells are recorded in the development check's record (6.3).
24. **(N8) Amendment 7's duplicated item numbers:** its rulings are cited by date, "the coordinator's
    rulings of 2026-10-22 (5)" and "of 2026-10-23 (g)".
25. **(N9) The runner's amendment list** names round 4's amendment commits, Amendment 3's `b3796049`
    included, which the header's "and after" covers (6.4).
26. **(N10) Fit rows are not filtered:** neither the projected-set rule nor the designation filter applies
    to fit rows, so a Doubtful player who played is a fit row, as in round 4 (2.2).
27. **(N11) The sixteen readings above were each ruled** reasonable and not in the model's favour, with
    readings 2, 8, 9, 10 and 14 completed by B1, B3, F1, F5 and F2 as written here. Reading 14 was the one
    slightly in the model's favour before F2.

---

## 8. The results record, a template

`docs/research/2026-10-26-weekly-projection-round5-results.md`, the coordinator's, in this order:

1. **Preconditions and reproduction.** Run time, database, HEAD, the lock's sha. Every precondition of
   6.3 with its count. Round 4's fitted cells and round 3's 26 lines: equal or not.
2. **The development check (once).** Claim file and record path
   (`2026-10-26-weekly-projection-round5-dev-check-taken.json`,
   `2026-10-26-weekly-projection-round5-dev-check.json`), the input column list of 2.3 and the cells of
   the team model fitted on 2016 to 2020. Fit times. Both candidates, every one
   of the 34 lines, pooled and per position, in the form of R4R §2 (G1, G2 with the last-three guard, G6
   against both sheets, each line printing both values, G7, G3, G4 per cell and the chance
   bins, G5). The choice: each candidate's pooled G2 point to four decimals and the one chosen. The stop
   rule: met or not, in its words.
3. **Defects found, and amendments** committed before the judgment (section 9), or "none".
4. **The judgment (once),** if run: claim file and record path
   (`2026-10-26-weekly-projection-round5-judgment-taken.json`,
   `2026-10-26-weekly-projection-round5-results.json`), the 2024 feature digests, the chosen candidate's 34 lines, the
   decision by the rule, the provisional caveat line, and R4 §5's item 8 numbers for round 3.
5. **Reported views:** every item of 3.2's "reported, not gated".
6. **Readings the build or the runs took** where this text was silent, each one line, each saying it
   moved no threshold, seed, population or judged week.
7. **On a pass:** the served refit's pin and the switch pass's run id. **On a fail:** the sentence "No
   weekly number from round 5 reaches a screen" and what the numbers say for the next design.

## 9. Amendments

Each amendment is committed before the step it governs, as 6.4 requires, and names what the document
said, what was found, and the rule as it now reads. None yet.
