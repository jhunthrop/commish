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
import { compareBoardOrder } from "@/projections/decide/board-order-compare";
import { valueBoardIndexed, type LeagueShape } from "@/projections/decide/replacement";
import type { SimPlayerEvidence } from "./types";

/**
 * `pool`, in the Board's own served order under `shape` — `compareBoardOrder`, the exact
 * comparator `boardRows` sorts by, so the Simulator and the Board cannot disagree about a player.
 *
 * Players at a position the shape never starts carry no value at all (`valueBoard` leaves them
 * out rather than valuing them at zero) and sink below every valued player. They stay IN the
 * returned order because the sim's draft pool must still hold every player the room can legally
 * roster, exactly as the Board still lists them at the bottom.
 */
export function valueOrderFor(pool: readonly SimPlayerEvidence[], shape: LeagueShape): readonly SimPlayerEvidence[] {
  const { byPlayerId } = valueBoardIndexed(
    pool.map(({ playerId, position, projectedPoints }) => ({ playerId, position, projectedPoints })),
    shape,
  );
  // The board's own rank by projected points, which the sim's pool does not carry (a stored rank
  // by points is what this whole module exists to stop being read as an order) but the shared
  // comparator still needs as its last resort. Derived from the points themselves, so it IS that
  // rank rather than a second opinion about it.
  const byPoints = [...pool].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
  const pointsRank = new Map(byPoints.map((entry, index) => [entry.playerId, index] as const));

  return pool
    .map((entry) => ({
      entry,
      playerId: entry.playerId,
      valueOverReplacement: byPlayerId.get(entry.playerId)?.valueOverReplacement ?? null,
      // A market RANK where the Board reads an ADP. Only the order of two players is ever read,
      // and the two agree on that.
      marketAdp: entry.marketRank,
      rank: pointsRank.get(entry.playerId)!,
    }))
    .sort(compareBoardOrder)
    .map(({ entry }) => entry);
}
