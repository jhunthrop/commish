# In-season tools: start and sit, waivers, the trade finder

**Status:** drafted overnight 2026-10-15 by the coordinator under the founder's instruction ("start working on the in-season features over night - be sure to spec and do competitive analysis"). Design calls taken under the delegated-design ruling (2026-08-24); the founder reviews this spec in the morning. Open founder decisions are listed in §10.

**Authority above this spec:** `docs/superpowers/specs/2026-10-12-prep-site-architecture-design.md` §2.9 (in-season tools, equal weight), the in-season-tools-equal-weight ruling of 2026-10-13, `docs/research/2026-10-11-prep-site-free-vs-premium.md` (pricing), the honest-data rules, `launch-2027-data-year-2026`.

**Competitive analysis:** `docs/research/2026-10-11-prep-site-feature-burndown.md` (inventory, pricing, reviews) and `docs/research/2026-10-15-in-season-tools-competitive-analysis.md` (the in-season tools one level deeper: inputs, evidence, taps, freshness, complaints). §2 summarises what they change here.

## 1. What this builds

Three screens under the followed league, each one decision, one verb, the evidence beside it:

| Screen | The decision | The verb | Where the verb goes |
|---|---|---|---|
| Start and sit | The lineup for this week, with every change from the lineup the host holds | Start | The host's lineup page (we never write a host) |
| Waivers | Who to add from the unrostered pool, and who to drop for him | Add | The host's waiver page |
| Trade finder | Which trade with which team helps both sides' lineups | Propose | The host's trade page |

They sit on what exists: league sync (Sleeper by link, FFPC connected, Yahoo and ESPN in Lane 21), the league as the site's context (switcher in the shell's top bar), the served board per format with points over replacement, the rest-of-season ordering from week 7 (Lane 18), and the research store's 2026 stat lines, schedule, byes and injury captures, which the API already reads from the research schema.

## 2. What the competition does, and what changes here

From the burndown and the in-season analysis:

- **FantasyPros** sells the in-season set at PRO and up: Who Should I Start (free head-to-head), the Start/Sit Assistant (PRO), Lineup Auto-Pilot that writes the host (MVP), the Waiver Assistant (PRO) and Planner that submits claims (HOF), the Trade Analyzer and Finder (PRO). Every verdict is expert consensus, refreshed on submissions from the last two or three days. The recurring complaints: stale weekly ranks ("It's week 4, the app still shows week 2"), the consensus lagging news (98% of experts starting a receiver whose team was on its third quarterback), and "treats every format like the same 12-team redraft".
- **Flock** has a free two-player start/sit compare on stats and rankings, a waiver page for a synced redraft league, a trade calculator built from its creators' values (free limited, paid unlimited), and a real-trade finder. Its weekly ranks were missing from the app at launch.
- **Neither** states where a number comes from, carries a held-out record, or reads the league's own scoring into the verdict beyond a preset.

From the 2026-10-15 analysis, five findings shape the design: FantasyPros' two start/sit tools disagree with each other (its own help article is titled on the difference), so one basis feeds all three screens here; its trade analyzer has shown two different gains for one trade (review of 2026-10-04), so a gain is computed once and shown once; Flock's "real-trade finder" is a FantasyCalc front end ("Powered by FantasyCalc.com"), not Flock's own, and its verdict scale (Balanced, Slight Edge, Win, Robbery) reads backwards to a reviewer (2026-09-09), so the verdict here is who gains and by how many points a week; Flock shows its start/sit evidence on screen (spread, implied total, points allowed to the position) but hides the formula in a hover title, which our no-tooltips rule bars, so the order's key is stated in words above the rows; and reviewers ask for the stamp we already carry ("the last time an expert updated their rankings", 2026-10-06) and for a way to mark a player as a stash so he is never suggested as a drop (2026-10-06), which §5.2 adopts.

What changes here, and what does not:

- Every number on these screens names its basis, and there is no number we do not have. The weekly projection round failed its preregistered gates on 2026-10-14 (`docs/research/2026-10-13-weekly-projection-results.md`), so **no weekly point projection reaches a screen**. The screens rank by what passed: the season projection before week 7, the rest-of-season ordering from week 7, and this week's facts. The sit-and-start odds §2.9 asked for wait for a weekly round that passes (§10).
- We read the league's exact scoring and roster shape (already saved by league sync) and the drafter's exact roster and opponent (LeagueSync). The "which format" question never appears.
- We never write a host. The verb states the decision and opens the host where the member acts. Auto-pilot and claim submission are out of scope (§10).
- Words: fantasy words only. Start, sit, add, drop, hold, propose, trade, points over replacement. Never value in the trading sense, market, price, buy, sell, stock, asset. No verdict theatre ("Smash", "Robbery", "Fleece"). No tips: the words on the screen explain themselves.

## 3. The basis of every number

The screens use four kinds of number. Each has one source and one sentence that states it.

| Number | Before week 7 | From week 7 (first run after week 6 is graded) | Sentence |
|---|---|---|---|
| Order | The preseason board's position rank in the league's format (points, points over replacement) | The rest-of-season ordering per format (Lane 18; no range) | "Our rest-of-season order from week 7, refreshed October 20" / "Our preseason number" |
| Points over replacement for this league | From the served board valued for the league's teams and roster slots (`boards.For`, what the waiver pool already uses) | Same, on the rest-of-season order | "Points over replacement for a 12-team league with 2 RB, 3 WR and a flex" |
| Points so far | Stat lines under the league's scoring rules, by completed week (the research store's 2026 `player_week_observations`, scored with the league's saved `ScoringRules`) | Same | "18.4 and 11.2 in his last two games under your league's scoring" |
| This week's facts | Bye (board), injury designation with its stamp (Tank01 injury captures), the opponent and the game's kickoff (schedule), points the opponent's defense has allowed to the position this season under the league's scoring (stat lines, season to date) | Same | "Questionable as of Thursday", "at Buffalo Sunday 1:00", "Buffalo has allowed the 4th fewest points to running backs this season, 14.1 a game in your scoring" |

Rules:

- A fact we do not hold is absent, never zero and never a default. A player with no designation shows none.
- Every stamp is shown as a day and time in the member's words ("as of Thursday 4:10 pm"). The league's read age is on the screen as the league page already states it.
- The ranking uses no invented weekly number. Where two players are ordered, the order is the rest-of-season order (or the preseason rank before week 7) after the hard facts (§4.2). The screen says so once above the rows.

## 4. Start and sit

### 4.1 What the member sees

`/league/[id]/start`. The week's lineup, every slot filled, each row a person: headshot, name, team, the opponent and kickoff, the designation if any, points so far this season (last three games), his rest-of-season position rank with its basis. The lineup the host holds is read from LeagueSync (`roster` with `slot` starter or bench) and diffed against ours.

The top line is the decision: "Two changes: start Rachaad White over Tank Bigsby at RB2, start Jauan Jennings over Josh Downs in the flex." or "Your lineup is set." Each change is one row pair with the reason in one sentence from the facts (§4.3). The verb on each change is **Start**, and the page's one verb, top right, is **Set it on Sleeper** (the host's name as mechanism), which opens the host's lineup page in a new tab.

Below the lineup: the bench, ordered, with each player's sentence. A bench player a change touches is highlighted.

### 4.2 How the lineup is chosen

The engine fills the league's slots (LeagueSettings roster counts, flex eligibility through `draft.AssignSlot`'s rules) from the roster by this order of keys, best first:

1. Not out: a player on bye, listed out, on injured reserve, suspended, or whose game is already final with no line is never started over an available one. (A game already played this week: the host's points are the fact, he stays as the host has him.)
2. Not doubtful, unless no eligible alternative exists.
3. The rest-of-season position order in the league's format (or the preseason position rank before week 7), ties by points over replacement, then by points so far this season a game.

Questionable is not a key. It is a flag on the row ("Questionable as of Thursday") and the sentence says to check before kickoff. The screen never claims to know who plays.

Kickoff order matters on Sunday: a change that swaps a player whose game has kicked off is not offered. The engine takes the schedule's kickoff instants (the research store's team-week kickoffs the freeze step already reads) and the run's clock.

### 4.3 The sentence

One sentence per change, built from facts in this order, dropping what is absent: the designation or bye that forces it, else the order ("White is RB14 in our rest-of-season order, Bigsby RB31"), then one supporting fact at most: points so far ("18.4 and 11.2 in his last two"), or the opponent's points allowed to the position when it is in the top or bottom six. Template words are the floor; no stock sentence is repeated across changes on one page (the rows carry the numbers, the sentence names what tipped it).

### 4.4 Honesty lines

Above the rows: "Ranked by our rest-of-season order from week 7 and this week's designations. We do not project a week's points." Before week 7: "Ranked by our preseason number and this week's designations." The record page's standing line is linked ("How the order has done").

## 5. Waivers

### 5.1 What the member sees

`/league/[id]/waivers`. The unrostered pool on our board (what `poolRows` already builds), ranked by the gain to **this** roster, not by the board alone. Each row: the player, his rest-of-season position rank with basis, points over replacement for the league, his last three games, this week's opponent, the designation, and the drop he would displace: "Add for Jaylen Wright (your RB5, RB58 rest of season)". Position chips filter as the pool does today.

The top of the page is the decision: the one add that gains most, with its drop, in one sentence. The verb on each row is **Add**, which marks the pair (add and drop) and opens the host's waiver page with the one verb **Claim on Sleeper**. We submit nothing.

Moves of this week and last (LeagueSync `moves`) remove players already taken since the last read, and the page says when the league was last read.

### 5.2 The gain

For a candidate at position P, the gain is the difference in the roster's lineup strength with him in and his drop out, where lineup strength is the sum of points over replacement across the slots the engine fills (§4.2's fill, on the rest-of-season order). The drop is the rostered player whose removal costs least, never a starter the candidate does not displace, never a player on injured reserve in an IR slot (that slot is free), and never a kicker or defense for a skill player unless the roster holds more than the slots need. A player the member marks **Hold** on the sheet (the sheet's existing tag) is never offered as a drop or a trade give; the row says "held". A candidate with no positive gain is listed below a rule with the line "Nobody here starts for you this week".

Waiver budget and waiver order are host facts LeagueSync does not carry yet. When the host exposes them (Sleeper's `waiver_budget` and settings, FFPC's blind bids), they are read and shown as facts; until then the page says nothing about bids.

### 5.3 Honesty line

"Ranked by the gain to your lineup on our rest-of-season order. A drop is the player it costs you least to lose."

## 6. The trade finder

### 6.1 What the member sees

`/league/[id]/trades`. For each other team in the league, the trades that help both lineups: one-for-one and two-for-one, found by search (§6.2). Each trade is a row pair: you give, you get, each player with his rest-of-season position rank and points over replacement, and two gains stated plainly: "Your lineup gains 4.1 points over replacement a week, theirs 2.3". Ordered by your gain, with their gain shown so the member proposes only what the other side can accept. Teams are headed by their names and owners from LeagueSync, with their record.

The verb on each trade is **Propose**, which opens the host's trade page for that team with the players named on our screen. We never send an offer.

Also: the member picks a player they want or want to move, and the finder narrows to trades holding him.

### 6.2 The search

Both rosters are filled by §4.2's engine on the rest-of-season order. Lineup strength is the sum of points over replacement over the filled slots. A trade is kept when both strengths rise after the swap and both rosters still fill every slot. Candidates: every one-for-one and two-for-one pair across the two rosters at skill positions, kickers and defenses excluded, players on injured reserve excluded. The search is exact over those pairs (a 15-man roster against a 15-man roster is a few thousand two-for-one pairs, done in the request well under the API's p90 budget; the counts are measured in the lane).

Ties and near-ties are shown, not hidden: a trade where their gain is under 0.5 a week is marked "a close call for them".

### 6.3 Honesty line

"Trades where both lineups gain on our rest-of-season order. Nothing here is a price. The other team decides."

## 7. The API

All under the attached league, signed in, the drafter's own league only (the league's `me` roster). Rate limited as the sync routes. Every response in the envelope. Reads: the LeagueSync view (one upstream read per league per minute as today), the served board for the league's format and shape (`boards.For`), the research schema's 2026 stat lines, schedule and injury captures through the existing Postgres source pattern (`boards.PGSource`), the league's saved `ScoringRules` to score stat lines.

```
GET /leagues/attached/{id}/lineup      → LineupAdvice
GET /leagues/attached/{id}/waivers     → WaiverAdvice   (?position=RB optional)
GET /leagues/attached/{id}/trades      → TradeAdvice    (?player={board_id} optional)
```

Shapes (additive; every number carries its basis once at the top, every stamp a date-time):

```yaml
WeekFacts:            # shared by every player row on the three screens
  week: int
  opponent: string|null         # "BUF"; null on bye
  home: bool|null
  kickoff: date-time|null
  bye: bool
  designation: {status: enum[questionable,doubtful,out,injured_reserve,suspended,pup,nfi], as_of: date-time}|null
  played: bool                  # his game this week is final
  points_this_week: number|null # the host's score so far, from the matchup when he is a starter
  last_games: [{week: int, points: number}]   # up to three completed games, under the league's scoring
  allowed_to_position: {points_a_game: number, rank: int, of: int, position: string}|null   # the opponent's defense, season to date, league scoring

PlayerLine:
  player: LeaguePlayer          # existing
  position_rank: int|null       # rest-of-season from week 7, preseason before; null when unranked
  points_over_replacement: number|null
  facts: WeekFacts

LineupAdvice:
  week: int
  basis: string                 # the honesty line
  order_basis: enum[preseason, rest_of_season]
  refreshed: date-time          # the run the order came from
  read_at: date-time            # the league's last host read
  set: bool                     # true when no change
  slots: [{slot: string, ours: PlayerLine, host: PlayerLine|null, changed: bool, sentence: string|null}]
  bench: [PlayerLine]
  host_lineup_url: string       # the host's lineup page

WaiverAdvice:
  week: int, basis, order_basis, refreshed, read_at
  best: WaiverRow|null
  rows: [WaiverRow]             # positive gain first, then the rest under a rule
  host_waivers_url: string
WaiverRow:
  add: PlayerLine
  drop: PlayerLine|null
  gain: number                  # points over replacement a week to the lineup
  starts: bool                  # he starts for you this week
  sentence: string

TradeAdvice:
  week: int, basis, order_basis, refreshed, read_at
  teams: [{roster_id, name, owner, record, trades: [TradeRow]}]
  host_trades_url: string
TradeRow:
  give: [PlayerLine]
  get: [PlayerLine]
  my_gain: number
  their_gain: number
  close_for_them: bool
```

Errors: a league not in season answers 409 with the sentence the league page uses; a league with no saved scoring (settings_note set) answers 422 naming it; a stale host read is not an error, the stamp says how stale.

## 8. The web

Three routes under `web/src/routes/league/[id]/{start,waivers,trades}`, reached from the league page by three tabs beside the panels it has (Roster, Matchup, Moves, Pool). The league switcher in the shell applies. Built from the primitives the league page uses (`LeagueRow`, `Panel`, `PanelHead`, `Chip`), rows at the board's 53 px density, headshots on every row, both themes, 1440 and 390, the script budget of the league page (not Lighthouse-gated, but nothing added to the shell's shared chunk).

Each screen: the decision line first, the one verb top right, the rows, the honesty line above the rows, the read-age and refreshed stamps where the league page puts them. Loading states show the reserved rows, never a spinner over nothing. Errors are the API's sentence.

The four personas walk every screen in the lane's report: the veteran wants the order and the numbers at a glance; the casual wants the one sentence and the one verb; the commissioner wants the other teams' names right and nothing that insults a trade partner; the first-timer must understand "points over replacement" from the words beside it the first time (the basis line says "points above what a free pickup at his position gives you").

## 9. Research and data

Nothing new is fitted. The lane adds read paths, not models:

- The API's Postgres source gains reads for: 2026 stat lines by player-week (`research.player_week_observations`, the scoring metrics), team-week schedule with kickoffs and the final flag (`research.team_week_observations`, what the freeze and game-log steps read), and the latest injury capture (`tank01_injuries_by_date` then `tank01_injuries`, the sources the capsule facts use, newest stamp wins). Each read is parameterised, capped and cached on the API's existing board-cache pattern with a short TTL (schedule and stat lines move at most daily, captures hourly).
- Points under the league's scoring are computed in Go from the stat-line metrics with the league's `ScoringRules` (the 21 keys), the same code that scores a mock. Metrics the rules do not carry are ignored and the dropped-rules line the league page prints applies.
- Points allowed by a defense to a position: from the same stat lines, summed per opponent per week per position, season to date, ranked among 32.

When a weekly projection round passes its gates (§10), its rows join `PlayerLine` as `week_points` with range and the sentence gains the odds; the order key in §4.2 becomes that number. Nothing else on these screens changes.

## 10. Open founder decisions

1. **A second weekly round.** The weekly round failed on 2025 and cannot rerun on it. A round 2 needs a different basis and a clean judgment season; 2024 carries one rest-of-season judgment and 2026 is pristine. Whether to preregister a weekly round 2 on 2024 this season, or wait for 2027, is a research ruling for the founder. Until then the screens carry no weekly points.
2. **Writing to a host.** FFPC's stored sign-in makes a lineup write possible; Yahoo's write scope was not requested; Sleeper has no write API. The sync products sell auto-pilot. This spec keeps the advisory-only line (no code path writes a host). Say if that should change for FFPC.
3. **Tier.** §2.9 puts the in-season tools on the Membership. Nothing is sold in 2026 (Stripe is in test), so the screens open on the one free followed league this season behind a feature flag `in_season_tools`, gated to the Membership when the tiers go live in 2027. Confirm.
4. **Trade finder reach.** Two-for-one both ways and one-for-one. Three-for-one and pick trades are out until asked.

## 11. Lanes

| Lane | Builds | Depends on |
|---|---|---|
| 25 API | The week-facts reads (§9), the lineup engine on the league's slots, the three routes and their OpenAPI, tests with fixtures, p90 measured | nothing (reads existing tables and the board) |
| 26 Web | The three screens from the OpenAPI in §7 against a fixture server, then regenerated types when 25 lands; shots at 1440 and 390 both themes; four personas | §7's shapes; merges after 25 |
| 27 Review | ux-design-architect review of the merged screens live; the record page link | 25 and 26 merged |

Gates as every lane: api `gofmt -l`, `go vet`, `go build`, `make check-gen`, the race tests; web `npm run check`, `npm run lint`, `npm test`, Lighthouse as web.yml runs it; copy guard tests on every new sentence.
