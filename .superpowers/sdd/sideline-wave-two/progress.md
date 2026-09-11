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
phone width (face, who, verb) with the figure dropping under the name. P1's own test is why:
the name is the thing that never shrinks.

## Rulings

**Ruling: `wire.tsx` is the front door's ticker, not the waiver wire.** The migration inventory's
"The wire and trades" row lists `wire.tsx` beside the trade files, but the component is the
signed-out marquee under the public nav, and the inventory's own front-door row says "the wire
kept". It is already spelled entirely in roles (`text-text-faint`, `bg-surface-inset`,
`bg-live`, `rounded-pill`) with no v5 vocabulary left in it. Left alone.
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

**Ruling: `InfoTip` and `Rise` are deleted; `LiveMarker` is retired into `LiveChip`.** `InfoTip`
has no JSX call site left anywhere in `src` (every remaining mention is a docblock recording its
retirement) and neither does `Rise`; both are deleted with their tests and their barrel exports.
`LiveMarker` has three real consumers (`week-status-badge`, `matchup-strip`, `matchup-hero`),
none of them another round's, so they move to `LiveChip` and the file goes.
*Cost if wrong:* a surface outside this worktree that imports one of the three fails to compile,
which `tsc` catches before anything merges.
