# Mock draft results — first full design review (2026-08-26)

`MockResults` (`src/draft-room/components/mock-results.tsx`) shipped in Phase 4.5 Task 8 and was
never mocked, never persona-walked, and never reviewed against the six rules. The founder sent a
screenshot of a finished 12-team room and said "this needs a jony ive UX review." This is that
review, in the same format and against the same bar as
`docs/research/2026-08-26-draft-room-design-review.md` and
`docs/research/2026-08-26-mock-lobby-review.md`: "most premium experience in the fantasy world...
sleek, modern, beautifully simplistic but high information density... maximize full screen width...
most efficient workflows... best app I've ever seen or used."

The stakes are the funnel's last frame. The lobby review raised the doorway; the room review raised
the room. This is the surface a stranger sees at the end of the ten minutes the product asked them
for — the screen that decides whether they run another one, go look at real leagues, or close the
tab. It is also the only screen in the feature that survives the room: it lives for 24 hours after
the last pick, and then the sweep deletes it (ruling 13).

**One thing this review does not judge.** `docs/decisions/mock-drafts.md` ruling 5 and D6 refuse a
draft grade permanently: no letter, no score, no invented judgment. That refusal is right, it is
not reopened here, and every remediation below is a fact of this draft's own log. What IS judged is
presentation — including the finding (D3) that the page's current, un-normalized board rank
*implies* a judgment, and implies the wrong one.

## Method

Judged the real rendered page, not the code's intentions. The founder's own two full-page shots
(`results-desktop.png` at 1680, `results-mobile.png` at 360, dark) plus the same completed room
driven live: the real built app at `http://localhost:3102` (branch `worktree-results-review`, HEAD
`9f7f6c9`), Playwright/Chromium against the real seeded session (`e2e/.auth/manager-a.json`), real
Postgres, real SSR read, real snapshot and players routes. The room is
`e9e45559-3f94-4394-9775-8e5ebdb9fbdc`: a genuinely completed 12-team, 15-round snake mock, 180
picks, the caller seated at pick 12 of 12 under the team name "Commish Lab". Geometry, computed
styles, ink-pill counts, landmark counts and page heights read out of the live DOM rather than
eyeballed. Both themes captured at 1680 (`results-light-1680.png`, `results-dark-1680.png`). The
board-rank arithmetic in D3/R2 was recomputed independently from the two routes the component
itself consumes (`GET /api/drafts/[id]` and `.../players`), replaying the pick log in order to
derive best-available-at-each-pick — the same derivation the component could do from the props it
already holds. Read-only: no source file changed, no commit, no server touched. Shots and scripts
(this machine):
`/private/tmp/claude-501/-Users-jh-code-fantasy/d1b45147-2ef6-4dae-8e60-c0a2d552f0c5/scratchpad/`.

Two harness artifacts to discount when reading the live captures: the headless context loads no
Geist face (computed `font-family` falls back to system sans; the founder's own shots show the real
face), and it defaults to `prefers-color-scheme: light`, so the DOM numbers below were read off the
light render. Neither affects a single measurement quoted.

## Executive verdict

This is a receipt, not a debrief: two lists that never speak to each other, dropped into a 768px
column centered in a 1680px viewport, where the left column is the team the person just built
rendered *worse* than the room rendered it ninety seconds earlier — no faces, though every one of
the thirteen skill players on this roster carries a real ESPN headshot the rail was already
showing, and six identical `BENCH` chips that hide two QBs, a TE, two WRs and an RB — and the right
column is fifteen near-identical sentences that name each player twice and never once do the
subtraction the whole column exists for. Worse than dull, the one number the page makes loud is
the one number that is most wrong about what happened: "The board ranked Xavier Walker 698th"
describes a kicker taken in round 15 who was, by that same board's own ranking, the best kicker
still available — the page's raw overall rank manufactures exactly the implied judgment ruling 5
exists to refuse, and points it backwards. A compact fix pass gives the roster the faces and
positions it already has data for, computes the delta, and gives the page one ink action; the
composition pass is where this stops being a printout and becomes the thing a finisher wants to
show somebody.

## Findings

| # | Class | Sev | Finding | File | Remediation (one line) |
|---|---|---|---|---|---|
| D1 | DEFECT (divergence) | HIGH | The results roster is a stale copy of a row the founder already corrected. `RosterRail` and `MockResults` share `rosterFillRows` but not the ROW: the rail (rebuilt 2026-08-26, room-product pass) renders `Avatar` + `player.headshotUrl`, a display-face name, a dashed placeholder for an open spot and the bench hairline; the results roster renders none of it — **0 `<img>` in the results DOM (measured)** while 13 of this roster's 15 spots carry a real ESPN headshot (`/players` verified). The finisher's team is drawn worse on the page *about* his team than it was in the rail beside the board | `src/draft-room/components/mock-results.tsx` (`RosterSection`), `roster-rail.tsx` (`RosterRow`) | Extract `RosterRow` beside `rosterFillRows` and render results from it — share the row, not just the derivation |
| D2 | DEFECT | HIGH | The same component throws away position data it is holding. `SLOT_POSITION[row.slot]` badges the **slot**, not the player, so "FLEX Quentin Johnston" hides a WR (board 92) and six identical `BENCH` chips hide Caleb Williams (QB), Brock Purdy (QB), Dallas Goedert (TE), Rashid Shaheed (WR), Denzel Boston (WR) and Tank Bigsby (RB) — all verified. The rail already rules the other way, in a comment: "a WR filling FLEX shows WR." A team sheet that cannot answer "how deep am I at RB" is not a team sheet | `mock-results.tsx` (`RosterSection`) | Badge `playersById.get(row.playerId).position`, the player's own; keep `SlotChip` for the empty spot only |
| D3 | DEFECT (honesty law) | HIGH | The page's loudest number is its least true one. "The board ranked Xavier Walker 698th" describes the **board's own best available kicker** (K12 of 20, best-at-position delta **0**) taken at pick 180 of a 15-round draft. Overall rank late in a draft is dominated by how many players are gone (168 at that pick), not by judgment — so an un-normalized rank *implies* a verdict, which is the manufactured authority ruling 5 refuses, aimed the wrong way. The same defect quietly buries the draft's best moment: pick 12, Bijan Robinson, was the board's **#1 available player** (delta 0), and the page words it identically to everything else | `src/draft-room/state/format.ts` (`formatBoardDelta`), `mock-results.tsx` | State the pick against the board's own best available AT THAT PICK (and within position) — both facts of the same snapshot; see R2 |
| D4 | DEFECT | MEDIUM | The finisher lands on an orphan. Measured in the live DOM: **0 `<nav>`, 0 `<header>`, 0 `<button>`, 3 links, `document.title` "Commish"**. The constitution lets a room render no shell *because `RoomRail` is the room's chrome* — but the results branch yields the whole frame, so it renders neither the rail nor `AppShell`, and the only route anywhere in the product is three pills 782px down the page | `src/draft-room/components/draft-room.tsx` (results branch) | Give the results branch chrome: either return the member to `(shell)` for results, or keep a minimal rail (wordmark, room name, one exit) above the panel |
| E1 | EXECUTION | HIGH | "Your picks" is a paragraph pretending to be a table: **15 sentences, each opening "You took", each naming the player twice** (30 name repetitions for 15 facts), the one interesting number never computed for the reader and buried mid-sentence. Measured: every `<li>` wraps to 2 lines (36px), 591px of column. Founder-observed | `format.ts` (`formatBoardDelta`), `mock-results.tsx` (`PickList`) | One tabular mono row per pick — pick · face + name · position · the board line — scanned down a column, never read as prose |
| E2 | EXECUTION | HIGH | The composition does not use the screen it is given: `max-w-3xl` = **768px centered in 1680 (`margin: 0 456px` measured)**, so 912px of ground goes unspent, while the two columns run **369px and 591px — 222px of void under the roster**. The full-bleed law governs rooms and `(shell)` pages alike; the measured-paragraph carve-out is for prose a person reads line by line, and a roster and a pick log are records, not prose | `mock-results.tsx` (section `max-w-3xl`, `sm:grid-cols-2`) | Full-bleed frame; the team sheet takes a measure of its own, the pick table takes the width it needs, and the columns stop pretending to be the same length |
| E3 | EXECUTION | MEDIUM | Two sentences say one thing, 30px apart: the practice banner ("...and this room clears itself after a day") sits directly above `resultsRetentionSentence` ("Your results stay here for 24 hours, then this room clears itself") — adjacent in the DOM, verified. Both are vetted copy; the duplication is the composition's | `draft-room.tsx` (`mockChrome` on the results branch), `src/mock-draft/config.ts` | One retention fact per view: the results branch either drops its own line or shows the banner without the clearing clause |
| E4 | EXECUTION | MEDIUM | Rule 5 says "every view gets **exactly one** solid (ink) action"; this view has **zero** (measured: no `bg-text-primary` anywhere) and three identical quiet pills of near-equal width (185/205/162px). The restraint is right about two of them and wrong about the third: "Run another mock draft" is the act this page exists to produce — `MOCK_COPY`'s own docblock calls it "a quick rematch" | `mock-results.tsx` (actions row), `draft-room.tsx` | `runAgain` becomes the page's one ink pill; lobby and browse stay quiet |
| E5 | EXECUTION | MEDIUM | The page never says your seat, the room's shape, or who you played — and all three are free on props today: `view.draftOrder` (12 teams; the caller's index = **seat 12 of 12**), `picks.length / draftOrder.length` (**15 rounds**), and `DraftSnapshotBody.teams` (the team names, already in `DraftRoom`, never passed down — this room's own is "Commish Lab", and eleven seats were practice opponents). Not one of those words appears | `mock-results.tsx`, `draft-room.tsx` | One meta line under the `<h1>`, composed from data the parent already holds |
| E6 | EXECUTION | LOW | Half this surface's copy has never passed a gate. `MOCK_COPY` carries the heading, the retention line and the three labels; "Your roster", "Your picks", "Open" and "You did not draft anyone in this room." are bare literals in the component, and the whole `formatBoardDelta` sentence template is a bare literal in `format.ts` — `copyViolations` has seen none of them. Identical to the lobby review's E12, already fixed once for `lobbyHistoryEmptyMessage` | `mock-results.tsx`, `format.ts`, `config.ts` | Move the results strings into `MOCK_COPY` beside their siblings |
| E7 | EXECUTION | LOW | Two dead ends in a panel built on "never a dead end": "You did not draft anyone in this room." offers nothing, and the `myTeamId === null` branch (a commissioner watching) renders a heading, a retention line and three pills — a page about a draft that says nothing about the draft, for the one viewer who watched all of it | `mock-results.tsx` | The spectator gets the room's completed board and its rosters, which is the only thing they came for |
| E8 | EXECUTION | LOW | Two `<h1>` registers for one job: this branch hand-rolls `font-display text-display-md` (28px measured) while `PageTitle` is "the one `<h1>` treatment for a PAGE." A room supplies its own heading *because it is a room*; once the frame is yielded, this is a page — normal scroll, no rail, no bands | `mock-results.tsx` | Route the heading through `PageTitle` once D4's chrome question is settled |
| E9 | EXECUTION | MEDIUM | What earns the mobile scroll is homework. Measured at 360: page **1489px**, of which the prose block is **634px (43%)**, and the three actions land at **y=1321 (89% down)**. The part worth seeing (the team) ends at ~600px; everything after it is fifteen two-line sentences the reader must subtract in their head | `mock-results.tsx` | On mobile the team sheet IS the page; the pick log becomes a compact tabular block or a disclosure below the actions |
| R1 | DIRECTION | HIGH (for 4.5) | **This is a receipt, not a debrief.** It answers "what did I end up with" and "what did the board say", in two lists that never speak to each other, in the order the code found them. A finisher's questions are: *what is my team*, *how did I do against this room*, *can I do that again*. The one thing he wants first is his team composed AS a team — faces, slots, the shape of it — which is exactly the object the rail already draws and this page redraws worse (D1/D2) | `mock-results.tsx` | Compose: full-bleed team sheet as the hero, the draft's own honest fact-line beside it, the log below, one ink rematch |
| R2 | DIRECTION | HIGH (for 4.5) | **Compute the delta, and pick the honest denominator.** Best-available-at-your-pick is a pure fact of this draft's own log (snapshot order + the picks that preceded it), needs no new data, judges nothing, and does not drift with the round the way raw rank does. Replayed on this real room it produces the headline the page currently hides — pick 12 Bijan Robinson **was** the board's best available; six of fifteen picks were the best available at their own position — and it makes the kicker read correctly. **Register, ruled here rather than left open:** the number carries typographic weight, never color — the constitution's D5 already decided this exact case ("a record may carry typographic weight... never a color, a badge or an animation"), and a green delta is one step from the grade D6 refuses | `format.ts`, `mock-results.tsx` | Derive best-available (and position rank) from the props already held; mono, tabular, weight for the extremes, no color |
| R3 | DIRECTION | — | **The completed board is thrown away at the exact moment it is finally complete.** `view.picks` holds all 180 picks of all 12 teams and `DraftBoard` already renders them; the room review called the deep board "the single strongest image the product makes," and the results branch replaces it with a 768px text column. This is also the answer to "how did I do against the room" that needs no judgment at all — the room's own board says it | `draft-room.tsx` (results branch), `draft-board.tsx` | Keep the finished board under the team sheet (collapsed rounds, the TV idiom), or make results a band over the room rather than a replacement for it |
| R4 | DIRECTION | — | **Where is the Sunday Standard's signature?** Zero color spent, zero mono, no wire, no density, nothing that only this product does — the same diagnosis the lobby review made, on the screen with the most material to work with. `PickWire` is built and already renders real picks in one mono line; a finished room's own closing line (the last six picks of the draft, or the room's biggest swings) is an existing element pointed at existing data | `mock-results.tsx`, `pick-wire.tsx` | Give the results page one mono band of real facts from this room's own log |
| R5 | DIRECTION | — | **Nothing invites sharing or comparing, and the obvious version would rot.** All twelve rosters and the whole board are in props, so a compare view is free — but ruling 13 deletes the room in 24 hours, which makes a share LINK a dead link by tomorrow and a bad first impression for whoever taps it. The honest form is a self-contained artifact (an image or a summary that outlives the room) or nothing. Adjudicate by personas; do not ship the link | `mock-results.tsx` | Mock a compare view and a self-contained shareable against the retention fact before deciding |

Counts: **4 DEFECT · 9 EXECUTION · 5 DIRECTION.**

## What the log actually says (and the page does not)

Replayed from the two routes the component already reads. Every column below is derivable from
`players` + `view.picks`, in the browser, with no new query — which is what makes all of it legal
under the real-only rule.

| pick | player | pos | board rank | pos rank | board's best available then | vs best | vs best at position |
|---|---|---|---|---|---|---|---|
| 12 | Bijan Robinson | RB | 4 | RB2 | **Bijan Robinson** | **0** | 0 |
| 13 | Nico Collins | WR | 13 | WR9 | A.J. Brown | 1 | 1 |
| 36 | Drake Maye | QB | 38 | QB3 | Tee Higgins | 3 | **0** |
| 37 | Emeka Egbuka | WR | 40 | WR21 | Tee Higgins | 5 | 5 |
| 60 | Caleb Williams | QB | 64 | QB7 | Cam Skattebo | 7 | **0** |
| 61 | Bhayshul Tuten | RB | 66 | RB24 | Cam Skattebo | 9 | 9 |
| 84 | Brock Purdy | QB | 90 | QB11 | Michael Pittman Jr. | 10 | **0** |
| 85 | Quentin Johnston | WR | 92 | WR41 | Michael Pittman Jr. | 12 | 12 |
| 108 | Jake Ferguson | TE | 116 | TE12 | Jared Goff | 9 | 5 |
| 109 | Dallas Goedert | TE | 118 | TE13 | Jared Goff | 11 | 7 |
| 132 | Rashid Shaheed | WR | 142 | WR57 | Jordyn Tyson | 11 | 11 |
| 133 | Denzel Boston | WR | 144 | WR58 | Jordyn Tyson | 13 | 13 |
| 156 | Tank Bigsby | RB | 167 | RB54 | Tyrone Tracy Jr. | 19 | 19 |
| 157 | New England | DEF | 174 | DEF6 | Tyrone Tracy Jr. | 26 | **0** |
| 180 | Xavier Walker | K | **698** | **K12 of 20** | Tyrone Tracy Jr. | 550 | **0** |

Three readings the current page makes impossible. **The first pick was the best pick** — at the
turn, the board's top man was still there and he took him; the page words that identically to every
other line. **The draft has a shape**: he took the board's best available at his own position six
times out of fifteen, and drafted a few slots ahead of the board everywhere else, with the gap
widening by round — which is arithmetic, not character, and is exactly why raw rank must not be the
headline. **The scary number is not scary**: 698th is K12 of 20, in round 15, and the board's own
top kicker at that moment. The founder's instinct in the brief ("a kicker at 179 ranked 675th is
actually fine") is not a nuance the page should hint at — it is a defect the page should stop
creating.

## The per-state walk

**S1 · Desktop, 1680, dark (`results-desktop.png`).** The first impression is honest and quiet,
which is the bar working — this does not look like a toy. Then the eye has nowhere to go: a 768px
column marooned in the middle of a 1680px screen (E2), a left list that stops 222px above the right
one, and a right list that is a wall of gray sentences all beginning with the same two words (E1).
The 13 faces the room was showing a minute ago are gone (D1). Nothing on the screen is his team's
name, his seat, or the room he beat (E5). The three exits are three identical quiet pills that
answer "what now" with a shrug (E4).

**S2 · Desktop, 1680, light (`results-light-1680.png`).** Structurally identical and honestly
designed rather than inverted; the position badges carry more weight on paper than on ink, which
helps the roster and does nothing for the prose. The void reads worse here — 912px of bright empty
paper around a narrow column.

**S3 · Mobile, 360 (`results-mobile.png`).** The better of the two, for the same reason the lobby's
360 was: the column stops pretending. The roster reads cleanly as a list and the actions are real
pills. The failure is what the 1489px scroll buys — 634px of it is the prose block (E9), and the
way out sits at 89% depth.

**S4 · The spectator (`myTeamId === null`, source-read).** A commissioner who watched the whole
room gets a heading, a retention sentence, and three pills. Nothing about the draft they just
watched (E7).

## The finisher's first thirty seconds

He is on the phone, at the turn, seat 12 of 12, and the last pick just landed. Seconds 0–5: the
board vanishes. Everything he was looking at for ten minutes — his rail, his roster, the sticker
grid, the wire — is replaced by a heading and a sentence about deletion, said twice (E3). Seconds
5–15: he scrolls to his team, and it is the same fifteen names he already knew, drawn plainer than
the rail drew them: no faces (D1), and six rows that just say `BENCH` where he wants to know whether
his second RB is worth anything (D2). Seconds 15–30: "Your picks" — the part he actually came for.
He reads two sentences, notices both name the player twice, starts doing arithmetic in his head at
sentence three, and stops (E1). At the bottom of the column one number jumps out — **698th** — and
the only story the page has told him is that he did something stupid with his last pick, which is
false (D3). What actually happened, and what he will never learn here, is that his FIRST pick was
the best player on the board and he took the board's own top man at his position six times.
Verdict: he ran a good draft and the product told him nothing, then implied something wrong. He
taps one of three identical pills, or nothing. Fix D1, D2, D3 and E4 and the same thirty seconds
end with him tapping "Run another mock draft" — which is the only outcome this surface exists to
produce.

## Prioritized remediation

**Before this ships to strangers (the compact fix pass):**
1. **D1 + D2** — the results roster becomes the rail's row: faces from `headshotUrl`, the player's
   own position badge, the dashed open spot, the bench hairline. One extracted `RosterRow`, two
   callers, no third drawing of the same object.
2. **D3 + R2's arithmetic** — the delta is computed and normalized: best available at that pick,
   and position rank for every pick (which is what makes K and DEF read honestly). Mono, tabular,
   weight for the extremes, no color. Ruling 5 is untouched: every number is a fact of this
   draft's own log.
3. **E1** — the sentences become rows. The player's name appears once.
4. **E4** — "Run another mock draft" becomes the page's one ink pill.
5. **E5** — one meta line: team name, seat, rounds, practice opponents. All free on props today.
6. **E3, E6, E7** — the duplicated retention fact, the ungated strings, the two dead ends.
7. **D4** — decide where results lives: shell page, or room-with-minimal-rail. It is a page today
   wearing a room's exemption.

**After (the composition pass, in order of leverage):**
1. **R1** — the debrief composition: full-bleed, team sheet as hero, log beside it, one ink act.
2. **R3** — the finished board survives the finish. The strongest image the product makes should
   not be deleted by the screen that celebrates it.
3. **E2 + E9** — measure and mobile fall out of R1: the frame goes full-bleed, the columns stop
   being twins, and the phone leads with the team.
4. **R4** — one mono band of this room's own real facts; the signature this feature still does not
   have on any surface but the share landing.
5. **E8** — one `<h1>` register, after D4.
6. **R5** — persona-adjudicated: compare and share, against ruling 13's 24-hour delete. A link
   that dies tomorrow is worse than no link.

---

*Method footnote: all geometry, computed styles, landmark counts and ink counts read from the live
DOM of the real built app at `9f7f6c9` against the seeded `manager-a` session and one genuinely
completed 12-team mock (`e9e45559-3f94-4394-9775-8e5ebdb9fbdc`). The board-rank table was computed
by replaying that draft's own pick log against the same ranked player snapshot the component
consumes, so every column in it is reachable from the props `MockResults` already receives. Read-only
review: no source file changed, no commit made.*
