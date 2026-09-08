/**
 * ROOM SIGNALS — spec 3.3, measured from the live pick log, the valued board and the plan's own
 * runs. Three reads and nothing invented:
 *
 * - THE RUN: a position took at least `runThreshold` of the last `runWindow` picks.
 * - THE TIER COLLAPSE: for each position, where its best undrafted player stands in the tier
 *   structure of what is LEFT (`tierStanding` over the undrafted, best first), listed only when
 *   the drop behind him is a real cliff by the games-worth rule (`isRealTierCliff`).
 * - AHEAD OF YOU: every pick between now and your next turn, read from the plan's own runs
 *   (spec 3.1a: never a separate heuristic) — the position and player that seat took most often,
 *   with the share and the seat's driver so the card can say whether it is a read or the prior.
 */
import type { Position } from "@/domain/player";
import type { DraftState } from "@/draft-engine";
import { draftedPlayerIds } from "@/draft-engine";
import { isRealTierCliff, tierStanding } from "@/projections/decide/tiers";
import type { HorizonOddsResult } from "../sim/horizon-odds";
import type { SeatDriver, SeatDrivers } from "../sim/seat-model";
import type { ValuedEntry } from "./call";
import { ADVISOR_CONFIG } from "./config";
import type { PositionRun, RoomSignals, SeatAhead, SeatDriverView, TierCollapse } from "./view";

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

const TIER_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function tierLabelOf(index: number): string {
  return TIER_LETTERS[index] ?? `T${index + 1}`;
}

/** One row per position whose best remaining player sits at a real cliff. */
export function tierCollapses(state: DraftState, valued: ReadonlyMap<string, ValuedEntry>): readonly TierCollapse[] {
  const drafted = draftedPlayerIds(state);
  const byPosition = new Map<Position, ValuedEntry[]>();
  for (const entry of valued.values()) {
    if (drafted.has(entry.playerId)) continue;
    byPosition.set(entry.position, [...(byPosition.get(entry.position) ?? []), entry]);
  }
  const rows: TierCollapse[] = [];
  for (const [position, entries] of byPosition) {
    const sorted = [...entries].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
    const standing = tierStanding(sorted.map((entry) => entry.projectedPoints), 0);
    if (!isRealTierCliff(sorted[0]!.projectedPoints, standing.dropToNextTier)) continue;
    rows.push({ position, tierLabel: tierLabelOf(standing.tier), playersLeftInTier: standing.playersLeftInTier, dropToNextTier: standing.dropToNextTier });
  }
  return rows.sort((a, b) => a.playersLeftInTier - b.playersLeftInTier || b.dropToNextTier - a.dropToNextTier || a.position.localeCompare(b.position));
}

function driverView(driver: SeatDriver | undefined): SeatDriverView {
  if (driver === undefined) return { kind: "archetype", name: "best_available", basis: "prior", picksObserved: 0 };
  if (driver.kind === "autopick") return { kind: "autopick", picksObserved: driver.picksObserved };
  return { kind: "archetype", name: driver.archetype.name, basis: driver.basis, picksObserved: driver.picksObserved };
}

/** The seats between now and your next turn, read from the runs that produced `odds`. */
export function seatsAhead(state: DraftState, odds: HorizonOddsResult, drivers: SeatDrivers): readonly SeatAhead[] {
  return odds.seatsAhead.map((seat) => ({
    teamId: seat.teamId,
    seat: state.draftOrder.indexOf(seat.teamId) + 1,
    pickNumber: seat.pickNumber,
    runs: seat.runs,
    topPosition: seat.topPosition === null ? null : { position: seat.topPosition.value, share: seat.topPosition.share },
    topPlayer: seat.topPlayer === null ? null : { playerId: seat.topPlayer.value, share: seat.topPlayer.share },
    driver: driverView(drivers[seat.teamId]),
  }));
}

export interface RoomSignalsInput {
  readonly state: DraftState;
  readonly valued: ReadonlyMap<string, ValuedEntry>;
  readonly odds: HorizonOddsResult;
  readonly drivers: SeatDrivers;
}

export function roomSignals({ state, valued, odds, drivers }: RoomSignalsInput): RoomSignals {
  return { run: detectRun(state), collapses: tierCollapses(state, valued), ahead: seatsAhead(state, odds, drivers) };
}
