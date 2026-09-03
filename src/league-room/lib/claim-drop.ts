/**
 * THE CLAIM'S HIDDEN COST — the drop, pre-filled honestly.
 *
 * A full roster means a claim needs a drop, and the sheet leads with the viewer's
 * lowest-projected bench player so the real decision is visible before the verb. Ranking is
 * this week's projection ascending (the only forward-looking number the platform computes),
 * with ADP as the tiebreak and the fallback when the projection snapshot is empty: a later
 * ADP reads as the lesser player, and a player nobody drafted ranks as the first to go.
 */
import type { Position } from "@/domain/player";
import type { LineupSlotView } from "../contract";

export interface DropCandidate {
  readonly playerId: string;
  readonly playerName: string;
  readonly position: Position;
  readonly nflTeam: string | null;
  readonly projection: number | null;
  readonly adp: number | null;
}

/** Bench only, worst first; the head is the pre-filled drop. */
export function rankDropCandidates(
  bench: readonly LineupSlotView[],
  projectionsByPlayerId: ReadonlyMap<string, number>,
): readonly DropCandidate[] {
  return bench
    .flatMap((slot) => {
      if (slot.playerId === null || slot.playerName === null || slot.position === null) return [];
      return [
        {
          playerId: slot.playerId,
          playerName: slot.playerName,
          position: slot.position,
          nflTeam: slot.nflTeam,
          projection: projectionsByPlayerId.get(slot.playerId) ?? null,
          adp: slot.adp,
        },
      ];
    })
    .slice().sort((a, b) => {
      const aProjection = a.projection ?? 0;
      const bProjection = b.projection ?? 0;
      if (aProjection !== bProjection) return aProjection - bProjection;
      // Later (or missing) ADP is the lesser player, dropped first.
      return (b.adp ?? Number.POSITIVE_INFINITY) - (a.adp ?? Number.POSITIVE_INFINITY);
    });
}
