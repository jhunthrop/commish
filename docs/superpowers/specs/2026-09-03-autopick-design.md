# Need-aware autopick (clock-expiry) — design

Founder-approved upgrade to what fires when a real manager's clock expires. Today
`bestAvailableFor` (src/draft-engine/selectors.ts) is: (1) first legal queued player,
(2) first legal player in board order. The queue step is untouched; the fallback becomes a
deterministic, need-aware argmax with a round ramp.

## The policy, stated once

```
autopick(team) =
  first legal, undrafted player in the team's own ranked queue     (unchanged, always wins)
  else argmax over ALL legal available players of
      score(candidate) = rankWeight(legalIndex) × needMultiplier(position)
  ties (exactly equal scores) resolve to the earlier board index    (no RNG anywhere)
```

- `legalIndex` is the candidate's 0-based index among the LEGAL available players, in board
  order — the same indexing the bots' sampler uses over its eligible candidates, so rank 0 is
  "the best player this roster can actually take", not "the best player in the pool".
- Legality is the engine's own `assignSlot`, unchanged. The endgame forcing (bench full means
  only unfilled starters are legal) is therefore inherited, not reimplemented.
- Everything is a pure function of `DraftState`. No clock, no RNG: the same action log always
  reproduces the same autopick, which is non-negotiable in money rooms.

## rankWeight

`rankWeight(i) = exp(-i / temperature)` — the identical exponential decay shape the practice
bots use (`src/mock-draft/bots.ts`), extracted into the engine as a shared pure helper
(`src/draft-engine/scoring.ts`) and consumed by `bots.ts` from there, because the engine may
depend on nothing above it. The autopick's own temperature constant lives in the ENGINE's
config (`AUTOPICK_CONFIG.temperature`), never imported from `src/mock-draft`.

## needMultiplier

Same semantics as the bots': open DEDICATED starting slots (the slot type sharing the
position's name — FLEX and bench excluded) warm a position; all-starters-filled cools it below
neutral. The shared helper takes the warm-per-slot and the cooled value as parameters:

```
needMultiplier(position) =
  open > 0 :  1 + openSlotBoost × open
  open = 0 :  filledDamp
```

The bots pass `openSlotBoost = archetype.needWeight × needPerOpenStartingSlot` and
`filledDamp = startersFilledDamp` — zero behavior change. The autopick passes the RAMPED
versions below.

## The round ramp

Need weight scales linearly with the team's OWN draft progress:

```
ramp = min(1, roster.length / (rampFullAtRosterFraction × totalRosterSlots))
openSlotBoost = ramp × needPerOpenStartingSlot
filledDamp    = 1 − ramp × (1 − startersFilledDamp)      (lerp from 1 down to startersFilledDamp)
```

- Round 1 (`roster.length = 0`): ramp is exactly 0, every multiplier is exactly 1, the score is
  strictly decreasing in board index, and the argmax IS the first legal player in board order —
  the current behavior, provably, not approximately.
- Full need weight by the roster-size midpoint (`rampFullAtRosterFraction = 0.5`; 7.5 picks
  into a 15-slot roster).
- LINEAR, not a curve, on purpose: the exponential rankWeight already dominates early (one
  board rank costs ~28% of score at temperature 3), so a fancier ramp curve buys nothing a
  reviewer could verify by hand. Linear is the only shape a dispute can be re-derived from with
  a pocket calculator, and every autopick in a money room must survive exactly that dispute.
- Derived from `roster.length`, NEVER the global pick number: a team redeeming owed catch-up
  picks is scored by how full its own roster is, so owed picks behave sanely.

## Reach bound (a property, not a tunable)

The furthest need can pull a player up the board is
`temperature × ln(maxBoost / minDamp)` ranks. At the shipped values the worst case
(2 open RB slots vs a fully cooled position) is `3 × ln(1.8 / 0.6) ≈ 3.3` ranks — an autopick
can never "reach" absurdly, by construction, with no reachDepth cap needed.

## Tunables (all in `AUTOPICK_CONFIG`, src/draft-engine/config.ts)

| tunable | value | why |
|---|---|---|
| `temperature` | 3.0 | the same decay steepness the practice bots ship (`MOCK_CONFIG.strategy.temperature`); one board rank ≈ ×0.72 |
| `needPerOpenStartingSlot` | 0.4 | the bots' own warm-per-open-starter, at full ramp |
| `startersFilledDamp` | 0.6 | the bots' own cooled value, at full ramp |
| `rampFullAtRosterFraction` | 0.5 | full need weight at the roster-size midpoint (founder design) |

The values match `MOCK_CONFIG.strategy` deliberately (they are the tuning the founder already
approved for the bots) but are the engine's OWN constants: `src/mock-draft` stays above the
engine, and retuning practice bots must never retune a money room's autopick.

## Per-caller decisions

| caller | decision | why |
|---|---|---|
| `reduceSnakeExpiry` (snake.ts) | NEW need-aware scoring | this IS the clock-expiry autopick |
| `reduceCatchUpExpiry` (snake.ts) | NEW need-aware scoring | a catch-up expiry is the same autopick at the owed pick number; ramp reads the team's own roster length so it scores correctly mid-catch-up |
| `reduceAuctionExpiry` auto-nomination (auction.ts) | KEEP queue-then-board-order (`bestNominationFor`) | nomination is "which player do I put up for the whole room to bid on", not "which player do I add to my roster". Need-aware nomination would put up exactly the players the stalled team needs — inviting the room to bid up its own shopping list — and would silently change auction price dynamics. Its current behavior is pinned by test. |
| `seed-format-demos.ts`, `drive-dev-draft.ts` | follow `bestAvailableFor` | both simulate "the pick an autopick would make"; they should keep saying the truth |

`bestAvailableFor` keeps its name and remains the autopick policy (queue, then need-aware
argmax). The auction's board-order fallback becomes the separate selector `bestNominationFor`
(queue, then board order — byte-identical to today's behavior), so the auction path cannot be
changed by accident.

## Extraction layout

- `src/draft-engine/scoring.ts` (new): `rankWeight(index, temperature)`,
  `openStartingSlots(position, roster, slotConfig)`,
  `needMultiplier(position, roster, slotConfig, { openSlotBoost, filledDamp })`. Pure, no
  config reads — every tunable is a parameter.
- `src/draft-engine/config.ts`: `AUTOPICK_CONFIG` (above).
- `src/mock-draft/bots.ts`: consumes the shared helpers from `@/draft-engine`, passing
  `MOCK_CONFIG.strategy` values — zero behavior change, its tests pass untouched except
  imports.

## UX copy

Everywhere the room describes the autopick fallback ("from your queue", "from the best
available"), the words are updated to the honest sentence: your queue first, then the best
player your roster needs. No em-dashes. Surfaces: /league-rules page, the room dock's queue
panel, the room tour, the league join sheet.
