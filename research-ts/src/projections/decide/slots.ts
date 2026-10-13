import type { Position } from "@research-ts/domain/player";
import { BENCH_SLOT, type RosterSlotConfig, type RosterSlotType } from "@research-ts/domain/roster";

/**
 * FILLING A STARTING LINEUP BEST-FIRST, in the one place that knows how.
 *
 * Two callers need it and they must not disagree: `lineup.ts` chooses this week's starters, and
 * `replay.ts` works out the best lineup a roster COULD have started in hindsight, which is the
 * bar decision regret is measured against. A regret number computed by a second, subtly different
 * assignment would be measuring the two assignments against each other rather than measuring the
 * decision.
 *
 * NARROWEST ELIGIBILITY FIRST, and that is not a heuristic. This product's eligibility sets are
 * laminar - QB sits inside SUPERFLEX; RB, WR and TE each sit inside FLEX which sits inside
 * SUPERFLEX - and for a laminar family, filling the most restrictive place first with the best
 * man it can take is provably the best whole lineup. Widest first is not: it puts your best back
 * in the flex and leaves your worst in the back slot.
 */

export interface StartingSpot {
  readonly slot: RosterSlotType;
  readonly slotIndex: number;
  readonly eligiblePositions: readonly Position[];
}

/** Anything that can be put in a slot: an id and the position the rules key off. */
export interface Slottable {
  readonly playerId: string;
  readonly position: Position;
}

/** One place per configured starting spot, ordered narrowest first. Bench spots are not starting spots. */
export function startingSpots(rosterSlots: readonly RosterSlotConfig[]): readonly StartingSpot[] {
  return rosterSlots
    .filter((config) => config.slot !== BENCH_SLOT)
    .flatMap((config) =>
      Array.from({ length: config.count }, (_, slotIndex) => ({
        slot: config.slot,
        slotIndex,
        eligiblePositions: config.eligiblePositions,
      })),
    )
    .sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length);
}

export function spotKey(spot: StartingSpot): string {
  return `${spot.slot}:${spot.slotIndex}`;
}

export function eligibleFor<T extends Slottable>(
  spot: StartingSpot,
  players: readonly T[],
  taken: ReadonlySet<string>,
): readonly T[] {
  return players.filter(
    (player) => !taken.has(player.playerId) && spot.eligiblePositions.includes(player.position),
  );
}

/**
 * The best starting lineup under `score`, as a map from spot to the man in it (or `null` where
 * nobody eligible is left). Ties break on player id so the same roster answers the same twice.
 */
export function assignStarters<T extends Slottable>(
  spots: readonly StartingSpot[],
  players: readonly T[],
  score: (player: T) => number,
): ReadonlyMap<string, T | null> {
  const taken = new Set<string>();
  const filled = new Map<string, T | null>();
  for (const spot of spots) {
    const best =
      [...eligibleFor(spot, players, taken)].sort(
        (a, b) => score(b) - score(a) || a.playerId.localeCompare(b.playerId),
      )[0] ?? null;
    if (best !== null) taken.add(best.playerId);
    filled.set(spotKey(spot), best);
  }
  return filled;
}

/**
 * What a roster's best possible starting lineup was worth. Handed ACTUAL points, this is the
 * hindsight bar; handed projections, it is the lineup a manager would field.
 */
export function bestStartingTotal<T extends Slottable>(
  players: readonly T[],
  rosterSlots: readonly RosterSlotConfig[],
  score: (player: T) => number,
): number {
  const filled = assignStarters(startingSpots(rosterSlots), players, score);
  return [...filled.values()].reduce((sum, player) => sum + (player === null ? 0 : score(player)), 0);
}
