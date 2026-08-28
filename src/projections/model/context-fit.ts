import { gameContextFor } from "../features/context";
import { indexTeamMetrics, type TeamContext } from "../team-context";
import type { SeasonStatLine } from "../lines";
import type { PlayerWeekUsage } from "../usage";
import { teamProduction } from "./line-fit";

/**
 * FITTING THE GAME-CONTEXT ELASTICITIES.
 *
 * Unlike the scheme's, these are fitted against the LEAGUE-RELATIVE rate rather than against layer
 * 2's residual, and the difference is not an inconsistency. Layer 1 already predicts team volume
 * from realised volume, so a scheme fit had to be told what the model already knew. Layer 2 has no
 * opponent input at all — it regresses every rate toward a ROLE mean and has never been shown who
 * anybody played — so there is nothing here to double-count, and the direct regression is the
 * correct and simpler estimator.
 *
 * Two regressors at once, as in the scheme fit: opponent quality and rest are mildly correlated
 * through the schedule (a team on a short week has usually just played a division rival), and
 * separate fits would each claim a little of the other's effect.
 */

export interface ContextElasticity {
  /** How far a 1% softer opponent moves this rate. */
  readonly opponent: number;
  /** How far a 1% longer week moves it. */
  readonly rest: number;
}

export interface GameContextPriors {
  readonly passing: ContextElasticity;
  readonly rushing: ContextElasticity;
  readonly leaguePassingYardsPerAttempt: number;
  readonly leagueRushingYardsPerCarry: number;
}

export interface GameContextFitInput {
  readonly usage: readonly PlayerWeekUsage[];
  readonly history: readonly SeasonStatLine[];
  readonly context: TeamContext;
  readonly seasons: readonly number[];
  readonly heldOut?: readonly number[];
}

interface Point {
  readonly opponent: number;
  readonly rest: number;
  readonly outcome: number;
  readonly weight: number;
}

/** Weighted least squares through the origin on two regressors, by the 2x2 normal equations. */
function solve(points: readonly Point[]): ContextElasticity {
  let xx = 0;
  let xy = 0;
  let yy = 0;
  let xr = 0;
  let yr = 0;
  for (const point of points) {
    if (!Number.isFinite(point.opponent) || !Number.isFinite(point.rest) || !Number.isFinite(point.outcome)) continue;
    xx += point.weight * point.opponent * point.opponent;
    xy += point.weight * point.opponent * point.rest;
    yy += point.weight * point.rest * point.rest;
    xr += point.weight * point.opponent * point.outcome;
    yr += point.weight * point.rest * point.outcome;
  }
  const determinant = xx * yy - xy * xy;
  if (determinant === 0) return { opponent: 0, rest: 0 };
  return { opponent: (xr * yy - yr * xy) / determinant, rest: (yr * xx - xr * xy) / determinant };
}

export function fitGameContextPriors(input: GameContextFitInput): GameContextPriors {
  const overlap = input.seasons.filter((season) => (input.heldOut ?? []).includes(season));
  if (overlap.length > 0) {
    throw new Error(
      `Season${overlap.length > 1 ? "s" : ""} ${overlap.join(", ")} would be fitted on and then reported on. A parameter that has read the test set is not a parameter.`,
    );
  }

  const metrics = indexTeamMetrics(input.context);
  const production = teamProduction(input.usage, input.history, input.context, input.seasons);
  const leaguePassingYardsPerAttempt =
    production.reduce((sum, row) => sum + row.passingYards, 0) / Math.max(1, production.reduce((sum, row) => sum + row.passAttempts, 0));
  const leagueRushingYardsPerCarry =
    production.reduce((sum, row) => sum + row.rushingYards, 0) / Math.max(1, production.reduce((sum, row) => sum + row.carries, 0));

  const passing: Point[] = [];
  const rushing: Point[] = [];
  for (const row of production) {
    const context = gameContextFor(row.team, { season: row.season, week: row.week }, metrics);
    if (context.restRatio === null || context.restRatio <= 0) continue;
    const rest = Math.log(context.restRatio);
    if (context.opponentPassDefence !== null && context.opponentPassDefence > 0 && row.passAttempts > 0 && row.passingYards > 0) {
      passing.push({
        opponent: Math.log(context.opponentPassDefence),
        rest,
        outcome: Math.log(row.passingYards / row.passAttempts / leaguePassingYardsPerAttempt),
        weight: row.passAttempts,
      });
    }
    if (context.opponentRushDefence !== null && context.opponentRushDefence > 0 && row.carries > 0 && row.rushingYards > 0) {
      rushing.push({
        opponent: Math.log(context.opponentRushDefence),
        rest,
        outcome: Math.log(row.rushingYards / row.carries / leagueRushingYardsPerCarry),
        weight: row.carries,
      });
    }
  }

  return {
    passing: solve(passing),
    rushing: solve(rushing),
    leaguePassingYardsPerAttempt,
    leagueRushingYardsPerCarry,
  };
}
