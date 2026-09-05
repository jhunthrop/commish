import type { Position } from "@/domain/player";
import type { BoardReason } from "@/projections/preseason/board";

/**
 * ROOM READS — Task 4: two pure client-side readings of the room's own already-fetched state
 * (`RoomState.view.picks`, `RoomState.reasons`), never a fetch or a fabricated number.
 *
 * `detectRun` answers "is a position going in a cluster right now," from the plain sequence of
 * positions taken over the most recent picks. `tierCountdowns` answers "how many players are
 * left before a position's price drops," read straight off the board's own `tier_cliff` reason
 * for the best undrafted player at each position — never computed here, only surfaced.
 */

/** How many of the most recently completed picks a run is judged over. */
export const RUN_WINDOW = 7;
/** The minimum count, within that window, for the cluster to be called a run. */
export const RUN_THRESHOLD = 5;

export interface PositionRun {
  readonly position: Position;
  readonly count: number;
  /** The actual window size the count was drawn from — `RUN_WINDOW`, or fewer picks early in the draft. */
  readonly window: number;
}

/**
 * `recentPositions` is every position picked so far, oldest first — this function looks only at
 * its last `RUN_WINDOW` entries (or all of them, early in the draft, when fewer exist). Because
 * `RUN_WINDOW` picks can hold at most one position at or above `RUN_THRESHOLD` (5 of 7 leaves no
 * room for a second), the loudest position in the window is unambiguous whenever one qualifies.
 */
export function detectRun(recentPositions: readonly Position[]): PositionRun | null {
  const window = Math.min(RUN_WINDOW, recentPositions.length);
  if (window === 0) return null;

  const inWindow = recentPositions.slice(recentPositions.length - window);
  const counts = new Map<Position, number>();
  for (const position of inWindow) counts.set(position, (counts.get(position) ?? 0) + 1);

  let loudest: { position: Position; count: number } | null = null;
  for (const [position, count] of counts) {
    if (loudest === null || count > loudest.count) loudest = { position, count };
  }

  if (loudest === null || loudest.count < RUN_THRESHOLD) return null;
  return { position: loudest.position, count: loudest.count, window };
}

export interface TierCountdown {
  readonly position: Position;
  readonly playersLeftInTier: number;
  readonly dropToNextTier: number;
}

function tierCliffReason(reasons: readonly BoardReason[] | undefined): Extract<BoardReason, { code: "tier_cliff" }> | undefined {
  return reasons?.find((reason): reason is Extract<BoardReason, { code: "tier_cliff" }> => reason.code === "tier_cliff");
}

/**
 * One row per position, read from the best (first-listed) undrafted player at that position —
 * the brief's `undraftedIds` and `reasons` params, plus `positionsById` (`RoomState.playersById`
 * narrowed to just `Player.position`), which the two-argument sketch in the task brief omitted
 * but which the row shape (`TierCountdown.position`) cannot be produced without: something has
 * to say which position each undrafted id belongs to. `undraftedIds` is assumed ordered best
 * first (the room's own board order), so the first id seen for a position is that position's
 * best undrafted player.
 *
 * A position is skipped entirely when its best player carries no `tier_cliff` reason — absence
 * is absence, never a made-up countdown. A worse player at that same position having one does
 * not resurrect the row: the countdown is stated for the player you would actually take next.
 */
export function tierCountdowns(
  undraftedIds: readonly string[],
  positionsById: ReadonlyMap<string, Position>,
  reasons: ReadonlyMap<string, readonly BoardReason[]>,
): readonly TierCountdown[] {
  const seen = new Set<Position>();
  const rows: TierCountdown[] = [];

  for (const id of undraftedIds) {
    const position = positionsById.get(id);
    if (position === undefined || seen.has(position)) continue;
    seen.add(position);

    const cliff = tierCliffReason(reasons.get(id));
    if (cliff === undefined) continue;

    rows.push({ position, playersLeftInTier: cliff.playersLeftInTier, dropToNextTier: cliff.dropToNextTier });
  }

  return rows;
}
