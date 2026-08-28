import type { Position } from "@/domain/player";
import { meanAbsoluteError, rootMeanSquaredError, spearman, type Observation } from "../metrics";
import type { PlayerWeekUsage } from "../usage";
import { lastObservedPriors, predictOpportunity, type OpportunityPriors, type RolePrior } from "./opportunity";

/**
 * FITTING — where every number in the model comes from, and the one place the held-out discipline
 * is enforceable.
 *
 * Nothing here may see a season the model will be evaluated on. That is not a convention, it is the
 * whole basis on which a reported figure means anything: a parameter chosen because it made the
 * 2024 scoreboard look good is a parameter that has read 2024, and the resulting number is a
 * description of 2024 rather than a prediction of anything. `fitOpportunityPriors` therefore takes
 * its seasons explicitly and REFUSES a season it was told to hold out, so the mistake has to be
 * made deliberately rather than by forgetting.
 *
 * Two different estimators, for two different reasons, and the reasons are worth stating because
 * mixing methods otherwise looks like indecision:
 *
 *   - Role priors are DESCRIPTIVE — a position's mean snap share, and its slope of target share
 *     against snap share. There is nothing to optimise; they are what the fit seasons say.
 *   - The decay and the two shrinkage constants are SEARCHED, over a small grid, against next-week
 *     share error. They have no closed form, and a grid over three parameters on data the
 *     evaluation never touches is the honest way to pick them.
 *
 * THE SEARCH MINIMISES ROOT MEAN SQUARED ERROR, not mean absolute error, and the choice is
 * load-bearing rather than cosmetic. Absolute error is minimised by the conditional MEDIAN, and the
 * share distribution is dominated by bench players sitting near zero — so an MAE search rewards
 * predicting near zero for everybody and punishes every ounce of regression toward a role. Measured:
 * against MAE the grid ran to its lowest shrinkage at every extension, which is the search telling
 * you it has been given the wrong question. RMSE is the proper loss for a conditional-mean
 * estimator, which is exactly what a shrinkage model is. Both numbers, and the rank correlation, are
 * reported by the evaluation regardless — the loss chooses the parameters, it does not get to choose
 * what is published.
 *
 * Layer 2's rate regression uses a variance ratio instead, for a reason stated in `efficiency.ts`:
 * next-week TOUCHDOWN error is essentially unlearnable, so a search against it would be fitting
 * noise, while the variance decomposition answers the question actually being asked.
 */

/** Everything a fit may read. `seasons` is the fence, and it is checked rather than trusted. */
export interface FitInput {
  readonly usage: readonly PlayerWeekUsage[];
  readonly positions: ReadonlyMap<string, Position>;
  /** The seasons the fit is allowed to see. Every other season in `usage` is ignored. */
  readonly seasons: readonly number[];
  /**
   * The seasons every reported figure will be measured on. Stated so the fit can REFUSE rather than
   * rely on a caller remembering: a parameter chosen because it made the 2024 scoreboard look good
   * has read 2024, and the resulting number describes 2024 instead of predicting anything. Optional
   * only so a caller with nothing held out has to say nothing rather than say a lie.
   */
  readonly heldOut?: readonly number[];
}

/** Throws when a fit has been pointed at a season it will later be judged on. */
function assertHeldOut({ seasons, heldOut = [] }: FitInput): void {
  const overlap = seasons.filter((season) => heldOut.includes(season));
  if (overlap.length > 0) {
    throw new Error(
      `Season${overlap.length > 1 ? "s" : ""} ${overlap.join(", ")} would be fitted on and then reported on. A parameter that has read the test set is not a parameter.`,
    );
  }
}

/** The shares the fit's objective is measured over — the three that drive fantasy points. */
const SCORED_SHARES = ["snapShare", "targetShare", "carryShare"] as const;

const POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE", "K", "DEF"];

/**
 * The grids. Deliberately coarse: three parameters over a few dozen combinations, because a fine
 * grid searched against a finite fit set buys precision that does not survive to a new season and
 * costs the ability to say plainly what was searched.
 */
const DECAY_GRID = [0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95, 1] as const;
const SEASON_SHRINKAGE_GRID = [0.25, 0.5, 1, 2, 4, 6, 9, 14, 20] as const;
const IN_SEASON_SHRINKAGE_GRID = [0, 0.1, 0.25, 0.5, 1, 2, 3, 5, 8, 12] as const;
/** Team volume is stable and its shrinkage barely moves the objective; one sensible value, stated. */
const TEAM_VOLUME_SHRINKAGE = 4;

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * A position's role prior: its mean snap share, and the slope of each other share against snap
 * share.
 *
 * The slope is a RATIO OF SUMS (total target share over total snap share), not a mean of ratios.
 * The two differ, and the difference matters here: a mean of ratios lets a player who took two
 * snaps and caught a pass claim a target share per snap of 30, and one such row moves a whole
 * position's prior. The ratio of sums weights each player-week by the evidence it carries, which is
 * what "what does a typical snap of this position's playing time buy" actually means.
 *
 * Fitted through the ORIGIN rather than with an intercept, because a player who is not on the field
 * is not being thrown to. An intercept would let the prior promise targets to a player with no
 * snaps, which is the exact failure mode a depth-chart prior exists to avoid.
 */
export function fitRolePriors(input: FitInput): Readonly<Record<Position, RolePrior>> {
  const allowed = new Set(input.seasons);
  const rows = input.usage.filter((row) => allowed.has(row.season));
  const byPosition = new Map<Position, PlayerWeekUsage[]>();
  for (const row of rows) {
    const position = input.positions.get(row.playerId);
    if (position === undefined) continue;
    (byPosition.get(position) ?? byPosition.set(position, []).get(position)!).push(row);
  }

  const empty: RolePrior = { snapShare: 0, targetsPerSnap: 0, carriesPerSnap: 0, passAttemptsPerSnap: 0 };
  return Object.fromEntries(
    POSITIONS.map((position) => {
      const ofPosition = (byPosition.get(position) ?? []).filter((row) => row.snapShare !== null);
      if (ofPosition.length === 0) return [position, empty];
      const totalSnapShare = ofPosition.reduce((sum, row) => sum + row.snapShare!, 0);
      const slope = (field: "targetShare" | "carryShare" | "passAttemptShare"): number =>
        totalSnapShare === 0 ? 0 : ofPosition.reduce((sum, row) => sum + (row[field] ?? 0), 0) / totalSnapShare;
      return [
        position,
        {
          snapShare: mean(ofPosition.map((row) => row.snapShare!)),
          targetsPerSnap: slope("targetShare"),
          carriesPerSnap: slope("carryShare"),
          passAttemptsPerSnap: slope("passAttemptShare"),
        },
      ];
    }),
  ) as Record<Position, RolePrior>;
}

/**
 * League mean team volume per game — what an offence with no record of its own is assumed to run.
 *
 * Taken over DISTINCT team-weeks rather than over player-weeks. The totals ride on every player's
 * row, so averaging player-weeks would weight each team by how many skill players it dressed, and a
 * team that used eleven receivers would count eleven times as much as one that used six.
 */
export function fitLeagueTeamVolume(input: FitInput): OpportunityPriors["leagueTeamVolume"] {
  const allowed = new Set(input.seasons);
  const teamWeeks = new Map<string, PlayerWeekUsage>();
  for (const row of input.usage) {
    if (!allowed.has(row.season)) continue;
    if (row.teamTargets === 0 && row.teamCarries === 0) continue;
    // Team identity is not in the store, but a team-week is uniquely identified by its own volume
    // triple within a season and week — two offences producing identical targets, carries AND
    // attempts in the same week is a collision that costs one sample, not a wrong answer.
    teamWeeks.set(`${row.season}|${row.week}|${row.teamTargets}|${row.teamCarries}|${row.teamPassAttempts}`, row);
  }
  const rows = [...teamWeeks.values()];
  return {
    targets: mean(rows.map((row) => row.teamTargets)),
    carries: mean(rows.map((row) => row.teamCarries)),
    passAttempts: mean(rows.map((row) => row.teamPassAttempts)),
  };
}

/**
 * Every predicted share beside the share that actually happened, produced by replaying each week of
 * each season exactly as `replay` would.
 *
 * Replaying rather than evaluating in one pass is the point: a parameter chosen against a
 * whole-season fit would be chosen for a model that never exists, because the real model sees three
 * weeks in week 4 and thirteen in week 14. The objective has to have the same shape as the job.
 */
export function opportunityObservations(input: FitInput, priors: OpportunityPriors): readonly Observation[] {
  const allowed = new Set(input.seasons);
  const bySeason = new Map<number, PlayerWeekUsage[]>();
  for (const row of input.usage) {
    (bySeason.get(row.season) ?? bySeason.set(row.season, []).get(row.season)!).push(row);
  }

  const observations: Observation[] = [];
  for (const season of [...allowed].sort((a, b) => a - b)) {
    const thisSeason = bySeason.get(season) ?? [];
    // The prior season is shown even when it is not itself a fit season: it is INPUT to a week-1
    // prediction, not a thing being fitted on, exactly as it is at replay time.
    const history = [...(bySeason.get(season - 1) ?? []), ...thisSeason];
    const weeks = [...new Set(thisSeason.map((row) => row.week))].sort((a, b) => a - b);
    for (const week of weeks) {
      const predictions = predictOpportunity(history, { season, week, positions: input.positions }, priors);
      for (const actual of thisSeason) {
        if (actual.week !== week) continue;
        const predicted = predictions.get(actual.playerId);
        if (predicted === undefined) continue;
        for (const field of SCORED_SHARES) {
          const observed = actual[field];
          if (observed === null) continue;
          observations.push({ predicted: predicted[field], actual: observed });
        }
      }
    }
  }
  return observations;
}

/** The three numbers every share comparison is reported as. `null` where the sample cannot answer. */
export interface ShareScore {
  readonly rankCorrelation: number | null;
  readonly meanAbsoluteError: number | null;
  readonly rootMeanSquaredError: number | null;
  readonly sampleSize: number;
}

export function scoreShares(observations: readonly Observation[]): ShareScore {
  return {
    rankCorrelation: spearman(observations),
    meanAbsoluteError: meanAbsoluteError(observations),
    rootMeanSquaredError: rootMeanSquaredError(observations),
    sampleSize: observations.length,
  };
}

export interface OpportunityFit {
  readonly priors: OpportunityPriors;
  /** Every reported number at the chosen point, over the fit seasons. */
  readonly fitted: ShareScore;
  /** The same, for the floor the model must beat: last observed share, no shrinkage. */
  readonly baseline: ShareScore;
}

/**
 * Fits every opportunity parameter on the given seasons and nothing else.
 *
 * The baseline reported beside the fitted score is "last week's share, unshrunk" — the layer-1
 * equivalent of the naive floor. If the model cannot beat that on the seasons it was FITTED on,
 * there is no point measuring it anywhere else, and the number to report is that one.
 */
export function fitOpportunityPriors(input: FitInput): OpportunityFit {
  if (input.seasons.length === 0) {
    throw new Error("An opportunity fit needs at least one season; it cannot be fitted on nothing.");
  }
  assertHeldOut(input);
  const byPosition = fitRolePriors(input);
  const leagueTeamVolume = fitLeagueTeamVolume(input);

  let best: OpportunityPriors | null = null;
  let bestError = Number.POSITIVE_INFINITY;
  for (const recencyDecay of DECAY_GRID) {
    for (const season of SEASON_SHRINKAGE_GRID) {
      for (const inSeason of IN_SEASON_SHRINKAGE_GRID) {
        const candidate: OpportunityPriors = {
          recencyDecay,
          byPosition,
          shrinkage: { season, inSeason, teamVolume: TEAM_VOLUME_SHRINKAGE },
          leagueTeamVolume,
        };
        const error = rootMeanSquaredError(opportunityObservations(input, candidate)) ?? Number.POSITIVE_INFINITY;
        if (error < bestError) {
          bestError = error;
          best = candidate;
        }
      }
    }
  }

  return {
    priors: best!,
    fitted: scoreShares(opportunityObservations(input, best!)),
    baseline: scoreShares(opportunityObservations(input, lastObservedPriors(best!))),
  };
}
