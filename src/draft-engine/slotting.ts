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
 * The lowest `slotIndex` for `slot` that no entry in `roster` already occupies.
 *
 * NOT `roster.filter((s) => s.slot === slot).length` — that counts occupied entries and calls
 * the count itself the next free index, which is only correct when a slot type's occupants are
 * packed contiguously from `0`. A roster `plannedTransfer` has already CLEARED (removed a
 * specific traded-away player by id, not by index) can leave a gap: two `RB` entries at indices
 * `0` and `1`, one traded away by id, leaves ONE entry sitting at index `1` with index `0` open.
 * `.length` on that one-entry array is `1`, which chooses the ALREADY-OCCUPIED index `1` — and
 * `defaultLineup`'s own `Map` keyed on `"${slot}:${slotIndex}"` (`@/league/lineup`) then holds
 * only the LAST of the two entries written to that one key, silently dropping the other player
 * from the roster it was still legitimately on. Found by `reverseTradeInTx`'s own lock-order
 * proof (Task 7): give away the LOWER-indexed of two same-position players, keep the higher-
 * indexed one, then receive a same-position player back — the exact shape a reversal produces
 * when the trade being undone shares an asset's position with something the roster picked up in
 * between. This bug predates Task 7 and was reachable through `acceptTrade`/`proposeTrade` too;
 * it was never caught because no existing fixture traded away the lower of two same-position
 * roster entries while keeping the higher one.
 */
function lowestFreeIndex(roster: readonly RosterSlot[], slot: RosterSlotType): number {
  const used = new Set(roster.filter((entry) => entry.slot === slot).map((entry) => entry.slotIndex));
  let index = 0;
  while (used.has(index)) index += 1;
  return index;
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
      return { ok: true, slot, slotIndex: lowestFreeIndex(roster, slot) };
    }
  }
  return { ok: false, reason: `Your roster has no open slot for a ${position}.` };
}
