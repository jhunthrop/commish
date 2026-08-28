import type { Position } from "@/domain/player";

/**
 * OPPORTUNITY REDISTRIBUTION — a receiver leaves, his target share vacates, and somebody becomes
 * the new number one.
 *
 * This is the founder's own example and the one feature in Phase 3 that moves players relative to
 * their own TEAMMATES rather than moving a whole offence together. Everything else here — the line,
 * the scheme, the opponent — is a team-level multiplier, and a team-level multiplier can hardly
 * reorder a board at all. This can.
 *
 * WHAT THE MODEL WITHOUT IT DOES WRONG. Layer 1 predicts a receiver's target share from his own
 * history, and every week of that history was played alongside the man who has just left. It will
 * find the new distribution eventually, through in-season recency weighting, over about three or
 * four weeks. Those are exactly the weeks a manager needs the answer.
 *
 * ROLE PROXIMITY, NOT AN EVEN SPLIT. A hundred and twenty vacated targets do not fall equally on a
 * fullback and the number-two receiver. Three things decide who absorbs them, in order of how much
 * evidence each carries:
 *
 *   1. WHAT ACTUALLY HAPPENED WHEN HE SAT. If the history contains weeks where the departed player
 *      did not play and his teammates did, the change in their shares across those weeks is direct
 *      evidence rather than inference. It is used whenever it exists.
 *   2. POSITION AFFINITY. Targets vacated by a receiver go mostly to receivers, some to the tight
 *      end, and little to the backs. Carries behave the same way in reverse.
 *   3. THE DEPTH CHART, read through predicted snap share — the same proxy layer 1's role prior
 *      uses, for the same reason: a 90%-snap receiver is a number one and a 25%-snap receiver is not.
 *
 * The reverse case matters as much and is symmetric: an ARRIVAL compresses everyone else. A team
 * that just traded for a number-one receiver has not increased its total targets, so somebody's
 * share has to fall, and the same proximity weights decide whose.
 *
 * Pure, like every feature module here. It takes shares and returns deltas.
 */

/**
 * How much of one position's vacated work another position is a candidate for.
 *
 * Stated as a table rather than as branching, because these are judgements about football and a
 * reviewer should be able to disagree with any one of them without reading code. They are
 * deliberately coarse: the absorption RATE is fitted, so these only have to get the ordering right.
 *
 * The quarterback row is all zeros in both directions and is not an oversight — a vacated target
 * share does not go to the quarterback, and a quarterback's vacated pass attempts go to the backup
 * quarterback, which is a substitution rather than a redistribution and is layer 1's own job.
 */
const POSITION_AFFINITY: Readonly<Record<Position, Readonly<Record<Position, number>>>> = {
  WR: { WR: 1, TE: 0.5, RB: 0.2, QB: 0, K: 0, DEF: 0 },
  TE: { WR: 0.6, TE: 1, RB: 0.2, QB: 0, K: 0, DEF: 0 },
  RB: { WR: 0.15, TE: 0.15, RB: 1, QB: 0, K: 0, DEF: 0 },
  QB: { WR: 0, TE: 0, RB: 0, QB: 0, K: 0, DEF: 0 },
  K: { WR: 0, TE: 0, RB: 0, QB: 0, K: 0, DEF: 0 },
  DEF: { WR: 0, TE: 0, RB: 0, QB: 0, K: 0, DEF: 0 },
};

export const REDISTRIBUTION_CONFIG = {
  /**
   * The most of a team's share any one player may gain or lose from a single transaction.
   *
   * A bound rather than a guard against a bug: no receiver in the league goes from a 15% target
   * share to a 40% one because a teammate left, whatever the arithmetic says, and an unbounded
   * split concentrated on one man by an extreme depth-chart weight would say exactly that.
   */
  maxShareMove: 0.12,
  /**
   * The fewest team-games a player must have missed for "what happened when he sat" to be used.
   *
   * One game is a coin flip — a receiver can post a 40% target share in one game for reasons that
   * have nothing to do with who was inactive. Two is still thin and is the point at which direct
   * evidence starts beating inference from a depth chart.
   */
  minGamesApartForEvidence: 2,
} as const;

/** One player on the current roster, as the redistribution needs to see him. */
export interface RosterPlayer {
  readonly playerId: string;
  readonly position: Position;
  /** Layer 1's predicted snap share — the depth chart, read through the only signal we have. */
  readonly snapShare: number;
  /**
   * How his share differed in the weeks the departing player was absent, if there were any.
   * `null` when the history contains no such weeks. See the module docblock: this outranks the
   * depth chart wherever it exists, because it is evidence rather than inference.
   */
  readonly upliftWhenAbsent: number | null;
}

/** One player leaving or joining, and the share that leaves or arrives with him. */
export interface ShareMove {
  readonly playerId: string;
  readonly position: Position;
  /** His recency-weighted share with THIS team, before he left. Positive for both directions. */
  readonly targetShare: number;
  readonly carryShare: number;
}

export interface RedistributionInput {
  /** Everyone on the offence now, excluding anyone named in `departures`. */
  readonly roster: readonly RosterPlayer[];
  readonly departures: readonly ShareMove[];
  readonly arrivals: readonly ShareMove[];
  /**
   * How much of a vacated share is actually absorbed by the remaining players, fitted on the fit
   * seasons. Never 1: some of it simply stops happening — an offence that loses its best receiver
   * throws less, and layer 1's own team-volume estimate is where that shows up.
   */
  readonly absorptionRate: number;
}

/** How much to add to (or subtract from) one player's predicted shares. */
export interface ShareDelta {
  readonly targetShare: number;
  readonly carryShare: number;
}

/**
 * The weight each remaining player has on one departing player's work.
 *
 * Direct evidence first: if the roster carries an uplift measured over weeks the departing player
 * missed, the weights are those uplifts, and nothing else is consulted. Otherwise it is affinity
 * times snap share — position first, then depth chart. Returns an empty map when nobody is a
 * candidate at all, which is the honest outcome for a quarterback's vacated targets.
 */
export function absorptionWeights(
  roster: readonly RosterPlayer[],
  departing: Position,
): ReadonlyMap<string, number> {
  const measured = roster.filter((player) => player.upliftWhenAbsent !== null && player.upliftWhenAbsent > 0);
  const source =
    measured.length > 0
      ? measured.map((player) => [player.playerId, player.upliftWhenAbsent!] as const)
      : roster.map(
          (player) => [player.playerId, POSITION_AFFINITY[departing][player.position] * player.snapShare] as const,
        );
  const total = source.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return new Map();
  return new Map(source.filter(([, weight]) => weight > 0).map(([playerId, weight]) => [playerId, weight / total]));
}

function clampMove(value: number): number {
  const bound = REDISTRIBUTION_CONFIG.maxShareMove;
  return Math.min(bound, Math.max(-bound, value));
}

/**
 * Every remaining player's share delta, from every departure and arrival at once.
 *
 * Departures and arrivals are accumulated into the same deltas before clamping, so a team that lost
 * one receiver and signed another nets out rather than being moved twice — which is the commonest
 * shape a real transaction takes and the one a naive implementation gets most wrong.
 */
export function redistributeShares({
  roster,
  departures,
  arrivals,
  absorptionRate,
}: RedistributionInput): ReadonlyMap<string, ShareDelta> {
  const deltas = new Map<string, { targetShare: number; carryShare: number }>(
    roster.map((player) => [player.playerId, { targetShare: 0, carryShare: 0 }]),
  );

  const apply = (move: ShareMove, direction: 1 | -1): void => {
    const weights = absorptionWeights(roster, move.position);
    for (const [playerId, weight] of weights) {
      const delta = deltas.get(playerId);
      if (delta === undefined) continue;
      delta.targetShare += direction * absorptionRate * move.targetShare * weight;
      delta.carryShare += direction * absorptionRate * move.carryShare * weight;
    }
  };

  for (const departure of departures) apply(departure, 1);
  // An arrival takes work from the same people a departure would have given it to, which is why the
  // weights are computed the same way and only the sign changes.
  for (const arrival of arrivals) apply(arrival, -1);

  return new Map(
    [...deltas.entries()].map(([playerId, delta]) => [
      playerId,
      { targetShare: clampMove(delta.targetShare), carryShare: clampMove(delta.carryShare) },
    ]),
  );
}
