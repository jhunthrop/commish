# In-season tools: FantasyPros and Flock Fantasy, one level down

**Status:** internal research, 2026-10-15. Competitor names are fine here; never in product copy.
**Builds on:** [2026-10-11 burndown](2026-10-11-prep-site-feature-burndown.md). Its inventory, prices and review counts are not repeated.
**Method:** read-only. Public pages, search-result excerpts of help articles, the App Store public review feed, and Flock's shipped bundle (`https://flockfantasy.com/assets/index-BK6_EbP3.js`, read 2026-10-14). No sign-ups, no credentials, no terms accepted.

**Limits, stated up front.**
- FantasyPros help-center pages returned HTTP 403 to direct fetch on 2026-10-14. Their contents below come from search excerpts of those pages and are marked **(excerpt)**. Where I could not see a tool's output screen, I say so.
- Flock's pages render only in a browser. Claims marked **(bundle)** come from shipped code: they prove the feature exists in code, not how it looks.
- Reviews are the 500 most recent US App Store reviews of the FantasyPros app (pulled 2026-10-14). Reddit was not reachable this round; no Reddit quotes are used.
- The Athletic: I could not find any public page for an in-season fantasy tool (three searches, 2026-10-14), so I make no claim about it.

---

## 1. Tool by tool

### 1a. Start/sit

| | FantasyPros Who Should I Start (WSIS) | FantasyPros Start/Sit Assistant | Flock Start/Sit |
|---|---|---|---|
| Gives it | 2 to 4 names. Free to compare; the 4-way is PRO ([burndown](2026-10-11-prep-site-feature-burndown.md)) | A synced league | 2 or more names of one position group; user picks which stats to compare (bundle) |
| Hands back | Which option "the experts would vote for", plus community polls ([support excerpt](https://support.fantasypros.com/hc/en-us/articles/26339296287899-What-tools-do-you-have-for-Start-Sit-decisions)) | Your whole lineup, "based on advanced algorithms and the latest player data", updating "accounting for matchups, weather, and recent trends" (excerpt, same article) | A `recommended` flag on one player from `POST /player-comparison/start-sit` (bundle) |
| Evidence beside it | Projections, matchup breakdown, performance vs projection ([WSIS page](https://www.fantasypros.com/premium/wsis/?sport=nfl), fetched 2026-10-14). The page shows no percentage or vote count to the fetcher | Not visible to me | Per-player spread, over/under, implied team total, and "Opp Rank" ("opponent's rank in fantasy points allowed to this position this season, from Strength of Schedule. 1st allows the most") (bundle) |
| States its basis? | Projection method not named. A third-party page says "3D projections" (baseline, ceiling, odds of ceiling) ([DraftSharks](https://draftsharks.com/kb/fantasy-football-start-sit)); unverified against FantasyPros | Not stated | Opponent rank is labeled with what it counts; the recommendation's formula is not shown |
| Taps | Open, add names, read: about 4 | Open the synced league, read, set it yourself on the host | Add names, adjust stats, read: about 4 |
| Acts on host? | No | No (Auto-Pilot does) | No |
| Free/paid | Free; 4-way PRO | PRO | Free per burndown; page gated to subscribers in code (`is_subscribed` check, bundle) |

Notes:
- FantasyPros keeps two tools whose answers differ. Its own help article is titled "Why does the 'Who Should I Start' tool provide different suggestions/percentages than the Sit/Start Assistant?" ([support](https://support.fantasypros.com/hc/en-us/articles/115000075074-Why-does-the-Who-Should-I-Start-tool-provide-different-suggestions-percentages-than-the-Sit-Start-Assistant-NFL)). So "percentages" do exist somewhere. Reviewers see the split too: "Often major discrepancies between the sit/start advice given on the app vs using the browser. Which one is it?!" ([App Store review, 2026-09-17](https://apps.apple.com/us/app/fantasypros-fantasy-advice/id1141119371?see-all=reviews&platform=iphone)).
- Mobile lost the free tool: "The app no longer has who do I start without syncing a team or paying a fee" (2026-09-27, same feed).

### 1b. Lineup Auto-Pilot (FantasyPros only)

- **Input:** a synced league, a checkbox "Turn on Auto-Pilot" per league. **Off by default** (excerpt, [support](https://support.fantasypros.com/hc/en-us/articles/115001832073-What-is-My-Playbook-Auto-Pilot-and-how-does-it-work-NFL)).
- **Two modes:** swap out inactives (default), or Full Auto-Pilot, which sets "the optimal one based on Expert Consensus Rankings" (excerpt).
- **Confirmation:** "Confirm by Email" sends a link to approve; otherwise it auto-submits and emails a summary (excerpt).
- **Cadence:** checks at least twice a day except Tuesdays, plus the hour before games; inactive-swapping starts Thursdays (excerpt). A second excerpt says every 12 hours and "if your optimal lineup hasn't changed, it takes no further action" ([support](https://support.fantasypros.com/hc/en-us/articles/360018590474-When-will-Auto-Pilot-check-for-my-optimal-lineup-NFL)).
- **Taps:** one setup, then zero. It is the only tool in this study that acts on the host without the user.
- **Paid:** MVP.
- **Complaints:** "Every week they pick the wrong lineup for my fantasy team" (2026-09-27). "On one of my ESPN teams, when I select start/sit assistant, it wants to bench my entire roster" (2026-09-27). "Auto Lineup is difficult to find" (2026-10-04). All App Store feed.
- **Reasoning:** its input is the free page's consensus, so its ceiling is the consensus's, and a bad sync lands on a user who is not looking.

### 1c. Waivers

| | FantasyPros Waiver Assistant | FantasyPros Waiver Planner | Flock Waiver Wire |
|---|---|---|---|
| Gives it | A synced league | A synced league, once per week for the first run | A synced **redraft** league |
| Hands back | Add/drop pairs "based on expert rankings and projections" (excerpt, [support](https://support.fantasypros.com/hc/en-us/articles/115001363868-How-does-the-Waiver-Wire-Assistant-work)) | A plan with backup bids and suggested FAB bids; one-click submit on Yahoo, ESPN, Sleeper, NFL.com | "Rest-of-season pickups for your redraft team" (bundle) |
| Basis stated | Expert rankings | Three factors: value in your league's scoring, value to your roster, and "an estimate of what it will take to secure the player, powered by our proprietary machine learning model" (excerpt, [support](https://support.fantasypros.com/hc/en-us/articles/40901168902811-What-is-Waiver-Planner-and-How-Does-it-Work)) | ROS redraft rankings (bundle) |
| Acts on host | No | Yes, one click; Yahoo and Sleeper need the Chrome extension | No |
| Limits | PRO | HOF. Not tuned for Guillotine/Chopped | "Dynasty and best ball are not supported" (bundle) |

- Complaints: "waiver wire... has been broke the whole season. It's week 5 now. When you try to hit the green add button to compare a waiver pick up to a player on your current roster nothing happens" (2026-10-06). "I would like it to have a way to note who I am 'stashing' so it stops telling me over and over 90 ways to waive or trade him" (2026-10-06). Both App Store feed.

### 1d. Trade analyzer, finder, suggestions, and Flock's calculator and "real-trade finder"

| | FantasyPros Trade Analyzer | FantasyPros Trade Finder / Suggestions | Flock Trade Calculator | Flock Trade Finder |
|---|---|---|---|---|
| Gives it | Two sides, or a synced offer | Your synced league; filters for who you give, who you want, which teams, up to 3 per side ([2022 blog](https://blog.fantasypros.com/11-03-2022-trade-central/)) | Two sides; optional linked league | Two players, plus filters: Dynasty/Redraft, 1 or 2 QB, PPR none/half/full, 8 to 14 teams (bundle) |
| Hands back | A grade from 100+ experts' ranks (burndown); verdict wording not visible to me | Ranked trade combinations; "View Analysis" shows weekly and ROS analysis, positional ranks, lineups before and after | A verdict from a four-word scale: Balanced, Slight Edge, Win, Robbery (bundle) | Real past trades involving those players. The page header reads "Powered by FantasyCalc.com" (bundle) |
| Evidence | Values from consensus ([third-party summary](https://www.cheatsheetwarroom.com/blog/fantasy-football/tools/trade-analyzer-calculator); low confidence) | Gains to both teams, "the odds of a trade being accepted, rest-of-season strength of schedule" ([2022 blog](https://blog.fantasypros.com/11-03-2022-trade-central/)). Acceptance odds are not explained | Number per player. Modes: Dynasty, Rebuilding, Contender. Linked league adjusts for "size, lineup, roster, scoring, and TE premium" ([StatChasers](https://statchasers.com/dynasty-command/help/market-flock-fantasy), checked Sept 2026) | Past trades, not a model |
| Number's source | Expert consensus | Consensus plus an unexplained acceptance model | "Flock values are what its creators think each player is worth, averaged together" (StatChasers). Not market-based | Real trades, via a third-party site |
| Free/paid | PRO | Finder PRO (web); Suggestions MVP | Limited free; unlimited paid | Free per burndown |

- **Finding:** Flock's "real-trade finder" is a FantasyCalc front end, per its own page header (bundle, 2026-10-14). The burndown described it as Flock's. Its own number (the calculator) is opinion; its trade evidence is borrowed.
- Complaints, FantasyPros: "Trade analyzer gains are different on display card than internally. Difficult to trust which number is correct" (2026-10-04). "Rankings don't update. Trade analysis is garbage" (2026-09-29). "Not paying for a trade analyzer when you can get that literally anywhere online" (2026-10-11).
- Complaints, Flock: "the analyzer is backwards of who is getting robbed" ([App Store, 2026-09-09](https://apps.apple.com/us/app/id6799588005)). A Google Play reviewer says one star back is "miscalculated" at 199 when peers are "700 plus", and another calls it "very buggy" ([Google Play](https://play.google.com/store/apps/details?id=com.flockfantasy.mobile), seen via search 2026-10-14).

### 1e. Strength of schedule and rest-of-season (ROS) rankings as feeders

- **Flock SOS:** "Fantasy points each defense allows, and who has the easiest road ahead" (bundle). It feeds the Start/Sit "Opp Rank" column and says so in the column's own label. It is points-allowed to a position this season, a single number with no sample-size note that I could see.
- **Flock ROS:** its waiver tool "uses redraft rest-of-season rankings" (bundle) from the same creator-average board.
- **FantasyPros ROS:** a free consensus board ([ROS](https://www.fantasypros.com/nfl/rankings/ros-overall.php)); Trade Central names ROS strength of schedule as one input (2022 blog).
- **Staleness, both:** FantasyPros: "App still only has option to see week 2 rankings" in week 4 (2026-09-28); "The ECR updates are a bit slow too. ... maybe a way to tell the last time an expert updated their rankings?" (2026-10-06). Flock: weekly rankings were not in its app at launch ("Still waiting for weekly rankings to be posted on the app", 2026-09-12).
- **Reasoning:** the second FantasyPros quote is a user asking for the basis-and-freshness stamp we plan to put on every number.

### 1f. Coach AI (FantasyPros, public)

- A chat assistant for HOF subscribers. It handles expert opinions on players, current stats, "the likelihood a player will play", and trade and waiver advice, drawing on "expert rankings, projections, and stats... in real time" (excerpt, [support](https://support.fantasypros.com/hc/en-us/articles/32059185108123-What-is-Coach-AI)).
- FantasyPros' own roundup ranks it first among AI tools and lists no drawbacks for it ([FantasyPros, July 2026](https://www.fantasypros.com/2026/07/best-fantasy-football-ai-tools/)). That is self-promotion, not review.
- I found no user review of it specifically (2026-10-14). Output examples and a stated confidence format are not public.

---

## 2. The price comparisons

| Outlet | In-season tools | Price | Evidence |
|---|---|---|---|
| USA TODAY Sports Fantasy | League sync with "matchup odds, lineup recommendations, and waiver wire suggestions"; side-by-side start/sit; waiver list "with recommended FAAB"; no trade analyzer mentioned | $39.99 a year | [PPC Land, 2026-08-11](https://ppc.land/usa-today-sports-charges-39-99-a-year-for-fantasy-football-tools/) |
| Establish The Run | Draft Kit Pro includes in-season roster management, trade calculators (redraft and dynasty) and a waiver column; In-Season adds a matchups column and fantasy points projections | Draft Kit Pro $54.99 a year; In-Season $279.99 a year; $89.99 a month; $30.99 a week | [ETR subscribe page](https://subscribe.establishtherun.com/nfl/), fetched 2026-10-14. Page footer says 2025 and the In-Season package is marked "coming soon", so it may be stale |
| The Athletic | Not found | n/a | Searched 2026-10-14; nothing public |

**Reasoning:** USA TODAY sets a $40 floor for synced start/sit and waivers, which sits between FantasyPros PRO ($47.99 a year) and Flock's season pass ($34.30). ETR prices projections and column writing, not tools, at 5 to 6 times that.

---

## 3. What a model-backed tool can do that consensus cannot

*This section is analysis, not research.*

**Where one honest model wins.**
1. **A basis on every number.** FantasyPros states a "consensus rank" and, for waiver bids, a machine-learning estimate with no inputs shown. Flock states an opponent rank but not its recommendation formula. A reviewer asks for the last time an expert updated (2026-10-06). We can print, beside each verdict, the inputs, the sample size and the timestamp.
2. **The league's own scoring.** The 2026-09-22 review says experts flatten "matchups, your actual roster construction" into "where our experts ranked him." A projection computed in your scoring needs no translation step from a PPR consensus. Flock adjusts its calculator to scoring but averages opinions first.
3. **A held-out record.** Neither competitor publishes whether its start/sit calls beat a plain baseline. FantasyPros has a free accuracy page for experts ([accuracy](https://www.fantasypros.com/nfl/accuracy/)), but no record for the tools. A pre-registered, held-out hit rate for "start A over B" is something we can print and they cannot easily copy.
4. **One answer, not two.** One projection feeds start/sit, waivers and trades, so the WSIS-versus-Assistant split and the trade-card mismatch (2026-10-04) cannot occur.

**Where consensus still wins, and we should not pretend otherwise.**
1. **News lag.** Experts read the beat reporters on Friday afternoon. A model only knows what its feed delivers, and a late inactive or role change reaches a person first. The September 2026 thread in the burndown (98% of experts starting a player whose QB situation had collapsed) shows consensus has this problem too, so the edge is speed of ingestion, not authority.
2. **Injuries during the week.** Practice-report nuance, a coach saying "he'll be limited", and weather on game morning need an update path and an honest "stale as of" stamp.
3. **Crowd breadth.** 100+ experts include things no feature set captures: film reads, coaching intent, scheme changes. A model should show a **spread against the consensus** where they disagree, and say which is which, rather than hide either.

**Design consequence (reasoning):** make the model verdict and the consensus spread two separate labeled columns, with a freshness stamp on each.

---

## 4. What we must not copy

**Verdict words.** Our copy rule bars trading and betting words (buy, sell, market, price, value in the trading sense) and allows fantasy words: draft, start, sit, add, drop, hold, reach, steal.

| Seen at a competitor | Problem | Use instead |
|---|---|---|
| "Win", "Robbery", "Slight Edge", "Balanced" on Flock's trade scale (bundle) | "Robbery" and "Win" read as a score against a trade partner; they also invite the "backwards" confusion in review 2026-09-09 | Say who the deal helps and by how many points over the rest of the season: "Helps you by 1.8 points a week" |
| "Trade value", "market values", "trade value chart" | Trading vocabulary and a currency frame | "Rest-of-season rank", "points over replacement" |
| "Sell high", "buy low" in creator content | Banned words | "Hold", "add", "drop", "start" |

**Tips and tooltips.** Flock puts the definition of Opp Rank in a hover `title`. Our rule is that the screen's words explain themselves, so the label itself should read "Faces the 3rd-softest defense against RBs" with no hover.

**Faked precision.**
- Do not show a percentage with no sample behind it. FantasyPros' own help title promises "percentages" (support title above) while the page we could fetch shows none, which suggests precision that users cannot check.
- Do not show an acceptance probability from a model that has no record. FantasyPros lists "the odds of a trade being accepted" as a ranking input and explains nothing about it (2022 blog).
- Do not round a model's output to a single winner when two players are inside the model's own error. Show "too close: start either" with the margin.
- Do not give a Full Auto-Pilot swap on a number we cannot back with a record. Default to propose, then confirm, then act. FantasyPros' own default is off, with email confirm.
- Do not carry advice for formats we do not model. Flock states its limit ("Dynasty and best ball are not supported"); FantasyPros reviewers report the opposite failure ("treats every format like the same 12-team redraft", 2026-09-22).

