# Game Types & Lobby Strategy — Competitive Analysis and Positioning

**Prepared:** August 20, 2026
**Scope:** What contest formats and lobby mechanics the real-money fantasy football field actually runs, where the structural gaps are, and a sequenced recommendation for Commish's league-type and lobby strategy. Extends `2026-08-16-beating-apex-strategy.md` (which tore down Apex structurally but never mapped the contest catalogs). Full per-operator findings with source URLs: `sources/research-ffpc-nffc.md`, `sources/research-bestball-lobbies.md`, `sources/research-apex-sleeper-formats.md`.

---

## 1. The market runs exactly three lobby models

Every operator researched uses one or more of these; nobody has a fourth.

**Model A — Scheduled flagship + satellites (FFPC, NFFC, Apex).** Drafts happen at fixed calendar slots; users buy a seat in a specific dated draft. Prizes stack in two layers: your league's payout plus a national overall pool across all leagues in the contest (FFPC Main Event: $2,200 entry, $1M grand prize over a $6.57M pool; NFFC Primetime: $1,800 entry, $300K overall). The two-layer prize is the engagement engine — a 2-6 team in your league still has an overall-pool sweat. NFFC's signature lobby mechanic is the **Kentucky Derby System**: managers rank their preferred draft slots 1-N before the draw, and the randomizer gives each drawn manager their best still-available preference.

**Model B — Instant sit-and-go pods (Underdog, Drafters, DK Best Ball; FFPC and NFFC run parallel versions).** A pod fires the moment the Nth entrant joins — no calendar, no waiting room culture, 30-second picks (FFPC/NFFC sit-and-gos too), anonymous opponents, randomized order at fill. Liquidity comes from massive parallel pod counts — Best Ball Mania VII ran 56,028 concurrent 12-person pods — but that liquidity is manufactured by **multi-entry up to 150 entries per user**. The same power users seed thousands of pods.

**Model C — Filter-and-browse open leagues (Apex's public fill; our current build).** Browse open leagues filtered by stake, game mode, and skill level; pick a league; take a seat; draft happens at its scheduled slot. Transparent (you see fill status before committing) but illiquid by comparison — a league sits partially filled until 12 humans commit.

**The structural fact that shapes everything:** the operators with modern lobby UX (Model B) run **zero managed-roster products** — no waivers, no trades, no lineups, ever. The operators with real season-long managed leagues (Model A/C) run on 2005-era UX (FFPC/NFFC) or rented MFL infrastructure (Apex). Nobody has combined them. That's the position.

## 2. Game-type taxonomy — what exists, who runs it

The catalogs decompose onto six axes. Support for an axis value is a config decision in our engine, not a new product, which is the advantage of owning the engine.

| Axis | Values in the wild | Who runs what |
|---|---|---|
| Draft mechanism | Snake, auction, linear, 3rd-round-reversal; fast (30-90s) vs slow (1hr-8hr) | Snake universal. Auction: FFPC ($200/20 players, 20s nominations), NFFC (same shape), Apex (outsourced to ESPN.com), Sleeper (free). NFFC balances snake with 3RR. |
| Roster shape | Standard, superflex, TE-premium, deep/2-flex, no-K/DEF | FFPC made TE-premium its house identity ("FFPC scoring" is a market term). Superflex growing everywhere. Apex: Deep and Dynamic variants. |
| Scoring | Full/half/standard PPR, custom weights, IDP | Apex: full PPR only, no options. Half-PPR is the trend consensus (Underdog's tournament default). Sleeper: fully fractional custom + IDP. |
| Season structure | H2H+playoffs, total points, Victory Points, league-average double game, best ball, elimination, playoff-only | Apex's signature: every team plays the random H2H opponent AND the league average each week, in every format. Sleeper offers that median-game toggle free. NFFC Cutline, Drafters season-cumulative: no-playoff structures that dodge Week 15-17 variance. |
| Elimination mechanics | Guillotine, Terminator (FFPC), Eliminator (NFFC/Underdog), survivor hybrids | FFPC Terminator punishes inaction (you must self-drop a player weekly or the whole team dies). NFFC Eliminator auto-cuts the lowest scorer weekly. Guillotine (~18 teams, cut weekly, dropped rosters hit waivers) is a growing culture format with essentially **no real-money operator at scale** — one small dedicated site, otherwise free hosts + Venmo. |
| Continuity | Redraft, keeper, dynasty, empire, orphan markets | FFPC dynasty $100-$5,000 with a real **orphan-team resale market** (a $77 orphan-only tier) and Empire progressive jackpots. Apex dynasty is a large catalog category. Underdog has none. |

Clock details worth copying exactly: FFPC slow drafts run 2hr or 6hr per pick with a 2-8am ET overnight pause (timer frozen, picks still allowed); Underdog's auto-tightening ladder is 8h → 4h (two weeks out) → 1h (one week out) → 10min (day of) → 60s (2 hours before kickoff), with a 2-5am pause that drops away once tightened. NFFC's timeout is forgiving — a timed-out manager is *skipped*, not auto-picked, and gets a fresh minute on their next turn. **Our engine already ships the Underdog-shaped ladder (8h → 4h → 1h → 10m → 90s keyed to kickoff).** It does not yet have an overnight pause.

## 3. The stake-band map — where the money actually is

- **LeagueSafe (the settle-up escrow for bring-your-own leagues):** $31.5M+ in entry fees, 56,000+ leagues, average buy-in **$55**, and **79% of leagues at $25/$50/$100**. Zero rake — it passes through processing fees only.
- **Apex:** entry floor $72.95 (Amateur) to $1,002.95 (Hall of Fame); computed payouts run **73% → 88%** across tiers (the 90-98% figure in the older strategy doc came from an unreliable secondary source — correct it when that doc is next revised).
- **FFPC/NFFC:** $35 satellites up to $20,000 elite private leagues; the volume products are $350 (NFFC Online Championship) and $2,200 (FFPC Main Event).
- **Underdog:** $25 tournament entry with $15M pools — the mass-market price point at massive scale, but best ball only.

The picture: the **$25-$100 managed-league player is the largest population and is served by nobody**. Below Apex's floor, above free hosts' capability. They play on Sleeper/ESPN for free and settle on Venmo/LeagueSafe precisely because no operator hosts a managed money league at their stake. Apex's floor prices them out; FFPC/NFFC's culture intimidates them; Underdog doesn't run their game type.

## 4. Positioning — the wedge, stated precisely

**Commish is the platform where a real managed season-long money league gets Underdog-grade draft UX and platform-owned trust.** Three claims nobody in the field can currently combine:

1. **The game type the modern operators abandoned.** Underdog/Drafters/DK proved the lobby UX bar but only for zero-management products. Managed rosters — waivers, trades, lineups, rivalries — are the actual game people play with friends. We run it natively.
2. **The lobby UX the managed operators never built.** Instant sit-and-go fill, auto-tightening slow drafts, filterable browse, draft-slot preference — against FFPC/NFFC's dated stack and Apex's rented MFL one.
3. **Trust owned by the platform, visible in-product.** Escrow transparency, audit trail, integrity detection, operator dispute resolution (Phase 3, in build now) — versus stranger-commissioners (Apex) and manual staffing (Apex's human draft moderators for two rounds only).

### 4.1 The liquidity problem, solved differently than best ball

Multi-entry cannot create our liquidity (one real team per user in a managed league — 150-entry whales don't exist here). Managed-league liquidity comes from **concentration and scheduling**, and this is the deepest strategic lesson in the research:

- **A canonical launch format, deliberately narrow.** Apex fills 1,000+ leagues/year partly *because* everything is 12-team full-PPR — every joiner is compatible with every open seat. Fragmenting launch liquidity across ten formats would strand seats. Launch with one canonical public family and put variety in *toggles that don't fragment the pool* (scoring preset, median-game on/off) rather than in separate queues.
- **Hybrid lobby: browse + fill-meter + scheduled slots + sit-and-go.** Keep the transparent filter-and-browse (built), add visible fill progress, add a scheduled draft calendar (pick a league whose draft time fits your life — the FFPC/Apex model), and run **sit-and-go instant pods for the canonical format only**, where the fill population is deepest.
- **The AI draft moderator is a liquidity feature, not just a cost feature.** Apex's live human moderator caps how many concurrent public drafts they can run per night. Ours doesn't. Unlimited concurrent staffed drafts is what lets sit-and-go pods fire all evening during draft season.
- **Mock drafts as the free liquidity funnel** (every Model B operator does this; Sleeper's mocks are link-share only — a public mock lobby is an open gap).

### 4.2 League-type strategy, sequenced

**Launch canon (Phases 3-4 scope):**
- 12-team snake, H2H + playoffs, half-PPR default with PPR / TE-premium / superflex toggles (all four presets already in the engine; superflex is a slot-config addition).
- **The league-median double game as a standard toggle.** It's Apex's one genuine product idea (halves schedule luck), Sleeper gives it away free, and our scoring engine already computes every team's weekly score — deriving the median is trivial. Adopting it neutralizes Apex's signature differentiator at near-zero cost.
- **Native live auction as the premium flagship.** Apex literally outsources auctions to ESPN.com; FFPC/NFFC treat auction as a small live-event niche. A first-class auction room (already built: our engine runs auction natively) is the loudest possible "we own our stack" proof.
- Stake tiers **$25 / $50 / $100 / $250** — undercutting Apex's $72.95 floor and sitting exactly on LeagueSafe's 79% mass. Higher tiers ($500+) follow once public-league integrity has a season of history.
- Experience-tier segregation stays on (built; also the TN/MS regulatory direction).

**Private leagues as the Trojan horse (Phase 4, with payments):** host the bring-your-own-league group — their rules, our escrow, near-zero rake at low stakes — as a LeagueSafe replacement that happens to include the best league product. This is where the commissioner-bounty acquisition lever attaches, and it feeds the public lobby (a friend-league member who wants a second, higher-stakes league is the public lobby's exact customer — the use case Apex's public fill already proves).

**Fast follow (post-launch season 1):**
- **Real-money guillotine.** Growing culture format, near-zero operator competition, and structurally social (weekly cuts, waiver frenzies on released rosters, chat energy) — it plays directly to our social layer. Needs waiver-engine depth (FAAB storms when a cut roster releases 18 players) but no new draft mechanics.
- **Best ball** as a liquidity/acquisition product, not the identity: the engine change is small (a scoring fold that auto-selects the best lineup; the config already documents best ball as deliberately deferred). Enter at $10-$25 sit-and-gos as a funnel into managed leagues; do not chase Underdog's $15M tournament pools.
- **Two-layer prizes** (league payout + overall pool across same-format public leagues) once Phase 4's payout-structure domain exists — the high-stakes hosts prove it's the retention engine for public play.

**Later (Phase 9 per roadmap):** dynasty and keeper depth — startup drafts, rookie drafts, orphan-team marketplace (FFPC proves orphans are a real secondary market), empire-style progressive jackpots. Highest-LTV segment, but it demands multi-season trust; earn it first.

**Explicitly out:** single-stat pick'em (the legally hostile category — already ruled out), vampire leagues (zero demand evidence), and DFS-style salary-cap season-long (NFFC's version is niche; it's a different product's DNA).

### 4.3 Lobby and draft-room roadmap implications (concrete build items this analysis surfaces)

1. **Draft date/time as a domain concept** — already a ledgered product gap; this analysis makes it load-bearing for the entire Model A/C lobby (scheduled slots, fill-by dates, clock-ladder anchoring). Should be scheduled into the next product-phase plan.
2. **Payout structure as a domain concept** — the second ledgered gap; prerequisite for stake tiers becoming real (Phase 4) and for two-layer prizes.
3. **Sit-and-go fill trigger** — fire the draft when the Nth member joins the canonical-format queue; the draft engine and admit flow exist, the trigger and its waiting-room UX don't.
4. **Overnight pause for slow drafts** — FFPC/Underdog both pause roughly 2-5am ET; our clock ladder doesn't pause yet. Small, high-empathy feature for the slow-draft niche.
5. **Draft-slot preference (KDS-style)** — rank preferred slots before the randomizer runs; beloved NFFC mechanic, cheap against our existing draft-order flow, and a visible "built by people who play" signal.
6. **Skip-and-return timeouts for live drafts** — NFFC's forgiving model (skip, fresh clock next turn) blended with our queue/autodraft; punitive instant-autopick is the single most-complained-about draft-room behavior on legacy hosts.
7. **Median-game scoring toggle** — see 4.2; near-free differentiator neutralization.
8. **Superflex slot config** — unlock the growing format with a config row, no engine work.

## 5. What this changes about existing plans

- The Phase 3 overview's integrity work (in build) is *load-bearing for the lobby strategy*: public-league trust is the precondition for every public-fill claim above. No change, but the positioning now depends on it explicitly.
- Phase 4 (payments) should treat **payout-structure modeling** and **private-league escrow hosting** as first-class scope, not add-ons — the Trojan-horse strategy runs through it.
- The roadmap's Phase 9 (dynasty/keeper) gains the orphan-marketplace and empire-jackpot concepts from FFPC's proven catalog.
- The 2026-08-16 strategy doc's Apex payout claim (90-98% at higher tiers) is contradicted by primary-source arithmetic (73-88%) and should be corrected on next revision.

---

*Sources: full findings with URLs in `docs/research/sources/` (three files). Research date: 2026-08-20. Key primary sources: myffpc.com contest pages and rules, nfc.shgn.com contest listings and KDS rules, underdogfantasy.com/drafters.com lobby and rules pages, apexfantasyleagues.com format and pricing pages, Sleeper support docs, LeagueSafe/SharpLink public filings and site claims.*
