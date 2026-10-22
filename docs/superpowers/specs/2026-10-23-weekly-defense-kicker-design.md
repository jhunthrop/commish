# Weekly rankings for team defenses and kickers: design, and the Amendment 7 draft

**Status:** design for the coordinator, written 2026-10-22 (Lane 154, read-only). Nothing here is
locked. Section 11 is the draft of Amendment 7 to the round 4 preregistration, for the coordinator to
adjudicate and move into `docs/research/2026-10-16-weekly-projection-round4-preregistration.md` §7.
**Ask:** founder, 2026-10-22: "we still don't have rankings for D/ST" (ledger, 20:51Z).
**Authority above it:** the round 4 preregistration and its Amendments 1 to 6, the K and D/ST
September ruling (`docs/research/2026-09-05-kicker-defense-preregistration.md` and
`-preregistration-results.md`), the in-season tools spec (`2026-10-15-in-season-tools-design.md`), and
the standing rulings: expert-grade analysis, never an MVP, ready for this week means live, box score
not prose, no betting words, fantasy words not trading words, no provider name on the site, 2026
outcomes never read by a fit or a gate.
**What its author read:** the brief, the documents above in full, `research/model/weekly4/`
(team model and its targets), `research/model/weekly/`, `research/inseason/season_week.py`,
`research/pipeline/nflverse/kdef_lines.py`, `research/pipeline/espn/projections.py` and its fixture,
`research/nightly/reads/weekly_record.py`, `research/pipeline/odds/`, `research/model/domain.py`
(scoring), the K and D/ST audit of 2026-10-16, the web's week tab (`web/src/lib/order/week*.ts`,
`WeekTable.svelte`) and the Players page, and `api/internal/inseason/week_order.go`.
**Data reads:** dev only (5432, a read-only transaction), counts and column lists, no outcome value
of any season. Two public reads of ESPN's player pool (2026 week 8, 2024 week 8), counted by position;
no figure in them was compared with any outcome. Nothing on 5440 or production.

---

## 1. What exists today, verified

| Fact | Where it was checked |
|---|---|
| The board's **K and DST tabs in season** already show the week as a box score (Lane 66w): one row a club, in the order of the week's published projection (`Proj`), with `Game`, `Opp rank`, `Avg`, `Last`, and in a league the roster and an `Add` on the first five free rows. Before the projection lands the rows are in order of `Avg` and the tab says so | `api/internal/inseason/week_order.go`, `web/src/lib/order/week.ts`, `GET /order/week`, `GET /leagues/attached/{id}/order/week` |
| The **Week N rankings page** (Players in season, Lane 142) lists QB, RB, WR and TE only: its chips are `ORDER_POSITIONS = QB, RB, WR, TE` and its purpose line says "Every QB, RB, WR and TE in our order". This is the founder's "no rankings for D/ST" | `web/src/lib/order/order.ts:38`, `words.ts` `PAGE_PURPOSE.players`, `routes/(run)/players/+page.svelte` |
| The **published projection carries K and DEF rows** in production (32 defenses and 48 kickers a week since Lane 66d), but a defense's figure is the provider's own default defense scoring, not the league's, and the stored row keeps no defense components | ledger 2026-10-17 14:00Z; `tank01_projection_rows` columns (no sacks, takeaways or points-allowed columns); week tab basis "on its default defense scoring" |
| **ESPN's public pool carries K and D/ST projections, with their components.** The 2026 week 8 read: 58 kickers listed, 44 projected; 32 D/ST listed, 32 projected; each split carries ESPN's stat ids (field goals by distance for kickers; sacks, takeaways and the points-allowed and yards-allowed bands for D/ST). The stored read keeps every projected player (`parse_pool` keeps all positions), so week 7's 664 rows already include them | one read 2026-10-22 20:55Z; `research/pipeline/espn/projections.py` |
| **ESPN keeps past weeks' projections:** 2024 week 8 answered 65 projected kickers and 32 projected D/ST. Its stamp is not published (assumed its last pre-game version) | one read 2026-10-22 |
| The ESPN fixture `research/tests/testdata/espn/pool_2026_w7.json` holds five players (2 RB, 2 WR, 1 TE) and **no K or D/ST row**, so no test covers their parse | counted |
| **The weekly record cannot grade K or DEF today.** The freeze keeps the shipped order (`commish_ros_shipped_ppr_12`, skill positions only); `RECORD_POSITIONS` is the four skill positions; the 32 `team-def:` universe rows have no ESPN id, so ESPN's D/ST ids (`-16000 - club`, e.g. `-16026` Seahawks) cannot join a freeze row | `weekly_record.py`, audit data gap 1 |
| **History in dev:** kicking weeks 2013 to 2025 (510 to 545 club-weeks a season, 32 clubs); team defense weeks 2013 to 2025 (512 to 544 a season, no null `points_allowed`); game figures (`nflverse_kickoff` `implied_team_total` and `point_spread`, 12,158 rows from 2003; `nflverse_game_figures` 2016 to 2026); `game_weather` 2016 to 2026 (256 to 272 games a season); `stadiums` 47 rows; kicker filings 2016 to 2024 (498); `nflverse_pbp` club-week metrics including `line_sack_rate_allowed`, pace and pass rate over expectation from 2003 | dev counts |
| **Play-by-play holds every kick but not its result.** `nflverse_pbp_plays` has 946 to 1,115 field-goal plays and 1,134 to 1,347 extra points a season (2016 to 2025; 327 and 377 so far in 2026) with field position, wind, temperature and roof, but no `kick_distance`, `field_goal_result`, `extra_point_result`, `kicker_player_id`, `two_point_conv_result` or `td_team` column | column list |
| No 2026 kicking or defense week, no `nflverse_kdef_week` stat line and no ESPN or published projection row is in dev (they are written in production by the in-season pass) | dev counts |
| Depth charts hold no kicker rows | `nflverse_depth_chart_weeks` |
| The team model (round 4, `weekly4/team_model.py`) predicts each club's plays, dropbacks, **sacks**, scrambles, designed rushes, targets and rushing and receiving touchdowns from the game figures, tempo, the defence's pass rate allowed and pressure, venue and weather. The round 4 credibility review found it far better than the implied points alone; round 4 stopped on the skill positions' share layer, not on it | round 4 results §2, round 5 draft §1 |

## 2. Why the September ruling does not answer this, and does not bind it

The September round asked a different question: one season's total for each kicker and defense,
judged once on 2025, from the unit's own shrunk past. It failed (K ordering +0.0174 against a +0.05
bar and 0.094 behind draft position; DEF ordering -0.1371) and stands: the preseason board keeps K and
DST in draft order, `KDEF_DECISION` is unchanged, and nothing here re-reads, refits or re-judges it.

A week is not a season. Its results document named what was missing: "for kickers, the club's
offense directly" and "for defenses, an incoming team-strength signal". For one game both are known
before kickoff with more precision than any season-long prior: the closing figure prices the club's
expected points and the opponent's, the team model turns them into expected drives, dropbacks and
sacks, and the forecast prices the wind a kicker kicks into. A defense's year-to-year persistence
(the sign flip between 2024 and 2025 that sank the September G1) is not what a weekly number leans
on: most of a defense's week is its opponent, which the figure states. So this is a new
preregistered sub-round with new inputs, a new target (the week), a new judged season (2024, §7.3),
new benchmarks, and its own gates. It reuses no fitted prior of the September round.

## 3. What a member sees

### 3.1 The Week N rankings page

The page keeps its head ("Week 8 rankings") and gains two chips after TE: **K** and **D/ST**. Choosing
either draws the week box score the board's tab already draws (Lane 66w), so there is one table, one
API and one set of words for the week's kickers and defenses across the site, never a second copy.

Desk, interim (before our number passes), D/ST chosen:

```
Week 8 rankings                                    QB  RB  WR  TE  K  [D/ST]
Defenses are in order of Proj, this week's published projection on its default defense scoring,
read Thu 1:05 pm CT, as we have no defense model of our own. Opp rank is points allowed to defenses
this season, 1st the fewest. Avg and Last are its points a game and last game, in PPR.

Player                 Game                                     Proj   Opp rank   Avg   Last
[SEA] Seahawks D/ST    vs NYJ  Sun 3:05   24.5 to 16.0   48°F 9    9.1    30th       8.2   12.0
[DEN] Broncos D/ST     vs CAR  Sun 3:25   23.0 to 17.5   Dome      8.4    27th       9.0    4.0
...
Kicked off
...
Bye in week 8
```

Desk, with our number (after a pass and the served refit, §8):

```
Week 8 rankings                                    QB  RB  WR  TE  K  [D/ST]
Proj is our projection for each defense this week, from its opponent's expected points, its sacks
and giveaways against this opponent, and the kickoff weather, in PPR, read Thu 1:05 pm CT. Floor and
ceiling ... (the site's Floor to ceiling words). Opp rank ...

#   Player                 Game                                  Proj   Floor-ceil   Opp rank   Avg   Last
1   [SEA] Seahawks D/ST    vs NYJ  Sun 3:05  24.5 to 16.0  48°F 9   9.6    3 to 17      30th     8.2   12.0
2   [DEN] Broncos D/ST     vs CAR  Sun 3:25  23.0 to 17.5  Dome     8.8    2 to 16      27th     9.0    4.0
```

Rules, all from the box-score ruling:

- **The player is the biggest thing on the row**: the club mark for a defense ("Seahawks D/ST"), the
  headshot for a kicker. Numbers right-aligned, tabular, one decimal, rounded once in Go.
- **Facts are cells.** The `Game` cell is the opponent, kickoff, each club's expected points (the
  row's club first) and the kickoff weather or `Dome`. For a kicker the wind number carries; for a
  defense the opponent's expected points is the figure that carries. On the page these are a
  matchup figure, never "line", "total", "spread", "odds" or "favored"; in this document and the
  research code they are the book's total and margin.
- **The basis is said once** above the rows, at most five lines at a desk and eight on a phone.
- **No `#` column in the interim.** The interim order is not ours, so the page draws no rank of ours;
  the rows are the Proj column sorted and the basis says whose Proj it is. With our number the `#`
  column appears under the group head "Our week order", and `Floor-ceil` appears beside `Proj`.
- **Phone (390):** Player, Game (opponent and kickoff only, the figures folded under the name as the
  week tab's folded evidence does), Proj, and the evidence line "Opp 30th, Avg 8.2, Last 12.0".
- **A tap opens the shelf** (the player-tap ruling): for a defense or kicker, no page exists (K and
  D/ST pages stay shelved); the shelf shows the game, the last three games as a small box score, and
  with our number the three largest reasons as facts with their read times (§5.7), for example
  "Jets expected to score 16.0, the 4th fewest this week", "Jets give up a sack on 9.1% of dropbacks,
  3rd most", "Wind 18 mph at kickoff, outdoors".
- **Signed in with a league**, the same tab reads the league's scoring and roster (the existing
  league week read), and the basis says "in this league's scoring". Our number is scored under the
  league's own kicker and defense rules (§5.6), which the published projection cannot do for a
  defense.

### 3.2 Lineup

The K and DEF slots already rank by `Proj` after the designation filter and the bye rule (the
2026-10-17 Lineup ruling). Nothing changes in the interim. With our number, the slots read our `Proj`
in the league's scoring, and the swap's evidence line reads "Opp 30th, Avg 8.2, Last 12.0" as every
slot's does. The advice still follows the number the screen shows.

### 3.3 Waivers

Interim: unchanged. The founder's narrowing of 2026-10-16 ("we don't need k d/st but we need point
projections and points") kept K and D/ST out of the Waivers screen; the week tab's `Add` on the
first five free rows is the pickup path. With our number, the Waivers week strip could count a K or
D/ST add whose Proj beats the member's starter at the slot by the same week-gain rule as the skill
positions, which is the main in-season D/ST move. Because our number runs from the Tuesday pass
(the game figures are read from the weekly pass's game table until the hourly capture starts, round 4
§2.10), it can rank next week's defenses while waivers are open, before the published projection is
captured. Whether the strip carries them is a reversal of the narrowing and is put to the coordinator
(§9, item 4). It is not in the lane plan unless ruled in.

### 3.4 Words

Kickers and defenses keep the site's words: `Proj`, `Floor-ceil`, `Opp rank`, `Avg`, `Last`, `Add`,
"defense" in copy and "D/ST" as the label, `DEF` on the wire. No "line", "odds", "spread", "total",
"Vegas", "favored", "underdog", "bet", "market", "price", "value". "Giveaways" and "sacks" are football
words and stand. The provider of the published projection and the odds provider are never named; ESPN
is named only where the record already names its yardstick.

## 4. The honest interim (now, until our number passes)

**Recommendation.** Put K and D/ST on the Week N rankings page now, as the existing week box score in
the order of this week's published projection, labelled once as the published projection's order and
saying we have no kicker or defense model of our own, with no rank column of ours. Before the
week's published projection is captured, the rows stay in order of `Avg` with the tab's existing
sentence ("Week 8's projection for defenses is not in yet. Until it is, there is no Proj, and the
defenses below are in order of Avg."), which orders by a stat and claims no ranking.

Why this and nothing else:

- It is the number the founder already ruled onto the Proj column (2026-10-16 22:10 Central), it is
  already on the board's tab, the Lineup and the Matchup, and showing it on the Week N page is one
  more surface for the same figure, never a second order.
- No order of ours may be shown without a number of ours that passed. The tempting alternative, an
  order "by opponent's expected points" for defenses or "by club's expected points" for kickers, is
  the streamer's sheet of §6.2: an unvalidated rule of thumb presented as our ranking. It is the
  benchmark our model must beat, so it cannot also be the interim.
- The record shows no K or D/ST line in the interim: grading the published projection against itself
  says nothing, and our shadow numbers are not shown before a pass (round 4 §3.3).

**What the interim cannot do, said plainly** (in this document, not on the page): a defense's
published Proj is its provider's default defense scoring, so in a league whose points-allowed or
yards-allowed bands differ it can order defenses wrongly; and it is captured close to each kickoff
slot, so on Tuesday and Wednesday the tab is in order of `Avg`.

**First shippable week of the interim: week 7's Sunday games** (Sunday 2026-10-25). It is one web
lane on an existing API and existing components (Lane 155, §10), with no research or API change.

## 5. The model

### 5.1 Shape

An expert streams a defense by its opponent and a kicker by his offense and his weather. The system
is that, measured and fitted:

1. **The game** (round 4 §2.5, unchanged): each club's expected points and margin from the closing
   figure (live: the hourly capture, 6-hour staleness default to the weekly pass's game table), and
   the kickoff weather (live: the hourly forecast; replay: the recorded kickoff weather of
   `game_weather`, admitted as round 4 §5 item 3 admits it).
2. **The team model** (round 4's `weekly4/team_model.py`, its code, grid, tie rule and monotone
   constraints unchanged), refitted forward-chained inside this sub-round on 2016 to 2022 for the
   development check and 2016 to 2023 for the judgment: each club's expected plays, dropbacks, sacks
   taken, designed rushes and offensive touchdowns. For a defense, its opponent's row is read; for a
   kicker, his own club's.
3. **The components a league scores** (5.2 for defenses, 5.3 for kickers), each fitted per game.
4. **The joint distribution** of the components (5.4), from which floor, median and ceiling come.
5. **Scoring under the league's own rules** (5.6), from the components, so a league's bands and
   distance tiers are applied to a distribution, never to a mean (the September round's one lasting
   insight).
6. **The why** (5.7): exact Shapley values over four factor groups.

The point is the analytic expectation of the scored components under the joint. The draws supply the
range, never the point, and a draw mean off the point by more than 0.25 points or 3 per cent is a
defect counted, as in round 4.

### 5.2 Team defense: components and inputs

| Component (the defense's week) | Model | Inputs read at t_g |
|---|---|---|
| **Points allowed**, a full distribution over 0 to 59 and 60 plus | A kernel over the fit club-games' scores: the empirical distribution of the scores of club-games whose implied points lie within a Gaussian kernel of the opponent's implied points (bandwidth chosen on the fit seasons by forward-chained log loss from {1.0, 1.5, 2.0, 3.0}), exponentially tilted so its mean equals a boosted Poisson model's expected score. Tilting keeps the scores' lumps (0, 3, 7, 10, 13, 14, 17, 20, 21, 24) that a smooth density would erase | the opponent's implied points and the margin; the defense's own shrunk points allowed over expected (its allowed less the implied points it faced, this season and last, shrunk toward 0 with 6 games of prior); roof, wind, temperature, precipitation; home; rest days |
| **Yards allowed**, distribution | the opponent's expected plays (team model) times its expected yards per play (the opponent's shrunk yards per play against the defense's shrunk yards per play allowed, from `nflverse_pbp`), with the fit seasons' empirical residual quantiles by expected-yards band | as named, plus the team model's inputs |
| **Sacks** | the team model's sacks for the opponent offense (already an output; its inputs already carry the defence's sack rate and pressure and the opponent's dropbacks), with a negative binomial dispersion fitted on the fit rows | the team model's |
| **Interceptions** | boosted Poisson: the opponent's expected dropbacks times rates | the opponent passer's shrunk interception rate per dropback (the starter by the filings and the depth chart, round 4's evidence rule), the defense's shrunk interception rate per dropback faced (heavy prior: 2 seasons of dropbacks, since persistence is weak), the margin (a trailing offense throws more), wind, precipitation |
| **Fumble recoveries** | boosted Poisson on expected plays | the opponent's shrunk fumbles lost per play, the defense's shrunk recoveries per play faced (heavy prior), precipitation, temperature |
| **Defensive touchdowns** | expected takeaways times the fit seasons' touchdowns per takeaway, by home and roof | the two takeaway expectations |
| **Return touchdowns, safeties, blocked kicks** | league rates per game from the fit seasons, each shrunk toward the league with a full season of prior for the club's own rate (special teams persistence is weak and the result will mostly be the league rate, stated) | the club's return and block history |

Every rate is shrunk by round 4's empirical Bayes closed form (§2.3: posterior = n / (n + k) x observed
+ k / (n + k) x prior, k from the method of moments, full pooling where tau^2 is at or below zero,
counted). `vegas_win_totals` is not an input: the closing figure carries team strength for the game.

### 5.3 Kicker: components and inputs

| Component (the kicker's week) | Model | Inputs read at t_g |
|---|---|---|
| **Field-goal attempts by distance band** (0-19, 20-29, 30-39, 40-49, 50-59, 60 plus) | boosted Poisson for the club's attempts, then a multinomial over the bands (boosted classifier, log loss) | the club's implied points and margin; the team model's expected plays and offensive touchdowns; the club's shrunk red-zone touchdown rate per trip and the opponent's allowed (from play-by-play drives); the club's shrunk fourth-down go rate in field-goal range (play-by-play, `down` 4 inside the 40); the coach's prior tendency where `coach_tenure` exists; roof, wind, temperature, precipitation, the Denver venue; the kicker's shrunk share of attempts from 50 plus (a coach's trust in his leg) |
| **Make probability per attempt** | a play-level boosted classifier on every field goal of the fit seasons (about 1,000 a season from 2016) | distance, wind, temperature, precipitation, roof, surface, the Denver venue, and the kicker's made over expected per attempt, shrunk in its beta-binomial form toward the position (round 4 §2.3's form), computed from the forward-chained play model |
| **Extra-point attempts** | the club's expected touchdowns (the team model's offensive touchdowns plus the league rate of non-offensive touchdowns) times one less the club's shrunk two-point attempt rate | as named |
| **Extra-point make probability** | the same play-level classifier fitted on extra points (distance 33) | weather terms and the kicker's shrunk extra-point make rate |

**Who kicks.** The club's kicker at t_g: the latest week-W filing that is not Out or Doubtful, else
the kicker who kicked the club's latest game (from the kicking weeks). A kicker with no attempts in
the fit history takes the position prior with a `no_kicker_history` indicator. A club whose kicker is
listed Out has no kicker number until another kicker carries a filing or a roster read (counted). The
published projection's and ESPN's named kickers are cross-checks counted in the results, never
inputs.

### 5.4 The joint distribution

Points allowed, takeaways and sacks are correlated within a game (a shutout comes with takeaways), and
a kicker's attempts and extra points share his club's scoring. So each club-game is drawn jointly,
2,000 draws (round 4's seeding rule: SHA-256 of "{run_seed}:{season}:{week}:{club}:kdef"):

- **Defense:** draw the opponent's points from 5.2's distribution; place the draw in one of three
  bands (below, inside and above the middle 50 per cent of that distribution); draw sacks,
  interceptions and fumble recoveries from their models with a per-band multiplier fitted on the fit
  rows (each band's mean observed over its mean expected); defensive and return touchdowns, safeties
  and blocks follow; yards allowed from its distribution, rank-coupled to the drawn points by the fit
  rows' Spearman between the two.
- **Kicker:** draw the club's points band the same way from the club's own points distribution; draw
  field-goal attempts and touchdowns with per-band multipliers; each attempt's band from the
  multinomial; each make from its probability; extra points from the drawn touchdowns.

The per-band multipliers carry the correlation; the point stays the analytic expectation over the same
three bands, so the two agree by construction up to sampling.

### 5.5 Fit windows, tuning, isolation

- **Fit seasons:** component models 2016 to 2022 for the development check, 2016 to 2023 for the
  judgment, forward-chained by season exactly as round 4 §2.6 (each row of season s reads models
  fitted on seasons before s). 2016 is the first season of the play table and the kickoff weather.
  The shrinkage priors read 2013 onward where a component's history starts there (kicking and
  defense weeks), as prior seasons only.
- **Tuning:** round 4's 16-cell grid and tie rule for each boosted model, forward-chained inside the
  fit seasons; the kernel bandwidth from its four values the same way. No week of a fit season
  informs an earlier week.
- **The input rule** is round 4's (§5, Amendments 1 to 3), with two additions written into
  Amendment 7: the kicking and defense weeks of earlier weeks, stamped in replay at the Wednesday
  18:00 ET pass after their week (as NGS and PFR are, item 8), live at their `kdef_lines` stamp; and
  the new play-by-play kick columns, stamped per game as the play table is.

### 5.6 Scoring under the league's rules

The run publishes, per club-week and position, the expected components and the 2,000 joint draws of
the components (defense: points allowed, yards allowed, sacks, interceptions, recoveries, defensive
and return touchdowns, safeties, blocks; kicker: made and missed by distance band, extra points made
and missed). The API scores each draw under the league's saved rules (the 21 kicker and defense keys
of Lane 70b, field-goal distances and the points-allowed and yards-allowed bands among them). The
league's Proj is the analytic expectation of the components under those rules, the bands applied to
the published points-allowed and yards-allowed distributions, never to their means; the floor, median
and ceiling are the 10th, 50th and 90th percentiles of the scored draws. One Go scorer
and the research scorer are held equal by a parity test on the published fixtures. The draws are
small (64 club-positions x 2,000 x at most 14 numbers a week).

**The judged scoring** (fixed in Amendment 7): the house table of `research/model/domain.py` (its
points-allowed and yards-allowed bands equal ESPN's league defaults), with field goals 0-39 3, 40-49
4, 50 plus 5, a missed field goal -1, an extra point 1, a missed extra point -1. Kickers' and
defenses' points do not depend on the reception value.

### 5.7 The why

Four factor groups: (1) the game's expected points (the opponent's for a defense, the club's for a
kicker), (2) the matchup (a defense: the opponent's sacks allowed and giveaway rates against the
defense's own; a kicker: his accuracy over expected and his club's red-zone and fourth-down habits),
(3) weather and roof, (4) home and rest. Neutral values as round 4 §2.7 (league mean implied points,
every rate at its prior, indoor weather, home averaged). Exact Shapley over the 16 coalitions of the
analytic point. The shelf shows the three largest groups and any other of at least 0.5 points, each
as a fact with its source and read time, in the site's words.

### 5.8 What it cannot know, said plainly

A late kicker change after the last filing; a coach's choice to go for it on fourth down on the day;
which drive ends in a pick-six; return touchdowns, which are close to random and are priced at the
league rate; and an injury to the opposing quarterback during the game. The range carries them.

## 6. How it is graded

### 6.1 The backtest, once

- **Development check:** 2023 weeks 3 to 17, once, fit 2016 to 2022.
- **Judgment:** 2024 weeks 3 to 17, once, fit 2016 to 2023. Weeks 3 to 17 rather than round 4's 6 to
  17 because these components lean on the game figure and on priors, not on three games of shares,
  and fifteen weeks give each position about 420 graded rows instead of about 340.
- **Population:** defenses: every club with a game that week. Kickers: each club's projected kicker
  (5.3) with a stat line that week (the projection is "if he plays"). Each source is scored on the same
  rows, and a source with no number for a row ranks it below every row it has, ties averaged (round
  4's fill rule).
- **Statistics:** S1 Spearman rho per week within position, pooled as the mean over weeks; the
  week-block bootstrap over the judged weeks, 10,000 resamples, `default_rng(42)`. S2 the starters'
  points: the mean realised points of the 12 rows a source ranks first in each week, pooled over weeks.
  S3 range shares (below the floor, above the ceiling, below the median; a realised value equal to the
  quantile counts half, since these points are discrete).
- **Scoring:** the judged scoring of 5.6.

### 6.2 Benchmarks

| Benchmark | Definition | Role |
|---|---|---|
| **Recent form** | his (its) points a game this season before W under the judged scoring, else last season's | gated (KD1, KD4) |
| **The streamer's sheet** | the expert's one-fact rule: defenses in order of the opponent's implied points, fewest first; kickers in order of the club's implied points, most first; ties by recent form. It reads the same figure at the same instant as the model, so it isolates what the model adds beyond the figure | gated (KD2, KD4) |
| **ESPN's archived weekly projection** | ESPN's projection for the week as its public pool keeps it for 2023 and 2024 (verified for 2024 week 8: 65 kickers, 32 D/ST), re-scored from its own projected components under the judged scoring where they map, else its own total; ingested once into a benchmark table, never an input. Its stamp is unknown and is taken as its last pre-game version, which can only favour ESPN | gated, point comparison (KD3, KD4) |
| The published projection's archive | only if it returns each 2024 week's figure stamped at or before t_g, else refused by name (round 4 §3.1) | reported only |

### 6.3 Gates, per position, all must pass, and a gate that cannot answer fails

| Gate | Threshold | Basis |
|---|---|---|
| **KD1, against recent form** | pooled model minus form **>= +0.05**, lower bound **> 0** | A week's kicker and defense points are mostly opponent and game, which form does not read; a model that reads the figure must clear it plainly. By the Fisher standard error at about 28 rows a week (about 0.18 for one order), two orders correlated near 0.5 differ week to week by about 0.18, a standard error of about 0.046 over 15 weeks: the lower bound reaches zero from about +0.09, so the bound, not the margin, is the operative requirement. These are arithmetic on the statistic, not measurements; the development check reports the measured per-week SDs and no threshold moves |
| **KD2, against the streamer's sheet** | pooled model minus sheet **>= +0.02**, lower bound **> 0** | The question that matters: does the system add to the one fact an expert streams by. Orders correlated near 0.8 differ by about 0.11 a week, about 0.029 over 15 weeks, so the bound needs about +0.06. It may not pass. If it does not, the published projection stays, which is the honest outcome |
| **KD3, against ESPN's archived projection** | pooled model minus ESPN **>= 0.000**, a point comparison | Not behind the most-used host's own weekly number. The "beats human predictors" claim is made only prospectively (6.4), never from KD3 |
| **KD4, starters' points** | the model's S2 at least the sheet's, ESPN's and form's (three point comparisons) | The member's measure: the twelve it says to start score at least as much as the twelve each benchmark says to start |
| **KD5, calibration** | below the floor and above the ceiling each within **[0.06, 0.14]**, below the median within **[0.44, 0.56]** | Round 4's G4 bands. At about 420 rows the binomial standard error of a 0.10 share is 0.0146, so +-0.04 is about 2.7 standard errors |
| **KD6, isolation** | the input rule and its per-game clause hold for every fit and judged game; the readers serve the fit seasons and the judged season only and refuse 2025 and 2026; `preseason_projections`, `preseason_board_reasons`, `published_boards`, `register_freeze_rows`, `register_grade_rows` and `model_artifacts` other than this sub-round's keys digest the same before and after | Round 4's G5, and the September G4's skill-rows rule |

Gate lines per position: KD1 2, KD2 2, KD3 1, KD4 3, KD5 3, KD6 1: **12**, 24 for both. Thresholds in one
constant (`KDEF_WEEKLY` in the sub-round's `gates.py`), with a test at each threshold.

**Multiple comparisons.** Each position is its own decision with two bootstrapped comparisons (KD1,
KD2); each lower bound is the **2.5th percentile** (one-sided 0.05 / 2). Every other line is a point
comparison or a tolerance, and the gates are conjunctive.

**Decision rule.** Per position: all 12 lines pass on the one judgment of 2024, the position's number
ships (§8); any line fails or cannot answer, nothing ships for that position and the interim stays
for 2026. **Stop rule after the development check:** a position failing KD1 pooled or KD2 pooled on
2023 ends for that position, its 2024 is not judged, and no threshold moves; the other position goes
on. Any other failing line is examined for a defect.

**Reported, not gated:** each component's validation loss against its simple counterpart (points
allowed against the implied points alone, attempts against the club's season rate, make probability
against distance alone), the ablations (without weather, without the team model's sacks, without the
kicker's accuracy, without the joint correlation), the full-pooling cells, the default counts, the
draw-mean breaches, the published and ESPN kicker cross-check counts, ESPN's view under its own
scoring, and a flat-3-points-a-field-goal scoring view.

### 6.4 Prospectively, the weekly record

From the first freeze the pinned served version makes, the in-season pass freezes our K and DEF rows
beside the skill order under their own source (`commish_week_kdef_v1`), with `espn_points` (ESPN's
read already holds them; the lane adds the D/ST id crosswalk, `-16000 - club` to `team-def:<club>`) and
`published_points` (the published projection's K and DEF rows), graded on the week's points in the
judged scoring. The weekly record gains K and D/ST lines (`RECORD_POSITIONS`), like with like, and
"leads" is said only under round 4 §3.3's two fixed looks (after weeks 13 and 17, at least 5 counted
weeks at the first). Shadow freezes from the first live run of any other version are kept internally
and excluded from every "leads" test. Before a pass, the record draws no K or D/ST line.

## 7. The judged season, and what it exposes

### 7.1 Why 2024

- **2026** is the pristine held-out year: no gate reads it.
- **2025** is closed for kickers and defenses: the September judgment read its season totals once and
  printed the top ten with their outcomes, and "never re-run the 2025 judgment" governs. It is also
  the season weekly round 1 failed on.
- **2024** holds no weekly kicker or defense judgment, and no weekly ordering of kickers or defenses in
  2024 has been computed by anything this author found. It is the only season left.

### 7.2 Its exposure, stated

- The September round fitted its season-long components on 2013 to 2024 and its two development
  iterations scored 2024 season totals (kicker band coverage 61.8 per cent; defense ordering
  -0.1195, last season's points -0.2109). Those are season-level summaries of a different model, not
  weekly orderings, and none of their priors is reused.
- Round 4's exposure list for 2024 (its §5, items 1 to 8) applies to the shared inputs, and the team
  model is refitted here on 2016 to 2023 with round 4's code.
- **The cross-effect on the skill positions' 2024.** This judgment reads 2024 clubs' points allowed,
  sacks and kicking, which are team outcomes the skill positions' points share. Round 5's draft plans
  its single judgment on 2024. To keep that erosion to one verdict, the judgment's output prints only
  the K and DEF gate lines and reported views of §6.3, never a team-model residual or any club-level
  2024 figure, and round 5's preregistration lists this judgment in its 2024 exposure. Whether this
  judgment may run before round 5's is the coordinator's ruling (§9, item 1).
- A 2024 pass is read as provisional for the same reason round 4 §5 gives, and the 2026 record's two
  fixed looks are the test that cannot be eroded.

### 7.3 Who runs what

The lanes build and test on scratch copies. The coordinator, never a subagent, runs the development
check and the judgment once each on a scratch copy on 5433 named `lane157_kdef`, restored from a dump
of dev's `research` schema after Lane 156's history lands, with an exclusive claim file and the lock
an ancestor of HEAD. Never dev for a judged run, never 5440, never production. Production receives
Lane 156's ingests once as backfills and one verification read, and the pinned artifacts through
`model_artifacts`.

## 8. Calendar, the first shippable week, and the switch rule

Today is Thursday 2026-10-22; week 7's first kickoff is 00:15Z tonight. First kickoffs ahead: week 8
Thursday 2026-10-29 20:15 ET (2026-10-30 00:15Z), week 9 Thursday 2026-11-05 20:15 ET, week 17
2026-12-31 20:15 ET. Each week's order is set on the Thursday 14:00 ET pass (Amendment 4).

| Dates (2026) | Step |
|---|---|
| Oct 23 to Oct 24 | Lane 155 (web): K and D/ST on the Week N rankings page, live for **week 7's Sunday games** |
| Oct 23 | Amendment 7 adjudicated and committed: the lock for this sub-round |
| Oct 23 to Oct 26 | Lane 156 (data): the kick columns, the stamped history, ESPN's 2023 and 2024 archive, the D/ST crosswalk, into dev and a scratch dump |
| Oct 23 to Oct 27 | Lane 157 (model) against fixtures, then on Lane 156's history; pre-run review |
| Oct 27 to Oct 28 | the coordinator: development check on 2023, stop rule; judgment on 2024 |
| Oct 28 to Nov 3 | Lane 158 (serve): the served refit pinned; the live step each pass; shadow freezes from its first run (week 8 if it runs by Oct 29); the API's league scoring of the draws |
| Oct 30 to Nov 4 | Lane 159 (web and record), mock first and the persona gate |
| **Thu Nov 5** | **our number live for week 9**, on a pass |

**The first week our number could ship: week 9** (set on the Thursday 2026-11-05 pass). **Week 8 is
possible** only if the judgment passes by Wednesday 2026-10-28 and Lanes 158 and 159 land the next
day, which means cutting their review. For the founder, plainly: "The interim puts kickers and
defenses on the Week rankings page for this Sunday. Our own number can be judged and live for week 9;
week 8 only by cutting the serving lanes' review. Say which."

**The switch rule.** The preregistered switch week (week 9) yields to being on the live board: our
number replaces the published projection for a position on the first in-season pass after its served
version is pinned, on any day of the week, never before that position's pass. Rows whose game has
kicked off keep the figure they had when it kicked off. A week counts on the record only if the
switch landed before that week's Thursday 14:00 ET freeze; otherwise that week's K and DEF rows are a
shadow and the count starts the next week. On a fail, the interim stands for the rest of 2026 for
that position, the record shows no line for it, and a 2027 round preregisters anew.

## 9. For the coordinator to adjudicate

1. **The order of the 2024 judgments.** This sub-round and round 5 (draft) both judge 2024. Recommend:
   this judgment may run first, printing only its own lines (7.2), and round 5's exposure list names
   it.
2. **Gates that may not pass.** KD2's bound needs a lead of about +0.06 over the streamer's sheet on
   15 weeks of about 28 rows. Recommend keeping it: the alternative is a number that cannot be told
   from the rule of thumb.
3. **ESPN as a gated benchmark** with an unknown stamp. Recommend gating it as a point comparison
   only (KD3), with the stamp caveat printed beside the verdict.
4. **The Waivers strip** for K and D/ST adds once our number ships (3.3): it reverses the founder's
   narrowing of 2026-10-16, so it goes to the founder; not in the lane plan unless ruled in.
5. **Floor-ceil on the K and D/ST rows only** while the skill positions carry the published Proj with
   no range: the page would show a range for two positions and not four. Recommend yes, with the
   basis saying the range is ours.

## 10. Lane plan

The smallest sequence. Lane numbers are suggestions for the coordinator. Every lane: worktree, private
ports, own pids, read-only reports to the main checkout, never `git add .superpowers`.

| Lane | Builds | Files | Gates |
|---|---|---|---|
| **155, web, now** | K and D/ST chips on the Week N rankings page, mounting the existing week box score (`/order/week` signed out, the league week read signed in); the purpose line names kickers and defenses; no rank column; shots | `web/src/lib/order/order.ts` (`ORDER_POSITIONS` or a page-level chip list), `OrderScreen.svelte`, `words.ts` (`PAGE_PURPOSE.players`), `routes/(run)/players/+page.svelte`, the inseason fixture and shot scripts | `npm run check`, `lint`, `test`, copy guard, player-page and shell script budgets, shots at 1440 and 390 in both themes, the persona panel |
| **156, research data** | the play table's kick columns for 2016 to 2026 (ingest and backfill); the kicking and defense weeks' stamped history reads (item 3a of the amendment); ESPN's archived 2023 and 2024 weekly K and D/ST projections with their components into a benchmark table; the D/ST ESPN id crosswalk; a K and D/ST fixture for `parse_pool` | `research/pipeline/nflverse/` (plays), `research/pipeline/espn/` (archive), `research/pipeline/crosswalk.py`, `research/db/schema/`, an alembic revision with new columns declared last, `research/tests/testdata/espn/` | research chain (pytest, lint, types), the parity schema gate, the parity ingest case for any mapping; the coordinator migrates dev and production and backfills production once |
| **157, research model** | `research/model/weekly_kdef/`: features at t_g on round 4's instant and ledger (new read kinds and the refusal test), the component models, the kernel and tilt, the joint draws, the scorer, the why, the three benchmarks, `KDEF_WEEKLY` and its tests, the development-check and judgment runners with the exclusive claim | `research/model/weekly_kdef/*`, reusing `research/model/weekly4/{team_model,tuning,shrinkage,matrix}.py` unchanged | research chain; a test at every threshold; the guard tests; a pre-run review |
| *coordinator* | development check on 2023, stop rule, any defect amendment, judgment on 2024, results file | `docs/research/2026-10-23-weekly-kdef-results.md` and `.json` | run once each, on `lane157_kdef` (5433) |
| **158, research and API, serve** | the served refit pinned; an in-season step that runs the live number each pass and publishes components and draws; the shadow and counted freezes under `commish_week_kdef_v1` with the two yardsticks; the API reads them, scores the draws under the league's rules, and `WeekOrder`, Lineup and the board's tab take our Proj per position once pinned | `research/inseason/season_week.py`, `research/model/register/freeze.py`, `research/JOBS.md`, `api/internal/inseason/{week_order,score,facts}.go`, `api/openapi.yaml` (new fields optional) | research chain, api `gofmt`, `go vet`, `go build`, `make check-gen`, race tests, the Go and Python scorer parity test, the deploy-window check (the previous web parses the new answer), a passing nightly before the web change |
| **159, web and record** | the basis words for our number, `#` under "Our week order", `Floor-ceil`, the shelf's reasons; the weekly record's K and D/ST lines | `web/src/lib/order/week.ts`, `WeekTable.svelte`, the shelf, `research/nightly/reads/weekly_record.py` (`RECORD_POSITIONS`), the record page | mock first, persona panel, web and research chains, shots |

155 ships now and is independent of the rest. 156 and 157 run in parallel (157 against fixtures until
156 merges). 158 builds its live step regardless of the verdict, so shadows start as early as possible,
and switches a position only after that position's pin. 159 follows 158.

## 11. Amendment 7

Moved into `docs/research/2026-10-16-weekly-projection-round4-preregistration.md` §7 on 2026-10-22 with the coordinator's rulings on §9 as its item 11.
