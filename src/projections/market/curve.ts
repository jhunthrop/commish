import type { Position } from "@/domain/player";
import type { ReadonlyDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import { isotonicNonIncreasing } from "../isotonic";
import { statLinesAsOfForMeasurement } from "../nflverse/derived-stat-lines";
import { projectedPosition } from "../nflverse/players";
import { LAST_POSSIBLE_WEEK } from "../store";
import { BENCHMARK_SOURCES } from "../preseason/benchmarks";
import { preseasonMomentFor } from "../preseason/source";
import { preseasonRankingsAsOf, preseasonRostersAsOf } from "../preseason/store";
import { FITTED_MARKET_CURVE } from "./curve-fitted";

/**
 * THE MARKET CURVE — expected SEASON fantasy points, by position and average draft position, fit
 * directly against outcomes instead of assumed to shape like anything in particular.
 *
 * `rookie-curve.ts` turns draft CAPITAL (an NFL team's own investment) into an expected rookie
 * season. This does the identical measurement for draft ROOM (twelve fantasy managers' own August
 * consensus): where a real market, not a panel and not our own board, put a player before a single
 * snap. Task 10 blends this in as the prior a fantasy market actually believes, the same way the
 * rookie curve already blends in as the prior an NFL front office believes — and both curves exist
 * so that belief is measured, never guessed at.
 *
 * SOURCE, REUSED RATHER THAN INVENTED. `preseason/benchmarks.ts`'s `BENCHMARK_SOURCES.adp`
 * (`ffc_adp_ppr_12`) is the ONLY average-draft-position feed this engine ever ingests, resolved to
 * our own player ids once, at ingestion, by `resolveRankings` and written to `preseason_rankings`.
 * This module reads that exact table through `preseason/store.ts`'s existing readers
 * (`preseasonRankingsAsOf`, `preseasonRostersAsOf` for the position each ranked player played) —
 * precisely how `preseason-report.ts` scores a board against the market benchmark today. There is a
 * SECOND, unrelated place ADP appears in this repository: `capture.ts`'s CURRENT-season snapshot
 * feeds, captured verbatim from a live provider with no history endpoint. That path is for a LIVE
 * board being built THIS week and carries no season of history to fit a curve against; it is not
 * read here and never will be — see `capture.ts`'s own docblock for why it exists at all.
 *
 * FIT ON TRAIN SEASONS ONLY, `HISTORICAL_ROSTER_FLOOR` (2013) through
 * `MARKET_CURVE_TRAIN_CUTOFF_SEASON` (2021) inclusive — the identical window `rookie-curve.ts` fits
 * on, for the identical reason: `HISTORICAL_ROSTER_FLOOR` is where this repository's weekly stat
 * lines are actually backfilled to, and 2021 is this task's own boundary, enforced structurally
 * exactly like the rookie curve's (`fitMarketCurve` throws on a season past it, unconditionally —
 * see the module docblock note on Task 4's inert-gate finding, which is why the throw lives inside
 * the fit rather than behind `heldOutSeasons` alone).
 *
 * SEASON-AGNOSTIC BY DESIGN, not season-by-season. A draft-capital curve gets real repetition at
 * each pick within ONE class already (several rookies a year share a pick only rarely, but a whole
 * decade of classes gives PAVA real weight per knot). An ADP board has NO repetition within a single
 * season at all: `ffc_adp_ppr_12`'s rank is a fractional AVERAGE draft position, so within one
 * season almost every rank is claimed by exactly one player — a per-season fit would be one isotonic
 * regression over near-singleton buckets, which is not a smoothed curve, it is the raw board wearing
 * a different hat. Pooling every train season's (rounded rank, season points) pairs together is what
 * gives each rank bucket the repetition PAVA needs to average out one year's specific injury luck or
 * landing-spot bust from the next's. `marketCurve`'s signature is therefore `(position, adpRank)`,
 * with no season parameter — Task 10 reads the SAME curve for whichever season it blends into,
 * identically to how `rookieCurve(position, overallPick)` carries no season either.
 *
 * MONOTONE-DECREASING BY CONSTRUCTION, via the SAME weighted isotonic (pool-adjacent-violators) fit
 * `rookie-curve.ts` uses — `isotonic.ts` is the one shared implementation both curves call, proven
 * once. A market that drafted a player earlier cannot imply a LOWER expected season, and PAVA is
 * what makes that true of the fitted knots without ever assuming a functional shape for the curve
 * between them.
 */

/** The four positions this curve is fit for — the whole preseason board projects nothing else. */
const CURVE_POSITIONS = ["QB", "RB", "WR", "TE"] as const;
type CurvePosition = (typeof CURVE_POSITIONS)[number];

function isCurvePosition(position: Position): position is CurvePosition {
  return (CURVE_POSITIONS as readonly Position[]).includes(position);
}

/** The last predictor season this curve may be fit against. See the module docblock. */
export const MARKET_CURVE_TRAIN_CUTOFF_SEASON = 2021;

/**
 * THE MOMENT THE FIT READS AT — far past any correction, exactly `rookie-curve.ts`'s own
 * `FINAL_OUTCOME` and for the identical reason: a fit is measuring seasons that are over, not
 * predicting one that is not, so it reads the final corrected line rather than a point-in-time one.
 */
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

/**
 * A published ADP rank rounded to the nearest whole slot, floored at 1.
 *
 * `ffc_adp_ppr_12` publishes a fractional average (`12.3`), and at FIT time that fraction is noise
 * this curve wants pooled away, not preserved as a distinct bucket — see the module docblock's
 * season-agnostic rationale. `marketCurve` itself is read at any real-valued rank, fractional
 * included; only the FIT bucketing rounds.
 */
function roundedRank(rank: number): number {
  return Math.max(1, Math.round(rank));
}

/** One player's ADP slot in a train season, and what he actually scored that season. */
export interface MarketCurveObservation {
  readonly season: number;
  readonly position: CurvePosition;
  /** Rounded to the nearest whole slot — see `roundedRank`. */
  readonly adpRank: number;
  /**
   * Total PPR fantasy points over his season. ZERO for a drafted man who never recorded a stat
   * line — counted rather than dropped, matching `rookie-curve.ts`'s identical choice: the curve
   * answers "what should this ADP slot be EXPECTED to score", the unconditional question, not
   * "what does he score conditional on staying healthy".
   */
  readonly points: number;
}

/**
 * One season's whole ADP board, joined to that season's own roster (for the position each man
 * played) and that season's own final stat lines (for what he actually scored).
 *
 * `statLinesAsOfForMeasurement` rather than plain `statLinesAsOf`: 2019 sits inside the seasons this
 * curve trains on and nflverse never published that season's weekly file at all
 * (`nflverse/stat-lines.ts`'s `STAT_LINE_GAPS`). Reading the published-only source would silently
 * zero out the entire 2019 board rather than leaving it out — the exact false-zero `measure-laws.ts`
 * admits the pbp-derived fallback to avoid, and for the same reason `rookie-curve.ts` reads through
 * the identical function: this is an offline measurement of a completed season, never a point-in-time
 * product read, so admitting the derived fallback here is the C2-adjacent ruling applied a second
 * time rather than a new decision.
 *
 * A board row whose player has no position on that season's own roster (never ingested, or ingested
 * only as a position this curve does not carry — `K`, `DEF`) is DROPPED rather than guessed at.
 */
export async function loadMarketCurveObservations(db: ReadonlyDb, seasons: readonly number[]): Promise<readonly MarketCurveObservation[]> {
  const observations: MarketCurveObservation[] = [];
  for (const season of seasons) {
    const board = await preseasonRankingsAsOf(db, { season, source: BENCHMARK_SOURCES.adp, asOf: FINAL_OUTCOME });
    if (board.length === 0) continue;
    const roster = await preseasonRostersAsOf(db, { season, asOf: FINAL_OUTCOME });
    const positionOf = new Map(roster.map((row) => [row.playerId, row.position] as const));
    const lines = await statLinesAsOfForMeasurement(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });
    const byPlayer = new Map<string, (typeof lines)[number]["line"][]>();
    for (const { line } of lines) {
      const forPlayer = byPlayer.get(line.playerId) ?? [];
      forPlayer.push(line);
      byPlayer.set(line.playerId, forPlayer);
    }
    for (const row of board) {
      const raw = positionOf.get(row.playerId);
      const position = raw === undefined ? null : projectedPosition(raw);
      if (position === null || !isCurvePosition(position)) continue;
      const weeks = byPlayer.get(row.playerId) ?? [];
      const points = weeks.reduce((sum, line) => sum + computeFantasyPoints(line, position, PPR_SCORING), 0);
      observations.push({ season, position, adpRank: roundedRank(row.rank), points });
    }
  }
  return observations;
}

/** One fitted point on the curve: the rounded rank a mean was measured at, and the isotonic value there. */
export interface MarketCurveKnot {
  readonly adpRank: number;
  readonly points: number;
}

/** The fitted curve: one ascending, non-increasing knot sequence per position. */
export type MarketCurvePriors = Readonly<Record<CurvePosition, readonly MarketCurveKnot[]>>;

export interface MarketCurveFitOptions {
  /**
   * EXTRA seasons to refuse, beyond the structural `MARKET_CURVE_TRAIN_CUTOFF_SEASON` gate every
   * call gets for free — an interior season a caller wants excluded from one particular fit (a
   * held-out validation run, say) without moving the module-wide cutoff. Not what keeps 2022+ out:
   * that is `fitMarketCurve` itself, unconditionally.
   */
  readonly heldOutSeasons: readonly number[];
}

/**
 * FITTING THE MARKET CURVE — one isotonic regression per position, on the fit seasons' own
 * (rounded rank, mean points) pairs, and nothing else.
 *
 * THE GATE IS UNCONDITIONAL. Task 4's fix round found the rookie curve's identical guard armed
 * ONLY through `heldOutSeasons`, which every real caller passed as `[]` — so the guard the module
 * docblock advertised never actually fired. This gate is written the same way from the start:
 * `MARKET_CURVE_TRAIN_CUTOFF_SEASON` is checked directly against every observation's own season,
 * never trusted to whatever `heldOutSeasons` a caller happened to supply.
 */
export function fitMarketCurve(observations: readonly MarketCurveObservation[], { heldOutSeasons }: MarketCurveFitOptions): MarketCurvePriors {
  const forbidden = new Set(heldOutSeasons);
  for (const observation of observations) {
    if (observation.season > MARKET_CURVE_TRAIN_CUTOFF_SEASON) {
      throw new Error(
        `The market curve fit was handed ${observation.season}, which is past MARKET_CURVE_TRAIN_CUTOFF_SEASON ` +
          `(${MARKET_CURVE_TRAIN_CUTOFF_SEASON}) and therefore held out by construction. A curve fitted on a season ` +
          `it is later scored on is not a measurement.`,
      );
    }
    if (forbidden.has(observation.season)) {
      throw new Error(
        `The market curve fit was handed ${observation.season}, which is held out. A curve fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }

  const result = {} as Record<CurvePosition, readonly MarketCurveKnot[]>;
  for (const position of CURVE_POSITIONS) {
    const byRank = new Map<number, { sum: number; count: number }>();
    for (const observation of observations) {
      if (observation.position !== position) continue;
      const cell = byRank.get(observation.adpRank) ?? { sum: 0, count: 0 };
      cell.sum += observation.points;
      cell.count += 1;
      byRank.set(observation.adpRank, cell);
    }
    const ranks = [...byRank.keys()].sort((a, b) => a - b);
    const means = ranks.map((rank) => byRank.get(rank)!.sum / byRank.get(rank)!.count);
    const weights = ranks.map((rank) => byRank.get(rank)!.count);
    const fitted = isotonicNonIncreasing(means, weights);
    result[position] = ranks.map((rank, index) => ({ adpRank: rank, points: fitted[index]! }));
  }
  return result;
}

/**
 * The unclamped read: expected season points, interpolated linearly between the fit's two nearest
 * ranks and clamped only at the ENDS of the curve — see `marketCurve`'s own docblock for the
 * different, zero-floor clamp it applies afterward.
 */
function rawMarketCurve(position: Position, adpRank: number, priors: MarketCurvePriors): number {
  if (!isCurvePosition(position)) return 0;
  const knots = priors[position];
  if (knots.length === 0) return 0;
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  // Clamped rather than extrapolated at both ends, matching `rookie-curve.ts`'s identical choice:
  // above the earliest fitted rank there is no measured knot to run toward, and inventing a steeper
  // rank-1 value would be a curve nobody fitted.
  if (adpRank <= first.adpRank) return first.points;
  if (adpRank >= last.adpRank) return last.points;

  const aboveIndex = knots.findIndex((knot) => adpRank <= knot.adpRank);
  const below = knots[aboveIndex]!;
  const above = knots[aboveIndex - 1]!;
  const weight = (adpRank - above.adpRank) / (below.adpRank - above.adpRank);
  return above.points + (below.points - above.points) * weight;
}

/**
 * `marketCurve(position, adpRank)` — expected season points, read from the committed fit.
 *
 * CLAMPED AT ZERO, for the identical reason `rookieCurve` is: Task 10 reads this as a POINTS
 * BASELINE inside a blend, and a points baseline is non-negative by construction. The clamp lives
 * HERE, in the accessor, rather than in the fit — the committed constants stay the honest,
 * unfloored measurement.
 *
 * Returns 0 for a position this curve carries no knots for (`K`, `DEF`) rather than throwing, so a
 * generic caller iterating every `Position` never has to special-case the two this curve does not
 * cover.
 */
export function marketCurve(position: Position, adpRank: number, priors: MarketCurvePriors = FITTED_MARKET_CURVE): number {
  return Math.max(0, rawMarketCurve(position, adpRank, priors));
}

/** One player's resolved market prior for a season's board: his ADP slot and its curve points. */
export interface MarketPriorEntry {
  readonly playerId: string;
  readonly position: Position;
  /** The publisher's own rank, unrounded — `marketCurve` interpolates a real-valued rank directly. */
  readonly adpRank: number;
  readonly marketPoints: number;
}

/** `marketBoard`'s own result: the resolved entries, and how many published rows were dropped along
 *  the way. `droppedCount` is the fix this docblock's own earlier draft promised and never actually
 *  returned — Task 10 (`market/blend.ts`, the first real consumer of a market board) is what caught
 *  it: a board whose whole point is "spend disagreement only where the model can name it" cannot
 *  itself hand its own gaps to a caller only as a length a caller might remember to subtract. */
export interface MarketBoardResult {
  readonly entries: readonly MarketPriorEntry[];
  /** Published ADP rows this function could not resolve to a position — see the function's own
   *  docblock for the two ways that happens. Zero when every published row resolved. */
  readonly droppedCount: number;
}

/**
 * ONE SEASON'S MARKET BOARD — the ADP snapshot a preseason board is entitled to see, resolved to
 * our own player ids and priced through the fitted curve.
 *
 * Taken at `preseasonMomentFor(season)`, THE BOARD'S OWN AS-OF: the identical moment
 * `preseason/source.ts`'s `loadPreseason` builds a whole board at, so a market prior can drop
 * straight into the same blend without smuggling in a later date's ADP than the rest of the board
 * saw.
 *
 * A ranked player whose position cannot be resolved from that season's own roster snapshot (no
 * roster row at all, or a roster row this curve does not carry a position for) is DROPPED rather
 * than guessed at — counted in `droppedCount` rather than silently absorbed into a shorter
 * `entries` array a caller would have to diff against the published board's own size to notice.
 */
export async function marketBoard(
  db: ReadonlyDb,
  season: number,
  priors: MarketCurvePriors = FITTED_MARKET_CURVE,
): Promise<MarketBoardResult> {
  const asOf = await preseasonMomentFor(db, season);
  const board = await preseasonRankingsAsOf(db, { season, source: BENCHMARK_SOURCES.adp, asOf });
  if (board.length === 0) return { entries: [], droppedCount: 0 };
  const roster = await preseasonRostersAsOf(db, { season, asOf });
  const positionOf = new Map(roster.map((row) => [row.playerId, row.position] as const));

  const entries: MarketPriorEntry[] = [];
  let droppedCount = 0;
  for (const row of board) {
    const raw = positionOf.get(row.playerId);
    const position = raw === undefined ? null : projectedPosition(raw);
    if (position === null || !isCurvePosition(position)) {
      droppedCount += 1;
      continue;
    }
    entries.push({ playerId: row.playerId, position, adpRank: row.rank, marketPoints: marketCurve(position, row.rank, priors) });
  }
  return { entries, droppedCount };
}
