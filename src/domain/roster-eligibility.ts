import type { Position } from "./player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig, type RosterSlotType } from "./roster";

export type ValidationResult = { readonly valid: true } | { readonly valid: false; readonly reason: string };

export function eligibleSlotsForPosition(
  position: Position,
  slotConfig: readonly RosterSlotConfig[],
): readonly RosterSlotType[] {
  return slotConfig
    .filter((config) => config.eligiblePositions.includes(position))
    .map((config) => config.slot);
}

interface ValidateRosterAddInput {
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly currentRoster: readonly RosterSlot[];
  readonly position: Position;
  readonly targetSlot: RosterSlotType;
}

export function validateRosterAdd(input: ValidateRosterAddInput): ValidationResult {
  const config = input.slotConfig.find((c) => c.slot === input.targetSlot);
  if (config === undefined) {
    return { valid: false, reason: `The ${input.targetSlot} slot does not exist in this league.` };
  }
  if (!config.eligiblePositions.includes(input.position)) {
    return { valid: false, reason: `${input.position} is not eligible for the ${input.targetSlot} slot.` };
  }
  const filledCount = input.currentRoster.filter(
    (s) => s.slot === input.targetSlot && s.playerId !== null,
  ).length;
  if (filledCount >= config.count) {
    return {
      valid: false,
      reason: `The ${input.targetSlot} slot is full (${filledCount}/${config.count} filled).`,
    };
  }
  return { valid: true };
}

function openCount(config: RosterSlotConfig, roster: readonly RosterSlot[]): number {
  return config.count - roster.filter((spot) => spot.slot === config.slot && spot.playerId !== null).length;
}

/**
 * THE POSITIONS A ROSTER CAN STILL TAKE, once they are fewer than the positions the league
 * rosters at all: the eligible positions of every open non-bench slot, in slot-config order, each
 * named once. `null` while a bench spot is open, or while every position the league rosters
 * anywhere still fits (a bench-less league on its first pick owes nothing in particular), because
 * then there is no restriction to state; an empty list for a full roster. The engine's refusal,
 * the advisor's card, the clock's notice and the dock all read this one rule (`mustPickLine`,
 * `./must-pick`).
 */
export function restrictedPositions(slotConfig: readonly RosterSlotConfig[], roster: readonly RosterSlot[]): readonly Position[] | null {
  if (slotConfig.some((config) => config.slot === BENCH_SLOT && openCount(config, roster) > 0)) return null;
  const openStarters = slotConfig.filter((config) => config.slot !== BENCH_SLOT && openCount(config, roster) > 0);
  // A Set keeps first-seen order, so the list reads in slot-config order with each position once.
  const open = [...new Set(openStarters.flatMap((config) => config.eligiblePositions))];
  const rostered = new Set(slotConfig.flatMap((config) => config.eligiblePositions));
  return open.length === rostered.size ? null : open;
}

interface ValidateLineupInput {
  readonly slotConfig: readonly RosterSlotConfig[];
  readonly roster: readonly RosterSlot[];
  readonly playerPositions: Readonly<Record<string, string>>;
}

export function validateLineup(input: ValidateLineupInput): ValidationResult {
  for (const slot of input.roster) {
    const config = input.slotConfig.find((c) => c.slot === slot.slot);
    if (config === undefined) {
      return { valid: false, reason: `The ${slot.slot} slot does not exist in this league.` };
    }
    if (slot.playerId === null) {
      return { valid: false, reason: `The ${slot.slot} slot is empty.` };
    }
    const position = input.playerPositions[slot.playerId];
    if (position === undefined || !config.eligiblePositions.includes(position as Position)) {
      return { valid: false, reason: `${position ?? "This player"} is not eligible for the ${slot.slot} slot.` };
    }
  }
  return { valid: true };
}
