# Journey review: the veteran

**Date** 2026-08-27
**Persona** "Deshawn", 41. Twelve seasons. Plays ESPN and Sleeper, runs money leagues on FFPC. Evaluating whether to move a money league to Commish. Fast, skeptical, allergic to marketing. Judges a platform by its draft room and its rules page.
**Build** `worktree-ive-campaign` @ `localhost:3102`, 1680x1000, dark, Playwright/Chromium.
**Scope** Journey, navigation, trust. Not a screen-by-screen design review — six of those already exist in `docs/research/2026-08-2*`.

---

## Method

Signed out first, then signed in as `manager-a` (Commish Lab, established identity, seeded leagues with a real season through week 14).

Click path, in order:

1. `/` — landing, signed out. Read the hero, the ticker, the open-leagues table. Opened the ⓘ on "Half PPR".
2. `/league-rules` ("How it works" in the nav) — the rules page. This is the page he opens second on any platform.
3. `/reviews` — what other managers say.
4. `/support` — what happens when something goes wrong with money.
5. `/legal/terms`, `/legal/privacy` — who is on the hook.
6. `/browse` — the full catalog.
7. Sign in (storage state `e2e/.auth/manager-a.json`) → `/app`.
8. `/app/leagues/dev_league_season` — a real league, week 14, 8-5-1, #2 seed.
9. `/app/leagues/dev_league_season/matchups/14` — the scoreboard.
10. `/app/leagues/dev_league_season/trades` → opened the trade builder.
11. `/app/leagues/dev_league_season/activity` — the audit trail.
12. `/app/drafts/dev_draft_season` — that league's draft board.
13. `/app/mock-drafts` — the mock lobby. Started two solo mocks, queued players, drafted, read a completed mock's results page.
14. `/app/wallet`, `/app/profile` — the money and the identity.
15. `/join/house_beginner_12_4/hold` and `/join/dev_public_sunday_snake/hold` — the commitment point.

Screenshots: `scratchpad/shots/b01`–`b27`.

**Side effect worth flagging up front.** Step 15 seated me in "Sunday Regulars" as seat 9 of 12. I did not click a confirm button, because there isn't one — navigating to the `/join/{code}/hold` URL claimed the seat outright and redirected me to the league. There is no way to leave. This is finding V-02 and it is also the reason a read-only walk could not stay read-only.

---

## The walk

### Signed out: the storefront

The hero is good. "Real leagues. Real seats. Drafting this week." is a claim, not a mood, and the "Backyard Brawl / Saturday 29 August / 2 of 8 open" card next to it is the proof. He likes that a fantasy site opened with a specific league instead of a stock photo of a football.

Then his eye goes up to the ticker and the whole thing wobbles. Left to right: *A seat was claimed in The Longshot League 5 · 12 minutes ago* … *141 leagues filled this season* … *A seat was claimed in The Longshot League 5 · 12 minutes ago* … *E2E Sit-and-Go 1787847845040 filled* … *A seat was claimed in The Longshot League 5 · 12 minutes ago*. The same event, verbatim, three times in one screen width. He has seen that pattern on every offshore sportsbook. Whether or not the number is real, the presentation is the presentation of a fake. **The one element on the page that is purely decorative is the one that reads as a lie.**

Below it, the open-leagues table is the best thing on the site. Format, draft time, entry, and a seat meter, all in one scannable row, with an ⓘ on every term. He respects that a fantasy platform put "12 teams · Snake · Half PPR" in a monospace row instead of a card grid.

Two problems in that table.

First, half the catalog is engineering debris: `E2E Money Dark 1787678163994`, `E2E Sit-and-Go 1787847668881`, `Mobile360UnbrokenOverlongIdentifierFixture`, `DesignV2 Keyboard Walk League`, `Ive Review Open League`. Seventeen of them on `/browse`, and one of them is in the marquee ticker. This is a shared dev database, and he does not know that. What he sees is a storefront with no gate between the catalog and whatever the build process happens to have created. He would screenshot this and send it to his league chat.

Second, the money. The one number he came for. Entry says **Free** on every row, the footnote says *"Stake tiers are labels only in this preview. No money changes hands,"* and the hero says *"Every league is free this season."* He reads all three and cannot tell whether this is a launch promo, a beta, or a platform that legally cannot take a deposit. He does not find out until much later, on a page he has to sign in to reach.

Nothing on the storefront says what a league pays. Not because the number is hidden — because there is no payout concept anywhere in the product.

The ⓘ on "Half PPR" gives him: *"Half PPR pays half a point for every catch, on top of yards and touchdowns."* That is written for his brother-in-law. He wants the point values: passing TD 4 or 6, yards per point, does the kicker get distance bonuses, is the DEF points-allowed tiered. That page does not exist anywhere in this product, which he confirms twice more later.

Also: the ⓘ popover pushes the format cell to two lines and shoves the button he just clicked halfway down the row. Small, but it is the first thing on the page that feels unfinished.

### `/league-rules` and `/support`: the surprise

This is where the review turns, and it turns *up*.

> "This product does not yet support a waiver wire, a trade deadline, or keeper and dynasty formats. A card or a league page never claims one of those, because a feature this product cannot deliver has no business on a page a stranger reads to decide whether to join."

He reads that twice. No platform he has ever evaluated has written that sentence. `/support` does it again:

> "Some things this platform does not offer yet: a way to contact an operator directly, a way to see the status of a report once you file it, an incident or status page, and an email once something reported gets fixed."

That is the single most credible thing on the site, and it makes the ticker on the homepage look even worse by contrast. **The product is more honest in prose than it is in pixels.**

It also ends his evaluation on the merits. No waiver wire means no season-long league, full stop. A twelve-team money league with frozen rosters from September to December is a draft contest, not a league. He does not need to see the rest to know he is not moving the FFPC money here this year.

He keeps clicking, because the honesty bought him ten more minutes.

`/reviews`: exactly one review. One star. Body text: *"This league ate my roster overnight and nobody ever explained why. Filed at 1787735299359."* A raw epoch timestamp, on the public review feed, on the only review that exists. He is not offended by the one star — "nothing here is filtered by rating" is the right call and he respects it. He is offended by the epoch.

`/legal/terms` is four paragraphs. No entity named, no eligibility, no jurisdiction, no arbitration, no fund handling. For a site he is considering wiring money to, that is not a legal page, that is a note. Consistent with "no money changes hands," but it confirms the conclusion.

### Signed in: `/app`

One unpaginated table of roughly ninety leagues, and a left rail of about a hundred two-letter chips. No search, no filter, no grouping, no pagination. His account is an outlier — a real user has four leagues — but the design has no answer for N at all, and the rail is the primary navigation.

He does find "Fix your lineup" as a per-row action. That is the right instinct: the home board is a to-do list, not a dashboard. Good.

### A real league, week 14

`/app/leagues/dev_league_season`. Header: *8-5-1 · #2 seed · Week 14 · Snake draft*. Green banner: *You won in Week 14! 15.00 to 10.00*. Standings with points for and against, six teams tagged **Clinched**, and a footnote — *"Ties in the standings break on points for. Clinched means a guaranteed playoff spot."* Exactly the density he wants.

Then the details start failing.

The matchup card carries an **In progress** badge, six inches under a banner announcing he won it. Two states for one game on one screen.

The settings card — format, stake, size, scoring, roster shape, draft time, commissioner — is at the *bottom* of the page, below the chat and below his lineup. That card is the first thing he reads on any league he is thinking about. Its contents are good ("1 QB, 2 RB, 2 WR, 1 TE, 1 FLEX, 1 K, 1 DEF, 6 bench" is precise), but it is buried, it has no pick-clock length, no playoff format, no tiebreaker rules beyond the standings footnote, and its scoring field says "PPR" with the same beginner tooltip from the storefront.

The draft line reads *"Saturday 22 August, 4:56 PM UTC (starting now)"* — on a league that is fourteen weeks into its season.

"Stake: Friendly — *a label for how competitive a league is. No money changes hands.*" So on the storefront, where the tiers rendered as **Free**, **Friendly**, and **Competitive** in the badge slot next to an **Entry: Free** column, "Free" was a *competitiveness* label. He read it as a price. So will everyone.

His lineup shows nine starters and the note "Week 14 has started, so its lineup cannot change" — correct. But the six bench players in the settings card appear nowhere. There is no roster page in this product. The only place he ever sees his own bench is inside the trade builder.

### The scoreboard

`/app/leagues/dev_league_season/matchups/14`. This is the moment he closes the tab.

Six matchups, twelve starting lineups, and in every single one **the kicker is the only player with points**:

```
Iron Owls              Neon Norsemen
QB   Josh Allen   0.00  QB   Justin Herbert   0.00
RB   Jahmyr Gibbs 0.00  RB   Bijan Robinson   0.00
RB   Saquon Barkley 0.00 RB  Ashton Jeanty    0.00
...
K    Andre Harris 6.00  K    Kenny Harris    15.00
DEF  Houston      0.00  DEF  LA Chargers      0.00
```

Ja'Marr Chase 0.00. Josh Allen 0.00. Every game in the league decided by the kicker. Whatever the cause — a scoring pipeline that only ingests kicking stats, or seed data that only carries them — the artifact a manager sees is a scoring engine that does not work. There is no message on the page saying "week 14 stats are not final" or "practice data." It renders as fact.

Header on the same page: **Week 14 of 14**. So the six "Clinched — a guaranteed playoff spot" badges point at a postseason that does not exist. No bracket, no playoff weeks, no champion, no title. In a money league, the playoff *is* the payout. It is absent, and the standings page promises it anyway.

### Trades

`/app/leagues/dev_league_season/trades`:

> "Trades complete as soon as both sides agree. There's no review step, for anyone."

`/support`, read forty minutes earlier:

> "A trade the platform flags as uneven is held automatically instead of settling quietly, and it stays held until an operator makes a decision."

Those are opposite answers to the question a money player asks first. "Can two guys in this league hand each other a title?" And the answer he can actually verify — unlimited trades, no deadline, week 14 of 14, no review — is *yes*.

The builder itself is clean: pick a team, up to five players a side, a 280-character note. It shows his full roster including the bench, which is the only place that exists. It tags positions on K and DEF but not on the skill players, so "Jordan Love" and "Chris Godwin Jr." sit in the same undifferentiated list.

`/app/leagues/dev_league_season/activity`: *"Nothing has happened here yet."* In a league with a completed fifteen-round draft and fourteen played weeks. In a money league the transaction ledger is the trust mechanism, and there isn't one.

### The draft room

He clicks "View the draft board" from a league whose page says **Draft complete. Every roster is set.**

It loads `/app/drafts/dev_draft_season`, which says **Not started**, *"The draft starts as soon as the last seat is taken,"* **Starts in 0:00**, a **Connecting…** badge that does not resolve, an entirely empty 15-round board, and all 1,646 players — including the ones on his own roster — sitting available in the pool.

He has now seen the platform report three different states for the same league in three minutes.

So he goes to the mock lobby, which is where this review finds its best material.

`/app/mock-drafts` is the strongest screen in the product. Mode (solo against bots, open lobby, private link), team count, pick clock (30/60/90), scoring preset, roster shape including superflex, draft position, and a one-click **"Start a solo mock now, 12 teams, 60s clock."** That is precisely the configuration surface a veteran wants and it is faster than Sleeper's.

Directly above it: *"4 mocks drafting right now."* Directly below it: *"Open mock drafts — No mock drafts are open right now."* And in the ticker, *"A 8-team mock filled 13 minutes ago,"* three times over, article error included.

He starts one. Bots take Bijan and Gibbs; he is on the clock at 1.03 with 55 seconds.

**The room is genuinely well built.** Position filter chips, a 1,646-player pool with live search, a snake board with the round marker and a pick ticker across the top, his roster slots laid out by position with six bench rows on the right, star-to-queue, and a persistent bottom bar with **"Draft Ja'Marr Chase"** and the queue in order. The bots have archetypes — Zero RB Bot, Contrarian Bot, Committee Back Bot, Sleeper Bot — and they draft like them. That is more thought than most mock tools get.

And then the pool column, with the Draft buttons in it, renders like this:

```
10 RB  Jon…   IND ★ [Draft]
11 WR  Dra…   ATL ★ [Draft]
12 WR  A.J. … NE  ★ [Draft]
13 WR  Ni…    HOU ★ [Draft]
14 RB  Ja…    BUF ★ [Draft]
15 TE  Broc…  LV  ★ [Draft]
16 RB  Cha…   CIN ★ [Draft]
17 WR  Chri…  NO  ☆ [Draft]
```

He cannot read the names. Two adjacent rows say "Ja…". Two say "De…". The Draft button ate the column, and it only does this once it is his turn — which is the only moment it matters. On a sixty-second clock, in a room where money is on the line, a pool you cannot read is not a draft room. Everything else in there is good enough that this one failure is infuriating rather than disqualifying.

Around it: no bye weeks, no ADP against pick number, no projections, no tier breaks, no injury tags. The board shows 8 of 12 columns at 1680 with truncated team names and no scroll affordance, so in a snake draft he cannot see what the turn is doing. The queue bar shows 5 of the 14 he starred with no way to reorder. And the room he abandoned never appears in "Your mock drafts," which only lists completed rooms — an in-progress mock is unrecoverable once you navigate away.

The results page is good. Roster, pick-by-pick, and the full board with every bot labelled "(practice opponent)". What it does not give him is a grade. Every one of his fifteen picks carries the identical rationale, *"The board's best player available. WR13 on the board."* It tells him what happened. It does not tell him how he did, which is the only reason a twelve-season player runs a mock.

### The wallet

`/app/wallet`:

> "Real-money play is not available yet. Every league is free this season. When real-money leagues open, this page is where your balance lives: deposits, entry fees, winnings and withdrawals, each shown to the cent. Until then there is nothing to hold here, and **no number on this page will ever be an invented one**."

That is the answer to the only question he came with, and it is a *completely honest* answer. It is not a dodge. It is better written than any competitor's money page.

It is also four clicks and one account behind the front door. Signed out, the strongest signal he gets is "free this season," which reads as a discount. **The most trustworthy sentence on the site is on its least reachable page.**

`/app/profile` shows him "49 seasons finished on Commish · Veteran · Verified," and notes the badge is "shown beside your reviews." It is not shown in the league's manager list — the one place where knowing a stranger has finished 49 seasons would change whether he sits down.

### The commitment point

`/join/house_beginner_12_4/hold` → *"This league is not open to you. This league is reserved for newer players so everyone starts on a level footing."* Correct, well-written, and exactly the kind of gate a veteran wants to exist. But the storefront rendered a live **Take a seat** button on that row and he only learns after the click.

`/join/dev_public_sunday_snake/hold` → *"Sunday Regulars · You're in. You claimed seat 9 of 12 just now."*

No confirm step. No settings review. A GET on a URL put him in a twelve-team league. And there is no leave, withdraw, drop, or release control anywhere on the league page, in the settings card, or on the profile.

For a free preview that is a nuisance. For the product this intends to become, one misclick from a browse row is a permanent entry with money attached and no exit.

---

## Findings

| id | severity | what | where | one-line fix |
|---|---|---|---|---|
| V-01 | BLOCKER | Every skill player scores 0.00; the kicker is the only scorer in all six week-14 matchups, so kickers decide every game | `/app/leagues/dev_league_season/matchups/14` | Fix the stats pipeline so non-kicking stats score, and gate the matchup view behind a "no final stats yet" state rather than rendering zeros as fact |
| V-02 | BLOCKER | A GET on `/join/{code}/hold` claims a seat outright — no confirmation, no settings review — and no league offers any way to leave | `/join/{code}/hold`, `/app/leagues/[id]` | Make the hold a confirm screen showing the full settings, and add a "leave this league" control while a league is pre-draft |
| V-03 | BLOCKER | A completed league's draft board renders "Not started", 0:00, an empty board, and every drafted player back in the pool | `/app/drafts/dev_draft_season` | Route completed drafts to the results view; never render a finished draft in the live-room state |
| V-04 | BLOCKER | Player names truncate to 3–4 characters in the pool the instant Draft buttons appear ("Ja…", "De…", two of each adjacent) | draft room, left pool column | Give the name its own line above the meta row, or move Draft to a hover/keyboard action so the name keeps the width |
| V-05 | BLOCKER | Actual scoring values are published nowhere — "PPR" plus a one-sentence tooltip is the entire answer | storefront, `/league-rules`, league settings card | Add a scoring table (every stat, every point value) to the league settings card and link it from every scoring label |
| V-06 | BLOCKER | No postseason. "Week 14 of 14" while six teams display "Clinched — a guaranteed playoff spot" | league page, `/matchups/14` | Ship playoffs, or remove the Clinched badge and state the season format plainly |
| V-07 | BLOCKER | No waiver wire and no trade deadline, with unlimited unreviewed trades still open in week 14 | product-wide | Ship waivers and a trade deadline before any real-money league opens; until then say so on the storefront, not only on `/league-rules` |
| V-08 | FRICTION | Trade policy contradicts itself: "no review step, for anyone" vs `/support`'s "held automatically until an operator makes a decision" | `/app/leagues/[id]/trades` vs `/support` | Pick one policy and write it once in a shared string |
| V-09 | FRICTION | Public catalog is full of build debris: 17+ `E2E …`, `Mobile360UnbrokenOverlongIdentifierFixture`, `DesignV2 Keyboard Walk League` | `/`, `/browse`, ticker | Gate the public catalog on a publishable flag; never let a fixture reach the storefront |
| V-10 | FRICTION | The activity ticker repeats one event verbatim 3–6 times per screen width | `/`, `/browse` | Deduplicate by event id and hide the ticker below a real event threshold |
| V-11 | FRICTION | "4 mocks drafting right now" sits directly above "No mock drafts are open right now" | `/app/mock-drafts` | Source both counts from one query, or drop the ticker |
| V-12 | FRICTION | "Try a mock draft" routes to `/sign-up`, three lines under "No account is needed to look" | `/` hero | Let a signed-out visitor run a solo mock, or change the hero line |
| V-13 | FRICTION | The honest money statement lives only on the signed-in wallet; signed out he gets "free this season," which reads as a promo | `/app/wallet` vs `/` | Put "real-money play is not available yet" on the storefront in the hero, not in a table footnote |
| V-14 | FRICTION | "Stake: Free / Friendly / Competitive" is a competitiveness label whose values collide with the "Entry: Free" price column | storefront table, league settings card | Rename the axis (e.g. "Vibe") so no tier value is ever a price word |
| V-15 | FRICTION | No league detail page before joining — roster shape, clock, commissioner, and manager list are visible only after you are seated | `/browse` → `/join` | Add a public read-only league page and point every "Take a seat" at it first |
| V-16 | FRICTION | Pick-clock length appears nowhere before the draft: not in the settings card, not in the pre-draft room | league settings card, draft room | Add "Pick clock" to the settings card next to Draft |
| V-17 | FRICTION | Every date is UTC ("Saturday 29 August, 4:22 PM UTC") | storefront, browse, league page | Render in the viewer's local timezone with the zone abbreviated |
| V-18 | FRICTION | League page IA is inverted — settings, roster shape, and managers sit below the chat and the lineup | `/app/leagues/[id]` | Move the settings card directly under the header |
| V-19 | FRICTION | No roster page; the bench is visible only inside the trade builder | `/app/leagues/[id]` | Add a roster view showing starters and bench with slot labels |
| V-20 | FRICTION | Signed-in home is one unpaginated table of ~90 leagues plus a rail of ~100 initial chips, with no search or filter | `/app` | Add search and a state filter to the board; collapse the rail past ~8 leagues |
| V-21 | FRICTION | Activity log reads "Nothing has happened here yet" in a league with a completed draft and 14 played weeks | `/app/leagues/[id]/activity` | Write draft picks, lineup locks, and trades into the league feed |
| V-22 | FRICTION | Draft board shows 8 of 12 columns with truncated team names and no scroll affordance | draft room board | Add a horizontal scroll affordance and a compact column mode for 12-team rooms |
| V-23 | FRICTION | No bye weeks, ADP, projections, or injury tags anywhere in the draft pool | draft room pool | Add bye week and ADP to the player row; they are the two a veteran drafts on |
| V-24 | FRICTION | Dead-end CTA: "Take a seat" renders live on beginner-only leagues and only rejects after the click | `/browse` | Disable the CTA with a "newer players only" reason on rows he cannot join |
| V-25 | FRICTION | Manager standing ("Veteran · 49 seasons finished") shows on the profile and beside reviews but not in a league's manager list | `/app/leagues/[id]` managers card | Show the standing badge next to each manager in the room |
| V-26 | FRICTION | "Draft: Saturday 22 August, 4:56 PM UTC (starting now)" on a league at week 14 | league settings card | Suppress relative time once the draft has completed |
| V-27 | FRICTION | "You won in Week 14!" banner sits beside an "In progress" badge on the same matchup | `/app/leagues/[id]` | Derive both from one matchup state |
| V-28 | FRICTION | The only public review contains a raw epoch: "Filed at 1787735299359" | `/reviews` | Keep fixture reviews out of the public feed |
| V-29 | FRICTION | Queue bar shows 5 of N queued players with no expand and no reorder | draft room bottom bar | Make the queue expandable and drag-reorderable |
| V-30 | FRICTION | Mock results give no grade — all fifteen picks carry the identical "The board's best player available" | `/app/drafts/[id]` results | Add a draft grade: positional strength, value against ADP, reaches and steals |
| V-31 | FRICTION | An in-progress mock never appears in "Your mock drafts"; navigate away and the room is lost | `/app/mock-drafts` | List in-progress rooms first with a "Resume" action |
| V-32 | FRICTION | ⓘ popovers reflow the storefront table row, wrapping the format cell and moving the button just clicked | `/`, `/browse` | Render the popover in a portal so it does not affect row layout |
| V-33 | POLISH | "A 8-team mock filled 12 minutes ago" | mock lobby ticker | Article agreement on the numeral |
| V-34 | POLISH | "12 of 12 open" and "0 of 12 seated" state the same fact twice, once negated | storefront seats column | Keep the seated count and the meter; drop the open count |
| V-35 | POLISH | Trade builder tags positions on K and DEF only, not on skill players | trade builder | Tag every row |
| V-36 | POLISH | "Practice draft" (results) vs "Mock draft" (room) vs "Mock drafts" (lobby) | mock surfaces | Pick one noun |
| V-37 | POLISH | Terms names no legal entity, eligibility, or jurisdiction | `/legal/terms` | Name the entity and add eligibility before any deposit exists |
| V-38 | POLISH | League chat in the draft room is an empty stub with no visible input | draft room right rail | Give it the same composer the league page has, or remove it |
| V-39 | POLISH | Median league shows "19-8-1" on the home board with no explanation | `/app` board | Append "(median game)" or a ⓘ to median-league records |
| V-40 | POLISH | "Connecting…" persisted through the first several seconds of a live clocked room | draft room header | Suppress the badge until reconnect is actually needed |

**Counts — BLOCKER 7 · FRICTION 25 · POLISH 8 · total 40.**

---

## What would make him move a league here

Not a feature list. A short one, and three of them already exist:

1. **The rules page keeps telling the truth.** "This product does not yet support a waiver wire" and "no number on this page will ever be an invented one" are worth more to him than any feature. Nobody writes that. He would come back to a platform that does. **Keep this, and move it to where he reads it first.**
2. **The mock lobby, unlocked.** Mode, teams, clock, scoring, roster shape, and draft position on one screen with a one-click start is faster than what he uses now. Let him run one signed out and the draft room sells itself — the moment the pool column is readable.
3. **The open-leagues table.** Format, draft time, entry, and a live seat meter in one monospace row is how a fantasy catalog should look. He can scan forty leagues in twenty seconds.
4. **Waivers, a trade deadline, and a playoff bracket.** These are the three that make it a league instead of a draft contest. Without all three there is no version of this he moves money to.
5. **A published scoring table.** Every point value, on the league page, before he sits down.
6. **A ledger.** Draft picks, lineup locks, trades, and eventually money, in one immutable per-league feed he can point at when someone disputes something.

## What would make him leave

In the order he actually hit them:

1. **The kicker deciding every game.** Josh Allen 0.00 and Ja'Marr Chase 0.00 in a week-14 matchup. That is not a bug he waits out; it is a scoring engine that does not work, presented as a final score. This is the close-the-tab moment and everything after it is charity.
2. **Getting seated by a URL, with no way out.** One navigation put him in a twelve-team league with no confirm and no exit. He will not attach a card to a product that can do that.
3. **The platform disagreeing with itself about state.** "Draft complete" and "Not started." "You won in Week 14" and "In progress." "4 mocks drafting" and "no mocks open." "No review step, for anyone" and "held until an operator decides." Four contradictions in one session. He does not need to decide which side is right — he only needs to conclude the platform does not know, and he has.
4. **`E2E Money Dark 1787678163994` in the storefront and in the marquee.** Whatever is behind it, that is what unfinished looks like.
5. **A ticker that repeats the same claim three times across one screen.** The single decorative element on the homepage is the one that reads like marketing, on a site whose prose is otherwise unusually honest. It costs more trust than it buys attention.
6. **No waivers, no deadline, no playoffs.** Even with everything else fixed, this is not a season-long league yet, and he runs season-long leagues.

## Verdict

He would not move a money league here today — and notably, **the product agrees with him.** `/app/wallet` says real-money play is not available, in plain language, without hedging. The money story is honest, not a dodge; it is just an honest *no*.

What he would do is bookmark it. The rules page, the support page, and the wallet page are written by someone who understands that a stranger deciding where to put money reads for what is missing, not for what is promised. That instinct is rarer than a good draft room and much harder to buy. The draft room is 80% of the way there and is failed by a truncated table column. The scoring engine is the thing that has to work before any of the rest of it counts.
