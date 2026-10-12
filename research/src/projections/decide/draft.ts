import type { Position } from "@research/domain/player";
import { BENCH_SLOT, type RosterSlot, type RosterSlotConfig, type RosterSlotType } from "@research/domain/roster";
import { AUTOPICK_CONFIG } from "@research/draft-engine/autopick-policy";
import { anyStarterOpen, positionCeiling, type RosterCeilingPolicy } from "@research/draft-engine/roster-need";
import { assignSlot } from "@research/draft-engine/slotting";
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
  /**
   * The roster-need ceilings (`positionCeiling`, `@/draft-engine`): a candidate who would push
   * his position past its ceiling is never recommended, and a backup at a position no flex takes
   * waits until every starter is filled. Defaults to the engine's own current rule
   * (`AUTOPICK_CONFIG.rosterCeilings`): advice follows today's rule, whatever snapshot the room
   * was started under, because advice is not a replay of the room's own picks.
   */
  readonly ceilings?: RosterCeilingPolicy;
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
 * What a man is worth sitting behind somebody: a bye week, an injury, and not much else. The
 * share is applied to what he would ADD if the best man at his position were out (`coverValue`),
 * so a body who could not start even then is worth nothing sitting.
 *
 * Chosen rather than fitted, and `scripts/decision-report.ts` is what says whether the choice
 * pays. Anything finer would be false precision.
 */
export const BENCH_INSURANCE_SHARE = 0.08;

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

/** The roster as the slots it fills, in draft order: what the roster-eligibility rules
 *  (`restrictedPositions`) read. */
export function rosterSlotsOf(roster: readonly RosteredPlayer[], slotConfig: readonly RosterSlotConfig[]): readonly RosterSlot[] {
  return filledSlots(placeRoster(roster, slotConfig));
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
  /** Where he would land, or `null` when the roster cannot legally take him, or may not under
   *  its position ceiling. */
  readonly slot: RosterSlotType | null;
  /** A backup at a position no flex takes, asked for while a starter is still open: he waits. */
  readonly waitsForStarters: boolean;
  readonly alreadyRostered: number;
  readonly alreadyBenched: number;
}

const UNPLACEABLE = { marginalStartingValue: 0, insurance: 0, value: 0, slot: null, waitsForStarters: false } as const;

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
 * A bench body is not worthless, so a small insurance share remains, of what he would add with
 * the best man at his position OUT (`coverValue`): a second backup who still could not start
 * insures nothing, which is what the 2026-09-12 measurement found the old flat share getting
 * wrong (an advisor-led seat ended with 3.5 tight ends and 2.9 quarterbacks in the founder's own
 * mock rooms, every one of them "insurance" over a bench back worth nothing at replacement).
 *
 * THE CEILINGS (`positionCeiling`, `@/draft-engine`, the same rule the autopick keeps): a man who
 * would push his position past its ceiling is unplaceable here, exactly as if no slot took him.
 */
function fitFor(
  candidate: RosteredPlayer,
  roster: readonly RosteredPlayer[],
  slotConfig: readonly RosterSlotConfig[],
  ceilings: RosterCeilingPolicy,
): RosterFit {
  const alreadyRostered = roster.filter((player) => player.position === candidate.position).length;
  const placements = placeRoster(roster, slotConfig);
  const alreadyBenched = placements.filter(
    (placement) => placement.position === candidate.position && placement.slot === BENCH_SLOT,
  ).length;
  if (alreadyRostered + 1 > ceilingFor(candidate.position, slotConfig, ceilings)) {
    return { ...UNPLACEABLE, alreadyRostered, alreadyBenched };
  }
  const filled = filledSlots(placements);
  const assignment = assignSlot({ position: candidate.position, roster: filled, slotConfig });
  if (!assignment.ok) return { ...UNPLACEABLE, alreadyRostered, alreadyBenched };
  const marginalStartingValue =
    startingValue([...roster, candidate], slotConfig) - startingValue(roster, slotConfig);
  const sits = assignment.slot === BENCH_SLOT;
  // A man who would start insures at his own surplus, as the flat share always read him: with
  // the best man at his position out he starts all the same, so the marginal cover below would
  // only re-solve the lineup twice to reach the number he already carries. The cover is for the
  // bench body, where it is the whole question.
  const insurance = BENCH_INSURANCE_SHARE * (sits ? coverValue(candidate, roster, slotConfig) : surplus(candidate));
  return {
    marginalStartingValue,
    insurance,
    value: marginalStartingValue + insurance,
    slot: assignment.slot,
    // Depth after the lineup, at every position: the same sentence `candidateRoleReader` keeps.
    waitsForStarters: sits && anyStarterOpen(filled, slotConfig),
    alreadyRostered,
    alreadyBenched,
  };
}

/**
 * What the candidate adds to the lineup when the best man already rostered at his position is
 * out: the bye or the injury a bench body exists for. With nobody at his position to cover, his
 * own surplus, as the flat share always read it.
 */
function coverValue(candidate: RosteredPlayer, roster: readonly RosteredPlayer[], slotConfig: readonly RosterSlotConfig[]): number {
  const atPosition = roster.filter((player) => player.position === candidate.position);
  if (atPosition.length === 0) return surplus(candidate);
  const best = atPosition.reduce((top, player) => (player.valueOverReplacement > top.valueOverReplacement ? player : top));
  const without = roster.filter((player) => player !== best);
  return startingValue([...without, candidate], slotConfig) - startingValueWithout(roster, best, slotConfig);
}

/**
 * `startingValue(roster minus one man)`, remembered per roster array and man (the immutability
 * rule's sanctioned memo: a WeakMap keyed by an object that never changes). One recommendation
 * asks this for every bench candidate at a position, and the answer depends on the roster and
 * the man taken out, never on the candidate.
 */
const startingValueWithoutByRoster = new WeakMap<readonly RosteredPlayer[], Map<string, number>>();

function startingValueWithout(roster: readonly RosteredPlayer[], removed: RosteredPlayer, slotConfig: readonly RosterSlotConfig[]): number {
  const held = startingValueWithoutByRoster.get(roster) ?? new Map<string, number>();
  startingValueWithoutByRoster.set(roster, held);
  const known = held.get(removed.playerId);
  if (known !== undefined) return known;
  const value = startingValue(roster.filter((player) => player !== removed), slotConfig);
  held.set(removed.playerId, value);
  return value;
}

/** `positionCeiling` per slot config and policy, remembered the same way: the rule reads only those two. */
const ceilingsBySlotConfig = new WeakMap<readonly RosterSlotConfig[], WeakMap<RosterCeilingPolicy, Map<Position, number>>>();

function ceilingFor(position: Position, slotConfig: readonly RosterSlotConfig[], policy: RosterCeilingPolicy): number {
  const byPolicy = ceilingsBySlotConfig.get(slotConfig) ?? new WeakMap<RosterCeilingPolicy, Map<Position, number>>();
  ceilingsBySlotConfig.set(slotConfig, byPolicy);
  const byPosition = byPolicy.get(policy) ?? new Map<Position, number>();
  byPolicy.set(policy, byPosition);
  const known = byPosition.get(position);
  if (known !== undefined) return known;
  const ceiling = positionCeiling(position, slotConfig, policy);
  byPosition.set(position, ceiling);
  return ceiling;
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
  const prepared = prepareRecommendation(query);
  return finishRecommendation(prepared, prepared.considered.map((entry) => scoreCandidate(prepared, entry)));
}

export interface ChunkedRecommendationOptions {
  /** Candidates scored before the event loop gets a turn. */
  readonly chunkCandidates: number;
  /** Test seam over the yield itself. Defaults to one macrotask (`setImmediate`). */
  readonly yieldToEventLoop?: () => Promise<void>;
}

const nextMacrotask = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * THE SAME SHORTLIST, IN CHUNKS (draft-room performance round): each considered candidate costs
 * a re-valuation of the whole board (about 3 ms on the real one), and thirty of them held in
 * one synchronous stretch block every timer on the invocation that computes them. The scoring is
 * one candidate at a time and shares nothing between candidates, so scoring them a chunk at a
 * time and yielding one macrotask between chunks changes no number: `draft.test.ts` pins the two
 * entry points equal for the same query.
 */
export async function recommendPickInChunks(query: RecommendationQuery, options: ChunkedRecommendationOptions): Promise<readonly Recommendation[]> {
  const prepared = prepareRecommendation(query);
  const yieldToEventLoop = options.yieldToEventLoop ?? nextMacrotask;
  const chunk = Math.max(1, options.chunkCandidates);
  const scored: ScoredCandidate[] = [];
  for (let index = 0; index < prepared.considered.length; index += 1) {
    if (index > 0 && index % chunk === 0) await yieldToEventLoop();
    scored.push(scoreCandidate(prepared, prepared.considered[index]!));
  }
  return finishRecommendation(prepared, scored);
}

interface ConsideredCandidate {
  readonly candidate: DraftCandidate;
  readonly fit: ReturnType<typeof fitFor>;
}

interface PreparedRecommendation {
  readonly query: RecommendationQuery;
  readonly board: readonly DraftCandidate[];
  readonly roster: RecommendationQuery["roster"];
  readonly slotConfig: RecommendationQuery["shape"]["rosterSlots"];
  readonly ceilings: NonNullable<RecommendationQuery["ceilings"]>;
  readonly nextPickNumber: number | null;
  readonly shortlistSize: number;
  readonly survival: ReadonlyMap<string, number>;
  /** The top of the rankable board, each one a full re-valuation away from its score. */
  readonly considered: readonly ConsideredCandidate[];
}

interface ScoredCandidate {
  readonly recommendation: Recommendation;
  readonly alreadyBenched: number;
  readonly averageDraftPosition: number;
}

/** Everything before the per-candidate scoring: one fit per board entry, the ranking, the cut. */
function prepareRecommendation(query: RecommendationQuery): PreparedRecommendation {
  const { board, roster, shape, pickNumber, nextPickNumber, room, shortlistSize = DEFAULT_SHORTLIST, ceilings = AUTOPICK_CONFIG.rosterCeilings! } = query;
  if (!Number.isInteger(pickNumber) || pickNumber < 1) {
    throw new Error(`A recommendation is made at a whole pick number; got ${pickNumber}.`);
  }
  const slotConfig = shape.rosterSlots;

  const survival =
    nextPickNumber === null
      ? new Map<string, number>()
      : survivalProbabilities({ board, fromPick: pickNumber, toPick: nextPickNumber, room });

  // TIES DEFER TO THE MARKET, never to the player id: two men the model cannot separate are
  // separated by where drafters take them, the same doctrine as the board's own order.
  const placeable = board
    .map((candidate) => ({ candidate, fit: fitFor(candidate, roster, slotConfig, ceilings) }))
    .filter((entry) => entry.fit.slot !== null);
  // The backup quarterback waits for the starters (the founder's rule): dropped while anyone
  // else can be placed, kept when he is all that is left rather than handing back nothing.
  const eligible = placeable.some((entry) => !entry.fit.waitsForStarters) ? placeable.filter((entry) => !entry.fit.waitsForStarters) : placeable;
  const rankable = [...eligible].sort(
    (a, b) =>
      b.fit.value - a.fit.value ||
      b.candidate.valueOverReplacement - a.candidate.valueOverReplacement ||
      a.candidate.averageDraftPosition - b.candidate.averageDraftPosition ||
      a.candidate.playerId.localeCompare(b.candidate.playerId),
  );

  // Only the top of the board can win, and each one costs a full re-valuation of what is left.
  const considered = rankable.slice(0, Math.max(shortlistSize * 3, DEFAULT_SHORTLIST * 3));
  return { query, board, roster, slotConfig, ceilings, nextPickNumber, shortlistSize, survival, considered };
}

/** One candidate's score: his own fit plus the best of what survives to the next turn with him taken. */
function scoreCandidate(prepared: PreparedRecommendation, { candidate, fit }: ConsideredCandidate): ScoredCandidate {
  const { board, roster, slotConfig, ceilings, nextPickNumber, survival, query } = prepared;
  const survives = survival.get(candidate.playerId) ?? 0;
  let expectedValueAdded = fit.value;
  if (nextPickNumber !== null) {
    const after = [...roster, candidate];
    const survivors = board
      .filter((entry) => entry.playerId !== candidate.playerId)
      .map((entry) => ({
        value: fitFor(entry, after, slotConfig, ceilings).value,
        survival: survival.get(entry.playerId) ?? 0,
      }));
    expectedValueAdded += expectedBestSurvivor(survivors);
  }
  return {
    recommendation: {
      playerId: candidate.playerId,
      position: candidate.position,
      expectedValueAdded,
      valueOverReplacement: candidate.valueOverReplacement,
      rosterAdjustedValue: fit.value,
      survivalProbability: survives,
      reasons: reasonsFor(candidate, fit, survives, query, board),
    } satisfies Recommendation,
    alreadyBenched: fit.alreadyBenched,
    averageDraftPosition: candidate.averageDraftPosition,
  };
}

/** Equal expected value: the position with fewer bodies already sitting first (depth spread
 *  across the roster, the same read the autopick keeps), then the market's order. */
function finishRecommendation(prepared: PreparedRecommendation, scored: readonly ScoredCandidate[]): readonly Recommendation[] {
  return [...scored]
    .sort(
      (a, b) =>
        b.recommendation.expectedValueAdded - a.recommendation.expectedValueAdded ||
        a.alreadyBenched - b.alreadyBenched ||
        a.averageDraftPosition - b.averageDraftPosition ||
        a.recommendation.playerId.localeCompare(b.recommendation.playerId),
    )
    .slice(0, prepared.shortlistSize)
    .map((entry) => entry.recommendation);
}
