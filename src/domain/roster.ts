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
