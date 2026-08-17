import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@/domain/roster";
import { eligibleSlotsForPosition, validateRosterAdd } from "@/domain/roster-eligibility";

export type SlotAssignment =
  | { readonly ok: true; readonly slot: RosterSlotType; readonly slotIndex: number }
  | { readonly ok: false; readonly reason: string };

interface AssignSlotInput {
  readonly position: Position;
  /** Filled slots only. */
  readonly roster: readonly RosterSlot[];
  readonly slotConfig: readonly RosterSlotConfig[];
}

/**
 * Where a newly drafted player lands. Roster-construction rules are NOT reimplemented here:
 * eligibility and capacity both come from `src/domain/roster-eligibility.ts`. This function
 * only chooses among the slots that module says are legal — first eligible slot in config
 * order, so starters fill before FLEX and FLEX before BENCH, deterministically.
 */
export function assignSlot({ position, roster, slotConfig }: AssignSlotInput): SlotAssignment {
  const eligible = eligibleSlotsForPosition(position, slotConfig);
  if (eligible.length === 0) {
    return { ok: false, reason: `No roster slot in this league accepts a ${position}.` };
  }
  for (const slot of eligible) {
    const check = validateRosterAdd({ slotConfig, currentRoster: roster, position, targetSlot: slot });
    if (check.valid) {
      const slotIndex = roster.filter((s) => s.slot === slot).length;
      return { ok: true, slot, slotIndex };
    }
  }
  return { ok: false, reason: `Your roster has no open slot for a ${position}.` };
}
