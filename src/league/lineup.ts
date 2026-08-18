import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig, type RosterSlotType } from "@/domain/roster";

/**
 * The league's declared roster shape expanded into one entry per spot, filled from whatever
 * the team actually holds. This is the lineup a manager who has never opened the editor
 * gets — the draft's own slot assignment — so nobody ever fields an accidentally empty team.
 */
export function defaultLineup(slotConfig: readonly RosterSlotConfig[], roster: readonly RosterSlot[]): readonly RosterSlot[] {
  const held = new Map(roster.map((slot) => [`${slot.slot}:${slot.slotIndex}`, slot.playerId]));
  return slotConfig.flatMap((config) =>
    Array.from({ length: config.count }, (_, slotIndex) => ({
      slot: config.slot,
      slotIndex,
      playerId: held.get(`${config.slot}:${slotIndex}`) ?? null,
    })),
  );
}

/**
 * Puts a player in a slot. SWAPS rather than duplicates: whoever was in the target slot takes
 * the incoming player's old spot. A lineup holding the same player twice would silently
 * double-count them — `scoreLineup` documents that it assumes no duplicates.
 */
export function setSlotPlayer(
  lineup: readonly RosterSlot[],
  slot: RosterSlotType,
  slotIndex: number,
  playerId: string | null,
): readonly RosterSlot[] {
  const target = lineup.find((entry) => entry.slot === slot && entry.slotIndex === slotIndex);
  if (target === undefined) return lineup;
  const displaced = target.playerId;
  return lineup.map((entry) => {
    if (entry.slot === slot && entry.slotIndex === slotIndex) return { ...entry, playerId };
    if (playerId !== null && entry.playerId === playerId) return { ...entry, playerId: displaced };
    return entry;
  });
}

export function startersOf(lineup: readonly RosterSlot[]): readonly RosterSlot[] {
  return lineup.filter((entry) => entry.slot !== BENCH_SLOT);
}

export function benchOf(lineup: readonly RosterSlot[]): readonly RosterSlot[] {
  return lineup.filter((entry) => entry.slot === BENCH_SLOT);
}
