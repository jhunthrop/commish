import type { DraftPoolEntry } from "@/domain/draft";
import { rosterFor, totalRosterSlots, type DraftState } from "./state";
import { snakeTeamForPick } from "./order";
import { assignSlot } from "./slotting";

export function draftedPlayerIds(state: DraftState): ReadonlySet<string> {
  return new Set(state.picks.map((p) => p.playerId));
}

/** The undrafted pool, still in ranking order. */
export function availablePool(state: DraftState): readonly DraftPoolEntry[] {
  const drafted = draftedPlayerIds(state);
  return state.pool.filter((p) => !drafted.has(p.playerId));
}

export function openSlotCount(state: DraftState, teamId: string): number {
  return totalRosterSlots(state.config.slotConfig) - rosterFor(state, teamId).length;
}

export function isComplete(state: DraftState): boolean {
  return state.phase === "complete";
}

/** Whose turn it is: to pick (snake) or to nominate (auction — extended in Task 3). */
export function teamOnClock(state: DraftState): string | null {
  if (state.phase !== "in_progress") return null;
  return snakeTeamForPick(state.draftOrder, state.pickNumber);
}

/**
 * The autopick policy, stated once: the highest-ranked undrafted player this team can
 * legally roster. Ranking is `state.pool`'s order — an explicit input snapshotted at
 * START_DRAFT, never an ambient lookup — so the same log always autopicks the same player.
 */
export function bestAvailableFor(state: DraftState, teamId: string): DraftPoolEntry | null {
  const roster = rosterFor(state, teamId);
  for (const entry of availablePool(state)) {
    if (assignSlot({ position: entry.position, roster, slotConfig: state.config.slotConfig }).ok) return entry;
  }
  return null;
}
