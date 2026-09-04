/**
 * The one rank-and-need scoring vocabulary, shared by the engine's own autopick
 * (`bestAvailableFor`, `selectors.ts`) and the practice bots' sampler
 * (`src/mock-draft/bots.ts`, which consumes these through the engine barrel — the engine
 * depends on nothing above it, so the shared shape lives HERE and the mock package imports
 * down). Pure functions of their arguments: every tunable is a parameter, never a config
 * read, so the autopick's constants (`AUTOPICK_CONFIG`, `./config`) and the bots' constants
 * (`MOCK_CONFIG.strategy`) can never contaminate each other.
 */
import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";

/** `exp(-index / temperature)`: rank 0 weighs 1, each step down the board decays smoothly. */
export function rankWeight(index: number, temperature: number): number {
  return Math.exp(-index / temperature);
}

/**
 * Open DEDICATED starting slots for a position — the slot type that shares the position's own
 * name (QB/RB/WR/TE/K/DEF), FLEX and bench excluded on purpose: a roster whose RB starters are
 * filled still CAN flex a third RB, it just stops needing one.
 */
export function openStartingSlots(position: Position, roster: readonly RosterSlot[], slotConfig: readonly RosterSlotConfig[]): number {
  const configured = slotConfig.filter((s) => s.slot === position).reduce((sum, s) => sum + s.count, 0);
  const filled = roster.filter((s) => s.slot === position).length;
  return configured - filled;
}

/** The two dials `needMultiplier` turns — the caller owns the values, this module the shape. */
export interface NeedMultiplierOptions {
  /** Additive warmth per open dedicated starting slot. */
  readonly openSlotBoost: number;
  /** The cooled multiplier once every dedicated starter at the position is filled. */
  readonly filledDamp: number;
}

/**
 * The need term: derived from the roster the caller passed in, never stored. Each open
 * starting slot warms the position by `openSlotBoost`; a position with no open starter left
 * cools to `filledDamp` — under 1 for every real caller, so surplus at a position reads as
 * disinterest, not neutrality. With `openSlotBoost: 0, filledDamp: 1` the term is exactly
 * neutral, which is what the autopick's round ramp reduces to on a team's first pick.
 */
export function needMultiplier(
  position: Position,
  roster: readonly RosterSlot[],
  slotConfig: readonly RosterSlotConfig[],
  { openSlotBoost, filledDamp }: NeedMultiplierOptions,
): number {
  const open = openStartingSlots(position, roster, slotConfig);
  if (open === 0) return filledDamp;
  return 1 + openSlotBoost * open;
}
