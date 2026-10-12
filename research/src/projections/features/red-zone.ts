import type { Position } from "@research/domain/player";
import { LAST_POSSIBLE_WEEK } from "../store";
import type { PlayerWeekUsage } from "../usage";

/**
 * RED-ZONE LEVERAGE — the first feature in this engine that separates a man from his own teammates.
 *
 * Phase 3 shipped four groups of context and recorded why the pooled scoreboard did not move: three
 * of them were TEAM-LEVEL multipliers, so an offence's whole roster moved together and a ranking was
 * barely reordered. Its closing lesson named the fix. Two backs can split carries down the middle
 * and only one of them scores, because only one of them is on the field at the two-yard line, and no
 * quantity anywhere in layers 1 to 3 can tell them apart.
 *
 * WHY THE MODEL CANNOT ALREADY SEE THIS. Layer 2 regresses every touchdown rate toward its position's
 * mean, and the fitted constants say to regress rushing and passing touchdown rate ENTIRELY there
 * (10,000 opportunities of prior — `fitted.ts` prints it as "no measurable spread between players").
 * That is the correct answer to the question layer 2 asked: touchdowns are too rare for a player's
 * own touchdown rate to be worth anything. It is the wrong answer to the question a manager asks,
 * because the difference between these two backs is real and is simply not visible in the statistic
 * layer 2 was reading. Red-zone touches are roughly ten times commoner than touchdowns, so the same
 * role difference shows up in a tenth of the sample — which is the entire argument for this feature.
 *
 * A RATE PER TOUCH, NOT A SHARE OF THE TEAM'S. The obvious spelling is "his share of his offence's
 * red-zone carries", and it is the wrong one HERE: what this multiplies is a rate per carry, and a
 * team share would carry the offence's own red-zone volume inside it — so a back on a good offence
 * would be credited twice, once through his team's carry volume in layer 1 and again through this.
 * The per-touch rate asks only the teammate-separating question: of the carries HE got, how many
 * were the ones near the goal line?
 *
 * INSIDE THE TEN FOR CARRIES, INSIDE THE TWENTY FOR TARGETS, and both choices are made here rather
 * than fitted. A rushing touchdown is overwhelmingly a short-yardage play, so the ten is where a
 * back's role shows; a receiving touchdown is thrown from further out and inside-ten targets are
 * rare enough to be mostly noise, so the twenty is the honest band for a receiver. Choosing bands by
 * which one scored better on the held-out seasons would be tuning against the test set.
 */

/** Which band of the field a touch counts in, per position, as league means over the fit seasons. */
export interface RedZoneLeagueRates {
  /** Share of a position's carries that were snapped inside the opponent's ten. */
  readonly insideTenCarriesPerCarry: number;
  /** Share of a position's targets that were thrown inside the opponent's twenty. */
  readonly redZoneTargetsPerTarget: number;
}

export type RedZoneLeague = Readonly<Record<Position, RedZoneLeagueRates>>;

/** One player's accumulated touches over the history a prediction may see. */
export interface RedZoneTotals {
  readonly carries: number;
  readonly insideTenCarries: number;
  readonly targets: number;
  readonly redZoneTargets: number;
}

export const NO_RED_ZONE_TOTALS: RedZoneTotals = {
  carries: 0,
  insideTenCarries: 0,
  targets: 0,
  redZoneTargets: 0,
};

/**
 * How far a leverage may move a touchdown rate, either way.
 *
 * DELIBERATELY WIDER THAN `CONTEXT_MULTIPLIER_BOUND`, and the difference is a claim about the world
 * rather than a loosened safety net. That bound is 0.8 to 1.25 because no offensive line is twice as
 * good at run blocking as another and no defence is half as good against the pass — a team-level
 * multiplier that produced a doubling would be reporting an artefact. A red-zone role difference IS
 * that large: a goal-line back and a third-down back on the same roster genuinely differ in
 * touchdowns per carry by a multiple, and capping this at a quarter would delete the finding rather
 * than bound it.
 *
 * Bounded at all for the reason the team bound exists: a leverage computed from four carries in week
 * 2 can run away under a power function, and what it lands on is a rate that layer 2 has already
 * regressed entirely to the position mean. The shrinkage below is the real defence; this is the
 * backstop behind it.
 */
export const RED_ZONE_MULTIPLIER_BOUND = { min: 0.4, max: 2.5 } as const;

/** Every fitted number the leverage needs. Fitted on the fit seasons — see `red-zone-fit.ts`. */
export interface RedZonePriors {
  readonly league: RedZoneLeague;
  /**
   * Weight multiplier per week into the past, exactly as layer 1 spells its own recency.
   *
   * A red-zone role is a coaching decision and coaching decisions change: the back who got the ball
   * at the one in September is often not the back who gets it in December, and a flat average over
   * two seasons would still be describing September in week 15. Layer 1 fits a decay for precisely
   * this reason and lands on 0.7, so a feature about roles that used a flat mean would be claiming
   * roles are MORE stable than opportunity is. Fitted here rather than borrowed, because the two are
   * measuring different things and there is no reason for one number to serve both.
   */
  readonly recencyDecay: number;
  /**
   * How many carries (targets) of league prior a player's own red-zone rate is shrunk toward.
   *
   * In OPPORTUNITIES rather than games, following `efficiency.ts`: a back with two hundred carries
   * and a back with twenty are not equally known about, and a constant in games would say they were.
   */
  readonly carryShrinkage: number;
  readonly targetShrinkage: number;
  /** How far a 1% higher red-zone leverage moves the touchdown rate. Measured, never assumed. */
  readonly rushingElasticity: number;
  readonly receivingElasticity: number;
}

/** The week a leverage is being computed FOR, and how fast the past fades behind it. */
export interface RedZoneWindow {
  readonly season: number;
  /** The week being predicted. Nothing at or after it is evidence. */
  readonly week: number;
  readonly decay: number;
}

/**
 * Where in the past a week sits, in weeks, counting the immediately preceding one as 1.
 *
 * Across a season boundary as well as within one, on a single absolute index — the offseason is
 * counted as the weeks it displaces rather than treated as no time at all. `LAST_POSSIBLE_WEEK` is
 * borrowed as the length of a season for this arithmetic, which overstates the gap by the four
 * playoff weeks and is the conservative direction: it fades a January role slightly faster than
 * calendar weeks would, and a role a year old genuinely is nearly no evidence.
 */
function weeksAgo(row: PlayerWeekUsage, window: RedZoneWindow): number {
  return (
    window.season * LAST_POSSIBLE_WEEK + window.week - (row.season * LAST_POSSIBLE_WEEK + row.week)
  );
}

/**
 * Sums one player's touches over every week a prediction may read, weighted by recency.
 *
 * Weeks with no play-by-play row contribute NOTHING rather than zeros — the `touches` group is null
 * for a player-week the play-by-play ingestion never saw, and a season that has not been ingested
 * must read as "no evidence" rather than as a league of players who never reach the goal line.
 *
 * The window is applied HERE rather than trusted to the caller, matching `predictOpportunity`: a
 * caller may legitimately hold rows from the week being predicted, and a leverage that had seen its
 * own week would look excellent and be worthless, because a goal-line carry and the touchdown it
 * produced are in large part the same play.
 */
export function redZoneTotals(rows: readonly PlayerWeekUsage[], window: RedZoneWindow): RedZoneTotals {
  let carries = 0;
  let insideTenCarries = 0;
  let targets = 0;
  let redZoneTargets = 0;
  for (const row of rows) {
    if (row.touches === null) continue;
    if (row.season > window.season || row.season < window.season - 1) continue;
    const ago = weeksAgo(row, window);
    if (ago < 1) continue;
    const weight = window.decay ** (ago - 1);
    carries += weight * row.touches.carries;
    insideTenCarries += weight * row.touches.insideTenCarries;
    targets += weight * row.touches.targets;
    redZoneTargets += weight * row.touches.redZoneTargets;
  }
  return { carries, insideTenCarries, targets, redZoneTargets };
}

/**
 * One shrinkage step on a rate: `numerator` out of `denominator`, against `k` opportunities of a
 * league prior. Exactly the form `efficiency.ts` uses, and for the same reason.
 *
 * `null` when the prior itself is not a usable rate — a position with no league mean has nothing to
 * be relative to, and 1 would be a claim that the player is exactly average rather than an admission
 * that nothing is known.
 */
function shrunkRatio(numerator: number, denominator: number, league: number, k: number): number | null {
  if (!(league > 0) || k <= 0) return null;
  const rate = (numerator + k * league) / (denominator + k);
  return rate / league;
}

/** How much more (or less) than his position's share of touches came near the goal line. */
export interface RedZoneLeverage {
  /** Above 1 means a larger share of his carries were inside the ten than his position's. */
  readonly rushing: number | null;
  readonly receiving: number | null;
}

export const NO_LEVERAGE: RedZoneLeverage = { rushing: null, receiving: null };

/**
 * One player's leverage, shrunk toward his position's league rate by the fitted constant.
 *
 * A player with no touches at all comes back as exactly 1 rather than as `null`, because the
 * shrinkage says so: no evidence shrinks entirely to the prior, and the prior is "average". The
 * caller therefore never has to decide what an unknown player deserves — the arithmetic already did.
 */
export function redZoneLeverage(totals: RedZoneTotals, position: Position, priors: RedZonePriors): RedZoneLeverage {
  const league = priors.league[position];
  if (league === undefined) return NO_LEVERAGE;
  return {
    rushing: shrunkRatio(totals.insideTenCarries, totals.carries, league.insideTenCarriesPerCarry, priors.carryShrinkage),
    receiving: shrunkRatio(totals.redZoneTargets, totals.targets, league.redZoneTargetsPerTarget, priors.targetShrinkage),
  };
}

/** A leverage raised to its fitted elasticity, bounded. `null` leverage leaves the rate alone. */
export function redZoneMultiplier(leverage: number | null, elasticity: number): number {
  if (leverage === null || !(leverage > 0)) return 1;
  const raw = leverage ** elasticity;
  if (!Number.isFinite(raw)) return 1;
  return Math.min(RED_ZONE_MULTIPLIER_BOUND.max, Math.max(RED_ZONE_MULTIPLIER_BOUND.min, raw));
}
