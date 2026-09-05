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

/** Configured dedicated starting slots for a position — see `openStartingSlots` below. */
function configuredDedicatedSlots(position: Position, slotConfig: readonly RosterSlotConfig[]): number {
  return slotConfig.filter((s) => s.slot === position).reduce((sum, s) => sum + s.count, 0);
}

/**
 * Open DEDICATED starting slots for a position — the slot type that shares the position's own
 * name (QB/RB/WR/TE/K/DEF), FLEX and bench excluded on purpose: a roster whose RB starters are
 * filled still CAN flex a third RB, it just stops needing one.
 */
export function openStartingSlots(position: Position, roster: readonly RosterSlot[], slotConfig: readonly RosterSlotConfig[]): number {
  const filled = roster.filter((s) => s.slot === position).length;
  return configuredDedicatedSlots(position, slotConfig) - filled;
}

/**
 * How many bodies beyond capacity a NEW candidate at `position` would make, counting the
 * candidate itself: 1 the first time a filled position is asked for one more (dedicated slots
 * exactly at capacity — the instant `openStartingSlots` reaches 0, `rosteredAtPosition` already
 * equals `configuredDedicatedSlots`, and the candidate is what tips it over), 2 the next time,
 * and so on. `Math.max(0, …)` keeps this 0 (no surplus discount at all) for a position that
 * still has an open starting slot — `needMultiplier` only ever calls this once `open <= 0`.
 */
function extraSurplusBodies(position: Position, roster: readonly RosterSlot[], slotConfig: readonly RosterSlotConfig[]): number {
  const configured = configuredDedicatedSlots(position, slotConfig);
  const rosteredAtPosition = roster.filter((s) => s.slot === position).length;
  return Math.max(0, rosteredAtPosition - configured + 1);
}

/** The dials `needMultiplier` turns — the caller owns the values, this module the shape. */
export interface NeedMultiplierOptions {
  /** Additive warmth per open dedicated starting slot. */
  readonly openSlotBoost: number;
  /** The cooled multiplier once every dedicated starter at the position is filled. */
  readonly filledDamp: number;
  /**
   * The 2026-09-05 fix for the QB-stacking incident (prod mock 25642877-0841-49a5-8511-
   * f3655d8064b1): once a position is filled, EVERY further body there used to cool to the same
   * flat `filledDamp` regardless of how many are already rostered — a second QB in a 1-QB room
   * scored identically to the position's very first starter going one over. When present,
   * `filledDamp` compounds by `surplusDamp` once per `extraSurplusBodies` above:
   * `filledDamp × surplusDamp^extraBodies`, so a second body is merely unattractive and a third
   * is cooled again on top of that. OPTIONAL and undefined by default: absent means EXACTLY
   * `filledDamp` with no compounding at all — today's behavior, byte for byte (the replay-
   * determinism law every dial in this module already follows).
   */
  readonly surplusDamp?: number;
}

/**
 * The need term: derived from the roster the caller passed in, never stored. Each open
 * starting slot warms the position by `openSlotBoost`; a position with no open starter left
 * cools to `filledDamp` — under 1 for every real caller, so surplus at a position reads as
 * disinterest, not neutrality — and, when the caller supplies `surplusDamp`, compounds further
 * per extra body already rostered there (see `NeedMultiplierOptions.surplusDamp`). With
 * `openSlotBoost: 0, filledDamp: 1` the term is exactly neutral, which is what the autopick's
 * round ramp reduces to on a team's first pick.
 */
export function needMultiplier(
  position: Position,
  roster: readonly RosterSlot[],
  slotConfig: readonly RosterSlotConfig[],
  { openSlotBoost, filledDamp, surplusDamp }: NeedMultiplierOptions,
): number {
  const open = openStartingSlots(position, roster, slotConfig);
  if (open > 0) return 1 + openSlotBoost * open;
  if (surplusDamp === undefined) return open === 0 ? filledDamp : 1 + openSlotBoost * open;
  return filledDamp * surplusDamp ** extraSurplusBodies(position, roster, slotConfig);
}
