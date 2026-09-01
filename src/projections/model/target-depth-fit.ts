import type { Position } from "@/domain/player";
import {
  targetDepthRatio,
  targetDepthTotals,
  type TargetDepthLeague,
  type TargetDepthPriors,
  type TargetDepthTotals,
} from "../features/target-depth";
import type { SeasonStatLine } from "../lines";
import type { PlayerWeekUsage } from "../usage";
import { predictRates, type EfficiencyPriors } from "./efficiency";
import { fitLogLinkElasticity, logLinkLikelihood, type LogLinkPoint } from "./log-link";

/**
 * FITTING TARGET DEPTH AGAINST WHAT LAYER 2 ALREADY KNOWS.
 *
 * This is the group where fitting against the raw outcome would flatter the feature most, and the
 * scheme group's docblock records why that trap is worth naming out loud. Regressing yards per
 * target on depth of target would find a very strong relationship and would be measuring almost
 * nothing new: layer 2 already predicts a receiver's yards per target from his own past yards per
 * target, which is itself mostly a consequence of how deep he is thrown to. Fitting there would count
 * the same effect twice and the elasticity would come out far too large.
 *
 * So the EXPOSURE handed to the estimator is layer 2's own prediction for that player-week, replayed
 * from the weeks before it exactly as the model would. What is being fitted is therefore the
 * residual: knowing what the model already thinks, does depth of target say anything more?
 *
 * REPLAYED WEEK BY WEEK, not computed once. `predictRates` is a point-in-time function and calling
 * it once over the whole fit period would hand the fit a rate that had read every week it was
 * explaining. Eighteen calls a season is a few seconds and the alternative is a number nobody can
 * trust.
 */

export interface TargetDepthFitInput {
  readonly usage: readonly PlayerWeekUsage[];
  readonly history: readonly SeasonStatLine[];
  readonly positions: ReadonlyMap<string, Position>;
  readonly efficiency: EfficiencyPriors;
  readonly seasons: readonly number[];
  readonly heldOut?: readonly number[];
}

export interface TargetDepthFitReport {
  readonly priors: TargetDepthPriors;
  readonly playerWeeks: number;
  /** Targets the fit rests on, which is the sample size that matters for a per-target rate. */
  readonly targets: number;
}

/**
 * The prior a player's own depth is shrunk toward his position's by, in targets, FIXED not fitted.
 *
 * See `log-link.ts`: the prior and the elasticity are a ridge, so only their ratio is identified and
 * the prior is a choice of units. A hundred and twenty targets is a number one receiver's season,
 * which is the scale at which a depth chart stops being a small sample.
 */
const TARGET_SHRINKAGE = 120;

/** Candidate decays. 1 is a flat mean and is kept in, so the data may say depth does not drift. */
const DECAY_CANDIDATES: readonly number[] = [1, 0.95, 0.9, 0.8, 0.7];

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * Each position's mean depth of target over the fit seasons.
 *
 * A RATIO OF SUMS: total air yards over total targets carrying one, never a mean of per-week
 * averages. A receiver with one target, and that one a fifty-yard heave, has a per-week average
 * depth of fifty, and letting that stand beside a hundred-target season would move a whole
 * position's prior on one throw.
 */
export function fitTargetDepthLeague(
  usage: readonly PlayerWeekUsage[],
  positions: ReadonlyMap<string, Position>,
  seasons: readonly number[],
): TargetDepthLeague {
  const allowed = new Set(seasons);
  const totals = new Map<Position, { airYards: number; targets: number }>(
    POSITIONS.map((position) => [position, { airYards: 0, targets: 0 }]),
  );
  for (const row of usage) {
    if (!allowed.has(row.season) || row.touches === null) continue;
    const position = positions.get(row.playerId);
    if (position === undefined) continue;
    const running = totals.get(position)!;
    running.airYards += row.touches.airYards;
    running.targets += row.touches.airYardTargets;
  }
  return Object.fromEntries(
    POSITIONS.map((position) => {
      const running = totals.get(position)!;
      return [position, running.targets === 0 ? 0 : running.airYards / running.targets];
    }),
  ) as TargetDepthLeague;
}

/** One player-week of evidence, before a candidate window has turned his past into a ratio. */
interface DepthObservation {
  readonly rows: readonly PlayerWeekUsage[];
  readonly season: number;
  readonly week: number;
  readonly position: Position;
  readonly targets: number;
  readonly receptions: number;
  readonly receivingYards: number;
  /** Layer 2's own prediction for this week, which is what the elasticity is a residual against. */
  readonly predictedReceptions: number;
  readonly predictedYards: number;
}

/** What one candidate window found: the two elasticities and how well the pair fit. */
interface DepthFit {
  readonly decay: number;
  readonly yardsElasticity: number;
  readonly receptionsElasticity: number;
  readonly likelihood: number;
}

/**
 * Replays the fit seasons a week at a time, collecting what layer 2 predicted beside what happened.
 *
 * Only weeks with at least one target contribute. A receiver who was not thrown to has no depth to
 * explain, and including him would add a row whose outcome and exposure are both zero — which the
 * estimator would carry through every candidate window as a row that says nothing.
 */
function observationsFor(input: TargetDepthFitInput): readonly DepthObservation[] {
  const bySeason = new Map<number, PlayerWeekUsage[]>();
  for (const row of input.usage) {
    (bySeason.get(row.season) ?? bySeason.set(row.season, []).get(row.season)!).push(row);
  }
  const byPlayer = new Map<string, PlayerWeekUsage[]>();
  for (const row of input.usage) {
    (byPlayer.get(row.playerId) ?? byPlayer.set(row.playerId, []).get(row.playerId)!).push(row);
  }
  const lines = new Map<string, SeasonStatLine>();
  for (const row of input.history) lines.set(`${row.season}|${row.line.week}|${row.line.playerId}`, row);

  const observations: DepthObservation[] = [];
  for (const season of [...input.seasons].sort((a, b) => a - b)) {
    const thisSeason = bySeason.get(season) ?? [];
    // The prior season is INPUT to a week-1 prediction rather than a thing being fitted on, matching
    // `fitSchemePriors`' own treatment of it.
    const usageHistory = [...(bySeason.get(season - 1) ?? []), ...thisSeason];
    for (const week of [...new Set(thisSeason.map((row) => row.week))].sort((a, b) => a - b)) {
      const rates = predictRates(input.history, usageHistory, { season, week, positions: input.positions }, input.efficiency);
      for (const row of thisSeason) {
        // `null` targets is a season whose weekly stats file was never published, not a week with
        // none — `usage.ts`'s withheld-is-null seam. Neither carries a target-depth observation.
        if (row.week !== week || row.targets === null || row.targets <= 0) continue;
        const targets = row.targets;
        const position = input.positions.get(row.playerId);
        const line = lines.get(`${season}|${week}|${row.playerId}`);
        const playerRates = rates.get(row.playerId);
        const rows = byPlayer.get(row.playerId);
        if (position === undefined || line === undefined || playerRates === undefined || rows === undefined) continue;
        observations.push({
          rows,
          season,
          week,
          position,
          targets,
          receptions: line.line.receptions,
          receivingYards: line.line.receivingYards,
          predictedReceptions: targets * playerRates.receptionsPerTarget,
          predictedYards: targets * playerRates.receivingYardsPerTarget,
        });
      }
    }
  }
  return observations;
}

function pointsFor(
  observations: readonly DepthObservation[],
  ratios: readonly (number | null)[],
  outcome: (observation: DepthObservation) => number,
  exposure: (observation: DepthObservation) => number,
): readonly LogLinkPoint[] {
  const points: LogLinkPoint[] = [];
  for (const [index, observation] of observations.entries()) {
    const ratio = ratios[index];
    if (ratio === null || ratio === undefined || !(ratio > 0)) continue;
    const predicted = exposure(observation);
    if (!(predicted > 0)) continue;
    points.push({ outcome: outcome(observation), exposure: predicted, logRatio: Math.log(ratio) });
  }
  return points;
}

/**
 * Fits both elasticities, the shrinkage and the decay. Throws if pointed at a held-out season.
 *
 * The window is chosen on the two rates' likelihoods ADDED TOGETHER, exactly as red-zone leverage's
 * is, and for the same reason: an elasticity is only valid for the ratio it was fitted against, so
 * shipping one rate's preferred window beside the other rate's elasticity would apply a number to a
 * quantity it never saw. The yards term dominates that sum by two orders of magnitude, because a
 * week of receiving yards is a hundred and a week of receptions is five. That is the right weighting
 * rather than a defect of it: yards are where the points are, and a window chosen to fit catches
 * would be optimising the smaller half of the answer.
 */
export function fitTargetDepthPriors(input: TargetDepthFitInput): TargetDepthFitReport {
  const overlap = input.seasons.filter((season) => (input.heldOut ?? []).includes(season));
  if (overlap.length > 0) {
    throw new Error(
      `Season${overlap.length > 1 ? "s" : ""} ${overlap.join(", ")} would be fitted on and then reported on. A parameter that has read the test set is not a parameter.`,
    );
  }

  const league = fitTargetDepthLeague(input.usage, input.positions, input.seasons);
  const observations = observationsFor(input);

  let best: DepthFit | null = null;
  for (const decay of DECAY_CANDIDATES) {
    const totals: TargetDepthTotals[] = observations.map((observation) =>
      targetDepthTotals(observation.rows, { season: observation.season, week: observation.week, decay }),
    );
    const priors: TargetDepthPriors = {
      league,
      recencyDecay: decay,
      shrinkage: TARGET_SHRINKAGE,
      yardsElasticity: 0,
      receptionsElasticity: 0,
    };
    const ratios = totals.map((total, index) => targetDepthRatio(total, observations[index]!.position, priors));
    const yards = pointsFor(observations, ratios, (o) => o.receivingYards, (o) => o.predictedYards);
    const receptions = pointsFor(observations, ratios, (o) => o.receptions, (o) => o.predictedReceptions);
    if (yards.length === 0 || receptions.length === 0) continue;
    const yardsElasticity = fitLogLinkElasticity(yards);
    const receptionsElasticity = fitLogLinkElasticity(receptions);
    const likelihood = logLinkLikelihood(yards, yardsElasticity) + logLinkLikelihood(receptions, receptionsElasticity);
    if (best === null || likelihood > best.likelihood) {
      best = { decay, yardsElasticity, receptionsElasticity, likelihood };
    }
  }

  return {
    priors: {
      league,
      recencyDecay: best?.decay ?? 1,
      shrinkage: TARGET_SHRINKAGE,
      yardsElasticity: best?.yardsElasticity ?? 0,
      receptionsElasticity: best?.receptionsElasticity ?? 0,
    },
    playerWeeks: observations.length,
    targets: observations.reduce((sum, observation) => sum + observation.targets, 0),
  };
}
