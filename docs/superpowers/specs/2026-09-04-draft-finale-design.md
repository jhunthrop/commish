# The draft finale — spec-light (2026-09-04)

Founder report (with a prod screenshot of a completed mock): "When the draft is complete the
room just kinda sits there. It should have a 'complete' moment and transition to draft review."

Root cause, verified: `DraftRoom` branches on `room.mock?.results`, and the GET payload only
carries results on a FRESH load after settlement. The live room learns completion over SSE
(the phase flips, the strip says "Draft complete") but never re-fetches — it sits on the full
board forever. Real league drafts have no completion treatment at all.

## The three beats

### 1. The moment (mock and real alike)

Detected client-side as a TRANSITION, never a state: `useDraftFinale` keeps the previous phase
in a ref and fires exactly once when `in_progress` becomes `complete` in the room's own view —
whatever carried the flip (an SSE frame, a resync refetch). A page that loads an
already-complete draft never fires: its previous phase is null, so it renders exactly what it
renders today (the debrief for a settled mock, the completed board for a real league) with no
fanfare.

The beat itself: a board-wide acknowledgment over the live room — the shared `Celebration`
primitive ("Every pick is in.", emphasis `self` for a manager with a team, `peer` for a
commissioner watching), plus a completion banner pinned in the clock strip's place at the top
of the room frame: "The draft is in the books." The board stays visible under both. The
banner rides `animate-strip-grow` (the strip's own growth ease, inside the 250ms budget) and
drops the class entirely under reduced motion; `Celebration` branches on reduced motion
itself. Nothing here is red or amber — completion is the room at rest, `surface-elevated` on
`line`, with the celebration's own accent carrying the only warmth.

### 2. The transition, mock rooms

After the beat the room re-fetches its own GET (`room.refresh()` — the driver's
advance-on-read plus settlement means the payload now carries `mock.results`) and the existing
`room.mock?.results` branch swaps to the debrief in place. No reload, no navigation, no new
debrief machinery.

The race: if the refetch lands before settlement and results are still absent, retry —
bounded, from config: `resultsRetryCount` attempts spaced `resultsRetryMs` apart, silently
(the board simply stays). If that cycle exhausts, a quiet "Preparing your debrief" line
appears and ONE more identical cycle runs. If results still never arrive there is no
spinner and no loop: the completed board stays with a manual "See your debrief" button wired
back into one more bounded refetch cycle. Never an infinite spinner.

Guard: none of this ever fires for a draft already complete at load — the transition detector
is the single gate, and it cannot fire without a witnessed `in_progress`.

### 3. The transition, real league drafts

After the same beat, a completion panel over the board frame:

- "The draft is in the books." as the heading.
- A compact your-roster summary — `rosterFillRows` (the one shared slot derivation), FILLED
  rows only, in the drawer roster tab's own row grammar (slot chip, face, name, position
  badge). A commissioner with no team gets no roster block, never an empty one.
- ONE ink verb: "Open your league room" → `/app/leagues/[leagueId]` — the league room's
  arrival card is already waiting there (it renders for `draftStatus === "complete"` at
  week 1).
- A quiet "Stay on the board" dismiss that returns to the completed board, which stays fully
  browsable.

No debrief for real drafts — that is mock-only machinery, and none is invented.

## Timing constants

All in `DRAFT_ROOM_CONFIG.finale` (`src/draft-room/state/config.ts`), never inlined:

| constant            | value | meaning                                                  |
| ------------------- | ----- | -------------------------------------------------------- |
| `momentMs`          | 2600  | how long the completion beat holds before transitioning  |
| `resultsRetryMs`    | 900   | spacing between debrief refetch attempts                 |
| `resultsRetryCount` | 3     | attempts per cycle (one quiet cycle, one visible cycle)  |

## Where it lives

- `useDraftFinale` (`src/draft-room/hooks/use-draft-finale.ts`) — the transition detector and
  the stage machine (`idle → moment → refetching → preparing → manual` for mocks,
  `idle → moment → panel → dismissed` for real drafts). Pick machinery, the engine and the
  SSE plumbing are untouched; the hook only reads `view.phase` and calls the existing
  `refresh`.
- `DraftFinaleOverlay` (`src/draft-room/components/draft-finale.tsx`) — the per-stage chrome,
  rendered as an overlay inside the room viewport in `draft-room.tsx`, over BOTH format rooms.

## Judgment calls

- **The auction room gets the identical treatment, not a banner-only version.** The finale
  renders at the `DraftRoom` viewport level, above whichever composition (`SnakeRoom`'s quilt,
  `AuctionRoom`'s shell, and the phone inversion) owns the stage — so the auction room
  inherits the beat and the real-draft panel with zero structural change to `RoomShell`.
  Today the auction room's only completion treatment is the rail's "Every roster is final"
  masthead state; that stays, and the finale plays over it.
- **"In the clock strip's place" is an overlay, not a strip rewrite.** The clock strip lives
  in three compositions (quilt strip, mobile strip, auction rail). Threading a banner state
  through all three would triple the surface for one transient sentence; the overlay pins the
  banner across the top of the room frame — the strip's place — for the beat's 2.6 seconds,
  and the strip's own steady-state "Draft complete" wording takes over underneath when it
  lifts.
- **The banner and the celebration say different things.** "The draft is in the books." on
  the banner (the founder-specified sentence), "Every pick is in." on the celebration — the
  room's own "never the same fact stated twice, differently" rule.
- **The detector watches the view, not the SSE frame.** A completion learned through a resync
  refetch (stream dropped at the worst moment) still transitions in client state, so the beat
  still plays. Only a load that never saw `in_progress` skips it.
- **The manual button re-enters the bounded cycle.** "See your debrief" restarts one full
  retry cycle rather than a single fire-and-forget fetch — each click is bounded, and the
  room can never spin.
