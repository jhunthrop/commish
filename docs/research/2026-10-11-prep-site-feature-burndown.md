# Prep-site feature burndown: FantasyPros and Flock Fantasy

**Status:** internal research, 2026-10-11. Competitor names are fine here; they never go in product copy.
**Method:** read-only. Public pages, help-center articles, app-store listings, the App Store public review feed, Google Play listings, a Reddit archive (PullPush) and, for Flock, the public JSON its own subscribe and rankings pages load (`api.flockfantasy.com`) and the copy shipped in its site bundle. Nothing was signed up for, no credentials were entered, no terms were accepted.

**Confidence codes used in every table:**
- **seen**: on the page, or in the public JSON the page renders.
- **bundle**: Flock only. UI copy found in the site's shipped JavaScript (`https://flockfantasy.com/assets/index-BK6_EbP3.js`), so the feature exists in code, but I did not see it rendered.
- **help**: from the vendor's help center or the vendor's own article.
- **review**: from a user review, a Reddit thread or a third party.

---

## 1. Feature inventory per site

### 1a. FantasyPros

Tiers: **Free**, **PRO**, **MVP**, **HOF** (prices in section 3). Tier placement comes from the checkmark grid and tooltips on the plans page ([plans](https://www.fantasypros.com/premium/plans/)). "Web" means the plans page marks the feature web-only (^).

| Feature | What it does | Free / paid (lowest tier) | Where | Conf. | Source |
|---|---|---|---|---|---|
| Expert Consensus Rankings (ECR), draft | Combines 100+ experts' boards into one rank, updated daily; PPR, Half, Standard, Superflex | Free; "Premium ECR" (custom scoring, matchup ratings, red-zone data) is PRO | Both | seen | [half-PPR ECR](https://www.fantasypros.com/nfl/rankings/half-point-ppr-cheatsheets.php), [superflex](https://www.fantasypros.com/nfl/rankings/ppr-superflex-cheatsheets.php), [plans](https://www.fantasypros.com/premium/plans/) |
| ECR method | Rank points summed across experts, not an average rank; in season the pool is filtered by accuracy and freshness, about 50 to 60 experts | n/a | n/a | help | [ECR help](https://support.fantasypros.com/hc/en-us/articles/115001219327-What-is-ECR-Expert-Consensus-Rankings-and-how-do-you-calculate-it) |
| "Pick Experts" | User picks which experts make up their own consensus | Free control, Premium upsell beside it | Web | seen | [dynasty ECR](https://www.fantasypros.com/nfl/rankings/dynasty-overall.php) |
| Weekly and rest-of-season rankings | Weekly ECR plus a ROS board used for waiver and trade advice | Free | Both | seen | [ROS](https://www.fantasypros.com/nfl/rankings/ros-overall.php) |
| Dynasty rankings | Consensus dynasty and keeper board, updated daily | Free | Both | seen | [dynasty](https://www.fantasypros.com/nfl/rankings/dynasty-overall.php) |
| Rookie rankings | Dynasty rookie consensus | Free | Both | seen | [rookies](https://www.fantasypros.com/nfl/rankings/rookies.php) |
| Best ball rankings and ADP | Best-ball board plus ADP from RTSports, DraftKings, BB10s, Underdog, Drafters | Free | Web | seen | [BB rankings](https://www.fantasypros.com/nfl/rankings/best-ball-overall.php), [BB ADP](https://www.fantasypros.com/nfl/adp/best-ball-overall.php) |
| IDP rankings | Consensus IDP board | Free board; IDP draft advice is MVP | Both | seen | [IDP](https://www.fantasypros.com/nfl/rankings/idp-cheatsheets.php), [plans](https://www.fantasypros.com/premium/plans/) |
| ADP composite | Consensus ADP from ESPN, CBS, RTSports, Fantrax and Sleeper; Yahoo shown under Half PPR | Free; "Real-Time ADP" is upsold | Web | seen | [ADP](https://www.fantasypros.com/nfl/adp/ppr-overall.php) |
| Consensus projections | Combines "projections from all major fantasy football sites"; the sources are not named on the page | Free | Both | seen | [projections](https://www.fantasypros.com/nfl/projections/qb.php) |
| Auction value calculator | Dollar values from consensus projections, tailored to scoring, team count and budget | Free calculator; Custom Salary Cap Values is MVP, web only | Web | seen | [auction](https://www.fantasypros.com/nfl/auction-values/calculator.php), [plans](https://www.fantasypros.com/premium/plans/) |
| Accuracy scores | Grades 150+ analysts each season | Free | Web | seen | [accuracy](https://www.fantasypros.com/nfl/accuracy/) |
| Dynasty trade value chart | Monthly article; values come from three staff analysts' consensus, 1QB and SF columns | Free | Web | seen | [Oct 2026 chart](https://www.fantasypros.com/2026/10/fantasy-football-rankings-dynasty-trade-value-chart-october-2026-update/) |
| Trade market values | Dynasty market value from real trades set against consensus value | Free view | Web | review (search snippet) | [market values](https://www.fantasypros.com/nfl/myplaybook/trade-market-values/dynasty) |
| Mock Draft Simulator | Fast mocks against bots from your settings and slot, with a post-draft grade | Free; Redo, custom draft import and "Mock Against the Experts" are PRO | Both | seen | [sim](https://draftwizard.fantasypros.com/football/mock-draft-simulator/), [plans](https://www.fantasypros.com/premium/plans/) |
| Pick Predictor | Odds a player is taken before your next pick | PRO | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Advanced Draft Analysis | Projected standings, strengths and weaknesses after a draft | PRO | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Cheat Sheet Creator | Adjust ranks, add tiers, player tags and notes; edit salary-cap values | PRO (base sheets are free) | Both | seen | [cheat sheets](https://draftwizard.fantasypros.com/football/cheat-sheets/) |
| Draft Assistant with live sync | Pick-by-pick advice synced to the real draft on Yahoo, Sleeper, CBS and ESPN; ESPN needs the Chrome extension and does not work on mobile | MVP (10 syncs), HOF (50 syncs) | Both, ESPN web only | seen | [draft assistant](https://draftwizard.fantasypros.com/football/draft-assistant/), [plans](https://www.fantasypros.com/premium/plans/) |
| Draft Strategies | Pick a strategy, or build one, and the suggestions adapt | MVP, web only | Web | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Keeper / dynasty / salary-cap / IDP draft support | Keeper assignment, dynasty-aware advice, auction sim | MVP; the dynasty draft simulator is free to all | Mostly web | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Draft Intel | League-mate drafting tendencies | Not stated | Both | help (vendor article) | [draft tools](https://www.fantasypros.com/2026/08/best-fantasy-football-draft-tools/) |
| My Playbook league sync | Imports leagues from 17 hosts | Free for 1 team; PRO 2, MVP 10, HOF 50 leagues per sport | Both | seen | [My Playbook](https://www.fantasypros.com/nfl/myplaybook/), [plans](https://www.fantasypros.com/premium/plans/) |
| Who Should I Start (WSIS) | Head-to-head start/sit from expert consensus | Free; 4-player compare is PRO | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Start/Sit Assistant | Your optimal lineup in one view | PRO | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Lineup Auto-Pilot, auto-swap of inactives | Sets the lineup on the host for you | MVP | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Waiver Assistant / Waiver Suggestions | Add/drop advice / proactive pickups | PRO / MVP | Both | seen | [waiver](https://www.fantasypros.com/nfl/myplaybook/waiver-wire-assistant.php), [plans](https://www.fantasypros.com/premium/plans/) |
| Waiver Planner | Builds a waiver plan and submits it in one click | HOF | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Trade Analyzer / Trade Finder / Trade Suggestions | Grades a deal on 100+ experts' ranks / finds deals / proactive offers | PRO / PRO (web) / MVP | Both | seen | [trade analyzer](https://www.fantasypros.com/nfl/myplaybook/trade-analyzer.php), [plans](https://www.fantasypros.com/premium/plans/) |
| League Analyzer | League power rankings, strengths and weaknesses | PRO | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Chrome extension | Lineup, waiver, trade advice and ECR inside Yahoo, ESPN and other hosts | PRO | Web | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Coach AI | Chat assistant over FantasyPros rankings, projections and stats, aware of your league | HOF | Both | help | [Coach AI help](https://support.fantasypros.com/hc/en-us/articles/32059185108123-What-is-Coach-AI) |
| DFS suite | Lineup optimizer, daily projections, export, ROI analyzer (FanDuel, DraftKings, Yahoo) | HOF | Web/app | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| API access | FantasyPros data for personal tools | HOF | n/a | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Premium articles and reports | Gated articles, "Advanced Reports" | PRO | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |
| Content: podcasts, articles, news | Daily podcast, articles, player news | Free | Both | seen | [podcasts](https://www.fantasypros.com/podcasts/) |
| Main app | "FantasyPros - Fantasy Advice": My Playbook and Draft Wizard merged into one app | Free with IAP | iOS, Android | seen | [App Store](https://apps.apple.com/us/app/fantasypros-fantasy-advice/id1141119371) |
| GameDay app | New free app for live scoring across synced leagues and sportsbooks | Free with IAP | iOS | seen | [mobile apps](https://www.fantasypros.com/fantasy-mobile-apps/), [launch post](https://reddit.com/r/fantasyfootball/comments/1wrq42t/) |
| Sports betting add-on | BettingPros tools | +$6.99/mo on any tier | Both | seen | [plans](https://www.fantasypros.com/premium/plans/) |

### 1b. Flock Fantasy

Flock is a single-page app, so plain fetches return an empty shell. Prices and tier copy below come from the public JSON its subscribe page loads ([subscription products](https://api.flockfantasy.com/subscriptions/products), [Stripe catalog](https://api.flockfantasy.com/products), [store items](https://api.flockfantasy.com/store/products)) and from its bundle.

| Feature | What it does | Free / paid | Where | Conf. | Source |
|---|---|---|---|---|---|
| Rankings (redraft, dynasty, weekly, best ball, prospect) | One board per format, with tiers, positional ranks and rank deltas | Expert Average board is public; per-creator boards are paid ("Subscribe to see how each expert ranks this player") | Both | seen + bundle | [formats](https://api.flockfantasy.com/site-settings), [redraft JSON](https://api.flockfantasy.com/rankings?format=redraft), [rankings](https://flockfantasy.com/rankings) |
| Expert Average | Average of the house creators' boards (8 creators have boards; 4 count toward the redraft average); 1QB and Superflex | Free | Both | seen | [redraft JSON](https://api.flockfantasy.com/rankings?format=redraft), [StatChasers explainer](https://statchasers.com/dynasty-command/help/market-flock-fantasy) |
| Community rankings | Crowdsourced boards from user submissions | Paid per the membership list; Reddit described them as free in 2023 | Web | bundle + review | [Reddit 2023](https://reddit.com/r/Fantasy_Football/comments/17r5q0c/), bundle |
| My Rankings / creator studio | Users build their own board; creators publish boards, posts and tier graphics | Free account | Web | bundle | [my-rankings](https://flockfantasy.com/my-rankings) |
| Trade calculator | Values players and picks from the rankings; Dynasty, Rebuilding and Contender modes; adjusts to a linked league's size, lineup, scoring and TE premium; gives a "Smash/Robbery" verdict | Limited free; "Unlimited Access To Trade Calculator" is paid | Both | seen + review | [calc](https://flockfantasy.com/trade-calculator), [products](https://api.flockfantasy.com/subscriptions/products), [StatChasers](https://statchasers.com/dynasty-command/help/market-flock-fantasy) |
| Trade finder | Shows real trades involving a player from users' linked leagues | Free (per users) | Web | review | [Reddit](https://reddit.com/r/fantasyfootballadvice/comments/1fzyux4/im_41_with_a_solid_team_but_want_a_star_wr/lr4y3tf/), [trade-finder](https://flockfantasy.com/trade-finder) |
| League sync and "My Teams" | Links Sleeper, ESPN, Yahoo, MFL, CBS and FFPC; power rankings with named classes (for example "Thanos") | Free | Both | seen + review | [App Store](https://apps.apple.com/us/app/id6799588005), [Reddit](https://reddit.com/r/DynastyNerds/comments/1w9l40j/flock_fantasy_dynasty_rankings/) |
| Consensus ADP | "Cross-platform ADP for every platform we support" (CBS, ESPN, FFPC, Sleeper, Underdog, Yahoo) | Account required | Web | bundle + seen | [platforms JSON](https://api.flockfantasy.com/drafts/platforms), [platform-rankings](https://flockfantasy.com/platform-rankings) |
| Draft Sheets | Draft sheet from your league's scoring and roster, compared against live ADP | Season Pass or member | Both | seen | [App Store](https://apps.apple.com/us/app/id6799588005), [draft-sheets](https://flockfantasy.com/draft-sheets) |
| Draft Overlay extension | Chrome overlay that puts the sheet into Sleeper and Underdog draft rooms | Paid | Web | bundle + review | [Reddit (extension unavailable)](https://reddit.com/r/Fantasy_Football/comments/1vurgs1/) |
| Mock drafts with other users | Queue into dynasty startup mocks with other "flockers" (about a 3-minute wait) | Account required | Web | seen + bundle | [formats JSON](https://api.flockfantasy.com/drafts/formats/summaries), [draft](https://flockfantasy.com/draft) |
| Best Ball Tool | Underdog portfolio sync, exposure, draft grades, live draft tools | $49/yr add-on | Web | seen + bundle | [products](https://api.flockfantasy.com/subscriptions/products), [best-ball](https://flockfantasy.com/best-ball) |
| Start/Sit | Compares two or more players on stats and rankings | Free | Both | bundle | [start-sit](https://flockfantasy.com/start-sit) |
| Player comparison and range of outcomes | Season-over-season compare; ceiling and floor rather than one projection | Free | Both | seen | [App Store](https://apps.apple.com/us/app/id6799588005), [comparison](https://flockfantasy.com/comparison) |
| Waiver wire | ROS pickups for a synced redraft league ("Dynasty and best ball are not supported") | Account required | Web | bundle | [waiver-wire](https://flockfantasy.com/waiver-wire) |
| Strength of schedule | Fantasy points each defense allows to each position | Account required | Web | bundle | [SOS](https://flockfantasy.com/strength-of-schedule) |
| Prospects | Rookie profiles and grades (athleticism, size, target competition) | Prospect tool entitlement | Both | seen + bundle | [rookies JSON](https://api.flockfantasy.com/rookies), [prospects](https://flockfantasy.com/prospects) |
| Player research | Game logs, season and career stats, ranking history | Free | Both | seen | [App Store](https://apps.apple.com/us/app/id6799588005) |
| Premium posts and draft guides | Articles, databases, yearly guides | Paid | Both | seen | [products](https://api.flockfantasy.com/products) |
| Paid expert Q&A marketplace | Trade question $5, start/sit question $5, Super Chat $5, team review $79, best-ball portfolio review $79, voucher bundles | À la carte | Web | seen | [store](https://api.flockfantasy.com/store/products) |
| Discord | Members-only Flock Discord with roles synced from the subscription | Paid | Discord | seen + bundle | [products](https://api.flockfantasy.com/products) |
| YouTube, livestreams, "Flock League" show | Nightly Q&A streams; a creator league run as a show | Free | YouTube | review | [AMA](https://reddit.com/r/fantasyfootball/comments/1me71dl/flock_fantasy_ama/) |
| Stream overlays | 16:9 broadcast graphics for matchups, trades, waivers, standings | Creator tool | Web | bundle | bundle |
| Mobile app | Launched Aug 28, 2026; v1.21 Oct 1 | Free with IAP ($9.99 to $89.99) | iOS, Android | seen | [App Store](https://apps.apple.com/us/app/id6799588005), [Google Play](https://play.google.com/store/apps/details?id=com.flockfantasy.mobile) |

**Formats sweep.**
- *FantasyPros* covers dynasty, keeper, best ball, IDP, superflex, auction/salary cap and DFS ([plans](https://www.fantasypros.com/premium/plans/), the ranking pages above).
- *Flock* covers redraft, dynasty, weekly, best ball and prospects ([site-settings](https://api.flockfantasy.com/site-settings)), with Superflex and TE premium as settings. I found no auction values, no keeper tooling and no IDP rankings in its bundle; IDP appears only as roster-slot names in the MFL import (bundle).

**Data sources.**
- *FantasyPros:* consensus of 100+ experts ([ECR help](https://support.fantasypros.com/hc/en-us/articles/115001219327-What-is-ECR-Expert-Consensus-Rankings-and-how-do-you-calculate-it)), ADP from five hosts ([ADP](https://www.fantasypros.com/nfl/adp/ppr-overall.php)), and unnamed consensus projections ([projections](https://www.fantasypros.com/nfl/projections/qb.php)).
- *Flock:* its own creators' boards plus community submissions. No public trade database ([StatChasers](https://statchasers.com/dynasty-command/help/market-flock-fantasy)). Each player row carries FantasyCalc and Underdog IDs ([redraft JSON](https://api.flockfantasy.com/rankings?format=redraft)). No projection feed appeared anywhere I looked.

---

## 2. Merged burndown

"Commish today" comes from the repo:
- [`docs/design/2026-09-10-sideline-migration-inventory.md`](/Users/jh/code/fantasy/docs/design/2026-09-10-sideline-migration-inventory.md) and the specs under `docs/superpowers/specs/`.
- `src/draft-hq/board` (PPR, Half and Std boards; ADP read as whole picks), `src/draft-hq/sheet` (notes, tags, CSV).
- `src/projections/decide/survival.ts`, `src/app/app/(shell)/teams/page.tsx` (clubs index), `src/trades/fairness.ts`, `src/db/schema.ts` (`draft_format` snake | auction).
- `/app/draft/{adp,assistant,playbook,simulator}`, which now redirect to the board (2026-09-12).

Commish is its own league host, so "sync from another host" has no direct analogue. FP = FantasyPros.

| Feature | FantasyPros | Flock | Commish today |
|---|---|---|---|
| Redraft rankings board | Free (ECR) | Free (Expert Average) | **has**: our own model, a board per scoring format with points over replacement and tiers |
| Per-source view (pick experts / per-creator boards) | Free | Paid | none |
| Superflex board | Free | Free | none on the board; superflex is a league roster toggle |
| Dynasty rankings | Free | Free average, paid creators | none |
| Rookie / prospect board and grades | Free ranks | Entitlement | none |
| Best ball rankings and ADP | Free | $49/yr add-on | none |
| IDP rankings | Free board, MVP advice | none | none |
| Auction values | Free calc, MVP custom | none | partial: auction is a schema draft format; no dollar values published |
| Projections | Free consensus | none (range of outcomes instead) | **has**: our own model |
| ADP | Free composite of 5 hosts | Account, 6 platforms | partial: ADP sentences on the board; the ADP page now redirects |
| Accuracy scoring of sources | Free | none | none |
| Player pages with prose | Notes and news | Stats and outcome charts | **has**: grounded LLM prose |
| Player comparison / range of outcomes | WSIS free, 4-way PRO | Free | none |
| Search | Free | Free | **has** |
| NFL team pages / SOS | Reports | Account | partial: clubs index and club pages; no SOS view verified |
| Mock drafts vs bots | Free, extras PRO | none | **has**: batched bot reveals |
| Mock drafts vs humans | Removed from the app in 2026 (reviews) | Free queue | partial: real drafts in house leagues, no casual human mock queue |
| Pick predictor / survival odds | PRO | none | **has**: the draft advisor's survival odds |
| Draft assistant in your live draft | MVP live sync to external hosts | Overlay extension, paid | **has**: inside Commish drafts only |
| Draft strategies | MVP | none | none |
| Post-draft grade / analysis | PRO | Best-ball draft grades | partial: draft finale spec exists (`2026-09-04-draft-finale-design.md`), not verified as a grade |
| Cheat sheet creator (rank, tier, tag, notes) | PRO | Draft Sheets (paid) | **has**: notes, tags, drag, CSV |
| Keeper support | MVP | none | none |
| League sync from other hosts | Free 1, paid more | Free | none (by design) |
| Start/sit tool | Free WSIS, PRO assistant | Free | partial: lineup editor in our own leagues |
| Auto-set lineup | MVP | none | none |
| Waiver advice | PRO/MVP, HOF planner | Account (redraft only) | partial: wire and claims in our leagues, no recommender |
| Trade analyzer / calculator | PRO | Free limited, paid unlimited | partial: platform fairness detector in-league, not a user-facing calculator |
| Trade finder / real-trade database | PRO finder, market values | Free | none |
| League power rankings | PRO | Free | none |
| AI chat assistant | HOF (Coach AI) | none | none (prose, not chat) |
| Browser extension | PRO | Paid overlay | none |
| DFS tools | HOF | none | none |
| Data API | HOF | none | none |
| Articles, podcasts, video | Free, some paid | Free YouTube, paid posts | none |
| Community (Discord, chat) | none | Paid Discord | partial: league chat and reactions inside leagues |
| Paid human advice | none | $5 to $79 à la carte | none |
| Native mobile app | Yes | Yes (since Aug 2026) | none (web) |

---

## 3. Pricing

**FantasyPros.** Free tier, then PRO, MVP and HOF ([plans](https://www.fantasypros.com/premium/plans/)):

| Tier | Annual (per mo) | 6-month (per mo) | Monthly | Leagues |
|---|---|---|---|---|
| PRO | $3.99 | $5.99 | $11.99 | 2 per sport |
| MVP | $5.99 | $8.99 | $16.99 | 10 |
| HOF | $8.99 | $11.99 | $22.99 | 50 |

- **Annual totals:** the App Store IAP list shows $47.99, $71.99 and $107.99, with 6-month equivalents of $35.99, $53.99 and $71.99 ([App Store](https://apps.apple.com/us/app/fantasypros-fantasy-advice/id1141119371)).
- **Trial:** 3-day free trial on every tier, for new customers only. A betting add-on is +$6.99/mo.
- **Bundling:** every plan covers NFL, MLB and NBA.
- **Promotions:** "Get up to 6 Months FREE" for depositing and playing a first contest at partner sportsbooks or prediction markets, worth "$70 or more" ([plans](https://www.fantasypros.com/premium/plans/)). Reddit users describe a $1 bet that unlocked the top tier ([thread](https://reddit.com/r/fantasyfootball/comments/1v8a0d0/best_paid_fantasy_football_subscription/p04b64e/)).
- **Refunds:** 6- and 12-month web plans are refundable within 30 days; monthly plans are not. Using the Draft Assistant more than once can void the refund ([refund policy](https://support.fantasypros.com/hc/en-us/articles/115001318267-What-is-your-premium-subscription-refund-policy)).
- **Pausing:** monthly web plans can be paused; annual plans cannot ([pause](https://support.fantasypros.com/hc/en-us/articles/360001178493-How-do-I-pause-my-subscription)).
- **Team or league pricing:** none. Price scales only by how many leagues one user manages.
- **What they sell on:** league count, live draft sync, auto-pilot lineups, "Waiver/Trade Suggestions", and lately Coach AI and Waiver Planner (both labeled NEW on HOF). The page claims 500,000+ customers ([plans](https://www.fantasypros.com/premium/plans/)).
- **What reviewers say moves them:** draft day and multi-league management. Reddit advice for draft day is "use the 3 day free trial for the draft then cancel" ([thread](https://reddit.com/r/fantasyfootball/comments/1w8srak/best_app_to_use_during_live_draft_to_cross/p84zfgo/)). One App Store reviewer credits auto-swap with saving a week ([App Store](https://apps.apple.com/us/app/fantasypros-fantasy-advice/id1141119371)).

**Flock Fantasy** (all from the public catalog its subscribe page loads):

| Product | List | Current price | Billing |
|---|---|---|---|
| Mother Flocker, monthly | $34.29 | $24.00 | monthly |
| Mother Flocker, annual | $139 | $97.30 | yearly, charged up front |
| Season Pass (2026 redraft) | $49 | $34.30 | through Jan 1, 2027 |
| Best Ball Tool | $49 | $49 | yearly add-on |
| Flocker (lower tier) | $19/mo, $119/yr | not on the current subscribe list | catalog only |

Sources: [subscription products](https://api.flockfantasy.com/subscriptions/products), [Stripe catalog](https://api.flockfantasy.com/products).

- **Promo variants:** the bundle carries creator-specific versions of the tier lists (FLOCK, UNDERDOG, DOMAIN, FSE, LAND). Annual plans add "Free team review & trade Q&A". Mother Flocker adds the best-ball suite and a "Team breakdown from Mason" (bundle).
- **Trial:** the subscribe button reads "7-Day Trial" (bundle), but the Stripe trial product's statement descriptor says "2-Day Free Trial" ([catalog](https://api.flockfantasy.com/products)). I could not see which one is live without signing up.
- **À la carte:** $5 questions and $79 reviews, with vouchers ([store](https://api.flockfantasy.com/store/products)).
- **Team or league pricing:** none found.
- **What moves people to pay:** the "Join the Flock" card lists unlimited trade calculator use, premium posts and databases, expert plus community rankings, the Discord and discounts (bundle). Redditors cite the $34 season pass for the draft assistant ([thread](https://reddit.com/r/fantasyfootball/comments/1vhjdkw/best_paywalled_draft_assistance/p25peox/)). One buyer paid only for the draft overlay ([thread](https://reddit.com/r/Fantasy_Football/comments/1vurgs1/)).

**The sharp pricing contrast:**
- *FantasyPros* sells tools by tier, gates them by league count, and pushes annual hard (60% off monthly).
- *Flock* sells access to people (creator boards, Discord, the founder's breakdown, paid Q&A). It discounts about 30% off list and offers a seasonal pass that FantasyPros does not. One App Store reviewer asked FantasyPros for exactly that ([review feed](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1141119371/sortby=mostrecent/json), "Overpriced for sure!", 2026-09-15).

---

## 4. What reviewers complain about

### FantasyPros

**Ratings snapshot:**
- iOS: 4.8 from 89K ratings ([App Store](https://apps.apple.com/us/app/fantasypros-fantasy-advice/id1141119371)).
- Android main app: 4.54 from 31.6K reviews, 500K+ downloads ([Google Play](https://play.google.com/store/apps/details?id=com.fantasypros.myplaybook)).
- Android Draft Wizard: 4.62 from 14.5K ([Google Play](https://play.google.com/store/apps/details?id=com.fantasypros.draftwizard.football)).
- Trustpilot: 2.5 from 4 reviews ([Trustpilot](https://es.trustpilot.com/review/www.fantasypros.com)).

The recent sample is far harsher than the aggregate. The App Store public feed returned the 450 most recent US reviews (Nov 2023 to Oct 2026): **235 are 1 or 2 stars**, 138 are 5 stars, and the volume spikes in Aug to Oct 2025 when the app was redesigned ([feed](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1141119371/sortby=mostrecent/json)). I keyword-coded the 235 negatives; themes overlap.

| Theme | Count | Typical complaint |
|---|---|---|
| Redesign and app merge regressions | 72 | My Playbook and Draft Wizard were merged; "Who Should I Start" lost; live mocks removed ("Took away live mocks", 2026-08-17); screens blank |
| Billing, price, paywall, cancel | 72 | Charged again after believing they had cancelled; must pay for features that used to be free; the trial needs a card up front |
| Advice quality | 68 | "Following its advice" lost games; stale weekly rankings ("It's week 4", the app still shows week 2) |
| Bugs, crashes, slowness, stale data | 54 | Freezes in the draft analyzer, waiver assistant broken |
| League sync and scoring mismatch | 24 | Advice given for Standard in a PPR league; Yahoo or Fantrax imports fail |
| Navigation | 19 | "Auto Lineup is difficult to find" |
| Dynasty and format support | 12 | "Treats every format like the same 12-team redraft"; no dynasty pick trades |
| Ads, upsell, betting pop-ups | 10 | Ads between ranking rows; BettingPros pop-ups interrupt articles |
| Sign-in | 5 | Repeated logins; verification loops |

**Reddit (PullPush archive):**
- 41 comments since mid-2023 combine FantasyPros with cost or cancel language, mostly "trial then cancel" or "not worth it".
- One September 2026 thread argues 98% of 150 experts started a receiver whose team was down to its third QB ([thread](https://reddit.com/r/fantasyfootball/comments/1wmfef3/fantasypros_has_lost_their_credibility_imo/)). This is the consensus-lag critique.
- Older threads report the draft assistant mishandling keepers and auction inflation ([2023](https://reddit.com/r/fantasyfootball/comments/1602zt7/with_the_busiest_draft_weekend_coming_up_whats_an/jxn4z8d/), [2023](https://reddit.com/r/fantasyfootball/comments/15wfh0b/why_are_fantasypros_numbers_so_different/jx5sx26/)).

### Flock Fantasy

**Ratings snapshot:**
- iOS: 4.8 from 193 ratings ([App Store](https://apps.apple.com/us/app/id6799588005)).
- Android: 4.94 from 61 reviews, 5K+ downloads ([Google Play](https://play.google.com/store/apps/details?id=com.flockfantasy.mobile)).

The App Store feed held 76 reviews: 69 five-star, 3 four-star, 4 one-star ([feed](https://itunes.apple.com/us/rss/customerreviews/page=1/id=6799588005/sortby=mostrecent/json)). The volume is small and young, and one 1-star reviewer suspects "fans helping him out".

| Theme | Count | Source |
|---|---|---|
| Account creation or sign-in failures | 3 of 4 one-stars | [feed](https://itunes.apple.com/us/rss/customerreviews/page=1/id=6799588005/sortby=mostrecent/json) |
| Trade calculator bugs (searches the wrong roster, verdict reads backwards, one player's value badly off) | 1 iOS, 2 Android | feed; [Google Play](https://play.google.com/store/apps/details?id=com.flockfantasy.mobile) |
| Missing pieces (weekly rankings not in the app, no pre-draft star or highlight, portfolio locked to Expert Average) | 3 | same |
| "No real value", stale, paid when free apps exist | 1 | feed |

**Reddit:** 142 football-subreddit mentions in the archive, dominated by recommendations of the trade calculator over crowdsourced ones ("Stop using KTC", for example [here](https://reddit.com/r/SleeperApp/comments/1slcx9y/ktc_has_this_an_even_trade_thoughts/og5rqhx/)). Complaints group as follows:
- **Values are their own creators' opinions.** "Uses the 'experts' values" ([thread](https://reddit.com/r/FantasyFootballers/comments/1wuoe0x/i_traded_away_ceedee_lamb_some_league_mates_think/pd83slj/)). Calculators disagree with each other ([thread](https://reddit.com/r/DynastyFFTradeAdvice/comments/1w5qn8b/)). Stars are said to be undervalued ([thread](https://reddit.com/r/DynastyFFTradeAdvice/comments/1wnpfap/do_i_take_this_trade_or_is_it_a_sideways_move/pbgtcy8/)). About 5 threads.
- **Personality-driven.** About 6 comments dismiss the founder's takes or call the brand entertainment rather than expertise ([thread](https://reddit.com/r/fantasyfootballadvice/comments/1widx61/mason_from_flock_fantasy_says_we_should_sell_high/paa7xw3/)).
- **The paid draft overlay was unavailable on the Chrome Web Store** for a season-pass buyer ([thread](https://reddit.com/r/Fantasy_Football/comments/1vurgs1/)).
- **Shallow tooling.** A tool roundup rated Flock 7.8/10 for "Lack of Depth with tools" ([thread](https://reddit.com/r/DynastyFF/comments/1tor57l/)).

---

## 5. What neither does, from the user's chair

These are observations, not proposals.

- **Neither says why a rank is where it is.**
  - FantasyPros shows a consensus number and the spread of expert ranks, but one reviewer complained it "flattened" matchups and roster construction into "where our experts ranked him" ([feed](https://itunes.apple.com/us/rss/customerreviews/page=1/id=1141119371/sortby=mostrecent/json), 2026-09-22).
  - Flock shows an average of named creators and points users to video for the reasoning.
- **Neither publishes a projection with its basis.**
  - FantasyPros' projections are a consensus of unnamed sites ([projections](https://www.fantasypros.com/nfl/projections/qb.php)).
  - Flock offers a ceiling and floor but no point projection ([App Store](https://apps.apple.com/us/app/id6799588005)).
- **Consensus lags news.**
  - FantasyPros' weekly pool needs submissions from the last 2 to 3 days ([ECR help](https://support.fantasypros.com/hc/en-us/articles/115001219327-What-is-ECR-Expert-Consensus-Rankings-and-how-do-you-calculate-it)), and users notice when a late development is missed ([thread](https://reddit.com/r/fantasyfootball/comments/1wmfef3/fantasypros_has_lost_their_credibility_imo/)).
  - Flock's boards are only as fresh as each creator's last edit; timestamps in the public JSON range over six days ([redraft JSON](https://api.flockfantasy.com/rankings?format=redraft)).
- **Format support is uneven.**
  - FantasyPros advice is reported as generic redraft in dynasty leagues and mishandles return-yard scoring in mocks ([App Store reviews](https://apps.apple.com/us/app/fantasypros-fantasy-advice/id1141119371?see-all=reviews&platform=iphone)).
  - Flock's waiver tool says outright "Dynasty and best ball are not supported" (bundle), and it has no auction, keeper or IDP tooling.
- **Neither is a league host.** Every tool lives one hop away from the draft and the lineup: extensions, overlays, syncs. The sync breakages (ESPN needs Chrome on the web, a missing extension, scoring that does not import) are the most concrete complaints.
- **Neither prices for a season or a league in a clean way.** FantasyPros has no seasonal plan, and a reviewer asked for one. Flock has a seasonal pass for redraft only. Neither offers a commissioner or whole-league plan.
- **Mobile parity is unfinished for both.** FantasyPros' 2025 merge removed features users relied on. Flock's app launched in August 2026 without weekly rankings.

---

## Sources not reachable

- The FantasyPros `/nfl/start/` page and the ECR FAQ path returned empty or 404 to a plain fetch.
- Reddit's own API blocked requests, so Reddit evidence comes from the PullPush archive and is a sample, not a census.
- Flock's subscribe page and Chrome extension listing render only in a browser; their claims here rest on the public JSON and the shipped bundle.
