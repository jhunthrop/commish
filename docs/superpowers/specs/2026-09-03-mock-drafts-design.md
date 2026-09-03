# Mock drafts, the workflow pass — design spec (2026-09-03)

Blueprints: `.superpowers/mocks/Main.dc.html` (the page), `.superpowers/mocks/Debrief.dc.html`
(the results page), laws in `.superpowers/mocks/canvas.json`. Founder-approved. This spec maps
the blueprint onto the code that exists.

## The problem being fixed

The current `/app/mock-drafts` page is a seven-decision settings form (`MockSetupForm`) with the
learning buried behind a "See results" button on a history row. The results page records what you
did; the page you land on asks you to configure before it lets you practice.

## Law 1 — one verb

- "Draft against the bots" leads the page. `DRAFT NOW` is the page's ONE solid amber
  (`Button variant="verb"`); everything else on the page is outline or quiet.
- The seven creation settings collapse to a sentence of quiet chips: **tonight's table:**
  `12 TEAMS · 60S CLOCK · HALF PPR · STANDARD · SEAT: RANDOM` (+ a NAME chip when a team name is
  set). Mode is NOT a chip — law 2 makes people a door, so the chips describe the table and the
  doors decide who sits at it.
- Each chip is tappable and edits IN PLACE: tapping expands one inline editor row directly under
  the sentence (the room's borrow-and-return pattern — the row borrows the space, choosing or
  re-tapping returns it). No navigation, no form column. Editors reuse `SegmentGroup`, the slot
  pill row, and `Input` (name).
- The last-used table is remembered per user in `localStorage`
  (key `commish.mock-table`, codec validated against the offered options on read — the same
  browser-persistence precedent the cheat sheet set in `quilt/state/sheet.ts`). A malformed or
  stale store reads as the defaults.
- `DRAFT NOW` posts `POST /api/mock-drafts` with `mode: "solo"` plus the current chips and
  navigates straight into the room. Zero decisions between landing and the room.
- `?create=solo` (DraftRoom's contract) keeps working server-side with schema defaults.

## Law 2 — people are a door, not a mode toggle

- A `DRAFT WITH PEOPLE` panel with two rows, each carrying an outline verb:
  - "Open a lobby room" → `OPEN LOBBY` (creates a `lobby` room with the current chips).
  - "Mock with your crew" → `MINT A LINK` (creates a `link` room with the current chips, lands
    on the room whose `ShareLinkPanel` already carries the invite).
- Open lobby rooms list beneath the two rows: seat counts + `TAKE A SEAT` (outline).
- An EMPTY lobby renders NOTHING — no empty-state box, no sentence. Null is absent.
- A room of the caller's own that is scheduled or in progress renders one re-entry row above the
  doors (honest necessity the blueprint had no live room to show); it never spends the amber
  solid.

## Law 3 — the learning is the page's second half

- Right column: `WHAT YOUR LAST MOCK SAYS` — the most recent COMPLETED mock summarized from data
  the product already computes (`reviewPicks`/`verdictPopulation` machinery):
  - best-available count of total picks ("9 of 15"),
  - reach count (picks with `bestAvailableDelta >=` the reach threshold),
  - positional-shape phrase (derived counts by position over the early rounds),
  - a few notable pick rows (best pick, worst reach) with verdict chips,
  - `FULL DEBRIEF` link to `/app/drafts/[draftId]`.
- Below: `EARLIER MOCKS` as quiet rows each carrying its best-available fraction and a DEBRIEF
  link.
- A user with no completed mocks: the column self-omits entirely and the doors take the width.
- Data path: a new server read `completedMockDebriefs(db, userId)`
  (`src/mock-draft-service/debrief.ts`) walks the caller's unswept completed mock rooms
  (bounded), loads each draft's stored state + snapshot pool, and computes summaries with the
  SAME pure derivations the debrief page uses (`src/draft-room/state/debrief.ts`). Retention
  (24h) keeps the walk small; a config cap bounds it anyway.

## Law 4 — the debrief (MockResults rebuilt)

Route unchanged: `/app/drafts/[draftId]`, phase `complete`, mock rooms only.

- Header: heading + meta line (mode · teams · seat · when) + `RUN IT BACK, SAME TABLE` — the
  debrief's ONE solid amber. It re-posts a solo mock with THIS room's own table (team count,
  clock, scoring, roster shape, same seat), derived server-side and carried on the wire.
- Summary stat cards: best-available count, reach count, one honest positional-shape callout
  (first TE/QB round style). The room-average clause ("the room's average was round 4") renders
  ONLY when the stored pick log supports it (bot picks are in `view.picks`; the average is over
  the seats that actually drafted the position); otherwise the clause drops silently.
- The verdict lane: every pick — slot (`1.08` round.pick), position sticker, name, one-sentence
  fact derived from `PickReview` facts only, verdict chip (`BEST AVAILABLE` / `BEST {POS}
  AVAILABLE` / `N RANKED HIGHER`) colored by the existing verdict magnitude machinery.
- `THE TEAM YOU BUILT`: the roster's position stickers in slot order + an honest observation —
  the positional shape clause, and a bye-stacking clause ONLY if derivable from the real
  schedule read (`byeWeeks` already rides `DraftPlayersBody`); it names a week only when three
  or more of the roster share it.
- `TAKE IT WITH YOU`: `SEED MY SHEET` + `TRY ANOTHER SEAT` (outline verbs).
- `ACROSS YOUR LAST MOCKS`: renders only with 2+ completed mocks; states only patterns
  computable from stored results (first-TE round per mock; early-round best-available
  consistency). Computed server-side by the same debrief service, carried on
  `MockRoomInfo.results`.
- The finished board stays below (it is the room's strongest image, and the commissioner's
  whole view). The old `RosterSection` row list is retired in favor of the team card; the board
  still shows every pick.
- No letter grades, no fabricated scores, no em-dashes. Every verdict is the board at the moment
  of the pick — `verdictPopulation`/`reviewPicks` stay the single source; aggregations derive
  from those same verdicts.

## Sheet seeding — the judgment call

The cheat sheet is keyed PER DRAFT (`commish.draft-sheet.<draftId>`, `quilt/state/config.ts`),
so a mock cannot honestly target a real league's sheet: at debrief time no real draft id exists
to key on. The nearest honest version, implemented here:

- `SEED MY SHEET` writes a full-permutation seed sheet under the well-known key
  `commish.draft-sheet.seed`: the caller's mock picks in pick order, then the rest of THIS
  mock's own snapshot board in board order.
- `useSheet` (the real room's own hook) changes in one branch: when a draft has NO stored sheet
  of its own, it reconciles the seed sheet against that room's board instead of starting from
  the board order. A stored per-draft sheet always wins; the seed never overwrites prep.
- Same-browser-only, lost with cleared storage — exactly the sheet's existing recorded
  judgment ("prep words, never money or picks").

## Deletions

- `MockSetupForm` (+ test) — replaced by the chip sentence.
- `MockLobby` (+ test) — replaced by the new page composition (`OpenRoomRow`, `MineRoomRow`,
  `LobbyLowerThird`, quick-start helpers all go with it).
- `MockWire` (+ test), `listMockWireItems` (`mock-draft-service/wire.ts`, + test), the `wire`
  field of `MockLobbyBody`, and `MOCK_CONFIG.wire` — the new page has no wire band, and dead
  code is deleted completely.
- `MOCK_COPY` strings the deleted surfaces owned (`lobbyEmptyMessage`,
  `lobbyHistoryEmptyMessage`, `lobbyPromise` reworded, results labels reworked for the new
  debrief).

## Hard constraints carried

- Sunday v5 tokens only, both themes; Saira faces via existing `font-display`/`font-mono` roles.
- Amber budget: `variant="verb"` appears exactly once per page (DRAFT NOW; RUN IT BACK). All
  other verbs are `secondary` outlines or quiet links. No hand-rolled `bg-accent`.
- Copy lives in `MOCK_COPY` (server) and crosses as props/wire data — the client boundary
  (`SERVER_ONLY_MODULE_GROUPS`) stays intact. All copy passes `copyViolations` (no contractions,
  no dashes).
- Strict tsc 0 errors, eslint clean, files < 800 lines, immutable patterns.
- Tests: chip-sentence state, remembered-table codec, aggregation math, empty states (no mocks,
  empty lobby), debrief verdict lane, habits gating, seed-sheet write + real-room import.
