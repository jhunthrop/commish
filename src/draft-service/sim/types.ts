import type { Position } from "@research/domain/player";
import type { RosterSlotConfig } from "@research/domain/roster";
import type { BuildLabel } from "./classify";

/**
 * One player as the simulator needs to see them: the evidence board's own projected points
 * (`@research/projections/preseason/board-store`'s `PreseasonProjectionRow`, joined to the product's
 * own player id the way `@research/board/service` already does), plus the market's own
 * 0-based rank when the ADP feed carries one and null when it does not.
 *
 * DELIBERATELY CARRIES NO BOARD RANK. Our board's order is value over replacement under a
 * LEAGUE'S OWN SHAPE (`value-order.ts`), not a property of the player, so it is derived where the
 * shape is known rather than baked in here. A stored rank by raw points is exactly what put a
 * quarterback at the top of every pick in the Simulator (founder, 2026-09-05).
 */
export interface SimPlayerEvidence {
  readonly playerId: string;
  readonly position: Position;
  readonly marketRank: number | null;
  readonly projectedPoints: number;
}

export interface SimConfig {
  readonly teamCount: number;
  readonly rosterSlots: readonly RosterSlotConfig[];
  /**
   * 1-based seat in the (arbitrary, internal) draft order the sim measures "your slot" from, or
   * `"all"` for the "find my best slot" mode (spec §5) — `simulateDrafts` itself only ever
   * accepts a number; `"all"` is resolved one level up by `simulateAllSlots`, which runs the
   * identical config once per seat and returns one `SimSummary` per slot.
   */
  readonly slot: number | "all";
  readonly rounds: number;
  readonly runs: number;
  /** How tightly the ROOM drafts to market ADP: 0 is a casual room that reaches, 1 is a room
   *  that takes the market in order. `board-order.ts` owns the arithmetic. */
  readonly sharpness: number;
  readonly seed: number;
}

/** `SimConfig` narrowed to the single-slot shape `simulateDrafts` requires. */
export type SingleSlotSimConfig = Omit<SimConfig, "slot"> & { readonly slot: number };

/** What `sim_runs.summary` actually holds: one `SimSummary` for a numeric slot, or one per seat
 *  for `slot: "all"` (`simulateAllSlots`, `simulate.ts`). */
export type StoredSimSummary = SimSummary | { readonly bySlot: readonly SimSummary[] };

export interface BuildOutcome {
  readonly label: BuildLabel;
  /** How many of the `runs` produced a target roster carrying this label — the denominator its
   *  own `top3FinishRate` is measured against, since the five labels are not a partition
   *  (`classify.ts`'s own docblock) and a caller needs to know how much evidence backs each row. */
  readonly runsWithLabel: number;
  readonly top3FinishRate: number;
}

export interface PickAvailabilityRow {
  readonly pickNumber: number;
  readonly round: number;
  /** The evidence board's own best-available player at this pick, in the plurality of runs —
   *  null only when `runs` is 0. */
  readonly expectedBestAvailable: { readonly playerId: string; readonly position: Position } | null;
  /** Fraction of runs where `expectedBestAvailable` was still undrafted at this exact pick. */
  readonly survivalRate: number;
  /** Who actually replaced him, by frequency, across the runs where he was already gone —
   *  longest list first, ties broken by player id for reproducibility. */
  readonly fallbacks: readonly { readonly playerId: string; readonly position: Position; readonly runs: number }[];
}

export interface ExposureRow {
  readonly playerId: string;
  readonly position: Position;
  /** Fraction of runs where this player ended up anywhere on the target seat's final roster. */
  readonly rosterShare: number;
}

export interface SimSummary {
  readonly runs: number;
  readonly teamCount: number;
  readonly slot: number;
  readonly rounds: number;
  /** `min(3, teamCount) / teamCount` — the top-3 finish rate a build with no real edge would
   *  post by construction, never a measured or hand-picked number. */
  readonly baselineTop3Rate: number;
  readonly builds: readonly BuildOutcome[];
  readonly availability: readonly PickAvailabilityRow[];
  readonly exposure: readonly ExposureRow[];
  readonly meanFinishRank: number;
  /** Wall-clock milliseconds this exact call spent computing — never a hand-typed sentence
   *  ("12 seconds"), the honest-data rule Task 1 states in the builder brief applied to
   *  performance claims, not only to draft outcomes. */
  readonly elapsedMs: number;
}
