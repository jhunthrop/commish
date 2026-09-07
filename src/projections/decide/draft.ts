import type { Position } from "@/domain/player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig, type RosterSlotType } from "@/domain/roster";
import { assignSlot } from "@/draft-engine";
import { bestStartingTotal } from "./slots";
import type { LeagueShape, ValuedPlayer } from "./replacement";
import { survivalProbabilities, type RoomTendency } from "./survival";
import { isRealTierCliff, tierStanding } from "./tiers";

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
 * gone]`, where `value` is MARGINAL - what he adds to the starting lineup this roster can field,
 * not what he is worth in the abstract. `fitFor` argues that distinction in full, and the draft
 * replay is what forced it. The expectation is exact
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

/**
 * A player already on your roster.
 *
 * `valueOverReplacement` is REQUIRED, and it is not decoration. A candidate's marginal value is
 * the improvement he makes to your starting lineup, which cannot be computed without knowing who
 * he would be improving on. This field was optional for exactly one afternoon, defaulting to
 * replacement level, and the draft replay drafted EIGHT TIGHT ENDS a seat: every man already
 * rostered scored zero, so every candidate looked like a starting upgrade and the marginal rule
 * silently collapsed back into the standalone-value rule it was written to replace. An optional
 * field with a plausible default is how a decision layer gets a confidently wrong answer, so this
 * one fails to compile instead.
 */
export interface RosteredPlayer {
  readonly playerId: string;
  readonly position: Position;
  readonly valueOverReplacement: number;
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
  /** What he adds to the starting lineup this roster can field, plus a little insurance. */
  readonly rosterAdjustedValue: number;
  /** Zero at your last pick: nothing survives to a turn you do not have. */
  readonly survivalProbability: number;
  readonly reasons: readonly PickReason[];
}

/** How many names to hand back. A shortlist is a decision aid; a ranked board is homework. */
export const DEFAULT_SHORTLIST = 5;

/**
 * What a man is worth sitting behind somebody: a bye week, an injury, and not much else. Each
 * further body already stacked at that position is worth less again.
 *
 * Chosen rather than fitted, and `scripts/decision-report.ts` is what says whether the choice
 * pays. Anything finer would be false precision.
 */
export const BENCH_INSURANCE_SHARE = 0.08;
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

/**
 * Where a player at this position would land on this roster, or `null` if the roster cannot take
 * him at all. Asked of the engine's own oracle (`assignSlot`), never a second rule written here.
 *
 * Exported because the draft replay needs the identical answer twice over: a replay that let a
 * seat roster nine quarterbacks would be scoring a draft the room would have refused, and its
 * realistic opponent needs to know whether a man would START or merely sit.
 */
export function landingSlot(
  roster: readonly RosteredPlayer[],
  position: Position,
  slotConfig: readonly RosterSlotConfig[],
): RosterSlotType | null {
  const assignment = assignSlot({
    position,
    roster: filledSlots(placeRoster(roster, slotConfig)),
    slotConfig,
  });
  return assignment.ok ? assignment.slot : null;
}

export function canRoster(
  roster: readonly RosteredPlayer[],
  position: Position,
  slotConfig: readonly RosterSlotConfig[],
): boolean {
  return landingSlot(roster, position, slotConfig) !== null;
}

interface RosterFit {
  /** What he adds to the best starting lineup this roster can field, in value over replacement. */
  readonly marginalStartingValue: number;
  /** What he is worth sitting behind somebody: a bye, an injury, and not much else. */
  readonly insurance: number;
  readonly value: number;
  /** Where he would land, or `null` when the roster cannot legally take him at all. */
  readonly slot: RosterSlotType | null;
  readonly alreadyRostered: number;
  readonly alreadyBenched: number;
}

/** Below-replacement men contribute nothing to a lineup; they do not contribute NEGATIVELY to it. */
function surplus(player: RosteredPlayer): number {
  return Math.max(0, player.valueOverReplacement);
}

function startingValue(
  players: readonly RosteredPlayer[],
  slotConfig: readonly RosterSlotConfig[],
): number {
  return bestStartingTotal(players, slotConfig, surplus);
}

/**
 * HOW MUCH OF A PLAYER'S VALUE THIS PARTICULAR ROSTER CAN ACTUALLY USE.
 *
 * The first version of this scored a candidate at his own value over replacement, discounted by a
 * fraction when he could only sit. THE DRAFT REPLAY DESTROYED IT: every seat following the
 * recommendation drafted EIGHT TIGHT ENDS. Tight end has the lowest replacement level of any
 * position, so tight ends carry high value over replacement all the way down the board, and a
 * fixed bench discount was never going to be large enough to stop a strategy that kept finding the
 * best remaining number at one position. The roster it produced was worse than a plain points
 * ranking by about eighty points a season, and no unit test in this directory would ever have
 * caught it: each individual comparison the old rule made was defensible.
 *
 * The honest quantity is MARGINAL. A player is worth what he adds to the starting lineup you can
 * field, which is zero for a fourth tight end however good he is, because the tight end slot and
 * the flex are already held by better tight ends. That single change is what makes a recommendation
 * a roster-building decision rather than a very careful way of reading one column.
 *
 * A bench body is not worthless, so a small insurance share of his surplus remains, decaying with
 * every man already stacked behind that position: the fourth backup at one position cannot start
 * even if the man ahead of him goes down.
 */
function fitFor(
  candidate: RosteredPlayer,
  roster: readonly RosteredPlayer[],
  slotConfig: readonly RosterSlotConfig[],
): RosterFit {
  const alreadyRostered = roster.filter((player) => player.position === candidate.position).length;
  const placements = placeRoster(roster, slotConfig);
  const alreadyBenched = placements.filter(
    (placement) => placement.position === candidate.position && placement.slot === BENCH_SLOT,
  ).length;
  const assignment = assignSlot({
    position: candidate.position,
    roster: filledSlots(placements),
    slotConfig,
  });
  if (!assignment.ok) {
    return { marginalStartingValue: 0, insurance: 0, value: 0, slot: null, alreadyRostered, alreadyBenched };
  }
  const marginalStartingValue =
    startingValue([...roster, candidate], slotConfig) - startingValue(roster, slotConfig);
  const insurance = BENCH_INSURANCE_SHARE * surplus(candidate) * BENCH_DEPTH_DECAY ** alreadyBenched;
  return {
    marginalStartingValue,
    insurance,
    value: marginalStartingValue + insurance,
    slot: assignment.slot,
    alreadyRostered,
    alreadyBenched,
  };
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
  fit: RosterFit,
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

  if (fit.marginalStartingValue > 0 && fit.slot !== null) {
    reasons.push({ code: "fills_starting_slot", slot: fit.slot });
  } else if (fit.slot !== null) {
    // He can be rostered and adds nothing to the lineup: everything he could start in is already
    // held by somebody better. That is saturation, whatever slot he technically lands in.
    reasons.push({
      code: "roster_saturated",
      position: candidate.position,
      alreadyRostered: fit.alreadyRostered,
      alreadyBenched: fit.alreadyBenched,
    });
  }

  const pool = positionPool(board, candidate.position);
  const index = pool.findIndex((entry) => entry.playerId === candidate.playerId);
  const pointsDescending = pool.map((entry) => entry.projectedPoints);
  const standing = tierStanding(pointsDescending, index);
  // TWO CONDITIONS, BOTH REQUIRED (dossier-voice round §3.3). The tier has to be THIN
  // (`TIER_IS_THIN_AT`, unchanged: a cliff nobody is about to reach is not a reason to move) AND
  // the drop has to be a REAL cliff rather than the tail of a span split — `isRealTierCliff`, the
  // same games-worth share the tier rule itself is drawn with.
  if (isRealTierCliff(pointsDescending[index] ?? 0, standing.dropToNextTier) && standing.playersLeftInTier <= TIER_IS_THIN_AT) {
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

  const survival =
    nextPickNumber === null
      ? new Map<string, number>()
      : survivalProbabilities({ board, fromPick: pickNumber, toPick: nextPickNumber, room });

  const rankable = board
    .map((candidate) => ({ candidate, fit: fitFor(candidate, roster, slotConfig) }))
    .filter((entry) => entry.fit.slot !== null)
    .sort(
      (a, b) =>
        b.fit.value - a.fit.value ||
        b.candidate.valueOverReplacement - a.candidate.valueOverReplacement ||
        a.candidate.playerId.localeCompare(b.candidate.playerId),
    );

  // Only the top of the board can win, and each one costs a full re-valuation of what is left.
  const considered = rankable.slice(0, Math.max(shortlistSize * 3, DEFAULT_SHORTLIST * 3));

  const scored = considered.map(({ candidate, fit }) => {
    const survives = survival.get(candidate.playerId) ?? 0;
    let expectedValueAdded = fit.value;
    if (nextPickNumber !== null) {
      const after = [...roster, candidate];
      const survivors = board
        .filter((entry) => entry.playerId !== candidate.playerId)
        .map((entry) => ({
          value: fitFor(entry, after, slotConfig).value,
          survival: survival.get(entry.playerId) ?? 0,
        }));
      expectedValueAdded += expectedBestSurvivor(survivors);
    }
    return {
      playerId: candidate.playerId,
      position: candidate.position,
      expectedValueAdded,
      valueOverReplacement: candidate.valueOverReplacement,
      rosterAdjustedValue: fit.value,
      survivalProbability: survives,
      reasons: reasonsFor(candidate, fit, survives, query, board),
    } satisfies Recommendation;
  });

  return scored
    .sort((a, b) => b.expectedValueAdded - a.expectedValueAdded || a.playerId.localeCompare(b.playerId))
    .slice(0, shortlistSize);
}
