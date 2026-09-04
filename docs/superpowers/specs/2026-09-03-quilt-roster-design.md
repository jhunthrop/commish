# Quilt roster pass: the roster moves into the drawer, four full rounds

Founder rulings 2026-09-03, two of them, on the quilt draft room
(`src/draft-room/quilt/`). The v6 quilt flagship pass (manager row, edge handles, faces in
cells) is the base; v5 laws bind throughout: chroma channels (amber = yours, red = the
room's), honest data, both themes, zero scroll (law 4), one expanded surface at a time.
Pick machinery (pending pick, flush, undo) untouched.

## Ruling 1 — the roster is a drawer tab; the spine dies

### The Roster tab

A new drawer tab ROSTER sits between My sheet and Byes — the handle order is
Pool · My sheet · Roster · Byes · Picks. Its body is the caller's roster, one row per
configured spot in the league's own slot order, derived through `rosterFillRows`
(`../state/roster-fill`) — the SAME shared derivation `RosterRail` and `MockResults`
consume, and the same roster facts the retired spine drew its dots from. Nothing here
computes slot assignment; the engine already did.

- A FILLED spot: slot chip (the letter — QB/RB/WR/TE/FLEX/K/DEF/BENCH), `PlayerFace` at
  the dense-row step, the player's name (the peek button, per the drawer's own law 3
  posture), his own `PositionBadge` (a WR filling FLEX shows WR), and the pick's place in
  the sport's grammar ("3.04") from `view.picks` — the pick number is a fact the spine
  never stated and the founder asked for.
- An OPEN spot: a dashed row carrying the slot chip and nothing else — the drawer's
  version of the quilt's own dashed-promise vocabulary, not the rail's hairline (a drawer
  tab is a working list; the dashes say "a row will land here").
- The tab participates in the collapse machine exactly like every other tab: `SET_TAB`
  opens the drawer at half on it from anywhere, no new state kinds, no new events.
- A commissioner with no team has no roster to show ("nothing to say" law): the Roster
  handle hides exactly the way the Byes handle hides without bye data.

### The spine dies

`roster-spine.tsx` and its test are DELETED — the collapsed sliver, the ROSTER chevron
plate, the expanded panel, all of it. The collapse machine loses the `spine` surface kind
and the `TOGGLE_SPINE` event (a state the room can no longer spell, per the machine's own
design). `quilt-room.tsx` drops the spine column, so the board takes the width. The room
tour never anchored to the spine (its targets are the clock, the dock and the pool), so no
tour stop moves; the deletion sweep is a repo grep for spine references in the quilt, the
draft-room tests and the e2e specs.

### The needs line on your turn

The clock strip's amber your-turn state carries one quiet line under the verb row:
"Still need TE · K · DEF" — sentence case, middot-separated, and no line at all when every
starting slot is filled. Derived in `state/lens.ts` from the SAME machinery as
`needFractions` (one private helper now feeds both), widened to the six dedicated starting
positions (QB/RB/WR/TE/K/DEF): unlike the needs DOTS — which paint the whole room
thirteen rounds running and therefore exclude K/DEF as noise — this line speaks once, to
one manager, at the exact moment a late-round K/DEF hole is the decision. FLEX and bench
are not positions and never appear. The line NEVER renders on the red room state — red is
the room's channel, and the room does not nag. Desktop strip only: the ruling names the
clock strip, and the phone's your-turn header already spends its rows on the queue.

### Mobile

The phone room's bottom tab bar gains ROSTER between SHEET and BOARD (mirroring the
desktop order's roster-after-sheet), rendering the same `DrawerRosterTab` rows. Five tabs
at 390px: the widest label (ROSTER, six characters of text-sm bold tracking-wide) measures
~52px against the ~78px a five-way flex-1 split leaves, so the existing font and padding
hold without tuning — verified by arithmetic, recorded here. A commissioner's bar keeps
four tabs (no roster). The confirm-sheet flow is untouched.

## Ruling 2 — shorter cards, four full rounds

### The window

`buildQuiltRows`: the full window is the ACTIVE round plus the PRIOR THREE, clamped at the
draft's start (round 1 shows 1 full row, round 2 shows 2, round 7 shows 4,5,6,7). Rounds
ahead keep today's track treatment (`fullRoundsAhead`); everything older than the window
and past the tracks stays micro. The window depth is `QUILT_CONFIG.fullRoundsBehind: 3`,
beside `fullRoundsAhead` — one config object, no magic numbers. The on-clock cell and the
caller's dashed your-next-pick cell need nothing new: they were always cells inside
whatever round the window made full.

### The height math

Full cards get vertically shorter so four of them fit where one did. The lockup judgment:
at 12 columns a full cell is ~128px wide; folding "POS · TEAM" onto the name line would
truncate most names, so the card keeps a TIGHTER TWO-LINE lockup (bold condensed name over
the 10px fact line, leading-tight) inside a 36px preferred row — the readable end of the
32–36 target, and the height that still seats the 32px `PlayerFace` with breathing room.

`BOARD_HEIGHTS.row` becomes:

| kind  | preferred | floor | max | weight |
| ----- | --------- | ----- | --- | ------ |
| full  | 36 (was 44) | 28 | 56 (was 96) | 3 |
| track | 14 | 4 (was 6) | 48 (was 80) | 2 |
| micro | 14 | 4 (was 6) | 28 | 1 |

- `preferred 36`: the two-line lockup above. `floor 28` holds — it is the readable minimum
  the geometry e2e asserts, now for all four full rows.
- `max 56`: a 96px ceiling was a two-line card with air; a shorter card capping at 56
  keeps the roomy stage from inflating four rounds into billboards.
- `track max 48`: an empty upcoming track must never stand taller than the full cards it
  is waiting to become.
- micro/track `floor 4`: with four present rounds instead of one, the compacted past pays
  for the present. Eleven rows at 4px instead of 6 buys the squeeze 22px, which is what
  keeps all four full rows at ≥28px on a short laptop with the drawer at half (the
  arithmetic below).
- Cell thresholds move with the card: `cellCaptionMinPx 30` (was 36 — the fact line must
  survive at the new preferred), `cellFaceMinPx 34` (was 44 — the 32px face shows from
  34px up, sheds first as the row squeezes). `cellTextMinPx 20`, `labelMinPx 14`,
  `labelSmallPx 24` unchanged. The degradation ladder's ORDER is untouched: manager row
  compacts first, then track/micro squeeze to floor, then full rows shrink to 28, then
  everything scales.

### The three-viewport fit proof

Mid-draft kinds (active round 5): 1 micro + 4 full + 1 track + 9 micro. Fixed spend at
manager-full: 48 header + 15 gaps x 6 = 138. Preferred rounds total:
4x36 + 11x14 = 298. So the preferred layout, manager row FULL, needs a 436px stage.

- Stage 800: budget 662 ≥ 298 — grow branch, every full row ≥ 36, surplus waterfills.
- Stage 900: budget 762 — same, deeper waterfill toward the caps.
- Stage 1050: budget 912 — caps total 4x56 + 48 + 10x28 = 552, all rows capped, slack
  stays slack (the old max-h ceiling behavior).

All three are pinned by planner tests (`heights.test.ts`, "four full rounds fit the common
stages"), with expectations computed from the constants above, not from the code. The
worst live case — 800px viewport, drawer at half (45dvh = 360), banner + strip + padding —
leaves a stage near 314 (budget 196), where the full rows HOLD their 36px preferred and the
micro rows settle near 4.7px (the floor-forcing branch never fires; verified by re-running
squeeze() against the constants in the review, which corrected this paragraph's first
draft). The readable-minimum guarantee is the harder point below it: a stage of 274 (budget
156) forces the micro floor (11 x 4 = 44) and yields exactly the 28px full-row floor,
(156 − 44) / 4 = 28. Zero scroll at every height remains the planner's own construction
(squeeze/scale spend ≤ budget always).

### The geometry e2e

`e2e/quilt-board-compaction.spec.ts` updates: the ≥28px readable-minimum assertion and the
one-height-per-row checks now apply to EVERY full row (1–4 of them, never more than
`1 + fullRoundsBehind`), and after the four existing audits the test drafts once from the
last seat — the snake hands the turn straight back at 2.01 — and audits a fifth stage
where rounds 1 AND 2 are both full, proving the window widens in a real browser.

## Test delta

- `collapse.test.ts`: spine cases die; Roster joins the tab cases.
- `board.test.ts`: window tests — active 7 → 4/5/6/7 full; active 2 → 1/2 full; clamp at 1.
- `heights.test.ts`: every expectation recomputed from the new constants; the
  three-viewport fit test added.
- `lens.test.ts`: `unfilledStartingPositions` — K/DEF included, FLEX/bench never, empty
  when the starting roster is full.
- `drawer-handles.test.tsx`: five handles, Roster gating for the teamless.
- New `drawer-roster-tab.test.tsx`: filled row facts (chip, face, name, badge, place),
  dashed open rows, peek wiring.
- `draft-room.test.tsx`: the two spine assertions become Roster-tab assertions.
- `roster-spine.test.tsx`: deleted with its component.
