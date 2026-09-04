import type { Position } from "@/domain/player";
import type { RosterSlot, RosterSlotConfig } from "@/domain/roster";

/**
 * THE LENSES — chips in the quilt's header that recolor the grid in place and never move
 * anything (`SheetAndLens` mock, top half). Pure derivations over the room's own facts; the
 * board component decides pigment classes, this module decides the FACTS a lens states.
 */
export const LENSES = ["picks", "needs", "value", "byes"] as const;
export type Lens = (typeof LENSES)[number];

export const LENS_LABEL: Readonly<Record<Lens, string>> = {
  picks: "PICKS",
  needs: "NEEDS",
  value: "VALUE",
  byes: "BYES",
};

/** The positions a needs dot can be — the four a draft is actually planned around. K and DEF
 *  are late-round formalities every team needs until the last rounds; painting twelve K dots
 *  for thirteen rounds would say nothing twelve times (the decoration law 6 rejects). */
const NEED_POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE"];

/**
 * What a team still needs: the dedicated-position slots (QB/RB/WR/TE) its roster has not
 * filled, one entry per open slot, in the slot config's own order. FLEX, bench, K and DEF are
 * deliberately not needs — see `NEED_POSITIONS`.
 */
export function positionNeeds(slotConfig: readonly RosterSlotConfig[], roster: readonly RosterSlot[]): readonly Position[] {
  const filled = new Map<string, number>();
  for (const slot of roster) filled.set(slot.slot, (filled.get(slot.slot) ?? 0) + 1);
  const needs: Position[] = [];
  for (const config of slotConfig) {
    const position = NEED_POSITIONS.find((candidate) => candidate === config.slot);
    if (position === undefined) continue;
    const open = config.count - (filled.get(config.slot) ?? 0);
    for (let index = 0; index < open; index += 1) needs.push(position);
  }
  return needs;
}

/**
 * One position's Sleeper-grammar fraction for the drawer's filter row: "RB 1/2", "QB 1/1 ✓"
 * (WarmQuilt mock, the "stolen honestly" ruling). Same scope as `positionNeeds` — the four
 * dedicated positions a draft is planned around — and derived from the identical roster facts,
 * so the chips and the NEEDS lens can never disagree.
 */
export interface NeedFraction {
  readonly position: Position;
  /** Starting-slot copies filled, capped at `total` — a flex-bound third RB never reads 3/2. */
  readonly filled: number;
  /** The slot config's starting copies for this position. */
  readonly total: number;
  /** True when every starting copy is filled — the chip goes quiet and wears the check. */
  readonly satisfied: boolean;
}

/** Every dedicated STARTING position — the clock strip's needs line speaks all six, because a
 *  late-round K/DEF hole is exactly the decision that line exists for (see
 *  `unfilledStartingPositions`). FLEX and bench are not positions and appear nowhere. */
const STARTING_POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/** The one fraction derivation both scopes share — the chips and the needs line can never
 *  disagree with each other, or with the NEEDS lens, about what a roster has filled. */
function fractionsFor(
  slotConfig: readonly RosterSlotConfig[],
  roster: readonly RosterSlot[],
  positions: readonly Position[],
): readonly NeedFraction[] {
  const filled = new Map<string, number>();
  for (const slot of roster) filled.set(slot.slot, (filled.get(slot.slot) ?? 0) + 1);
  const fractions: NeedFraction[] = [];
  for (const config of slotConfig) {
    const position = positions.find((candidate) => candidate === config.slot);
    if (position === undefined) continue;
    const count = Math.min(filled.get(config.slot) ?? 0, config.count);
    fractions.push({ position, filled: count, total: config.count, satisfied: count >= config.count });
  }
  return fractions;
}

/** The filter row's fractions, in the slot config's own order. */
export function needFractions(slotConfig: readonly RosterSlotConfig[], roster: readonly RosterSlot[]): readonly NeedFraction[] {
  return fractionsFor(slotConfig, roster, NEED_POSITIONS);
}

/**
 * The clock strip's quiet your-turn line (founder ruling 2026-09-03): the dedicated starting
 * positions whose copies are not all filled, once each, in the slot config's own order —
 * "Still need TE · K · DEF". Wider than the NEEDS dots' scope on purpose: the dots paint the
 * whole room for thirteen rounds (where twelve K dots say nothing twelve times), while this
 * line speaks once, to one manager, at the exact moment a K/DEF hole is the decision. Empty
 * when the starting roster is complete — and the line disappears with it.
 */
export function unfilledStartingPositions(slotConfig: readonly RosterSlotConfig[], roster: readonly RosterSlot[]): readonly Position[] {
  return fractionsFor(slotConfig, roster, STARTING_POSITIONS)
    .filter((fraction) => !fraction.satisfied)
    .map((fraction) => fraction.position);
}

/** teamId → its open position needs, for the whole room in one pass. */
export function needsByTeam(
  slotConfig: readonly RosterSlotConfig[],
  rosters: Readonly<Record<string, readonly RosterSlot[]>>,
  teamIds: readonly string[],
): ReadonlyMap<string, readonly Position[]> {
  return new Map(teamIds.map((teamId) => [teamId, positionNeeds(slotConfig, rosters[teamId] ?? [])]));
}

/**
 * The VALUE lens's verdict for one landed pick: where the player sat on the board the draft
 * snapshotted versus the slot he actually went at. Positive slip is a steal (he lasted),
 * negative a reach — the same sign grammar `lib/verdict` states for the pool. Null when the
 * board never ranked him: no comparison, no color (law 7).
 */
export type ValueVerdict = "steal" | "reach" | "even";

export function pickValueVerdict(boardRank: number | undefined, pickNumber: number): ValueVerdict | null {
  if (boardRank === undefined) return null;
  const slip = pickNumber - boardRank;
  if (slip > 0) return "steal";
  if (slip < 0) return "reach";
  return "even";
}
