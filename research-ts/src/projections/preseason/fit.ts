import type { Position } from "@research-ts/domain/player";
import { isotonicNonIncreasing } from "../isotonic";
import { EXPERIENCE_BANDS, type CareerPriors, type ExperienceBand } from "./career";
import { DEPTH_RANKS, type DepthPriors, type DepthRank } from "./depth";
import { DRAFT_BUCKETS, draftBucketFor, type DraftBucket, type RookiePriors, type RookieShares } from "./rookies";

/**
 * THE PRESEASON FITS THAT ARE NOT THE AVAILABILITY MODEL'S — rookies, the depth chart and the
 * career curve — and the two helpers every fit in this directory shares. The availability fit, the
 * one with a held-out fence and a searched grid, lives in `availability-fit.ts`; it imports these
 * two from here and nothing here imports it back.
 */

/** Every position the priors carry a cell for, so a caller can never index a table and get nothing. */
export const ALL_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;

export function mean(values: readonly number[]): number | null {
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * FITTING THE ROOKIE PRIOR — the same discipline, on the same seasons.
 *
 * What a rookie at each position and each level of draft capital actually did, measured over the
 * fit seasons' own rookie classes and shrunk toward the position's overall rookie mean. No search
 * at all: twenty-four cells, every one of them a mean of real player-seasons, and a reader who
 * disagrees with a cell can go and count the same players.
 *
 * THE SHARES ARE CONDITIONAL ON PLAYING, AND THE GAME RATE IS NOT. That decomposition is the whole
 * of how a rookie's season is composed, and the first version of this fit only had half of it. A
 * sixth-round receiver who never dresses contributes nothing to a bucket's SHARE, which is correct:
 * the share is what he does in a game he plays, and charging his absence to it as well would
 * project every late-round rookie at half of half.
 *
 * The other half has to be measured somewhere, and it used to be left to the availability model,
 * which had nothing to read but a snap share this table had already conditioned on playing. It
 * concluded that a seventh-round quarterback was a featured starter, gave him ten games, and
 * projected undrafted quarterbacks above the best receiver in the class. So the game rate is fitted
 * here, over EVERY rookie in the cell including the ones who never dressed, and it is a rookie's
 * availability baseline. Nothing is charged twice: the share answers "how much per game", the game
 * rate answers "how many games", and no cell appears in both answers.
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
  /** Games he appeared in, over every rookie in the class and not only the ones who dressed. */
  readonly gamesPlayed: number;
  /** Games his league played that year, the denominator `gamesPlayed` is a share of. */
  readonly teamGames: number;
}

/**
 * How many rookie-seasons of the position's own mean each draft bucket is shrunk toward.
 *
 * TWO, chosen on the FIT SEASONS and on nothing else, by sweeping it and scoring the rookie segment
 * against ranking the class by pick number. At twelve the table was all but flat — a round-one back
 * and a round-three back came out within a hundredth of each other, because a cell holding five
 * player-seasons was weighed a fifth of its own evidence and four fifths of the position mean, and
 * `enforceCapitalOrdering` then capped the surviving differences into exact ties. A prior that
 * erases the only signal the module has is not caution, it is a table that says nothing.
 *
 * Light shrinkage is defensible here BECAUSE of that monotonicity cap. The regularisation a thin
 * cell needs is mostly the constraint that more capital cannot mean less opportunity, and that is
 * structural rather than statistical; stacking a heavy prior on top of it regularises twice. The
 * sweep on the fit seasons: 12 gave -0.079 and -0.074 against the pick ordering, 8 gave -0.062 and
 * -0.060, 4 gave -0.022 and -0.037, 2 gave -0.005 and -0.028, and 0 gave +0.012 and -0.075. Zero is
 * the best single season and the second worst on the other, which is what an unshrunk five-player
 * cell looks like; two is the best on both together and the best on the worse of the two.
 */
const ROOKIE_CELL_PRIOR = 2;

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

/** The share of a season a cell's rookies played, counting the ones who never dressed as zero. */
function meanGameRate(observations: readonly RookieObservation[]): number | null {
  return mean(
    observations
      .filter((observation) => observation.teamGames > 0)
      .map((observation) => Math.min(1, Math.max(0, observation.gamesPlayed / observation.teamGames))),
  );
}

/**
 * ENFORCES MONOTONE-NON-INCREASING DRAFT-CAPITAL ORDERING ON THE GAME-RATE TABLE, via the SAME
 * weighted isotonic regression (pool-adjacent-violators, `isotonic.ts`'s `isotonicNonIncreasing`)
 * `rookie-curve.ts`'s points curve is fit with — not the one-pass "cap this bucket at the one above
 * it" `enforceCapitalOrdering` still uses for shares below.
 *
 * THE BUG THIS REPLACES (calibration fix round, 2026-09-04, Task 1). Capping only ever pulls a
 * LATER, lower-capital bucket DOWN to an EARLIER one's value — it can never raise an earlier bucket
 * to meet a later one. When the EARLY bucket's own raw rate is the noisy low outlier — round one for
 * running backs, on the handful of true top-ten picks the fit seasons actually contained — every
 * later, genuinely-lower-capital bucket got clamped down to that one low, unstable number, and the
 * whole capped table came out FLAT rather than falling off with capital: RB's `gameRate` measured
 * 0.4769 for round one clear through rounds four-and-five before this fix, an availability model
 * dividing a healthy top-three pick's season into 8.4 expected games — a number no better than a
 * seventh-rounder's. PAVA fixes the offending pair by POOLING A WEIGHTED AVERAGE of the two,
 * whichever direction the violation runs, rather than asserting one side's cell over the other's; a
 * thin, noisy cell now gets diluted into its neighbours' shared mean instead of dictating every
 * bucket beneath it.
 */
function isotonicRateOrdering(
  cells: Readonly<Record<DraftBucket, number>>,
  weights: Readonly<Record<DraftBucket, number>>,
): Record<DraftBucket, number> {
  const values = DRAFT_BUCKETS.map((bucket) => cells[bucket]);
  // Floored above zero: `isotonicNonIncreasing`'s pooling formula divides by the sum of the two
  // blocks' own weights, and an empty bucket (a position with no observations at all in that draft
  // round on the fit seasons) would otherwise divide by zero rather than simply carrying no
  // influence into its neighbours' pooled mean.
  const cellWeights = DRAFT_BUCKETS.map((bucket) => Math.max(weights[bucket], 1e-9));
  const fitted = isotonicNonIncreasing(values, cellWeights);
  const ordered = {} as Record<DraftBucket, number>;
  DRAFT_BUCKETS.forEach((bucket, index) => {
    ordered[bucket] = fitted[index]!;
  });
  return ordered;
}

/**
 * ONE POSITION'S GAME-RATE TABLE: each bucket's own mean rate (over the whole cell, survivors and
 * non-dressers alike — see `meanGameRate`), shrunk toward the position's own rookie mean on the same
 * `ROOKIE_CELL_PRIOR` prior the shares table uses, then monotone-ordered by `isotonicRateOrdering`
 * rather than assumed already ordered.
 *
 * SHARED by `fitRookiePriors` (fitting `byBucket` and `gameRate` together, on the same observations)
 * and `fitRookieGameRate` (fitting `gameRate` ALONE, on its own season window — see that function's
 * own docblock for why the durability prior earned a separate entry point).
 */
function fitPositionGameRate(atPosition: readonly RookieObservation[]): Record<DraftBucket, number> {
  const positionRate = meanGameRate(atPosition) ?? 0;
  const rates = {} as Record<DraftBucket, number>;
  const weights = {} as Record<DraftBucket, number>;
  for (const bucket of DRAFT_BUCKETS) {
    const inCell = atPosition.filter((observation) => draftBucketFor(observation.overallPick) === bucket);
    const rate = meanGameRate(inCell);
    const weight = inCell.length / (ROOKIE_CELL_PRIOR + inCell.length);
    rates[bucket] = rate === null ? positionRate : positionRate * (1 - weight) + rate * weight;
    weights[bucket] = inCell.length;
  }
  return isotonicRateOrdering(rates, weights);
}

/**
 * THE ROOKIE DURABILITY PRIOR, FITTED ON ITS OWN SEASON WINDOW (calibration fix round, 2026-09-04,
 * Task 1) — `RookiePriors.gameRate` alone, independent of `fitRookiePriors`'s shares fit.
 *
 * WHY A SEPARATE ENTRY POINT RATHER THAN JUST FIXING THE ALGORITHM IN PLACE. The diagnosed defect —
 * a healthy top-three rookie running back's availability collapsing to an undifferentiated 8.4-game
 * "no-history" rate — was ENTIRELY in the rate table; nothing about the shares fit (`byBucket`) was
 * implicated, and `docs/superpowers/specs`' own register discipline for this calibration round fits
 * on 2023-2024 and scores on 2025 rather than the model's original 2021-2022/2023-2024 split. Rather
 * than move the WHOLE rookie fit's window and re-litigate a shares table nobody found wrong,
 * `scripts/preseason-fit.ts` keeps `byBucket` on `FIT_SEASONS` (2021, 2022) and calls this function
 * separately, on the fresher, more recent `ROOKIE_DURABILITY_TRAIN_SEASONS` (2023, 2024) window, then
 * splices the result into the committed `RookiePriors.gameRate` field. Two windows for two tables
 * measuring two different things is a documented choice, not an oversight: see that script's own
 * comment at the call site.
 */
/**
 * THE DURABILITY PRIOR'S OWN FIT WINDOW (calibration fix round, 2026-09-04) — 2023 and 2024, per this
 * round's own register discipline (`docs/superpowers/specs`): fit on 2023-2024, score on 2025, 2026
 * held out absolutely. Distinct from the rest of the preseason model's `FIT_SEASONS` (2021, 2022) —
 * see `fitRookieGameRate`'s own docblock for why this one table gets a fresher, separate window.
 */
export const ROOKIE_DURABILITY_TRAIN_SEASONS: readonly number[] = [2023, 2024];
/** Everything after the durability prior's own train window — 2025 is the backtest's scoring
 *  season and 2026 is the register's permanent holdout; neither may ever reach this fit. */
export const ROOKIE_DURABILITY_HELD_OUT_SEASONS: readonly number[] = [2025, 2026];

export function fitRookieGameRate(
  observations: readonly RookieObservation[],
  { heldOutSeasons }: { readonly heldOutSeasons: readonly number[] },
): Readonly<Record<Position, Readonly<Record<DraftBucket, number>>>> {
  const forbidden = new Set(heldOutSeasons);
  for (const observation of observations) {
    if (forbidden.has(observation.season)) {
      throw new Error(
        `The rookie durability fit was handed ${observation.season}, which is held out. A parameter fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }
  const gameRate = {} as Record<Position, Record<DraftBucket, number>>;
  for (const position of ALL_POSITIONS) {
    const atPosition = observations.filter((observation) => observation.position === position);
    gameRate[position] = fitPositionGameRate(atPosition);
  }
  return gameRate;
}

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
  const gameRate = {} as Record<Position, Record<DraftBucket, number>>;
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
    // See `fitPositionGameRate`'s own docblock: shrunk toward the position's own rookie mean on the
    // same prior as the shares, over the whole cell rather than over its survivors, then
    // monotone-ordered by isotonic regression rather than the naive cap this replaced.
    gameRate[position] = fitPositionGameRate(atPosition);
    // Monotone in draft capital by construction. A thin cell can otherwise say that third-rounders
    // out-target first-rounders, which is noise rather than a finding, and a board that acted on it
    // would rank a fifth-round back above a top-ten pick for no reason a reader could defend.
    byBucket[position] = enforceCapitalOrdering(cells);
    const claim = mean(atPosition.map((observation) => observation.incumbentClaim));
    typicalIncumbentClaim[position] = claim === null || claim <= 0 ? 1 : claim;
  }

  return { byBucket, leagueTeamVolume, typicalIncumbentClaim, gameRate, landingBound };
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

/**
 * FITTING THE DEPTH-CHART CORRECTION — the same discipline again, and one number per cell.
 *
 * What the fit measures is how far layer 1's belief about a man's role is from what he went on to
 * do, GROUPED BY WHERE HIS CLUB LISTED HIM. If the chart carried nothing layer 1 did not already
 * know, every cell would come out at one; the fit seasons say a club's number-two quarterback plays
 * about half the snaps the model gives him and its number one about a third more, which is a large
 * and consistent statement that the model cannot make for itself.
 *
 * NORMALISED WITHIN THE POSITION, so the chart reorders and never relevels. See
 * `DepthPriors.bySnapShare` for why that restriction is the honest one.
 */

/** What one player-season contributes to the depth-chart fit. */
export interface DepthObservation {
  readonly season: number;
  readonly playerId: string;
  readonly position: Position;
  /** Where his club listed him on its published week-one offensive depth chart. */
  readonly rank: DepthRank;
  /** Layer 1's predicted snap share at the preseason moment, before any correction. */
  readonly projectedSnapShare: number;
  /** What he actually played: his mean snap share over his team's whole season, absences included. */
  readonly actualSnapShare: number;
}

export interface DepthFitOptions {
  readonly heldOutSeasons: readonly number[];
  /** Chosen, not fitted. See `DepthPriors.bound`. */
  readonly bound?: number;
}

/**
 * How many player-seasons of "the chart says nothing" each cell is shrunk toward.
 *
 * Sixteen cells over two fit seasons leaves the thinnest (a third-string quarterback) at under
 * twenty, and an unshrunk cell of that size would assert a multiplier from a handful of men who
 * happened to be pressed into service. Shrinking toward one, which is the null hypothesis that the
 * chart adds nothing, is the conservative direction: a cell has to earn its correction.
 */
const DEPTH_CELL_PRIOR = 20;

export function fitDepthPriors(
  observations: readonly DepthObservation[],
  { heldOutSeasons, bound = 1 }: DepthFitOptions,
): DepthPriors {
  const forbidden = new Set(heldOutSeasons);
  for (const observation of observations) {
    if (forbidden.has(observation.season)) {
      throw new Error(
        `The depth-chart fit was handed ${observation.season}, which is held out. A parameter fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }

  const bySnapShare = {} as Record<Position, Record<DepthRank, number>>;
  for (const position of ALL_POSITIONS) {
    const atPosition = observations.filter((observation) => observation.position === position);
    const cells = {} as Record<DepthRank, number>;
    // The position's own overall correction, divided out below so only the RELATIVE claim survives.
    const positionRatio = ratioOf(atPosition);
    for (const rank of DEPTH_RANKS) {
      const inCell = atPosition.filter((observation) => observation.rank === rank);
      const cellRatio = ratioOf(inCell);
      const weight = inCell.length / (DEPTH_CELL_PRIOR + inCell.length);
      const relative = cellRatio === null || positionRatio === null || positionRatio <= 0 ? 1 : cellRatio / positionRatio;
      cells[rank] = 1 * (1 - weight) + relative * weight;
    }
    bySnapShare[position] = cells;
  }
  return { bySnapShare, bound };
}

/** Mean actual over mean projected, or null where the group says nothing. */
function ratioOf(observations: readonly DepthObservation[]): number | null {
  if (observations.length === 0) return null;
  const projected = observations.reduce((sum, observation) => sum + observation.projectedSnapShare, 0);
  const actual = observations.reduce((sum, observation) => sum + observation.actualSnapShare, 0);
  return projected <= 0 ? null : actual / projected;
}

/** What one player-season contributes to the career-stage fit. */
export interface CareerObservation {
  readonly season: number;
  readonly playerId: string;
  readonly position: Position;
  /** Which stage of a career he was in, or null where the release carries no entry year. */
  readonly band: ExperienceBand | null;
  /**
   * The board's own projected season points for him, with every other feature on and this one off.
   * Fitted against the number it will later multiply, following `fitStatusMultipliers`' correction.
   */
  readonly projectedPoints: number;
  /** What he actually scored over the regular season. ZERO for a man who never dressed. */
  readonly actualPoints: number;
}

export interface CareerFitOptions {
  readonly heldOutSeasons: readonly number[];
  /** Chosen, not fitted. See `CareerPriors.bound`. */
  readonly bound?: number;
}

/**
 * How many player-seasons of "a career stage says nothing" each cell is shrunk toward.
 *
 * Twenty cells over two fit seasons leaves the thinnest (a third-year quarterback) at a few dozen,
 * and an unshrunk cell of that size would assert a curve from the handful of men in it. Shrinking
 * toward one — the null hypothesis that career stage adds nothing — is the conservative direction:
 * a cell has to earn its correction. Larger than the depth chart's twenty because a career band is
 * a much weaker claim about any one player than his club's own published ordering is.
 */
const CAREER_CELL_PRIOR = 40;

/**
 * THE CAREER CURVE, fitted on the fit seasons and normalised within the position.
 *
 * THE POPULATION IS EVERY MAN THE BOARD PROJECTS, WITH ABSENTEES AT ZERO, and that is the whole
 * methodology. The first version of this diagnosis measured the same quantity over players who
 * appeared in a box score and found a reserve-list cell three games out of true; the cell was fine
 * and the measurement was conditioning on the outcome, because a man who never played has no line
 * to be measured on and drops out. `news/adjust.ts` made the same call for the same reason and it is
 * the difference between a correction and a selection effect. Here the absent man scores zero,
 * which is what he scored.
 *
 * A RATIO OF TOTALS RATHER THAN A MEAN OF RATIOS, because a ratio of one man's points to his
 * projection is unbounded when the projection is small and the cell would then be decided by the
 * noisiest rows in it. The totals ratio asks the question a board is actually judged on: did this
 * cohort take the share of the position's points the board gave it.
 */
export function fitCareerPriors(
  observations: readonly CareerObservation[],
  { heldOutSeasons, bound = 0.35 }: CareerFitOptions,
): CareerPriors {
  const forbidden = new Set(heldOutSeasons);
  for (const observation of observations) {
    if (forbidden.has(observation.season)) {
      throw new Error(
        `The career-stage fit was handed ${observation.season}, which is held out. A parameter fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }

  const byExperience = {} as Record<Position, Record<ExperienceBand, number>>;
  for (const position of ALL_POSITIONS) {
    const atPosition = observations.filter((observation) => observation.position === position);
    // The position's own overall correction, divided out below so only the RELATIVE claim survives.
    // A curve that levelled a whole position against the others would be papering over a defect in
    // layer 3, which is that layer's to fix and not this table's to hide.
    const positionRatio = pointsRatioOf(atPosition);
    const cells = {} as Record<ExperienceBand, number>;
    for (const band of EXPERIENCE_BANDS) {
      const inCell = atPosition.filter((observation) => observation.band === band);
      const cellRatio = pointsRatioOf(inCell);
      const weight = inCell.length / (CAREER_CELL_PRIOR + inCell.length);
      const relative = cellRatio === null || positionRatio === null || positionRatio <= 0 ? 1 : cellRatio / positionRatio;
      cells[band] = 1 * (1 - weight) + relative * weight;
    }
    byExperience[position] = cells;
  }
  return { byExperience, bound };
}

/** Total actual points over total projected points, or null where the group says nothing. */
function pointsRatioOf(observations: readonly CareerObservation[]): number | null {
  if (observations.length === 0) return null;
  const projected = observations.reduce((sum, observation) => sum + observation.projectedPoints, 0);
  const actual = observations.reduce((sum, observation) => sum + observation.actualPoints, 0);
  return projected <= 0 ? null : actual / projected;
}
