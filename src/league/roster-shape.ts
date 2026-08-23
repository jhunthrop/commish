import {
  BENCH_SLOT,
  ROSTER_SHAPE_LABEL,
  STANDARD_ROSTER_SLOTS,
  type RosterShapeName,
  type RosterSlotConfig,
} from "@/domain/roster";

/**
 * Superflex, config-cheap: one extra slot that accepts a quarterback on top of the running
 * back/receiver/tight end `FLEX` already takes. `assignSlot` (`@/draft-engine/slotting`) reads
 * `eligiblePositions` as data, so this is the entire engine change a second startable
 * quarterback needs — everything downstream (`validateRosterAdd`, `validateLineup`,
 * `defaultLineup`) already treats `RosterSlotConfig` as config, not as a hardcoded shape.
 *
 * `SUPERFLEX` sits after `FLEX` and before `K` on purpose: `assignSlot` takes the first
 * eligible slot in config order, so a running back (eligible for both) fills the narrower
 * `FLEX` first and leaves `SUPERFLEX` open for the position only it accepts.
 */
export const SUPERFLEX_ROSTER_SLOTS: readonly RosterSlotConfig[] = [
  { slot: "QB", count: 1, eligiblePositions: ["QB"] },
  { slot: "RB", count: 2, eligiblePositions: ["RB"] },
  { slot: "WR", count: 2, eligiblePositions: ["WR"] },
  { slot: "TE", count: 1, eligiblePositions: ["TE"] },
  { slot: "FLEX", count: 1, eligiblePositions: ["RB", "WR", "TE"] },
  { slot: "SUPERFLEX", count: 1, eligiblePositions: ["QB", "RB", "WR", "TE"] },
  { slot: "K", count: 1, eligiblePositions: ["K"] },
  { slot: "DEF", count: 1, eligiblePositions: ["DEF"] },
  { slot: BENCH_SLOT, count: 6, eligiblePositions: ["QB", "RB", "WR", "TE", "K", "DEF"] },
];

/** The one lookup from a roster shape's name to its rows, the `SCORING_PRESETS` of roster shapes. */
export const ROSTER_SHAPES: Readonly<Record<RosterShapeName, readonly RosterSlotConfig[]>> = {
  standard: STANDARD_ROSTER_SLOTS,
  superflex: SUPERFLEX_ROSTER_SLOTS,
};

/** Field-by-field, order-sensitive: both shipped shapes are built from a fixed, literal row order. */
function sameRosterSlots(a: readonly RosterSlotConfig[], b: readonly RosterSlotConfig[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Pure. Names a league's roster shape from its slot rows alone, because `leagues.roster_slots`
 * is all that's stored — no shape-name column exists. Mirrors `describeScoring`
 * (`@/scoring/describe`) exactly, and for the identical reason: a commissioner who edits even
 * one slot has a shape neither shipped preset names, and calling it one anyway would be a lie
 * on the one page a stranger reads to decide whether to join.
 */
export function describeRosterShape(slots: readonly RosterSlotConfig[]): string {
  if (slots.some((config) => config.slot === "SUPERFLEX")) return ROSTER_SHAPE_LABEL.superflex;
  if (sameRosterSlots(slots, STANDARD_ROSTER_SLOTS)) return ROSTER_SHAPE_LABEL.standard;
  return "Custom";
}
