/**
 * OUR BOARD, FOR THE SIM — the evidence pool ordered the way Draft HQ's own Board orders it:
 * value over replacement under a league's shape, never raw projected points.
 *
 * THE BUG THIS EXISTS TO CLOSE (founder, 2026-09-05): the Simulator's "realistic best available"
 * named a quarterback at nearly every pick, because the sim read the stored board rank, which
 * `@/projections/preseason/board.ts` documents as a rank BY PROJECTED POINTS. Everyone starts one
 * quarterback and the twelfth scores close to the first, so points crown them and value does not.
 * `@/draft-hq/board/service.ts`'s `boardRows` already ran `valueBoardIndexed` for exactly this
 * reason; this module is the same read for the sim, so the two surfaces cannot disagree.
 *
 * Pure, and shape-parameterized rather than shape-defaulted: a rank is only true under the league
 * it was measured in, so the caller hands in the shape it is simulating.
 */
import { valueBoardIndexed, type LeagueShape } from "@/projections/decide/replacement";
import type { SimPlayerEvidence } from "./types";

/**
 * `pool`, best player first by value over replacement under `shape`.
 *
 * Players at a position the shape never starts carry no value at all (`valueBoard` leaves them
 * out rather than valuing them at zero) and sink below every valued player, ordered by their own
 * projected points. They stay IN the returned order because the sim's draft pool must still hold
 * every player the room can legally roster, exactly as the Board still lists them at the bottom.
 */
export function valueOrderFor(pool: readonly SimPlayerEvidence[], shape: LeagueShape): readonly SimPlayerEvidence[] {
  const { byPlayerId } = valueBoardIndexed(
    pool.map(({ playerId, position, projectedPoints }) => ({ playerId, position, projectedPoints })),
    shape,
  );
  return [...pool].sort((a, b) => {
    const aValued = byPlayerId.get(a.playerId);
    const bValued = byPlayerId.get(b.playerId);
    if (aValued === undefined || bValued === undefined) {
      if (aValued !== undefined) return -1;
      if (bValued !== undefined) return 1;
      return b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId);
    }
    // The identical comparator `valueBoard` sorts by, so this order IS the Board's order.
    return bValued.valueOverReplacement - aValued.valueOverReplacement || a.playerId.localeCompare(b.playerId);
  });
}
