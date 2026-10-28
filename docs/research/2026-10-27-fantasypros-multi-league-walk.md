# Why FantasyPros' My Playbook still wins the founder's Tuesday (B262)

Internal, 2026-10-27. Walked from the founder's own screenshots of a signed-in My Playbook session (week 8), compared with our league screens (`/league/[id]/[screen]`: League, Lineup, Matchup, Waivers, Trades, one league at a time). Competitor names stay in this doc and never reach copy. League names, opponents' handles and avatars from the shots are left out.

## What the founder sees there, screen by screen

### 1. Optimal Lineup, Multi-League Mode on
- One page lists every league the member has, each as a Start / Bench pair of tables, with one **Submit All Lineups** button at the top. Edit Lineups is a toggle; the page is read-only until it is flipped.
- Columns are the same on every league: POS, player (headshot, club, position rank), **Expert %** (share of a 10-expert poll that starts him), the week's game, and a 1 to 5 star **matchup** rating. A bench player with no vote shows "–". A bye shows BYE and no stars.
- The per-league block carries the league's name and the member's team name; a summary box under the bench says "This lineup has already been set for your league" with a View Current Lineup link, so a set league costs zero taps.
- Taps on a Tuesday with N leagues: open page, scan, one tap to submit all. Ours: open each league (N), read Lineup, tap Make these changes (N), so 2N taps and N page loads, and nothing tells the member which leagues are already right without opening them.

### 2. Dashboard (one league)
- Three tiles across the top: **Standings** (8th, 3-4), **Avg Points** with the change since last week, **Playoff Odds** (41%).
- Matchup card: both team names with records, projected totals, and a **win probability** bar (70.4% to 29.6%).
- **Power Rankings** radar by position (QB, RB, WR, TE, FLEX, K, DST) with the team's overall power rank in the middle.
- **Weekly Points** line (you against the league median, weeks 3 to 7).
- **Start/Sit Accuracy** ring (84%, +13.2% since last week): their own record, per member, on the dashboard.
- Sponsor units (a prediction market) in two places. Not something to copy; our words rule forbids betting and market language.

### 3. Waiver Central
- A full-width "Waiver Plan is ready" banner with the league name and one verb, **See Your Waiver Plan**.
- **Position Ranks**: one card per position, the member's rank at that position in the league in the head ("RB Rank 2"), a ranked list where rostered players are blue and available ones green with a one-tap add button. Toggle ROS / Week 8 / Dynasty. Expand per card.
- The member reads, in one glance per position, where they are weak and who is free.

### 4. Trade Analyzer
- Two rosters side by side (mine, a chosen opponent's) with checkboxes per player and an ECR rank per row; **Analyze Image** (paste a trade screenshot) and **Pending Offers** (reads the host's pending trades).
- The verdict is instant below: each side's **power rank change** (-23.0% / +23.3%), "Trade Favors", a bar per side, the players changing hands, then View Full Analysis and Share.
- Changing a checkbox re-scores at once. No form, no submit.

### 5. Trust device
- Every screen says "Based on a poll of 10 experts" and lets the member **Pick Experts**. The consensus is the product; the member feels backed by a panel.
- Ours is one order and a public record (`/record`). Stronger when it leads, but the page does not put it beside the decision the way "100 %" sits beside each starter.

## The FFPC question
FantasyPros is a listed FFPC partner and syncs FFPC leagues through the member's own FFPC sign-in in My Playbook, the same way our `hosts/ffpc` client does (it signs in through FFPC's form and reads league home, my teams, rosters, scoreboard, standings, schedule, team lineup, transactions, free agents, draft board and rules). FFPC publishes no API; both products read the member's pages. The matchup stats on their dashboard (win probability, power rankings, playoff odds, weekly points against the median) are computed from those synced rosters and schedules plus their projections, not fetched from FFPC. We already read everything they read; what we lack is the computation and the screens, not the access.

## Gaps, ranked by felt experience (taps saved on a Tuesday)
1. **Multi-league lineup, one screen, one verb.** The reason the subscription is still open. Every league's Lineup on one page, "already set" leagues collapsed to one line, one Submit all that runs each league's host write and reports per league. Web first (`/league` index), then both apps.
2. **League dashboard figures we can compute today:** win probability on the Matchup card, playoff odds, power rank by position, weekly points against the league median, the member's own start/sit record. All derivable from the synced league plus our order and projections.
3. **Waiver plan as a position panel:** my rank at each position in this league, rostered against available, one-tap add through the host (the pickup rule is already API-side).
4. **Free-form trade analyzer:** both rosters, checkboxes, instant verdict as a power-rank change per side, pending offers from the host. Our trade finder proposes; theirs lets the member test any idea in one tap per player.
5. **The decision's evidence beside the decision:** our rank and opp rank beside each starter on the Lineup table is the same shape as their Expert % and stars; keep ours, make sure the figures sit in the row, not in a footer.
6. **ROS / this week / dynasty toggle** on ranked lists.

Not copying: expert polls (we have one order and a record), sponsor units, prediction-market language, any team logo in the apps.

## Candidate lanes
- Lane 257: the multi-league Lineup on the web (`/league` as the member's every-league page; Submit all; already-set leagues as one line). Then an iOS lane and an Android lane from its approved screen.
- Lane 258: dashboard figures on the League screen (win probability, playoff odds, power rank, points against median, the member's start/sit record), API fields first, compatible for one deploy.
- Lane 259: the waiver position panel.
- Lane 260: the trade analyzer (both rosters, instant verdict, pending offers).
