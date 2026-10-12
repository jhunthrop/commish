/**
 * The one rank-and-need scoring vocabulary, shared by the engine's own autopick
 * (`bestAvailableFor`, `selectors.ts`) and the practice bots' sampler
 * (`src/mock-draft/bots.ts`, which consumes these through the engine barrel — the engine
 * depends on nothing above it, so the shared shape lives HERE and the mock package imports
 * down). Pure functions of their arguments: every tunable is a parameter, never a config
 * read, so the autopick's constants (`AUTOPICK_CONFIG`, `./config`) and the bots' constants
 * (`MOCK_CONFIG.strategy`) can never contaminate each other.
 */
import type { Position } from "@research/domain/player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig } from "@research/domain/roster";
import { LATE_ROUND_ONLY_POSITIONS } from "@research/draft-engine/roster-need";

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
 * exactly at capacity, the candidate the one that tips it over), 2 the next time, and so on.
 * `Math.max(0, …)` keeps this 0 (no surplus discount at all) for a position that still has an
 * open starting slot — `needMultiplier` only ever calls this once `open <= 0`.
 *
 * `rosteredAtPosition` MUST be the team's true count of already-drafted players at this exact
 * position, never `roster.filter((s) => s.slot === position).length` — that counts ROSTER SLOT
 * LABELS, and a surplus body's label is "BENCH" (or "FLEX"), not the position's own name, the
 * instant it goes one over its dedicated slots' capacity. Counting labels therefore pins this
 * at exactly 1 forever once a position is filled (a team's 2nd, 3rd and 4th extra QB would all
 * read as "1 already rostered"), which is the bug the 2026-09-06 review caught: the compounding
 * this function promises could never actually compound. The caller (`bestAvailableFor`,
 * `selectors.ts`) computes the true count from `state.picks` joined to `state.pool`'s own
 * positions — the one place that join is possible — and this module stays pure over whatever
 * number it is handed.
 *
 * Falls back to the label count when the caller omits `rosteredAtPosition` entirely: a
 * defensive default for a hypothetical future caller that supplies `surplusDamp` without the
 * true count, never the path any real caller in this codebase takes today.
 */
function extraSurplusBodies(
  position: Position,
  roster: readonly RosterSlot[],
  slotConfig: readonly RosterSlotConfig[],
  rosteredAtPosition: number | undefined,
): number {
  const configured = configuredDedicatedSlots(position, slotConfig);
  const rostered = rosteredAtPosition ?? roster.filter((s) => s.slot === position).length;
  return Math.max(0, rostered - configured + 1);
}

/** The dials `needMultiplier` turns — the caller owns the values, this module the shape. */
export interface NeedMultiplierOptions {
  /** Additive warmth per open dedicated starting slot. */
  readonly openSlotBoost: number;
  /** The cooled multiplier once every dedicated starter at the position is filled. */
  readonly filledDamp: number;
  /**
   * The 2026-09-05 fix for the QB-stacking incident (prod mock 25642877-0841-49a5-8511-
   * f3655d8064b1), corrected 2026-09-06 after review: once a position is filled, EVERY further
   * body there used to cool to the same flat `filledDamp` regardless of how many are already
   * rostered — a second QB in a 1-QB room scored identically to the position's very first
   * starter going one over. When present, `filledDamp` compounds by `surplusDamp` once per
   * `extraSurplusBodies` (see `rosteredAtPosition` below): `filledDamp × surplusDamp^extraBodies`,
   * so a second body is merely unattractive, a third is cooled again on top of that, and so on —
   * genuinely, not just on paper. OPTIONAL and undefined by default: absent means EXACTLY
   * `filledDamp` with no compounding at all — today's (and every historical snapshot's)
   * behavior, byte for byte. No stored `START_DRAFT` snapshot carries `surplusDamp` yet, so this
   * change touches ONLY the WITH-`surplusDamp` path; replay of every existing log is untouched.
   */
  readonly surplusDamp?: number;
  /**
   * The team's true count of already-drafted players at the candidate's position — see
   * `extraSurplusBodies`'s own docblock for why this cannot be derived from `roster` alone.
   * Only read when `surplusDamp` is also supplied; ignored otherwise.
   */
  readonly rosteredAtPosition?: number;
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
  { openSlotBoost, filledDamp, surplusDamp, rosteredAtPosition }: NeedMultiplierOptions,
): number {
  const open = openStartingSlots(position, roster, slotConfig);
  const warmed = 1 + openSlotBoost * open;
  if (open > 0) return warmed;
  if (surplusDamp === undefined) return open === 0 ? filledDamp : warmed;
  return filledDamp * surplusDamp ** extraSurplusBodies(position, roster, slotConfig, rosteredAtPosition);
}

/**
 * Whether a candidate at `position` should be passed over FOR NOW — see
 * `DraftAutopickPolicy.lateRoundOnlyRoundsFromEnd` (`./config`) for the whole argument and for why
 * this is a preference the caller can override rather than a legality rule.
 *
 * Five ways to be un-deferred, and a candidate needs only one: the policy carries no
 * rounds-from-the-end at all (a pre-policy snapshot, which must replay byte for byte), the position
 * is not one of the two, the league configures no dedicated starting slot for it, the team is inside
 * the final rounds, or every OTHER dedicated starting slot is already filled.
 *
 * THE NO-SLOT CASE IS NOT AN EDGE, IT IS A WHOLE FORMAT. A league that starts no kicker can still
 * ROSTER one, on the bench, because `STANDARD_ROSTER_SLOTS`-style bench slots take every position.
 * There is nothing to save him for in that league, so deferring him would mean an autopick that
 * never takes a kicker at all while a real manager in the same room freely can. Board order decides
 * there, which is what it did before this policy existed.
 *
 * "Rounds left" is the team's own remaining picks — total configured slots minus what it already
 * holds — never the global pick number, so a team redeeming owed picks is measured against its own
 * progress exactly the way `needRamp` (`selectors.ts`) measures it.
 *
 * THE OTHER-SLOT TEST EXCLUDES BOTH LATE-ROUND POSITIONS, and it has to: each of them has an open
 * dedicated slot for the whole draft, so a test that counted them would have K deferring on DEF's
 * open slot and DEF deferring on K's, forever, and the deferral would never lift on that branch at
 * all. BENCH is excluded because a bench spot is open until the very last pick and is not a
 * statement of need. FLEX is INCLUDED, by slot label rather than by position: a team that has not
 * filled its flex still needs a skill player more than it needs a kicker.
 */
export function deferredLateRoundPosition(
  position: Position,
  roster: readonly RosterSlot[],
  slotConfig: readonly RosterSlotConfig[],
  roundsFromEnd: number | undefined,
): boolean {
  if (roundsFromEnd === undefined) return false;
  if (!LATE_ROUND_ONLY_POSITIONS.includes(position)) return false;
  if (configuredDedicatedSlots(position, slotConfig) === 0) return false;
  const totalSlots = slotConfig.reduce((sum, entry) => sum + entry.count, 0);
  if (totalSlots - roster.length <= roundsFromEnd) return false;
  return slotConfig.some(
    (entry) =>
      entry.slot !== BENCH_SLOT &&
      !LATE_ROUND_ONLY_POSITIONS.includes(entry.slot as Position) &&
      roster.filter((filled) => filled.slot === entry.slot).length < entry.count,
  );
}
