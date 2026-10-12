import type { Position } from "./player";

export type RosterSlotType = "QB" | "RB" | "WR" | "TE" | "FLEX" | "SUPERFLEX" | "K" | "DEF" | "BENCH";

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

/**
 * The named roster shapes this product ships. The actual slot ROWS for each (`ROSTER_SHAPES`)
 * live in `@research/domain/roster-shape` beside `describeRosterShape` — but the NAME and the WORDS
 * live here instead, because the create form is browser code that may not value-import
 * `@/league` at all (the client boundary, `eslint.config.mjs`'s `SERVER_ONLY_MODULE_GROUPS`),
 * the identical reason `LEAGUE_EXPERIENCE_TIER_LABEL` lives in `@/identity/config` rather than
 * beside the service function that reads it.
 */
export type RosterShapeName = "standard" | "superflex";

/** The one map that decides a roster-shape select's words, so a value is never hand-typed at a call site. */
export const ROSTER_SHAPE_LABEL: Readonly<Record<RosterShapeName, string>> = {
  standard: "Standard",
  superflex: "Superflex",
};
