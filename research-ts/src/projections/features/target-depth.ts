import type { Position } from "@research-ts/domain/player";
import { LAST_POSSIBLE_WEEK } from "../store";
import type { PlayerWeekUsage } from "../usage";

/**
 * TARGET DEPTH — how far downfield a man is thrown to, and the second feature here that separates
 * teammates rather than moving an offence together.
 *
 * A checkdown back and a field-stretcher can take the same target share of the same offence and are
 * not the same player. One of them turns eight targets into thirty yards and seven catches; the
 * other turns eight targets into a hundred and four catches. Nothing in layers 1 to 3 can tell them
 * apart before the fact, because both are described entirely by "eight targets".
 *
 * WHY THIS IS NOT ALREADY IN LAYER 2. Layer 2 does learn a player's own yards per target, and its
 * fitted regression constant is 218 targets — a receiver needs three full seasons of volume before
 * his own yards per target counts for half against his position's mean. That constant is correct for
 * what it measures: yards per target is a noisy statistic, dominated by whether one throw was caught
 * in stride. Average depth of target is the same role expressed in a far stabler quantity, because
 * the depth of a throw is decided by the play call rather than by what happened afterwards. The
 * argument is exactly the red-zone one: measure the role in the statistic that carries it, not in
 * the outcome the role produces.
 *
 * TWO RATES MOVE, IN OPPOSITE DIRECTIONS, and that is the test of whether this is real. A deeper
 * target is worth more yards and is caught less often. A feature that moved only the yards would be
 * claiming free points; both elasticities are fitted, and a receiving corps' catch rate falling as
 * its depth rises is the sign that the measurement is describing football.
 *
 * TOUCHDOWNS ARE LEFT ALONE HERE on purpose. The touchdown channel belongs to red-zone leverage,
 * which was built and measured first, and two features multiplying the same rate would make neither
 * of them ablatable — the second would be measured on top of whatever the first had already done.
 */

/** Each position's mean depth of target, over the fit seasons. `null` where nobody is thrown to. */
export type TargetDepthLeague = Readonly<Record<Position, number>>;

/** One player's accumulated air yards over the history a prediction may see. */
export interface TargetDepthTotals {
  readonly airYards: number;
  /** Targets the air-yard sum rests on, which is not every target — see `pbp-players.ts`. */
  readonly airYardTargets: number;
}

/**
 * How far a depth ratio may move a receiving rate, either way.
 *
 * Narrower than red-zone leverage's and wider than the team bound, and the middle position is the
 * honest one. Yards per target genuinely runs from about five for a back who catches screens to
 * about eleven for a receiver who runs go routes, which against a league mean near 7.7 is a range of
 * 0.65 to 1.4. But this multiplier lands on a rate layer 2 has ALREADY moved toward the player's own
 * history, so what is left for it is the part of that range layer 2 has not already found. A bound
 * at the full spread would let the two of them arrive at the answer twice.
 */
export const TARGET_DEPTH_MULTIPLIER_BOUND = { min: 0.75, max: 1.35 } as const;

/** Every fitted number the depth ratio needs. Fitted on the fit seasons — see `target-depth-fit.ts`. */
export interface TargetDepthPriors {
  readonly league: TargetDepthLeague;
  /** Weight multiplier per week into the past, as layer 1 and red-zone leverage both spell it. */
  readonly recencyDecay: number;
  /** How many targets of league prior a player's own depth is shrunk toward. */
  readonly shrinkage: number;
  /** How far a 1% deeper average target moves receiving yards per target. Measured, never assumed. */
  readonly yardsElasticity: number;
  /** The same for receptions per target, and it had better come out negative. */
  readonly receptionsElasticity: number;
}

/** The week a depth is being computed FOR, and how fast the past fades behind it. */
export interface TargetDepthWindow {
  readonly season: number;
  /** The week being predicted. Nothing at or after it is evidence. */
  readonly week: number;
  readonly decay: number;
}

/**
 * Sums one player's air yards over every week a prediction may read, weighted by recency.
 *
 * The same window discipline as `redZoneTotals`, and applied here rather than trusted to the caller
 * for the same reason: a depth that had seen the week it was predicting would look excellent and be
 * worthless, since the throws it averaged are the throws it is being scored on.
 */
export function targetDepthTotals(rows: readonly PlayerWeekUsage[], window: TargetDepthWindow): TargetDepthTotals {
  let airYards = 0;
  let airYardTargets = 0;
  for (const row of rows) {
    if (row.touches === null) continue;
    if (row.season > window.season || row.season < window.season - 1) continue;
    const ago = window.season * LAST_POSSIBLE_WEEK + window.week - (row.season * LAST_POSSIBLE_WEEK + row.week);
    if (ago < 1) continue;
    const weight = window.decay ** (ago - 1);
    airYards += weight * row.touches.airYards;
    airYardTargets += weight * row.touches.airYardTargets;
  }
  return { airYards, airYardTargets };
}

/**
 * How much deeper (or shallower) than his position a player is thrown to, shrunk toward it.
 *
 * A player with no targets at all comes back as exactly 1: no evidence shrinks entirely to the
 * prior, and the prior is "average for his position". So the caller never decides what an unknown
 * player deserves.
 *
 * PER POSITION, and it matters more here than anywhere else in the engine. A running back's mean
 * depth of target is close to zero yards and a receiver's is around nine, so a single league mean
 * would rate every back in football as a catastrophic underachiever and every receiver as a deep
 * threat — a difference of position dressed up as a difference of player.
 */
export function targetDepthRatio(totals: TargetDepthTotals, position: Position, priors: TargetDepthPriors): number | null {
  const league = priors.league[position];
  // A league mean at or below zero has no ratio: a position thrown to behind the line on average
  // cannot express "twice as deep", and inventing 1 would say the player was exactly typical.
  if (league === undefined || !(league > 0) || priors.shrinkage <= 0) return null;
  const depth = (totals.airYards + priors.shrinkage * league) / (totals.airYardTargets + priors.shrinkage);
  return depth <= 0 ? null : depth / league;
}

/** A depth ratio raised to its fitted elasticity, bounded. `null` leaves the rate alone. */
export function targetDepthMultiplier(ratio: number | null, elasticity: number): number {
  if (ratio === null || !(ratio > 0)) return 1;
  const raw = ratio ** elasticity;
  if (!Number.isFinite(raw)) return 1;
  return Math.min(TARGET_DEPTH_MULTIPLIER_BOUND.max, Math.max(TARGET_DEPTH_MULTIPLIER_BOUND.min, raw));
}
