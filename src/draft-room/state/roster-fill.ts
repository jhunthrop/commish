import type { RosterSlot, RosterSlotConfig, RosterSlotType } from "@research/domain/roster";

export interface RosterFillRow {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  /** The player occupying this exact spot, or `null` — the spot is open. Never left out of
   *  the list: an unclaimed spot is a fact this row states plainly, not something a reader
   *  infers from its absence. */
  readonly playerId: string | null;
}

/**
 * One row per roster SPOT, in `slotConfig`'s own order (QB, then RB, then … then bench) — the
 * shared grouping `MockResults` (`../components/mock-results`) and `RosterRail`
 * (`../components/roster-rail`) both need, extracted here so the rule lives in exactly one
 * place rather than two copies that could drift (founder directive 2026-08-26, room-product
 * pass).
 *
 * This does no slot ASSIGNMENT of its own — `roster` already carries the engine's own answer to
 * "where did this pick land": `assignSlot` (`@research/draft-engine/slotting`), applied at pick time in
 * `apply-pick.ts`, puts a pick in the first open dedicated slot for its position, else FLEX if
 * eligible, else bench. This function only re-shapes that already-decided roster into one row
 * per configured spot, so a spot nothing has claimed yet reads as `playerId: null` instead of
 * being missing from the list entirely.
 */
export function rosterFillRows(slotConfig: readonly RosterSlotConfig[], roster: readonly RosterSlot[]): readonly RosterFillRow[] {
  const bySpot = new Map(roster.map((spot) => [`${spot.slot}:${spot.slotIndex}`, spot]));
  return slotConfig.flatMap((config) =>
    Array.from({ length: config.count }, (_, slotIndex) => ({
      slot: config.slot,
      slotIndex,
      playerId: bySpot.get(`${config.slot}:${slotIndex}`)?.playerId ?? null,
    })),
  );
}
