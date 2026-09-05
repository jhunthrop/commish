/**
 * ONE ROSTER'S SEASON SCORE, under the league's own roster shape and the evidence board's own
 * points (`BOARD_SOURCE`'s `projectedPoints` — see `@/draft-hq/board/service.ts`'s docblock for
 * why those points are NOT repriced under a league's scoring FORMAT: that would need the season
 * stat line stored and `computeFantasyPoints` re-run per format, which is undone work, reported
 * deferred rather than faked. This module inherits that same honest limit).
 *
 * What DOES vary correctly per league here is the ROSTER SHAPE: a drafted roster is worth its
 * best STARTING lineup, never its whole bench, and which slots exist (FLEX vs SUPERFLEX, a
 * TE-premium league's own counts) is exactly what `RosterSlotConfig` carries.
 *
 * THE ASSIGNMENT IS GREEDY, MOST-RESTRICTIVE-SLOT-FIRST — the identical algorithm
 * `@/projections/decide/replacement.ts`'s `startingDemand` already uses and already documents as
 * optimal for this product's NESTED eligibility shapes (a dedicated position slot's eligible set
 * is always a subset of FLEX's, which is always a subset of SUPERFLEX's, which is always a subset
 * of BENCH's): processing slots from the smallest eligible-position set to the largest can never
 * strand a scarce-eligibility slot behind a wide one that could have taken a lesser player
 * instead. A commissioner-configured shape that is NOT nested would make this heuristic only an
 * upper bound rather than the true optimum — `replacement.ts`'s own docblock carries the
 * identical caveat.
 */
import type { RosterSlotConfig } from "@/domain/roster";
import { BENCH_SLOT } from "@/domain/roster";

export interface RosteredPlayer {
  readonly playerId: string;
  readonly position: string;
}

/**
 * The best legal starting lineup's total points from `roster` under `slotConfig`, scored by
 * `pointsByPlayerId` (a player absent from the map — no evidence board entry — contributes 0
 * rather than being dropped, so an unranked deep-bench pick never silently shrinks the roster
 * `bestStartingLineupPoints` counts against). Bench slots and any slot instance no eligible
 * player remains for are simply left empty; nothing here fabricates a starter.
 */
export function bestStartingLineupPoints(roster: readonly RosteredPlayer[], slotConfig: readonly RosterSlotConfig[], pointsByPlayerId: ReadonlyMap<string, number>): number {
  const pointsOf = (playerId: string): number => pointsByPlayerId.get(playerId) ?? 0;
  const remaining = [...roster].sort((a, b) => pointsOf(b.playerId) - pointsOf(a.playerId) || a.playerId.localeCompare(b.playerId));
  const taken = new Set<string>();

  const startingSlots = slotConfig
    .filter((slot) => slot.slot !== BENCH_SLOT)
    .sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length);

  let total = 0;
  for (const slot of startingSlots) {
    for (let unit = 0; unit < slot.count; unit += 1) {
      const eligible = new Set(slot.eligiblePositions as readonly string[]);
      const pick = remaining.find((player) => !taken.has(player.playerId) && eligible.has(player.position));
      if (pick === undefined) continue;
      taken.add(pick.playerId);
      total += pointsOf(pick.playerId);
    }
  }
  return total;
}
