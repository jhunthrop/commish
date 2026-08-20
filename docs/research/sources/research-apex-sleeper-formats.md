# Research: Apex Fantasy Leagues, Sleeper, and Format Landscape (2026)

Compiled 2026-08-20. Sources are WebSearch snippets + WebFetch page extractions; several apexfantasyleagues.com/lobby subpages returned HTTP 403 to the fetch tool (blocked bot access) — noted where that limited detail.

---

## A) Apex Fantasy Leagues (apexfantasyleagues.com) — 2026 catalog

### Company facts
- Operating since 2013. Self-reported scale: "1,000+ leagues filled each year," "86.5K+ teams drafted," "over $9.5M paid to winners" (lifetime, per about-us page).
- Runs on **MyFantasyLeague (MFL)** as the underlying league-management/draft software (white-labeled).
- Funds held in escrow via **Daeh Law** / an audited trust account during the season.
- $9.95 commissioner fee baked into entry price; live-draft leagues add $5; dynasty teams get a $5 fee starting 2026; state regulatory fees vary.
- Source: https://apexfantasyleagues.com/about-us/, https://apexfantasyleagues.com/faqs/, https://www.cheatsheetwarroom.com/blog/fantasy-football/leagues/money-league-cash-payouts

### Game modes (8 format categories, per apexfantasyleagues.com homepage + types-of-leagues page)
1. **One-Year (redraft) Leagues** — classic single-season, 12 teams, 18 rounds. Live (snake, ~75-90 sec/pick, ~2 hrs total) or Email draft (8 hr/pick first 2 days, drops to 6 hr after, pauses 3 hrs overnight, ~5 days total).
2. **Dynasty Leagues** — 12 teams, 23-round startup draft. Owners keep rosters year over year. Annual 3-round Rookie/Free-Agent Draft (email, ~mid-July); draft order set by prior-season "potential points" (top 3 finishers draft in reverse playoff order; rest by reverse potential-points standings — an anti-tanking mechanism). Trade deadline = Week 11 kickoff; pick trades require 50% prepayment of next year's renewal (new 2026 rule). Orphaned teams can be bought; 2026 change pools orphan deposits to subsidize/discount takeover owners. Annual renewal fee due May 1.
3. **Best Ball Dynasty Leagues** — combines dynasty keeper structure with best ball (auto-optimal lineup, zero trading/waivers in-season). Only offered in dynasty form, not standalone redraft best ball.
4. **Auction Draft Leagues** — $200 fictitious budget per team; live (~3 hrs) or email; available as redraft or dynasty startup.
5. **Playoff Leagues** — NFL-playoffs-only, 6 teams, "draft only" (14 rounds), fixed roster (2 QB/2 RB/4 WR/2 TE/2 K/2 DEF), total-points scoring accumulated through players' playoff runs. No in-season management.
6. **Superflex Leagues** — QB-eligible flex spot; offered as one-year or dynasty variant.
7. **Deep Leagues** — two flex spots (deeper starting lineups); one-year or dynasty.
8. **Dynamic Leagues** — two flex spots AND no kicker/defense.

No standalone/non-dynasty best ball redraft product was found — best ball only exists bundled with dynasty. No mention of true "total points" league type outside Playoff Leagues.

Sources: https://apexfantasyleagues.com/types-of-fantasy-football-leagues/, https://apexfantasyleagues.com/ (homepage), https://apexfantasyleagues.com/dynasty-fantasy-football-leagues/, https://apexfantasyleagues.com/live-email-draft/

### The "Beat the Average" format (their Victory-Points-style mechanic)
This is NOT a separate selectable mode — it's baked into every Apex league's weekly scoring, all formats. Each week every team plays **two simultaneous games**: (1) a randomly assigned H2H opponent, and (2) the league's average score for that week. A team can go 2-0, 1-1, or 0-2 each week. Example given: a team scoring 92.8 pts beats its random opponent (1-0 in a standard league) but only goes 1-1 at Apex because the league average that week was 102.05. Apex's stated rationale: standings should reflect consistent scoring skill rather than the luck of random weekly pairings; roughly half the league scores above/below average each week, so beating the average is a genuine second contest, not a gimme. All Apex leagues use **PPR scoring**.
Source: https://apexfantasyleagues.com/best-format/

### Stake tiers and league sizes
- Standard league size: **12 teams**, 18-round draft ("Once 12 owners have paid, the league is full"). Playoff Leagues are the exception at 6 teams.
- Marketed stake range: "$75 to $1,000" for standard leagues; dynasty spans "$135–$500"; auction spans "$125–$1,000" (per homepage fetch — these appear to be rounded marketing labels over the exact entry-fee tiers below).
- Named/branded entry tiers with exact pricing (from best-fantasy-football-money-leagues-payouts page):

| Tier name | Entry fee (incl. $9.95 comm. fee) | 1st | 2nd | 3rd | Total prize | Implied payout % of pool (fee×12) |
|---|---|---|---|---|---|---|
| Amateur | $72.95 | $465 | $145 | $35 | $645 | ~73.7% |
| Rookie | $122.95 | $795 | $260 | $75 | $1,130 | ~76.6% |
| Veteran | $172.95 | $1,165 | $395 | $110 | $1,670 | ~80.5% |
| Superstar | $247.95 | $1,745 | $580 | $160 | $2,485 | ~83.6% |
| MVP | $497.95 | $3,700 | $1,135 | $335 | $5,170 | ~86.5% |
| Hall of Fame | $1,002.95 | $7,550 | $2,320 | $670 | $10,540 | ~87.6% |

Every tier pays 1st/2nd/3rd place — Apex markets this as a rarity vs. competitors that pay only 1st/2nd.
**"Enhancements":** Apex will add bonus money to 1st place at no cost to players, usually applied shortly before draft, both to sweeten prizes and to help under-filled leagues reach 12 and draft on time.

**Discrepancy flag:** a Yahoo Finance / GOBankingRates-style secondary source (surfaced in search snippets, not independently verified via direct fetch) claimed different, higher numbers — "$100 buy-in → 90-91% payout, $200 → 94%, $350 → 96%, $500-$3,000 → up to 98%." Apex's own page data (computed above) shows payouts in the **73%–88% range** for their actual tier structure ($73–$1,003 entry fees), and lordskunk.com's independent computation confirms ~73% low-end / ~88% high-end. Treat the 90-98% figures as unverified/possibly describing a different operator or stale data; the 73-88% range computed directly from Apex's own published prize table is the more reliable figure.
Sources: https://apexfantasyleagues.com/best-fantasy-football-money-leagues-payouts/, https://lordskunk.com/guides/high-stakes-fantasy-football-leagues-explained/ (via WebFetch), https://finance.yahoo.com/news/fantasy-football-leagues-best-payouts-230140239.html (unverified snippet only)

### Draft types offered
- **Live snake** — real-time, ~75-90 sec/pick clock, ~2 hrs total.
- **Email (slow) draft** — 8 hr/pick clock (drops to 6 hr after day 2), 3-hr overnight pause, ~5 days total.
- **Auction** — live (~3 hrs, $200 budget) or email format.
- No mention of "auction-on-ESPN" or any third-party draft-room integration — drafting happens natively inside Apex's MFL-powered platform.

### Join lobby / public league browsing
Confirmed mechanics (faqs page): users go to the **Apex Lobby**, create/verify an account, deposit funds, then "select the price, league type, and when you would like to draft." Filtering is confirmed for **price** and **league type**. A **skill-level signal** exists: expert/highly-experienced players are marked with a **crown symbol** in the lobby so beginners can see when a league has experienced competition (per lobby.apexfantasyleagues.com/expert-level, found via search snippet only — direct fetch returned 403). Average Draft Position (ADP) data is also viewable in the lobby.
**Gap:** could not directly confirm the full filter UI (e.g., whether there's a distinct "skill level" dropdown vs. just the crown badge, or additional filters like team-size or scoring) because lobby.apexfantasyleagues.com/help-faq and /prize-payouts both returned 403 Forbidden to the fetch tool across repeated attempts (likely bot-blocking on the lobby subdomain specifically — the main apexfantasyleagues.com domain fetched fine).

### Draft scheduling mechanics
**Fixed calendar slots**, not owner voting. The live-email-draft page directs users to a published draft-date calendar ("To see all of our draft dates, click here") that owners pick from when joining a league — leagues fill around a pre-set time rather than the group scheduling/voting on a time after signup. Owners are responsible for being present at the scheduled time; late/no-shows get auto-picked via worklist → personal rankings → MFL ADP fallback.
Source: https://apexfantasyleagues.com/live-email-draft/, https://apexfantasyleagues.com/faqs/

---

## B) Sleeper — config breadth (the free UX bar)

### League types
- **Redraft** — fresh rosters/full draft picks each year.
- **Keeper** — retain N players per year with keeper-cost draft-pick penalties.
- **Dynasty** — full roster carryover, rookie-only drafts, **taxi squads** supported (a stash-list for rookies that doesn't count against active roster — no real-money operator surfaced in this research offers a taxi squad equivalent).
- **Best Ball** — supported as a toggle/mode.
- League size: **4–32 teams** (far wider than any real-money operator's fixed 12).

### Draft types
- **Snake**, **Linear** (same order every round — notably uncommon elsewhere), **Auction**, and **Snake w/ 3rd-Round-Reversal (3RR)**.
- Pick timer: fully configurable, **10 seconds to 24 hours** (some secondary sources say up to 7 days), with exact custom start times down to the minute.
- **Slow draft support**: commissioners commonly run 4-hour to 7-day per-pick timers; ~8 hr/pick is described as the "competitive sweet spot" for serious slow drafts. An **overnight-pause feature** freezes the clock during set hours so nobody is auto-picked at 3 AM.
- Draft order: randomized or manually seeded.
- Commissioner tools: "Force CPU Auto Pick" per team, draft-queue-based autopick.

### Scoring flexibility
Fully granular: point values settable to fractions for essentially every stat (yardage, TD, reception, etc.), preset templates mirroring ESPN/Yahoo defaults, customizable milestone/bonus thresholds (e.g., 100-yard games). Supports **IDP** (individual defensive player) scoring/rosters. Waiver systems: Rolling, Reverse, FAAB.

### Distinctive extra mechanic
Sleeper natively supports an optional **"median/average" extra weekly game** — i.e., a built-in analog to Apex's "beat the average" mechanic — available as a free toggle, not something Apex or other real-money operators need to charge a premium format for.

### Guillotine
No dedicated native "Guillotine" league-type toggle found in Sleeper's own docs — it's built by commissioners manually on top of standard settings (typically 18 teams, no K/DEF, FAAB waivers for eliminated rosters), i.e., a **community-managed workaround**, not a first-class Sleeper format. Multiple guides (rotogrinders, draftsharks) confirm Sleeper is the most common free host for it.

### Mock draft lobby
Sleeper has **no public matchmaking mock-draft lobby** (unlike ESPN's dedicated mock draft lobby). Mocking on Sleeper works via **link-sharing**: a user generates a mock draftboard link and shares it directly with others (web or mobile), rather than being matched with strangers through a public queue. Users can mock using specific league settings/custom ADP and create unlimited mocks.

### What serious/hardcore leagues run on Sleeper that real-money hosts don't
- Guillotine leagues (community-built, no real-money host offers this as a first-class product except the niche guillotineleagues.com/"Guillotine Leagues™" brand — see section C).
- Dynasty with taxi squads.
- Superflex + TE-premium + custom scoring stacked together in one league.
- Linear draft order (rare setting, essentially real-money-money hosts only offer snake or auction).
- League sizes outside the standard 12 (4-32 range vs. real-money operators' fixed 12, or Apex's 6/12 only).
- Native median/average bonus-win scoring for free, vs. it being Apex's whole paid-product hook.

Sources: https://support.sleeper.com/en/articles/3537396-league-types-formats, https://www.fantasylife.com/articles/best-ball/sleeper-fantasy-a-deep-dive, https://rotogrinders.com/fantasy/sleeper-promo-code/guillotine, WebSearch snippets re: draft timers/mock lobby (lordskunk.com/guides/sleeper-slow-draft-setup, support.sleeper.com articles).

---

## C) Format landscape scan — growth areas and unmet real-money demand

### Guillotine
Elimination format: **lowest-scoring team is cut each week**, roster dumped to waivers/FAAB bidding, until one team remains (typically week 17). Standard size ~18 teams, no K/DEF, 14-16 roster spots. Growing steadily in 2025-2026 culture (FantasyPros, DraftSharks, RotoWire, FantasyLife all publish dedicated 2026 guillotine strategy/rankings content). **One dedicated real-money-at-scale operator exists**: guillotineleagues.com ("Guillotine Leagues™", partnered with/covered by FantasyLife) — real-money guillotine hosting. Otherwise it's predominantly free-hosted on Sleeper/Yahoo via manual commissioner setup and settled via LeagueSafe/Venmo. **This reads as a real gap Apex does not address at all** — Apex's catalog (redraft/dynasty/auction/best-ball/superflex/deep/dynamic/playoff) has no elimination format.

### Vampire leagues
One team ("the vampire") **skips the draft entirely**, must draft/roster K and DEF only, then builds its whole roster off the leftover waiver wire once the real draft ends (waivers closed to everyone else during this window). If the vampire wins a matchup it can "bite" and steal a player from the opponent's roster (some variants let the victim protect one early-round/starting player). No standardized ruleset — described as inherently commissioner-customized. Entirely a free-host/DIY format (Sleeper threads, fantasy blogs) — **no real-money operator offers this**; 100% bring-your-own-league + Venmo/LeagueSafe settlement territory.

### Empire leagues
A dynasty variant with a **progressive shared jackpot ("Empire Pot")** — half of each year's league fees roll into a growing side-pot that's only paid out once a team wins the league **two years running (back-to-back)**; when that happens, the pot is awarded and the league dissolves/re-drafts fresh the next year, giving open-ended dynasty a defined endpoint. **FFPC (Fantasy Football Players Championship) is the one named real-money operator running this at scale** ("Standard Empire Dynasty Leagues," 12 teams, 20-round startup, 1QB/2RB/2WR/1TE/2FLEX/1K/1DST). Apex has no equivalent — its dynasty product has no shared/progressive jackpot mechanic.

### Superflex / TE-premium
Both described in 2026 coverage as a **"quickly growing" combined format** (superflex QB-eligible flex + TE-premium scoring bump), increasingly the default for "experienced"/hardcore leagues since it forces early QB investment and deepens the TE position strategically. Apex already offers Superflex as a selectable league type (see section A) — this is one place Apex is ahead of the curve rather than behind it, though it doesn't appear to combine Superflex + TE-premium as a single packaged product the way dynasty content creators discuss it.

### Scoring trend
Half-PPR is emerging as the recommended/described "best default" in 2026 commentary (4for4), balancing full-PPR (still popular, but seen by some as inflating short-catch value) against standard. No platform-wide single default exists — ESPN/CBS/Yahoo/Sleeper/NFL Fantasy all still vary. **Apex, notably, locks all leagues to full PPR** — no half-PPR or standard option was found in Apex's catalog, which is a scoring-flexibility gap relative to the free-host norm (Sleeper offers arbitrary fractional scoring).

### Eliminator/Survivor hybrids
A distinct, newer sub-genre blending best-ball/DFS with weekly-survivor mechanics: **Underdog's Eliminator Tournament** — full 17-week head-to-head elimination bracket seeded in 12-person pods (top 6 of 12 advance each round; ~196,608 total entries in recent runs), essentially best-ball entries stacked into a single-elimination gauntlet. Separately, **Eliminator Fantasy Sports** (eliminator.games) and **RealTime Fantasy Sports' Eliminator** run weekly fresh-lineup DFS-style survivor games (draft a new lineup weekly, avoid last place, at least one team cut per week; "Immunity" for weekly #1 finishers). **ESPN added a "Knockout" format** in the same vein, and industry coverage (FantasySP) frames "survivor fantasy football" as a genuinely growing 2025-2026 trend distinct from classic guillotine. These are effectively adjacent to, but structurally different from, Apex's format catalog — Apex has nothing in the elimination/survivor space at all.

### Where unmet real-money demand sits (people playing free + settling via Venmo/LeagueSafe)
Clear DIY/unserved formats, based on this scan: **guillotine** (mostly free-hosted, one small dedicated real-money niche player), **vampire leagues** (100% DIY, zero real-money operators found), and any **dynasty variant with a progressive/rollover jackpot mechanic outside FFPC's Empire product** (Apex dynasty has no analogous pot). Also a general gap: **Sleeper's median/average bonus-win scoring is free**, while Apex charges a premium, MFL-powered product specifically built around that same mechanic — suggesting real-money demand is being captured on the "beat the field" hook itself, but competitors could commoditize/undercut it since it's a well-known free Sleeper toggle already.

### LeagueSafe — what it is and what it implies
LeagueSafe is a third-party **dues-collection/escrow tool**, not a fantasy host — it layers on top of *any* free host (Sleeper, ESPN, Yahoo, MFL, etc.) so a commissioner-run league can collect real money without an operator's own game engine. Key facts (from SharpLink Gaming's public FY2023/24 NFL-season release — SharpLink [NASDAQ: SBET] owns LeagueSafe; most recent publicly reported season-specific stats found were FY2023/24, no fresher FY2025/26 press release surfaced in this scan):
- **$31.5M+** total entry fees collected, **56,000+** private fantasy football leagues, **574,043** individual payments processed — all up (22% $ / 29% payment-count) year-over-year at the time.
- Average entry fee: **$55/user**; average total collected per league: **$565**.
- Fee distribution: **$50 buy-in is most common (34% of leagues)**, $25 = 25%, $100 = 20% (i.e., roughly 79% of LeagueSafe leagues buy in at $25/$50/$100 — well below Apex's $73 floor).
- No rake: LeagueSafe only passes through card/ACH processing fees; 100% of collected dues go back out to winners — a structural contrast to Apex-style operators that build payout percentage (73-88%) into the product itself, and to Yahoo (10% rake on public prize leagues, 2% mgmt fee on private cash leagues) or CBS (41-58% total take on paid contests).
- Implication: there is a **huge, well-quantified bring-your-own-league real-money market** (56K+ leagues, $31.5M+/season on one platform alone) that deliberately avoids operator-run leagues (and their rake / fixed formats / fixed league size) in favor of free-host flexibility (Sleeper's format breadth) + LeagueSafe's zero-rake escrow. That's the target demand for a "hosted flexibility" product that mimics Sleeper-style config breadth while still running as a real-money operator.

Sources: https://apps.apple.com/us/app/guillotine-fantasy-football/id1526770344, https://www.fantasylife.com/articles/fantasy/best-places-to-play-fantasy-football-in-2026-guillotine-leagues, https://www.guillotineleagues.com/coming-soon, https://www.fantasypros.com/2026/06/vampire-league-draft-strategy-guide-2026-fantasy-football/, https://www.profootballnetwork.com/vampire-fantasy-football-league-how-to-play-rules/, https://myffpc.com/cms/public/play/standard-empire-leagues-official-rules, https://www.dynastynerds.com/dynasty/empire-leagues-how-a-small-variation-could-transform-dynasty-fantasy-football/, https://www.pff.com/news/2026-fantasy-football-rankings-te-premium-top-150-for-drafts, https://www.4for4.com/2026/preseason/best-fantasy-football-league-settings-2026, https://www.fantasylabs.com/articles/underdogs-eliminator-tournament-rules-strategy-and-how-to-survive-all-17-weeks/, https://www.eliminator.games/, https://www.fantasysp.com/news/nfl/3057166/survivor-fantasy-football-is-growing-espn, https://www.leaguesafe.com/, https://investors.sharplink.com/sharplink-gaming-announces-record-financial-performance-for-leaguesafe-for-2023-2024-nfl-season/, https://www.gamingtoday.com/news/leaguesafe-data-suggests-significant-fantasy-football-growth/

---

## Known gaps / things not confirmed
- Apex lobby's exact filter UI (beyond price + league type + crown skill badge) — lobby.apexfantasyleagues.com/help-faq and /prize-payouts both 403'd repeatedly.
- No FY2025/26-specific LeagueSafe press release found (most recent public numbers are FY2023/24).
- The "90-98% payout" claim attributed to Apex in one secondary-source snippet could not be reconciled with Apex's own published prize table (73-88%) and should be treated as unverified.
- Whether Apex's Superflex/Deep/Dynamic leagues can be combined with TE-premium scoring, or whether TE-premium is offered at all, was not confirmed — no TE-premium scoring option surfaced anywhere in Apex's own materials.
