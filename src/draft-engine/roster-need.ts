/**
 * ROSTER NEED FROM THE LEAGUE'S OWN SHAPE (the 2026-09-12 draft engine round).
 *
 * THE DEFECT THIS CLOSES, MEASURED (ledger `.superpowers/sdd/draft-engine-autopick-round/`):
 * `needMultiplier` counted surplus over DEDICATED starters only, so a third back who would start
 * in the flex scored as a surplus body, and every further back or receiver compounded down as
 * hard as a second quarterback did. By the late rounds a fifth back scored 0.6 x 0.25^4 while a
 * second quarterback scored 0.6 x 0.25 and a third 0.6 x 0.25^2, and the board decided the rest:
 * two quarterbacks on 99% of autopicked teams, three on 12% (47% in the founder's mock rooms),
 * two tight ends on two thirds.
 *
 * THE RULE, IN WORDS A MANAGER USES. A roster has starters and a bench allowance per position,
 * both read off the slot config and nothing else:
 *   - a candidate who would START (a dedicated slot or a flex he is eligible for is open) is
 *     warm, one boost per open starting slot he could fill;
 *   - a candidate who would SIT is a bench body, cooled once, and cooled again for every body
 *     already sitting at his position;
 *   - a position is CAPPED at its starters, the shared slots it may fill, and its share of the
 *     bench: the whole bench split among the flex positions in proportion to their dedicated
 *     starters, one backup at a position no flex takes (the quarterback in a 1-QB league), none
 *     at a late-round position (the kicker and the team defense);
 *   - a backup at a backup-only position is DEFERRED while any starter is still open: the second
 *     quarterback comes after the lineup is built, and then only when the board says he is worth
 *     more than the bench back or receiver beside him.
 * Pure over roster and slot config, so the autopick and the advisor read one rule.
 */
import type { DraftPoolEntry } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig } from "@/domain/roster";
import { LATE_ROUND_ONLY_POSITIONS } from "./scoring";

/** The one dial the ceiling rule carries; it rides the START_DRAFT snapshot (`DraftAutopickPolicy.rosterCeilings`). */
export interface RosterCeilingPolicy {
  /** Backups allowed at a position with dedicated starters that no shared slot takes. */
  readonly backupsAtNonFlexPosition: number;
}

function isSharedSlot(config: RosterSlotConfig): boolean {
  return config.slot !== BENCH_SLOT && config.eligiblePositions.length > 1;
}

function dedicatedSlots(position: Position, slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.filter((config) => config.slot === position).reduce((sum, config) => sum + config.count, 0);
}

function sharedSlotsEligible(position: Position, slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.filter((config) => isSharedSlot(config) && config.eligiblePositions.includes(position)).reduce((sum, config) => sum + config.count, 0);
}

function benchSlots(slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.filter((config) => config.slot === BENCH_SLOT).reduce((sum, config) => sum + config.count, 0);
}

function flexPositions(slotConfig: readonly RosterSlotConfig[]): readonly Position[] {
  return [...new Set(slotConfig.filter(isSharedSlot).flatMap((config) => config.eligiblePositions))];
}

/** A position with dedicated starters that no shared slot takes and that is not a late-round one. */
export function isBackupOnlyPosition(position: Position, slotConfig: readonly RosterSlotConfig[]): boolean {
  return !LATE_ROUND_ONLY_POSITIONS.includes(position) && dedicatedSlots(position, slotConfig) > 0 && sharedSlotsEligible(position, slotConfig) === 0;
}

/**
 * The most players a roster should hold at `position`: starters, the shared slots he may fill,
 * and the bench allowance. The bench is split among the flex positions in proportion to their
 * dedicated starters (six bench spots over RB 2, WR 2, TE 1 give 2, 2 and 1), rounded; a flex
 * position with no dedicated starter shares equally. Zero for a position nothing rosters.
 */
export function positionCeiling(position: Position, slotConfig: readonly RosterSlotConfig[], policy: RosterCeilingPolicy): number {
  const dedicated = dedicatedSlots(position, slotConfig);
  const shared = sharedSlotsEligible(position, slotConfig);
  if (dedicated === 0 && shared === 0) return 0;
  if (LATE_ROUND_ONLY_POSITIONS.includes(position)) return dedicated;
  if (shared === 0) return dedicated + policy.backupsAtNonFlexPosition;
  const flex = flexPositions(slotConfig);
  const demand = flex.reduce((sum, flexPosition) => sum + dedicatedSlots(flexPosition, slotConfig), 0);
  const share = demand === 0 ? 1 / flex.length : dedicated / demand;
  return dedicated + shared + Math.round(benchSlots(slotConfig) * share);
}

function openSpots(config: RosterSlotConfig, roster: readonly RosterSlot[]): number {
  return config.count - roster.filter((spot) => spot.slot === config.slot).length;
}

/** Open non-bench slots a player at `position` could start in: dedicated and shared alike. */
export function openStartingSlotsEligible(position: Position, roster: readonly RosterSlot[], slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig
    .filter((config) => config.slot !== BENCH_SLOT && config.eligiblePositions.includes(position))
    .reduce((sum, config) => sum + Math.max(0, openSpots(config, roster)), 0);
}

/** Whether any starting slot other than a late-round one is still unfilled, the flex included. */
export function anyStarterOpen(roster: readonly RosterSlot[], slotConfig: readonly RosterSlotConfig[]): boolean {
  return slotConfig.some(
    (config) => config.slot !== BENCH_SLOT && !LATE_ROUND_ONLY_POSITIONS.includes(config.slot as Position) && openSpots(config, roster) > 0,
  );
}

/** How many of the roster's BENCH bodies sit at each position, read off the pool's own positions. */
export function benchBodiesByPosition(roster: readonly RosterSlot[], pool: readonly DraftPoolEntry[]): ReadonlyMap<Position, number> {
  const positionOf = new Map(pool.map((entry) => [entry.playerId, entry.position] as const));
  const counts = new Map<Position, number>();
  for (const spot of roster) {
    if (spot.slot !== BENCH_SLOT || spot.playerId === null) continue;
    const position = positionOf.get(spot.playerId);
    if (position !== undefined) counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  return counts;
}
