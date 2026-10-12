import type { Position } from "@research/domain/player";
import { BENCH_SLOT, type RosterSlotConfig } from "@research/domain/roster";

/**
 * THE IDEA THAT MAKES DRAFTING DIFFERENT FROM RANKING.
 *
 * Layers 0 to 7 of the engine predict. None of them decide, and a perfect projection still does
 * not tell a manager who to take, because draft value is not points. It is points ABOVE WHAT IS
 * STILL GETTABLE at that position later. A quarterback who scores 330 and a back who scores 300
 * are not a 30-point gap: if the twelfth-best quarterback scores 290 and the thirty-first-best
 * back scores 150, the back is worth 150 and the quarterback is worth 40. Ranking by points gets
 * this exactly backwards, and it is the single most common way a fantasy board is wrong.
 *
 * REPLACEMENT LEVEL IS A FUNCTION OF THE LEAGUE, NEVER A CONSTANT. It falls out of two numbers
 * this product owns and a generic site has to guess at: how many teams are in the league, and
 * what the league's real `RosterSlotConfig` says they start. Twelve teams starting two backs and
 * a flex will roster somewhere between the thirtieth and the thirty-sixth back; ten teams
 * starting three will roster the thirtieth exactly. Superflex roughly doubles quarterback demand
 * and is the format where borrowed rankings fail worst.
 *
 * NOTHING HERE RE-PREDICTS. Every projected point comes in as an argument. If you find yourself
 * adjusting a projected stat in this file, you are in the wrong layer.
 */

/** The only two facts about a league that replacement level depends on. */
export interface LeagueShape {
  readonly teamCount: number;
  /** The league's own `leagues.roster_slots`, not a preset looked up by name. */
  readonly rosterSlots: readonly RosterSlotConfig[];
}

/**
 * One player's projected points for the horizon being decided over, ALREADY COMPOSED through the
 * league's scoring rules by `computeFantasyPoints`. Season points for a draft board, week points
 * for a weekly one. This module is indifferent to which, and that is deliberate: the arithmetic
 * of scarcity does not change with the horizon.
 */
export interface SeasonProjection {
  readonly playerId: string;
  readonly position: Position;
  readonly projectedPoints: number;
}

export interface ReplacementLevels {
  /**
   * Points of the LAST starter the league will roster at each position. A position the league
   * never starts is ABSENT rather than zero, so a caller cannot silently treat "unstartable" as
   * "worth nothing above nothing".
   */
  readonly byPosition: ReadonlyMap<Position, number>;
  /** How many starters the whole league fields at each position, flex slots included. */
  readonly startingDemand: ReadonlyMap<Position, number>;
}

export interface ValuedPlayer extends SeasonProjection {
  readonly valueOverReplacement: number;
  /** 1-based rank within his own position, by projected points. */
  readonly positionRank: number;
  /** The level he was measured against, carried so a surface can show the subtraction. */
  readonly replacementLevel: number;
}

function isStartingSlot(slot: RosterSlotConfig): boolean {
  return slot.slot !== BENCH_SLOT;
}

function byPointsDescending(a: SeasonProjection, b: SeasonProjection): number {
  // Player id breaks ties so the whole module is reproducible run to run, the same discipline
  // `observationsAsOf` holds its ordering to.
  return b.projectedPoints - a.projectedPoints || a.playerId.localeCompare(b.playerId);
}

function poolsByPosition(
  projections: readonly SeasonProjection[],
): ReadonlyMap<Position, readonly SeasonProjection[]> {
  const pools = new Map<Position, SeasonProjection[]>();
  for (const projection of projections) {
    if (!Number.isFinite(projection.projectedPoints)) {
      throw new Error(
        `Projection for ${projection.playerId} is not a finite number; the decision layer consumes projections, it does not repair them.`,
      );
    }
    const pool = pools.get(projection.position);
    if (pool === undefined) pools.set(projection.position, [projection]);
    else pool.push(projection);
  }
  for (const pool of pools.values()) pool.sort(byPointsDescending);
  return pools;
}

/**
 * How many starters the LEAGUE fields at each position once flex slots are handed out.
 *
 * Dedicated slots are arithmetic: twelve teams times one tight end is twelve tight ends. Flex
 * slots are a choice, and the honest way to resolve it is to give each one to whichever eligible
 * position still has the best unclaimed player. That is what a room actually does, and it is why
 * flex demand lands on backs in a year when backs are deep and on receivers when they are not,
 * rather than on a hardcoded split.
 *
 * Flexible slots are handed out MOST RESTRICTIVE FIRST. With this product's nested eligibility
 * (QB inside SUPERFLEX; RB/WR/TE inside FLEX inside SUPERFLEX) the greedy is optimal and the
 * order does not change the totals, but processing narrow before wide keeps it that way if a
 * commissioner ever configures a shape that is not nested.
 */
export function startingDemand(
  projections: readonly SeasonProjection[],
  { teamCount, rosterSlots }: LeagueShape,
): ReadonlyMap<Position, number> {
  if (!Number.isInteger(teamCount) || teamCount < 1) {
    throw new Error(`A league shape needs a whole number of teams; got ${teamCount}.`);
  }
  const pools = poolsByPosition(projections);
  const demand = new Map<Position, number>();
  const starting = rosterSlots.filter(isStartingSlot);

  for (const slot of starting) {
    for (const position of slot.eligiblePositions) {
      if (!demand.has(position)) demand.set(position, 0);
    }
  }
  for (const slot of starting.filter((s) => s.eligiblePositions.length === 1)) {
    const position = slot.eligiblePositions[0]!;
    demand.set(position, demand.get(position)! + slot.count * teamCount);
  }

  const flexible = starting
    .filter((slot) => slot.eligiblePositions.length > 1)
    .sort((a, b) => a.eligiblePositions.length - b.eligiblePositions.length);

  for (const slot of flexible) {
    for (let unit = 0; unit < slot.count * teamCount; unit += 1) {
      let best: Position | null = null;
      let bestPoints = -Infinity;
      for (const position of slot.eligiblePositions) {
        const next = pools.get(position)?.[demand.get(position)!];
        if (next !== undefined && next.projectedPoints > bestPoints) {
          best = position;
          bestPoints = next.projectedPoints;
        }
      }
      // Every eligible pool exhausted: the slot goes unfilled league-wide, which raises nobody's
      // demand. Charging it to a position anyway would invent a starter who does not exist.
      if (best === null) break;
      demand.set(best, demand.get(best)! + 1);
    }
  }
  return demand;
}

/**
 * The projected points of the last starter the league rosters at each position.
 *
 * ZERO when the pool is shallower than the league's demand, because a starting slot nobody can
 * fill scores nothing, and that is the true bar the next player has to clear. Deliberately not
 * "the worst player we happen to have", which would understate scarcity exactly where scarcity
 * is most extreme.
 */
export function replacementLevel(
  projections: readonly SeasonProjection[],
  shape: LeagueShape,
): ReplacementLevels {
  const pools = poolsByPosition(projections);
  const demand = startingDemand(projections, shape);
  const byPosition = new Map<Position, number>();
  for (const [position, count] of demand) {
    const pool = pools.get(position) ?? [];
    byPosition.set(position, count === 0 ? 0 : (pool[count - 1]?.projectedPoints ?? 0));
  }
  return { byPosition, startingDemand: demand };
}

/**
 * THROWS for a position the league never starts, rather than returning the player's raw points.
 *
 * A kicker in a league with no kicker slot has no draft value at all, and any number returned
 * here would be compared against real ones on a board. Failing loudly at the boundary is the
 * only answer that cannot end up sorting a kicker above a receiver.
 */
export function valueOverReplacement(projection: SeasonProjection, levels: ReplacementLevels): number {
  const level = levels.byPosition.get(projection.position);
  if (level === undefined) {
    throw new Error(
      `This league starts nobody at ${projection.position}, so ${projection.playerId} has no value over replacement in it.`,
    );
  }
  return projection.projectedPoints - level;
}

/**
 * THE BOARD. Every startable player, ordered by value over replacement rather than by points.
 *
 * Players at a position the league never starts are LEFT OUT rather than valued at zero: zero is
 * a real number that would sort them above every player below replacement, and "we do not draft
 * kickers in this format" is the honest statement.
 */
export function valueBoard(projections: readonly SeasonProjection[], shape: LeagueShape): readonly ValuedPlayer[] {
  const levels = replacementLevel(projections, shape);
  const pools = poolsByPosition(projections);
  const board: ValuedPlayer[] = [];
  for (const [position, pool] of pools) {
    const level = levels.byPosition.get(position);
    if (level === undefined) continue;
    pool.forEach((projection, index) => {
      board.push({
        ...projection,
        positionRank: index + 1,
        replacementLevel: level,
        valueOverReplacement: projection.projectedPoints - level,
      });
    });
  }
  return board.sort(
    (a, b) => b.valueOverReplacement - a.valueOverReplacement || a.playerId.localeCompare(b.playerId),
  );
}

/** `valueBoard`'s own sorted output, plus the same entries indexed by player id. */
export interface ValuedBoard {
  /** `valueBoard`'s sorted array, unchanged — a caller that needs RANK (index in this order) as
   *  well as a by-id lookup would otherwise have to rebuild it from a map's insertion order. */
  readonly sorted: readonly ValuedPlayer[];
  readonly byPlayerId: ReadonlyMap<string, ValuedPlayer>;
}

/**
 * `valueBoard`, indexed by player id — the one small piece of wiring every league-aware valuation
 * reader repeats: run the valuation once, then look a specific player up by id without re-scanning
 * the array. `@research/board/service`'s `boardRows` (the Board's own read of this valuation)
 * and `@/draft-service/assistant/call.ts`'s `valuedEvidence` (the live Assistant's) both need
 * exactly this — one shared helper here rather than each hand-rolling the same `new Map(...)`.
 */
export function valueBoardIndexed(projections: readonly SeasonProjection[], shape: LeagueShape): ValuedBoard {
  const sorted = valueBoard(projections, shape);
  return { sorted, byPlayerId: new Map(sorted.map((entry) => [entry.playerId, entry] as const)) };
}
