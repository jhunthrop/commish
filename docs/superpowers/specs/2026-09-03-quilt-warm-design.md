# v6 quilt flagship: the founder-ruled component upgrades

Founder additions 2026-09-03, drawn in `.superpowers/mocks/WarmQuilt.dc.html` and ruled in
`canvas.json` (FOUNDER ADDITIONS). The v6 foundation (radius scale, soft surfaces, shadow and
glow tokens, warmed primitives, the no-raw-surface gate) is already merged at `bffefc8`; this
branch is the quilt's component pass on top of it. v5 laws bind throughout: chroma channels
(amber = yours, red = live), one solid amber verb per surface, honest data, both themes,
motion inside 250ms with reduced-motion branches. Pick machinery (pending pick, flush, undo)
untouched.

## 1. The manager row

Every quilt swimlane wears its manager's avatar plus short team name at the column head — the
mock's 30px circles over 8px condensed labels. It REPLACES the desktop board's text-code
header row (the codes move into the label under each face; the full team name stays the
accessible name via the same `abbr` posture).

- Ring semantics keep the channel law: the on-the-clock manager's ring is red (`live`), YOUR
  ring is amber with the soft glow token (`shadow-verb-glow` — a tint of the accent family,
  never a fifth pigment), everyone else rides the quiet line color.
- The row is part of the board: it renders inside `QuiltBoard` on the same
  `gridTemplateColumns` as every round, so it compacts with the board and can never overlap
  the clock strip.
- Data: the room state the board already receives — `teams` (`TeamCard`: name,
  `ownerAvatarUrl` avatar ref), `view.draftOrder`, `view.onClockTeamId`, `myTeamId`. No new
  reads.
- Avatars: the `Avatar` primitive renders the stored ref (preset tile or remote headshot). A
  manager with NO avatar ref gets the team's `Crest` monogram, clipped circular by the ring
  wrapper so the row stays a row of circles.
- Mobile (the board tab's micro-quilt, `microOnly`): 12 columns at 390px leave ~22px per
  column — a 30px circle cannot fit and a smaller one is an unreadable smudge, which the
  mission's "if it fits honestly" clause anticipates. The micro-quilt KEEPS the current
  text-initial header. Judgment recorded here and in the component docblock.

## 2. Drawer handles on the edge

The collapsed drawer's BEST AVAILABLE chip row retires. In its place: always-visible TAB
HANDLES riding the drawer's top edge at EVERY height (collapsed, half, full) — the mock's
rounded-top tab shapes (Pool / My sheet / Byes / Picks, sentence case per the v6 label ruling)
plus a grabber pill labeled "Drag or tap · space".

- The collapse machine's semantics stay untouched; this is a presentation layer that speaks
  the machine's existing event vocabulary:
  - tapping an inactive tab dispatches `SET_TAB` (opens the drawer at half on that surface;
    keeps height when already open — the machine's existing rule);
  - tapping the ACTIVE tab dispatches `TOGGLE_DRAWER` (full walks to half, half closes — the
    machine's existing rule);
  - the grabber taps to `TOGGLE_DRAWER` (the space gesture, spelled visibly) and DRAGS one
    step: released upward it raises (collapsed to half, half to full via
    `SET_HEIGHT`/`TOGGLE_DRAWER`), released downward it lowers.
- The active tab carries a chevron that flips with state: OPEN, the active tab's chevron
  points down (a tap walks the drawer down); COLLAPSED, no tab is active, so the default Pool
  tab wears the up chevron (a tap opens). The mock draws one static frame; the flip rule is
  the judgment, recorded here.
- Keyboard contract unchanged: space toggles, `/` opens search, esc collapses
  (`use-room-keys` untouched).
- Need-fraction chips (stolen honestly from Sleeper, per the ruling) move INTO the drawer's
  filter row: `RB 1/2`, `WR 1/2`, `TE 0/1`, `QB 1/1 ✓`. Derived from roster state the room
  already carries — `view.slotConfig` (starting slots) vs `view.rosters[myTeamId]` (filled),
  over the same QB/RB/WR/TE need positions the NEEDS lens already scopes to. A satisfied
  position reads quiet with the check; an unfilled one carries its number in the negative
  channel. Desktop drawer only: the 390px pool tab's filter row already spends its width on
  search plus six position stickers (judgment recorded).

## 3. The roster toggle

The spine's head gets an explicit chevron button — the mock's 40x30 rounded shape — labeled
ROSTER (the sanctioned `MICRO_LABEL` register). Tap opens the roster panel (the existing
`TOGGLE_SPINE` spine-expand behavior); the chevron flips while open, transition inside the
motion budget with a reduced-motion branch. The rotated vertical micro-text ("roster") is
retired. The slot-dot rail below stays informative; the button owns the toggle.

## 4. Faces in cells

Active-round quilt cells (row kind `full`) render the player's face — the existing
`PlayerFace` primitive at its dense-row step — beside the condensed name, per the mock.
Micro/compacted rounds stay pure color tiles; track rounds hold no landed picks. The face is
`aria-hidden` furniture (the accessible name stays the player + pick place), and lens
recoloring keeps its geometry — the face never moves when a lens swaps pigment.

## Verification

- tsc 0, eslint clean, the design sweeps green (no-raw-surface, caps charter, hex, accent).
- Tests: manager-row ring states (on-clock / you / quiet), handle tap semantics against the
  collapse machine, need-fraction derivation (filled / unfilled / satisfied-check), roster
  toggle open/close, faces render only for active-round cells — the quilt's existing
  component-test patterns (`peek-history.test.tsx` style).
- REAL hydrated screenshots: the v6 foundation's audit flagged the before/after pair captured
  an unhydrated board. A shots spec drives a solo mock draft a few picks in through the real
  store (the `quilt-shots` fast-forward idiom) and photographs resting, your-turn, and
  drawer-half-via-handles in BOTH themes into `.superpowers/screenshots/`.
