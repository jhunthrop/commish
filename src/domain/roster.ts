import type { Position } from "./player";

export type RosterSlotType = "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "DEF" | "BENCH";

export interface RosterSlotConfig {
  readonly slot: RosterSlotType;
  readonly count: number;
  readonly eligiblePositions: readonly Position[];
}

export interface RosterSlot {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly playerId: string | null;
}

export interface Roster {
  readonly teamId: string;
  readonly slots: readonly RosterSlot[];
}

/** The one place the bench slot's name is written. Everything else compares against this. */
export const BENCH_SLOT: RosterSlotType = "BENCH";

/**
 * The canonical 15-slot roster. One definition, used by the `leagues.roster_slots`
 * column default, the dev seed, and every test — a league may override it per-league,
 * but nothing re-declares this shape.
 */
export const STANDARD_ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 2, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "K", count: 1, eligiblePositions: ["K"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: BENCH_SLOT, count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];
