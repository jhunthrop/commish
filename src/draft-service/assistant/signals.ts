/**
 * THE ROOM SIGNALS — two reads off the live room, both measured, neither written by a model:
 *
 * - THE RUN (spec 3.3), straight off the pick log: a position took at least `runThreshold` of
 *   the last `runWindow` picks.
 * - THE TIER COLLAPSE: for each projected position, where its best UNDRAFTED player stands in
 *   the tier structure of what is left (`tierStanding` over the undrafted, best first), listed
 *   only when the drop behind him is a real cliff by the games-worth rule (`isRealTierCliff`).
 *   A market-order position (the kicker and team defence decision) has no projected points to
 *   draw a tier from, so it never gets a row.
 *
 * The tier the card's own pick closes comes from `recommendPick`'s `tier_cliff` reason, and the
 * seats ahead come from the room's runs (`sim/room-odds.ts`), so this module carries nothing
 * else. Both reads are facts about the room state, not the viewer, so the service memoises them
 * beside the odds table.
 */
import type { Position } from "@research-ts/domain/player";
import { draftedPlayerIds, type DraftState } from "@/draft-engine";
import { isRealTierCliff, tierStanding } from "@research-ts/projections/decide/tiers";
import { shipsProjectedRows } from "@research-ts/projections/preseason/kdef-decision";
import { ADVISOR_CONFIG } from "./config";
import type { ValuedEntry } from "./recommend";
import type { TierCollapse } from "./view";
import type { PositionRun } from "@research-ts/advisor/why";

/** The run read over the room's own last `runWindow` picks. */
export function detectRun(state: DraftState): PositionRun | null {
  const { runWindow, runThreshold } = ADVISOR_CONFIG.signals;
  const positionOf = new Map(state.pool.map((entry) => [entry.playerId, entry.position] as const));
  const recent = [...state.picks].sort((a, b) => a.pickNumber - b.pickNumber).slice(-runWindow);
  if (recent.length < runThreshold) return null;
  const counts = new Map<Position, number>();
  for (const pick of recent) {
    const position = positionOf.get(pick.playerId);
    if (position !== undefined) counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  const loudest = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  if (loudest === undefined || loudest[1] < runThreshold) return null;
  return { position: loudest[0], count: loudest[1], window: recent.length };
}

/** The undrafted, projected players grouped by position, best first within each. */
function undraftedByPosition(state: DraftState, valued: ReadonlyMap<string, ValuedEntry>): ReadonlyMap<Position, readonly ValuedEntry[]> {
  const drafted = draftedPlayerIds(state);
  const groups = new Map<Position, ValuedEntry[]>();
  for (const entry of valued.values()) {
    if (drafted.has(entry.playerId) || !shipsProjectedRows(entry.position)) continue;
    groups.set(entry.position, [...(groups.get(entry.position) ?? []), entry]);
  }
  return new Map([...groups].map(([position, entries]) => [position, [...entries].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId))]));
}

/** One row per position whose best remaining player sits at a real cliff, tightest tier first. */
export function tierCollapses(state: DraftState, valued: ReadonlyMap<string, ValuedEntry>): readonly TierCollapse[] {
  const rows = [...undraftedByPosition(state, valued)].flatMap(([position, entries]) => {
    const best = entries[0];
    if (best === undefined) return [];
    const standing = tierStanding(entries.map((entry) => entry.projectedPoints), 0);
    if (!isRealTierCliff(best.projectedPoints, standing.dropToNextTier)) return [];
    return [{ position, playersLeftInTier: standing.playersLeftInTier, dropToNextTier: standing.dropToNextTier }];
  });
  return rows.sort((a, b) => a.playersLeftInTier - b.playersLeftInTier || b.dropToNextTier - a.dropToNextTier || a.position.localeCompare(b.position));
}
