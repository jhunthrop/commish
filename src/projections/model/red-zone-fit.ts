import type { Position } from "@/domain/player";
import {
  redZoneLeverage,
  redZoneTotals,
  type RedZoneLeague,
  type RedZonePriors,
  type RedZoneTotals,
} from "../features/red-zone";
import type { SeasonStatLine } from "../lines";
import type { PlayerWeekUsage } from "../usage";
import type { EfficiencyPriors } from "./efficiency";
import { fitLogLinkElasticity, logLinkLikelihood, type LogLinkPoint } from "./log-link";

/**
 * FITTING RED-ZONE LEVERAGE, through the shared log-link estimator in `log-link.ts`.
 *
 * The exposure is the player's opportunities times his POSITION's touchdown rate rather than his
 * own, and that is not a shortcut: layer 2's fit regresses rushing and passing touchdown rate
 * entirely to the position mean (10,000 opportunities of prior), so the position rate IS what the
 * model already predicts. The exposure is therefore the model's own prediction, and the elasticity
 * is a fit against its residual.
 *
 * THE SHRINKAGE AND THE DECAY ARE FITTED TOO, on the same likelihood. "How many carries of league prior is a
 * player's own red-zone rate worth" has a right answer in the data and no right answer in anybody's
 * intuition, and leaving it as a hand-chosen constant would put the one number that decides how
 * aggressive this feature is outside the measurement. Chosen by likelihood on the FIT seasons and on
 * nothing else — picking it by the held-out scoreboard is the one mistake that cannot be detected
 * from the inside.
 */

/** One player-week of evidence: what he was given, what he did with it, and what he had shown. */
interface PoissonPoint {
  /** Touchdowns actually scored. Zero for most rows, which is the whole reason for this file. */
  readonly count: number;
  /** Opportunities times the position's mean rate — the expectation with no leverage at all. */
  readonly exposure: number;
  /** His own weeks. The leverage is recomputed from them for every candidate decay and prior. */
  readonly rows: readonly PlayerWeekUsage[];
  readonly season: number;
  readonly week: number;
  readonly position: Position;
}

export interface RedZoneFitInput {
  readonly usage: readonly PlayerWeekUsage[];
  readonly history: readonly SeasonStatLine[];
  readonly positions: ReadonlyMap<string, Position>;
  /** Layer 2's own priors. The position touchdown rates this multiplier sits on top of. */
  readonly efficiency: EfficiencyPriors;
  readonly seasons: readonly number[];
  readonly heldOut?: readonly number[];
}

/** What the fit found, beside the priors, so the operator can see the shape of the evidence. */
export interface RedZoneFitReport {
  readonly priors: RedZonePriors;
  readonly rushingPlayerWeeks: number;
  readonly receivingPlayerWeeks: number;
  readonly rushingTouchdowns: number;
  readonly receivingTouchdowns: number;
}

/**
 * The priors the leverages are shrunk by, in opportunities, FIXED rather than fitted.
 *
 * See `log-link.ts`: the prior and the elasticity are a ridge, so only their ratio is identified and
 * the prior is a choice of units. These are a full season of a lead back's carries and of a number
 * one receiver's targets, which is the scale at which "this is his role" stops being "this is what
 * happened to him" — and the elasticity is fitted against them, so a different choice would produce
 * a different elasticity and the same model.
 */
const CARRY_SHRINKAGE = 200;
const TARGET_SHRINKAGE = 120;

/**
 * The candidate recency decays, as a weight multiplier per week into the past.
 *
 * 1 is a flat mean over the whole window and is kept in the ladder on purpose: if roles turn out to
 * be stable enough that January is worth as much as last Sunday, the likelihood should be allowed to
 * say so rather than being forced to discount by assumption. Layer 1's own fitted decay is 0.7, and
 * the ladder brackets it on both sides.
 */
const DECAY_CANDIDATES: readonly number[] = [1, 0.95, 0.9, 0.8, 0.7, 0.6];

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Each position's league rates, over the fit seasons' player-weeks.
 *
 * A RATIO OF SUMS, never a mean of ratios: a receiver with one target, and that one target thrown
 * from the twelve-yard line, has a red-zone target rate of 1.0, and averaging that in beside a
 * hundred-target season would let one week of one player move a whole position's prior.
 */
export function fitRedZoneLeague(usage: readonly PlayerWeekUsage[], positions: ReadonlyMap<string, Position>, seasons: readonly number[]): RedZoneLeague {
  const allowed = new Set(seasons);
  const totals = new Map<Position, { carries: number; insideTenCarries: number; targets: number; redZoneTargets: number }>();
  for (const position of POSITIONS) {
    totals.set(position, { carries: 0, insideTenCarries: 0, targets: 0, redZoneTargets: 0 });
  }
  for (const row of usage) {
    if (!allowed.has(row.season) || row.touches === null) continue;
    const position = positions.get(row.playerId);
    if (position === undefined) continue;
    const running = totals.get(position)!;
    running.carries += row.touches.carries;
    running.insideTenCarries += row.touches.insideTenCarries;
    running.targets += row.touches.targets;
    running.redZoneTargets += row.touches.redZoneTargets;
  }
  return Object.fromEntries(
    POSITIONS.map((position) => {
      const running = totals.get(position)!;
      return [
        position,
        {
          insideTenCarriesPerCarry: running.carries === 0 ? 0 : running.insideTenCarries / running.carries,
          redZoneTargetsPerTarget: running.targets === 0 ? 0 : running.redZoneTargets / running.targets,
        },
      ];
    }),
  ) as RedZoneLeague;
}

/**
 * One player's usage rows, grouped once, so a windowed total is a scan of his own forty-odd weeks
 * rather than of the whole league's fifty thousand.
 *
 * Recency weighting rules out the prefix-sum trick that a flat total allows, because every target
 * week weighs the same past week differently. Grouping by player is what keeps that affordable: the
 * inner scan is bounded by one man's career in the window, not by the size of the fit.
 */
function rowsByPlayer(usage: readonly PlayerWeekUsage[]): ReadonlyMap<string, readonly PlayerWeekUsage[]> {
  const grouped = new Map<string, PlayerWeekUsage[]>();
  for (const row of usage) {
    (grouped.get(row.playerId) ?? grouped.set(row.playerId, []).get(row.playerId)!).push(row);
  }
  return grouped;
}

/** What one side found at one decay: its elasticity and how well the pair fit. */
interface SideFit {
  readonly elasticity: number;
  readonly likelihood: number;
}

/**
 * One side at one decay — carries into rushing touchdowns, or targets into receiving touchdowns.
 *
 * One exact solve rather than a sweep: for a fixed prior the likelihood in the elasticity is
 * concave and its maximum is found by bisecting the score, so there is nothing here to search over.
 */
function fitSideAtDecay(
  observations: readonly PoissonPoint[],
  decay: number,
  leverageOf: (totals: RedZoneTotals, position: Position) => number | null,
): SideFit | null {
  const points: LogLinkPoint[] = [];
  for (const observation of observations) {
    const totals = redZoneTotals(observation.rows, { season: observation.season, week: observation.week, decay });
    const leverage = leverageOf(totals, observation.position);
    if (leverage === null || !(leverage > 0) || !(observation.exposure > 0)) continue;
    points.push({ outcome: observation.count, exposure: observation.exposure, logRatio: Math.log(leverage) });
  }
  if (points.length === 0) return null;
  const elasticity = fitLogLinkElasticity(points);
  return { elasticity, likelihood: logLinkLikelihood(points, elasticity) };
}

/**
 * Fits both elasticities and both shrinkage constants. Throws if pointed at a held-out season.
 *
 * The leverage for a player-week is computed from the weeks BEFORE it, exactly as the model computes
 * it at prediction time. Fitting against a leverage that included the week being explained would
 * measure a correlation the model can never exploit — a back's goal-line carries and his goal-line
 * touchdowns are in large part the same plays — and would produce an elasticity several times too
 * large, on a feature whose whole risk is being too confident.
 */
export function fitRedZonePriors(input: RedZoneFitInput): RedZoneFitReport {
  const overlap = input.seasons.filter((season) => (input.heldOut ?? []).includes(season));
  if (overlap.length > 0) {
    throw new Error(
      `Season${overlap.length > 1 ? "s" : ""} ${overlap.join(", ")} would be fitted on and then reported on. A parameter that has read the test set is not a parameter.`,
    );
  }

  const league = fitRedZoneLeague(input.usage, input.positions, input.seasons);
  const byPlayer = rowsByPlayer(input.usage);
  const lines = new Map<string, SeasonStatLine>();
  for (const row of input.history) lines.set(`${row.season}|${row.line.week}|${row.line.playerId}`, row);

  const allowed = new Set(input.seasons);
  const rushing: PoissonPoint[] = [];
  const receiving: PoissonPoint[] = [];
  for (const row of input.usage) {
    if (!allowed.has(row.season)) continue;
    const position = input.positions.get(row.playerId);
    if (position === undefined) continue;
    const key = `${row.season}|${row.week}|${row.playerId}`;
    const line = lines.get(key);
    const rows = byPlayer.get(row.playerId);
    if (line === undefined || rows === undefined) continue;
    const rates = input.efficiency.byPosition[position];
    const at = { rows, season: row.season, week: row.week, position } as const;
    if (row.carries > 0) {
      rushing.push({ ...at, count: line.line.rushingTouchdowns, exposure: row.carries * rates.rushingTouchdownsPerCarry });
    }
    if (row.targets > 0) {
      receiving.push({ ...at, count: line.line.receivingTouchdowns, exposure: row.targets * rates.receivingTouchdownsPerTarget });
    }
  }

  const shape: RedZonePriors = {
    league,
    recencyDecay: 1,
    carryShrinkage: CARRY_SHRINKAGE,
    targetShrinkage: TARGET_SHRINKAGE,
    rushingElasticity: 0,
    receivingElasticity: 0,
  };

  /**
   * ONE DECAY FOR BOTH SIDES, chosen on the two sides' likelihoods ADDED TOGETHER.
   *
   * The window is a property of how fast a ROLE changes, not of which kind of touch the role is
   * for, and letting the two sides pick separately would give one offence two different memories of
   * the same October. It would also be quietly wrong in a way that is easy to miss: an elasticity is
   * only valid for the leverage it was fitted against, so shipping one side's decay beside the other
   * side's elasticity would apply a number to a quantity it never saw.
   */
  let best: { decay: number; rushing: SideFit; receiving: SideFit } | null = null;
  for (const decay of DECAY_CANDIDATES) {
    const rushingFit = fitSideAtDecay(rushing, decay, (totals, position) => redZoneLeverage(totals, position, shape).rushing);
    const receivingFit = fitSideAtDecay(receiving, decay, (totals, position) => redZoneLeverage(totals, position, shape).receiving);
    if (rushingFit === null || receivingFit === null) continue;
    const total = rushingFit.likelihood + receivingFit.likelihood;
    if (best === null || total > best.rushing.likelihood + best.receiving.likelihood) {
      best = { decay, rushing: rushingFit, receiving: receivingFit };
    }
  }

  const touchdownsIn = (observations: readonly PoissonPoint[]): number =>
    observations.reduce((sum, observation) => sum + observation.count, 0);

  return {
    priors: {
      league,
      recencyDecay: best?.decay ?? 1,
      carryShrinkage: CARRY_SHRINKAGE,
      targetShrinkage: TARGET_SHRINKAGE,
      rushingElasticity: best?.rushing.elasticity ?? 0,
      receivingElasticity: best?.receiving.elasticity ?? 0,
    },
    rushingPlayerWeeks: rushing.length,
    receivingPlayerWeeks: receiving.length,
    rushingTouchdowns: touchdownsIn(rushing),
    receivingTouchdowns: touchdownsIn(receiving),
  };
}
