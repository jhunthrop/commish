# Best-Ball / Draft-Lobby Operators Research: Underdog Fantasy, Drafters.com, DraftKings Best Ball

Research date: 2026-08-20. Sources are web-search-derived summaries and help-center content (Underdog's help.underdogfantasy.com / help.underdogsports.com redirected and blocked direct WebFetch with 403; content below is reconstructed from WebSearch's own fetch+summarize of those pages, cross-checked against secondary sources).

---

## 1. LOBBY UX

### Underdog Fantasy
- Lobby is organized by contest type (Daily, Best Ball) with an "Active" tab showing drafts you've joined that are either waiting to fill or currently drafting.
- **Sit-and-go mechanic confirmed**: a draft begins once all seats are filled — not on a fixed schedule. "Once entered into a draft and filled completely, it will begin. The draft order will be randomly assigned, and a countdown timer will be triggered to signify the start of the draft." This is the classic instant sit-and-go: join → seated when N users present → draft starts immediately.
- Sit N Go Best Ball is offered in multiple sizes — help center product is literally named "Best Ball (Sit N Go)" and secondary sources describe groups of 12, 6, or "whatever size the particular draft is" (3-person also referenced elsewhere).
- Users can also set custom draft parameters: a help article "Can I set my own Draft Order, Entry Fee, and Draft Size?" confirms user-configurable private/custom drafts (draft order, entry fee, draft size) alongside the public sit-and-go pools.
- Entry fees range from a few dollars up to $25 (Best Ball Mania tier) and higher for the Championship tournament.
- Draft speed is a lobby-level filter: users pick "fast" vs "slow" drafts; Best Ball Mania entries are typically slow drafts scheduled well ahead of the season.
- Best Ball Mania seat count confirmed indirectly via bracket math: Round 1 = 672,336 total entries split into 56,028 groups of **12** (12-person snake drafts is the standard/default Underdog best ball size).

### Drafters.com
- Lobby model: "You select a league in the lobby, start drafting your team and follow along each week to win your matchups."
- Draft groups are **12-person, 20-round snake drafts** (same seat count as Underdog).
- Speed filter: Fast Drafts (30s/pick) vs Slow Drafts (up to 8h/pick) — mirrors Underdog's fast/slow split almost exactly.
- Key structural difference from Underdog: Drafters uses **cumulative season-long scoring with no in-season playoff bracket** — "there are no end-of-season playoffs, but rather one season-long contest. Whichever drafter has the most points throughout the season wins the top prize." After the 12-person draft pods complete, individual draft cohorts dissolve into one combined large-field league for scoring purposes (the draft pod is just how you build a team; the contest field is much larger).
- Multi-entry: up to 150 entries per user confirmed for its flagship contest (same cap Underdog uses for Best Ball Mania).

### DraftKings Best Ball
- Also offers Fast Drafts (30s/pick) and Slow Drafts (up to 8h/pick, tightening to 2 minutes/pick starting a specific date pre-season with **no overnight pause** after that tightening point — a notable difference from Underdog's overnight pause behavior, see clocks section).
- Standard tournament format: 12-team snake drafts, 20 rounds, 20-player rosters, requires players from at least 2 different NFL teams (anti-single-stack rule not present on Underdog/Drafters as far as found).
- Millionaire Maker-style large-field tournaments exist (e.g., $3M grand prize pool referenced, ~15% rake, large multi-thousand-person prize pools) — DraftKings' answer to Best Ball Mania.

**Common thread across all three**: 12-person draft pods are the industry-standard seat count for best ball snake drafts; fast-draft clock of 30 seconds is the converged standard; slow-draft clock starts near 8 hours and auto-tightens as kickoff nears (all three platforms do this, confirming it's now table stakes, not a differentiator).

---

## 2. DRAFT CLOCKS

### Underdog Fantasy — most precisely documented
- **Fast draft**: 20 or 30 second pick clock (sources vary; both cited — likely 30s is the more common/current default, 20s appears on some older-generation Underdog fast-draft variants).
- **Slow draft — auto-tightening schedule** (this is the standout mechanic worth replicating):
  - Default/starting clock: **8 hours per pick**
  - Slow drafts include an **overnight pause of 3 hours, from 2am–5am ET** (drafters can still make picks manually during this window if they want, but the clock effectively pauses/extends so no one gets auto-picked overnight)
  - **2 weeks before Week 1**: clock tightens to **4 hours per pick**
  - **1 week before Week 1**: clock tightens to **1 hour per pick**
  - **Day the season begins (Week 1 kickoff day)**: clock tightens to **10 minutes per pick**
  - **2 hours before the first game of the season**: clock accelerates further to **60 seconds per pick**
  - This is a five-stage tightening ladder: 8h → 4h → 1h → 10min → 60s, timed off the calendar countdown to kickoff, with an overnight courtesy pause removed once the final tightening stages hit.

### Drafters.com
- Fast Drafts: 30 seconds per pick.
- Slow Drafts: starts at 8 hours per pick, "gradually shortens as the start of the season approaches" (same directional pattern as Underdog; exact intermediate steps not confirmed in available sources, but structurally identical philosophy).

### DraftKings Best Ball
- Fast Drafts: 30 seconds per pick.
- Slow Drafts: up to 8 hours per pick, tightening to **2 minutes per pick** at a specific pre-season date/time (example found: "Wednesday, September 4 at 7:30pm ET") — and notably **removes the overnight pause entirely** once that tightening kicks in (Underdog keeps a form of overnight consideration; DraftKings does not once compressed).

### Timeout / autopick behavior (Underdog)
- On timeout, the platform autopicks using the drafter's **personal rankings/queue** if the user has set custom rankings for that contest.
- If no custom rankings exist, it falls back to **ADP / projected performance** ("best eligible replacement based on Average Draft Position (ADP) or projected performance").
- This same rankings-queue logic is also used for "Draft Swaps" — a separate feature where a player who becomes inactive/is ruled out can be auto-swapped for the next-best queued player, again driven by the user's saved rankings or fallback ADP.

---

## 3. CONTEST STRUCTURE

### Underdog Best Ball Mania (currently on "Best Ball Mania VII" for 2026 season)
- **Entry fee**: $25 per entry.
- **Multi-entry cap**: up to 150 entries per user.
- **Total prize pool**: $15 million.
- **Top prize**: ~$2 million to 1st place (2nd place ~$1 million referenced elsewhere).
- **Rounds/advancement** (4-round bracket structure):
  - Round 1: 672,336 total entries across 56,028 groups of 12 (standard 12-person draft pods, run across the regular season).
  - Top 2 finishers per 12-person group advance to Round 2.
  - Round 2: 112,056 entries across 1,175 groups of 8.
  - (Further rounds continue narrowing toward the championship weekend; exact Round 3/4 structure not fully retrieved but follows the same "win your pod, advance" bracket logic culminating in a live championship stage.)
- Scoring automation: at the end of each week, Underdog auto-selects each entrant's highest-scoring eligible players at each roster slot as "starters" — no lineup-setting required, consistent with best ball's promise of zero in-season management.
- **Roster format**: half-PPR scoring, 20-player rosters (18-round tournaments use 18-player rosters), starting lineup QB/RB/RB/WR/WR/WR/TE/FLEX, no K or D/ST.

### Underdog Sit-and-Go Best Ball (year-round liquidity product)
- Smaller, always-available pods: 12-person, 6-person, and smaller (3-person referenced) sit-and-go drafts with a range of entry fees from a few dollars up.
- Also supports user-configured custom/private drafts (choose your own draft order, entry fee, and draft size) — this is the "commissioner mode" layered on top of the public liquid pools.

### Underdog 2025-2026 new/variant contest types (confirmed via search)
- **Weekly Winners**: one best-ball draft, but instead of a single end-of-season prize, the same roster competes in a new DFS-style tournament every week from Week 1 through Week 17 — turns one draft into a recurring weekly-winnings product (directly answers "managed roster"-adjacent question: still zero lineup management, but monetization recurs weekly instead of once).
- **The Eliminator**: head-to-head bracket style running through a Week 17 final (single-elimination overlay on top of best-ball rosters).
- **Battle Royale**: DFS gameplay combined with snake drafts; Week 1 entry fee $7, winning roster prize up to $50,000, runner-up $25,000 (single-week-scoped best ball/DFS hybrid, not season-long).
- **Puppy Bowl-adjacent low-stakes contest**: a $5 entry low-stakes contest referenced as one of Underdog's lower-friction funnel products.
- No evidence found of a "dynasty best ball" product from Underdog as of this research (searches returned only standard redraft/half-PPR/20-round formats plus a European soccer "Premier Pup" best ball spinoff, which is a different-sport line extension, not dynasty).
- **Important framing for our platform**: Underdog and Drafters are **100% best-ball / zero managed-roster** products — no waivers, no trades, no lineup-setting, ever. There is no managed-roster in-season decision layer on either operator; that gap is exactly the wedge our real-money season-long managed-roster platform is positioned against. Their "lobby feel" is the UX bar to hit; their product itself (no GM decisions) is the gap we exploit.

### Drafters.com
- Multiple prize tiers: Best Ball Championship ($5.50 entry, $50K guaranteed pool, $10K to 1st); Best Ball Championship II ($11 entry, $100K guaranteed, $25K to 1st); a Mini Championship ($2 buy-in, $20K to 1st); and a flagship NFL Best Ball Championship Main Event ($1.5M total prize pool, $250K to 1st place, entry around $15, capped at 186,672 total entries, 150 entries max per user).
- Cumulative, no-playoff scoring format (see above) is Drafters' key structural differentiator from Underdog/DraftKings' bracket-advancement model.
- Roster construction cap example found: max 6 QB / 10 RB / 13 WR / 5 TE per user's total portfolio (position-diversity guardrail across multiple entries, presumably to prevent a single injury from tanking someone's whole portfolio).

### DraftKings Best Ball
- 12-team, 20-round snake drafts, 20-player rosters, requires roster players from at least 2 different NFL teams.
- Large-field tournaments (Millionaire Maker style) with multi-million-dollar top prizes and meaningful rake (~15% cited for one product).

---

## 4. WHAT MAKES THE LOBBY FEEL INSTANT/LIQUID

- **Fill-to-start sit-and-go pods** (Underdog, and structurally the same on Drafters/DraftKings): no scheduled start time — a pod fires the instant its 12 (or 6/3) seats fill, which is what makes the lobby feel like there's "always a draft happening" rather than "wait for 8pm ET."
- **Massive parallel pod count at scale**: Best Ball Mania alone runs 56,028 concurrent 12-person Round 1 pods — this is the liquidity mechanism: rather than one giant live draft, the operator runs tens of thousands of small identical pods in parallel so any user can always find an open seat instantly, regardless of stakes level or draft speed preference.
- **Anonymous opponents by default**: standard sit-and-go pods match anonymous strangers (no visible reveal beyond in-draft username); the "commissioner" custom-draft option is the opt-in exception where you invite known people and set your own parameters.
- **Free/practice mock drafts as top-of-funnel**: dedicated free mock draft products exist (e.g., UnderdogMockDraft.com-style tools, and third-party mock lobbies at FantasyPros/Yahoo/ESPN that mirror the same UX) — letting new users rehearse the draft room experience risk-free before paying an entry fee, which lowers first-deposit friction.
- **Fast-draft as a liquidity release valve**: 30-second-clock fast drafts let a user finish an entire 18-20 round draft in well under 30 minutes, so even a "slow-draft-averse" or time-boxed user can find and complete a live draft on demand rather than committing to a multi-day slow draft.
- **Multi-entry at scale (up to 150 entries/user)** amplifies apparent lobby liquidity — a relatively modest number of unique humans can still fill tens of thousands of pods because the same power users are seeding many entries; this is worth knowing since our real-money season-long product with managed rosters won't have the same multi-entry-per-user economics (managed rosters imply one real "team" per user typically), so we can't rely on the same liquidity trick and need a different mechanism (larger single-lobby pools, deposit-matched incentives, etc.) to feel equally "always on."

## 5. 2025-2026 NEW SHIPS (confirmed)
- Underdog: Best Ball Mania VII (7th annual iteration, $15M pool) is the current flagship for the 2026 season.
- Underdog: "Weekly Winners," "The Eliminator," and "Battle Royale" are active recurring/alternate contest types layered on top of standard best ball drafts (weekly-cadence monetization variants rather than single end-of-season payout).
- Underdog: line extension into other sports/formats — "Premier Pup" best ball for English Premier League soccer (non-NFL best ball expansion), signaling the operator is horizontally extending the same draft-pod mechanic to other sports rather than adding season-long managed-roster depth to NFL.
- No confirmed "dynasty best ball" product found for Underdog as of this research pass.
- DraftKings: continues running Fast/Slow Best Ball plus large-field Millionaire-Maker-style tournaments as its 2026 lineup; no major new game-type ships surfaced in this search pass beyond incremental clock/format tuning.

---

## Source URLs

- https://establishtherun.com/best-ball-mania-manifesto-a-guide-to-winning-big-on-underdog-fantasy/
- https://www.draftsharks.com/kb/best-ball-draft-strategy
- https://help.underdogfantasy.com/en/articles/8991638-how-do-best-ball-drafts-work (redirects to help.underdogsports.com/en/articles/8991638-how-do-best-ball-drafts-work)
- https://www.fantasypoints.com/nfl/articles/2026/2026-underdog-draftkings-best-ball-strategy
- https://establishtherun.com/etrs-top-300-for-underdogfantasy/
- https://www.stackedfantasy.com/best-ball/adp/underdog
- https://help.underdogfantasy.com/en/articles/14785343-best-ball-mania-vii (redirects to help.underdogsports.com/en/articles/14785343-best-ball-mania-vii)
- https://help.underdogsports.com/en/articles/15506970-best-bowl-mania
- https://thegameday.com/underdog-fantasy/best-ball/
- https://help.underdogfantasy.com/en/articles/10716487-best-ball-sit-n-go (redirects to help.underdogsports.com/en/articles/10716487-best-ball-sit-n-go)
- https://www.stokastic.com/articles/dfs-strategy/underdog-fantasy-football
- https://rotogrinders.com/sports-betting/underdog-fantasy/best-ball
- https://www.fantasypoints.com/nfl/articles/2025/underdog-best-ball-draft-guide
- https://www.underdogsports.com/games/drafts
- https://fantasyguides.com/pages/fantasy-guides-best-ball
- https://www.fantasylife.com/articles/best-ball/underdog-best-ball-strategy-for-the-2026-big-board-pre-draft-con
- https://www.fantasypros.com/2026/03/fantasy-football-mock-draft-drafters-best-ball-2026/
- https://www.draftkings.com/nfl-best-ball
- https://rotogrinders.com/fantasy/drafters-promo-code
- https://establishtherun.com/drafters-best-ball-rankings-updated-9am-daily/
- https://www.footballguys.com/rankings/type/bestball/drafters
- https://www.fantasylabs.com/articles/drafters-best-ball-format-strategy-tips/
- https://underdognetwork.com/football/fantasy-rankings/2026-fantasy-football-rankings
- https://www.youtube.com/watch?v=PQ1axldkXf0 (Weekly Winners contest attack guide)
- https://establishtherun.com/underdog-weekly-winners-rankings/
- https://gridironexperts.com/underdog-fantasy-draft-recap-weekly-winners-contest/
- https://establishtherun.com/underdog-battle-royale-ranks/
- https://www.si.com/onsi/fantasy/dfs/underdog-fantasy-battle-royale-guide-week-1-roster-strategy-cheat-sheets
- https://www.4for4.com/2025/preseason/draftkings-best-ball-overview-contests-scoring-prizes
- https://establishtherun.com/a-guide-to-draftkings-best-ball-contest-selection/
- https://spikeweek.com/best-ball-tournament-selector/
- https://underdogmockdraft.com/
- https://help.underdogsports.com/en/articles/8923401-draft-swaps
- https://www.si.com/onsi/fantasy/nfl/underdog-fantasy-best-ball-draft-breakdown-strategy-pick-7
- https://help.underdogfantasy.com/en/articles/11137994-can-i-set-my-own-draft-order-entry-fee-and-draft-size
- https://help.underdogfantasy.com/en/articles/12417273-drafts-faq
- https://help.underdogfantasy.com/en/collections/8439261-drafts
- https://www.fantasypros.com/2026/03/best-ball-roster-construction-strategy-advice-fantasy-football-2026/
- https://www.sharpfootballanalysis.com/fantasy/fantasy-football-adp-half-ppr-underdog-best-ball/
- https://establishtherun.com/underdog-fantasy-best-ball-optimal-position-allocation/
- https://www.rotoballer.com/underdog-best-ball-fantasy-football-rankings-and-tiers-2026/1873588

**Caveat**: Underdog's own help-center domain (help.underdogfantasy.com / help.underdogsports.com) returned HTTP 403 on direct WebFetch in this session (likely bot-blocking), so the Underdog-specific figures above are reconstructed from WebSearch's built-in fetch-and-summarize of those exact help pages plus convergent secondary-source corroboration (Establish The Run, FantasyPoints, RotoGrinders, SI/OnSI, StokAastic). The clock-tightening ladder (8h→4h→1h→10min→60s) and the 2am-5am ET overnight pause appeared consistently across the primary help-article summary and were treated as reliable; treat exact dollar figures for Best Ball Mania VII round 3/4 structure as directionally correct but not independently re-verified beyond Round 1/2.
