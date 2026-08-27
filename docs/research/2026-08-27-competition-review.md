# Competition — matchups and trades, first full design review (2026-08-27)

The two surfaces where a league stops being a lobby and becomes a competition —
`/app/leagues/[leagueId]/matchups/[week]` (the live scoring view) and
`/app/leagues/[leagueId]/trades` (propose, answer, history) — have never been design-reviewed.
They were built feature-first across Plans A through D, gauntlet-fixed twice for correctness, and
persona-panelled for copy; neither has been walked against the six rules, against the founder's
bar, or on a phone with a game on. This review is that walk, in the same format and against the
same standard as `docs/research/2026-08-26-draft-room-design-review.md`,
`2026-08-26-mock-lobby-review.md` and `2026-08-26-mock-results-review.md`: "most premium
experience in the fantasy world... sleek, modern, beautifully simplistic but high information
density... maximize full screen width... most efficient workflows... best app I've ever seen or
used."

The stakes here are different from the draft cluster's. A draft is one night; the competition
surfaces are the seventeen Sundays the product is actually FOR. `docs/design-system.md` is the
constitution, and its rule 1 — **red is live, green is money** — was written for exactly this
screen. So was rule 6, "only true things move." Both are unspent here.

**One thing this review does not ask for.** Win probability. The brief asks whether the matchup
view is honest about it, and the honest answer is that the data to compute one does not exist:
`MatchupLineupEntry` carries no game state, no projection, no time remaining, and this product
does not invent numbers. That refusal is right and is not reopened. What IS judged is that two
real facts which would answer the same question — how much of the week has played, and by how
much you are ahead — are already on the wire and already discarded (D2, E3).

## Method

Judged the real rendered pages, not the code's intentions. The real built app at
`http://localhost:3102` (worktree `phase4p5-mock-drafts`, branch `worktree-ive-campaign`, HEAD
`9437486`), Playwright/Chromium against the real sealed sessions (`e2e/.auth/manager-a.json` and,
for the two-sided trade states, `e2e/.auth/manager-b.json`), real Postgres, real SSR reads, real
`GET /api/leagues/[leagueId]/trades` and the real advisor route. Desktop 1680 and mobile 360, dark
minimum, both themes captured at 1680.

The matchup surface was read on a genuinely played season: `E2E Sit-and-Go 1787516746667`
(`39637daa-460a-41a9-bdf9-b71d3495f14c`), eight teams, four matchups a week, real stat lines
whose starter columns sum exactly to the printed team totals (verified by hand: `21.02 + 16.50 +
23.50 + 15.10 + 19.20 + 4.80 + 15.20 + 10.00 + 8.00 = 133.32`). Weeks 1, 2, 3, 5, 8, 14 and an
out-of-range week 99 were each rendered. A second, less-scored league (`dev_league_season`) was
used for the not-started state.

The trades surface was read on `e2e_trades_league` in three states at once — one live inbound
offer, twenty settled history cards, and the composer — plus `e2e_held_trade_league` for the
`held` state. **A real offer was proposed through the real UI** as manager-b (Xavier Reed for
Isaiah Bell) and answered-but-not-accepted as manager-a, so the answerable band, the propose-time
verdict and the receive-time verdict were all read live rather than from fixtures. No seeded data
was deleted; the offer left standing expires on its own in three days, which is the product's own
behavior.

Geometry, computed styles, ink-pill fills, heading outlines, sticker areas, truncation widths and
page heights were read out of the live DOM rather than eyeballed. `axe-core` 4.x was run against
`<main>` on both surfaces at both viewports. Read-only: no source file changed, no commit, no
server touched. Shots and scripts (this machine):
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/`,
prefixed `revB-`.

One harness artifact to discount: the headless context loads no Geist face, so computed
`font-family` falls back to system sans. It affects no measurement quoted.

## Executive verdict

The matchup page is a **box score, printed after the fact, for somebody else's league** — four
identical bordered blocks of two nine-row tables each, in database order, so on half the weeks
measured the manager's own game is not the first thing on screen (week 5 and week 8: `y=834`, and
in a 12-team league it would be the sixth panel), and on a 360px phone the scoreboard's name box
is 124px against a 152px team name, which clips seven of eight team names and clips the "You"
marker off the caller's own side entirely — the one element that has to survive the couch phone is
the only one that doesn't. Nothing on the page is red, nothing moves, nothing says how much of the
week has played (`gamesFinal`/`gamesTotal` arrive on every live frame, are validated by the parser,
and are returned by nothing), nothing says the stream has dropped (`connection` has zero consumers
repo-wide), nothing subtracts 133.32 from 124.66, and a starter with no stat line prints `0.00` —
the exact conflation the codebase's own live-scores docblock forbids one layer up. The trades page
is the opposite failure: **40.4% of its ink area is saturated position pigment** (202 `Sticker`
tiles at 769×28, measured against a 10.7-megapixel page) on a near-monochrome constitution, two
ink pills sit in one view against a law that says exactly one, twenty settled trades run 6,400px
below the single live offer with no date and no counterparty name on any of them — both facts are
on the wire, both are dropped — and the header sentence "There's no review step, for anyone" is
rendered directly above a banner explaining the review this trade is under. A compact fix pass
makes the numbers honest, gives the live states red, cuts the pigment to a chip and settles the
ink count; the composition pass is where these two stop being CRUD screens and become the thing a
manager opens with a game on.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT (rule 1) | HIGH | **Live is painted in the money pigment, and Final is painted in the same hex.** `WeekStatusBadge` maps `in_progress → tone="accent"` and `final → tone="positive"` — and `accent`/`positive` are one hex by deliberate design, measured `rgb(62,207,142)` on both. The two states that matter most on game day differ only by a `ring-2` glow. Rule 1 is "red is live, red is a clock"; the competition surface contains **zero** `negative` anywhere (grepped across `matchup-panel`, `matchup-scoreboard`, `live-matchup-week`, `week-nav`, `trade-card`, `trade-composer`). Green is additionally spent on the "You" identity mark, the week-nav links, and the "Needs your answer" badge | `week-status-badge.tsx`, `matchup-scoreboard.tsx`, `week-nav.tsx`, `trade-card.tsx` | `in_progress` becomes the live red the constitution reserves for it; `final` keeps green as an outcome; identity and navigation stop spending the money pigment |
| D2 | DEFECT (honesty) | HIGH | **The two facts that make a live score trustworthy arrive on every frame and are thrown away.** `ScoreUpdatePayload` carries `gamesFinal` and `gamesTotal`; `parseScoreFrame` validates both by name and `useLiveScores` returns neither — `LiveScores` is `{scores, status, connection}`. Grepped: **no UI consumer anywhere in `src`**. The product already knows how to say this — `liveStateFor` computes `gamesLive = gamesTotal - gamesFinal` and `LiveStatePill` prints it in the top bar — so "7 games live" is said in the chrome and withheld on the surface where a manager decides whether a nine-point lead is safe | `src/league-room/hooks/use-live-scores.ts`, `live-matchup-week.tsx` | Return `gamesFinal`/`gamesTotal` from the hook and print "N of M games final" beside the week's status |
| D3 | DEFECT (honesty) | HIGH | **A frozen score is indistinguishable from a moving one.** `useLiveScores` computes `connection: "connecting" \| "live" \| "reconnecting"` and sets `"reconnecting"` on `EventSource` error; `LiveMatchupWeek` reads `live.scores` and `live.status` and never `live.connection`. Grepped: zero consumers of `LiveScoresConnection` outside its own file. A dropped stream leaves the last number painted with no tell, on the one surface in a money product where a stale number reads as a fact | `live-matchup-week.tsx`, `use-live-scores.ts` | Render the connection state — the product's own `SessionNotice`/`ConnectionBanner` idiom already exists for exactly this |
| D4 | DEFECT (honesty) | HIGH | **`0.00` means both "has not played" and "played and scored nothing."** `matchupWeek`'s `entryFor` coalesces a missing stat line to zero (`points: player === undefined \|\| line === undefined ? 0 : computeFantasyPoints(...)`). The TEAM level honors the distinction — `score === null` renders `—`, and `initialScores`' own docblock states the law verbatim: *"'no live value yet' and 'scored zero' are different facts, and coalescing the first into the second would show '0.00' for a matchup that hasn't kicked off."* Verified live on `dev_league_season` week 14: badge "Not started", eight starters at `0.00`, team total `6.00` | `src/league-service/read.ts` (`entryFor`), `matchup-panel.tsx` | `points: number \| null`; a starter with no line renders `—`, the same way its team already does |
| D5 | DEFECT (a11y) | MEDIUM | **axe fails on the matchup page, at both viewports.** `heading-order`, moderate, 1 node: the document runs `<h1>` → `<h3>` because `MatchupPanel` gives each matchup an eyebrow `<span>` rather than a heading, so `Side`'s team-name `<h3>` is the first heading under the page title. Measured outline: `H1 · H3 · H3 · H3 …`, zero `<h2>` in `<main>`. The per-component tests structurally cannot catch this — happy-dom renders one panel, where the `h3` is the only heading | `matchup-panel.tsx` | The matchup gets a real `<h2>` (the two team names, which is also E1's anchor); the side tables drop to `<h3>` under it |
| D6 | DEFECT (rule 5) | HIGH | **Two ink pills in one view, and the count grows with the inbox.** Measured on `/trades`: "Put an offer together" and "Accept" both render `background-color: rgb(244,244,246)` (`bg-text-primary`), simultaneously on screen, at both 1680 and 360. Rule 5 is "every view gets **exactly one** solid (ink) action." This is not a one-off — the count is 1 + (number of answerable offers), so a busy Tuesday shows four | `trade-inbox.tsx`, `trade-card.tsx` | One ink action for the view: the answer to the most urgent offer, or "Put an offer together" when there is nothing to answer — the same single-featured-item discipline `OpenLeagueShelf` already enforces and tests |
| D7 | DEFECT (honesty) | HIGH | **The page contradicts itself, 400px apart, on the same screen.** `/app/leagues/e2e_held_trade_league/trades` renders the header sentence "Trades complete as soon as both sides agree. There's no review step, for anyone." directly above `HeldTradeBanner`: "Your trade ... is on hold while somebody at Commish looks at it. Public leagues get a second pair of eyes on trades this lopsided." Both verified in one capture. The header is a page-level literal that never learned about Plan D's own carve-out | `src/app/app/(shell)/leagues/[leagueId]/trades/page.tsx`, `held-trade-banner.tsx` | The header states the rule INCLUDING its one exception, in one sentence, or defers to the banner when a held trade is on the page |
| E1 | EXECUTION | HIGH | **Your own game is not first, and the only thing that marks it is a 12px green word.** `matchupWeek` returns matchups in row order with no caller-first sort. Measured on the seeded league: the caller's own panel is index 0 in weeks 2 and 3, **index 1 in weeks 5 and 8 (`y = 834` at 1680)**. In a 12-team league it can be the sixth of six panels, ~3,300px down. The page a manager opens to answer "am I winning" makes them hunt | `read.ts` (`matchupWeek`), `live-matchup-week.tsx` | The caller's matchup renders first and carries visible weight; everyone else's follows |
| E2 | EXECUTION | HIGH | **At 360 the scoreboard cannot say who is playing.** Measured: the truncating name box is `clientW 124px`; "Dev Manager 03" needs `scrollW 152px` — **seven of eight names on the page are clipped**, and on the caller's own side the trailing "You" marker is clipped out of the box entirely (`youVisible: false`). At 1680 the identical box is `752px` wide for the same 152px name. The allocation is exactly inverted from where the readers are | `matchup-scoreboard.tsx` | The phone's scoreboard stacks the two sides (name on its own line, full width) rather than halving a 360px screen into two 124px columns |
| E3 | EXECUTION | HIGH | **The page never does the one piece of arithmetic it exists for.** `133.32` and `124.66` sit 792px apart at 1680 and the margin — 8.66 — is never printed. The product computes this one route over: the locker-room board prints a **Margin** column (`+5.00`, `+9.00`, `-24.36`, measured on `/app`). The surface dedicated to the matchup is the one that makes you subtract | `matchup-scoreboard.tsx`, `matchup-panel.tsx` | One margin figure between the two scores, mono and tabular, weight for the extremes, no color (the D5 register: a record carries typographic weight, never a hue) |
| E4 | EXECUTION | MEDIUM | **Bench points are queried, computed, passed down, and dropped.** `matchupWeek` populates `MatchupSide.bench` via `benchOf(lineup).map(entryFor)`; `MatchupPanel` renders `side.starters` only. The trades page proves the array is live and full — `rosterOf([...matchup.home.starters, ...matchup.home.bench])`. "What I left on the bench" is the most-argued fact in this hobby and it is one prop away | `matchup-panel.tsx` | A collapsed bench block per side, and one derived line: the best bench score against the worst starter it could have replaced |
| E5 | EXECUTION | HIGH | **40.4% of the trades page is saturated position pigment.** Measured: **202 `Sticker` tiles, 769 × 28px each, 4,349,464px² of a 10,759,328px² page.** `Sticker`'s own docblock calls it "the Poster Board's signature shape" — a board CELL. Stretched into a 769px bar carrying a 90px name it is a highlighter, and LED-2 already ruled on this exact failure: "a full-cell sticker fill at semantic-role saturation reads as a spreadsheet, not a board." That ruling desaturated the pigments and fixed the draft board; the trade card kept the full-width slab. On a constitution whose identity is near-monochrome, this is the loudest surface in the product | `trade-card.tsx` (`AssetList`), `trade-composer.tsx` (`PlayerPicker`) | The position becomes a `PositionBadge` chip on a plain row — the same treatment `LineupEditor` and the matchup table already use; the slab goes |
| E6 | EXECUTION | HIGH | **Trade history is twenty identical rows with no date and no opponent.** Measured: 21 `<article>`s, `docH 6658` at 1680 and **`11538` at 360**, with the single live offer at `y=270` and 6,400px of settled cards below it at identical visual weight, unpaginated and uncollapsed. Every card's only temporal anchor is "Week 18" — the same on all of them. `TradeProposalView` carries `proposedAt` AND `settledAt`, neither rendered; `counterpartyName` is computed inside `TradeCard` and used only for the `aria-label` and the held banner, so **a card never visibly names who you traded with**. Two questions a history exists to answer, two fields already in hand | `trade-card.tsx`, `trade-inbox.tsx` | Settled trades become a dated, named, tabular ledger — one row each, counterparty and date in the row, expandable for the assets |
| E7 | EXECUTION | HIGH | **The composer asks you to price players it refuses to price.** `TradeRosterPlayer` is `{playerId, name, position}` — the picker prints a name and a chip and nothing else: no points, no bye, no NFL team, and starters and bench concatenated into one flat unlabelled list, so you cannot see whether you are trading a starter. Then the verdict quotes exact per-player arithmetic — measured live, "12.47 points a week going out, 17.40 points a week coming back" for a one-for-one — derived from values the engine holds and the page never puts beside the player. Fairness arrives as a judgment sentence plus an unauditable aggregate | `trade-composer.tsx`, `trade-inbox.tsx` (`flattenPlayers`), `trade-verdict.tsx` | Each player carries its own weekly value in the picker and in the card; the aggregate becomes a visible sum of visible parts (see R5) |
| E8 | EXECUTION | MEDIUM | **The matchup page is a cul-de-sac.** Measured: **1 link in `<main>`** (the week nav's next-week link) and 4 buttons, all of them the same glossary popover. From the screen telling you that you are losing by nine there is no route to your lineup, to a trade offer, to the standings, or to the opponent's roster — the four things that page makes a person want to do | `matchup-panel.tsx`, `matchups/[week]/page.tsx` | The caller's own side carries its next act; the opponent's team name is a link |
| E9 | EXECUTION | MEDIUM | **An out-of-range week says something false and offers nothing.** `/matchups/99` on a 14-week league renders `<h1>` "… · Week 99", `WeekNav` prints "**Week 99 of 14**" with a live "← Week 98" link into another nonexistent week, and the body is a bare `<p>` — "There are no matchups in this week yet." — with no action, against "Never a dead end. Empty and error states always offer an action." The hand-rolled `<p>` exists precisely because `EmptyState` requires an `action`: the primitive was bypassed to get around the rule | `matchups/[week]/page.tsx`, `week-nav.tsx` | 404 a week past the season; the genuine "no fixtures yet" state uses `EmptyState` with a real way out |
| E10 | EXECUTION | MEDIUM | **Twelve boxes on a constitution that asks for hairlines.** Measured at 1680: each matchup is 1 `Card` (scoreboard) + 2 `Card`s (sides) — **12 bordered, shadowed boxes** plus 8 tables on a 2,865px page. Rule 4: "Structure comes from thin rules and space, not card borders." A stack of identical cards is exactly the "my eyes don't know where to focus" the founder already ruled against once, on the shelf | `matchup-panel.tsx`, `matchup-scoreboard.tsx` | Hairline-separated bands; depth from the four-surface model, not from twelve borders |
| E11 | EXECUTION | MEDIUM | **The scoreboard spends 1,584px to say four things.** Measured band: `1584 × 135`, holding two names and two numbers, each centered inside its own ~790px half. Meanwhile the starter tables render `Slot` in a ~135px column for a 3-letter chip. Empty ground is not density, and the bar is "high information density... maximize full screen width" | `matchup-scoreboard.tsx`, `matchup-panel.tsx` | The scoreboard band earns its width: margin, games-final, both records, the median line — or it stops being 135px tall |
| E12 | EXECUTION | MEDIUM | **Composing hides everything else.** `TradeInbox` returns `<TradeComposer/>` in an early return, unmounting the inbox — so while building an offer you cannot see the offer you are answering, what you already have out, or what the league has been trading. The room the docblock describes ("'read the inbox' and 'build an offer' are the same room, never two routes") is implemented as two routes without the URL | `trade-inbox.tsx` | The composer opens beside the inbox, not instead of it |
| E13 | EXECUTION | LOW | **Four user-facing contractions against the ruled expanded register (C1),** which has exactly one named exception and it is not any of these: `trades/page.tsx:83` "There's no review step, for anyone."; `trade-card.tsx:101` "This offer can't be answered anymore."; `trade-card.tsx:274` "You can't undo it."; `trade-composer.tsx:54` "the week's matchups aren't set yet." The last three sit inside the accept-confirm modal and the two most-read empty states | `trades/page.tsx`, `trade-card.tsx`, `trade-composer.tsx` | Expand all four |
| E14 | EXECUTION | LOW | **The same definition, four times, and they are the page's only controls.** Measured: 4 buttons in `<main>`, every one of them named "What is a matchup?" — `MatchupPanel` renders an `InfoTip` per panel, so a 12-team week carries six identical triggers. The docblock explains why it is not on the scoreboard; nothing explains why it is not once, on the page | `matchup-panel.tsx` | One trigger on the page, beside the title |
| E15 | EXECUTION | LOW | **No mono on the product's two most tabular surfaces.** Grepped: zero `font-mono` in `matchup-panel`, `matchup-scoreboard`, `live-matchup-week`, `trade-card`, `trade-composer`, `trade-inbox` — only the `EYEBROW` constant brings any. The constitution assigns mono to "clock digits, tabular numbers, the wire"; a 44px score and a nine-row points column are precisely that, and the Sunday Standard's own signature is missing from the surface it was designed for | `matchup-scoreboard.tsx`, `matchup-panel.tsx`, `trade-verdict.tsx` | Scores, points columns and trade values render mono/tabular |
| R1 | DIRECTION | HIGH (competition) | **This is a box score, not a game day.** No clock, no red, no motion, no wire, nothing that says a game is on, nothing that changes when something happens — the page reads identically at 1pm Sunday and Tuesday morning. `PickWire` proved the idiom in the draft room ("the single strongest image the product makes"); `Celebration` exists and is wired on the league home but not here; `Countdown` exists. Every element a game day needs is already built and pointed somewhere else | `matchup-panel.tsx`, `live-matchup-week.tsx` | Compose a game day: the caller's matchup as hero, games-final beside the status, a mono band of the week's own real scoring events, red where something is live |
| R2 | DIRECTION | — | **Win probability: refuse it, and ship the two facts that answer the same question.** Ruled here rather than left open. No per-player game state, no projections, no time remaining exist in `MatchupLineupEntry` or anywhere the page can reach, so a probability would be a manufactured number and this product does not make those. What DOES exist, already on the wire, is `gamesFinal`/`gamesTotal` (D2) and the margin (E3) — "you are up 8.66 with 6 of 13 games final" is the honest sentence, needs no new data, and judges nothing | `use-live-scores.ts`, `matchup-scoreboard.tsx` | Print the margin against the games-final count; never a percentage |
| R3 | DIRECTION | — | **The week has no scoreboard.** There is no league-wide glance: four (six at 12 teams) full panels at 642px each, 18 table rows apiece, `docH 2865` at 1680 and `5024` at 360 for a four-matchup league. Every product this one intends to beat opens a week with a compact scoreboard and lets you drill in. `MatchupSummary` is already that compact shape and `MatchupScoreboard` already renders it that way for `HomeLeagueCard` | `matchups/[week]/page.tsx`, `matchup-panel.tsx` | The week opens as a scoreboard — every matchup, one dense row each, the caller's own expanded — and a panel opens on demand |
| R4 | DIRECTION | — | **Trading is a two-message protocol with no reply.** There is no counter-offer anywhere: grepped `src/trades` and `src/league-service/trades.ts` for `counter` outside `counterparty` — nothing, and no route. The only answers are accept, decline, withdraw, or start over from an empty composer that has already forgotten what you were looking at (E12). Negotiation is what trading IS; today the product supports the announcement and not the conversation. Scope call, not a defect — but it is the reason this surface will feel thin against Sleeper | `trade-card.tsx`, `trade-inbox.tsx`, `src/trades` | Adjudicate by personas: "Counter" pre-fills the composer from the offer on screen, and the two proposals stay linked in one thread |
| R5 | DIRECTION | — | **Fairness should be a ledger, not a verdict.** Today a member gets one judgment sentence ("This favors what you would give up, in weekly production.") plus two aggregates they cannot check. The engine already holds a per-player value — the aggregates ARE those values summed — so the honest form is a two-column table of players and their weekly figures that visibly totals to the two numbers, with the verdict demoted to the caption and "Advice only. You decide." kept exactly as it is. Same engine, same output, no new data, and the member can audit the claim, which is the whole difference between advice and authority. **Register, ruled here:** the values carry typographic weight, never color — a green "good trade" figure is one step from the grade this product refuses everywhere else | `trade-verdict.tsx`, `trade-composer.tsx`, `trade-inbox.tsx` (`flattenPlayers`) | Per-player values in the picker and the card; the aggregate becomes a visible sum |

Counts: **7 DEFECT · 15 EXECUTION · 5 DIRECTION.**

## What the page holds and does not say

Every column below is already in the props or on the socket at render time. Nothing here needs a
new query, a new provider tier, or an invented number.

| fact | where it already lives | rendered? |
|---|---|---|
| games final / games total this week | `ScoreUpdatePayload`, parsed and validated every frame | **no** (D2) — printed in the top bar instead |
| stream is live / reconnecting | `useLiveScores` → `LiveScores.connection` | **no** (D3) — zero consumers repo-wide |
| this starter has no stat line yet | `matchupWeek`'s `entryFor`, coalesced to `0` | **no** (D4) — prints `0.00` |
| the margin | both scores, on screen, 792px apart | **no** (E3) — printed on `/app`'s board |
| bench points | `MatchupSide.bench`, fully populated | **no** (E4) |
| which of these matchups is mine | `MatchupWeekBody.myTeamId` | only as a 12px green "You" (E1, E2) |
| when this trade happened | `TradeProposalView.proposedAt` / `.settledAt` | **no** (E6) |
| who this trade was with | `TradeCard`'s own `counterpartyName` | only in the `aria-label` (E6) |
| what each traded player is worth | the same values the verdict aggregates | **no** (E7, R5) |

Three readings the current pages make impossible. **"Is my lead safe?"** — the margin is not
printed and the games-final count is discarded, so a manager compares two 44px numbers 792px apart
and guesses. **"Did I win because of my lineup?"** — the bench is fetched and dropped, so the one
comparison that makes a week a story is unavailable on the page about the week. **"Who have I
traded with this season?"** — twenty history cards, no name on any of them.

## The per-surface walk

**S1 · Matchups, desktop, 1680, dark (`revB-match-1680-dark.png`).** Honest and quiet, which is the
bar working: this does not look like a toy, the loser's score correctly recedes to muted, and the
starter columns add up. Then it stops working. The eye lands on four identical bordered blocks
(E10) in database order, and there is no signal at all telling you which one is yours except a
12px green word (E1). The scoreboard band is 1,584 × 135 holding four pieces of text (E11) while
the table beside it gives a three-letter slot chip a 135px column. The only state on screen is four
identical 45×21 green "Final" pills in the corners — the most important fact about a matchup,
rendered at the smallest size on the page, in the money color (D1). Four identical "What is a
matchup?" buttons are the page's entire control surface (E14, E8).

**S2 · Matchups, desktop, 1680, light (`revB-match-1680-light.png`).** Structurally identical and
genuinely designed rather than inverted; `Final` reads `rgb(11,107,67)`, its own light value. The
emptiness of the scoreboard band reads worse on paper, and the twelve card borders read heavier.

**S3 · Matchups, mobile, 360 (`revB-match-360-dark.png`).** The failure state. `docH 5024` for four
matchups. Seven of eight team names clipped at 124px (E2), the caller's own "You" marker clipped
off entirely, and the hero element of the whole surface reduced to "Dev Manag…" versus "Commish
L…". Below it, the same four panels in the same order, so on the weeks measured where the caller's
matchup is index 1, their own game begins around 1,250px down on a 780px screen. This is THE
fantasy device and it is the worst of the three renders.

**S4 · Matchups, a week not started (`dev_league_season` week 14).** Badge says "Not started".
Nine starters say `0.00`. Team total says `6.00`. Nothing on screen distinguishes eight players who
have not kicked off from eight players who played and did nothing (D4).

**S5 · Matchups, out of range (`/matchups/99`).** "Week 99 of 14", a live link back to Week 98, and
a dead-end sentence with no action (E9).

**S6 · Trades, desktop, 1680, dark and light (`revB-inbox-a-verdict.png`,
`revB-trades-1680-light.png`).** The single loudest screen in the product: 202 saturated slabs
covering 40.4% of a 6,658px page (E5), with the one live decision — a real offer, Xavier Reed for
Isaiah Bell, expiring in 2 days — sitting at `y=270` above 6,400px of undated, unnamed, identical
settled cards (E6). Two ink pills are visible at once (D6): "Put an offer together," orphaned and
right-aligned with 1,200px of empty row to its left, and "Accept" 300px below it. The credit: the
verdict itself is scrupulous — the proposer saw "12.47 out, 17.40 back" and the receiver sees
"17.40 out, 12.47 back," the same arithmetic told correctly from each side, with "Advice only. You
decide." underneath. The expiry line is real and live, and an expired offer correctly loses its
controls. That discipline is the right instinct; it is undermined by never showing the parts the
aggregate is made of (E7).

**S7 · Trades, mobile, 360.** `docH 11538`. Eleven and a half metres of scroll for a page with one
decision on it. "You give" and "You get" stack rather than sitting side by side, so the comparison
the whole card exists to enable does not happen on the device where offers actually get answered.

**S8 · The composer (`revB-composer-verdict.png`).** Two flat lists of names and chips — starters
and bench merged with no label, no points, no bye, no NFL team (E7) — 18 checkboxes, no running
summary of what you have selected, and the inbox you came from unmounted behind you (E12). Then a
sentence that quotes exact per-player arithmetic you were never shown.

**S9 · The held trade (`e2e_held_trade_league`).** The banner is excellent: it names the league,
names the counterparty, says why this trade is held, says neither roster moves, and promises both
sides an answer. It is rendered 400px below a sentence that says no review step exists for anyone
(D7).

## The manager's game-day thirty seconds

It is 4:15 on a Sunday. He is on the couch, on the phone, and he thinks he is up by about nine
with the late games starting. He opens the matchup page.

Seconds 0–5: two truncated names — "Dev Manag…" versus "Commish L…" — and two numbers. He cannot
tell from the header which side is his, because the "You" mark that would tell him is clipped off
the box (E2). He works it out from the team name he half-recognizes.

Seconds 5–15: the numbers say 134.50 and 127.10. He subtracts in his head (E3), gets 7.40, and
then wants the only thing that makes that number mean anything — how much football is left. The
page does not say (D2), even though the count is on the socket and the top bar above his thumb is
printing it. So he scans the starter tables for zeros to work it out himself, and finds a column
of `0.00` that cannot tell him whether those players are yet to kick off or already done and
useless (D4). He gives up on the question.

Seconds 15–30: he scrolls, looking for his bench — did his RB2 outscore the guy he started? The
bench is not on the page (E4). He scrolls past three other people's full lineups, in database
order, and lands at the bottom on a sentence about the stat provider. There is nothing to tap: one
link, four glossary buttons (E8). He wants to offer somebody a trade about what he just learned;
there is no route from here to that. He closes the tab.

Nothing on that screen was false. Nothing on it moved, either, and nothing on it was red, and the
one number that could have made his afternoon — "up 7.40, 6 of 13 games final" — is composed of two
facts the browser was already holding. Fix D2, D4, E1, E2 and E3 and the same thirty seconds end
with him knowing exactly where he stands and tapping through to do something about it. That is
the entire difference between a box score and a game day.

## Prioritized remediation

**Before this ships to strangers (the compact fix pass):**

1. **D4 + D2 + E3** — the honesty triad, all three from data already in hand. `points` becomes
   nullable so an unplayed starter reads `—` like its team already does; the hook returns
   `gamesFinal`/`gamesTotal` and the scoreboard prints "N of M games final"; the margin is printed
   between the two scores, mono and tabular, weight for the extremes, no color.
2. **D1** — `in_progress` becomes live red. The constitution wrote rule 1 for this badge; it is a
   two-line change in `week-status-badge.tsx` and it is the single highest-leverage pixel on the
   competition surface. Green stays on `final` as an outcome; identity ("You") and week navigation
   stop spending the money pigment.
3. **E1 + E2** — the caller's matchup renders first and carries visible weight, and the 360px
   scoreboard stacks its two sides so a team name and its "You" mark survive the phone.
4. **D6 + D7** — one ink action per view on `/trades`; the header sentence stops contradicting the
   held-trade banner rendered underneath it.
5. **E5** — the trade card's 769px slabs become `PositionBadge` chips on plain rows, the treatment
   `LineupEditor` and the matchup table already use. This is one `className` decision that removes
   four megapixels of pigment from a near-monochrome product.
6. **D3** — the connection state is rendered. The idiom already exists.
7. **D5 + E9 + E13 + E14** — the heading level, the out-of-range week and its dead-end empty state,
   the four contractions, the four duplicate glossary triggers.

**After (the composition pass, in order of leverage):**

1. **R1 + R3** — the game day. The week opens as a dense scoreboard with the caller's own matchup
   expanded as hero; games-final sits beside the status; one mono band carries the week's real
   scoring events; red appears where something is genuinely live. This is where `PickWire`,
   `Celebration` and `Countdown` — all built, all pointed elsewhere — finally serve the seventeen
   Sundays the product is for.
2. **R5 + E7** — fairness becomes a ledger. Per-player values in the picker and on the card, the
   aggregate as a visible sum, the verdict demoted to a caption. Typographic weight, never color.
3. **E6 + E12** — the trade room becomes one room: a dated, named, tabular history ledger below a
   live decision band, and a composer that opens beside the inbox instead of replacing it.
4. **E4 + E8 + E11 + E10** — the bench arrives, the matchup carries its next act, the scoreboard
   band earns its 1,584px, and the twelve boxes become hairline bands.
5. **R4** — persona-adjudicated: the counter-offer, and whether this product's trade surface is an
   announcement or a conversation.
6. **E15** — mono and tabular on every score, points column and trade value, after the compositions
   above settle where those numbers live.

---

*Method footnote: all geometry, computed styles, ink-pill fills, heading outlines, sticker areas,
truncation widths, page heights and axe results were read from the live DOM of the real built app
at `9437486`, against the sealed `manager-a` and `manager-b` sessions, on one genuinely played
eight-team season (`39637daa-460a-41a9-bdf9-b71d3495f14c`, weeks 1/2/3/5/8/14/99) and three real
trade leagues (`e2e_trades_league`, `e2e_held_trade_league`, and the sit-and-go's empty state). One
real trade offer was proposed through the real UI to read the answerable and verdict states from
both sides; no seeded data was deleted and the offer expires on its own. Every "already on the
wire" claim in the findings table was verified by grepping the whole of `src` for the field's
consumers, not inferred. Read-only review: no source file changed, no commit made, no server
touched.*
