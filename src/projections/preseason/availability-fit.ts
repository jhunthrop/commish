import type { Position } from "@/domain/player";
import { isotonicNonIncreasing } from "../isotonic";
import type { RosterStatus } from "../nflverse/rosters";
import { ROSTER_STATUSES } from "../nflverse/rosters";
import {
  AGE_BRACKETS,
  ROLE_BRACKETS,
  ageBracketFor,
  expectedGamesPlayed,
  roleBracketFor,
  shrunkAvailabilityRate,
  teamGamesIn,
  type AgeBracket,
  type AvailabilityInput,
  type AvailabilityPriors,
  type RoleBracket,
} from "./availability";
import { ALL_POSITIONS, mean } from "./fit";

/**
 * FITTING THE AVAILABILITY MODEL — on the fit seasons, and it throws if you ask for anything else.
 *
 * `src/projections/model/fit.ts` established the discipline and this copies it deliberately: the
 * held-out seasons are passed in explicitly and the function REFUSES to read one. A fence made of
 * code rather than intention is the only kind that survives a phase where somebody is under
 * pressure to make a number look better, and the availability model is the single most tempting
 * place in this phase to quietly fit on 2024 — the effect is large, so the temptation is large.
 *
 * NOTHING HERE SEARCHES FOR MUCH. Three of the five parameter groups are DIRECT ESTIMATES: the
 * baseline is the fit seasons' own mean availability per position and age bracket, the status
 * multipliers are the same means per cutdown status, and the concentration is solved from the
 * observed spread by moments. Only the shrinkage and the recency decay are searched, over a small
 * grid. A model with two searched numbers and sixteen measured ones is a model whose behaviour a
 * reader can predict, and it is much harder to overfit two seasons with.
 */

/** The positions a board projects. Everyone else is not fitted on and never appears on a board. */
const FITTED_POSITIONS: readonly Position[] = ["QB", "RB", "WR", "TE"];

/**
 * How many player-seasons of the position's own mean each age cell is shrunk toward.
 *
 * Sixteen cells over two fit seasons leaves the thinnest of them (a quarterback over thirty) with a
 * few dozen player-seasons, which is a measurement but a noisy one. Shrinking toward the position's
 * overall mean keeps a thin cell from asserting something the position as a whole contradicts,
 * without flattening a cell that has hundreds of rows behind it.
 */
const CELL_PRIOR_SEASONS = 40;

/**
 * How far one age cell is allowed to move the shrunk rate.
 *
 * Wider than the [0.7, 1.15] the term carried while it multiplied the PRIOR, because a correction
 * applied after the shrinkage has to carry the whole effect rather than the share of it the prior's
 * weight let through. It is a guard against a thin cell rather than a tuned parameter, and it binds
 * on none of the cells this fit produces — `preseason-fit.ts` prints every one of them.
 */
export const AGE_MULTIPLIER_BOUND = { min: 0.6, max: 1.35 } as const;

/** What one player-season contributes to the fit. */
export interface AvailabilityObservation {
  readonly season: number;
  readonly playerId: string;
  readonly position: Position;
  readonly age: number | null;
  readonly status: RosterStatus;
  /** Layer 1's predicted snap share at the preseason moment. Zero where it has no opinion. */
  readonly projectedSnapShare: number;
  /** Prior seasons, as `expectedGamesPlayed` will be given them. */
  readonly history: AvailabilityInput["history"];
  /**
   * NULL for every observation, including a rookie's, and that is the fit staying honest about
   * itself. The rookie game-rate table is fitted from the SAME seasons as these cells; feeding it
   * back in as a baseline here would fit the position-and-role table against a number derived from
   * the population it is estimated over.
   */
  readonly baselineRate: null;
  /** What actually happened: games he appeared in. THE LABEL. */
  readonly gamesPlayed: number;
  /** Games the designation archives say he was unavailable for THAT season, the quantity the
   *  availability prior is a mean of. `null` where the archives do not cover the season. */
  readonly gamesUnavailable: number | null;
}

export interface AvailabilityFitOptions {
  /** Seasons this fit is forbidden to read. It throws rather than filtering them out quietly. */
  readonly heldOutSeasons: readonly number[];
  readonly priorGamesGrid?: readonly number[];
  readonly availabilityPriorGamesGrid?: readonly number[];
  readonly recencyDecayGrid?: readonly number[];
}

const DEFAULT_PRIOR_GAMES_GRID = [10, 17, 25, 34, 51, 68] as const;
/** Wider at the top than the role grid: the availability half of a record is the weaker signal,
 *  and the first fit under the split ran to the old grid's edge. */
const DEFAULT_AVAILABILITY_PRIOR_GAMES_GRID = [17, 34, 51, 68, 102, 136, 204] as const;
const DEFAULT_RECENCY_DECAY_GRID = [0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

function rateOf(observation: AvailabilityObservation): number {
  const teamGames = teamGamesIn(observation.season);
  return Math.min(1, Math.max(0, observation.gamesPlayed / teamGames));
}

/** Games played per game available for one observation, or `null` where the archives do not cover
 *  the season or he was available for nothing. */
function playedPerAvailableOf(observation: AvailabilityObservation): number | null {
  if (observation.gamesUnavailable === null) return null;
  const available = teamGamesIn(observation.season) - Math.min(observation.gamesUnavailable, teamGamesIn(observation.season));
  return available > 0 ? Math.min(1, observation.gamesPlayed / available) : null;
}

/**
 * THE ROLE TABLE: games played per game AVAILABLE by an ACTIVE player at each position and role.
 *
 * Estimated over active players only, which is what makes `statusMultiplier.active` exactly one
 * rather than a fitted number that happens to be near it. Mixing a practice-squad body into the
 * baseline would drag every cell down and then the status multipliers would have to undo it.
 *
 * A WEIGHTED ISOTONIC FIT ACROSS THE BRACKETS, NOT A SHRINKAGE TOWARD THE POSITION MEAN (founder
 * report 2026-09-08). The first version of this table pulled every cell toward the position's own
 * mean with forty pseudo-seasons, and at quarterback that mean is the truth about a randomly
 * chosen rostered quarterback: three per club, one of whom plays. The featured cell, sixty-two
 * real player-seasons at 0.88 played per available game on the fit seasons, came out at 0.65, and
 * a proven starter's own record then had to drag him back up. The brackets exist precisely
 * because the position mean is the wrong centre, so each cell is now its own weighted mean and the
 * only regularisation is the one the brackets' meaning demands: monotone in role (pool-adjacent-
 * violators over the four brackets, weighted by their counts), the same algorithm the rookie and
 * market curves are fitted with. A cell the fit seasons hold nobody in takes the position's mean.
 */
export function fitBaseline(observations: readonly AvailabilityObservation[]): AvailabilityPriors["baseline"] {
  const active = observations
    .filter((observation) => observation.status === "active")
    .map((observation) => ({ position: observation.position, bracket: roleBracketFor(observation.projectedSnapShare), rate: playedPerAvailableOf(observation) }))
    .filter((row): row is { position: Position; bracket: RoleBracket; rate: number } => row.rate !== null);
  const leagueMean = mean(active.map((row) => row.rate));
  if (leagueMean === null) throw new Error(ARCHIVES_REQUIRED);
  const table = {} as Record<Position, Record<RoleBracket, number>>;
  for (const position of ALL_POSITIONS) {
    const atPosition = active.filter((row) => row.position === position);
    const positionMean = mean(atPosition.map((row) => row.rate)) ?? leagueMean;
    const cells = ROLE_BRACKETS.map((bracket) => atPosition.filter((row) => row.bracket === bracket).map((row) => row.rate));
    // Non-decreasing in role: `isotonicNonIncreasing` over the brackets in REVERSE order.
    const fitted = [
      ...isotonicNonIncreasing(
        [...cells].reverse().map((values) => mean(values) ?? positionMean),
        [...cells].reverse().map((values) => Math.max(1, values.length)),
      ),
    ].reverse();
    table[position] = Object.fromEntries(ROLE_BRACKETS.map((bracket, index) => [bracket, fitted[index]!])) as Record<RoleBracket, number>;
  }
  return table;
}

export const ARCHIVES_REQUIRED =
  "The availability fit needs the injury report and weekly roster archives (nflverse_injuries, nflverse_roster_weeks) for the fit seasons; run `npm run projections:context` first.";

/** The share of the season an observation was available for, or `null` where the archives do not
 *  cover it. */
function availableShareOf(observation: AvailabilityObservation): number | null {
  if (observation.gamesUnavailable === null) return null;
  const teamGames = teamGamesIn(observation.season);
  return Math.min(1, Math.max(0, (teamGames - observation.gamesUnavailable) / teamGames));
}

/**
 * THE AVAILABILITY PRIOR: the share of the season an ACTIVE player at each position was available
 * for, whatever he then played. A direct mean, four numbers, each over hundreds of player-seasons.
 * A position the fit does not project (K, DEF) takes the league mean.
 *
 * REFUSES A FIT WITHOUT THE ARCHIVES. A prior of "available every week" estimated from seasons the
 * injury report and the weekly roster never covered would be a number nobody measured, and every
 * player's record would then be read against it.
 */
export function fitAvailabilityBaseline(observations: readonly AvailabilityObservation[]): AvailabilityPriors["availabilityBaseline"] {
  const active = observations.filter((observation) => observation.status === "active");
  const shares = active.map((observation) => [observation.position, availableShareOf(observation)] as const).filter((pair): pair is readonly [Position, number] => pair[1] !== null);
  const leagueMean = mean(shares.map(([, share]) => share));
  if (leagueMean === null) throw new Error(ARCHIVES_REQUIRED);
  const table = {} as Record<Position, number>;
  for (const position of ALL_POSITIONS) {
    table[position] = mean(shares.filter(([at]) => at === position).map(([, share]) => share)) ?? leagueMean;
  }
  return table;
}

/**
 * The shrinkage half of the model, as the two multipliers below have to see it.
 *
 * Both are ratios of what a group played to what the model expected of it, and the denominator has
 * to be THE NUMBER THEY MULTIPLY or the ratio is not a correction. `shrunkAvailabilityRate` is that
 * number: the role prior blended with the player's own record, before either multiplier.
 */
function shrunkFor(
  observation: AvailabilityObservation,
  priors: Omit<AvailabilityPriors, "concentration" | "concentrationPerSeason">,
): number {
  return shrunkAvailabilityRate(observation, { ...priors, concentration: 1, concentrationPerSeason: 0 });
}

/** A neutral parameter set: the shrinkage as it stands, with both multipliers switched off. */
/** The searched half of the priors: one cell of the grid. */
type Shrinkage = Pick<AvailabilityPriors, "priorGames" | "availabilityPriorGames" | "recencyDecay" | "historySeasons">;

function withoutMultipliers(
  tables: Pick<AvailabilityPriors, "baseline" | "availabilityBaseline">,
  shrinkage: Shrinkage,
): Omit<AvailabilityPriors, "concentration" | "concentrationPerSeason"> {
  const ones = Object.fromEntries(
    ALL_POSITIONS.map((position) => [position, Object.fromEntries(AGE_BRACKETS.map((bracket) => [bracket, 1]))]),
  ) as AvailabilityPriors["ageMultiplier"];
  const flat = Object.fromEntries(ROSTER_STATUSES.map((status) => [status, 1])) as AvailabilityPriors["statusMultiplier"];
  return { ...tables, ...shrinkage, ageMultiplier: ones, statusMultiplier: flat };
}

/**
 * AGE, as a multiplier on the shrunk rate.
 *
 * Measured on the RESIDUAL of everything below it, never on the raw rate, so it explains what role
 * and the player's own record could not rather than re-explaining what they already did — the
 * discipline Phase 3 held its scheme feature to when it fitted against layer 1's residual instead
 * of against raw volume.
 *
 * IT USED TO BE FITTED AGAINST THE ROLE CELL AND APPLIED TO THE PRIOR, which is the mismatch
 * `availability.ts` now documents: the record then carried the age signal straight back in, because
 * an old player's record is a run of full seasons and a young player's is a rookie year spent
 * behind somebody. Fitted here against the quantity it multiplies, it corrects the residual instead
 * of a quantity nothing downstream computes.
 *
 * Shrunk toward one on thin cells, and bounded, because a cell of forty player-seasons that says
 * thirty-year-old tight ends play half a season is noise and would fade a real starter off a board.
 * The bound is wider than it was — a correction applied after the shrinkage has to carry the whole
 * effect rather than the fraction of it the prior's weight lets through — and it is not
 * load-bearing: it binds on no cell the fit produces.
 */
function fitAgeMultipliers(
  observations: readonly AvailabilityObservation[],
  priors: Omit<AvailabilityPriors, "concentration" | "concentrationPerSeason">,
): AvailabilityPriors["ageMultiplier"] {
  const active = observations.filter((observation) => observation.status === "active");
  const table = {} as Record<Position, Record<AgeBracket, number>>;
  for (const position of ALL_POSITIONS) {
    const atPosition = active.filter((observation) => observation.position === position);
    const cells = {} as Record<AgeBracket, number>;
    for (const bracket of AGE_BRACKETS) {
      const inCell = atPosition.filter((observation) => ageBracketFor(observation.age) === bracket);
      const actual = mean(inCell.map(rateOf));
      const expected = mean(inCell.map((observation) => shrunkFor(observation, priors)));
      const raw = actual === null || expected === null || expected <= 0 ? 1 : actual / expected;
      const weight = inCell.length / (CELL_PRIOR_SEASONS + inCell.length);
      cells[bracket] = Math.min(AGE_MULTIPLIER_BOUND.max, Math.max(AGE_MULTIPLIER_BOUND.min, 1 * (1 - weight) + raw * weight));
    }
    table[position] = cells;
  }
  return table;
}

/**
 * What each cutdown status is worth, as a multiplier on the shrunk rate with age already applied.
 *
 * A ratio rather than a separate table because status and age are close to independent: a man on
 * injured reserve in week 1 misses a similar SHARE of the season whether he is 24 or 32, and a full
 * status-by-position-by-age table would be sixty-four cells estimated from eight hundred rows.
 *
 * THE DENOMINATOR IS THE FIX. It used to be the role-and-age BASELINE while the multiplier was
 * applied to the SHRUNK rate, and for this population those differ by a factor of three: a club
 * does not put a camp body on a reserve list in week one, it puts a starter there, and a starter's
 * own record pulls his shrunk rate far above his role cell. The old ratio therefore charged him for
 * the gap between the two on top of the designation itself.
 */
function fitStatusMultipliers(
  observations: readonly AvailabilityObservation[],
  priors: Omit<AvailabilityPriors, "concentration" | "concentrationPerSeason">,
): AvailabilityPriors["statusMultiplier"] {
  const expectedFor = (observation: AvailabilityObservation): number =>
    shrunkFor(observation, priors) * priors.ageMultiplier[observation.position][ageBracketFor(observation.age)];
  const multipliers = {} as Record<RosterStatus, number>;
  for (const status of ROSTER_STATUSES) {
    if (status === "active") {
      multipliers.active = 1;
      continue;
    }
    const inStatus = observations.filter((observation) => observation.status === status);
    const actual = mean(inStatus.map(rateOf));
    const expected = mean(inStatus.map(expectedFor));
    // No rows at a status leaves it at the active baseline rather than at zero: an unobserved
    // designation is unknown, and zeroing it would silently remove every player who carried it.
    multipliers[status] = actual === null || expected === null || expected <= 0 ? 1 : actual / expected;
  }
  return multipliers;
}

/**
 * The overdispersion, solved from the residuals rather than searched.
 *
 * Games played is not seventeen independent coin flips. One torn ligament costs eight weeks at
 * once, so the real spread is more than twice what a binomial predicts, and a model that reported
 * the binomial spread would publish a floor no manager should believe. The beta-binomial variance
 * is `n p (1-p) (n + k) / (1 + k)`, so the ratio of the observed squared residual to the binomial
 * one identifies `k` in closed form.
 *
 * Solved separately per LENGTH OF RECORD and fitted to a line, which is what gives a rookie an
 * honestly wider distribution than a veteran without anybody writing a rule that says so.
 */
function fitConcentration(
  observations: readonly AvailabilityObservation[],
  partial: Omit<AvailabilityPriors, "concentration" | "concentrationPerSeason">,
): Pick<AvailabilityPriors, "concentration" | "concentrationPerSeason"> {
  const priors: AvailabilityPriors = { ...partial, concentration: 1, concentrationPerSeason: 0 };
  const points: { seasons: number; concentration: number; weight: number }[] = [];

  for (let seasons = 0; seasons <= partial.historySeasons; seasons += 1) {
    const cohort = observations.filter(
      (observation) => Math.min(observation.history.length, partial.historySeasons) === seasons,
    );
    if (cohort.length < 30) continue;
    const n = teamGamesIn(cohort[0]!.season);
    let residual = 0;
    let binomial = 0;
    for (const observation of cohort) {
      const rate = expectedGamesPlayed(observation, { season: observation.season, priors }).rate;
      const games = teamGamesIn(observation.season);
      residual += (observation.gamesPlayed - rate * games) ** 2;
      binomial += games * rate * (1 - rate);
    }
    const ratio = residual / Math.max(binomial, 1e-9);
    // Underdispersion (ratio at or below one) is not something this outcome produces at any real
    // sample size; where it appears it is a thin cohort, and pinning a very high concentration
    // there would publish a distribution with no spread at all. Bounded rather than trusted.
    const solved = ratio >= n || ratio <= 1 ? 60 : (ratio - n) / (1 - ratio);
    points.push({ seasons, concentration: Math.min(60, Math.max(0.5, solved)), weight: cohort.length });
  }

  if (points.length === 0) return { concentration: 4, concentrationPerSeason: 0 };
  if (points.length === 1) return { concentration: points[0]!.concentration, concentrationPerSeason: 0 };

  // Weighted least squares of concentration against seasons of record. A line rather than a table
  // because four points cannot support a shape, and because `expectedGamesPlayed` has to be able to
  // answer for a history length the fit never saw.
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  const meanX = points.reduce((sum, p) => sum + p.weight * p.seasons, 0) / totalWeight;
  const meanY = points.reduce((sum, p) => sum + p.weight * p.concentration, 0) / totalWeight;
  const covariance = points.reduce((sum, p) => sum + p.weight * (p.seasons - meanX) * (p.concentration - meanY), 0);
  const variance = points.reduce((sum, p) => sum + p.weight * (p.seasons - meanX) ** 2, 0);
  const slope = variance <= 0 ? 0 : covariance / variance;
  // A record can only ever narrow a distribution. A negative slope would be the fit telling us that
  // a veteran is less predictable than a rookie, which no sample this size establishes and which
  // would invert the one property `rookies.ts` depends on.
  const bounded = Math.max(0, slope);
  return {
    concentration: Math.max(0.5, meanY - bounded * meanX),
    concentrationPerSeason: bounded,
  };
}

function rootMeanSquare(observations: readonly AvailabilityObservation[], priors: AvailabilityPriors): number {
  let total = 0;
  for (const observation of observations) {
    const { rate } = expectedGamesPlayed(observation, { season: observation.season, priors });
    total += (rate - rateOf(observation)) ** 2;
  }
  return Math.sqrt(total / Math.max(observations.length, 1));
}

/**
 * The whole fit. Direct estimates first, then a two-parameter grid, then the spread by moments.
 *
 * Root mean squared error is the objective, not mean absolute error, for the reason model v1's own
 * research gives about layer 1: absolute error is minimised by the conditional median, and a search
 * asked to minimise it on a distribution with a spike at the top runs to the least regression in
 * the grid at every extension. RMSE is the proper loss for a conditional-mean estimator, and the
 * availability rate is a conditional mean.
 */
export function fitAvailabilityPriors(
  observations: readonly AvailabilityObservation[],
  {
    heldOutSeasons,
    priorGamesGrid = DEFAULT_PRIOR_GAMES_GRID,
    availabilityPriorGamesGrid = DEFAULT_AVAILABILITY_PRIOR_GAMES_GRID,
    recencyDecayGrid = DEFAULT_RECENCY_DECAY_GRID,
  }: AvailabilityFitOptions,
): AvailabilityPriors {
  const forbidden = new Set(heldOutSeasons);
  for (const observation of observations) {
    if (forbidden.has(observation.season)) {
      throw new Error(
        `The availability fit was handed ${observation.season}, which is held out. A parameter fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }
  const fittable = observations.filter((observation) => FITTED_POSITIONS.includes(observation.position));
  if (fittable.length < 100) {
    throw new Error(`The availability fit needs a population; got ${fittable.length} player-seasons.`);
  }

  const tables = { baseline: fitBaseline(fittable), availabilityBaseline: fitAvailabilityBaseline(fittable) };
  const historySeasons = 3;

  // BOTH MULTIPLIERS ARE REFITTED INSIDE THE GRID, and they have to be. Each is a ratio against the
  // shrunk rate, and the shrunk rate is what the two searched parameters decide — so a table fitted
  // once outside the loop would be a correction to a model the search then walks away from. This is
  // the same self-consistency the apply side now has, on the fit side.
  let best: Omit<AvailabilityPriors, "concentration" | "concentrationPerSeason"> | null = null;
  let bestError = Infinity;
  const grid: readonly Shrinkage[] = priorGamesGrid.flatMap((priorGames) =>
    availabilityPriorGamesGrid.flatMap((availabilityPriorGames) =>
      recencyDecayGrid.map((recencyDecay) => ({ priorGames, availabilityPriorGames, recencyDecay, historySeasons })),
    ),
  );
  for (const shrinkage of grid) {
    const bare = withoutMultipliers(tables, shrinkage);
    const ageMultiplier = fitAgeMultipliers(fittable, bare);
    const statusMultiplier = fitStatusMultipliers(fittable, { ...bare, ageMultiplier });
    const candidate = { ...bare, ageMultiplier, statusMultiplier };
    const error = rootMeanSquare(fittable, { ...candidate, concentration: 1, concentrationPerSeason: 0 });
    if (error < bestError) {
      bestError = error;
      best = candidate;
    }
  }
  if (best === null) throw new Error("The availability grid was empty; there is nothing to fit.");

  return { ...best, ...fitConcentration(fittable, best) };
}
