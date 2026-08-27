# The league life — first full design review (2026-08-27)

The signed-in home (`/app`), the league list (`/app/leagues`), a league's own home
(`/app/leagues/[leagueId]`) and its activity feed (`.../activity`) have never been reviewed. Every
other surface in this product has: the front door and the shelf were rebuilt in v3, the draft room
got its composition pass, the mock lobby and the mock results got theirs
(`docs/research/2026-08-26-draft-room-design-review.md`,
`2026-08-26-mock-lobby-review.md`, `2026-08-26-mock-results-review.md`). This is the cluster a
member actually lives in — the room they come back to on a Tuesday, the room they wait in before
their draft, the room they check on a Sunday — and it has been growing by accretion since Phase 1
while the surfaces around it were being designed.

Same format, same bar, same voice as the three reviews above: "most premium experience in the
fantasy world... sleek, modern, beautifully simplistic but high information density... maximize
full screen width... most efficient workflows... best app I've ever seen or used." Constitution is
`docs/design-system.md` — the six rules, the caps charter, pill discipline, the layout shapes and
the wire's honesty contract.

The stakes are retention rather than conversion. The lobby raised the doorway and the room raised
the moment; this is the part that has to still be good in November. It is also the only cluster in
the product where a member's own money, standing and season live, and the only one whose surfaces
have never once been composed as a whole.

## Method

Judged the real rendered pages, not the code's intentions. The real built app at
`http://localhost:3102` (worktree `phase4p5-mock-drafts`, branch `worktree-ive-campaign`, HEAD
`4da6f8a`), Playwright/Chromium 1.62.1 against the seeded sessions in `e2e/.auth/`, real Postgres,
real SSR reads. Four accounts, deliberately, because this cluster's shape changes with how many
leagues a person is in:

- **`manager-a`** — the founder's own seeded account: 103 leagues, real season data through week
  14 (`dev_league_season`, 12 teams, 8-5-1, six clinched). The stress case.
- **`manager-c`** — one league. The n=1 branch `HomeBoard` has a dedicated code path for.
- **`manager-zero`** — no leagues. The first-run fork (`firstRunPlan` → `FirstRunPanel`).
- **`manager-b`** — 133 rail entries, used only to confirm the board's behavior above the cap.

Four league states walked: a played season (`dev_league_season`, week 14), a scheduled draft
(`e2e_draft_schedule_league`, 2 of 2 seated, kickoff passed), a filling public league
(`dd218bc4-…`, 1 of 12 seated, 3 days out), and a real activity feed with 38 rows
(`e2e_trades_league` — the only member league on this box with a non-empty feed; `dev_league_season`'s
own feed is empty, which is itself reported below as S6).

Geometry, computed styles, ink counts, column widths, row heights, page heights and landmark
counts were read out of the live DOM rather than eyeballed. Desktop 1680 and mobile 360, dark
throughout, plus light on the one surface where a color question arose (`revA-whenfull-light-1680.png`).
Read-only: no source file changed, no commit made, no server touched, no seeded league mutated.
Shots and scripts (this machine), all prefixed `revA-`:
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/`.

**Two things to discount when reading the captures.** The headless context loads no Geist face
(computed `font-family` falls back to system sans); no measurement below depends on it. And
`manager-a`'s 103 leagues are e2e seed pollution, not a real member's life — every finding drawn
from that account is stated as a finding about the **shape** of the rendering (no cap, no grouping,
no search), never about the count itself, and R6 says so explicitly.

## Executive verdict

The league life is the only cluster in this product that was never composed: a league's home page
is twelve full-width sections dropped one under the next down 4 238px of scroll, opening — for all
seventeen weeks of a season — with a 195px panel announcing that the draft finished, and closing
with four separate ink pills where the constitution allows one, two of them pills stretched to
1 550 and 1 584 pixels wide. The two moments this cluster exists to own are both mishandled in the
same way: the waiting room, which should be the most exciting screen a new member ever sees, is a
countdown centered in a 1 584px void followed by four one-line paragraphs of scheduling law and
then an entire season's worth of empty scaffolding — an empty standings table, an empty chat, a
lineup editor showing nine `Empty` slots under the sentence "Week 1 has started, so its lineup
cannot change," which is not true and not the reason; and the activity feed, which should be the
one place the Sunday Standard's wire idiom obviously belongs, is 38 rows at 83 pixels apiece, zero
mono, an absolute timestamp restamped on every row three times in a row, telling each trade's story
backwards. A compact fix pass gets the ink count legal, kills the copy that lies, and puts the
standings and the members list back on a density this product already knows how to draw; the
composition pass is where a league stops being a scroll of panels and becomes a room.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT (rule 5) | HIGH | **Every league home renders four to five visible ink pills.** Measured in the live DOM: a played season shows `Save lineup` (**1 584px wide**), `Send`, `Get advice`, `Create invite link` (**1 550px**); a pre-draft league adds `Start the draft` for five. Rule 5 is "every view gets **exactly one** solid (ink) action." The accent-budget sweep cannot see this — it walks files, not views — and this is the view it was always going to miss, because no single component owns the page | `src/league-room/components/league-home.tsx` (the composition), `lineup-editor.tsx`, `advisor-panel.tsx`, `invite-panel.tsx`, `chat-room/components/league-chat.tsx` | `LeagueHome` picks the one ink action from `nextActionKind` it already computes; every panel takes an `emphasis` prop and defaults to quiet |
| D2 | DEFECT (honesty) | HIGH | **The lineup editor tells a pre-draft league a false reason.** On a league whose draft is three days out, `Week 1 lineup` renders nine rows reading `Empty` under the sentence *"Week 1 has started, so its lineup cannot change. You can set next week's lineup as soon as this week ends."* — verbatim from the live DOM on two separate scheduled leagues. Week 1 has not started; the slots are empty because nobody has drafted. The one sentence a first-timer will read to explain a screenful of `Empty` is the wrong sentence | `src/league-room/components/lineup-editor.tsx`, `league-home.tsx` (renders it unconditionally whenever `lineup !== null`) | A league whose `draftStatus !== "complete"` renders no lineup editor at all — the waiting room already owns that state |
| D3 | DEFECT (honesty) | MEDIUM | **The loudest action on a filling public league is the one the server refuses.** `Start the draft` renders as a solid ink pill for the commissioner, and 40px beneath it the panel prints, in amber, *"This league fills from the open shelf. The draft starts when the room is full."* — the proactive statement that the press will be refused server-side (`store.ts`'s `startDraft`). The page argues with itself, and the ink is on the losing side | `src/league-room/components/draft-schedule-panel.tsx` (`commissionerControls`, `shortRoomNotice`) | A public matchmade league with open seats renders no start control — the refusal sentence becomes the whole answer |
| D4 | DEFECT (rule 1) | MEDIUM | **A neutral scheduling fact is painted amber, and announced as a live region.** `PUBLIC_ROOM_SHORT_REFUSAL` and `shortRoomWarning` both render `text-sm text-warning` (measured `rgb(173,126,14)` dark, `rgb(132,99,21)` light — both clear 4.5:1, so this is semantics, not contrast), and both carry `role="status"` on a sentence that never changes. This is precisely the demotion v3's own E5 already made for `describeStartTiming` — the constitution records amber as "reserved for a clock genuinely tightening, never a neutral scheduling sentence" — applied to one twin and not the other | `src/league-room/components/draft-schedule-panel.tsx:311,315` | `text-text-muted`, and drop `role="status"` from a static sentence |
| D5 | DEFECT (honesty) | LOW | **A manager with zero leagues is greeted by an `<h1>` reading "Your leagues."** The first words this product says to a brand-new member name a thing they do not have. `AppHome` renders `PageTitle` before it knows which branch `HomeBoard` will take | `src/app/app/(shell)/page.tsx:77` | The title comes from the branch: "Get started" on the first-run fork, "Your leagues" otherwise |
| E1 | EXECUTION | HIGH | **The standings are stretched, not dense — and thin.** Measured at 1680 on the week-14 league: four columns across **1 584px**, of which `Record` occupies **646px to hold "8-4-2"** and `Team` 484px; `Points for`/`Points against` are shoved to the right edge at 194/258px. Rows are **47px**. Four columns is the whole table (`standings-table.tsx`: team, record, pointsFor, pointsAgainst) — no streak, no last five, no points per week, no games back, nothing a veteran reads a standings table for in week 14 | `src/league-room/components/standings-table.tsx` | Give the table columns worth the width, or give it a measure; 1 584px of ground for four values is neither dense nor composed |
| E2 | EXECUTION | HIGH | **Pills stretched into bars.** `Save lineup` renders at **1 584px**, `Create invite link` at **1 550px**, and on the first-run panel `Try a mock draft` and `Create league` at **1 550px** each. `rounded-pill` is a 999px radius; at 1 584px it is a stadium bar with two half-circles bolted on. Nothing in the constitution's pill discipline contemplates a full-bleed pill, and the shelf's own rows never draw one | `lineup-editor.tsx`, `invite-panel.tsx`, `first-run-panel.tsx` | A pill is sized to its label; a full-width control is a different object and should not borrow the pill's radius |
| E3 | EXECUTION | HIGH | **The activity feed is a log dump at 83 pixels per fact.** Measured on the one real feed: **38 rows, 3 160px at 1680**, rows 70–90px tall and **1 584px wide** for content that ends around x=700. **Zero `.font-mono` on the whole page.** Every row restamps an absolute timestamp (`Aug 26, 2026, 4:08 AM`) — the same string appears three times consecutively, nine times in the first nine rows. No day grouping, no relative time, though `formatCoarseDuration` is exported from `@/components/ui/countdown` and the wire's honesty contract already made coarse duration this product's house style | `src/league-room/components/activity-feed.tsx` | Group by day, one date header; the row becomes mono time + sentence on one line; drop the per-row absolute stamp |
| E4 | EXECUTION | HIGH | **The feed tells each trade's story backwards, in triplicate.** One trade produces three rows — *"…'s roster swap was reversed." / "…swapped rosters." / "…completed a trade."* — all sharing one timestamp, rendered newest-first, so a reader going top to bottom learns the reversal, then the swap, then the trade. That is machinery, not history: two of the three rows describe the transaction's internals | `src/integrity/activity-view.ts` (`activityRowFor`), `activity-feed.tsx` | One row per event a member would recognize; the swap/reversal pair collapses into the trade's own row |
| E5 | EXECUTION | MEDIUM | **Rule 4 is not held in this cluster: boxes everywhere.** The members panel draws **twelve bordered `surface-elevated` cards with `gap-2` between them — 861px for twelve names**; the waiting checklist draws four to five more; the first-run panel draws five; the league header itself is a bordered card. "Structure comes from thin rules and space, not card borders," and twelve names is a hairline-separated list at roughly 380px | `league-members-panel.tsx:67`, `waiting-checklist.tsx:35`, `first-run-panel.tsx`, `league-home.tsx:177` | Hairline rows, not cards, wherever the thing is a list |
| E6 | EXECUTION | MEDIUM | **The league home opens, for the entire season, with a panel saying the draft finished.** `draftTerminalStatePanel` returns its "Draft complete / Every roster is set / View the draft board" `StatePanel` until `currentWeek > totalWeeks` — measured at **195px at the top of a week-14 page**. `DraftCompleteArrival` (the rich version) already owns the one week when this is news and expires itself correctly at week 2; the plain panel then takes over and stays for sixteen more | `draft-schedule-panel.tsx:104-105`, `league-home.tsx:210` | The terminal panel expires with the arrival card; "View the draft board" survives as a link in the league's own nav row |
| E7 | EXECUTION | MEDIUM | **Four scheduling rules stacked as four one-line paragraphs under the waiting hero.** Measured on a filling league: *"If nobody starts it, we will start it at the scheduled time."* · *"This league fills from the open shelf. The draft starts when the room is full."* (amber, D4) · *"Picks pause automatically between 2:00 AM and 5:00 AM Eastern once the clock reaches an hour or longer, and resume right after."* — plus, inside the hero, *"The room picks for you from your queue if your clock runs out."* Each is honest; together they are a terms-of-service page under a countdown, and the first two name two different start conditions 60px apart | `draft-schedule-panel.tsx` (`autoStartNotice`, `shortRoomNotice`, `overnightPauseNotice`, `hero`) | One line states what starts this draft; the rest moves behind the checklist's own "how this works" item |
| E8 | EXECUTION | MEDIUM | **An empty 384px chat panel is wedged between the standings and the lineup on every league home.** Fixed `h-96` in document flow, rendered unconditionally, reading "Nobody has said anything yet" on all four leagues walked — 384px of the page's most valuable vertical real estate, above the one control the member came for | `league-home.tsx:278` | Chat is a rail or a disclosure, not a fixed 384px band in the middle of the page |
| E9 | EXECUTION | MEDIUM | **Mobile buries the act.** Measured at 360 on the week-14 league: page **5 179px**, and the one thing that needs the member — `Save lineup` — sits at **y=3 095, 60% down**. The scheduled league is worse: the waiting block alone is **1 577px** of a 4 559px page, and everything under it belongs to a season that has not started | `league-home.tsx` | On a phone the promoted action leads; the season scaffolding collapses to disclosures below it |
| E10 | EXECUTION | MEDIUM | **The home board over-spends on the matchup and starves everything else.** Measured at 1680: `League` 366px · **`Matchup` 704px (44% of the table)** · `Margin` 211px · `Action` 187px · `State` 116px, rows 64px. The 704px holds "Commish Lab 121.72 vs Dev Manager 02 113.00" — two names and two numbers — while the action a member is here to take gets 187px | `src/league-room/components/league-board.tsx` (`COLUMNS`) | Two score columns and a team column, mono and tabular; the matchup stops being a sentence |
| E11 | EXECUTION | LOW | **The standings header breaks at 360.** The `Record` column's `InfoTip` note renders one word per line inside the header cell — "Wins, / losses, / and / ties / so / far / this / season" — eight lines of stacked single words in a table head | `standings-table.tsx:92`, `src/components/ui/table.tsx` | The guided note leaves the header cell at narrow widths |
| E12 | EXECUTION | LOW | **The house shelf on a one-league home prints the same 55-word sentence five times.** `describeStartTiming`'s when-full paragraph is correct, quoted, and repeated verbatim in five consecutive rows of the Drafts column — 550px of identical text in a column that should carry a value. The member's own league gets 250px above it; the shelf gets 550px, on a page titled "Your leagues" | `src/league-room/components/open-seats-panel.tsx`, `open-league-shared.tsx` (`DraftTimingNotes`) | The repeated sentence becomes one legend line above the shelf; the column carries the fact |
| E13 | EXECUTION | LOW | **Three headings in 100px on the n=1 home, two of them identical.** `<h1>` "Your leagues" → `<h2>` "E2E Trades League" → the card's own "E2E Trades League". `HomeBoard`'s n=1 branch adds a heading naming the league; `HomeLeagueCard` already names it | `home-board.tsx:232`, `home-league-card.tsx` | The n=1 branch drops its own heading — the card is the heading |
| E14 | EXECUTION | LOW | **A full room paints a 1 470px slab of accent green.** `SeatMeter` at 3-of-3 renders every segment `bg-accent`, and on the n=1 home it is the widest, brightest object on the screen — for a fact that is over. Rule 1 spends green on "seats **filling**"; a full room has stopped filling | `src/components/ui/seat-meter.tsx`, `home-league-card.tsx` | A full meter settles to ink or hairline; green is the fill, not the finish |
| E15 | EXECUTION | LOW | **The activity page has zero ink action and opens with a footnote.** Measured: 0 `bg-text-primary` on the whole page, and between the title and the feed sits a bare muted sentence — *"Lineup changes appear only in your own history. Nobody else in this league can see them."* — a privacy disclosure standing where the feed's first row should be | `src/app/app/(shell)/leagues/[leagueId]/activity/page.tsx:105` | The disclosure moves to the foot of the feed or into a filter's own label; the page's one act is "back to the league" |
| R1 | DIRECTION | HIGH | **A league home is a stack, not a composition.** Twelve sibling full-width sections down **4 238px** at 1680, in the order the file lists them: header · celebration · draft-complete · matchup · standings · chat · lineup · advisor · terms · members · invite · moderation. Nothing is beside anything. Every section is 1 584px wide regardless of whether it holds a 12-row table or two scores, so the whole page reads at one weight and the eye has nowhere to land — the founder's own words about the old shelf ("my eyes don't know where to focus") applied to the room he actually lives in | `league-home.tsx` | Compose: a masthead band (crest, record, seed, this week's score, the one act), a two-column body (standings + members left, matchup + lineup right), the rest behind disclosures |
| R2 | DIRECTION | HIGH | **It does not answer "how am I doing, what needs me now" in one glance — and it holds every fact needed to.** The record is in the header, the score 200px down, the seed folded into a `·`-joined subtitle, the standings 400px down, the act 1 200px down, and nothing anywhere states what needs this member now — even though `LeaguePage` computes `nextActionKind` on every render and passes it in, where it is used for exactly one thing: deciding whether to move the lineup editor up the page | `league-home.tsx` (`headerFacts`, `promoteLineupEditor`), `page.tsx:72` | The masthead states the standing, the margin and the one act, from props already held |
| R3 | DIRECTION | HIGH | **The waiting room does not sell the draft moment; it is a panel inside a season page.** Measured on a filling league: the hero is a `75:14:45` countdown centered in a 1 584px void, and below it the page renders a standings table with one 0-0 row, an empty chat, nine `Empty` lineup slots under a false sentence (D2), a lineup advisor for a team with no players, and a moderation panel. The most exciting screen a new member sees before their first draft — the one that has to make them come back on Thursday — is followed by an entire season's worth of scaffolding for a season that does not exist yet | `league-home.tsx`, `waiting-room.tsx` | Pre-draft is a **state of the page**, not a panel on it: the waiting room IS the league home until the draft completes |
| R4 | DIRECTION | HIGH | **Activity reads as a log, and the league home has no activity at all.** The feed is chronological rows of complete sentences with no shape (E3/E4); meanwhile the page a member actually opens carries no trace of anything that happened — "League activity" is a 13.5px underlined text link in a row with "All matchups" and "Trades." The one product surface where "what did I miss" is the whole question routes to a separate page and answers it with a printout | `league-home.tsx:241`, `activity-feed.tsx` | The league home carries the last few real events as a band; the feed page becomes the deep version of that band |
| R5 | DIRECTION | HIGH | **The Sunday Standard's signature is absent from the cluster with the most material for it.** Zero wire, zero live band, zero mono density anywhere in the league life: `mono` counts 47–51 on a league home (all `EYEBROW` labels), **0 on the activity page**. `Wire` is built and honest, `MockWire` is built and honest, `PickWire` is built and honest — three ticker implementations in this repo, and the league a member pays to be in has none. Same diagnosis the lobby and results reviews made, now on the third surface in a row | `src/league-room/components/wire.tsx`, `mock-wire.tsx`, `league-home.tsx` | One band of this league's own real facts on the league home, fed by `listLeagueActivity`, under the same three commitments (request-time truth, real-or-nothing, actor-free) |
| R6 | DIRECTION | MEDIUM | **`/app` has no cap, no grouping and no search — it renders every league a member is in, forever.** Measured on the founder's seeded account: **103 rows, 7 602px, 103 rail crests, 41 leagues needing action**, an attention queue capped at 3 chips, and the sentence "And 38 more in the board below." The count is seed pollution and is not the finding; the **shape** is — the board has one form for one league and one form for all of them, with nothing between, and the queue's honest cap hands the overflow to a 7 602px scroll. A member in twelve leagues has no way to see only the ones that need them | `home-board.tsx`, `league-board.tsx`, `attention-queue.tsx` | Section the board (needs you · live · idle) and let the queue's remainder filter the board rather than describe it |
| R7 | DIRECTION | MEDIUM | **First run points at the wrong door with the loudest voice.** The copy order is right (mock → find an open league → invite → start), but the visual weight inverts it: "Browse open leagues" is an underlined text link, while "Create league" is a **1 550px ink slab** at the bottom of the page. And `HomeBoard` suppresses `OpenSeatsPanel` entirely on the first-run fork, so the one screen where the house's promise should BE the screen shows no real league at all — it shows a link to one. "House leagues are the core" (founder, 2026-08-22) | `first-run-panel.tsx`, `home-board.tsx:210` | The house shelf renders inside the first-run panel, with real leagues and real seat counts; "find an open league" carries the ink |
| R8 | DIRECTION | — | **The `/app/leagues` route is a redirect, and the rail still links leagues one crest at a time.** `LeaguesPage` is nine lines of `redirect("/app")`, which is right — one page, not two. But the decision was never carried into the rail, which renders one crest per league with no overflow behavior and no "all leagues" target now that the list page is gone | `src/app/app/(shell)/leagues/page.tsx`, `src/components/app-shell/**` | Persona-adjudicate: either the rail caps and points at `/app`, or `/app/leagues` comes back as the real index the rail overflows into |

Counts: **5 DEFECT · 15 EXECUTION · 8 DIRECTION.**

## The per-surface walk

**S1 · `/app`, the home board, 1680 dark (`revA-app-home-dark-1680.png`).** The dense multi-league
table is the best-composed object in this cluster and the only one that reads as designed: crest,
name, record at one step of extra weight (D5's own law, held), the matchup, a margin meter whose
label is the signed subtraction, one quiet action per row, a state chip. Sorted by whether the
manager is needed, then by how close the game is — a real subtraction, never a probability. It is
also, at 1680, mostly gutter: 44% of the table is the matchup sentence (E10). Above it the
attention queue does exactly the right thing — one ink chip on the single most urgent act, quiet
chips behind it — and then hands 38 more to a 7 602px scroll (R6). Visible ink on this page: **one**
(the queue's top chip; `Create league` sits inside a collapsed `<details>`). Rule 5 is held here.

**S2 · `/app`, n=1 (`revA-n1-dark-1680.png`).** Three headings in the first 100px, two identical
(E13). The member's own league gets a 250px card whose loudest element is a 1 470px slab of accent
green announcing that a full room is full (E14); the house shelf below it gets 550px and repeats
one 55-word sentence five times (E12). On a page titled "Your leagues," the shelf outweighs the
league two to one.

**S3 · `/app`, first run (`revA-firstrun-dark-1680.png`).** Honest, ordered, plain-language, and
every path is a real working control rather than a link that describes one — the panel's own rule,
kept. Five bordered cards down 1 502px (E5), an `<h1>` that names something the reader does not have
(D5), and a 1 550px ink slab on "Create league" at the very bottom while the door the product
actually wants opened is a text link (R7, E2).

**S4 · A league home, week 14 (`revA-season-dark-1680.png`).** 4 238px, twelve stacked sections,
four visible ink pills (D1). It opens with a green congratulation band, then a 195px panel telling
a member in week 14 that their draft is complete (E6), then the week's score, then a standings
table with 646px reserved for "8-4-2" (E1), then 384px of empty chat (E8), then the lineup —
whose `Save lineup` runs the full 1 584px (E2) — then the advisor, the terms, twelve bordered
manager cards at 861px (E5), the invite panel, moderation. Every fact on this page is true and
well-worded. Not one of them is composed against another.

**S5 · A league home, pre-draft (`revA-sched-dark-1680.png`, `revA-whenfull-dark-1680.png`).** The
countdown is beautiful and correctly built — `xl` mono digits, tabular, real instant, coarse
`role="status"` sibling — and it is marooned in a 1 584px void with four paragraphs of scheduling
law beneath it (E7), one of them amber for no reason (D4), one of them contradicting the clock
above it. On the scheduled fixture the digits read `0:00`, which is honest ("starting any moment")
and visually dead. Then the page renders a season that does not exist: a one-row standings table of
zeroes, an empty chat, nine `Empty` lineup slots under a sentence that blames week 1 for starting
(D2), an advisor for a rosterless team, and a commissioner's ink `Start the draft` pill directly
above the amber sentence explaining that pressing it will be refused (D3). This is R3 in one
screenshot.

**S6 · `/app/leagues/[id]/activity` (`revA-activity-real-dark-1680.png`, and the empty case).** 38
rows, 3 160px, zero mono, zero ink, an absolute timestamp on every row repeated three at a time,
and each trade told backwards in three parts (E3, E4). The empty case is worse in a quieter way:
`dev_league_season` — a fully drafted, fourteen-week, twelve-team league with six clinched teams —
renders "Nothing has happened here yet." Whatever the allowlist is doing, a season's worth of
completed weeks produced no member-visible history at all, and the page a member opens to ask
"what did I miss" answers "nothing, ever."

**S7 · Mobile, 360 (`revA-season-dark-360.png`, `revA-sched-dark-360.png`, `revA-activity-real-dark-360.png`).**
The rail linearizing into a horizontal crest strip is genuinely good, and the standings table
scrolls inside its own wrapper as the constitution requires (measured `scrollWidth` 401 vs
`clientWidth` 328). Everything else is the desktop stack, taller: 5 179px on the season league with
the one act at 60% depth (E9), 4 559px on the pre-draft one of which 1 577px is a waiting room
followed by 2 982px of a season that has not started, 5 020px of activity. And the standings header
cell breaks to one word per line (E11).

**S8 · Light (`revA-whenfull-light-1680.png`).** Structurally identical and honestly designed
rather than inverted. The amber sentence measures `rgb(132,99,21)` on `rgb(251,251,250)` — it
clears the threshold, so D4 is a semantics finding and not a contrast one. The stretched pills read
worse here: a 1 584px white bar on bright paper is the loudest object on the page, and it says
"Save lineup."

## The member's first thirty seconds

She joined a house league on Tuesday, and this is Thursday morning, on her phone, and she is
checking whether the draft is tonight.

**Seconds 0–5.** The rail's crest strip, then her league's name, then the clock: `75:14:45`. Good —
this is the product doing what it promised. She reads the line under it: Sunday, August 30, in
three days. Then the next line, in amber: *the draft starts when the room is full.* So which is it?
Then a third line about nobody starting it automatically, and a fourth about picks pausing between
2 and 5 AM Eastern (E7, D4). She has read four rules and does not know when her draft is.

**Seconds 5–15.** She scrolls, expecting the room. She gets a league standings table with one row
reading 0-0, 0.00, 0.00 — herself, against nobody. Then an empty chat box, 384px of it, saying
nobody has said anything (E8). Then "Week 1 lineup," nine rows reading `Empty`, and the explanation:
*Week 1 has started, so its lineup cannot change* (D2). She has not drafted. Week 1 has not started.
The only sentence the product offers her about a screenful of `Empty` is false, and the honest
reading of it is that she has already missed something.

**Seconds 15–30.** Past the lineup advisor she cannot use, past the league terms, past the members
list, to the bottom: a bright bar reading "Create invite link" (E2) and a note about moderation.
She scrolls back up to the only thing she wanted, the checklist, and finds it — four bordered cards
including a good one ("See how the draft room works — Preview the room · Run a mock draft") that is
the single best thing on this page and is 700px below the fold on a phone. Verdict: the draft
moment exists in this product, it is well built, and it is buried inside a page designed for
somebody else's November. Fix D2 and R3 — make pre-draft a state of the page rather than a panel on
it — and the same thirty seconds end with her running a mock draft, which is the only outcome this
surface exists to produce.

## Prioritized remediation

**Before this ships to strangers (the compact fix pass):**

1. **D2** — a league that has not drafted renders no lineup editor and no advisor. One condition in
   `LeagueHome`, and the false sentence stops being reachable. This is the highest-leverage single
   line in the review.
2. **D1** — the ink count. `LeagueHome` owns the choice, from the `nextActionKind` it already
   receives; `LineupEditor`, `LeagueChat`, `AdvisorPanel` and `InvitePanel` take an `emphasis` prop
   and default quiet. Add a component test asserting at most one `bg-text-primary` per rendered
   league home, the same way `OpenLeagueShelf`'s own test does for the shelf.
3. **D3 + D4** — a public matchmade league with open seats offers no start control; the two
   `text-warning` sentences become `text-text-muted` and lose `role="status"`.
4. **E6** — the terminal "Draft complete" panel expires with `DraftCompleteArrival`, not with the
   season.
5. **E2** — the four full-bleed pills stop being pills.
6. **E1 + E5** — the standings get columns worth 1 584px (or a measure), and the members panel and
   the checklist become hairline rows. Rule 4, applied to the two lists that most obviously want it.
7. **D5, E11, E13, E15** — the first-run title, the 360 header cell, the duplicate n=1 heading, the
   activity page's floating footnote.

**After (the composition pass, in order of leverage):**

1. **R3** — pre-draft becomes a state of the league home, not a panel inside it. This is the change
   that fixes the first-timer's thirty seconds, and it deletes more code than it writes.
2. **R1 + R2** — the league home's masthead and two-column body: standing, margin, and the one act
   in the first 200px, from props the page already holds. E8 and E9 fall out of it.
3. **R4 + R5** — the league's own wire band on its home page, and the feed page rebuilt as the deep
   version of it (E3, E4 are its first two fixes). Three ticker implementations already exist; this
   is a fourth caller, not a fourth invention.
4. **R7** — the house shelf renders inside the first-run panel with real leagues, and "find an open
   league" carries the ink. E12's repeated sentence gets fixed here, once, for both callers.
5. **R6** — the board sections itself and the queue's remainder filters rather than narrates.
6. **E10** — the board's columns, after R6 settles what the board is for.
7. **R8** — persona-adjudicated: the rail's overflow behavior, and whether `/app/leagues` comes back
   as a real index. Do not decide this one from the founder's 103-league fixture.

**Not adjudicated here, flagged for the next reader:** S6's empty feed on a fully played league is
either an allowlist gap in `activityRowFor` or a seeding artifact. It is a data question, not a
design one, and it should be answered before R4's band is built on top of it — a wire fed by a
source that returns nothing would fail the real-or-nothing commitment by rendering nothing forever.

---

*Method footnote: all geometry, computed styles, column widths, row heights, ink counts and page
heights read from the live DOM of the real built app at `4da6f8a` against four seeded sessions
(`manager-a`, `manager-b`, `manager-c`, `manager-zero`) and four league states — a played
fourteen-week season, a scheduled draft, a filling public league, and a 38-row activity feed.
Read-only review: no source file changed, no commit made, no seeded league mutated, no server
stopped.*
