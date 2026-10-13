import type { Position } from "@research-ts/domain/player";
import { schemeEstimate, schemeRatios, type SchemeLeagueMeans } from "../features/scheme";
import { PBP_METRICS } from "../nflverse/pbp";
import { LAST_POSSIBLE_WEEK } from "../store";
import { indexTeamMetrics, type TeamContext } from "../team-context";
import type { PlayerWeekUsage } from "../usage";
import { predictOpportunity, type OpportunityPriors } from "./opportunity";

/**
 * FITTING THE SCHEME MULTIPLIERS AGAINST WHAT LAYER 1 ALREADY KNOWS.
 *
 * This is the part of the task that is easy to get wrong in a way that flatters the feature.
 * Regressing team volume on pace would find a strong relationship and would be measuring almost
 * nothing new: layer 1 predicts team volume from the team's own realised volume, which is already
 * mostly a function of its pace. Fitting there and then multiplying would count the same effect
 * twice, and the elasticity would be far too large.
 *
 * So the left-hand side here is the RESIDUAL — log of actual team volume over the volume layer 1
 * predicted, replayed week by week exactly as `opportunityObservations` replays its own objective.
 * The question being asked is the only one worth asking: knowing what the model already thinks,
 * does situation-neutral pace or pass rate tell us anything more?
 *
 * TWO VARIABLES AT ONCE, not two univariate fits. Tempo and pass lean are correlated — offences
 * that throw play faster, because an incompletion stops the clock — and fitting them separately
 * would credit each with the other's effect and double-count when both were applied.
 */

export interface SchemeVolumeElasticity {
  /** How far a 1% faster tempo moves this volume. */
  readonly tempo: number;
  /** How far a 1% higher neutral pass rate moves this volume. */
  readonly passLean: number;
}

export interface SchemePriors {
  readonly league: SchemeLeagueMeans;
  readonly targets: SchemeVolumeElasticity;
  readonly carries: SchemeVolumeElasticity;
  readonly passAttempts: SchemeVolumeElasticity;
}

export interface SchemeFitInput {
  readonly usage: readonly PlayerWeekUsage[];
  readonly positions: ReadonlyMap<string, Position>;
  readonly context: TeamContext;
  readonly opportunity: OpportunityPriors;
  readonly seasons: readonly number[];
  readonly heldOut?: readonly number[];
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The league means every scheme ratio is taken against, over the fit seasons' team-weeks. */
export function fitSchemeLeagueMeans(context: TeamContext, seasons: readonly number[]): SchemeLeagueMeans {
  const allowed = new Set(seasons);
  const of = (metric: string): number =>
    mean(context.teamObservations.filter((row) => row.metric === metric && allowed.has(row.season)).map((row) => row.value));
  return {
    paceSecondsPerPlay: of(PBP_METRICS.paceSecondsPerPlay),
    passRate: of(PBP_METRICS.passRate),
    passRateOverExpected: of(PBP_METRICS.passRateOverExpected),
  };
}

/** One observation of the residual regression: two regressors and the log residual they explain. */
interface ResidualPoint {
  readonly tempo: number;
  readonly passLean: number;
  readonly residual: number;
  readonly weight: number;
}

/**
 * Weighted least squares through the origin on two regressors, by the 2x2 normal equations.
 *
 * Written out rather than pulled from a library: it is six sums and one determinant, and a
 * dependency whose conventions nobody here knows would be a worse trade than eight lines. Returns
 * zero elasticities when the system is singular, which says "the data cannot separate these two"
 * rather than inventing a number that happens to satisfy it.
 */
function solveTwoVariable(points: readonly ResidualPoint[]): SchemeVolumeElasticity {
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let xr = 0;
  let yr = 0;
  for (const point of points) {
    if (!Number.isFinite(point.tempo) || !Number.isFinite(point.passLean) || !Number.isFinite(point.residual)) continue;
    xx += point.weight * point.tempo * point.tempo;
    xy += point.weight * point.tempo * point.passLean;
    yy += point.weight * point.passLean * point.passLean;
    xr += point.weight * point.tempo * point.residual;
    yr += point.weight * point.passLean * point.residual;
  }
  const determinant = xx * yy - xy * xy;
  if (determinant === 0) return { tempo: 0, passLean: 0 };
  return { tempo: (xr * yy - yr * xy) / determinant, passLean: (yr * xx - xr * xy) / determinant };
}

/** The three volumes layer 3 multiplies a share by, and how each is read off a usage row. */
const VOLUMES = ["teamTargets", "teamCarries", "teamPassAttempts"] as const;
type VolumeField = (typeof VOLUMES)[number];

/**
 * Fits all three volumes' elasticities. Throws if pointed at a season it will later be judged on.
 *
 * The predicted team volume for a team-week is taken as the MEDIAN across that team's players
 * rather than any one of them. Layer 1 predicts a team volume per player, from the volume rows his
 * own history carries, and a player who arrived mid-season carries his old offence's — so one
 * player's answer is occasionally somebody else's team. The median is unmoved by that; a mean is not.
 */
export function fitSchemePriors(input: SchemeFitInput): SchemePriors {
  const overlap = input.seasons.filter((season) => (input.heldOut ?? []).includes(season));
  if (overlap.length > 0) {
    throw new Error(
      `Season${overlap.length > 1 ? "s" : ""} ${overlap.join(", ")} would be fitted on and then reported on. A parameter that has read the test set is not a parameter.`,
    );
  }

  const league = fitSchemeLeagueMeans(input.context, input.seasons);
  const metrics = indexTeamMetrics(input.context);
  const teamOf = new Map(input.context.playerTeams.map((edge) => [`${edge.season}|${edge.week}|${edge.playerId}`, edge.team] as const));

  const bySeason = new Map<number, PlayerWeekUsage[]>();
  for (const row of input.usage) {
    (bySeason.get(row.season) ?? bySeason.set(row.season, []).get(row.season)!).push(row);
  }

  const points: Record<VolumeField, ResidualPoint[]> = { teamTargets: [], teamCarries: [], teamPassAttempts: [] };
  for (const season of [...input.seasons].sort((a, b) => a - b)) {
    const thisSeason = bySeason.get(season) ?? [];
    // The prior season is INPUT to a week-1 prediction, not a thing being fitted on — the same
    // treatment `opportunityObservations` gives it, and for the same reason.
    const history = [...(bySeason.get(season - 1) ?? []), ...thisSeason];
    for (const week of [...new Set(thisSeason.map((row) => row.week))].sort((a, b) => a - b)) {
      const predictions = predictOpportunity(history, { season, week, positions: input.positions }, input.opportunity);
      const byTeam = new Map<string, { predicted: Record<VolumeField, number[]>; actual: PlayerWeekUsage }>();
      for (const row of thisSeason) {
        if (row.week !== week) continue;
        const team = teamOf.get(`${season}|${week}|${row.playerId}`);
        const predicted = predictions.get(row.playerId);
        if (team === undefined || predicted === undefined) continue;
        const entry =
          byTeam.get(team) ??
          byTeam.set(team, { predicted: { teamTargets: [], teamCarries: [], teamPassAttempts: [] }, actual: row }).get(team)!;
        for (const field of VOLUMES) entry.predicted[field].push(predicted[field]);
      }

      for (const [team, entry] of byTeam) {
        const estimate = schemeEstimate({ team, season, week, metrics, league, lastPossibleWeek: LAST_POSSIBLE_WEEK });
        const ratios = schemeRatios(estimate, league);
        if (ratios.tempo === null || ratios.passLean === null || ratios.tempo <= 0 || ratios.passLean <= 0) continue;
        for (const field of VOLUMES) {
          const sorted = [...entry.predicted[field]].sort((a, b) => a - b);
          const predicted = sorted[Math.floor(sorted.length / 2)] ?? 0;
          const actual = entry.actual[field];
          // `null` is a season whose team volumes were never published (`usage.ts`'s withheld-is-null
          // seam), which is not a residual this fit can measure. Every season it runs over has them.
          if (actual === null || predicted <= 0 || actual <= 0) continue;
          points[field].push({
            tempo: Math.log(ratios.tempo),
            passLean: Math.log(ratios.passLean),
            residual: Math.log(actual / predicted),
            weight: actual,
          });
        }
      }
    }
  }

  return {
    league,
    targets: solveTwoVariable(points.teamTargets),
    carries: solveTwoVariable(points.teamCarries),
    passAttempts: solveTwoVariable(points.teamPassAttempts),
  };
}
