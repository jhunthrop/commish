import { snakeTeamForPick, totalRosterSlots } from "@research-ts/draft-engine/order";
import type { Position } from "@research-ts/domain/player";
import { restrictedPositions } from "@research-ts/domain/roster-eligibility";
import { DEFAULT_SHORTLIST, landingSlot, recommendPick, rosterSlotsOf, type DraftCandidate, type PickReason, type Recommendation, type RosteredPlayer } from "@research-ts/projections/decide/draft";
import { valueBoardIndexed, type LeagueShape, type ValuedPlayer } from "@research-ts/projections/decide/replacement";
import { survivalProbabilities } from "@research-ts/projections/decide/survival";
import { tiersOf } from "@research-ts/projections/decide/tiers";
import type { AdviseRequest, PoolEntry } from "./request";
import { himSentence } from "./why";

/** The seat a snake draft puts on the clock at a 1-based pick, as a 1-based draft slot: the draft
 *  engine's own snake order over seats named by their slot. */
export function snakeSeat(teamCount: number, pickNumber: number): number {
  const seats = Array.from({ length: teamCount }, (_, index) => String(index + 1));
  return Number(snakeTeamForPick(seats, pickNumber));
}

/** The seat's next turn after `pickNumber`, or null when the draft ends first. */
export function nextTurn(teamCount: number, seat: number, pickNumber: number, totalPicks: number): number | null {
  for (let pick = pickNumber + 1; pick <= totalPicks; pick += 1) if (snakeSeat(teamCount, pick) === seat) return pick;
  return null;
}

export interface AdvisedCandidate extends Recommendation {
  /** Two sentences at most: about him, then whether he is there at your next turn. */
  readonly why: string;
}

export interface PositionTier {
  readonly tier: number;
  readonly playerIds: readonly string[];
  /** Projected points from this tier's last man to the next tier's first. Zero for the last tier. */
  readonly dropToNextTier: number;
}

export interface AdviseResponse {
  readonly pickNumber: number;
  readonly nextPickNumber: number | null;
  /** Ordered best first; the first is the recommended pick. */
  readonly shortlist: readonly AdvisedCandidate[];
  /** Every undrafted player's chance of still being there at your next turn (zero with no next turn). */
  readonly survival: Readonly<Record<string, number>>;
  /** Each position's undrafted pool, tiered by projected points. Market-order positions have none. */
  readonly tiers: Readonly<Partial<Record<Position, readonly PositionTier[]>>>;
  /** The basis the numbers above are read on, in one sentence. */
  readonly basis: string;
}

/**
 * WHEN THE VALUED BOARD HAS NOTHING LEGAL: the late rounds, bench full, only a kicker or a defense
 * slot open. Those positions ship in market order with no projection (the kdef decision), so
 * `recommendPick`, which ranks by value, has no candidate; the advisor answers with the legal
 * market-order players by where drafters take them, never an empty shortlist. `recommendPick`
 * itself is the oracle's and is not changed. Each carries no value (zero, honestly: there is no
 * projection above replacement to count) and the slot he fills as his reason.
 */
function marketOrderFallback(
  undrafted: readonly PoolEntry[],
  roster: readonly RosteredPlayer[],
  shape: LeagueShape,
  survival: ReadonlyMap<string, number>,
  shortlistSize: number,
): readonly Recommendation[] {
  return undrafted
    .filter((entry) => entry.projectedPoints === null)
    .flatMap((entry) => {
      const slot = landingSlot(roster, entry.position, shape.rosterSlots);
      return slot === null ? [] : [{ entry, slot }];
    })
    .sort((a, b) => a.entry.adp - b.entry.adp || a.entry.id.localeCompare(b.entry.id))
    .slice(0, shortlistSize)
    .map(({ entry, slot }) => ({
      playerId: entry.id,
      position: entry.position,
      expectedValueAdded: 0,
      valueOverReplacement: 0,
      rosterAdjustedValue: 0,
      survivalProbability: survival.get(entry.id) ?? 0,
      reasons: [{ code: "fills_starting_slot", slot }],
    }));
}

/** A market-order man's rank at his position: his place by ADP among the undrafted at it. */
function marketOrderRankOf(playerId: string, position: Position, undrafted: readonly PoolEntry[]): number {
  const atPosition = undrafted.filter((entry) => entry.position === position).sort((a, b) => a.adp - b.adp || a.id.localeCompare(b.id));
  return atPosition.findIndex((entry) => entry.id === playerId) + 1;
}

/** A refused room state: well-formed JSON whose draft cannot be where it says it is. */
export class RoomStateError extends Error {
  override readonly name = "RoomStateError";
}

function percentWords(probability: number): string {
  if (probability < 0.01) return "under 1%";
  if (probability > 0.99) return "over 99%";
  return `${Math.round(probability * 100)}%`;
}

/** The room sentence the closed form can say: how many picks go first, and how often he is still
 *  there by where drafters take him and how far they stray from it. */
function survivalSentence(pickNumber: number, nextPickNumber: number | null, probability: number): string {
  if (nextPickNumber === null) return "This is your last pick.";
  const between = nextPickNumber - pickNumber - 1;
  const picks = between === 1 ? "1 pick goes" : `${between} picks go`;
  return `${picks} before your next turn, and he is still there ${percentWords(probability)} of the time by where drafters take him.`;
}

function fillsSlotOf(reasons: readonly PickReason[], roster: readonly RosteredPlayer[], position: Position, shape: LeagueShape): ReturnType<typeof landingSlot> {
  const fills = reasons.find((reason): reason is Extract<PickReason, { code: "fills_starting_slot" }> => reason.code === "fills_starting_slot");
  return fills?.slot ?? landingSlot(roster, position, shape.rosterSlots);
}

/** One position's undrafted pool as tiers, its men in projected-points order. */
function positionTiers(players: readonly ValuedPlayer[]): readonly PositionTier[] {
  const sorted = [...players].sort((a, b) => b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId));
  const points = sorted.map((player) => player.projectedPoints);
  const tierAt = tiersOf(points);
  const tierNumbers = [...new Set(tierAt)];
  return tierNumbers.map((tier) => {
    const first = tierAt.indexOf(tier);
    const last = tierAt.lastIndexOf(tier);
    const nextFirst = last + 1 < sorted.length ? last + 1 : null;
    return {
      tier,
      playerIds: sorted.slice(first, last + 1).map((player) => player.playerId),
      dropToNextTier: nextFirst === null ? 0 : points[last]! - points[nextFirst]!,
    };
  });
}

function tiersByPosition(undrafted: readonly ValuedPlayer[]): AdviseResponse["tiers"] {
  const positions = [...new Set(undrafted.map((player) => player.position))];
  return Object.fromEntries(positions.map((position) => [position, positionTiers(undrafted.filter((player) => player.position === position))]));
}

function projected(entry: PoolEntry): entry is PoolEntry & { readonly projectedPoints: number } {
  return entry.projectedPoints !== null;
}

/**
 * THE ADVICE for one room state: the closed-form survival of every undrafted man to the seat's next
 * turn (`survivalProbabilities`), the shortlist (`recommendPick`), the why for each, and the tiers.
 * Pure: the same state always returns the same advice.
 */
export function advise(request: AdviseRequest): AdviseResponse {
  const shape: LeagueShape = { teamCount: request.teamCount, rosterSlots: request.rosterSlots };
  const totalPicks = request.teamCount * totalRosterSlots(request.rosterSlots);
  const pickNumber = request.picks.length + 1;
  if (pickNumber > totalPicks) throw new RoomStateError(`the draft is over: ${request.picks.length} picks of ${totalPicks} are in.`);
  const onClock = snakeSeat(request.teamCount, pickNumber);
  if (onClock !== request.seatOnClock) throw new RoomStateError(`pick ${pickNumber} belongs to seat ${onClock} in a snake draft, not seat ${request.seatOnClock}.`);
  const nextPickNumber = nextTurn(request.teamCount, request.seatOnClock, pickNumber, totalPicks);

  const valued = valueBoardIndexed(request.pool.filter(projected).map((entry) => ({ playerId: entry.id, position: entry.position, projectedPoints: entry.projectedPoints })), shape);
  const drafted = new Set(request.picks.map((pick) => pick.playerId));
  const poolById = new Map(request.pool.map((entry) => [entry.id, entry] as const));
  const undraftedPool = request.pool.filter((entry) => !drafted.has(entry.id));
  // A market-order man on the roster sits at replacement by construction: the board ships no
  // projection for his position, so there is nothing above replacement to count (kdef decision).
  const roster: RosteredPlayer[] = request.picks
    .filter((pick) => pick.seat === request.seatOnClock)
    .map((pick) => {
      const entry = poolById.get(pick.playerId)!;
      return { playerId: entry.id, position: entry.position, valueOverReplacement: valued.byPlayerId.get(entry.id)?.valueOverReplacement ?? 0 };
    });

  const survival = nextPickNumber === null
    ? new Map<string, number>(undraftedPool.map((entry) => [entry.id, 0] as const))
    : survivalProbabilities({ board: undraftedPool.map((entry) => ({ playerId: entry.id, position: entry.position, averageDraftPosition: entry.adp })), fromPick: pickNumber, toPick: nextPickNumber });

  const board: DraftCandidate[] = undraftedPool.flatMap((entry) => {
    const value = valued.byPlayerId.get(entry.id);
    return value === undefined ? [] : [{ ...value, averageDraftPosition: entry.adp }];
  });
  const valuedRecommendations = recommendPick({ board, roster, shape, pickNumber, nextPickNumber, shortlistSize: request.shortlistSize });
  const recommendations =
    valuedRecommendations.length > 0
      ? valuedRecommendations
      : marketOrderFallback(undraftedPool, roster, shape, survival, request.shortlistSize ?? DEFAULT_SHORTLIST);
  if (recommendations.length === 0) {
    throw new RoomStateError(`no player left in the pool can fill seat ${request.seatOnClock}'s open slots at pick ${pickNumber}; the pool is missing a position the roster rules start.`);
  }
  const mustPick = restrictedPositions(shape.rosterSlots, rosterSlotsOf(roster, shape.rosterSlots));
  const shortlist = recommendations.map((recommendation) => {
    const him = himSentence(
      {
        position: recommendation.position,
        positionRank: valued.byPlayerId.get(recommendation.playerId)?.positionRank ?? marketOrderRankOf(recommendation.playerId, recommendation.position, undraftedPool),
        fillsSlot: fillsSlotOf(recommendation.reasons, roster, recommendation.position, shape),
        reasons: recommendation.reasons,
        mustPick,
      },
      pickNumber,
    );
    return { ...recommendation, why: `${him.text} ${survivalSentence(pickNumber, nextPickNumber, recommendation.survivalProbability)}` };
  });

  return {
    pickNumber,
    nextPickNumber,
    shortlist,
    survival: Object.fromEntries(survival),
    tiers: tiersByPosition(board),
    basis: `Value over replacement for a ${request.teamCount}-team league on these roster rules, survival from where drafters take each player and how far they stray from it.`,
  };
}
