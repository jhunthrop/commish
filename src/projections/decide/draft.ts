import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig, type RosterSlotType } from "@/domain/roster";
import { assignSlot } from "@/draft-engine";
import type { LeagueShape, ValuedPlayer } from "./replacement";
import { survivalProbabilities, type RoomTendency } from "./survival";
import { tierStanding } from "./tiers";

/**
 * THE RECOMMENDATION. Not "highest value over replacement" - that is still a list.
 *
 * The quantity a manager actually wants maximised is the value of the roster he ends up with,
 * and three things move it at every turn:
 *
 *   1. what this player is worth (value over replacement),
 *   2. what will still be there if he waits (survival),
 *   3. what his roster still needs (a fourth receiver is worth less than a first tight end when
 *      only one of each starts).
 *
 * So the score is an expected value over a two-turn horizon: take him now, and then take the best
 * man who survives to your next pick. Written out, `EV(c) = value(c) + E[best survivor after c is
 * gone]`, where `value` is already discounted by what the roster needs. The expectation is exact
 * rather than sampled - sort the remaining board by value, and the best survivor is the first man
 * who lasts - which is O(n) and, more importantly, is an argument a manager can follow. A Monte
 * Carlo that produced a slightly better answer nobody could check would be the wrong trade: an
 * explanation a manager cannot follow is worth less than a simpler recommendation he can act on.
 *
 * WHY TWO TURNS AND NOT THE WHOLE DRAFT. The third turn is fourteen picks of compounding guesswork
 * past the second, and every additional turn multiplies the survival model's error rather than
 * adding information. Two turns is where the actual decision lives: take him, or take somebody
 * else and hope he falls.
 *
 * EVERY RECOMMENDATION CARRIES ITS REASON, AS DATA. An assistant that says "take Achane" and
 * cannot say why is worse than one that says nothing. The reasons here are a closed union of
 * codes and numbers; the room renders them into words. Prose generated at this layer would be
 * prose nobody could test, in a product where entry fees ride on the output.
 *
 * NOTHING HERE RE-PREDICTS, and nothing here may see a pick that has not happened: the board
 * passed in is the board at `pickNumber`, and that is the whole of what this function knows.
 */

/** A board entry: what he is worth to us, and what the market says he costs. */
export interface DraftCandidate extends ValuedPlayer {
  readonly averageDraftPosition: number;
}

/** A player already on your roster. Position, because a roster slot alone cannot tell you. */
export interface RosteredPlayer {
  readonly playerId: string;
  readonly position: Position;
}

export interface RecommendationQuery {
  /** Every undrafted player, valued through `valueBoard`. */
  readonly board: readonly DraftCandidate[];
  /** Your roster, in the order you drafted it. */
  readonly roster: readonly RosteredPlayer[];
  readonly shape: LeagueShape;
  readonly pickNumber: number;
  /** Your next turn, or null at your last pick of the draft. */
  readonly nextPickNumber: number | null;
  readonly room?: RoomTendency;
  readonly shortlistSize?: number;
}

export type PickReason =
  | { readonly code: "value_over_replacement"; readonly valueOverReplacement: number; readonly position: Position; readonly positionRank: number }
  | { readonly code: "will_not_survive"; readonly survivalProbability: number; readonly nextPick: number }
  | { readonly code: "safe_to_wait"; readonly survivalProbability: number; readonly nextPick: number }
  | { readonly code: "no_further_turn"; readonly pickNumber: number }
  | { readonly code: "tier_cliff"; readonly position: Position; readonly dropToNextTier: number; readonly playersLeftInTier: number }
  | { readonly code: "fills_starting_slot"; readonly slot: RosterSlotType }
  | { readonly code: "roster_saturated"; readonly position: Position; readonly alreadyRostered: number; readonly alreadyBenched: number };

export interface Recommendation {
  readonly playerId: string;
  readonly position: Position;
  /** The score the shortlist is ordered by: value now plus the best man expected to survive. */
  readonly expectedValueAdded: number;
  readonly valueOverReplacement: number;
  /** Value over replacement after the roster's own needs are priced in. */
  readonly rosterAdjustedValue: number;
  /** Zero at your last pick: nothing survives to a turn you do not have. */
  readonly survivalProbability: number;
  readonly reasons: readonly PickReason[];
}

/** How many names to hand back. A shortlist is a decision aid; a ranked board is homework. */
export const DEFAULT_SHORTLIST = 5;

/**
 * What a bench player is worth against a starter of identical value: he plays on a bye, on an
 * injury, and not otherwise. Each further body at the same position is worth less again.
 *
 * Chosen rather than fitted, and the draft replay in `scripts/decision-report.ts` is what says
 * whether the choice pays. Anything finer would be false precision.
 */
export const BENCH_VALUE_SHARE = 0.4;
export const BENCH_DEPTH_DECAY = 0.7;

/** Below this he is going, above it he will keep. Thresholds for the reason, never for the score. */
export const WILL_NOT_SURVIVE_BELOW = 0.35;
export const SAFE_TO_WAIT_ABOVE = 0.8;

/** A tier this thin is one run away from being gone, which is when a cliff is worth naming. */
export const TIER_IS_THIN_AT = 3;

interface Placement {
  readonly slot: RosterSlotType;
  readonly position: Position;
}

/**
 * Where the roster's players actually sit, by replaying the draft's own slot assignment over
 * them in the order they were taken.
 *
 * `assignSlot` (`@/draft-engine`) is the oracle rather than a second rule written here: it is the
 * same function the live draft, the autopick and the mock bots ask, so a recommendation can never
 * suggest a man the room would then refuse to place.
 */
function placeRoster(
  roster: readonly RosteredPlayer[],
  slotConfig: readonly RosterSlotConfig[],
): readonly Placement[] {
  const filled: RosterSlot[] = [];
  const placements: Placement[] = [];
  for (const player of roster) {
    const assignment = assignSlot({ position: player.position, roster: filled, slotConfig });
    if (!assignment.ok) continue;
    filled.push({ slot: assignment.slot, slotIndex: assignment.slotIndex, playerId: player.playerId });
    placements.push({ slot: assignment.slot, position: player.position });
  }
  return placements;
}

function filledSlots(placements: readonly Placement[]): readonly RosterSlot[] {
  const used = new Map<RosterSlotType, number>();
  return placements.map((placement) => {
    const index = used.get(placement.slot) ?? 0;
    used.set(placement.slot, index + 1);
    return { slot: placement.slot, slotIndex: index, playerId: `placed-${placement.slot}-${index}` };
  });
}

interface NeedVerdict {
  readonly weight: number;
  readonly slot: RosterSlotType | null;
  readonly alreadyRostered: number;
  readonly alreadyBenched: number;
}

/**
 * How much of a player's value this particular roster can actually use.
 *
 * A man who fills an empty starting slot is worth all of it. A man who can only sit is worth a
 * share of it, falling again for every body already stacked behind that position. A man the
 * roster cannot legally take is worth nothing and never reaches the shortlist.
 *
 * NEGATIVE VALUE IS NEVER DISCOUNTED. Multiplying a below-replacement player's value by a
 * fraction would make him LESS negative and float him up the board, which is the opposite of
 * what saturation means.
 */
function needFor(
  position: Position,
  placements: readonly Placement[],
  slotConfig: readonly RosterSlotConfig[],
): NeedVerdict {
  const alreadyRostered = placements.filter((p) => p.position === position).length;
  const alreadyBenched = placements.filter((p) => p.position === position && p.slot === BENCH_SLOT).length;
  const assignment = assignSlot({ position, roster: filledSlots(placements), slotConfig });
  if (!assignment.ok) return { weight: 0, slot: null, alreadyRostered, alreadyBenched };
  if (assignment.slot !== BENCH_SLOT) {
    return { weight: 1, slot: assignment.slot, alreadyRostered, alreadyBenched };
  }
  return {
    weight: BENCH_VALUE_SHARE * BENCH_DEPTH_DECAY ** alreadyBenched,
    slot: BENCH_SLOT,
    alreadyRostered,
    alreadyBenched,
  };
}

function adjust(valueOverReplacement: number, weight: number): number {
  return valueOverReplacement >= 0 ? valueOverReplacement * weight : valueOverReplacement;
}

/**
 * The value of the best man still on the board when your next turn comes around.
 *
 * Exact, not sampled: walk the board best-first, and the answer is the first man who survives.
 * `P(he is the best survivor) = P(he survives) x P(nobody better survives)`, and the running
 * product telescopes, so the tail collapses to nothing within a few entries. Survivals are
 * treated as independent, which slightly overstates the chance that a whole tier falls; the
 * dependence between them is a smaller error than the survival model's own.
 */
function expectedBestSurvivor(
  candidates: readonly { readonly value: number; readonly survival: number }[],
): number {
  let expected = 0;
  let nobodyBetterSurvived = 1;
  for (const { value, survival } of [...candidates].sort((a, b) => b.value - a.value)) {
    if (nobodyBetterSurvived < 1e-9) break;
    expected += value * survival * nobodyBetterSurvived;
    nobodyBetterSurvived *= 1 - survival;
  }
  return expected;
}

/** Most decisive first, so a surface that shows only one reason shows the one that decided it. */
const REASON_PRIORITY: readonly PickReason["code"][] = [
  "will_not_survive",
  "tier_cliff",
  "roster_saturated",
  "fills_starting_slot",
  "value_over_replacement",
  "safe_to_wait",
  "no_further_turn",
];

function orderReasons(reasons: readonly PickReason[]): readonly PickReason[] {
  return [...reasons].sort(
    (a, b) => REASON_PRIORITY.indexOf(a.code) - REASON_PRIORITY.indexOf(b.code),
  );
}

/** The position's own board, best first, which is the population a tier is measured against. */
function positionPool(board: readonly DraftCandidate[], position: Position): readonly DraftCandidate[] {
  return board
    .filter((entry) => entry.position === position)
    .sort((a, b) => b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId));
}

function reasonsFor(
  candidate: DraftCandidate,
  need: NeedVerdict,
  survival: number,
  query: RecommendationQuery,
  board: readonly DraftCandidate[],
): readonly PickReason[] {
  const reasons: PickReason[] = [
    {
      code: "value_over_replacement",
      valueOverReplacement: candidate.valueOverReplacement,
      position: candidate.position,
      positionRank: candidate.positionRank,
    },
  ];

  if (query.nextPickNumber === null) {
    reasons.push({ code: "no_further_turn", pickNumber: query.pickNumber });
  } else if (survival < WILL_NOT_SURVIVE_BELOW) {
    reasons.push({ code: "will_not_survive", survivalProbability: survival, nextPick: query.nextPickNumber });
  } else if (survival > SAFE_TO_WAIT_ABOVE) {
    reasons.push({ code: "safe_to_wait", survivalProbability: survival, nextPick: query.nextPickNumber });
  }

  if (need.slot !== null && need.slot !== BENCH_SLOT) {
    reasons.push({ code: "fills_starting_slot", slot: need.slot });
  } else if (need.slot === BENCH_SLOT) {
    reasons.push({
      code: "roster_saturated",
      position: candidate.position,
      alreadyRostered: need.alreadyRostered,
      alreadyBenched: need.alreadyBenched,
    });
  }

  const pool = positionPool(board, candidate.position);
  const index = pool.findIndex((entry) => entry.playerId === candidate.playerId);
  const standing = tierStanding(
    pool.map((entry) => entry.valueOverReplacement),
    index,
  );
  if (standing.dropToNextTier > 0 && standing.playersLeftInTier <= TIER_IS_THIN_AT) {
    reasons.push({
      code: "tier_cliff",
      position: candidate.position,
      dropToNextTier: standing.dropToNextTier,
      playersLeftInTier: standing.playersLeftInTier,
    });
  }

  return orderReasons(reasons);
}

/**
 * A ranked shortlist for one turn, each entry carrying the reason it is there.
 *
 * Deterministic: the same query answers the same twice, which is what lets a room show a manager
 * why he was told something after the fact.
 */
export function recommendPick(query: RecommendationQuery): readonly Recommendation[] {
  const { board, roster, shape, pickNumber, nextPickNumber, room, shortlistSize = DEFAULT_SHORTLIST } = query;
  if (!Number.isInteger(pickNumber) || pickNumber < 1) {
    throw new Error(`A recommendation is made at a whole pick number; got ${pickNumber}.`);
  }
  const slotConfig = shape.rosterSlots;
  const placements = placeRoster(roster, slotConfig);

  const survival =
    nextPickNumber === null
      ? new Map<string, number>()
      : survivalProbabilities({ board, fromPick: pickNumber, toPick: nextPickNumber, room });

  const rankable = board
    .map((candidate) => ({ candidate, need: needFor(candidate.position, placements, slotConfig) }))
    .filter((entry) => entry.need.weight > 0)
    .map((entry) => ({ ...entry, value: adjust(entry.candidate.valueOverReplacement, entry.need.weight) }))
    .sort((a, b) => b.value - a.value || a.candidate.playerId.localeCompare(b.candidate.playerId));

  // Only the top of the board can win, and each one costs a full re-valuation of what is left.
  const considered = rankable.slice(0, Math.max(shortlistSize * 3, DEFAULT_SHORTLIST * 3));

  const scored = considered.map(({ candidate, need, value }) => {
    const survives = survival.get(candidate.playerId) ?? 0;
    let expectedValueAdded = value;
    if (nextPickNumber !== null) {
      const after = [...placements, { slot: need.slot ?? BENCH_SLOT, position: candidate.position }];
      const survivors = board
        .filter((entry) => entry.playerId !== candidate.playerId)
        .map((entry) => ({
          value: adjust(entry.valueOverReplacement, needFor(entry.position, after, slotConfig).weight),
          survival: survival.get(entry.playerId) ?? 0,
        }));
      expectedValueAdded += expectedBestSurvivor(survivors);
    }
    return {
      playerId: candidate.playerId,
      position: candidate.position,
      expectedValueAdded,
      valueOverReplacement: candidate.valueOverReplacement,
      rosterAdjustedValue: value,
      survivalProbability: survives,
      reasons: reasonsFor(candidate, need, survives, query, board),
    } satisfies Recommendation;
  });

  return scored
    .sort((a, b) => b.expectedValueAdded - a.expectedValueAdded || a.playerId.localeCompare(b.playerId))
    .slice(0, shortlistSize);
}
