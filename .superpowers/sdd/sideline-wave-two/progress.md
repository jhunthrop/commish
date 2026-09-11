# Sideline wave two: the wire and trades, the account room, the admin room, the primitives

Worktree cut from `2b671c96` (`git merge-base --is-ancestor` confirms). Scope is the brief's:
`src/league-room/components/{wire,trade-card,trade-composer,trade-sheet,trade-inbox,room-surface-players,claim-sheet}.tsx`,
`src/account-room/**`, `src/admin-room/**` + `src/app/app/(shell)/admin`, and the named primitives
in `src/components/ui`.

## The mock

`.superpowers/mocks/wire.html`, screenshots in `.superpowers/mocks/screenshots/`:

- `wire-mock-1440-light.png`, `wire-mock-1440-dark.png`
- `wire-mock-360-light.png`, `wire-mock-360-dark.png`

Revised once while drawing it, before any product code: the free-agent row at 360 wrapped its
facts line four ways, truncated "Khalil Shakir" to "Khalil …" and then, once the row was allowed
to wrap, put the second row's face on a line of its own. The row became a three-column grid at
phone width (face, who, verb) with the figure dropping under the name. P1's own test is why: the
name is the thing that never shrinks.

## What shipped, shot from the real build

`.superpowers/mocks/screenshots/`, every one of them a real page against the real database
(`e2e/sideline-wire-shots.spec.ts`, tagged `@screens`):

- `wire-1440-light.png`, `wire-1440-dark.png`, `wire-360-light.png`, `wire-360-dark.png`
- `account-room-1440-light.png`, `account-room-1440-dark.png`, `account-room-360-light.png`,
  `account-room-360-dark.png`

Two things the shots caught that the unit tests could not:

1. **The theme never switched.** Stamping `data-theme` in an `addInitScript` produced two
   byte-identical "light" screenshots: `ThemeProvider` re-stamps the attribute from its own store
   the moment React hydrates. The shot spec now presses the radio the account room actually ships,
   which is also a better test — it proves the switcher works.
2. **The account room's figure sat in the middle of nothing at 360.** A right-aligned `BigNumber`
   over left-aligned sentences, inside a start-aligned column. Start-aligned at every width now.

## Rulings

**Ruling: `wire.tsx` is the front door's ticker, not the waiver wire.** The migration inventory's
"The wire and trades" row lists `wire.tsx` beside the trade files, but the component is the
signed-out marquee under the public nav, and the inventory's own front-door row says "the wire
kept". It is already spelled entirely in roles (`text-text-faint`, `bg-surface-inset`, `bg-live`,
`rounded-pill`) with no v5 vocabulary left in it. Left alone.
*Cost if wrong:* a ticker keeps a register half a step louder than the rest of the storefront,
visible only to signed-out visitors, and the front-door round fixes it for free.

**Ruling: the wire's surface is the trade room plus the free-agent board.** "A trade as a
conversation with the offer inside it" is the trade room; "absence as absence when nothing is on
the wire" is the free-agent board. One mock covers both because a manager reaches them from the
same two-position switch.
*Cost if wrong:* two mocks instead of one, and the same code.

**Ruling: managers reach the trade surfaces as data, not as a new read.** `TradeSideView` carries
`teamId`/`teamName` and no person at all, so "Manager for both parties" needs a name and a face.
`tradeContext` (`room-data.ts`) is already handed every `TeamCard` in the league, which carries
`ownerDisplayName` and `ownerAvatarUrl`. A `managersByTeamId` map is folded there, from the read
already in hand, rather than a second query or a widened wire type.
*Cost if wrong:* one extra map on a context object every trade surface already receives.

**Ruling: an expired offer carries no figure, not a dash.** The card's one number is the days it
still stands. A dead offer has no honest count, and `BigNumber`'s `null` renders an en dash — which
the house copy guard caught immediately, correctly. A slot holding a dash with a caption is a slot
pretending there is still a count to make, so the expired card says the day it ran out on and
nothing else.
*Cost if wrong:* an operator or a manager wanting a visual placeholder in the same spot; the
sentence is in the same place and says more.

**Ruling: the lower third leaves the trade room.** Two independent reasons. P3: it carried a
second solid Court blue verb ("Answer the offer") whose entire job was to scroll the reader to the
FIRST solid verb, and the e2e spec counted two solid verbs on one viewport. And the lower third is
one of Sideline's two bounded borrowings from Under the Lights, with "Sunday only" as the stated
boundary. Its three counts are said by the three chapter bands above it, in words.
*Cost if wrong:* a manager loses a jump link to a band that is one scroll away on a page with at
most three bands. The primitive stays: `wallet-content.tsx`, `seat-confirm-panel.tsx` and the
Sunday stage still render it.

**Ruling: the chapter band's sentence moves off the caps line.** `consequence` is set in the one
sanctioned all-caps register, which `ChapterBand`'s own docblock says is for keys — "a sentence set
in them shouts". All three trade bands were pushing 50-character sentences through it. The key
stays ("their offer"), the sentence moves to the `caption` slot the band already carries.
*Cost if wrong:* one more line of vertical per band.

**Ruling: `InfoTip` and `Rise` are deleted; `LiveMarker` is retired into `LiveChip`.** `InfoTip`
has no JSX call site left anywhere in `src` (every remaining mention is a docblock recording its
retirement) and neither does `Rise`; both are deleted with their tests and their barrel exports.
`LiveMarker` has three real consumers (`week-status-badge`, `matchup-strip`, `matchup-hero`), none
of them another round's, so they move to `LiveChip` and the file goes.
*Cost if wrong:* a surface outside this worktree that imports one of the three fails to compile,
which `tsc` catches before anything merges.

**Ruling: `Stat` is NOT composed over `BigNumber`, and `PositionBadge` keeps `rounded-sm`.** The
inventory asks for both. `Stat` is the only component allowed to name a magnitude colour and
`BigNumber` prints `textPrimary` unconditionally, so composing one over the other would either lose
the heat map or move it into `BigNumber`, which is the opposite of what the split is for. The
mock's position plate is 6px and the radius scale's nearest step is 8: adding a seventh radius to
close a 2px gap on a 20px chip is the drift `tokens.ts` warns about in its own docblock.
*Cost if wrong:* a 2px corner, and one primitive that keeps two spellings of a stacked figure.

**Ruling: the avatar scale grows a step rather than moving one.** "Manager at 96 in the header"
had no step: the scale went 52 then 128, and 128 is the player page's own hero inside
`PlayerFace`'s 132px ring. Re-pointing `2xl` broke that, so `2xl` is 96 and a new `3xl` is 128.
*Cost if wrong:* one more name in a six-name scale.

## The persona walk

Walked at 1440 and at 360, in both themes, on the real build. **Taps to accept a trade from a cold
open: three.** `/app` (the leagues list, where a cold open lands) → the league row, which already
says "1 thing needs you" → the moment verb on the league front, which opens the trade sheet →
Accept. The long way round is four: `/app` → the league → the Trades chip → Accept → Confirm.

**The veteran (year twelve, three leagues, reads ADP for fun).** "Both faces at the top of the
offer is the thing I did not know I wanted. I can tell at a glance whether this is the guy who
lowballs everybody." "Two days left of the three is the right number to put big. Every other site
tells me the date it expires and makes me do the subtraction." "I still want the side values. They
are one tap behind 'What the platform thinks' and I will press it every time, which is fine, but I
notice the tap."

**The casual (one league with college friends, sets a lineup Sunday morning).** "It looks like a
text message, so I read it like one. The note is the part I actually care about." "Accept is
obviously the button. Decline is obviously not." "I did not know what 'Counter' did until I opened
the sheet." *(Counter lives on the trade sheet, not the card. Left as is: the card's one verb is
Accept and the sheet is where the full decision lives.)*

**The commissioner (runs the league, hears every complaint).** "This is how my league already does
trades — in a group text with the offer pasted in. Now the product does it." "The three bands
telling me who owes whom an answer is the thing I will point at when someone says nobody responds."
"I want reactions on an offer. That is the next piece." *(Stated as not-built in the inventory:
picks, claims and trades have no reaction slot yet.)*

**The first-timer (joined because a coworker would not stop talking about it).** "I know who is
asking and I know what they want. That was not true on the old card." "'Nobody on the wire matches
that' is a sentence, not an error." "The free-agent rows have faces, so I stopped feeling like I
was reading a spreadsheet of strangers."

**Two personas tripped on the same thing and it was fixed before this was written:** the caps
sentence over each band. The casual read "THEY PROPOSED IT · NOTHING MOVES UNTIL YOU ACCEPT OR
DECLINE" as a warning; the first-timer read it as an error. It is a caps key and a sentence-case
caption now.

**One thing two personas tripped on that is NOT mine to fix and is stated here instead:** the room
shell's own footer line, "space opens the drawer · / searches players · esc collapses everything".
That is explainer text under P7, it sits under every drawer surface including this one, and
`room-shell.tsx` belongs to the league-home round.

## Gates

Re-run at `e09dded9` plus the working tree, unless stated.

| Gate | Result |
|---|---|
| `npx tsc --noEmit -p .` | green |
| `npx eslint` on `src/components/ui`, `src/design`, `src/league-room`, `src/account-room`, `src/admin-room`, `src/app` | green (one pre-existing warning, `veto/route.ts`, a file this round never opened) |
| `npx vitest run` on the scope derived from imports | see below |
| Playwright `e2e/sideline-wire.spec.ts` | 8 passed, light and dark, on port 3187 |
| Playwright `e2e/sideline-wire-shots.spec.ts` | 4 passed |

**Vitest scope, derived from the modules this round imports from and the modules that import it**
(`src/components/ui`, `src/design`, `src/league-room`, `src/account-room`, `src/admin-room`,
`src/app/app/(shell)/admin`, `src/integrity/rendered-copy.test.tsx` and the source guards):
**282 files, 7,361 tests, all green.**

**Pre-existing failures, named with the commit they were re-run at.** A temporary
`git worktree add … 2b671c96` was cut at
`/private/tmp/.../scratchpad/base-check` and the same lanes run there:

- `src/integrity` (the **database lane**): 226 failures at `2b671c96`, postgres connection and
  constraint errors from a lane that needs a seeded test database this round never touches. Nothing
  in this round's import graph reaches `src/integrity-service`. Not re-run here beyond confirming
  the same failures at base.
- `src/account-room`: **8 failures at `2b671c96`**, all of them tests asserting affordances that
  earlier rounds had already retired (two `InfoTip` triggers, a `Stat` that is no longer one, a
  per-row channel chip, and the theme switcher's old copy). **All eight are fixed in this round**,
  because the account room is this round's and a red room is not a room you can review.
- `src/admin-room`: **1 failure at `2b671c96`** (`reconcile-drift-panel`, asserting a
  `data-magnitude` stamp on a figure that is no longer a `Stat`). **Fixed in this round.**
- `src/app` (the **page-test lane**, which is the concurrent test-debt round's own scope):
  **15 failures at `2b671c96`**, identical in count and identity to this branch's — four in
  `league-rules`, four in the activity page's membership gate, six in `trades/page.test.tsx` and
  one in the glossary section. Re-run at base in a temporary `git worktree add … 2b671c96` (since
  removed). Left alone: the brief names page tests and league-rules as another round's.

Two stale e2e locators in surfaces this round owns were corrected on the way past:
`trades.spec.ts` and `enforcement.spec.ts` both looked for a band named "Offers to answer", which
`src` has not rendered since the band rename, and `trades.spec.ts` looked for it as a heading where
it is a region. Not re-run (the full suite is out of scope this round).
