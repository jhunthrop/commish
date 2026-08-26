# Draft room — first full design review (2026-08-26)

The room was retone-only through design v3 (`docs/design-system.md`, "Signed-in surfaces and the
draft room: retone only") and was never mocked — `docs/research/sunday-standard.html` covers the
front door alone. Three live defects (board fade, edge smear, rail overflow) have since been fixed
on main (`723ad19`). This is the composition review the room never had, ordered by the founder,
judged against the six rules and the bar he set verbatim: "most premium experience in the fantasy
world... sleek, modern, beautifully simplistic but high information density... maximize full
screen width... most efficient workflows... best app I've ever seen or used." The stakes: Phase
4.5 makes this room the first surface strangers experience.

## Method

Judged the real rendered room, not the code's intentions — the same harness idiom the two live-
defect fixes established (`board-fade-report.md`, `room-overflow-report.md`): the real, unmodified
components (`SnakeRoom`/`AuctionRoom`/`TvBoard`/`RoomTour`, with the real `LeagueChat` aside)
rendered through the repo's RTL/happy-dom harness against a realistic fixture — 12 teams, 15
rounds, 153 ranked players, real chat messages — DOM captured, wrapped in the actual Next-built
Tailwind CSS (compiled at `723ad19`), screenshotted with Playwright (Chromium) at 2000/1440/360px
in both themes, across eight states: scheduled, you-on-clock (round 3), someone-else-on-clock,
the pick moment, deep round 12, live auction lot, first-visit (RoomTour open), and the TV board.
No server started, no DB touched, no source file changed. Screenshots (this machine):
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/room-review/shots/`.
Harness artifacts to discount when reading them: the TV shot's "Connecting…" chip (the fixture
never fires `open`; real rooms go quiet), and wide-board shots resting at the left edge
(happy-dom's `scrollIntoView` is a no-op; the real room centers the on-clock cell).

## Executive verdict

The bones of this room are genuinely excellent — the four-band frame, the sticker board, the
one-clock rail, and the engine-owns-every-rule discipline are a foundation most fantasy products
never reach, and the deep-round board at 2000px is the single strongest image the product makes.
But the founder would not yet call this the best app he has ever used, because the room breaks
its own laws at exactly the moments that matter most: on your turn the view fills with up to
sixty ink pills against a one-ink law, the same "on the clock" fact is spoken in money-green on
the board and live-red in the rail, and every landing pick physically shoves the board down and
back — the reflow this room's own contract exists to forbid. On a phone — the body most
strangers will arrive in — the mid-draft page pans sideways into a 186px void and the clock
scrolls away while the Draft button stays, so the essential loop (see clock, see pool, pick)
does not hold at 360px. The dead time between picks, which is 95% of a draft, has nothing alive
in it but chat, while the Sunday Standard's signature move — real events streaming — never
entered the room it would serve best. A compact fix pass closes the defects and the color
grammar before mock drafts ship; the room's move from "disciplined" to "best I've ever used" is
the direction work listed last.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT | HIGH | At 360px mid-draft the page scrolls horizontally into a 186px empty void (scrollWidth 546 vs 360, Chromium): the first queue chip's box leaks past the queue `<ol>`'s `overflow-x-auto` clip into the page's scrollable overflow — reproduced with real DOM + real compiled CSS; hiding the first chip or `contain: layout` on the `<ol>` restores 360, `overflow-hidden` on the parent does not | `src/draft-room/components/room-dock.tsx` (QueueChips `<ol>`) | Add layout containment to the queue rail (`contain: layout` verified in-browser) and an e2e assertion that a mid-draft room with queued players has no page-level horizontal overflow at 360px |
| D2 | DEFECT | HIGH | `PickCelebration` (and `NudgeBanner`) render in-flow above the board, so every landing pick pushes the entire board down ~64px and snaps it back 2.4s later — ~180 reflows per draft, in direct violation of the room's own "nothing reflows when state changes" law | `src/draft-room/components/room-shell.tsx` (stage column) | Reserve a fixed-height stage slot for banner/celebration (empty band when quiet) or float the celebration over the board |
| D3 | DEFECT (design law) | HIGH | Rule 5 broken by construction in the room's peak state: `PlayerPool`'s per-row act button, its "All" filter, and its empty-state button all take `Button`'s default `variant="primary"` — on your turn the view shows up to 60 solid ink pills beside the dock's one true ink action | `src/draft-room/components/player-pool.tsx` | Pool row buttons become `variant="secondary"`, "All"/empty-state become ghost/secondary; add a component test asserting at most one ink pill per rendered room |
| E1 | EXECUTION | MEDIUM | One fact, two colors: the board's on-clock cell is `ring-accent`/`text-accent` (money-green) and the "You" column marker green, while the rail says "You're on the clock" in live-red with a red clock — rule 1 assigns clocks and live to red, and the split is loudest at the emotional peak | `src/draft-room/components/draft-board.tsx` (on-clock cell, header ring) | Move the on-clock cell (ring, label, spotlight breath) to the negative family; decide once whether the "You" column marker stays money |
| E2 | EXECUTION | HIGH | Below `lg` only the dock sticks; the rail — the room's ONLY clock — scrolls away, so a phone user deep in the pool acts against an invisible clock: the essential loop (see clock, see pool, pick) does not hold at 360px | `src/draft-room/components/room-layout.tsx` / `room-dock.tsx` | Put a compact countdown (and turn label) into the sticky dock below `lg`, sharing the rail's one `useCountdown` |
| E3 | EXECUTION | MEDIUM | On-turn mobile workflow: the pool linearizes after the full board, so "Your pick. Take somebody from the pool." points at content thousands of px away (mid-draft page ≈6,100px; deep draft ≈10,300px tall) | `src/draft-room/components/room-layout.tsx` | On `canAct` (or always) surface a dock "jump to pool" affordance, or reorder pool above board while on the clock; consider collapsing completed rounds behind per-round disclosures |
| E4 | EXECUTION | MEDIUM | At 1440px with chat open the stage shows ~4.3 of 12 board columns (`min-w-32`/`min-w-40` stickers × 12 + two 352px rails); your own column and the on-clock cell are routinely off-viewport, and auto-scroll follows only the current pick | `src/draft-room/components/draft-board.tsx` (CELL_MIN_WIDTH) | Add a denser sticker step below `xl` (or an initials-density toggle), and/or auto-collapse chat under a width threshold |
| E5 | EXECUTION | MEDIUM | The TV board's countdown never goes hot — `tone` is mine-based and the TV has no "me" — so the shared party clock stays white even in the final seconds; rule 1 says clocks are red | `src/draft-room/components/room-rail.tsx` (tone), `countdown.tsx` | Give the countdown a time-based hot threshold (e.g. final 30s) on the TV variant at minimum |
| E6 | EXECUTION | MEDIUM | The TV spotlight band restates the rail's fact ("Now picking" + name) in a mostly empty full-width card with a small initials avatar, while the big countdown sits far away in the rail's corner — the panel isn't yet designed for a TV across the room | `src/draft-room/components/tv-board.tsx` | Fold the oversized countdown and the last pick landed into the spotlight band; keep the rail quiet |
| E7 | EXECUTION | MEDIUM | Through the early-mid draft (the first hour) ~60% of the stage is empty future rows and bare surface; on the TV variant the void is larger — high information density is the bar, and this is the room's least dense region | `src/draft-room/components/draft-board.tsx` | Render future rounds only to active+2 with one quiet "12 rounds ahead" rule line (the grid already scrolls; the season's shape can be a number, not 140 empty cells) |
| E8 | EXECUTION | LOW | Every queue chip carries three always-visible ghost buttons (←→×) — 15 controls idling in the dock; keyboard operability is right, the permanent visual weight is not | `src/draft-room/components/room-dock.tsx` | Reveal per-chip controls on hover/focus-within, keeping the buttons in the DOM for keyboard/AT |
| E9 | EXECUTION | LOW | Hot-state redundancy in the rail: "Your team: Turf Burners" sits beside "You're on the clock · Turf Burners" | `src/draft-room/components/room-rail.tsx` | Suppress the team chip while `turn.mine` |
| E10 | EXECUTION | LOW | The chat aside undercuts the quiet room: a permanent five-emoji reaction row under every message and a "Report" link on each — the noisiest surface in the frame (chat-room scope, visible here) | `src/chat-room/components/*` | Move reactions/report behind a hover/long-press affordance |
| E11 | EXECUTION | LOW | Scheduled-room copy nits: dock says "Watching the board." before there is anything to watch; the pre-start pool prints a 60-row column of "—" placeholders | `src/draft-room/state/format.ts` / `player-pool.tsx` | A scheduled-phase fallback sentence ("Waiting for kickoff."); drop the per-row dash entirely |
| R1 | DIRECTION | — | The dead time between your picks (95% of a draft) has nothing alive but chat: the celebration lasts 2.4s and the room is otherwise static. The Sunday Standard's signature — real events streaming (the wire) — never entered the room it would serve best; a quiet pick ticker (real picks only, rule 6-honest) across the stage and the TV board is the single highest-leverage premium move available | `src/draft-room/components/room-shell.tsx` / `tv-board.tsx` | Design a room wire: last N picks as one mono line under the rail (room) and a larger band on TV |
| R2 | DIRECTION | HIGH (for 4.5) | The scheduled room tells the wrong waiting story for the acquisition funnel: no kickoff countdown anywhere in the room, and "Your commissioner starts it when everyone is here." is false for house/auto-start/mock leagues — a stranger waiting in their first mock reads a sentence about a commissioner who does not exist | `src/draft-room/components/room-rail.tsx` (scheduled StaticState) | Rail carries the kickoff countdown and trigger-aware copy from the `describeStartTiming` authority before mock drafts ship |
| R3 | DIRECTION | — | `RoomTour` is a centered text-only modal covering the room it describes; for the stranger funnel an anchored tour (point at the clock, the queue, the pool, in place) plus a mock-draft framing sentence would orient faster than three paragraphs | `src/draft-room/components/room-tour.tsx` | Prototype an anchored three-stop coach-mark tour for Phase 4.5; keep the modal as the reduced-motion/AT fallback |
| R4 | DIRECTION | — | The board scans (position colors genuinely carry the read) but does not yet tell the draft's story at a glance: runs and team needs are derivable only by eye. Candidate: quiet per-column position tallies under each team header. Recorded as an open taste question — restraint may win; adjudicate via personas, not by default | `src/draft-room/components/draft-board.tsx` | Mock both options at density before deciding |
| R5 | DIRECTION | — | The auction bid console is typing-first (input + Bid); a bid war has no one-tap increment. Out of scope if 4.5 mocks are snake-only | `src/draft-room/components/bid-controls.tsx` | Add +$1/+$5 steppers beside the input when auction surfaces matter |

Counts: **3 DEFECT · 11 EXECUTION · 5 DIRECTION.**

## The per-state walk

Shots referenced by filename in the scratchpad `room-review/shots/` directory.

**S1 · Scheduled, dark, 1440 (`s1-scheduled--dark-w1440.png`).** Calm and legible; the pool is
browsable and queueable pre-start (the pre-start "everyone is drafted" bug stays dead). But the
room gives a waiting person no when — no kickoff clock anywhere (R2) — the commissioner sentence
is wrong for house/mock rooms (R2), the dock claims "Watching the board." over an empty board
(E11), and the stage is a full-height void of dashed slivers.

**S2 · You on the clock, round 3 (`s2-hot--dark-w2000/1440.png`, `--light-w1440`, `--dark-w360`).**
The morph works: red eyebrow, red 0:42, faint negative tint across the rail, the dock's left edge
one true button — the two-mode idea lands. Three composition problems: the eye has no single
landing place (clock top-right, action bottom-left, on-clock cell mid-board — the three corners
of a 2000px screen); the board answers the rail in the wrong color (green ring and green "On the
clock" label against the rail's red — E1); and the pool fills with sixty ink "Draft" pills that
shout over the dock's one real action (D3). At 1440 with chat open only 4.3 of 12 columns show
(E4). At 360 the phantom sideways pan reproduces (D1) and the clock scrolls off while the Draft
button stays (E2). Light theme holds the same structure with the same faults.

**S3 · Someone else on the clock (`s3-watching--dark-w1440.png`, `--light-w2000`).** The room's
best state. The pool quiets to stars, rule 5 holds, the dock's standing "You're up in 2 picks
(~3m)." is exactly the right sentence, the white clock reads calm. The two live anxieties are
answered without being asked. This is the discipline the hot state should inherit.

**S4 · The pick moment (`s4-pick-moment--dark-w1440.png`).** "You drafted Omar Calloway!" is the
right sentence in the right green — and it physically shoves the whole board down and back 2.4s
later (D2), and at 1440 the sticker it celebrates slaps off-viewport (E4). The moment the product
should feel most alive is the moment it moves the one thing that must never move.

**S5 · Deep round 12 (`s5-deep--dark-w2000.png`, `--dark-w360`).** The best image the product
makes: eleven full rounds of stickers reads as the poster board, runs and rosters visible, K/DEF
surfacing honestly at the top of the pool, struck-through queue chips telling the truth. The
mobile equivalent is a 10,300px page (E3). This screen is the aesthetic north star the earlier
states should be pulled toward.

**S6 · Auction lot (`s6-auction--dark-w1440.png`).** The rail carries the lot ("Live bid · Idris
Draper · $23") in muted gray — a live bid war reads quieter than a snake turn; sticker prices are
good; the budget table under the pool shows two rows before scrolling; the bid console is an
input and a button (R5).

**S7 · First visit (`s7-stranger--dark-w1440.png`, `--dark-w360`).** The tour's three stops are
the right three facts in the right register, but it is a wall of text floating over the regions
it describes (R3).

**S8 · TV board (`s8-tv--dark-w2000.png`, `--light-w1440`).** Type scale is genuinely
across-the-room readable and the no-`xs` rule shows. But the clock never goes hot (E5), the
spotlight band is a mostly-empty restatement of the rail (E6), the on-clock cell hides at the
right viewport edge, and at round 4 the bottom two-thirds of the party screen is void (E7). The
surface most likely to make strangers say "what app is that?" is the least composed one.

## The stranger's first thirty seconds

She taps a mock-draft link on her phone. Seconds 0–5: a dark, dense, serious room — the league
name, a round-pick line, a clock; it looks like a real product, not a toy, which is the bar
working. Seconds 5–15: the tour modal covers everything; she reads one stop, maybe two, taps
"Got it" — she now knows a clock and a queue exist but not where they live, because the tour
never pointed (R3). Seconds 15–30: she scrolls. The board history rolls past — good, this is
legible — then the page wobbles sideways into empty black (D1: the first thing her thumb learns
is a defect). The clock she was told to fear is gone from the top of the screen (E2). When her
turn arrives she sees "Draft Omar Calloway" pinned helpfully at the top — the queue-first design
genuinely saves her — but if she wants to pivot, "take somebody from the pool" means a long blind
scroll with no clock in view. Verdict: oriented enough to survive her first pick, but the phone
— the body the funnel arrives in — is where the room is weakest, and the first tactile
impression includes a broken pan. Fix D1/E2/R2 and her first 30 seconds become what the desktop
already almost is.

## Prioritized remediation

**Before mock drafts ship (the compact fix pass):**
1. **D1** — contain the queue rail's overflow; add the 360px mid-draft no-horizontal-scroll e2e.
2. **D2** — stop the celebration/nudge reflow (fixed slot or overlay).
3. **D3** — pool buttons go quiet; rule 5 test for the room.
4. **E2** — clock rides the sticky dock below `lg`.
5. **E1** — on-clock cell joins the live-red family (one decision, applied to cell + spotlight).
6. **R2** — scheduled rail gets the kickoff countdown and trigger-aware copy (this is the mock
   funnel's own waiting room).
7. **E9, E11** — two copy/one-liner cleanups riding the same pass.

**After (the composition pass, in order of leverage):**
1. **R1** — the room wire (picks ticker), the premium move.
2. **E5 + E6 + E7** — the TV board composed as a TV surface (hot clock, working spotlight,
   compressed future).
3. **E4** — a denser board step at laptop widths.
4. **E3** — mobile on-turn pool access and completed-round collapse.
5. **R3** — anchored tour for the funnel.
6. **E8, E10** — dock and chat quieting.
7. **R4, R5** — persona-adjudicated taste calls.

---

*Method footnote: all states rendered from real components at `723ad19`; fixture data is
synthetic but shaped to production reality (12 teams, standard 15-slot roster, ADP-ordered pool).
The D1 defect was verified in Chromium only (the installed engine); cross-engine behavior
unverified, but Chromium is the dominant mobile engine and the fix is engine-agnostic
containment.*

---

## Disposition ledger (appended 2026-08-26, after the two remediation passes)

**The compact fix pass** (pre-mock, merged at 5b8814d): D1 contain:layout + 360px e2e; D2 fixed-height stage slot; D3 quiet pool pills + rule-5 test; E1 on-clock cell to the live-red family; E2 compact clock in the sticky dock below lg; E9 team-chip suppression while mine; E11 null-on-live fallback + dash removal. **R2** landed with Phase 4.5 Task 10 (trigger-aware waiting story off `describeStartTiming`, kickoff countdown on the rail).

**The composition pass** (branch worktree-room-composition, merged 2026-08-26): **R1** the room wire (`PickWire` — six newest real picks, one mono line, room + TV scale). **E5** time-hot TV clock (`spotlightClockTone`, ≤30s, boundary-pinned). **E6** the spotlight band owns the TV's one clock + quiet last-pick restatement; the TV rail's in-progress countdown removed. **E7** TV rounds beyond active+2 collapse to a sticky-pinned "N rounds ahead" line (room keeps the sliver recede). **E4** denser `min-w-28` board floor below lg + chat auto-collapsed below xl (post-mount media read — the hydration-safe shape, source-pinned). **E3** "Jump to the pool" ghost affordance in the sticky dock while on the clock, reduced-motion honest. **R3** anchored coach-mark tour (`CoachMarks`, outline highlight, Got-it-dismisses-from-any-stop), modal byte-identical as the reduced-motion/missing-anchor fallback; the whole decision resolves pre-paint. **E8** queue chip controls reveal on the chip's intent (`@media(hover:hover)`-gated, touch always-on, opacity-only). **E10** chat reaction prompts + Report reveal on the row's intent; landed counts never hide. **R5** +$1/+$5 bid steppers, ceiling-clamped. **R4** adjudicated NO-SHIP by the persona panel (mock at 12-team density: the tally line reads as texture; the position color field already carries the story) — closed as decided, not deferred.
