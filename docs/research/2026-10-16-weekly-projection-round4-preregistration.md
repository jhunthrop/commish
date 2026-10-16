# The Weekly Projection, Round 4: Preregistration (the game model)

**Written:** 2026-10-16, before any code, fit or judgment of this round, and before any outcome was
read by anything in it. Its author read the three rounds' documents and records, the code in
`research/model/weekly3/`, `weekly2/` and `ros/`, `research/pipeline/nflverse/schedule.py`,
`docs/research/data-sources.md`, `research/JOBS.md`, the Tank01 audit (`2026-08-30-tank01-audit.md`),
the fit-round close-out (`2026-09-02-fit-round-closeout.md`) and the standing rulings. Its only
database reads were of the dev copy (port 5432, in a read-only transaction): row counts, season
coverage, metric lists, and stamp offsets against kickoffs (minimum and maximum hours only). It read
no outcome value of any season, no 2024 row beyond a count, and no 2026 row beyond counts and the 2026
kickoff calendar, which is schedule knowledge. One read of the National Weather Service API
documentation (`weather.gov/documentation/services-web-api`) for the forecast's shape. No fit ran.
**Revised** the same day after the pre-lock review
(`.superpowers/sdd/2026-10-12-prep-site/reviews/lane-65-prereg-review.md`, 9 HIGH, 17 MEDIUM, 9 LOW)
and the coordinator's rulings on it (H1, H2, H3, H4, H5, H6, H7, H8, H9). Every threshold is as first
written. The one definition the revision changes under a threshold is the expert-like baseline's
denominator (H7), so G6 is restated against the corrected baseline at the same numbers.
**Brief:** `.superpowers/sdd/2026-10-12-prep-site/lane-65-brief.md` (Lane 65), carrying the
founder's instructions of 2026-10-16: project "based on the team they're playing and their
projected output similar to a way a fantasy football expert would", "add weather as a dimension",
and "it should be hyper-intelligent and beat human predictors by being the most advanced analysis
available in fantasy football. Don't just give it an MVP type of approach. This is the core of the
product."
**Rounds before it:** round 1 (`2026-10-13-weekly-projection-preregistration.md`, lock `3beb44d1`,
failed on 2025), round 2 (`2026-10-15-weekly-projection-round2-preregistration.md`, lock `86ca79d6`,
stopped at its development check), round 3 (`2026-10-15-weekly-projection-round3-preregistration.md`,
lock `e58ae444`, stopped at its development check).
**The lock:** the coordinator's commit of this document. No fit of this round runs before it.
**Results:** `docs/research/2026-10-16-weekly-projection-round4-results.md` and `.json` beside it,
reporting every number named here whether it passes or not.

## Rulings this document is bound by

- **2026 outcomes are the pristine held-out year** (founder, 2026-09-02). No fit, tuning, gate or
  model choice of this round reads a 2026 outcome. The register grades 2026 for the record page
  only, and no grade feeds a fit or a threshold before the 2027 preseason round.
- **2024 is spent for selection purposes** (fit-round close-out, "Ruling: 2024 read discipline":
  "After it, 2024 is spent for selection purposes: future configurations wait for the 2026 judge").
  How this round stands to that ruling is in section 5.
- **A failed judgment is final** and is never rerun on the same season. 2025 is closed. 2024 holds
  no weekly judgment (rounds 2 and 3 stopped before theirs).
- **Thresholds never move after a check.** Every number in section 3 is set here.
- **A defect** is code that does not do what this document says. After the development check only
  defects may change, each recorded here as an amendment and committed before the judgment. No model
  choice, input, default, population, statistic, threshold, seed or judged week changes.
- **No weekly number reaches a screen until a weekly round passes** (founder, 2026-10-13). The week
  facts (the game's expected score and the weather) are facts, not the projection, and may ship
  before.
- **No file-sourced data at runtime** (2026-09-08). Every new dataset arrives through an ingest into
  a table, and every fitted number lives in `model_artifacts`, versioned and pinned.
- **nflverse is the recurring charted-stats source** (2026-09-05). No Pro Football Reference pull of
  any kind. `pfr_advstats` is read only as nflverse's own release.
- **Fantasy words, not trading words** (2026-09-07). Game lines and player props are model inputs or
  benchmarks, never a word on the site: no "line", "odds", "spread", "Vegas", "market", "bet" or
  "props" in copy.

---

## 1. The diagnosis

**What happened, in the rounds' own numbers.** Pooled model minus recent form, Spearman rho within
position, weeks 6 to 17: round 1 on 2025 +0.0008, round 2 on 2023 +0.0033 (lower bound -0.0237),
round 3 on 2023 +0.0106 (lower bound -0.0140). Against ADP every round led easily (round 3 +0.0802,
lower bound +0.0611). "Recent form" in all three rounds is the player's mean PPR points a game this
season before week W.

**What recent form already encodes.** By week 6 a player's season-to-date mean carries his role (how
many targets and carries his club gives him) and his realised efficiency over five or more games.
Every round's model was a function of those same box scores. Round 2's rate m puts weight G / (k + G)
on the season so far, 0.63 to 0.77 by position after five games (round 3 preregistration, section 1),
and the rate alone measured +0.0045 against form. Round 3 spent 166 stage-1 coefficients on usage
counts, and its new inputs moved the number by little: removing the opponent allowances took 0.0034
away, removing vacated volume 0.0005 (round 3 development check, ablations). A linear line on a
player's own box scores reproduces his box scores.

**What a week's points are made of, and which parts are knowable before kickoff.**

| Part of the week's variance | Knowable before kickoff | What the rounds used |
|---|---|---|
| Team volume: how many plays the club runs and how many it passes | Mostly: the game's expected total, the expected margin, both clubs' pace and pass rate over expectation | Pace and pass rate as controls that cancelled out (round 3, item 5) |
| Game script: the realised margin, which turns a lead into carries and a deficit into passes | Its expectation is the closing spread. The realised margin is not knowable | Nothing |
| Target and carry concentration: who gets the club's looks | Largely: season and recent shares, who is out, who returns, the depth chart | Usage means and vacated volume |
| Touchdowns: the largest single lump of points, decided by a few red-zone snaps | The expectation is knowable (the club's expected points, the player's red-zone and goal-line share). Which snaps score is not | A red-zone count with one slope per position (QB 0.750, RB 0.530, WR 0.621, TE 0.839 PPR points per opportunity, round 3) |
| Efficiency: yards per target and per carry | Partly: target depth, field position, the opponent's allowance, weather, the player's shrunk efficiency | The rate's own efficiency, and yards-per-play ratings in round 2 |
| In-game events: injuries, benchings, ejections, a blowout's garbage time | No | Nothing, and nothing should |

**The one input the rounds excluded by construction.** Round 3's input rule admitted rows stamped at
or before t_g, one millisecond before kickoff. The store stamps the game's implied team total and
point spread (`nflverse_kickoff`, `implied_team_total`, `point_spread`) exactly at the kickoff, and
the recorded temperature and wind 21.67 to 34.50 hours after it (stamp offsets counted on the dev
copy for 2016 to 2024, section 5). All three rounds were therefore blind to the expected score of the
game, its expected margin and its weather, which are the facts an expert reads first. That is the
main reason the rounds could not separate from form: they held no information form lacks except the
filings and a few per cent of opponent effect.

**What 12 weeks can show.** The pooled model-minus-form difference had a per-week standard deviation
of 0.0470 in round 3 (this document's arithmetic on the 48 `per_week_rho` rows of
`2026-10-15-weekly-projection-round3-dev-check.json`, reproduced by the pre-lock review) and 0.0506
in round 2 (round 3 preregistration). Over 12 weeks that is a standard error of 0.0136 to 0.0146, and
round 3's bootstrap half-width was 0.0246 (+0.0106 less -0.0140). A model must lead form by about
+0.03 rho for a one-sided bound to clear zero. The rounds were never close, because the information
they would have needed was not in their inputs.

**What cannot be known, said plainly.** The realised script, which snaps score, in-game injuries and
the coaching decisions of the day. A system that prices their expectation and their spread is the
ceiling, and the range and the start-and-sit chance are where that honesty lives.

---

## 2. The system, end to end

### 2.1 The shape, as an expert would recognise it

An expert projects a team first and a player second: how many points this club is expected to score
and how, how many plays it will run and pass, who gets the looks, what each look is worth for this
player against this defence in this weather, and how far the result can swing. The system is that
sequence, each step fitted and each step's output a fact the screen can show:

1. **The game** (2.5): the club's expected points and margin from the closing figure, and the weather
   at kickoff.
2. **The team** (2.4, 2.5): expected plays, dropbacks, designed rushes, team targets and offensive
   touchdowns, given the game, both clubs' pace and pass rate over expectation, and the opponent's
   pass rate allowed.
3. **The player's share** (2.2): his expected share of targets, carries, air yards, red-zone and
   goal-line opportunities, given his role, who is out, who returns and the depth chart.
4. **The value of each opportunity** (2.3): expected fantasy points per target and per carry from the
   opportunity's depth and field position, then the player's efficiency over expected, shrunk toward a
   role prior by sample size, then the opponent's allowance over expected.
5. **The reconciliation** (2.6, the identities): the club's rushing and receiving touchdowns, summed
   over every player of the club including a residual "rest of the club", equal the team model's
   offensive touchdowns, and the quarterback's passing touchdowns follow from the receiving ones.
6. **The distribution** (2.6): a simulation of the game that draws the margin, the volume, the
   allocation and the outcome of each opportunity, so teammates and opponents share one game script.
   Floor, median, ceiling and the start-and-sit chance come from its draws.
7. **The why** (2.7): exact Shapley attributions over seven named factor groups, each rendered as a
   sourced fact with its read time.

The point projection is the analytic mean of steps 1 to 5, deterministic. The simulation supplies the
range and the chance, not the point.

### 2.2 Opportunity

**Expected shares of the club's volume, per position:** target share of team targets, carry share of
designed rushes, air-yards share, red-zone opportunity share (red-zone targets plus carries),
inside-the-ten share, and for quarterbacks the dropback share (near 1 for a healthy starter, and the
term that carries benchings and injuries) and the designed-rush share. A share times the team model's
volume (2.5) is the expected count. Factoring the count into team volume and share is what lets the
game move a player's volume, and it is the form the why speaks in. The shares of a club's projected
players and its residual share sum to 1 for every kind (2.6, the identities).

**Inputs to the share models:** his season-to-date share of each kind, his last-three-games share,
an exponentially weighted share (decay chosen in 2.6), his prior-season share with a no-prior
indicator, snap share season to date and over the last three games, his weekly depth chart rank (2.9,
a new history ingest, stamped under section 5 item 6), **vacated shares**, **returning shares**, the
rate m (`commish_ros_v3`'s points a game) as his season-level anchor, and the matchup and game terms
of 2.4 and 2.5, which may move shares (a back's carry share when his club is favoured, a receiver's
air-yards share in wind).

**The designation filter, restated** (round 2's `weekly2/designation.py`, unchanged): a player whose
latest week-W filing stamped at or before t_g lists him Out or Doubtful gets no number. Questionable
keeps the number and a flag. No filing is clear for his own number. In replay the filing is the
nflverse `injury_report_status` ordinal (0 none or Probable, 1 Questionable, 2 Doubtful, 3 Out). Live
it is Tank01's designation word through `status_of_tank01`, a listing that cannot play this week (Out,
injured reserve, PUP, NFI, suspended, exempt) withheld as Out is.

**Vacated shares** (round 3's rule, on shares): over club teammates whose latest week-W filing at t_g
lists them Out or Doubtful and who played in one of the club's last three games, the sum of their
last-three-games shares of each kind.

**Returning shares, and the evidence a return needs.** A teammate counts as returning for week W only
when all of these hold:

- he missed at least one of the club's last three games and at most all three (the cap: a return
  reaches back over the club's last three games, no further),
- he played at least one game this season before the absence, which gives his pre-absence share, the
  mean of his shares over his last three games played before the absence,
- and there is evidence he plays in week W: **a week-W filing stamped at or before t_g that is not
  Out or Doubtful** (Questionable, or listed with no game status), **or a row on the week-W depth
  chart** admitted under section 5 item 6. When the depth chart check of section 5 fails and the
  replay reads week W-1's chart, only the filing counts as evidence.

**No filing never means returned.** A teammate with no week-W filing and no week-W depth-chart row is
not returning, which keeps players on injured reserve, suspended, released or traded out of the term.
`nflverse_roster_weeks` is not used for this: it carries no stamp, and its INA status is a game-day
status. The results report the count of returning teammates per season and the club-games they touch.

**Routes run and route participation are not used.** No automated permitted feed publishes routes run
(data-sources doc, "Not tracked"). The proxy, a receiver's on-field share of team dropbacks from
nflverse's `pbp_participation`, exists for 2016 to 2025 only and has no 2026 file, so a fit on it
would be a different model from the one that runs live. It is dropped and named.

**The charted feeds, what the fit uses and what the live week adds.** The dev copy holds 0 rows of
`nflverse_ftn_charting`, `nflverse_ngs` and `nflverse_pfr_advstats` in any season (counted
2026-10-16 over every source of `player_week_observations`). Per the brief, production holds the 2026
season only, written by the in-season pass since Lane 23. Upstream, Next Gen Stats weekly starts in
2016, PFR advanced stats in 2018, FTN charting in 2022 (data-sources doc).

| Feed | In the fit (2021 to 2023) and the 2024 judgment | Live in 2026 |
|---|---|---|
| Next Gen Stats weekly (rush yards over expected per carry, average separation, completion over expected, time to throw) | **Yes**, after the history ingest of 2016 to 2025 (2.9). Weekly NGS lists only players above its attempt thresholds, so each feature carries a missing indicator | Yes, the in-season `next-gen-stats` step |
| PFR advanced stats via nflverse (broken tackles per touch, a quarterback's times pressured per dropback, the pressures a defence generates) | **Yes**, after the history ingest of 2018 to 2025 | Yes, the `pfr-advstats` step |
| FTN charting (play action, motion, drops) | **No.** It has no 2021 season, a fit season | **Facts in the why only**, never an input |
| Play-by-play (air yards, target depth and location, field position) | Yes, the new play-level table (2.9) for 2016 to 2023 | Yes, the `play-by-play` step extended to write the play table |

### 2.3 Efficiency with shrinkage, in expected points

**Expected fantasy points per opportunity (xFP).** A play-level model predicts, for each target, the
catch probability, the expected receiving yards and the touchdown probability, from air yards, field
position (`yardline_100`), down, distance, pass location (left, middle, right), roof state, wind,
temperature and the precipitation flag. For each carry, the expected rushing yards and touchdown
probability from field position, down, distance, run location and gap, and the same weather and roof
terms. For each quarterback dropback, the completion, yards, touchdown and interception
probabilities. It is fitted forward-chained by season (2.6): the xFP of any play of season s comes
from the play model fitted on seasons before s. A target's xFP in format f is its catch probability
times the format's reception value (1 in PPR, 0.5 in half, 0 in standard), plus expected yards over
ten, plus six times its touchdown probability. A player's expected xFP per target this week is the
decayed mean xFP of the targets he has drawn this season, re-priced with the week's weather in place
of the weather of those plays, so a deep receiver in wind is priced as deep in wind.

**Efficiency over expected, shrunk.** For each player and kind, his fantasy points over expected per
opportunity (FPOE: actual points minus xFP, per opportunity) over this season's weeks before W and the
prior season, decayed, shrunk toward a **role prior**:

- the role prior is the position mean plus a linear term in the charted signals (NGS and PFR above,
  each with its missing indicator), fitted on the fit seasons with FPOE computed from the
  forward-chained xFP (2.6),
- the shrinkage is empirical Bayes: posterior = (n / (n + k)) x observed + (k / (n + k)) x prior.
  **n is the decayed effective count**, the sum over his opportunities of decay^(age in his games).
  k = (noise variance per opportunity) / tau^2, where tau^2, the variance of true FPOE across players,
  is estimated by the method of moments per position and kind on the fit seasons as var(observed) less
  mean(noise variance / n). **When tau^2 comes out at or below zero, k is infinite and the posterior is
  the prior** (full pooling), and the results report each cell that pooled fully,
- catch rate over expected is shrunk in its beta-binomial form and touchdown rate over expected in its
  gamma-Poisson form, **their hyperparameters from the same moment fit** (the prior's mean and tau^2
  converted to the beta and gamma parameters), with the same floor.

These closed forms are the Bayesian part of the design. They need numpy only.

### 2.4 The matchup

For defence D, position p and kind k, every allowance is the ratio of what D allowed to the position
group in its games of weeks before W over what the same offences gained in their other games, shrunk
toward 1 with 6 games of prior (round 3's construction in `weekly3/allowance.py`, with the context
ingest's constant `_RATING_SHRINKAGE_GAMES`), now computed for:

- **volume:** targets, carries and red-zone opportunities to the position (round 3's), and **target
  share by role**: to running backs through the air against on the ground, and to receivers by target
  depth (behind the line, under 10 air yards, 10 to 19, 20 and over) and by location (outside against
  the middle), from the play table,
- **value:** FPOE allowed per opportunity to the position, by kind, so a defence is priced on what it
  gives up beyond each opportunity's expected value, not on yards per play,
- **the defence's pass rate allowed:** its opponents' pass rate over expectation in their games
  against D over their pass rate over expectation elsewhere, shrunk the same way
  (`pass_rate_over_expected` is stored per club-week in `nflverse_pbp`),
- **pressure:** D's sack rate and quarterback-hit rate per dropback from the play table, and the
  pressures D generates from PFR via nflverse where the history ingest holds it.

**Slot against outside alignment is not available.** No permitted feed charts a receiver's alignment
(FTN does not, nflverse participation does not). Role is expressed through target depth and location
instead, and the why never claims an alignment.

**The player's own club:** its pass rate over expectation season to date, with the same shrinkage,
and its pace (`pace_seconds_per_play`), both inputs to the team model rather than controls that cancel.

### 2.5 Game context and weather

**The team model.** One row per club-game, regular-season weeks 1 to 17, fitted forward-chained by
season (2.6) on 2016 to 2023. It predicts the club's offensive plays, dropbacks, sacks, scrambles,
designed rushes, team targets, and rushing and receiving touchdowns. Its inputs: the club's implied
points and the opponent's, the spread, both clubs' pace and pass rate over expectation season to date
(shrunk), the defence's pass rate allowed and pressure, home field, `rest_days`, division game, roof
state and the weather terms. A separate fitted line gives the realised script's effect, how a realised
margin above or below the spread moves the realised pass rate, which the simulation uses (2.6).
Monotone constraints hold where the football is not in doubt: expected touchdowns and plays never fall
as the implied points rise.

**The closing figure.** The store already holds `implied_team_total` and `point_spread` for every
club-week with a game from 2016 to 2025 (512 club-weeks a season to 2020, 544 / 542 / 544 / 544 for
2021 to 2024, equal to the kickoff rows), stamped at the kickoff. The basis for calling them closing:
`research/pipeline/nflverse/schedule.py` ingests nflverse's `games.csv` `spread_line` and `total_line`
as "the closing line at the real kickoff instant", and stores the club's implied points as
total_line / 2 + point_spread / 2, with the club's spread positive when it is favoured. The input
rule admits them at t_g by name (section 5). **Live**, the club's figures come from the Tank01 capture
(`tank01_betting_odds`, 274 snapshots from 2026-09-10 to 2026-10-12 on the dev copy), parsed into a
new stamped team-week source, `tank01_lines`: the median across the books in the snapshot of the
spread and the total, converted to the store's sign (Tank01's `homeTeamSpread` "-3.5" is the home
club favoured by 3.5), implied points by the same formula. The live number reads the latest capture
at or before t_g. **The capture's gap is closed in lane 66a:** on the dev copy the odds capture runs
Thursday, Sunday and Monday ET, plus Wednesday and Saturday 20:00 to 23:00, with none on Friday or
Saturday daytime (the review's count, 4 to 18 snapshots a day), so a Friday or Saturday game would
read a figure about 40 hours old. Lane 66a runs it hourly from 07:00 ET to the last kickoff on every
day with a kickoff. The staleness default is in 2.10.

**Weather at kickoff.** Four terms: temperature, wind, precipitation and roof state.

| Term | Fit and replay (recorded at kickoff) | Live week (forecast) |
|---|---|---|
| Roof state | nflverse's game table `roof` (dome, closed, open, outdoors), a new four-valued metric beside the stored binary `indoors`. For a retractable venue, open or closed is **a recorded game-day fact**, admitted by name (section 5) | Fixed venues: the stadium table. Retractable venues: the forecast rule below. The why says "roof expected closed" or "roof expected open" |
| Temperature and wind | `nflverse_kickoff` `temperature_f` and `wind_mph`. **The store lacks them for many outdoor games:** 4 / 10 / 10 / 14 / 0 of the outdoor club-games of 2016 / 2017 / 2018 / 2019 / 2020, and 22 of 386 in 2021, **182 of 374 in 2022**, 82 of 382 in 2023, 10 of 356 in 2024 (counted on the dev copy, outdoor meaning `indoors` 0). Filled, in order, from the play-by-play `weather` text of the same game (the gamebook's temperature and wind), then from NOAA's Integrated Surface Database hourly observation at the station nearest the stadium for the kickoff hour. Each value records its source | NWS hourly forecast at the stadium's coordinates for the kickoff hour |
| Precipitation | **Absent from the store and from nflverse's game table.** History: a 0 or 1 flag from the play-by-play `weather` text, then the ISD hourly precipitation for the kickoff hour (any measured precipitation is 1) | NWS precipitation probability for the kickoff hour, used as a mixture (below) |
| Indoors | Every weather term at its indoor value (wind 0, precipitation 0, temperature a fixed 70 F, a stated constant whose only role is to sit apart from outdoor values), with roof state carrying the difference | The same |

**Parsing the precipitation word.** The flag is 1 when the gamebook text contains one of rain,
showers, drizzle, snow, sleet, flurries or "wintry mix" as a present condition, and 0 otherwise. A
word preceded by "chance of", "no", "slight chance" or "possible", or appearing only after "forecast",
is not a present condition. Lane 66b's parser carries these as one tested list, and the results report
the flag's count by season and its agreement with ISD where both exist.

**Precipitation in the trees, live.** A boosted tree has no linear term to take a probability. Live,
the point function is evaluated at flag 0 and at flag 1 and the two are mixed by the NWS probability
q: point = q x f(1) + (1 - q) x f(0). In the simulation each draw takes flag 1 with probability q, so
the range is the same mixture. In replay the flag is the recorded 0 or 1.

**A retractable roof, live.** The roof is taken as closed when the kickoff forecast's temperature is
below, or its wind or precipitation probability above, the thresholds a one-split tree fitted on the
fit seasons' retractable club-games finds best separating recorded open from closed. Replay reads the
recorded state, which is a stated flattery (section 5), and the results report the replay with the
live rule applied to the recorded weather as a sensitivity view, and the count of retractable
club-games per season.

**The NWS forecast.** From the documentation read for this document: `GET
https://api.weather.gov/points/{lat},{lon}` returns, among its properties, a `forecastHourly` URL
("forecast for hourly periods over the next seven days") and a `forecastGridData` URL (the raw
forecast data over the same horizon). A `User-Agent` identifying the application is required. The
rate limit is not published, and an over-limit request may be retried after a few seconds. The grid
office and cell for a location can change, so the job re-reads `/points` each season and caches the
grid between. The raw grid's field names (wind gust and precipitation amount above all) are not listed
on the documentation page, so the ingest's strict parser confirms them on the first live response and
refuses an unknown shape (the house's schema-drift rule). The forecast job runs once per kickoff slot
from the Tuesday of the week, writes a stamped `nws_forecast` team-week source (temperature, wind,
gust, precipitation probability and amount at the kickoff hour, the forecast's issue time), and the
number reads the latest at or before t_g. It is free and needs no key.

**International games** have no NWS forecast and no weather term: their weather inputs take the
indoor values with a `no_forecast` indicator, and the why says nothing about weather. The stadium
table marks each venue's country.

**The stadium table.** The store holds no stadium table and no coordinates. nflverse's game table
carries `stadium_id` and `stadium` for every game. A new `stadiums` table (id, name, latitude,
longitude, roof type, surface, country, time zone) is loaded by an idempotent ingest that validates a
reviewed input built from Wikidata's coordinates (public domain, CC0) keyed to nflverse's
`stadium_id`. The reviewed file is the ingest's input only and is never read at runtime.

**Era drift, named.** The 2024 season's kickoff rule moved where drives start. The play model
conditions on field position, so its per-play values carry the change. The team model's plays and
touchdowns may shift by season. It carries no season-trend term, and the results report its mean
residual by season for 2016 to 2024 as the measure of the risk.

### 2.6 The model class, the fit and the simulation

**The candidates, weighed.**

| Candidate | For | Against | Ruling |
|---|---|---|---|
| Two-stage linear lines on usage (rounds 1 to 3) | Transparent, closed form, few rows needed | Measured three times at form (+0.0008, +0.0033, +0.0106). Cannot represent the interactions that carry the new information (a favoured club's back, wind against a deep receiver, a vacated target share that goes to the receiver rather than the tight end) | **Kept as a benchmark** (round 3's number, G7) |
| A Bayesian hierarchical model for everything (PyMC or Stan) | Principled shrinkage, a full posterior | A heavy dependency and compiler, sampling to seed and check for convergence at every weekly run, slow inside a per-kickoff-slot job. The shrinkage it would buy has closed forms here | **Taken where it is closed form:** the empirical Bayes shrinkage of 2.3 |
| Gradient-boosted trees per component | Learns the interactions and non-linear effects of the game terms, handles missing charted values, monotone constraints, Poisson, squared and log losses, fast to fit and to score | Needs time-aware tuning, can overfit a few thousand rows, attributions must be computed | **Chosen** for the play model (2.3), the team model (2.5) and the share models (2.2) |

**The dependency to add: scikit-learn**, for `HistGradientBoostingRegressor` and
`HistGradientBoostingClassifier` (Poisson, squared-error and log losses, native missing values,
monotone constraints, deterministic with a fixed `random_state` of 0 and early stopping off). It is
the standard Python library for this, its wheels bundle their own OpenMP so the Cloud Run job and the
laptop install the same way, and it adds no compiler. The version is pinned in `uv.lock` on the day
the lane adds it and is part of every row's `model_version`. LightGBM was weighed and refused: it
supports offsets, which sklearn's boosting does not, but its macOS wheels depend on a separately
installed OpenMP library, and the share factorisation of 2.2 removes the need for offsets. SHAP was
refused: the attributions of 2.7 are exact over seven groups without it.

**Fit windows, settled.** The play model and the team model: **2016 to 2023** (2016 to 2022 for the
development check). They do not touch the preseason board or the rate, every season is strictly
before the judgment, and the 2019 gap in `nflverse_player_week` does not reach them. Player-level
models (shares, the role prior, the shrinkage constants, the simulation's dispersions): **2021 to
2023, weeks 4 to 17**, players with a line that week (the projection is "if he plays"), 2020 as the
prior season, as the brief fixes. The development check: 2021 and 2022. Weeks 4 and 5 add fit rows
without adding a judged week, since features need three games. The lock commit's message repeats
these windows.

**Forward-chained fitting by season (the coordinator's ruling on H2).** Any component's output that is
an input or a target for a row of season s comes from that component fitted on seasons before s only,
so every row, fit or judged, sees out-of-sample component outputs of the same kind:

| Rows of season | Play and team models used | Share models used (where their output is an input, the simulation's dispersions) |
|---|---|---|
| 2021 (fit) | fitted on 2016 to 2020 | none: 2021 rows do not enter the dispersion fit |
| 2022 (fit) | 2016 to 2021 | fitted on 2021 |
| 2023 (fit) | 2016 to 2022 | fitted on 2021 and 2022 |
| 2024 (judged) | 2016 to 2023 | fitted on 2021 to 2023 |
| Development check, 2021 and 2022 fit rows | 2016 to 2020, 2016 to 2021 | 2022 rows from shares fitted on 2021 |
| Development check, 2023 checked rows | 2016 to 2022 | 2021 and 2022 |

So the simulation's dispersions, its yardage-variance scale and the script effect are fitted on the
2022 and 2023 rows (on 2022 alone for the development check), the share models on 2021 to 2023 with
xFP, FPOE and team volumes from the forward-chained play and team models, and the role prior and k on
the same forward-chained FPOE. **Each refit runs its own forward-chained grid choice inside its own
seasons** (below), so no hyperparameter is chosen with a season later than the rows it serves.

**Tuning, time-aware, and its order.** The components are tuned in this order: the play model, then
the team model, then the share models, each with its predecessors' forward-chained outputs fixed.
Each boosted model has one fixed grid of 16 cells (`max_leaf_nodes` 7 or 15, `l2_regularization` 0 or
1, `max_iter` 200 or 400, `min_samples_leaf` 50 or 200, learning rate 0.05). The share models choose
the exponential decay in {0.5, 0.7, 0.85, 1.0} **jointly** with their grid, 64 cells, and the same
decay serves the xFP mean and FPOE of 2.3. A refit fitted on seasons S1 to Sk chooses its cell by
forward-chaining inside S1 to Sk: train on the seasons before s and validate on s, for each s after
the first, the loss summed over the folds. A refit on a single season (the 2021 share fit) has no fold
and takes the cell its next refit chooses, which is the one exception, stated. The loss is the
model's own (Poisson deviance for counts, squared error weighted by team volume for shares, log loss
for probabilities). **A tie** is a summed validation loss within 0.1 per cent of the best (relative),
and among tied cells **the smaller** wins: fewer `max_leaf_nodes`, then fewer `max_iter`, then larger
`min_samples_leaf`, then larger `l2_regularization`, then the larger decay (1.0 being no decay).
**No week of a fit season informs an earlier week:** every feature of a row is read at that row's own
t_g under the input rule (section 5), and no validation season is in its own training data.

**The identities that make shares and touchdowns add up.** For each club-game and each kind k
(targets, carries, air yards, red-zone and inside-the-ten opportunities):

- the shares of the club's projected players plus a **residual share** r_k sum to 1. r_k is the club's
  share of kind k that went, over its games of weeks before W this season, to players outside the
  projected set (backups, fullbacks, a third tight end, players outside the universe), shrunk toward
  the fit seasons' mean residual share with 6 games of prior. A projected player's share is his
  model share times (1 - r_k) over the sum of the projected players' model shares. In replay and live
  alike, a withheld player's share passes to his teammates and the residual by the same
  normalisation,
- the club's **rushing touchdowns** summed over its players and the residual equal the team model's
  rushing touchdowns, and its **receiving touchdowns** summed the same way equal the team model's
  receiving touchdowns,
- the quarterback's **passing touchdowns** equal the club's receiving touchdowns times his dropback
  share, so a passing touchdown is counted once as the receiver's and once as the passer's, as fantasy
  scoring counts it, and never added to the team total twice,
- **the quantity scaled** is each player's expected touchdowns after his touchdown rate over expected
  (2.3), that is xTD times his shrunk touchdown factor. The scale is one number per club, kind and
  game, applied to the players and the residual alike. Yards and receptions are not scaled.

**The distribution: a simulation of the game.** For each game, 10,000 draws:

- **the seed:** numpy `default_rng(seed)`, where seed is the first 8 bytes, read as a big-endian
  unsigned 64-bit integer, of the SHA-256 digest of the UTF-8 text "{run_seed}:{season}:{week}:{home
  club}". run_seed is an integer recorded in the run's record: 2023 for the development check, 2024
  for the judgment, and a live run's `job_runs` id. Python's `hash()` is never used, since it is salted
  per process,
- **the margin:** Normal around the closing spread, with the standard deviation of (margin less closing
  spread) over the fit rows,
- **the volume chain, per club:** plays from a negative binomial around the team model's mean with a
  fitted dispersion, or, **when the fitted variance is at or below the mean (the Poisson boundary), a
  Normal with the fitted residual standard deviation, rounded and floored at 0**. Dropbacks are
  Binomial(plays, the team model's pass rate plus the fitted script effect of the drawn margin).
  Sacks are Binomial(dropbacks, the team model's sack rate), scrambles Binomial(dropbacks less sacks,
  the starter's shrunk scramble rate), pass attempts the remainder, team targets
  Binomial(pass attempts, the club's season-to-date share of attempts with a targeted receiver), and
  designed rushes plays less dropbacks,
- **the allocation:** Dirichlet-multinomial among the club's projected players and the residual,
  around the normalised shares above, with one fitted concentration per position and kind,
- **each opportunity's outcome:** from the play model's probabilities and the player's shrunk
  efficiency, with touchdowns at the reconciled rates, and one yardage-variance scale per position
  chosen from the grid 0.50 to 2.00 in steps of 0.05 to minimise, over the three formats, the sum of
  (share below the floor less 0.10)^2 plus (share above the ceiling less 0.10)^2 on the fit rows,
- **points** in each format.

Teammates and the two clubs share each draw's margin and volume. **Floor, median and ceiling** are the
10th, 50th and 90th percentiles of a player's draws. **The simulation's mean against the point:** for
every player-game the simulated mean must lie within 0.25 PPR points or 3 per cent of the analytic
point, whichever is larger, and the point must lie between the floor and the ceiling. A breach is a
defect, reported with its count. **The start-and-sit chance** for players A and B is the share of draws
in which A outscores B, ties half, with the draws paired: players in the same game share draw i,
players in different games are independent. That is the correlation round 2's chance assumed away. The
sentence stays conditional on both playing and says so.

**Questionable.** A Questionable player keeps his number "if he plays". The chance he plays, the fit
seasons' share of Questionable filings at t_g followed by a line, by position, is reported and its
calibration reported. It is not folded into the number.

### 2.7 The why, from the model's own attributions

**Seven factor groups:** (1) his role and its trend, (2) teammates out or returning, (3) the matchup,
(4) the game's expected score and margin, (5) weather and roof, (6) home field and rest, (7) his
efficiency against expected.

**Neutral values.** The league's mean implied points over the season's weeks before W and a margin of
0, every allowance 1, no vacated or returning share, indoor weather, his last three equal to his
season, efficiency at the role prior. **Home field has no neutral value inside a tree**, so its group's
neutral setting is the mean of the point function at home 0 and at home 1.

**Who a coalition neutralises.** Groups 3 to 6 enter the team model, so their neutral setting applies
to the whole club and the opponent's game, and the touchdown reconciliation is recomputed under it.
Groups 1, 2 and 7 apply to the player alone, with his teammates' shares renormalised by the identities.
The exact Shapley value of each group is computed over its 2^7 = 128 coalitions of the deterministic
point function, and the values sum to the projection less the neutral projection.

**On the screen**, the lines are the three groups with the largest absolute contribution and any
other of at least 0.5 PPR points (half a reception), each a fact with its source and read time, in the
expert's form and the site's words:

- "At Buffalo, who allow the 4th most points to running backs over what their opponents usually get"
  (the allowance's rank among 32, read time shown).
- "His team is expected to score 25 and to win by 3" (the latest captured figure, read time shown).
  Never "line", "spread", "total", "odds" or "favoured by", which is the spread's own idiom. The copy
  review checks every why template against the banned-vocabulary guard.
- "Wind 14 mph at kickoff, outdoors" (the NWS forecast, issue time shown).
- "Gets 2.1 more targets with Jones out" (the vacated share times team targets, the filing's time).
- "Catching passes 6 points over expected per 100 targets this season, pulled toward the average"
  (the shrunk efficiency, sample size shown).

A fact whose source is older than the latest pass says so. The member can disagree with a reason,
because each line is a claim about the world, not about the model.

### 2.8 What a human expert does that this cannot, honestly

- **Beat-reporter news minutes before kickoff.** A role change reported Sunday morning ("he will
  handle early downs") reaches this system only through what it changes in the captures: the Tank01
  news feed (478 snapshots since 2026-09-05), the depth chart capture (374), the inactives (103,
  posted about 90 minutes before kickoff), and the game figures, which move on such news. The news
  text itself is not parsed into a share in this round. The why shows the latest headline beside the
  player as a fact, so the member sees what the number may not yet carry.
- **Coaching intent.** A coordinator's stated plan to feature a player, a snap count for a player back
  from injury, a game plan against a specific defence. The system sees intent only after it shows up
  in shares, about one game late.
- **Film.** An expert who watches can see a receiver beating coverage before the targets come. NGS
  separation is the nearest measured signal the fit holds.
- **How the captures narrow it:** each kickoff slot's pass rereads filings, inactives, depth charts,
  game figures and forecasts, so a Sunday-late number reflects Sunday-morning inactives, which a
  Thursday ranking by a person cannot.

### 2.9 Data the store lacks, and where each comes from

| Gap (counted on the dev copy, 2026-10-16) | Source | Into |
|---|---|---|
| Play-level play-by-play (field position, air yards per target, pass location, down, distance, run gap, sack, quarterback hit, the `weather` text, roof). The store holds team-week and player-week aggregates only | nflverse `pbp/play_by_play_<season>`, the file the store's aggregates already come from (CC-BY 4.0) | new `nflverse_pbp_plays`, trimmed columns, 2016 to 2026, **stamped per game exactly as the existing play-by-play aggregates are** (section 5 item 7) |
| Weekly depth charts. The store holds week 1 only (`nflverse_depth_charts`, 465 to 557 rows a season from 2016 to 2025, from the preseason ingest, which keeps week 1) | nflverse `depth_charts` (weekly rows to 2024, dated snapshots from 2025). The weekly release carries no publication time that this author found, and lane 66b confirms that against nflverse's data dictionary and records what it finds here as a note | `nflverse_depth_charts`, a weekly metric |
| Next Gen Stats and PFR advanced stats history: 0 rows in any season | nflverse releases (2016 on and 2018 on), the Lane 23 steps run over history | the existing sources |
| Roof state in four values, and surface. The store holds a binary `indoors` | nflverse game table `roof`, `surface` | `nflverse_kickoff` metric `roof_state` (a recorded game-day fact, stamped with the recorded weather), `nflverse_schedule` metric `surface` |
| Recorded temperature and wind for the outdoor club-games counted in 2.5 (2016 to 2024) | the play-by-play `weather` text, then NOAA ISD hourly (NCEI, US public domain) | `nflverse_kickoff` metrics, with a `weather_source` metric |
| Precipitation, any season | the same two for history, NWS live | a `precipitation` metric in `nflverse_kickoff`, and `nws_forecast` live |
| Stadium coordinates, roof type, country | Wikidata (CC0) through a reviewed, validated ingest | new `stadiums` |
| Live game figures as stamped rows. The 274 Tank01 snapshots sit unparsed in `capture_snapshots` | a parse of `tank01_betting_odds` | new team-week source `tank01_lines` |
| The live forecast | NWS (`api.weather.gov`) | new team-week source `nws_forecast` |
| Tank01's weekly projection: 1 snapshot (2026-09-09, week 1) | the existing `tank01_projections` capture, fixed to run once per kickoff slot | `capture_snapshots`, benchmark only |
| A touchdown market. The props archive holds pass yards, receiving yards, receptions and rush yards (events of 2023 to 2026, 65,268 rows), no touchdown market, and dev's newest prop row is from 2026-09-05. `player_prop_observations` has `point` and `under_price` NOT NULL, which a Yes-only anytime-touchdown offer cannot fill | The Odds API's anytime-touchdown market (its key confirmed against the provider's market list) and the passing-touchdowns market already in `PROP_MARKETS`, and a check that the in-season `props-snapshot` step writes | **a new market-specific table** `player_td_prop_observations` (event id, commence time, bookmaker, player name, yes price, no price nullable, fetched at), so the existing table and its constraints do not change. Benchmark only |
| Practice participation live. Tank01's injuries-by-date carries a designation only | none live | **Not an input.** The filter uses the designation, as round 3 did |

### 2.10 Missing inputs: each case has a stated default, and the results count every one

Every default below is a rule of the model, set before the lock. **For a boosted tree, "missing" means
numpy NaN passed to the tree's native missing-value handling, plus the named indicator column set to
1.** An explicit value is used only where the table says so. The results report the count of rows
under each default for the fit seasons, the development check and the judgment, as round 3's did.

| Case | Default |
|---|---|
| Replay: no closing figure for a club-game | The implied points and spread as NaN with `no_game_figure` 1. The touchdown reconciliation then uses the team model's own touchdowns, which already saw NaN. Precondition counts expect none for 2016 to 2024 |
| Live: no Tank01 capture at or before t_g, or the newest older than 6 hours at t_g | The figure from nflverse's `games.csv` as read by the latest weekly pass (its current spread and total), stamped at that read. With neither, NaN with `no_game_figure` 1. 6 hours is five missed hourly captures. The register counts live club-games past the staleness age |
| No week-W depth-chart row for him (replay, after section 5 item 6) | His rank as NaN with `no_depth_row` 1. Not evidence of a return |
| A rookie, or anyone with no prior-season share | Prior-season share NaN with the no-prior indicator 1 (round 3's indicator) |
| No targets or no carries yet this season | n = 0 for that kind: the efficiency posterior is the role prior, and his xFP per opportunity is the position's mean xFP per opportunity of that kind over the fit rows |
| No game this season before W (back from reserve, signed mid-season, a rookie yet to play) | Round 3's rule: his number is the rate m in each format, with the range of his position's bottom quintile cell from the simulation run on m. With no club, no number |
| A returning teammate with no pre-absence share this season | Not returning (2.2) |
| A withheld teammate who played none of the club's last three games | Contributes 0 to vacated shares (round 3) |
| His first game after a trade | Round 3's rule: his club is his latest club edge, the old club, until his first line for the new one. His shares are the old club's, and the residual share of the new club is unchanged. Counted |
| No stadium row for the game's `stadium_id` | Refused before any fit (a precondition). Live: weather NaN with `no_forecast` 1 |
| No `roof_state` for a club-game | Replay: the binary `indoors` (1 is closed, 0 is outdoors). Live: the stadium table's roof type, a retractable roof by the forecast rule |
| Replay: no recorded temperature or wind after the fill | NaN with `no_weather` 1 (outdoors only) |
| Replay: no precipitation flag after the fill | NaN with `no_weather` 1 |
| Live: NWS fails for the slot, or a non-US venue | The latest earlier `nws_forecast` row for the game if one exists, else NaN with `no_forecast` 1 |
| NGS or PFR feature absent for the player-week | NaN with the feature's missing indicator 1 |
| A club-week with no pace or pass rate over expectation | Round 3's rule: the mean over the club's games that carry a value, else NaN with `no_pace` 1 |
| An opponent with no game against the group in weeks before W | Allowance 1, the shrinkage's prior (round 3) |
| No filing for week W | Clear for his own number (round 3). Not evidence of a return |

---

## 3. Benchmarks and gates

### 3.1 The backtest

**Judgment: 2024, weeks 6 to 17, once,** each game at its t_g, against each player's published week-W
line through round 3's outcome reader, extended. **Fit: 2021 to 2023** for the player-level models,
**2016 to 2023** for the play and team models, forward-chained (2.6). **Development check: 2023 weeks
6 to 17**, player-level fit 2021 and 2022, play and team models 2016 to 2022, identical code, once,
before the judgment.

**Population and statistics:** round 3's, unchanged. Players with a week-W line in the union of ADP's
top K and the season-to-date top K, K = QB 36, RB 72, WR 108, TE 36. S1 Spearman rho per week and
position with at least 8 players, pooled as the mean over weeks of the four-position mean. S2 places
off for starters (QB 12, RB 24, WR 24, TE 12). S3 range shares. S4 chance bins. **Uncertainty:** the
week-block bootstrap over the 12 judged weeks, 10,000 resamples, `default_rng(42)`.

**The rows each comparison uses.** Every source is scored on the same population rows. A source with
no number for a row (off ADP, withheld by the filter, no form, round 3's no-number defaults, this
model's no-number cases, a baseline with no form) ranks that row below every row it has, ties averaged,
which is round 2's and round 3's fill rule, applied identically to every source including round 3's
number for G7. The results report each source's missing count per position and week.

**Benchmarks:**

| Benchmark | Definition | Role |
|---|---|---|
| ADP | 2024 `ffc_adp_ppr_12` within position (189 rows in 2024) | G1 |
| Recent form, the rounds' | Mean PPR points a game this season before W, else last season's | G2 |
| Recent form, last three | Mean PPR points over his last three games played before W (the brief's wording) | G2's point guard |
| Round 3's number | `commish_weekly_v3`'s x, recomputed on 2024 by its committed code at `dc39efce`, its stage 1 fit on 2021 to 2023. Round 3 was never judged on 2024, so this computes a benchmark and judges nothing (section 5 lists what it exposes) | G7 |
| **The expert-like baseline, an expert's three-fact spreadsheet** | No fitted number: form x A x (T / T-own). Form is the rounds' recent form. A is the opponent's PPR points allowed to the position per game in its games of weeks before W, over **the league mean of PPR points allowed to the position per team-game over the same weeks**, shrunk toward 1 with 6 games of prior (the store's constant). T is the club's implied points at t_g. **T-own is the club's own mean implied points over its games of weeks before W in the same season**, so form, which already carries the club's offensive strength, is moved only by how this game differs from the club's usual one. A club with no earlier game this season (not possible from week 6, stated for completeness) takes the league mean | G6 |
| Props-implied yardage and receptions points | For the players the 2024 archive covers: receptions plus yards over ten, from the median across books in the newest fetch at or before t_g (the review counted every 2024 row fetched before its commence time). No touchdown market exists in the archive | **Reported only**, on its covered players |
| Tank01's archived 2024 weekly projection | Only if the archive (the audit names `archiveSeason`) returns each week's figure with a stamp at or before t_g. Otherwise refused by name | **Reported only** |

**What the baseline is and is not.** It is the floor of an expert's method: season form, the matchup's
points allowed and the game's expected score. It has no teammates out, no returns, no depth chart, no
news and no weather, all of which a human expert uses. G6 tests that the system beats that method. The
claim "beats human predictors" is made only from the prospective comparison of 3.3, never from G6.
The results report the baseline's own lead over form beside G6.

### 3.2 The gates (all must pass, and a gate that cannot answer fails)

| Gate | Threshold | Basis |
|---|---|---|
| **G1, against ADP** | Pooled model minus ADP rho **>= +0.04**, lower bound **> 0**, each position **>= -0.02** | The margin and floor are kept from rounds 2 and 3. Round 3 measured +0.0802 (lower bound +0.0611). The lower bound moves from the 2.5th to the 1.667th percentile (three bootstrapped comparisons, below), which is stricter, not looser. Not the gate that decides |
| **G2, against recent form** | Pooled model minus form **>= +0.030**, lower bound **> 0**, each position **>= -0.02** | The margin is raised from +0.02 and defended below. The position floor stays: each position's per-week SD against form was QB 0.134, RB 0.049, WR 0.040, TE 0.086 in round 3 (this document's arithmetic on its `per_week_rho`, reproduced by the review), so over 12 weeks a quarterback's mean carries a standard error near 0.039, and a floor of 0 would fail a model with a real +0.03 lead there about one time in five (the review computes 0.22) |
| **G2, the last-three guard** | Pooled model minus last-three form **>= +0.030**, a point comparison | The brief names last-three form. The rounds' records show the season mean is the stronger benchmark (it led ADP by about +0.07, round 3 preregistration), so the bootstrap goes on that one and last-three form gets a point guard at the same margin |
| **G6, against the expert's three-fact spreadsheet** | Pooled model minus baseline **>= +0.015**, lower bound **> 0**, each position **>= -0.02** | Unchanged in its numbers, restated against the corrected baseline (H7). The baseline reads the same closing figure as the model (section 5), so this gate isolates what the system adds beyond the three facts, the weather excepted (section 5). +0.015 is half G2's margin, since the baseline already holds the matchup and the game. The lower bound is the operative requirement: at round 3's per-week SD it needs about +0.03, and less if the two predictors' weekly differences vary less |
| **G7, against round 3's number** | Pooled model minus round 3 **>= +0.015**, a point comparison | G2's margin less round 3's lead over form on its check (0.030 less 0.0106), rounded down to 0.015: the lead over form must come from this system, not from form being weak in 2024 |
| **G3, places off** | Pooled places off at least **0.25** fewer than ADP's, **0.75** fewer than form's and **0.25** fewer than the baseline's (point comparisons) | Round 3's check placed starters 0.505 fewer than form. A system built to be better must beat that by round 2's margin of 0.25 |
| **G4, calibration** | Each of 12 cells (4 positions by 3 formats) with n >= 100: below the floor and above the ceiling each within **[0.06, 0.14]**, below the median within **[0.44, 0.56]**. Chance bins with at least 200 pairs: observed minus mean chance within **+-0.04**, at least three bins gated | See the two bases below |
| **G5, isolation** | Section 5's input rule, its allow-list and its per-game clause hold for every fit and judged game, and a week-W read of any `nflverse_kickoff` metric outside the allow-list (`game_result`, `points_allowed`) is refused. The outcome readers: the play and team fits serve 2016 to 2023, the player fits 2021 to 2023, the judgment 2024 only, all refuse 2025 and 2026. `preseason_projections`, `preseason_board_reasons`, `register_freeze_rows`, `register_grade_rows` and `model_artifacts` digest the same before and after | Round 3's gate, its clause extended to the new reads (section 5) |

**G4's basis, for the cells.** Tightened from [0.05, 0.15]. In the smallest cell (QB, n = 427 in round
3's check) the binomial standard error of a 0.10 share is 0.0145, so +-0.04 is about 2.8 standard
errors. Rows of one game share its script, in the simulation and in reality, so a cell's effective n is
below its row count and 2.8 is an upper figure. The band is kept at [0.06, 0.14] knowing that, because
round 3's worst cell share was 0.136, inside it. The median line is new because a simulation, unlike a
residual band, can be biased at its centre.

**G4's basis, for the chance bins, from the bins' own arithmetic.** Tightened from +-0.05 to +-0.04.
Round 3's five bins held 23,134 / 20,695 / 17,394 / 12,563 / 4,060 pairs (its development-check JSON,
counted by the review), and its worst bin was 0.0192 off. At 4,060 pairs and a chance near 0.93 the
binomial standard error is 0.004, and at 12,563 pairs and 0.75 it is 0.004, so +-0.04 is many
standard errors wide at the counts a 12-week judgment produces. Pairs are not independent (each player
sits in many pairs), so the effective n lies nearer the player-weeks in a bin than the pairs, which is
why the band is far wider than the pair arithmetic alone would allow. The 200-pair minimum is kept as
the floor below which a bin does not answer. At exactly 200 pairs and 0.55 the standard error is 0.035,
so a bin that small can fail by noise, which makes the rule stricter, not looser. The minimum is not
raised, since the threshold is kept as first written.

**Gate lines:** G1 5, G2 5, the last-three guard 1, G6 5, G7 1, G3 3, G4 13 (12 cells, each with its
floor, ceiling and median shares, and the chance line), G5 1: **34**. Thresholds in one constant
(`ROUND_FOUR` in the round's `gates.py`), with a test at each threshold.

**Why G2's margin is +0.030.** It is the smallest point lead at which the bound can be expected to
clear zero: at the measured per-week SD of 0.0470 to 0.0506 over 12 weeks the standard error is
0.0136 to 0.0146, and at this round's one-sided level (z(1 - 0.05 / 3) = 2.128) the bound reaches zero
from +0.029 to +0.031. It is nearly three times round 3's lead (+0.0106). And it is a lead a member can
feel: round 3's +0.0106 came with 0.505 fewer places off among starters, so a lead three times larger
is of the order of a place and a half per starter's ranking each week. A smaller margin would admit a
model whose lead the week-to-week noise cannot tell from zero, which is what three rounds produced.

**Multiple comparisons.** Three comparisons are tested with the bootstrap: pooled G1, G2 and G6. Each
lower bound is the **1.667th percentile** (one-sided 0.05 / 3). Every other line is a tolerance or a
point guard, and the gates are conjunctive.

**Reported, not gated:** every source's rho per position and format, the props-implied and Tank01
benchmarks where they answer, the baseline's lead over form, each component's validation loss against
its simple counterpart (the team model against the implied points alone, the share models against
season-to-date shares, xFP against the position's mean per opportunity), the ablations (without the
game terms, without weather, without the charted features, without the touchdown reconciliation,
without returning shares, and round 3's input rule with the closing figure hidden), the weather
sensitivity view (section 5), the retractable-roof live-rule view, the Questionable play chance and
its calibration, the weather fill counts by source, the precipitation flag's agreement with ISD, every
default count of 2.10, the depth-chart check of section 5, the returning-teammate counts, the cells
whose shrinkage pooled fully, the simulation-mean breaches, the team model's residual by season, the
Thursday view, and the view "the game figures as of 90 minutes before kickoff" if the historical pull
of section 5 fits the existing plan's credits.

**The decision rule.** If every one of the 34 lines passes on the one judgment of 2024 weeks 6 to 17,
the weekly number ships, and if any line fails or cannot answer, nothing ships.

**The stop rule after the development check.** If the check on 2023 fails G2 pooled or G6 pooled, the
round ends, the judgment is not run, 2024 stays unjudged and no threshold moves. A failure of any
other line is examined for a defect and does not by itself stop the round.

**On a pass:** section 4. **On a fail:** no weekly number and no chance sentence. The screens keep the
rest-of-season order and the week facts, the results report every number, and neither this system nor
a retune of it is judged on 2024 again.

### 3.3 Prospectively, in the 2026 register

From the first week the code runs (week 8 at the earliest, section 6), the register freezes each
game's numbers before its own kickoff, pass or fail, as a shadow record, and grades them after the
week. The record page shows the comparison only on a pass.

**Which numbers count.** Only numbers frozen by the **pinned served version** of section 4 count
toward "leads". Weeks frozen by any other version (the judged artifacts before the refit, or code
before a defect amendment) are shown on the internal record, excluded from every "leads" test, and
counted on the page.

**The prospective benchmarks:**

- **Tank01's weekly projection**, captured once per kickoff slot, the newest before t_g. What it
  aggregates: Tank01's listing and our audit describe a weekly and season fantasy projection with
  custom scoring, and neither names its method or says whose projections it combines. It is treated as
  one provider's published projection, and the record calls it "a published projection" until lane
  66a reads Tank01's own description of its method and records it here as a note.
- **The props-implied points**, the game's sportsbook number for the player, a benchmark, never an
  input. Per book, each American price becomes an implied probability (100 / (price + 100) for a
  positive price, -price / (-price + 100) for a negative one). **The margin is removed** for an
  anytime-touchdown offer with both sides as p = yes / (yes + no). For a Yes-only offer, p is the raw
  Yes probability divided by that book's median overround (yes + no) over its two-sided anytime offers
  in the same week, else by the median overround across all books' two-sided anytime offers that week,
  and with no two-sided offer that week anywhere, the player's touchdown term is absent and that
  week's benchmark is marked partial. The player's p is the median over books. Expected touchdowns are
  -ln(1 - p), the Poisson count whose chance of at least one is p. **The points, per position:**
  running backs, receivers and tight ends: receptions (the median receptions point, PPR only) plus
  receiving and rushing yards over ten plus six times expected touchdowns. Quarterbacks: passing yards
  over 25 plus four times the median passing-touchdowns point plus rushing yards over ten. A yardage
  or reception market a player lacks takes 0, and the results count it. On the site it is named
  without any trading or betting word ("a second published number" is the working label, settled by
  the copy review).
- **Free consensus ranks** where a source can be captured lawfully. The house already reads
  FantasyPros' season consensus from its public page (`fetch_expert_consensus`). Whether its weekly
  consensus may be captured automatically is a terms question, which is legal exposure and goes to the
  founder. Until the founder rules, no weekly consensus is captured and the comparison carries the
  other two.

**The prospective rule for "the model leads".** The record page may say the model leads a benchmark
only when, over every graded week of the pinned version so far, the pooled weekly rho lead over that
benchmark (the same population rule as 3.1, both sources scored by the fill rule) is positive and its
week-block bootstrap lower bound is above zero, at two fixed looks only, after week 13 and after week
17, each at one-sided 0.025 / 2 (the 1.25th percentile), with at least 5 graded weeks at the first
look. **Each benchmark's "leads" is a separate claim** at that level. The page never aggregates them
into "leads every published projection" unless each claim holds on its own, which is a conjunction and
needs no further correction. Between looks the page shows the weekly numbers as they are, without the
word "leads". A benchmark missing a week (a capture failure) leaves that week out of that benchmark's
comparison, and the page counts it. A bootstrap over 5 weeks is coarse (5^5 = 3,125 distinct
resamples) and at the 1.25th percentile asks in effect that nearly every week be positive. That is
conservative, and it is kept.

---

## 4. What ships on a pass

- **The served fit (the coordinator's ruling on H8).** After a pass, and before the first counted
  freeze, the judged procedure is refitted once: the player-level models on **2021 to 2024**, the play
  and team models on **2016 to 2024**, forward-chained by season as in 2.6 (the 2024 rows' component
  outputs from the play and team models fitted on 2016 to 2023), with **the same fixed procedure and
  the same hyperparameters, decay and grid cells the judged fit chose, and no selection of any kind**.
  It reads 2024 outcomes, which the 2026 quarantine allows, and no 2025 or 2026 outcome. It is
  published as a pinned `model_artifacts` version, and every served and counted register row carries
  that version. The judged artifacts themselves are kept beside it, unchanged, as the record of what
  passed.
- **The week's points with floor and ceiling** in each format, per game, on the start rows, the
  waivers rows, the trades rows and in the trade builder (`PlayerLine`, in-season spec section 9). The
  order key of spec section 4.2 becomes `week_points` after the hard facts.
- **The start-and-sit chance sentence** from the paired simulation: "White scores more than Bigsby in
  about 62 of 100 games like this, if both play". A Questionable player carries his flag and the
  sentence says "if he plays".
- **The why lines** beside each number (2.7), each a fact with its source and read time.
- **The record page's weekly comparison** against Tank01's projection and the props-implied number,
  under the rule of 3.3, with each week's rho and places off.
- **The week facts, as facts:** the game's expected score and margin, the stadium's forecast and roof,
  in the week view and on each player's row. **These may ship before the pass** (the coordinator's
  call), since they are observations with sources, not the projection.
- **The not-yet-final mark** on a number computed before his club's final injury report (round 3,
  section 3). Every run before t_g is the same function at its own moment.
- `model_version` and `implementation = 'python'` on every row. On a fail only the facts ship.

---

## 5. Isolation and honesty

**The per-game instant and the input rule, round 3's, amended.** For game g the instant is t_g, one
millisecond before its kickoff. Every input row is from a week before W and stamped at or before t_g,
except these, each admitted by an explicit list of (source, metric) pairs, never by source alone and
never by a stamp window:

1. **filings:** (`nflverse_injuries`, `injury_report_status`), the latest for week W stamped at or
   before t_g (round 3),
2. **the game's figures:** (`nflverse_kickoff`, `implied_team_total`) and (`nflverse_kickoff`,
   `point_spread`) for week W, stamped at the kickoff, admitted at t_g as the figure at the instant,
   since the closing figure is the figure at kickoff. Live: (`tank01_lines`, its spread, total and
   implied points) at or before t_g,
3. **the recorded game-day weather and roof:** (`nflverse_kickoff`, `temperature_f`), (`nflverse_kickoff`,
   `wind_mph`), and the new (`nflverse_kickoff`, `precipitation`), (`nflverse_kickoff`,
   `weather_source`) and (`nflverse_kickoff`, `roof_state`) for week W, admitted at t_g as the stand-in
   for the forecast and for the roof decision. These rows are stamped after the game, at 21.67 to
   34.50 hours for 2016 to 2020 (2016 21.67 to 34.50, 2017 21.67 to 31.00, 2018 21.67 to 31.00, 2019
   21.67 to 34.50, 2020 21.83 to 31.00) and 22.67 to 34.50 hours for 2021 to 2024 (counted on the dev
   copy for `temperature_f`). **`game_result` and `points_allowed` share that source and that stamp
   window** (21.67 to 34.50 h for 2016 to 2020, 22.50 to 34.50 h for 2021 to 2024), which is why the
   admission is by metric and the window is no part of the rule. Live: (`nws_forecast`, its metrics)
   at or before t_g,
4. **schedule knowledge:** (`nflverse_kickoff`, `kickoff_instant`), (`nflverse_schedule`,
   `home_field`), (`nflverse_schedule`, `rest_days`), (`nflverse_schedule`, `division_game`),
   (`nflverse_schedule`, `indoors`), (`nflverse_schedule`, `surface`), the pairing's four columns and
   the `stadiums` row, as in round 3. A retractable roof's state is not schedule knowledge (item 3),
5. **no other (`nflverse_kickoff`, metric) pair of week W is ever admitted.** Lane 68's read kinds
   select only the pairs above, a guard test asserts the selected metric list, and a second test feeds
   a week-W `game_result` row through each new read kind and expects `InputRuleError`. G5 checks it,
6. **the week-W depth chart,** (`nflverse_depth_charts`, the weekly metric), stamped in replay at the
   Wednesday 18:00 ET pass of week W (the second in-season pass in `JOBS.md`), **subject to the check
   below**. Live: nflverse's dated snapshot, the latest at or before t_g, is the primary source, the
   fit's own family. The Tank01 depth capture is the fallback only if a crosswalk test on 2026 weeks 1
   to 6 (depth charts, not outcomes) finds Tank01's rank-1 player equal to nflverse's at each of QB,
   RB, WR and TE for at least 90 per cent of club-weeks. Below 90 per cent the fallback is the previous
   nflverse snapshot. Each live read records which source it used. 90 per cent means at most about
   three of 32 clubs disagreeing on a starter in a week, which the shares can absorb,
7. **play-level rows and the existing play-by-play aggregates of earlier weeks:** stamped per game,
   exactly as the existing `nflverse_pbp` and `nflverse_pbp_player` rows are,
8. **NGS and PFR rows of earlier weeks:** stamped in replay at the Wednesday 18:00 ET pass after their
   week, the live cadence, since the history files carry no publication time.

The recording wrapper (`weekly3/ledger.py`) gains read kinds for the game figures, the game-day
weather and roof, and the depth chart, and G5's per-game clause checks each read against these rules.

**The depth chart stamp check, preregistered (the coordinator's ruling on H4).** nflverse's weekly
charts to 2024 carry no publication time, so the Wednesday stamp needs evidence that the week-W chart
was compiled before week W's games. The check, on 2021 to 2023 weeks 6 to 17, reads only depth charts
and filings, never an outcome value:

- the **injured group:** players at depth 1 on the week W-1 chart who have no week-W filing and a week
  W+1 filing of Out (players hurt in, or after, week W's game),
- the **comparison group:** players at depth 1 on the week W-1 chart with no filing in week W or W+1,
- each group's **retention:** the share still at depth 1 on the week-W chart.

A chart compiled before week W's game cannot know who was hurt in it, so the injured group's retention
should match the comparison group's. **The check passes if the injured group's retention is no more
than 0.05 below the comparison group's.** Basis: round 3 counted 253 to 267 Out or Doubtful filings a
season for weeks 6 to 17 alone, so the injured group holds several hundred players over three seasons,
and at a retention near 0.9 the binomial standard error is about 0.011 at 750 players, so 0.05 is
about 4.5 standard errors, while a chart compiled after the game would demote most of the injured
group and fail by far more. **If the check fails, the replay reads week W-1's chart, stamped at week
W-1's Wednesday 18:00 ET pass,** for the fit and the judgment alike, and live keeps reading the latest
snapshot before t_g. The check's numbers and its verdict are recorded in the results before any fit.

**The flatteries, stated.**

- **The closing figure.** It knows what the world knew at kickoff, including inactives announced about
  90 minutes before. Live, the number reads the latest Tank01 capture, at most about an hour old once
  lane 66a runs the capture hourly on every kickoff day, and never older than the 6-hour staleness
  default. Live and replay differ by the last hour's movement. The flattery favours the model against
  form and ADP (G1, G2), which do not use the figure. It does **not** favour the model against the
  baseline (G6), which reads the same figure. If The Odds API's historical game odds fit inside the
  existing 100,000-credit monthly plan (lane 66a quotes the cost first, and spend beyond the plan
  escalates), the results report the view at 90 minutes before kickoff.
- **The recorded weather as the forecast.** A forecast issued a day or more ahead misses the kickoff
  hour's wind, temperature and precipitation. This author read no published NWS verification
  statistic (the brief allowed one documentation read, spent on the forecast's shape), so **no
  measured typical error is claimed here**. Instead: (a) the register stores each frozen forecast
  beside the recorded kickoff weather from week 7 of 2026 on, and the results of the 2027 round report
  its mean absolute error in wind and temperature and the precipitation flag's miss rate, which is the
  typical error with its source, our own 2026 games, and (b) the judgment reports a **weather
  sensitivity view**: the number recomputed with the recorded wind perturbed by Normal noise of SD 4
  mph (floored at 0), the temperature by Normal noise of SD 3 F, and the precipitation flag flipped
  with probability 0.10, seed 2024, on outdoor games only. These SDs are stated assumptions of the
  order the review suggested, not measurements, and no gate reads the view. **The weather flattery
  favours the model against every benchmark, G6 included,** since no benchmark reads weather. The
  weather ablation and the sensitivity view together bound what it can be worth.
- **A retractable roof's recorded state.** Replay reads the recorded open or closed state, live reads
  the forecast rule, and the recorded state correlates with the weather. The results report the count
  of retractable club-games per season and the replay with the live rule applied.
- **The charted features' and depth charts' stamps** are reconstructed at the live cadence, not
  observed, since the history files carry no publication time. The depth chart check above tests the
  one whose leak would matter most.

**2024 and the read-discipline ruling (the coordinator's ruling on H9).** The fit-round close-out
ruled: "After it, 2024 is spent for selection purposes: future configurations wait for the 2026
judge." **This judgment is not a selection.** Its thresholds are fixed here before any fit, it runs
once, no variant is chosen on 2024 (every alternative is a reported ablation, never a candidate), and
the weekly target has never read 2024 for selection: rounds 2 and 3 stopped at their development
checks on 2023, and round 1's development check on 2024 was a check, not a choice. It is nonetheless
one more confirmatory read of a season several reads have already eroded. **The direction of that
erosion:** every earlier confirmatory read was made by people who then designed later rounds, and a
design made with knowledge of a season tends to suit it, so a 2024 pass is more likely than a first
look would be. A 2024 pass is therefore read as provisional, and the caveat line printed beside the
verdict carries the ruling's sentence. **The test that cannot be eroded is the 2026 register's two
fixed looks** (3.3), on games no one had seen when this document was locked.

**2024's exposure, in full** (round 3's section 4 items, carried by number with item 6 first as round 3
printed its weight, then this round's additions):

- **Item 6 (round 3):** three model artifacts fitted on 2023 and 2024 stand behind m's 2024 inputs
  (`preseason/priors` v1's rookie games rate, `market/props-anchor-weight` v1, `preseason/game-variance-skill`
  v1), so a 2024 outcome sits inside a 2024 input of m. Its direction is to flatter m on 2024, which
  favours the model against form in G2. m is an input here too.
- **Item 1:** no weekly model has been judged on 2024.
- **Item 2:** the rest-of-season judgment (round 3 of that record) gated rest-of-season rho and
  starters' rank error at weeks 8 and 12 of 2024, and weeks 8 to 17's single-week outcomes are parts of
  its sums.
- **Item 3:** the rest-of-season rounds 1 and 2 development checks computed 2024 ordering at weeks 4, 8
  and 12, and 2024 was a fit season of those rounds.
- **Item 4:** the rest-of-season round 3 results recorded that on 2024 season-to-date form ordered
  about as well as the model, the comparison G2 makes, on rest-of-season points.
- **Item 5:** round 1's development check computed 2024 single-week ordering for round 1's model, ADP
  and form (fit 2021 to 2023), and its gate summary has been read, again for this document. Its
  per-week rows were not opened.
- **Item 7 (this round):** the fit-round close-out's ruling above, and the confirmatory reads it
  describes.
- **Item 8 (this round):** round 3's number is computed on 2024 inside this judgment, as G7's
  benchmark. The results print round 3's per-week rho on 2024 by position and its pooled differences
  against ADP, form and this model, because G7 needs them and its lead over form follows by
  subtraction. **None of these numbers carries a verdict for round 3**, whose stop rule ended it on
  2023, and none is a model choice for this round.

Nothing else of 2024 was read in writing this.

**2026 outcomes are never read** by a fit, a tuning step, a gate or a model choice. The register
grades the shadow and served numbers after each week for the record page, and those grades enter no
fit before the 2027 preseason round. The served refit of section 4 reads 2024 and nothing later.

**The judgment runs once**, claimed by an exclusive file before any 2024 row is read, on a clean tree
whose HEAD descends from the lock. A second run, or any change not recorded as a defect amendment,
voids it, and the results must say so.

---

## 6. Plan, cost and time

### 6.1 The calendar, honestly

Today is Friday 2026-10-16. Week 6 began Thursday night. The first kickoffs ahead, from the stored
2026 schedule (UTC): week 7 2026-10-23 00:15 (Thursday 2026-10-22 evening ET), week 8 2026-10-30
00:15, week 9 2026-11-06 01:15, week 16's Friday 2026-12-25, week 17 2027-01-01 01:15. Weeks 7 to 17
remain, eleven weeks.

| Dates (2026) | Lane | What it delivers |
|---|---|---|
| Oct 17 to Oct 21 | **66a, the facts ingests** | `stadiums`, `roof_state` and `surface`, `tank01_lines` parsed from the captures, the odds capture hourly from 07:00 ET to the last kickoff on every day with a kickoff (closing the Friday and Saturday daytime gap before week 15's Saturday games and week 16's Friday games), the NWS forecast job per kickoff slot, the Tank01 projection capture fixed to once per slot, `player_td_prop_observations` and the anytime-touchdown market, and a check that `props-snapshot` writes |
| Oct 22 | **67, the week facts (the coordinator's call)** | The game's expected score and margin and the forecast as facts in the week view for **week 7** |
| Oct 17 to Oct 22 | **66b, the history ingests**, beside 66a | `nflverse_pbp_plays` 2016 to 2026, weekly depth charts 2016 to 2025, NGS 2016 to 2025 and PFR 2018 to 2025, the weather and precipitation fill (play-by-play text, then ISD) with its counts for 2016 to 2024, into the dev copy and a scratch dump, and the depth chart stamp check of section 5 with its verdict |
| Oct 20 to Oct 24 | **68, the feature store** | As-of features per game on round 3's instant, ledger and outcome reader, the allow-list and its read kinds, the `game_result` refusal test, the default table of 2.10, the guard tests |
| Oct 22 to Oct 28 | **69, the model** | The play, team and share models with forward-chained refits, the empirical Bayes shrinkage, the identities and the touchdown reconciliation, the simulation, the Shapley why, the benchmarks (round 3's number, the baseline), `ROUND_FOUR` and its tests, a pre-run review |
| Oct 28 to Oct 29 | **70, the development check** (the coordinator) | 2023, once, the stop rule applied, any defect amendment committed |
| Oct 30 to Nov 2 | **70, the judgment** (the coordinator) | 2024, once, and the results |
| Nov 3 to Nov 5 | **71, on a pass** | The served refit pinned, then the served number, why lines, chance sentence and record page, live for **week 9** |

**What can be live for week 8:** the week facts, and the shadow freeze of the system's numbers from
lane 69's end, shown internally and excluded from every "leads" test (3.3). A served week-8 number
would need the judgment passed and the refit pinned by Wednesday 2026-10-28, two days ahead of the
plan, with no defect amendment, and the plan does not assume it. **The decision for the founder,
stated plainly:** "The full system can be judged and live for week 9 (Thursday November 5). Week 8 is
possible only by cutting the model lane's review. The game score and weather facts are live for week 7
either way. Say which."

**The register's prospective weeks:** shadow freezes from week 8 if lane 69 lands by October 29, and
9 weeks of counted, pinned-version numbers (9 to 17) on a pass. The first look of 3.3 falls after
week 13, with 5 counted weeks.

**The fit seasons' feeds** are all upstream for 2016 to 2025 except FTN (2022 on) and participation
(no 2026), both kept out of the fit. Every precondition below is counted before any fit.

### 6.2 Cost

**Compute,** estimated from the rounds' measured times on the founder's laptop (round 3's check took
183 s, of which the reads 88 s and the rest-of-season refit 39 s). The play model is now fitted four
times forward-chained (on 2016 to 2020, to 2021, to 2022, to 2023) over a 16-cell grid each: estimated
under 60 minutes. The team and share models with their refits: under 20 minutes. The feature reads
per kickoff slot are of round 3's order with the play table added. The simulation is 10,000 draws per
game, vectorised in numpy, over roughly 400 players a week: seconds a week. **The development check
and the judgment are each estimated under two hours,** and the results report the measured times. The
served refit adds one fit of each component at fixed hyperparameters, under 30 minutes. A live run per
kickoff slot, with the models fixed, is estimated under two minutes.

**Money:** the NWS API, Wikidata and NOAA ISD are free. The Tank01 captures, hourly on every kickoff
day, stay inside the paid plan's daily quota (15,000 requests a day, the audit). The touchdown props
markets spend Odds API credits inside the existing 100,000-credit monthly plan, quoted by lane 66a
before they turn on. The optional historical game odds pull is quoted first and escalates if it
exceeds the plan. No model call and no prose in the fit or the judgment: the why lines are templated
facts, not LLM prose.

### 6.3 Who runs what

The lanes build and test on scratch copies. **The coordinator, never a subagent,** runs the depth chart
check's recorded run, the development check, the judgment and the served refit once each, on a
scratch copy named `lane70_weekly` on the local test server (port 5433), restored from a dump of the
dev copy's `research` schema after lanes 66a and 66b have written their history. The round's scratch
guard admits only a `lane70_` database on 5433. Never dev (5432), never 5440, never production.
Production receives each ingest once as a backfill (the 2026-09-07 Neon ruling) and one verification
read, and the pinned served artifacts through `model_artifacts`.

**Preconditions, checked on the scratch copy before any fit and recorded in the results:**

- every input of section 2 present for its seasons, counted: the play table 2016 to 2024, weekly depth
  charts 2016 to 2024, NGS 2016 to 2024, PFR 2018 to 2024, `roof_state` for every club-week of 2016 to
  2024, a stadium row for every `stadium_id` of 2016 to 2026,
- the game figures for every club-week with a game in 2016 to 2024 (512 a season to 2020, then 544 /
  542 / 544 / 544, as counted),
- recorded temperature, wind and precipitation for every outdoor club-game of **2016 to 2024** after
  the fill, or the count left at the default with its indicator, printed per season (before the fill,
  the dev copy holds 384 / 384 / 382 / 380 / 330 weather rows for 2016 to 2020),
- the depth chart stamp check run and its verdict recorded (pass: the week-W chart, fail: week W-1's),
- round 3's preconditions (kickoffs, the symmetric pairing, stamped filings, `ffc_adp_ppr_12` for 2023
  and 2024, the rest-of-season priors equal to their records),
- round 3's code at `dc39efce` reproducing its development check's 26 gate lines exactly, before it is
  used as a benchmark on 2024.

A missing one refuses the run and is named.

### 6.4 The order and the lock

Each step committed before the next: (1) **this document, committed by the coordinator: the lock**,
its commit message repeating the fit windows of 2.6, (2) lanes 66a and 66b, the ingests, and the depth
chart check's record, (3) lanes 68 and 69, the code and tests, with a pre-run review, (4) the
development check and its record, any defect amendment, the stop rule applied, (5) the judgment, once,
claimed by an exclusive file, (6) the results, (7) on a pass, the served refit, pinned, before the
first counted freeze. The judgment refuses to run unless the lock is an ancestor of HEAD (round 2's
`preregistration_committed` rule).
