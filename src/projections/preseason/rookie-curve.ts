import type { Position } from "@/domain/player";
import type { ReadonlyDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import { isotonicNonIncreasing } from "../isotonic";
import { statLinesAsOfForMeasurement } from "../nflverse/derived-stat-lines";
import { draftPicksFor } from "../nflverse/draft-picks";
import { projectedPosition } from "../nflverse/players";
import { LAST_POSSIBLE_WEEK } from "../store";
import { teamGamesIn } from "./availability";
import { FITTED_HISTORICAL_ROOKIE_GAMES_RATE, FITTED_ROOKIE_CURVE_EVIDENCE } from "./rookie-historical-games-fitted";
import { FITTED_ROOKIE_CURVE } from "./rookie-curve-fitted";

/**
 * THE DRAFT-CAPITAL CURVE — expected ROOKIE-SEASON fantasy points, by position and overall pick,
 * fit directly against outcomes instead of assumed to shape like anything in particular.
 *
 * `rookies.ts`'s existing prior fits SHARES (snap/target/carry/pass-attempt) in six draft-round
 * buckets and interpolates them LINEARLY IN THE RAW PICK NUMBER between adjacent bucket anchors —
 * `alongTheCapitalCurve`'s own doing. That linear-in-pick assumption is a convenience, not a
 * measurement: draft capital's value does not fall in a straight line from pick 17 to pick 49, it
 * falls fast off the top of round one and flattens by the middle rounds, which is exactly the shape
 * a real trade-value chart has always drawn. This module measures that shape directly, in POINTS
 * rather than in shares, so `rookies.ts` can shape its OWN interpolation against it — see
 * `capitalCurveWeight` there for how.
 *
 * FIT ON TRAIN SEASONS ONLY: every observation this curve is fit from has a pick season of
 * `ROOKIE_CURVE_TRAIN_CUTOFF_SEASON` (2021) or earlier. `fitRookieCurve` throws if handed a later
 * one, and `rookie-curve-fit.ts` — the only script that calls it for real — passes that exact bound.
 * This is a DIFFERENT, and deliberately more conservative, boundary than `model/fitted.ts`'s
 * `FIT_SEASONS` ([2021, 2022]): this task's own brief fixes it at 2021, so 2022 stays fully
 * available for a later task's held-out scoring of this curve.
 *
 * MONOTONE-DECREASING BY CONSTRUCTION. `fitRookieCurve` runs a weighted isotonic regression (the
 * pool-adjacent-violators algorithm) over each position's own (pick, mean points) pairs — no search,
 * no assumed functional form, just the constraint every reader would insist on anyway: a team giving
 * up more draft capital for a player cannot imply a LOWER expected rookie season. `rookieCurve`
 * interpolates linearly between the fitted knots, which keeps the composed function monotone
 * non-increasing too (a piecewise-linear function through a non-increasing sequence of knot values
 * is itself non-increasing).
 */

/** The four positions this curve is fit for — the whole preseason board projects nothing else. */
const CURVE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type CurvePosition = (typeof CURVE_POSITIONS)[number];

function isCurvePosition(position: Position): position is CurvePosition {
  return (CURVE_POSITIONS as readonly Position[]).includes(position);
}

/** The last rookie class this curve may be fit against. See the module docblock. */
export const ROOKIE_CURVE_TRAIN_CUTOFF_SEASON = 2021;

/**
 * THE MOMENT THE FIT READS AT — far past any correction, exactly `preseason/source.ts`'s own
 * `FINAL_OUTCOME` and for the identical reason: a fit is measuring seasons that are over, not
 * predicting one that is not, so it reads the final corrected line rather than a point-in-time one.
 */
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

/** One rookie's own pick season, at one position and one overall pick. */
export interface RookieCurveObservation {
  readonly season: number;
  readonly position: CurvePosition;
  readonly overallPick: number;
  /**
   * Total PPR fantasy points over his rookie season. ZERO for a rookie who never recorded a stat
   * line — counted rather than dropped, because the curve answers "what should this pick be
   * EXPECTED to score", the unconditional question `rookies.ts`'s own `capitalGameRate` answers for
   * shares, not "what does he score conditional on making the field".
   */
  readonly points: number;
  /**
   * Games with a recorded stat line that season (calibration fix round, 2026-09-04, Task 2) — the
   * SAME population `points` is summed over, counted the same unconditional way: zero for a rookie
   * who never dressed, never dropped. `fitHistoricalRookieGamesRate` uses this, alongside
   * `teamGames`, to measure the games-played rate this curve's own POINTS were actually produced
   * against — see that function's own docblock for why the points curve needs a matching
   * denominator at all.
   */
  readonly gamesPlayed: number;
  /** His own season's team-game count (`teamGamesIn`) — the denominator `gamesPlayed` is a share of. */
  readonly teamGames: number;
}

/**
 * One draft class's outcomes, read from the dedicated draft-pick table and joined to each pick's
 * OWN pick season's stat lines.
 *
 * ROOKIE IDENTIFICATION is the row itself: `nfl_draft_picks.season` IS the season a pick's rookie
 * year is measured in, the same rule `rookies.ts`/`source.ts` apply via `roster.draftYear === season`
 * — there is no ambiguity to resolve here because a draft-pick row only ever describes one season.
 *
 * `statLinesAsOfForMeasurement` rather than plain `statLinesAsOf`: 2019 sits inside the seasons this
 * curve trains on and nflverse never published that season's weekly file at all
 * (`nflverse/stat-lines.ts`'s `STAT_LINE_GAPS`). Reading the published-only source would silently
 * zero out the entire 2019 rookie class rather than leaving it out — the exact false-zero
 * `measure-laws.ts` admits the pbp-derived fallback to avoid, and for the same reason: this is an
 * offline measurement of a completed season, never a point-in-time product read.
 */
export async function loadRookieCurveObservations(db: ReadonlyDb, seasons: readonly number[]): Promise<readonly RookieCurveObservation[]> {
  const observations: RookieCurveObservation[] = [];
  for (const season of seasons) {
    const picks = await draftPicksFor(db, [season]);
    if (picks.length === 0) continue;
    const lines = await statLinesAsOfForMeasurement(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });
    const byPlayer = new Map<string, (typeof lines)[number]["line"][]>();
    for (const { line } of lines) {
      const forPlayer = byPlayer.get(line.playerId) ?? [];
      forPlayer.push(line);
      byPlayer.set(line.playerId, forPlayer);
    }
    for (const pick of picks) {
      const position = projectedPosition(pick.position);
      if (position === null || !isCurvePosition(position)) continue;
      const weeks = byPlayer.get(pick.playerId) ?? [];
      const points = weeks.reduce((sum, line) => sum + computeFantasyPoints(line, position, PPR_SCORING), 0);
      observations.push({ season, position, overallPick: pick.pick, points, gamesPlayed: weeks.length, teamGames: teamGamesIn(season) });
    }
  }
  return observations;
}

/** One fitted point on the curve: the pick a mean was measured at, and the isotonic value there. */
export interface RookieCurveKnot {
  readonly pick: number;
  readonly points: number;
}

/** The fitted curve: one ascending, non-increasing knot sequence per position. */
export type RookieCurvePriors = Readonly<Record<CurvePosition, readonly RookieCurveKnot[]>>;

export interface RookieCurveFitOptions {
  /**
   * EXTRA seasons to refuse, beyond the structural `ROOKIE_CURVE_TRAIN_CUTOFF_SEASON` gate every
   * call gets for free — an interior season a caller wants excluded from one particular fit (a
   * held-out validation run, say) without moving the module-wide cutoff. Not what keeps 2022+ out:
   * that is `fitRookieCurve` itself, unconditionally.
   */
  readonly heldOutSeasons: readonly number[];
}

/**
 * THE TRAIN-WINDOW GUARD, shared by every fit this module runs against `RookieCurveObservation`s.
 *
 * STRUCTURAL, not caller discipline: `ROOKIE_CURVE_TRAIN_CUTOFF_SEASON` is the contract this whole
 * module is fit under, so it is enforced here directly rather than trusted to whatever
 * `heldOutSeasons` a caller happened to pass. A fix round caught an earlier version of this gate
 * sitting entirely behind `heldOutSeasons` — `rookie-curve-fit.ts` passed `[]`, so the guard the
 * module docblock and the generated file's own header advertised never armed.
 */
function assertRookieCurveTrainWindow(observations: readonly RookieCurveObservation[], heldOutSeasons: readonly number[]): void {
  const forbidden = new Set(heldOutSeasons);
  for (const observation of observations) {
    if (observation.season > ROOKIE_CURVE_TRAIN_CUTOFF_SEASON) {
      throw new Error(
        `The rookie curve fit was handed ${observation.season}, which is past ROOKIE_CURVE_TRAIN_CUTOFF_SEASON ` +
          `(${ROOKIE_CURVE_TRAIN_CUTOFF_SEASON}) and therefore held out by construction. A curve fitted on a season ` +
          `it is later scored on is not a measurement.`,
      );
    }
    if (forbidden.has(observation.season)) {
      throw new Error(
        `The rookie curve fit was handed ${observation.season}, which is held out. A curve fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }
}

/**
 * FITTING THE DRAFT-CAPITAL CURVE — one isotonic regression per position, on the fit seasons' own
 * (pick, mean points) pairs, and nothing else. No shrinkage, no search: `rookies.ts`'s bucket fit
 * already carries the shrunk, cautious version of this signal in its `byBucket` shares, and this
 * curve's whole job is to add the pick-to-pick SHAPE that a six-cell table cannot — see the module
 * docblock.
 */
export function fitRookieCurve(observations: readonly RookieCurveObservation[], { heldOutSeasons }: RookieCurveFitOptions): RookieCurvePriors {
  assertRookieCurveTrainWindow(observations, heldOutSeasons);

  const result = {} as Record<CurvePosition, readonly RookieCurveKnot[]>;
  for (const position of CURVE_POSITIONS) {
    const byPick = new Map<number, { sum: number; count: number }>();
    for (const observation of observations) {
      if (observation.position !== position) continue;
      const cell = byPick.get(observation.overallPick) ?? { sum: 0, count: 0 };
      cell.sum += observation.points;
      cell.count += 1;
      byPick.set(observation.overallPick, cell);
    }
    const picks = [...byPick.keys()].sort((a, b) => a - b);
    const means = picks.map((pick) => byPick.get(pick)!.sum / byPick.get(pick)!.count);
    const weights = picks.map((pick) => byPick.get(pick)!.count);
    const fitted = isotonicNonIncreasing(means, weights);
    result[position] = picks.map((pick, index) => ({ pick, points: fitted[index]! }));
  }
  return result;
}

/**
 * THE CURVE'S OWN GAMES-PLAYED RATE, by position (calibration fix round, 2026-09-04, Task 2) — one
 * scalar per position, over the IDENTICAL 2003-2021 population `fitRookieCurve` measures its points
 * against, counted the same unconditional way (a rookie who never dressed contributes a zero).
 *
 * WHY THE POINTS CURVE NEEDS THIS AT ALL. `rookieCurve(position, pick)` returns a SEASON
 * expectation that already has THAT historical population's own typical rookie availability baked
 * into it — the mean is over the whole class, survivors and non-dressers alike, exactly like
 * `rookies.ts`'s `capitalGameRate` was before this fix round. The board used to divide that season
 * number by the CURRENT PLAYER's own `games.expected` to fabricate a per-game rate — mixing a
 * population-level historical season total with an individual, board-specific games estimate that
 * has nothing to do with the population the curve was fitted on. `market/blend.ts`'s
 * `recomposeRookieSeasonPoints` divides by THIS instead: `rookieCurve(pick) / historicalGamesRate *
 * teamGamesIn(season)` gives the honest per-game rate the SAME population's points curve implies,
 * which is then multiplied back out by Task 1's OWN, separately-fitted availability distribution
 * (`candidate.games.expected`) — two honestly-sourced numbers composed together rather than one
 * population's season total divided by an unrelated population's per-player estimate.
 *
 * A SINGLE SCALAR PER POSITION, DELIBERATELY, rather than a second pick-indexed curve. The points
 * curve needs pick-level resolution because draft capital's value visibly does not fall in a
 * straight line; a rookie's games-played rate is a far flatter relationship against pick number
 * than his expected production is, so a single, well-populated per-position mean is the honest
 * measurement this round can defend rather than a pick-level curve thin enough at the extremes to
 * reintroduce the exact instability Task 1 just fixed. This is a documented simplification, not an
 * oversight — `docs/research/2026-09-04-rookie-calibration-backtest.md` reports its sensitivity.
 */
export interface HistoricalRookieGamesRate {
  readonly byPosition: Readonly<Record<CurvePosition, number>>;
}

export function fitHistoricalRookieGamesRate(
  observations: readonly RookieCurveObservation[],
  { heldOutSeasons }: RookieCurveFitOptions,
): HistoricalRookieGamesRate {
  assertRookieCurveTrainWindow(observations, heldOutSeasons);

  const byPosition = {} as Record<CurvePosition, number>;
  for (const position of CURVE_POSITIONS) {
    const atPosition = observations.filter((observation) => observation.position === position);
    const totalGames = atPosition.reduce((sum, observation) => sum + observation.gamesPlayed, 0);
    const totalTeamGames = atPosition.reduce((sum, observation) => sum + observation.teamGames, 0);
    byPosition[position] = totalTeamGames > 0 ? totalGames / totalTeamGames : 0;
  }
  return { byPosition };
}

/**
 * `historicalRookieExpectedGames(position, season)` — the mean games a rookie of this position, over
 * the whole 2003-2021 class, played in a season of `teamGamesIn(season)` games. Reads the committed
 * fit by default, exactly like `rookieCurve` reads `FITTED_ROOKIE_CURVE`.
 */
export function historicalRookieExpectedGames(
  position: Position,
  season: number,
  priors: HistoricalRookieGamesRate = FITTED_HISTORICAL_ROOKIE_GAMES_RATE,
): number {
  if (!isCurvePosition(position)) return 0;
  return priors.byPosition[position] * teamGamesIn(season);
}

/**
 * THE CURVE'S OWN EVIDENCE COUNT, per pick (calibration fix round, 2026-09-04, Task 3) — how many
 * real historical rookie-seasons fed the points knot at (or nearest) a given pick, over the SAME
 * 2003-2021 population `fitRookieCurve` fits its points against.
 *
 * WHAT THIS IS FOR: `market/thin-evidence-shrink.ts`'s `shrinkTowardMarket` needs a measure of "how
 * much real evidence backs our own number" for a rookie, and the honest answer is the exact count of
 * historical rookie-seasons the curve's own knot at his pick was built from — the same quantity the
 * module docblock's "n of about 1-2 observations" describes for the earliest picks. A rookie whose
 * curve value came from nineteen years of similarly-drafted comparables is well evidenced; one whose
 * value came from a single unlucky bust is not, however confident the resulting number LOOKS.
 */
export interface RookieCurveEvidence {
  readonly byPosition: Readonly<Record<CurvePosition, readonly { readonly pick: number; readonly n: number }[]>>;
}

export function fitRookieCurveEvidence(
  observations: readonly RookieCurveObservation[],
  { heldOutSeasons }: RookieCurveFitOptions,
): RookieCurveEvidence {
  assertRookieCurveTrainWindow(observations, heldOutSeasons);

  const byPosition = {} as Record<CurvePosition, readonly { pick: number; n: number }[]>;
  for (const position of CURVE_POSITIONS) {
    const counts = new Map<number, number>();
    for (const observation of observations) {
      if (observation.position !== position) continue;
      counts.set(observation.overallPick, (counts.get(observation.overallPick) ?? 0) + 1);
    }
    const picks = [...counts.keys()].sort((a, b) => a - b);
    byPosition[position] = picks.map((pick) => ({ pick, n: counts.get(pick)! }));
  }
  return { byPosition };
}

/**
 * `rookieCurveEvidenceN(position, overallPick)` — the evidence count NEAREST a pick, for a position
 * this curve carries no exact knot for at that precise number (a pick a real draft produced that the
 * 2003-2021 window never happened to see at exactly that slot). Zero for a position this curve does
 * not cover, matching `rookieCurve`'s own contract.
 */
export function rookieCurveEvidenceN(
  position: Position,
  overallPick: number,
  evidence: RookieCurveEvidence = FITTED_ROOKIE_CURVE_EVIDENCE,
): number {
  if (!isCurvePosition(position)) return 0;
  const knots = evidence.byPosition[position];
  if (knots.length === 0) return 0;
  let nearest = knots[0]!;
  let nearestDistance = Math.abs(overallPick - nearest.pick);
  for (const knot of knots) {
    const distance = Math.abs(overallPick - knot.pick);
    if (distance < nearestDistance) {
      nearest = knot;
      nearestDistance = distance;
    }
  }
  return nearest.n;
}

/**
 * The unclamped read: expected rookie-season points, interpolated linearly between the fit's two
 * nearest picks and clamped only at the ENDS of the curve (see `rookieCurve`'s own docblock for the
 * clamp `rookieCurve` itself applies afterward, which is a different thing — a floor at zero, not an
 * extrapolation guard).
 */
function rawRookieCurve(position: Position, overallPick: number, priors: RookieCurvePriors): number {
  if (!isCurvePosition(position)) return 0;
  const knots = priors[position];
  if (knots.length === 0) return 0;
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  // Clamped rather than extrapolated at both ends. Above the earliest fitted pick there is no
  // measured knot to run toward, and inventing a steeper first pick would be a curve nobody fitted
  // — the identical discipline `rookies.ts`'s own `alongTheCapitalCurve` applies at the bucket
  // table's own ends.
  if (overallPick <= first.pick) return first.points;
  if (overallPick >= last.pick) return last.points;

  const aboveIndex = knots.findIndex((knot) => overallPick <= knot.pick);
  const below = knots[aboveIndex]!;
  const above = knots[aboveIndex - 1]!;
  const weight = (overallPick - above.pick) / (below.pick - above.pick);
  return above.points + (below.points - above.points) * weight;
}

/**
 * `rookieCurve(position, overallPick)` — expected rookie-season points, read from the committed fit.
 *
 * CLAMPED AT ZERO. The isotonic fit itself is not floored — a handful of the latest QB picks (the
 * seventh-round/UDFA tail, where a rookie's whole rookie season is a mop-up interception or two and
 * nothing else) fit to a mean a shade below zero, and that is an honest measurement of what those
 * picks actually did. It is also not a number a CONSUMER of this curve should ever see: Task 10
 * reads `rookieCurve` as a POINTS BASELINE inside a blend, and a points baseline is non-negative by
 * construction — nobody is worth negative fantasy points before a single snap. The sub-zero tail
 * carries no usable signal past "this pick is worth approximately nothing", which zero already says.
 * The clamp lives HERE, in the accessor, rather than in the fit: the committed constants stay the
 * honest, unfloored measurement, and `fitRookieCurve`/`rookie-curve-fitted.ts` are unaffected by it.
 *
 * Returns 0 for a position this curve carries no knots for (`K`, `DEF` — never drafted onto a board
 * this engine projects) rather than throwing, so a generic caller iterating every `Position` never
 * has to special-case the two this curve does not cover — which the clamp now makes true by
 * construction rather than by coincidence.
 */
export function rookieCurve(position: Position, overallPick: number, priors: RookieCurvePriors = FITTED_ROOKIE_CURVE): number {
  return Math.max(0, rawRookieCurve(position, overallPick, priors));
}
