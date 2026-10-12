/**
 * THE ONE ORDER A BOARD IS SERVED IN — shared by Draft HQ's Board (`@research/board/service`'s
 * `boardRows`) and the Simulator's own read of the same board (`@/draft-service/sim/value-order.ts`).
 * Both surfaces sit next to each other on the same screen, so a second copy of this comparator is
 * a second board, and the two would eventually disagree about a real player.
 *
 * THE BOARD ORDERS BY VALUE, NOT RAW POINTS (founder, 2026-09-04: "we have way too many QBs
 * ranked too high"). Raw season points crown quarterbacks because everyone starts one and
 * replacement-level quarterback scoring is high; draft VALUE is points over replacement under the
 * league's shape, which the auction dollars and the tier bands already used.
 *
 * TIES DEFER TO THE MARKET (founder audit, 2026-09-04: two backs identical to the hundredth in
 * points AND value were split RB1/RB2 by a sort artifact, against the market's order). When our
 * own evidence cannot separate two players, the market's preference is information — the same
 * doctrine as the thin-evidence shrinkage. Ceiling is deliberately NOT the tiebreak: at an equal
 * mean a wider band is more variance, not more player, and risk preference belongs to the
 * drafter's slot (the Simulator's question), never baked into the board's order.
 *
 * A player at a position the shape never starts carries no value at all (`valueBoard` leaves him
 * out rather than pricing him at zero) and sinks below every valued player, his points rank the
 * only ordering left that is not arbitrary.
 */

/** What ordering a board needs to know about one player, and nothing else. `BoardRow`
 *  (`@research/board/service`) satisfies this shape as it stands. */
export interface BoardOrderCandidate {
  readonly playerId: string;
  /** Value over replacement under the league's shape, or null for a position it never starts. */
  readonly valueOverReplacement: number | null;
  /** The market's own price, lower drafted earlier — an ADP or a market RANK, since only the
   *  ORDER of two players is ever read here and the two agree on that. Null when the feed never
   *  priced him. */
  readonly marketAdp: number | null;
  /** The evidence board's own rank by projected points, lower first — the last resort, and the
   *  only separator left between two players the shape never starts. */
  readonly rank: number;
}

/** Sorts best draft choice first. See the module docblock for why each rule is the rule. */
export function compareBoardOrder(a: BoardOrderCandidate, b: BoardOrderCandidate): number {
  if (a.valueOverReplacement === null || b.valueOverReplacement === null) {
    if (a.valueOverReplacement !== null) return -1;
    if (b.valueOverReplacement !== null) return 1;
    return a.rank - b.rank;
  }
  if (a.valueOverReplacement !== b.valueOverReplacement) return b.valueOverReplacement - a.valueOverReplacement;
  const aAdp = a.marketAdp ?? Number.POSITIVE_INFINITY;
  const bAdp = b.marketAdp ?? Number.POSITIVE_INFINITY;
  if (aAdp !== bAdp) return aAdp - bAdp;
  return a.playerId.localeCompare(b.playerId);
}
