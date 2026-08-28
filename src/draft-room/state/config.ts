/**
 * Every tunable in the draft room. No component or hook may inline one of these.
 *
 * The countdown tick and its coarse-announcement boundaries moved to `UI_CONFIG.countdown`
 * (`@/components/ui/config`) when `Countdown`/`useCountdown` centralized there at their third
 * caller (Phase 3.5, Task 8) — this room shares that one config now rather than keeping its own
 * copy.
 */
export const DRAFT_ROOM_CONFIG = {
  /** Rows the player pool lists before asking the user to narrow their search. */
  poolPageSize: 60,
  /** How long the pick-landing highlight stays up, ms. */
  celebrationMs: 2_400,
  /**
   * `DraftBoard`'s empty-cell border classes, keyed by whether the round is "future" (more than
   * one round past the active one) or "near" (the active round, or the one right after it). A
   * future round recedes by SHAPE ONLY — a slimmer minimum height — never by diluting
   * `border-line`'s own color with an opacity modifier. `line` is already tuned to sit at the
   * decorative-hairline floor (`tokens.ts`, ~1.57:1 against `surface` in the dark theme (it lifted with the ground, 2026-08-27) —
   * `tokens.test.ts`'s "gives an interactive boundary its own role" — deliberately under WCAG
   * 1.4.11's 3:1 because it separates two surfaces, it does not bound a control). Stacking a
   * `border-line/35` opacity modifier on top of a color already that close to the ground pushed
   * it toward true invisibility once the room re-toned onto v3's original `#0D0D0F` graphite: rounds 3-15
   * of a live draft board read as a void (founder-reported 2026-08-25). Both classes now carry
   * `border-line` at full strength — the line token's own contrast against `surface` is the
   * floor a future cell's border may never drop below.
   */
  emptyCellBorderClass: {
    future: "min-h-4 border-line",
    near: "min-h-12 border-line",
  },
  /**
   * THE VERDICT (the fun pass, Task 7 — `docs/design/2026-08-27-fun-pass-spec.md`).
   *
   * `evenBandPicks` is how far a pick may land from the player's own board rank, in either
   * direction, and still be neither a steal nor a reach. Half a round in a twelve-team league:
   * inside that, the board and the draft simply agree, and calling it a verdict would be
   * manufacturing one.
   *
   * A tunable, never a literal in a component (`../lib/verdict` reads it and nothing else does):
   * these picks ARE the difference between "a steal" and "a fine pick", and that judgement
   * belongs somewhere a persona review can find it in one file rather than inside whichever
   * surface rendered a chip first.
   */
  verdict: {
    evenBandPicks: 6,
  },
  /**
   * `PickWire`'s own tunable (2026-08-26 design review, R1): how many of the draft's most
   * recent picks the band shows, newest first. One number, read by both the room's `text-xs`
   * band and the TV's `text-base` one, so a future retune never drifts between the two.
   */
  wire: {
    maxItems: 6,
  },
  /**
   * THE TIER LADDER IN THE POOL (Gameday, law 1's grade channel).
   *
   * `docs/design-system.md`: *"a tier band is a gap between adjacent ADPs — measured, not
   * drawn."* These two numbers are what "measured" means in practice, and they are a pair:
   *
   * - `cliffAdp` — how far two adjacent players' consensus ADPs must sit apart before the board
   *   is genuinely stepping down rather than merely continuing. Measured against the real feed
   *   rather than picked from a round fraction: across the top eighty ranked players, adjacent
   *   ADPs sit 0.1 to 2.5 apart in the ordinary case and the handful of genuine steps down are 3.0
   *   to 4.6. Three is the floor that separates those two populations, and it draws about five
   *   bands across a sixty-row page — a ladder with rungs, not a rung per step.
   * - `minBandSize` — a cliff only OPENS a band once the band it would close has this many
   *   players in it. Without this the tail of the pool (where the ADP feed ranks 476 of 1,646
   *   players and the gaps between them grow to whole rounds) would draw a band per player, which
   *   is a ladder with a rung for every step: texture, not information.
   *
   * `ladder` grades a band by the consensus ROUND its best player goes in, for the room's own
   * seat count — so an eight-team room and a fourteen-team room grade the same ADP differently,
   * because they should. Four grades, best first, matching `TIER_GRADES` (`@/design/tokens`);
   * a band past the last named round takes the final grade. A player the ADP feed does not rank
   * gets NO band and NO badge: a grade is a fact or it is not drawn.
   */
  tiers: {
    cliffAdp: 3,
    minBandSize: 4,
    ladder: [
      { grade: "S", throughRound: 1 },
      { grade: "A", throughRound: 3 },
      { grade: "B", throughRound: 7 },
      { grade: "C", throughRound: Number.POSITIVE_INFINITY },
    ],
  },
  /**
   * THE BOARD'S ROUND HORIZON, per variant (Gameday, law 4: *"density is respect… no decorative
   * whitespace"*).
   *
   * E7 gave the TV a horizon in 2026-08-26 and left the room without one, on the reasoning that
   * the room's own sliver recede was enough. The first Gameday screenshot of the live room says
   * otherwise: at round 3 of 15, twelve of the fifteen rows were empty dashed rectangles and
   * roughly 55% of the room's hero region carried no fact at all. The season's shape is worth one
   * line ("N rounds ahead"), not half the stage.
   *
   * The room keeps a longer horizon than the TV because a manager plans against it — the next few
   * rounds are where a run is visible — while a party across a room only reads what is happening
   * now.
   */
  boardFutureRoundsShown: {
    room: 2,
    tv: 2,
  },
  /**
   * The dock's own tunables. `onDeckSeats` is how many seats past the one on the clock the
   * dock's turn-order strip names — enough that a manager can see whether the managers between
   * him and his pick are the ones who take his position, short enough that the strip stays one
   * line beside the primary slot at a laptop width.
   */
  dock: {
    onDeckSeats: 5,
  },
  /**
   * The TV surface's own tunables (2026-08-26 design review, E5 + E7). `hotThresholdMs` is the
   * spotlight band's clock — rule 1 puts clocks in the negative family, and the party clock
   * goes hot for everyone in the final 30 seconds, the same way the rail's own clock goes hot
   * for whoever's turn it is.
   */
  tv: {
    hotThresholdMs: 30_000,
  },
} as const;
