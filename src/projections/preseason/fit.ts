import type { Position } from "@/domain/player";
import type { RosterStatus } from "../nflverse/rosters";
import { ROSTER_STATUSES } from "../nflverse/rosters";
import { DRAFT_BUCKETS, draftBucketFor, type DraftBucket, type RookiePriors, type RookieShares } from "./rookies";
import {
  AGE_BRACKETS,
  ROLE_BRACKETS,
  ageBracketFor,
  expectedGamesPlayed,
  roleBracketFor,
  teamGamesIn,
  type AgeBracket,
  type AvailabilityInput,
  type AvailabilityPriors,
  type RoleBracket,
} from "./availability";

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

/** Every position the priors carry a cell for, so a caller can never index a table and get nothing. */
const ALL_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

/**
 * How many player-seasons of the position's own mean each age cell is shrunk toward.
 *
 * Sixteen cells over two fit seasons leaves the thinnest of them (a quarterback over thirty) with a
 * few dozen player-seasons, which is a measurement but a noisy one. Shrinking toward the position's
 * overall mean keeps a thin cell from asserting something the position as a whole contradicts,
 * without flattening a cell that has hundreds of rows behind it.
 */
const CELL_PRIOR_SEASONS = 40;

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
  /** What actually happened: games he appeared in. THE LABEL. */
  readonly gamesPlayed: number;
}

export interface AvailabilityFitOptions {
  /** Seasons this fit is forbidden to read. It throws rather than filtering them out quietly. */
  readonly heldOutSeasons: readonly number[];
  readonly priorGamesGrid?: readonly number[];
  readonly recencyDecayGrid?: readonly number[];
}

const DEFAULT_PRIOR_GAMES_GRID = [10, 17, 25, 34, 51, 68] as const;
const DEFAULT_RECENCY_DECAY_GRID = [0.5, 0.6, 0.7, 0.8, 0.9, 1] as const;

function rateOf(observation: AvailabilityObservation): number {
  const teamGames = teamGamesIn(observation.season);
  return Math.min(1, Math.max(0, observation.gamesPlayed / teamGames));
}

function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * THE PRIMARY TABLE: expected share of the season an ACTIVE player at each position and role plays.
 *
 * Estimated over active players only, which is what makes `statusMultiplier.active` exactly one
 * rather than a fitted number that happens to be near it. Mixing a practice-squad body into the
 * baseline would drag every cell down and then the status multipliers would have to undo it.
 */
function fitBaseline(observations: readonly AvailabilityObservation[]): AvailabilityPriors["baseline"] {
  const active = observations.filter((observation) => observation.status === "active");
  const leagueMean = mean(active.map(rateOf)) ?? 0.8;
  const table = {} as Record<Position, Record<RoleBracket, number>>;
  for (const position of ALL_POSITIONS) {
    const atPosition = active.filter((observation) => observation.position === position);
    const positionMean = mean(atPosition.map(rateOf)) ?? leagueMean;
    const cells = {} as Record<RoleBracket, number>;
    for (const bracket of ROLE_BRACKETS) {
      const inCell = atPosition.filter((observation) => roleBracketFor(observation.projectedSnapShare) === bracket);
      const cellMean = mean(inCell.map(rateOf)) ?? positionMean;
      cells[bracket] =
        (CELL_PRIOR_SEASONS * positionMean + inCell.length * cellMean) / (CELL_PRIOR_SEASONS + inCell.length);
    }
    // Monotone in role, downward from the featured cell, for the same reason the rookie table is
    // monotone in draft capital: a thin cell saying rotation players outlast featured ones is
    // telling us about those forty players rather than about football.
    table[position] = enforceRoleOrdering(cells);
  }
  return table;
}

/** Caps each role bracket at the one above it, so less of a role can never mean more of a season. */
function enforceRoleOrdering(cells: Record<RoleBracket, number>): Record<RoleBracket, number> {
  const ordered = {} as Record<RoleBracket, number>;
  let ceiling = Infinity;
  for (const bracket of [...ROLE_BRACKETS].reverse()) {
    ordered[bracket] = Math.min(cells[bracket], ceiling);
    ceiling = ordered[bracket];
  }
  return ordered;
}

/**
 * AGE, as a multiplier on the role cell.
 *
 * Measured on the RESIDUAL of the role table, never on the raw rate, so it explains what role could
 * not rather than re-explaining what role already did — the discipline Phase 3 held its scheme
 * feature to when it fitted against layer 1's residual instead of against raw volume. Without it,
 * the age term would mostly re-measure the fact that older players are more often backups.
 *
 * Shrunk toward one on thin cells, and bounded, because a cell of forty player-seasons that says
 * thirty-year-old tight ends play half a season is noise and would fade a real starter off a board.
 */
function fitAgeMultipliers(
  observations: readonly AvailabilityObservation[],
  baseline: AvailabilityPriors["baseline"],
): AvailabilityPriors["ageMultiplier"] {
  const active = observations.filter((observation) => observation.status === "active");
  const table = {} as Record<Position, Record<AgeBracket, number>>;
  for (const position of ALL_POSITIONS) {
    const atPosition = active.filter((observation) => observation.position === position);
    const cells = {} as Record<AgeBracket, number>;
    for (const bracket of AGE_BRACKETS) {
      const inCell = atPosition.filter((observation) => ageBracketFor(observation.age) === bracket);
      const actual = mean(inCell.map(rateOf));
      const expected = mean(inCell.map((observation) => baseline[position][roleBracketFor(observation.projectedSnapShare)]));
      const raw = actual === null || expected === null || expected <= 0 ? 1 : actual / expected;
      const weight = inCell.length / (CELL_PRIOR_SEASONS + inCell.length);
      cells[bracket] = Math.min(1.15, Math.max(0.7, 1 * (1 - weight) + raw * weight));
    }
    table[position] = cells;
  }
  return table;
}

/**
 * What each cutdown status is worth, as a multiplier on the active baseline.
 *
 * A ratio rather than a separate table because status and age are close to independent: a man on
 * injured reserve in week 1 misses a similar SHARE of the season whether he is 24 or 32, and a full
 * status-by-position-by-age table would be sixty-four cells estimated from eight hundred rows.
 */
function fitStatusMultipliers(
  observations: readonly AvailabilityObservation[],
  baseline: AvailabilityPriors["baseline"],
  ageMultiplier: AvailabilityPriors["ageMultiplier"],
): AvailabilityPriors["statusMultiplier"] {
  const expectedFor = (observation: AvailabilityObservation): number =>
    baseline[observation.position][roleBracketFor(observation.projectedSnapShare)] *
    ageMultiplier[observation.position][ageBracketFor(observation.age)];
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
  { heldOutSeasons, priorGamesGrid = DEFAULT_PRIOR_GAMES_GRID, recencyDecayGrid = DEFAULT_RECENCY_DECAY_GRID }: AvailabilityFitOptions,
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

  const baseline = fitBaseline(fittable);
  const ageMultiplier = fitAgeMultipliers(fittable, baseline);
  const statusMultiplier = fitStatusMultipliers(fittable, baseline, ageMultiplier);
  const historySeasons = 3;

  let best: Omit<AvailabilityPriors, "concentration" | "concentrationPerSeason"> | null = null;
  let bestError = Infinity;
  for (const priorGames of priorGamesGrid) {
    for (const recencyDecay of recencyDecayGrid) {
      const candidate = { baseline, ageMultiplier, statusMultiplier, priorGames, recencyDecay, historySeasons };
      const error = rootMeanSquare(fittable, { ...candidate, concentration: 1, concentrationPerSeason: 0 });
      if (error < bestError) {
        bestError = error;
        best = candidate;
      }
    }
  }
  if (best === null) throw new Error("The availability grid was empty; there is nothing to fit.");

  return { ...best, ...fitConcentration(fittable, best) };
}

/**
 * FITTING THE ROOKIE PRIOR — the same discipline, on the same seasons.
 *
 * What a rookie at each position and each level of draft capital actually did, measured over the
 * fit seasons' own rookie classes and shrunk toward the position's overall rookie mean. No search
 * at all: twenty-four cells, every one of them a mean of real player-seasons, and a reader who
 * disagrees with a cell can go and count the same players.
 *
 * THE SHARES ARE CONDITIONAL ON PLAYING, and the decomposition matters. A sixth-round receiver who
 * never dresses contributes zero games to the availability fit and nothing at all here, so his
 * absence is charged to availability rather than to his bucket's share. Charging it twice would
 * project every late-round rookie at half of half. The cost is that a late bucket's share is
 * measured over the members of it who made the field, which is optimistic about the bucket, and the
 * availability model is what brings it back down.
 */

/** What one rookie's first season contributes to the fit. */
export interface RookieObservation {
  readonly season: number;
  readonly playerId: string;
  readonly position: Position;
  readonly overallPick: number | null;
  /** How much of his position group's work the returning roster held when he arrived. */
  readonly incumbentClaim: number;
  /** His own mean shares over the games he played. Null where he played none. */
  readonly shares: RookieShares | null;
}

/** How many rookie-seasons of the position's own mean each draft bucket is shrunk toward. */
const ROOKIE_CELL_PRIOR = 12;

function meanShares(observations: readonly RookieObservation[]): RookieShares | null {
  const played = observations.filter((observation) => observation.shares !== null);
  if (played.length === 0) return null;
  const sum = played.reduce(
    (running, observation) => ({
      snapShare: running.snapShare + observation.shares!.snapShare,
      targetShare: running.targetShare + observation.shares!.targetShare,
      carryShare: running.carryShare + observation.shares!.carryShare,
      passAttemptShare: running.passAttemptShare + observation.shares!.passAttemptShare,
    }),
    { snapShare: 0, targetShare: 0, carryShare: 0, passAttemptShare: 0 },
  );
  return {
    snapShare: sum.snapShare / played.length,
    targetShare: sum.targetShare / played.length,
    carryShare: sum.carryShare / played.length,
    passAttemptShare: sum.passAttemptShare / played.length,
  };
}

function blendShares(prior: RookieShares, cell: RookieShares | null, count: number): RookieShares {
  if (cell === null) return prior;
  const weight = count / (ROOKIE_CELL_PRIOR + count);
  const blend = (a: number, b: number): number => a * (1 - weight) + b * weight;
  return {
    snapShare: blend(prior.snapShare, cell.snapShare),
    targetShare: blend(prior.targetShare, cell.targetShare),
    carryShare: blend(prior.carryShare, cell.carryShare),
    passAttemptShare: blend(prior.passAttemptShare, cell.passAttemptShare),
  };
}

const NO_SHARES: RookieShares = { snapShare: 0, targetShare: 0, carryShare: 0, passAttemptShare: 0 };

export interface RookieFitOptions {
  readonly heldOutSeasons: readonly number[];
  readonly leagueTeamVolume: RookiePriors["leagueTeamVolume"];
  /** Chosen, not fitted. See `RookiePriors.landingBound` for why it is bounded at all. */
  readonly landingBound?: number;
}

export function fitRookiePriors(
  observations: readonly RookieObservation[],
  { heldOutSeasons, leagueTeamVolume, landingBound = 0.5 }: RookieFitOptions,
): RookiePriors {
  const forbidden = new Set(heldOutSeasons);
  for (const observation of observations) {
    if (forbidden.has(observation.season)) {
      throw new Error(
        `The rookie fit was handed ${observation.season}, which is held out. A parameter fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }

  const byBucket = {} as Record<Position, Record<DraftBucket, RookieShares>>;
  const typicalIncumbentClaim = {} as Record<Position, number>;
  for (const position of ALL_POSITIONS) {
    const atPosition = observations.filter((observation) => observation.position === position);
    const positionMean = meanShares(atPosition) ?? NO_SHARES;
    const cells = {} as Record<DraftBucket, RookieShares>;
    for (const bucket of DRAFT_BUCKETS) {
      const inCell = atPosition.filter((observation) => draftBucketFor(observation.overallPick) === bucket);
      const withGames = inCell.filter((observation) => observation.shares !== null);
      cells[bucket] = blendShares(positionMean, meanShares(inCell), withGames.length);
    }
    // Monotone in draft capital by construction. A thin cell can otherwise say that third-rounders
    // out-target first-rounders, which is noise rather than a finding, and a board that acted on it
    // would rank a fifth-round back above a top-ten pick for no reason a reader could defend.
    byBucket[position] = enforceCapitalOrdering(cells);
    const claim = mean(atPosition.map((observation) => observation.incumbentClaim));
    typicalIncumbentClaim[position] = claim === null || claim <= 0 ? 1 : claim;
  }

  return { byBucket, leagueTeamVolume, typicalIncumbentClaim, landingBound };
}

/**
 * Caps each bucket at the one above it, so more draft capital can never project less opportunity.
 *
 * This is a CONSTRAINT rather than a fit, and it is stated here rather than buried: the claim that
 * a team giving up more for a player intends him a larger role is the entire premise of the module,
 * and a cell that contradicts it on forty player-seasons is telling us about those forty players.
 * The ordering is applied downward from round one, so a rich cell is never raised to meet a poor
 * one — the constraint only ever removes an inversion, it never invents a gap.
 */
function enforceCapitalOrdering(cells: Record<DraftBucket, RookieShares>): Record<DraftBucket, RookieShares> {
  const ordered = {} as Record<DraftBucket, RookieShares>;
  let ceiling: RookieShares | null = null;
  for (const bucket of DRAFT_BUCKETS) {
    const cell = cells[bucket];
    const capped: RookieShares =
      ceiling === null
        ? cell
        : {
            snapShare: Math.min(cell.snapShare, ceiling.snapShare),
            targetShare: Math.min(cell.targetShare, ceiling.targetShare),
            carryShare: Math.min(cell.carryShare, ceiling.carryShare),
            passAttemptShare: Math.min(cell.passAttemptShare, ceiling.passAttemptShare),
          };
    ordered[bucket] = capped;
    ceiling = capped;
  }
  return ordered;
}
