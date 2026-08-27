# Mock drafts lobby — first full design review (2026-08-26)

The lobby (`/app/mock-drafts`) and its share-link sibling (`/app/mock-drafts/[code]`) shipped in
Phase 4.5 Task 9 and were never mocked, never persona-walked, and never reviewed against the six
rules. The founder asked directly: "has this page gone through the jony ive of fantasy review?"
It had not. This is that review, in the same format and against the same bar as
`docs/research/2026-08-26-draft-room-design-review.md`: "most premium experience in the fantasy
world... sleek, modern, beautifully simplistic but high information density... maximize full
screen width... most efficient workflows... best app I've ever seen or used."

The stakes are specific and they are not the room's. Phase 4.5's funnel is: front door →
"Try a mock draft" (`PracticeEntryLink`) → **this page** → the room. The room review already
raised the room to the bar. This surface is the doorway in front of it, and a stranger who came
to *try the product* meets a settings form before they meet the product.

## Method

Judged the real rendered page, not the code's intentions. The real built app at
`http://localhost:3102` (branch `worktree-board-faces`), driven with Playwright/Chromium against
the real seeded session (`e2e/.auth/manager-a.json`) — real Postgres, real SSR read, real
`MOCK_CONFIG`. Full-page screenshots at 1680px in both themes and at 360px, plus five driven
states: the fold at 1680, the Randomize interaction, an **open-rooms** state created by
`POST /api/mock-drafts` in lobby mode (share code `Z9XYBCUU`, 12 teams, 60s), and that room's
own share landing at 1680 and 360. Geometry, computed styles, ink-pill counts and page/document
heights read out of the live DOM rather than eyeballed. Contrast ratios computed from
`src/design/tokens.ts` directly (engine-independent arithmetic, not a screenshot sample).
Read-only: no source file changed, no commit, no server touched. Shots (this machine):
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/`
(`lobby-*.png`) and `.../scratchpad/mocklobby/`.

One harness artifact to discount when reading the full-page shots: the seeded `manager-a` account
holds ~126 leagues, so the shell's league rail is far longer than any real member's will be. The
*unbounded* rail is still a real finding (E11); its 4,920px height here is not a real user's.

## Executive verdict

This page is stacked, not composed: three sections dropped in a column, one boxed and two not,
opening with a seven-control settings panel whose fields stretch to 1,550px to hold two words and
whose ink pill is a 1,550 × 40 bar — and the only genuinely live thing this product owns (a room
filling, a clock running down) is rendered here as frozen prose while the *sibling* share landing
renders the identical room with a real seat meter and a ticking countdown. It reads as an admin
panel for a feature, not as the front room of the thing the front door just promised: it never
says what a mock draft is, never says nothing counts, never says it takes ten minutes, and offers
a first-timer no one-tap way in — while twenty identical `12 teams · 60s clock / Complete` boxes
below re-stage exactly the card stack the founder overturned on 2026-08-24. The compact fix pass
closes four defects and gives the form a measure; the composition pass is where this surface stops
being a form and starts being the product's practice lobby.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT (design law) | HIGH | Every control on this page draws its boundary in `line`, which the constitution says is "**never** the boundary of a control" and which misses WCAG 1.4.11's 3:1 floor by a factor of ~2.6: measured `rgb(36,36,40)` on all 7 fields; `#242428` on `#161619` = **1.17:1** (dark), `#E8E8EA` on `#FFFFFF` = **1.22:1** (light). `Button`'s quiet pill already got this right (`border-edge`, with a docblock explaining why); the field primitives never did | `src/components/ui/select.tsx`, `input.tsx`, `textarea.tsx` | Fields switch to `border-edge`; add a token test asserting every control-boundary role clears 3:1 on all four surfaces |
| D2 | DEFECT (design law) | HIGH | Rule 4 ("hairlines, not boxes") broken by construction in the page's largest region: 20 hand-rolled `rounded-lg border border-line bg-surface-elevated p-3` boxes, 66px each, 1,320px of stacked cards — the exact form the founder overturned on 2026-08-24 ("horizontal row elements instead of these cards - my eyes don't know where to focus"), whose answer already exists in this repo as `LEAGUE_ROW_GRID` + `LeagueRowsHeader` (an EYEBROW column header over hairline-separated `py-3` rows, no per-row border) | `src/league-room/components/mock-lobby.tsx` (both `<ul>`s) | Adopt the shelf idiom: one EYEBROW column header, hairline-separated rows, zero per-row boxes |
| D3 | DEFECT | MEDIUM | The empty-state link is not the button restated — it is `?create=solo`, which server-creates a room at **hard defaults** and redirects (`createMockRoomSchema.parse({ mode: "solo" })`), silently discarding every choice the form 200px above it holds: mode, teams, clock, scoring, roster shape, draft position, team name. Two controls, near-identical labels ("Start a mock draft" / "Start mock draft"), 26px apart, different acts, no warning | `mock-lobby.tsx` (`SOLO_LOBBY_PATH`), `src/app/app/(shell)/mock-drafts/page.tsx` | Either drop the link (the CTA is already on screen) or promote `?create=solo` to an honest, *labeled* one-tap path ("Start a solo mock now — 12 teams, 60s") that never wears the form's words |
| D4 | DEFECT | LOW | A `dissolved` room renders "Closed" beside an action reading "Open room" — the row promises to open the room it just said is gone. `myMockRoomsQuery` applies no status filter, so these rows really can surface | `mock-lobby.tsx` (`STATUS_LINK_LABEL`) | Either exclude `dissolved` from the caller's own list or give it a non-action ("This room cleared itself.") |
| E1 | EXECUTION | HIGH | The ink action is a **1,550 × 40 bar** (measured) — `rounded-pill` at 38:1 aspect is not a pill, and the pill family is this product's entire action vocabulary. Founder-observed | `mock-setup-form.tsx` (submit `Button`) | The CTA sizes to the form column, not the viewport; at a sane measure it is a pill again |
| E2 | EXECUTION | HIGH | Form controls stretched to the viewport: Mode **1,550px** to hold "Solo, play against bots", Team name **1,550px** to hold nothing, and four paired selects at **769px** each to hold "12 teams" / "60 seconds". The full-bleed law governs the **frame**; the constitution's own measured-paragraph carve-out already concedes that content read line-by-line gets a measure, and a `<select>` whose value is two words is the same class of defect ("a 2000px line of body text is not density — it is a defect") | `mock-setup-form.tsx`, `mock-lobby.tsx` | Give the form column a measure (`max-w-2xl`-class) inside a still-full-bleed page; group it as Room · Rules · You rather than seven equal fields |
| E3 | EXECUTION | MEDIUM | "Draft position" + Randomize is housed badly and announced not at all: the select is 1,452px wide and Randomize (90 × 32) sits at x=1557 — **1,460px from its own label**, 8px below the 40px field's baseline via `items-end` on mismatched heights. Firing it silently rewrites the select to "Pick 4th" with no `aria-live` (measured `null`), so a sighted user sees the change and a screen-reader user gets nothing | `mock-setup-form.tsx` | House the pair as one field group at the form's measure, size-matched; announce the drawn slot politely |
| E4 | EXECUTION | HIGH | The one live fact this page owns is frozen prose. An open room prints `startsInSentence` — a request-time string that never ticks — while the **sibling share landing renders the same room** with a real `SeatMeter` and a real ticking `Countdown` (verified: "1 of 12 seated" + `3:00` → `2:58`). Rule 6 is satisfied by not moving, but the thing *is* moving; the lobby simply declines to say so, so a stranger watching a filling room sees a dead page | `mock-lobby.tsx` (open-room `<li>`) | Reuse `useCountdown`/`Countdown` on the lobby row — the deadline is already on the wire (`startsInMs`), no socket, no ruling-10 violation |
| E5 | EXECUTION | MEDIUM | The same row spends no green at all: seats are the text "11 open" where `SeatMeter` — one of the five sanctioned money fills — already renders that identical fact one surface over. Rule 1's money family never appears on the lobby's live region | `mock-lobby.tsx` | Swap the seats clause for `SeatMeter`, matching the share landing |
| E6 | EXECUTION | MEDIUM | Two registers for one feature: the lobby hand-rolls three `text-lg font-semibold text-text-primary` `<h2>`s (measured, identical) while the share landing uses `Panel` (EYEBROW mono + hairline). The lobby declines the primitive built for exactly this, then reimplements a heavier version of it — and its three section heads all weigh the same as each other and nearly the same as the `<h1>` | `mock-lobby.tsx` | Route section heads through `Panel`/`EYEBROW`; let the `<h1>` be the only display weight on the page |
| E7 | EXECUTION | MEDIUM | "Your mock drafts" is an uncapped-feeling wall: 20 rows (the `maxLobbyListing` ceiling, hit exactly on this account) with no count, no "showing 20 of N", no grouping by day, no filter, no way to clear. High information *density* is the bar; 1,320px of the same six words twenty times is the opposite | `mock-lobby.tsx` | Group by day, print the count, collapse beyond the newest few |
| E8 | EXECUTION | HIGH | The rows have zero identity and the data to fix that is **already there**: `MyMockRoomSummary` carries `mode` and `startsInMs` and neither is rendered, and `myMockRoomsQuery` already joins the caller's own seat (`myTeams`) — so "your team's name" is one `select` column on a join that exists, not a new query. Every row reading `12 teams · 60s clock / Complete` is a choice, not a constraint | `mock-lobby.tsx`, `src/mock-draft-service/lobby.ts` | Row becomes `<team name> · <mode> · 12 teams · 60s · <when>`; see R4 for how far past that to go |
| E9 | EXECUTION | LOW | The share landing hand-rolls `mx-4 mt-3` inside a `<main>` that already pads 16px (measured), so the panel sits 32px in while the `<h1>` above it sits at 16px — a visible 16px misalignment on every viewport | `mock-share-landing.tsx` | Delete the wrapper margins; the shell owns the gutter |
| E10 | EXECUTION | MEDIUM | The share landing says "Join this mock draft" as its panel title **and** "Join this mock draft" as its button, 108px apart, and between them says only "12 teams · 60s clock". `summary.mode` is on the wire and never rendered; the word "practice" never appears. This is the first screen a forwarded stranger sees | `mock-share-landing.tsx` | Title states the invitation, button states the act; render the mode and one vetted practice sentence |
| E11 | EXECUTION (shell scope, visible here) | LOW | The league rail is `lg:overflow-visible` and unbounded, so it grows to 4,920px and drags the document to 4,977px while this page's own content ends at 2,280px — **2,697px of void below the fold** (all measured). The rail length is a seeded-account artifact; the missing ceiling is not, and a short page is where it shows worst | `src/components/app-shell/app-shell.tsx` (rail `<nav>`) | Cap the rail's height at `lg` and scroll it inside itself, the way every other outgrowing region in this product already does |
| E12 | EXECUTION | LOW | Two empty sentences on one page, one vetted and one not: "No mock drafts are open right now." is threaded from `MOCK_COPY` through props (ruling 8) and passes `copyViolations`; "You have no mock drafts yet." is a bare string literal in the component that no copy gate has ever seen. And it is a dead end — the constitution's "never a dead end" applies to both | `mock-lobby.tsx`, `src/mock-draft/config.ts` | Move it into `MOCK_COPY` beside its sibling and give it an action |
| R1 | DIRECTION | HIGH (for 4.5) | **Stacked, not composed.** Three sections in one column — a boxed form, then two unboxed lists — ordered settings → who's here → what you did. Both audiences meet the settings panel first: the stranger who clicked "Try a mock draft" and the returner who wants one more rep. At 1680 the composition spends its whole first fold on seven controls and 1,550px of empty select | `mock-lobby.tsx` | Two-column at `lg`+: the act (measured form + one-tap solo) left, the live lobby and your history right; one-column stack unchanged below |
| R2 | DIRECTION | HIGH (for 4.5) | **This page never sells.** It never says what a mock draft is, that it costs nothing, that nothing counts, or how long it takes. `MOCK_COPY.practiceBanner` says all of that in one already-vetted sentence — and shows it only **inside the room**, after the person has committed. The front door sells; this surface administers, and it is the surface the funnel actually lands on | `mock-lobby.tsx`, `src/mock-draft/config.ts` | Lead with the promise (a vetted lobby sentence beside the `<h1>`), then the act; the room's banner stops being the first time anyone is told |
| R3 | DIRECTION | — | **Where is the Sunday Standard's signature?** No wire, no density, no live event, no motion, no color but two link accents. `Wire`/`listWireItems` is this product's signature element and `PickWire` already gave the room its second life; a mock lobby wire ("a 12-team mock filled 4 minutes ago", "3 mocks running now"), real-or-nothing off reads this domain already has, is the one move that turns an empty lobby from a dead form into a place. Highest-leverage premium move available on this surface | `mock-lobby.tsx`, `src/league-service/wire.ts` | Design a practice wire against the wire's existing honesty contract (request-time truth, real-or-nothing, actor-free) |
| R4 | DIRECTION | — | **What makes a history row worth tapping?** Recorded as a taste ladder, not auto-fixed: (a) *when* + *mode* — free, both on the wire today; (b) *your team's name* — one select column on the `myTeams` join that already exists; (c) *your seat and your first pick* ("Pick 4th · took Omar Calloway") — needs a picks join, and is the real memory hook, but it also walks toward the draft-grade authority this product deliberately refuses to invent (`MOCK_COPY.resultsHeading`'s own self-ruling). My read: ship (a)+(b), adjudicate (c) by the persona panel | `mock-lobby.tsx`, `src/mock-draft-service/lobby.ts` | Mock (a)+(b) against (a)+(b)+(c) at 20-row density before deciding |
| R5 | DIRECTION | — | A manual "Refresh" ghost button on a lobby whose entire question is "is anyone here right now?", and none at all on "Your mock drafts" (a room finished in another tab never appears without a reload). Ruling 10 (no anonymous/pre-seat SSE) stands and is right; a client-side interval re-fetch through the same `fetchJson` the button already calls, or at minimum the ticking countdown of E4, needs no socket and breaks no ruling | `mock-lobby.tsx` | Decide once whether this lobby polls; if not, say so in the copy rather than leaving a button that implies the page is stale |

Counts: **4 DEFECT · 12 EXECUTION · 5 DIRECTION.**

## The per-state walk

Shots referenced by filename in the scratchpad (`lobby-*.png`, and `mocklobby/`).

**S1 · Lobby, dark, 1680, empty (`lobby-dark-1680.png`, `mocklobby/fold-1680.png`).** The whole
first fold is a settings panel. Mode stretches 1,550px to hold three words; Team name stretches
1,550px to hold nothing; "Start mock draft" is a 1,550 × 40 white bar. Rule 5 *holds* — exactly
one ink pill in the whole document (verified in the DOM) — but the one it holds is the widest
element on the page. Below the fold: "Open mock drafts" with a Refresh button and nothing to
refresh, an empty sentence, and beneath it a green underlined "Start a mock draft" link that does
something the button above it does not (D3). Then twenty identical boxes (D2), and then 2,697px
of black (E11).

**S2 · Lobby, light, 1680 (`lobby-light-1680.png`).** Structurally identical; the palette is
honestly designed rather than inverted, and the ink bar reads as a black slab rather than a white
one. The field hairlines are *worse* here in ratio terms (1.22:1 on white, D1) and read as
essentially absent — at a glance the light form is six floating labels over a page with no fields
drawn at all.

**S3 · Lobby with one open room, 1680 (`mocklobby/open-rooms-1680.png`).** The state the whole
"lobby mode" exists for, and the page's weakest composition. The row says
`12 teams · 11 open · 60s clock` / `Starts in 3 minutes` with a quiet "Join" pill 1,550px away at
the far right — a live, filling, counting-down room rendered as two lines of dead gray text
(E4, E5). Nothing on this screen moves while a real clock runs.

**S4 · Lobby, 360 (`lobby-mobile.png`).** Genuinely better than the desktop: the form's seven
controls stack to a sane 294px measure, the Randomize button finally sits *beside* the field it
fills, and no horizontal overflow (scrollWidth 360, clean — the room's D1 pathology does not
reproduce here). The failure is length: 2,574px, most of it the twenty boxes (E7). Shell-scope
nit visible in the shot: the top bar's league name wraps to two lines at 360.

**S5 · Randomize fired (`mocklobby/randomized-1680.png`).** It works — the select becomes "Pick
4th" — and that is the entire feedback. No announcement, no motion, no acknowledgment that a draw
happened (E3). The founder asked for a randomize control because drawing a slot is a small piece
of *theater*; today it is a silent value assignment.

**S6 · Share landing, 1680 (`mocklobby/share-landing-1680.png`).** The best idea on either
surface and the worst frame for it: a real `SeatMeter` ("1 of 12 seated", green segment) beside a
real ticking `Countdown` (`3:00`) — the Sunday Standard's signature, present here and nowhere
else in the feature. It is wrapped in a 1,550px panel holding one 12-word sentence and a 1,516px
ink bar, misaligned 16px from the `<h1>` above it (E9), with the panel title and the button
saying the same four words (E10), above 2/3 of an empty viewport.

**S7 · Share landing, 360 (`mocklobby/share-landing-360.png`).** At 360 the same panel is close
to right — the meter and the `2:58` carry it, the button is a real pill, the hierarchy reads. This
screen is the proof that the desktop problem is composition and measure, not content: the *same
markup* is well-proportioned the moment the viewport stops letting it stretch.

## The first-timer's thirty seconds

She clicked "Try a mock draft" on the front door, which promised her a rehearsal. Seconds 0–5:
a dark, serious page titled "Mock drafts" — and then a form. Six dropdowns and a text field. She
did not come to configure anything; she came to see whether this thing is fun, and the product's
first move is to ask her seven questions before it will show her. Nothing on the screen tells her
what a mock draft is, that it costs nothing, that nothing counts, or that it takes ten minutes —
the product has that sentence, vetted, and shows it to her *after* she commits (R2). Seconds
5–15: she leaves the defaults alone (they are good defaults) and looks for the way in. The way in
is a 1,550px white bar spanning her entire monitor (E1) — she finds it, but it reads like a
divider, not a button. Seconds 15–30: if instead she scrolls, she meets "Open mock drafts /
No mock drafts are open right now" — the lobby is empty, which is the honest answer and also the
worst possible first impression for a *social* practice room, because nothing on the page suggests
anyone has ever used this (R3). Below that, twenty identical boxes reading `12 teams · 60s clock /
Complete` (D2, E8) tell her someone has drafted twenty times and tell her nothing about a single
one of them. Verdict: she will probably click the bar and probably enjoy the room, which the room
review already raised to the bar. But this page did not earn that click — the defaults did. Fix
R2, R1 and E1 and the funnel's doorway starts doing the work the front door does.

The forwarded stranger has a different thirty seconds and a better one: `/app/mock-drafts/<code>`
shows her a seat meter filling and a clock at 2:58, which is the most honest and most alive thing
this feature renders. It still never tells her it is practice, and on a laptop it is a bar across
a black field (E10, S6).

## Prioritized remediation

**Before this ships to strangers (the compact fix pass):**
1. **D1** — field boundaries to `border-edge`, with a token test so no control ever draws itself
   in a decorative hairline again. (Primitive scope; fixes every form in the product.)
2. **D2** — the two lists adopt `LeagueRow`'s founder-ordered shelf idiom; twenty boxes become
   hairline-separated rows under one EYEBROW header.
3. **E2 + E1** — the form column gets a measure inside a still-full-bleed page; the ink pill
   becomes a pill again.
4. **E4 + E5** — the open-room row gets the share landing's `SeatMeter` and ticking `Countdown`.
   The deadline is already on the wire; this is reuse, not new architecture.
5. **E3** — Draft position and Randomize become one size-matched field group with a polite
   announcement.
6. **E8** — rows print `mode` and `when` (free today) plus the caller's team name (one column on
   an existing join).
7. **D3, D4, E9, E12** — the four small truthfulness fixes riding the same pass.

**After (the composition pass, in order of leverage):**
1. **R2** — the page states the promise before it states the settings. One vetted sentence.
2. **R1** — the two-column composition, with a labeled one-tap solo path as the first-timer's
   real door.
3. **R3** — the practice wire, against the wire's existing honesty contract. The premium move.
4. **E10 + E6** — the share landing composed as a landing, and one section-head register across
   both surfaces.
5. **E7** — the history grouped, counted, and collapsed.
6. **E11** — the shell rail gets a ceiling (shell scope, benefits every page).
7. **R4, R5** — persona-adjudicated calls: how far a history row goes toward "your first pick,"
   and whether this lobby polls.

---

*Method footnote: all geometry, computed styles and ink counts read from the live DOM of the real
built app at `worktree-board-faces` against the seeded `manager-a` session; contrast ratios
computed from `src/design/tokens.ts` values, not sampled from screenshots, so they hold in any
engine. The open-rooms and share-landing states were produced by creating one real lobby-mode room
through `POST /api/mock-drafts` (share code `Z9XYBCUU`) — it expires on its own under
`MOCK_CONFIG.retention`. Read-only review: no source file changed, no commit made.*
