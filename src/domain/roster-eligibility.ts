import type { Position } from "./player";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "./roster";

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
