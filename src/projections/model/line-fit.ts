import type { SeasonStatLine } from "../lines";
import { lineComposite, lineWindow, type LineLeagueMeans } from "../features/line";
import { PBP_METRICS } from "../nflverse/pbp";
import { indexTeamMetrics, type TeamContext } from "../team-context";
import { LAST_POSSIBLE_WEEK } from "../store";
import type { PlayerWeekUsage } from "../usage";

/**
 * FITTING THE LINE COMPOSITE'S TWO ELASTICITIES — on the fit seasons and nowhere else.
 *
 * The composite says a line is 8% better than average at run blocking. Nothing in that sentence
 * says how much better the RUNNING is, and guessing "8%" would be a claim the data has never been
 * asked about. The elasticity is that answer, and it is measured: a regression of log actual
 * rushing yards per carry on log composite, through the origin, over team-weeks of 2021 and 2022.
 *
 * THROUGH THE ORIGIN, because a composite of exactly 1 is by construction an average line, and an
 * average line must predict an average rate. An intercept would let the fit conclude that the
 * league as a whole runs better than the league.
 *
 * AT TEAM LEVEL rather than player level. The composite is a claim about an offence, and a
 * player-level regression would attribute a back's own talent to the five men in front of him
 * wherever the two happened to coincide — which they do, since good lines are on good teams.
 * Weighted by carries, so a team-week of thirty carries counts more than one of eight.
 *
 * A NEGATIVE ELASTICITY IS A REAL AND PUBLISHABLE RESULT. If better-blocking lines turn out not to
 * produce better rates out of sample, the number says so, the ablation says so, and the feature
 * does not ship. That is the point of measuring it rather than asserting it.
 */

export interface LinePriors {
  readonly league: LineLeagueMeans;
  /** How much a 1% better run-blocking composite moves predicted rushing yards per carry. */
  readonly rushingYardsElasticity: number;
  /** The same for pass protection against passing yards per attempt. */
  readonly passingYardsElasticity: number;
  /** League mean team rates, the ratios in the regression are taken against. */
  readonly leagueRushingYardsPerCarry: number;
  readonly leaguePassingYardsPerAttempt: number;
}

export interface LineFitInput {
  readonly usage: readonly PlayerWeekUsage[];
  readonly history: readonly SeasonStatLine[];
  readonly context: TeamContext;
  /** The seasons the fit may read. Every other season present is ignored. */
  readonly seasons: readonly number[];
  readonly heldOut?: readonly number[];
}

/** One offence's realised production for one week — the left-hand side of both regressions. */
interface TeamWeekProduction {
  readonly season: number;
  readonly week: number;
  readonly team: string;
  readonly carries: number;
  readonly rushingYards: number;
  readonly passAttempts: number;
  readonly passingYards: number;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** The league means the composite's ratios are taken against, over the fit seasons' team-weeks. */
export function fitLineLeagueMeans(context: TeamContext, seasons: readonly number[]): LineLeagueMeans {
  const allowed = new Set(seasons);
  const of = (metric: string): number =>
    mean(context.teamObservations.filter((row) => row.metric === metric && allowed.has(row.season)).map((row) => row.value));
  return {
    adjustedLineYards: of(PBP_METRICS.adjustedLineYards),
    stuffedRate: of(PBP_METRICS.stuffedRate),
    sackRateAllowed: of(PBP_METRICS.sackRateAllowed),
  };
}

/**
 * Every offence's carries, rushing yards, attempts and passing yards, week by week.
 *
 * Built by joining each player's outcome to the offence he was in THAT WEEK rather than to the one
 * he ended the season on. A back traded in October contributed to two teams, and crediting all of
 * it to the second would corrupt both.
 */
export function teamProduction(
  usage: readonly PlayerWeekUsage[],
  history: readonly SeasonStatLine[],
  context: TeamContext,
  seasons: readonly number[],
): readonly TeamWeekProduction[] {
  const allowed = new Set(seasons);
  const teamOf = new Map<string, string>();
  for (const edge of context.playerTeams) teamOf.set(`${edge.season}|${edge.week}|${edge.playerId}`, edge.team);

  const lines = new Map<string, SeasonStatLine>();
  for (const row of history) lines.set(`${row.season}|${row.line.week}|${row.line.playerId}`, row);

  const totals = new Map<string, { season: number; week: number; team: string; carries: number; rushingYards: number; passAttempts: number; passingYards: number }>();
  for (const row of usage) {
    if (!allowed.has(row.season)) continue;
    const playerKey = `${row.season}|${row.week}|${row.playerId}`;
    const team = teamOf.get(playerKey);
    const line = lines.get(playerKey);
    // A season with no published weekly stats file has no carry or attempt count to add up
    // (`usage.ts` leaves them `null` rather than zero); every season this fit runs over has one.
    if (team === undefined || line === undefined || row.carries === null || row.passAttempts === null) continue;
    const key = `${row.season}|${row.week}|${team}`;
    const running =
      totals.get(key) ??
      totals.set(key, { season: row.season, week: row.week, team, carries: 0, rushingYards: 0, passAttempts: 0, passingYards: 0 }).get(key)!;
    running.carries += row.carries;
    running.rushingYards += line.line.rushingYards;
    running.passAttempts += row.passAttempts;
    running.passingYards += line.line.passingYards;
  }
  return [...totals.values()];
}

/** Weighted ordinary least squares through the origin. `null` when nothing varies. */
function slopeThroughOrigin(points: readonly { readonly x: number; readonly y: number; readonly weight: number }[]): number | null {
  let numerator = 0;
  let denominator = 0;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    numerator += point.weight * point.x * point.y;
    denominator += point.weight * point.x * point.x;
  }
  return denominator === 0 ? null : numerator / denominator;
}

/**
 * Fits both elasticities. Throws if pointed at a season the model will later be judged on.
 *
 * The composite for a team-week is computed from the weeks BEFORE it, exactly as the model computes
 * it at prediction time. Fitting against a composite that included the week being predicted would
 * measure a correlation the model can never exploit, and would produce an elasticity far too large.
 */
export function fitLinePriors(input: LineFitInput): LinePriors {
  const overlap = input.seasons.filter((season) => (input.heldOut ?? []).includes(season));
  if (overlap.length > 0) {
    throw new Error(
      `Season${overlap.length > 1 ? "s" : ""} ${overlap.join(", ")} would be fitted on and then reported on. A parameter that has read the test set is not a parameter.`,
    );
  }

  const league = fitLineLeagueMeans(input.context, input.seasons);
  const metrics = indexTeamMetrics(input.context);
  const production = teamProduction(input.usage, input.history, input.context, input.seasons);
  const leagueRushingYardsPerCarry =
    production.reduce((sum, row) => sum + row.rushingYards, 0) / Math.max(1, production.reduce((sum, row) => sum + row.carries, 0));
  const leaguePassingYardsPerAttempt =
    production.reduce((sum, row) => sum + row.passingYards, 0) / Math.max(1, production.reduce((sum, row) => sum + row.passAttempts, 0));

  const rushing: { x: number; y: number; weight: number }[] = [];
  const passing: { x: number; y: number; weight: number }[] = [];
  for (const row of production) {
    const weeks = lineWindow(row.season, row.week, LAST_POSSIBLE_WEEK);
    const composite = lineComposite({ team: row.team, weeks, metrics, league });
    if (composite.runBlocking !== null && composite.runBlocking > 0 && row.carries > 0 && row.rushingYards > 0) {
      rushing.push({
        x: Math.log(composite.runBlocking),
        y: Math.log(row.rushingYards / row.carries / leagueRushingYardsPerCarry),
        weight: row.carries,
      });
    }
    if (composite.passProtection !== null && composite.passProtection > 0 && row.passAttempts > 0 && row.passingYards > 0) {
      passing.push({
        x: Math.log(composite.passProtection),
        y: Math.log(row.passingYards / row.passAttempts / leaguePassingYardsPerAttempt),
        weight: row.passAttempts,
      });
    }
  }

  return {
    league,
    // A composite that never varies leaves the slope undetermined, and zero is the honest
    // stand-in: it says the feature moves nothing, which is exactly what no evidence supports.
    rushingYardsElasticity: slopeThroughOrigin(rushing) ?? 0,
    passingYardsElasticity: slopeThroughOrigin(passing) ?? 0,
    leagueRushingYardsPerCarry,
    leaguePassingYardsPerAttempt,
  };
}
