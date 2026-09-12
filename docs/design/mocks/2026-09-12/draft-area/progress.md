# Draft area, round one: the mock

Read-only against `/Users/jh/code/fantasy` at `d867c24a`. No product code touched, no worktree, no
branch. `git status` on main is clean. This round stops at the mock.

## The files

- `draft-area-board.html` — stop one, the Board. The Draft tab opens here.
- `draft-area-sheet.html` — stop two, Your sheet.
- `draft-area-mock.html` — stop three, Mock drafts.
- `_shell.css` — the shared chrome, inlined into each file (kept for reference only).
- `board-ppr.csv` — the real board the three files are drawn from.
- `shot.mjs` — the screenshot pass.

Each file is self-contained. Open one in a browser and it renders.

## Before

No dev server was running on 3000 or 3001, so no before screenshot was taken. The Draft area today
is `/app/draft`, a landing page titled **Draft HQ** under the subtitle *"Everything between you and
a roster you do not apologize for."* Below it: a countdown card, a Board preview card (eyebrow "The
Board", heading "Evidence rankings, receipts on every row", a three-row preview and "Open the
board"), a My Sheet card ("Yours, everywhere you draft"), and four arriving-soon tiles (The
Simulator, The Assistant, ADP, The Playbook), each ending in "See what's coming". A seven-stop
subnav runs above it all: HQ, The Board, My Sheet, Simulator, Assistant, ADP, Playbook. The mock
lobby lives elsewhere entirely, at `/app/mock-drafts`, reached from a top-nav item called Rooms.
Everything in that paragraph except the board and the sheet is deleted by this design.

## Data

Every player, number, tier, bye and basis in all three files is the product's own 2026 PPR board,
exported on 2026-09-12 from the dev database (`docker fantasy-postgres-1`) by
`scripts/rankings-export.ts --format=ppr`: 586 ranked players, 12-team standard shape. The
"Not on an active roster" rows and the tier sizes and drops were read a second time through
`boardRows()` directly. Copy is the product's own strings, quoted in each file's header comment.
Stand-ins are labelled in the same place and are layout only.

## Rulings

**Ruling: the switch sits beside the page title, the URL follows it, and the stop never changes
the page's name.** Why: it is the same segmented gesture the draft room uses for Wall / Your sheet,
one stop wider, so a manager learns it once. Cost if wrong: three stops under one `<h1>Draft</h1>`
could read as one page that keeps changing under you; a stop-specific title would fix it and cost
the shared identity.

**Ruling: the one solid verb sits at the right of the title row on Board and Your sheet, and inside
the Against bots door on Mock drafts.** Why: on the two board stops there is one act and it belongs
in the page's fixed furniture where it is always in the first viewport. On Mock drafts the verb
acts on a table the chips beside it set, and a verb separated from the facts it uses is the
ambiguity the room solved by putting its verb in the dock. Cost if wrong: the verb moves between
stops, which a veteran will notice.

**Ruling: on the phone the verb pins to the bottom, full width, over everything.** Why: the room
already does this at 720. Cost if wrong: it covers the last row of the list, which it does.

**Ruling: the quiet scheduled line renders on Board and Your sheet, never on Mock drafts.** Why:
both board stops are draft preparation and the line is the door back to the real thing; the mock
lobby is practice and the line would be a second door competing with the rooms. Cost if wrong: a
manager who lands on Mock drafts first loses the reminder.

**Ruling: the mock lobby rows draw anonymous seats, not named faces.** The founder asked for faces
first, as a Manager stack, on the grounds that these are members of the room. They are not
disclosed. See finding 4. Cost if wrong: the rows are less human than the design wanted, and the
fix is a contract change, not a CSS change.

**Ruling: the phone board gives the vs-ADP clause its own line rather than truncating it.** Why:
P1's test is that covering the numbers still leaves a readable list, and "LAR · bye 11 · draft…" is
not a readable fact. Cost: rows run about 68px on the phone, so six fit rather than the eight P10
asks of a comparison list. The alternative is to drop the clause on the phone. The founder should
pick.

## The persona panel

Taps counted from the top nav.

**Tap counts.** Draft tab to Run a mock draft, in the room: tap Draft (1, lands on the Board), tap
Run a mock draft (2, lands on Mock drafts), tap Start mock draft (3, in the room). Draft tab to a
live mock room: Draft (1), Mock drafts or Run a mock draft (2), Join on the row (3). Draft tab to
the sheet's first edit: Draft (1), Your sheet (2), press the row's up arrow or drag it (3).

**Veteran.** "Opening on the board is right. I never wanted a lobby page between me and the
rankings." "Points over replacement with the basis on every row is what I pay for, and Achane
thirteen picks later is the whole reason I am here." "Three taps to be drafting is fine. Three taps
to move one player on my sheet is one too many, and the sheet is where I live in August."

**Casual.** "One word, Draft, and three things under it. I understood it without reading
anything." "Run a mock draft being the same blue button on both board screens means I never have
to look for it." "On the phone the blue button sits on top of the last row, which made me think the
list ended there."

**Commissioner.** "My league mates will find the mock rooms now. Buried under a tab called Rooms,
nobody in my league ever opened one." "Rooms filling now with the countdown and seats left is the
thing that will actually get eight of us in a practice draft on a Tuesday." "The rows say seven
waiting but I cannot see who. Half the reason I would join is finding out my league mates are in
there."

**First-timer.** "Board, Your sheet, Mock drafts. I could guess what all three were." "Against bots
with the teams and the clock as buttons I can press made it feel like I was allowed to change
things." "I pressed Start mock draft and I was not certain it would use the 10 and the 60 I had
just picked, because the button is over on the other side of the card."

**After the walk.** The first-timer's doubt is the reason the verb sits inside the Against bots
door at all, beside the chips it acts on, rather than up in the title row with the switch. It is
still the weakest seam in the set, and if the founder wants the verb in the same place on all
three stops, the chips have to move up beside it. The commissioner's note is finding 4 and cannot be fixed in
CSS. The veteran's third note is finding 1.

## Where the design did not survive the real data

**1. Your sheet loses four of the room sheet's affordances outside a room.** The approved room
sheet's one number per row is "still there at your next pick, N of 100 runs". Outside a room there
is no next pick, nothing is taken, and so there is no Hide taken toggle and no jump to the next
open tier either. The row's one number here is the board's own ranking key instead, points over a
replacement at his position, with the basis stated once above the columns. The columns, the sticky
tier bands with their counts and drops, the target flag and the reorder gesture all survive
unchanged.

**2. The Draft tab opens on a board with no tier bands.** `showTiers` is
`position !== "ALL" && !dollarView` (`board-view.tsx:382`), so tiers are a position-tab affordance
and the Overall landing has none. The board mock draws the true landing. If the founder wants
tiers visible on open, the landing has to default to a position tab, which is a product change.

**3. "You pick 4th" has no source before a draft starts.** `teams` carries no draft-slot column,
the manager's slot ranking lives in `draft_slot_preferences` (the signed-in home's "Rank your draft
slots" verb), and no scheduled draft in the dev database has drawn an order. The scheduled line in
both board mocks therefore renders the honest variant, "Sharks Only Auction drafts Sunday", against
a real row (`dev_public_sharks_auction`, `drafts.kickoff_at` 2026-09-13 13:55 UTC, a Sunday). The
slot clause is buildable only once the order is drawn, and where that happens needs naming before
anyone builds the line.

**4. The mock lobby cannot honestly show faces.** `MockLobbyRoomSummary`
(`src/mock-draft-service/lobby.ts`) is `{ leagueId, shareCode, teamCount, seatsOpen, pickSeconds,
startsInMs }` and nothing else, and `MockRoomSummary`'s own docblock states the rule: *"no other
member's name or seat is ever named on this surface, matching the disclosure discipline
`listPublicLeagues` already holds"*. `ManagerStack`'s one consumer today is the league waiting
room, where membership is already visible to the reader. So a taken seat in the lobby draws as an
anonymous seat face and an open one as the dashed well, the treatment the approved signed-in-home
mock already invented for the same boundary, and the row leads with "7 waiting" rather than with
names. Faces with names arrive one tap later, inside the room. Showing them in the lobby is a
deliberate disclosure change, not a design tweak.

**5. Deleting Rooms from the nav orphans the live draft-rooms list.** `rail-nav.tsx`'s Rooms
destination is `/app/mock-drafts` with `also: ["/app/drafts"]`, and `/app/drafts` is the list of
real draft rooms. With Rooms gone, the quiet scheduled line is the only door to a live room, and
that line renders only when a league of yours has a draft scheduled. A manager mid-draft in a
league whose draft has already started has no nav path at all. The scheduled line's condition may
need to widen to "scheduled or drafting now".

**6. Two words for one act.** The founder's word for the per-row verb is "Join", which the mock
draws. The product's shipped verb for the same act, in both the real lobby and the mock lobby, is
"Take a seat". One of the two has to go before this is built.

## Screenshots

`screenshots/`, all at device scale 2 (desktop) and 3 (phone).

| Stop | 1440 light | 1440 dark | 360 light | 360 dark |
|---|---|---|---|---|
| Board | `board-1440-light.png` | `board-1440-dark.png` | `board-360-light.png` | `board-360-dark.png` |
| Your sheet | `sheet-1440-light.png` | `sheet-1440-dark.png` | `sheet-360-light.png` | `sheet-360-dark.png` |
| Mock drafts | `mock-1440-light.png` | `mock-1440-dark.png` | `mock-360-light.png` | `mock-360-dark.png` |

The 360 files are the first screen, so the pinned verb sits where a thumb finds it. Each also has a
`-full.png` whole-page companion with the pinned verb released, so it does not float over the
middle of a long capture.
