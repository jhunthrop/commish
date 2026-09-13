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
 *   - a position is CAPPED (founder ruling, 2026-09-12): a position the league starts ONE of
 *     (the quarterback, the tight end) holds at most one bench body, so a team holds at most two
 *     of it whatever the shape; a late-round position (the kicker, the team defense) holds none;
 *     the rest of the bench goes to the multi-starter positions (the backs and receivers) in
 *     proportion to their starting slots, the flex included;
 *   - the one backup at a single-starter position is DEFERRED while any starter is still open:
 *     the second quarterback and the second tight end come after the lineup is built, and then
 *     only when the board says he is worth more than the bench back or receiver beside him.
 * Pure over roster and slot config, so the autopick and the advisor read one rule.
 */
import type { DraftPoolEntry } from "@/domain/draft";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig } from "@/domain/roster";
import { LATE_ROUND_ONLY_POSITIONS } from "./scoring";

/** The one dial the ceiling rule carries; it rides the START_DRAFT snapshot (`DraftAutopickPolicy.rosterCeilings`). */
export interface RosterCeilingPolicy {
  /** Bench bodies allowed at a position the league starts exactly one of (one: a team holds at most two). */
  readonly backupsAtSingleStarterPosition: number;
}

/** Every position some slot in the league takes. */
function rosteredPositions(slotConfig: readonly RosterSlotConfig[]): readonly Position[] {
  return [...new Set(slotConfig.flatMap((config) => config.eligiblePositions))];
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

/** Starting slots a position can fill: its dedicated ones and the shared ones it is eligible for. */
function startingDemand(position: Position, slotConfig: readonly RosterSlotConfig[]): number {
  return dedicatedSlots(position, slotConfig) + sharedSlotsEligible(position, slotConfig);
}

/**
 * Which position a shared slot is, in practice: the eligible position that scores the most over
 * a season, the ordering every projection in this product carries (a quarterback out-scores a
 * back, a back a receiver, a receiver a tight end). A SUPERFLEX that admits the quarterback is a
 * second quarterback slot; a FLEX that admits the tight end beside backs and receivers is not a
 * tight-end slot. The late two never share.
 */
const SHARED_SLOT_CLAIMANT_ORDER: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

function claimsSharedSlot(position: Position, config: RosterSlotConfig): boolean {
  return SHARED_SLOT_CLAIMANT_ORDER.find((candidate) => config.eligiblePositions.includes(candidate)) === position;
}

/** Shared slots that are `position`'s in practice (`SHARED_SLOT_CLAIMANT_ORDER`). */
function sharedSlotsClaimed(position: Position, slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.filter((config) => isSharedSlot(config) && claimsSharedSlot(position, config)).reduce((sum, config) => sum + config.count, 0);
}

/**
 * A position with exactly ONE startable slot, counting the shared slots that are its in practice
 * (the review ruling of 2026-09-13, read against the founder's: a team holds at most two of a
 * position the league starts one of), the late-round two excepted. The quarterback in a 1-QB
 * league and the tight end in the standard shape (its flex belongs to the backs and receivers)
 * are single-starter positions; a superflex or two-QB league gives the quarterback two startable
 * slots, so he is not one and takes the ordinary bench allowance, the third after the starters.
 */
export function isSingleStarterPosition(position: Position, slotConfig: readonly RosterSlotConfig[]): boolean {
  return !LATE_ROUND_ONLY_POSITIONS.includes(position) && dedicatedSlots(position, slotConfig) + sharedSlotsClaimed(position, slotConfig) === 1;
}

/**
 * The most players a roster should hold at `position` (the founder's ruling, 2026-09-12). A
 * single-starter position: its one starter plus `backupsAtSingleStarterPosition`, the shared
 * slots it might fill counted for nothing, so a team holds at most two whatever the shape. A
 * late-round position: its starters, no bench. Every other position: its starters, the shared
 * slots it may fill, and its share of what the bench has left after the single-starter backups,
 * split in proportion to starting demand with the flex included (six bench spots in the standard
 * shape: one each to QB and TE, then four over RB 3 and WR 3, two each), rounded. Zero for a
 * position nothing rosters.
 */
export function positionCeiling(position: Position, slotConfig: readonly RosterSlotConfig[], policy: RosterCeilingPolicy): number {
  const dedicated = dedicatedSlots(position, slotConfig);
  const shared = sharedSlotsEligible(position, slotConfig);
  if (dedicated === 0 && shared === 0) return 0;
  if (LATE_ROUND_ONLY_POSITIONS.includes(position)) return dedicated;
  if (isSingleStarterPosition(position, slotConfig)) return dedicated + policy.backupsAtSingleStarterPosition;
  const positions = rosteredPositions(slotConfig);
  const singleStarters = positions.filter((candidate) => isSingleStarterPosition(candidate, slotConfig)).length;
  const remaining = Math.max(0, benchSlots(slotConfig) - singleStarters * policy.backupsAtSingleStarterPosition);
  const multiStarters = positions.filter((candidate) => !LATE_ROUND_ONLY_POSITIONS.includes(candidate) && !isSingleStarterPosition(candidate, slotConfig));
  const demand = multiStarters.reduce((sum, candidate) => sum + startingDemand(candidate, slotConfig), 0);
  return dedicated + shared + Math.round(remaining * (startingDemand(position, slotConfig) / demand));
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
  return countByPosition(roster.filter((spot) => spot.slot === BENCH_SLOT), pool);
}

/** How many of the roster's players sit at each position, read off the pool's own positions. */
export function rosteredByPosition(roster: readonly RosterSlot[], pool: readonly DraftPoolEntry[]): ReadonlyMap<Position, number> {
  return countByPosition(roster, pool);
}

function countByPosition(spots: readonly RosterSlot[], pool: readonly DraftPoolEntry[]): ReadonlyMap<Position, number> {
  const positionOf = new Map(pool.map((entry) => [entry.playerId, entry.position] as const));
  const counts = new Map<Position, number>();
  for (const spot of spots) {
    const position = spot.playerId === null ? undefined : positionOf.get(spot.playerId);
    if (position !== undefined) counts.set(position, (counts.get(position) ?? 0) + 1);
  }
  return counts;
}

/** What one legal candidate is to this roster under the rule above. */
export interface CandidateRole {
  /** He would fill a starting slot (dedicated or shared) rather than sit. */
  readonly starts: boolean;
  /** Open starting slots he could fill, the flex included; 0 when he sits. */
  readonly openStartingSlots: number;
  /** Bodies already sitting at his position. */
  readonly benchBodies: number;
  /** Taking him would push his position past its ceiling. */
  readonly capped: boolean;
  /** He is the one backup at a single-starter position and a starter is still open. */
  readonly waitsForStarters: boolean;
}

/**
 * THE ONE READER of a candidate's role, built once per roster and asked per candidate: the clock's
 * pick (`selectors.ts`), the practice bots (`@/mock-draft/bots`) and the advisor all classify a
 * man the same way, so no surface can hold a third quarterback another one refuses. `landsIn` is
 * the slot `assignSlot` says he would take, the engine's one legality oracle.
 */
export function candidateRoleReader(
  roster: readonly RosterSlot[],
  slotConfig: readonly RosterSlotConfig[],
  pool: readonly DraftPoolEntry[],
  policy: RosterCeilingPolicy,
): (position: Position, landsIn: RosterSlot["slot"]) => CandidateRole {
  const rostered = rosteredByPosition(roster, pool);
  const bench = benchBodiesByPosition(roster, pool);
  const starterOpen = anyStarterOpen(roster, slotConfig);
  return (position, landsIn) => {
    const starts = landsIn !== BENCH_SLOT;
    return {
      starts,
      openStartingSlots: starts ? openStartingSlotsEligible(position, roster, slotConfig) : 0,
      benchBodies: bench.get(position) ?? 0,
      capped: (rostered.get(position) ?? 0) + 1 > positionCeiling(position, slotConfig, policy),
      // Depth after the lineup, at every position (the review ruling: "the third only after the
      // starters" for a superflex quarterback is the same sentence as the founder's for the second).
      waitsForStarters: !starts && starterOpen,
    };
  };
}
