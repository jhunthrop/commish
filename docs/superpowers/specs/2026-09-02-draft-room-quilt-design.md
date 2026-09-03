# The Quilt: draft room rebuild, design spec

Date: 2026-09-02. Visual authority: the blueprint mocks in `.superpowers/mocks/`
(`TheQuilt`, `QuiltExpanded`, `SheetAndLens`, `PlayerCard`, `PickMoment`,
`MobilePool`, `MobileYourTurn`, `MobileQuilt`, plus `canvas.json`'s collapse-system
annotation). This spec records what the mocks cannot: component boundaries, the
state model, data flow, the keyboard map, and what of the old room is kept.

## The law (binding)

The quilt (rounds x teams color grid) owns the stage. Every other surface borrows
space and gives it back. One expanded surface at a time.

1. **Clock strip breathes.** Slim ribbon normally; auto-expands amber with the
   queue's top 3 and one-tap draft when you are on the clock. Amber is yours, red
   is the room's, in color and in motion: your turn is an amber grow (within the
   250ms motion ceiling), never a red flash.
2. **Pool drawer, three heights.** Collapsed chip row / half / full-screen.
   Space toggles collapsed-half, `/` opens search at full, Esc collapses all.
   Tabs: POOL / MY SHEET / BYES / PICKS.
3. **Peek sheet.** Click any quilt cell or pool row for the dense player card
   over the right edge; click away dismisses.
4. **Quilt self-compacts.** Completed rounds shrink to micro color tiles, the
   active round stays full; all rounds visible, zero scroll.
5. **Roster spine.** 44px slot dots on the left, expands on tap.

Lenses (chips in the header): PICKS / NEEDS / VALUE / BYES recolor the quilt in
place, never move anything. Mobile inverts: pool-first list, bottom tabs
POOL / SHEET / BOARD / PICKS, quilt as the BOARD tab, two-step picking.

## Kept vs replaced

**Kept, byte-identical:**
- `useDraftRoom` (SSE + snapshot + optimistic submit + queue) — the room's one
  data layer. The quilt is a new presentation over the same `DraftRoom` state.
- The draft engine, draft service, all API routes and the event stream.
- `DraftRoom` (entry): loading/error states, mock chrome, tour, results,
  auction branch.
- The auction path (`AuctionRoom` + `RoomShell`), `MockResults`, `TvBoard`,
  `PickWire` — untouched. The quilt is the SNAKE room only (snake drafts only
  for now, per the mission).
- UI primitives: `Button` (verb variant), `PositionBadge`, `Stat`, `Badge`,
  `useCountdown`/`formatCountdown`, `usePrefersReducedMotion`, `Avatar`.
- `lib/tiers` (poolTiers, positionRanks, formatAdp), `lib/verdict`,
  `state/queue`, `state/format`.

**Replaced (for snake):** `SnakeRoom` now renders `QuiltRoom` instead of
`RoomShell`. The old shell components (`RoomLayout`, `RoomRail`, `RoomDock`,
`DraftBoard`, `PlayerPool`, `PickLog`, `RosterRail`) remain in the tree for the
auction room and results pages; nothing is deleted in this pass.

**New wire fact:** `DraftPlayersBody.byeWeeks` — optional
`Record<nflTeam, week>` computed server-side from `nfl_games` (a team with no
fixture in a week 1..18 is on bye). Real schedule, never invented; absent when
the schedule is not ingested, and every BYES surface renders nothing for a team
it has no bye for (law 7: absence means nothing to say).

## Component map (`src/draft-room/quilt/`)

```
quilt-room.tsx          composition: clock strip / spine+quilt+peek / drawer,
                        plus the mobile tree (CSS-swapped at lg, no matchMedia)
components/
  clock-strip.tsx       breathing ribbon; slim (red room chip) vs amber your-turn
  quilt-board.tsx       the grid; header row; full cells + micro rounds; lenses
  quilt-cell.tsx        one full cell (pick / on-clock / your-pick / empty)
  pool-drawer.tsx       heights + tabs + search/filters chrome
  drawer-pool-tab.tsx   ranked pool rows with DRAFT verbs
  drawer-sheet-tab.tsx  MY SHEET: reorderable copy of the board + notes
  drawer-byes-tab.tsx   players grouped by bye week
  drawer-picks-tab.tsx  the room's pick history, latest first
  peek-sheet.tsx        the dense player card over the right edge
  roster-spine.tsx      44px slot dots; expands to named slots on tap
  lens-chips.tsx        PICKS / NEEDS / VALUE / BYES
  undo-pill.tsx         radial 3s countdown + UNDO
  mobile-room.tsx       phone-width inversion: tabs + big-verb pool + confirm sheet
  mobile-confirm-sheet.tsx
state/
  collapse.ts           the collapse machine (pure reducer, tested)
  lens.ts               lens types + per-team needs/value/bye colorings (pure)
  sheet.ts              cheat sheet model + localStorage codec (pure, tested)
  pending-pick.ts       undo-window model (pure, tested)
hooks/
  use-pending-pick.ts   3s timer around room.submit
  use-sheet.ts          sheet persistence + board seeding
  use-room-keys.ts      the keyboard map
```

## State model

### Collapse machine (`collapse.ts`)

One expanded surface at a time, by construction — a single discriminated union:

```
type ExpandedSurface =
  | { kind: "none" }                       // resting: quilt owns the stage
  | { kind: "drawer"; height: "half" | "full"; tab: DrawerTab }
  | { kind: "peek"; playerId: string }
  | { kind: "spine" }
type DrawerTab = "pool" | "sheet" | "byes" | "picks"
```

Events: `TOGGLE_DRAWER` (none↔half; full→half), `OPEN_SEARCH` (drawer full,
pool tab), `OPEN_PEEK(playerId)`, `OPEN_SPINE`, `SET_TAB`, `SET_HEIGHT`,
`COLLAPSE_ALL` (Esc). Opening any surface closes the others because the state
IS the one open surface. The drawer's collapsed chip row and the slim clock
strip are the `none` rendering, not states of their own.

### Lens

`type Lens = "picks" | "needs" | "value" | "byes"` — plain `useState` in
`QuiltRoom`, default `picks`. Lenses only change cell coloring/content in
`quilt-board`; geometry is shared so nothing moves on switch.

- **PICKS**: position sticker colors (the resting quilt).
- **NEEDS**: per team, dots for unfilled position slots (from
  `view.rosters` + `view.slotConfig`, `SLOT_POSITION` mapping). Recomputed
  per pick; pure function in `lens.ts`.
- **VALUE**: each filled cell tinted by the pick's verdict (steal/reach/even
  via `lib/verdict` slip sign) using magnitude classes; empty cells unchanged.
- **BYES**: filled cells labeled/tinted by the player's bye week (from
  `byeWeeks`); no data renders no tint.

### Cheat sheet (`sheet.ts`)

The user's editable copy of our board. No server table exists for draft prep
notes, and inventing one mid-campaign is out of scope, so the sheet is
client-persisted: `localStorage` key `commish.draft-sheet.<draftId>`, schema
`{ order: string[], notes: Record<string, string>, seededFrom: number }`.
Seeded from the server-ranked board on first open; players the board later
serves that the sheet lacks append at their board position. Operations are
immutable (move up/down, set note, reset to board). Drafted players stay in
place, struck through (the mock's own rule). "You N · board M" compares sheet
index to board index. The queue pre-seed: a one-tap "Send top 5 to queue"
action calls `room.setQueue` with the sheet's top undrafted ids (the queue is
the server-side object the clock strip and autopick already honor).

### Pending pick / undo (`pending-pick.ts`, `use-pending-pick.ts`)

Desktop DRAFT starts a local 3-second window: `{ playerId, expiresAt }`.
The pill renders a radial countdown; UNDO cancels; expiry calls
`room.submit({ type: "MAKE_PICK", playerId })`. The pick reaches the server —
and therefore the room — only on expiry, which is the mock's "broadcasts when
the pill expires" made honest (nothing is sent then recalled). If the clock
would expire before the window (deadline within 3s), the pick submits
immediately: losing a turn to safety theater is worse than skipping the pill.
Mobile confirms in a sheet first, then gets the same window. Reduced motion:
the radial ring becomes a static "Undo · Ns" text countdown.

### Keyboard map (`use-room-keys.ts`)

- `Space` — drawer none↔half (full→half). Ignored while typing in an input.
- `/` — drawer full, pool tab, focus search.
- `Esc` — collapse everything (drawer, peek, spine); also cancels nothing
  else (the undo pill is a click target only — Esc must never eat a pick).

## Surfaces against the mocks

**Clock strip** (`TheQuilt` top bar / `QuiltExpanded` top bar): slim row shows
the room clock chip (live red fill, `liveText` label: "0:24 · 1.07 · TEAM"),
a muted room sentence, and the amber "YOU PICK n.mm · in K" fact. On your turn
the strip swells (height animates within the 250ms cap, `accentGlow`
background, accent border) and inlines your queue's top three as rows with
DRAFT verbs — the first accent-filled, the rest accent-outlined. No queue
falls back to the board's top three available (stated as "board" rows, not
pretending to be a queue). The countdown uses `useCountdown` against
`view.deadlineAt`.

**Quilt board**: CSS grid, `44px + repeat(teams, 1fr)` columns, one row per
round (`slotConfig` total slots = rounds). Completed rounds (every seat
filled AND not the active round) render as 14px micro tiles in the position's
sticker color; the active round renders full cells (name, pos · team); future
rounds render as slim empty tracks so all rounds stay visible with zero
scroll (rounds beyond active+2 compress to micro height too). Cells: filled =
sticker fill + position text color; on-clock = inset with live outline and
the ticking countdown; your future pick = dashed accent outline "n.mm ·
YOURS"; empty = inset with hairline. The YOU column header is accent. Cell
click opens the peek for that player (filled cells only).

**Pool drawer**: collapsed = "BEST AVAILABLE" chip row (top 4 undrafted with
DRAFT verbs, the mock's chip row). Half = search + position chips + ~6 rows.
Full = the same list filling the stage (the quilt hides beneath; the law's
one-expanded-surface). Rows carry rank, sticker, name, ADP, market gap
(`Movement` idiom via plain signed figure), tier tag, generic edge count, and
the DRAFT verb (only when the user can act; star queue toggle always).
Tabs per the mock: POOL / MY SHEET / BYES / PICKS.

**Peek sheet**: 340px panel over the right edge, accent left border. Renders
only facts the room actually has: sticker + name + team + bye, our rank /
sheet rank / ADP trio, tier grade, market gap, availability outlook
(expected/floor/ceiling games when the `availability` reason exists), the
GENERIC edge line ("2 edges apply · net +3.1 pts" from the `law` reasons'
summed effects — never a law's name, per the founder secrecy ruling), roster
fit (which open slot he fills), the user's sheet note, and the verbs
(+ QUEUE / DRAFT NOW). No sims, no weekly bars, no three-season table — the
mocks drew data the wire does not carry, and this room does not invent
numbers (no-fabricated-data law). Click-away (backdrop) and ✕ dismiss.

**Roster spine**: 44px rail, one dot per roster slot (sticker color when
filled, dashed when open), expands in place to a 240px panel naming each
slot's player on tap; tap again or Esc collapses.

**Mobile** (`lg:hidden` tree): bottom tabs POOL / SHEET / BOARD / PICKS.
POOL = big-verb rows (DRAFT opens the confirm sheet — two-step). SHEET =
the cheat sheet list. BOARD = micro-tile quilt with tap-to-inspect strip
(tapping a tile shows the pick strip; FULL CARD opens the peek full-screen).
PICKS = history. Your turn: amber takeover header with the top-2 queue rows.
Confirm sheet: player facts + roster fit + BACK / CONFIRM PICK, then the
same 3s undo window.

## Motion

All within the token ceiling (`TOKENS.motion.duration.slow` = 250ms):
- Your-turn strip grow: 240ms ease-out, amber. Never a red flash.
- Drawer height changes: 200ms (`base`).
- Peek slide-in: 200ms.
- A landed pick blooms its cell (250ms background ease) — the mock's 280ms
  fly-arc is out of budget and out of scope; the bloom + ticker line carry
  the report. `usePrefersReducedMotion` turns all of it off.

## Copy rules

No em-dashes anywhere user-facing. No tooltips; words explain themselves.
Edge chips generic only. Colors only via token classes (`bg-live`,
`text-accent`, `bg-pos-rb`...) — no hex anywhere outside `tokens.ts`.
