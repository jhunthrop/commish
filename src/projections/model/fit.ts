import type { Position, StatLine } from "@/domain/player";
import type { SeasonStatLine } from "../lines";
import { meanAbsoluteError, rootMeanSquaredError, spearman, type Observation } from "../metrics";
import type { PlayerWeekUsage } from "../usage";
import { experienceCohort, opportunitiesFor, RATES, type EfficiencyPriors, type RateName } from "./efficiency";
import { lastObservedPriors, predictOpportunity, type OpportunityPriors, type OpportunityShrinkage, type RolePrior } from "./opportunity";

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

/**
 * THE SHARES THE FIT'S OBJECTIVE IS MEASURED OVER: all four the model emits.
 *
 * It was three until Phase 3. Pass-attempt share was left out, and it was the one share whose
 * held-out rank correlation came in below the floor — 0.496 against 0.858 — which is not a
 * coincidence. A search cannot improve what it is never scored on, and a model that emits four
 * numbers while being fitted on three is being told that one of its outputs does not matter.
 *
 * The defect was found by reading the held-out numbers, and fixing it there and then would have
 * been tuning against the test set. It is corrected here instead, in a phase of its own, on the fit
 * seasons, and then measured — which is the whole reason model v1 named it and deliberately left
 * it alone.
 */
const SCORED_SHARES = ["snapShare", "targetShare", "carryShare", "passAttemptShare"] as const;

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
  const teamWeeks = new Map<string, { readonly targets: number; readonly carries: number; readonly passAttempts: number }>();
  for (const row of input.usage) {
    if (!allowed.has(row.season)) continue;
    // A season whose weekly stats file was never published carries no team totals at all, and there
    // is nothing to average — `usage.ts` leaves them `null` rather than zero so this reads as the
    // absence it is. Every season this fit window covers publishes them.
    if (row.teamTargets === null || row.teamCarries === null || row.teamPassAttempts === null) continue;
    if (row.teamTargets === 0 && row.teamCarries === 0) continue;
    // Team identity is not in the store, but a team-week is uniquely identified by its own volume
    // triple within a season and week — two offences producing identical targets, carries AND
    // attempts in the same week is a collision that costs one sample, not a wrong answer.
    teamWeeks.set(`${row.season}|${row.week}|${row.teamTargets}|${row.teamCarries}|${row.teamPassAttempts}`, {
      targets: row.teamTargets,
      carries: row.teamCarries,
      passAttempts: row.teamPassAttempts,
    });
  }
  const rows = [...teamWeeks.values()];
  return {
    targets: mean(rows.map((row) => row.targets)),
    carries: mean(rows.map((row) => row.carries)),
    passAttempts: mean(rows.map((row) => row.passAttempts)),
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

/**
 * `opportunityObservations`, narrowed to one position — the instrument the WR/TE share-shrinkage
 * refit is scored against.
 *
 * Filtering `input.positions` down to one position before replaying is enough: `predictOpportunity`
 * already skips any player its `positions` map does not resolve, and `opportunityObservations` only
 * ever matches an actual row against a prediction that survived that filter — so a player of any
 * other position simply produces no observation, without either function needing to know why.
 */
export function opportunityObservationsForPosition(input: FitInput, priors: OpportunityPriors, position: Position): readonly Observation[] {
  const narrowed: FitInput = { ...input, positions: new Map([...input.positions].filter(([, value]) => value === position)) };
  return opportunityObservations(narrowed, priors);
}

/**
 * ONE POSITION'S OWN SHARE SHRINKAGE — the WR/TE starter-band recalibration.
 *
 * `fitOpportunityPriors`'s grid search chooses `season`/`inSeason` to minimise the POOLED error
 * across every position at once; a position whose own error surface has a different minimum is
 * masked by that pooling. This is the same search, over the same grids and the same fit window, run
 * again with the objective narrowed to one position — `recencyDecay` and `teamVolume` are held at
 * `basePriors`' already-fitted values rather than re-searched, because decay is a property of how
 * fast a role changes in-season, not of which position is being scored, and re-searching it here
 * would be hunting for a second explanation of the same signal `fitOpportunityPriors` already spent.
 *
 * Never widens past `basePriors`' own fit window — `opportunityObservationsForPosition` replays
 * exactly `input.seasons`, and `fitted.ts`'s provenance docblock states which seasons those were.
 */
export function fitShareShrinkageForPosition(input: FitInput, position: Position, basePriors: OpportunityPriors): OpportunityShrinkage {
  let best: OpportunityShrinkage = basePriors.shrinkage;
  let bestError = Number.POSITIVE_INFINITY;
  for (const season of SEASON_SHRINKAGE_GRID) {
    for (const inSeason of IN_SEASON_SHRINKAGE_GRID) {
      const candidate: OpportunityPriors = { ...basePriors, shrinkage: { season, inSeason, teamVolume: basePriors.shrinkage.teamVolume } };
      const error = rootMeanSquaredError(opportunityObservationsForPosition(input, candidate, position)) ?? Number.POSITIVE_INFINITY;
      if (error < bestError) {
        bestError = error;
        best = candidate.shrinkage;
      }
    }
  }
  return best;
}

/**
 * THE EFFICIENCY FIT — position mean rates, and how many opportunities of prior each rate is worth.
 *
 * A VARIANCE RATIO rather than a grid search, and the reason is specific rather than stylistic.
 * The direct objective for layer 1 (next-week share error) is learnable, so a search against it
 * finds something. Next-week TOUCHDOWN error is not: touchdowns are close to a coin flip at the
 * weekly level, so a search would be fitting noise and would land wherever the noise happened to
 * fall. The variance decomposition asks the question actually being asked — how much of the spread
 * between players is real difference and how much is sampling — and answers it in closed form.
 *
 * The model behind it is the standard one: a player's true rate is drawn from a population with
 * variance tau-squared, and his observed rate over n opportunities carries sampling variance
 * sigma-squared over n. The shrinkage constant is then sigma-squared over tau-squared, in
 * OPPORTUNITIES, and that is what makes the constants comparable across rates — which is what makes
 * the touchdown assertion an apples-to-apples measurement rather than an assertion.
 */

/** Weekly outcomes joined to weekly opportunities. Only weeks carrying both can teach a rate. */
export interface EfficiencyFitInput extends FitInput {
  readonly history: readonly SeasonStatLine[];
}

/**
 * The fewest opportunities a player must have before his own rate is allowed to inform the
 * BETWEEN-player variance. Below this his observed rate is almost entirely sampling noise, and
 * including him inflates the apparent spread between players — which would shrink the regression
 * constant, which is the wrong direction. Twenty-five is roughly two games of a starter's targets.
 */
const MIN_OPPORTUNITIES_FOR_SPREAD = 25;

/**
 * The largest regression constant reported, in opportunities. Reached only when the measurement
 * finds NO real spread between players at all — the honest reading of which is "regress this rate
 * entirely to its role", and a finite number says that without producing an infinity that would
 * propagate into every composed stat line.
 */
const MAX_REGRESSION = 10_000;

interface RateWeek {
  readonly playerId: string;
  readonly position: Position;
  readonly opportunities: number;
  readonly rate: number;
}

function rateWeeks(input: EfficiencyFitInput, name: RateName): readonly RateWeek[] {
  const allowed = new Set(input.seasons);
  const lines = new Map<string, StatLine>();
  for (const row of input.history) {
    if (!allowed.has(row.season)) continue;
    lines.set(`${row.season}|${row.line.week}|${row.line.playerId}`, row.line);
  }
  const spec = RATES[name];
  const weeks: RateWeek[] = [];
  for (const row of input.usage) {
    if (!allowed.has(row.season)) continue;
    const line = lines.get(`${row.season}|${row.week}|${row.playerId}`);
    const position = input.positions.get(row.playerId);
    if (line === undefined || position === undefined) continue;
    // `null` is a week whose opportunity count was never published, not a week of no opportunity —
    // see `opportunitiesFor`'s own docblock. Either way it is not a rate observation.
    const opportunities = opportunitiesFor(row, spec.denominator);
    if (opportunities === null || opportunities <= 0) continue;
    weeks.push({ playerId: row.playerId, position, opportunities, rate: line[spec.numerator] / opportunities });
  }
  return weeks;
}

/** A player's own rate over the whole fit window, and how many opportunities it rests on. */
interface PlayerRate {
  readonly position: Position;
  readonly opportunities: number;
  readonly rate: number;
  readonly weeks: readonly RateWeek[];
}

function byPlayer(weeks: readonly RateWeek[]): readonly PlayerRate[] {
  const grouped = new Map<string, RateWeek[]>();
  for (const week of weeks) {
    (grouped.get(week.playerId) ?? grouped.set(week.playerId, []).get(week.playerId)!).push(week);
  }
  return [...grouped.values()].map((playerWeeks) => {
    const opportunities = playerWeeks.reduce((sum, week) => sum + week.opportunities, 0);
    const numerator = playerWeeks.reduce((sum, week) => sum + week.rate * week.opportunities, 0);
    return { position: playerWeeks[0]!.position, opportunities, rate: numerator / opportunities, weeks: playerWeeks };
  });
}

/**
 * How many opportunities of prior one rate is worth: sampling variance over between-player variance.
 *
 * Sampling variance comes from WITHIN-player weekly deviations, weighted by the opportunities each
 * week carried — a nine-target week says more about a receiver's catch rate than a one-target week
 * does, and an unweighted variance would let the one-target weeks dominate.
 *
 * Between-player variance is measured WITHIN each position and then pooled. Measuring it across
 * positions would count the gap between a quarterback's and a receiver's rushing efficiency as
 * evidence that players differ, inflate the spread, and shrink the constant — regressing every rate
 * less than it should be, which is the failure this whole layer exists to prevent.
 */
export function fitRegressionConstant(input: EfficiencyFitInput, name: RateName): number {
  const players = byPlayer(rateWeeks(input, name));

  let withinSum = 0;
  let withinDegreesOfFreedom = 0;
  for (const player of players) {
    if (player.weeks.length < 2) continue;
    for (const week of player.weeks) {
      withinSum += week.opportunities * (week.rate - player.rate) ** 2;
    }
    withinDegreesOfFreedom += player.weeks.length - 1;
  }
  if (withinDegreesOfFreedom === 0) return MAX_REGRESSION;
  const samplingVariance = withinSum / withinDegreesOfFreedom;

  const established = players.filter((player) => player.opportunities >= MIN_OPPORTUNITIES_FOR_SPREAD);
  if (established.length < 2) return MAX_REGRESSION;
  const byPosition = new Map<Position, PlayerRate[]>();
  for (const player of established) {
    (byPosition.get(player.position) ?? byPosition.set(player.position, []).get(player.position)!).push(player);
  }
  let spreadSum = 0;
  let spreadCount = 0;
  let inverseOpportunities = 0;
  for (const group of byPosition.values()) {
    if (group.length < 2) continue;
    const groupMean = mean(group.map((player) => player.rate));
    for (const player of group) {
      spreadSum += (player.rate - groupMean) ** 2;
      inverseOpportunities += 1 / player.opportunities;
      spreadCount += 1;
    }
  }
  if (spreadCount < 2) return MAX_REGRESSION;
  // The observed spread between players is real difference PLUS the sampling noise each player's
  // own estimate carries. Subtracting the second is the whole method; skipping it would credit the
  // noise as signal and under-regress every rate.
  const trueVariance = spreadSum / spreadCount - (samplingVariance * inverseOpportunities) / spreadCount;
  if (trueVariance <= 0) return MAX_REGRESSION;
  return Math.min(MAX_REGRESSION, samplingVariance / trueVariance);
}

export function fitEfficiencyPriors(input: EfficiencyFitInput): EfficiencyPriors {
  assertHeldOut(input);
  const names = Object.keys(RATES) as RateName[];

  const byPosition = Object.fromEntries(
    POSITIONS.map((position) => [
      position,
      Object.fromEntries(
        names.map((name) => {
          // Ratio of sums, as in the role priors and for the same reason: a mean of per-week ratios
          // lets a one-target week weigh as much as a twelve-target one and one lucky row move a
          // whole position's prior.
          const weeks = rateWeeks(input, name).filter((week) => week.position === position);
          const opportunities = weeks.reduce((sum, week) => sum + week.opportunities, 0);
          const numerator = weeks.reduce((sum, week) => sum + week.rate * week.opportunities, 0);
          return [name, opportunities === 0 ? 0 : numerator / opportunities];
        }),
      ) as Record<RateName, number>,
    ]),
  ) as Record<Position, Record<RateName, number>>;

  return {
    byPosition,
    regression: Object.fromEntries(names.map((name) => [name, fitRegressionConstant(input, name)])) as Record<RateName, number>,
  };
}

/**
 * THE YEARS-4-6 EXPERIENCE TERM — what one player-season contributes to the fit.
 *
 * `populationPoints` is deliberately NOT "what the model projected him for" — it is what an
 * EXPERIENCE-BLIND version of layer 2's own fitted rates (`byPosition`, before this term exists)
 * would have scored him for, given the touches he ACTUALLY got that season. Holding opportunity at
 * its real, observed value isolates the rate layer's own miscalibration for this cohort from
 * everything layer 1 might separately be getting wrong about how much he played — the two are
 * different defects with different fixes, and conflating them would let a bad experience term hide
 * behind a good (or bad) opportunity one, or the reverse.
 */
export interface ExperienceObservation {
  readonly position: Position;
  readonly cohort: ReturnType<typeof experienceCohort>;
  /** What he actually scored, under the league's own rules, over the season. */
  readonly actualPoints: number;
  /** What the position's experience-blind rates would have scored him, given his real touches. */
  readonly populationPoints: number;
}

/**
 * ONE MULTIPLIER PER POSITION, as a ratio of totals — actual points over what the position's own
 * experience-blind rates predicted, pooled over every player-season in the cohort.
 *
 * A ratio of totals rather than a mean of per-player ratios, matching `preseason/career.ts`'s own
 * `fitCareerPriors` and for the same reason: a mean of ratios lets a player with a handful of points
 * and a near-zero population estimate swing the number on his own, and the totals-ratio instead asks
 * the question a rate layer is actually judged on — did this cohort's actual production match what
 * an experience-blind model predicted for the touches it actually got.
 *
 * A position absent from the observations, or whose population total is zero, is OMITTED rather
 * than defaulted to `1` — `experienceMultiplierFor` already treats an absent position as a no-op, so
 * there is nothing this function needs to assert about a position it measured nothing for.
 */
export function fitExperienceMultiplier(observations: readonly ExperienceObservation[]): Readonly<Partial<Record<Position, number>>> {
  const totals = new Map<Position, { actual: number; population: number }>();
  for (const observation of observations) {
    if (observation.cohort !== "year4to6") continue;
    const cell = totals.get(observation.position) ?? { actual: 0, population: 0 };
    cell.actual += observation.actualPoints;
    cell.population += observation.populationPoints;
    totals.set(observation.position, cell);
  }
  const result: Partial<Record<Position, number>> = {};
  for (const [position, cell] of totals) {
    if (cell.population > 0) result[position] = cell.actual / cell.population;
  }
  return result;
}
