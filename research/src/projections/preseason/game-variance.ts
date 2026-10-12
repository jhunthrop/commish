import type { Position } from "@research/domain/player";
import type { ReadonlyDb } from "@research/db/client";
import { PPR_SCORING } from "@research/domain/scoring";
import { computeFantasyPoints } from "@research/scoring/compute";
import type { GamesPlayedOutlook } from "./availability";
import { allPositions } from "../backtest";
import { statLinesAsOfForMeasurement } from "../nflverse/derived-stat-lines";
import { draftPicksFor } from "../nflverse/draft-picks";
import { LAST_POSSIBLE_WEEK } from "../store";

/**
 * PER-GAME PERFORMANCE VARIANCE (calibration fix round, 2026-09-04, Task 4) — the SECOND source a
 * season's floor-ceiling band needs and the one every band on this board was missing entirely.
 *
 * THE DEFECT THIS FIXES. `board.ts`'s season band used to be `perGamePoints * games.distribution`,
 * varying ONLY the games-played term — a veteran with a rock-solid, metronomic per-game rate and one
 * whose per-game output swings wildly week to week got the IDENTICAL band width provided their
 * availability outlooks matched. That mislabels availability risk as the whole of outcome range: a
 * band is supposed to answer "how good or bad could his season be," and a season is uncertain both
 * because he might miss games AND because his OWN per-game performance is itself a random variable,
 * every week, even in a game he plays start to finish.
 *
 * ONE POOLED VARIANCE PER (CLASS, POSITION) CELL — never a per-player estimate, and this is a
 * documented simplification, not an oversight. A player's own weekly points already inform his MEAN
 * per-game rate (that is what layer 1/2/3 already do); asking his own short in-season record to ALSO
 * supply his personal variance would be estimating a second moment from the same handful of games
 * layer 1 already spent estimating the first, which is not enough data to do both honestly. A
 * position-and-class POOLED variance — "how much does a running back's own week-to-week output
 * typically vary around his own season mean" — is a real, measurable quantity from real weekly data
 * and is the honest answer available at draft time, before a single 2026 snap has been played.
 *
 * ROOKIE AND VETERAN GET SEPARATE CELLS, DELIBERATELY, rather than one pooled-across-everyone number
 * per position. A rookie's week-to-week swings (unproven role, a coach still finding his usage,
 * boom/bust workloads as a committee shakes out) are a genuinely different population from a
 * veteran's — and unlike an INDIVIDUAL rookie's own variance (which is definitionally unmeasurable
 * before he has played a game), the POOLED rookie-class variance is measurable directly: nflverse's
 * weekly files already record how much every past rookie class's own points varied week to week
 * inside their own rookie seasons. `loadGameVarianceObservations` splits the two populations by the
 * SAME `draftYear === season` test `rookies.ts`/`source.ts` use everywhere else.
 *
 * FIT ON 2023-2024, PER THIS CALIBRATION ROUND'S OWN REGISTER DISCIPLINE (2025 scores, 2026 held
 * out) — a DIFFERENT window from the rest of the preseason model's `FIT_SEASONS` (2021, 2022), for
 * the identical reason `fit.ts`'s `fitRookieGameRate` gets one: this table is part of THIS
 * calibration effort, not a re-litigation of an existing fit nobody found wrong.
 */
/**
 * K AND DEF JOINED THIS LIST IN THE 2026-09-05 ROUND, and the two most volatile positions in the
 * game finally band on their own measured spread rather than on availability alone. A kicker's week
 * is three attempts or none, and a defence's is a pick six or a 400-yard afternoon; a games-only
 * band understates both badly, which is exactly what `board.ts`'s `gameVarianceFor` used to do for
 * them by returning zero.
 *
 * THEIR CELLS DO NOT COME FROM `fitGameVariance` BELOW. That function's own observation loader reads
 * `player_week_observations`, which has never held a kicker row and can never hold a team-defence
 * row, so asking it for those cells would produce a fabricated zero dressed as a measurement. See
 * `GameVarianceFitOptions.positions` for the guard, and `kicker.ts`/`team-defense.ts` for where the
 * two weekly-points series actually come from.
 */
export const VARIANCE_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"] as const;
export type VariancePosition = (typeof VARIANCE_POSITIONS)[number];

function isVariancePosition(position: Position): position is VariancePosition {
  return (VARIANCE_POSITIONS as readonly Position[]).includes(position);
}

export type PlayerClass = "rookie" | "veteran";

/** One player-season's own weekly fantasy-points line, at the position and class it counts toward. */
export interface GameVarianceObservation {
  readonly season: number;
  readonly playerId: string;
  readonly position: VariancePosition;
  readonly playerClass: PlayerClass;
  /** His own weekly PPR points this season, one entry per week he actually recorded a stat line. A
   *  week with no recorded line is DROPPED rather than counted as a zero — a bye or a game he did not
   *  dress for is availability's own question (`availability.ts`), not evidence about how his PER-GAME
   *  output varies in the games he does play. */
  readonly weeklyPoints: readonly number[];
}

const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

/**
 * Loads one season's worth of weekly points, split into ROOKIE and VETERAN player-seasons by the
 * same `draftYear === season` test the rest of this engine uses. A player the universe carries no
 * position for is skipped — the identical discipline `loadAvailabilityObservations` already applies.
 */
export async function loadGameVarianceObservations(db: ReadonlyDb, seasons: readonly number[]): Promise<readonly GameVarianceObservation[]> {
  const positions = await allPositions(db);
  const observations: GameVarianceObservation[] = [];
  for (const season of seasons) {
    const lines = await statLinesAsOfForMeasurement(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });
    const picks = await draftPicksFor(db, [season]);
    const rookieIds = new Set(picks.map((pick) => pick.playerId));

    const byPlayer = new Map<string, number[]>();
    for (const { line } of lines) {
      const position = positions.get(line.playerId);
      if (position === undefined || !isVariancePosition(position)) continue;
      const points = computeFantasyPoints(line, position, PPR_SCORING);
      const forPlayer = byPlayer.get(line.playerId) ?? [];
      forPlayer.push(points);
      byPlayer.set(line.playerId, forPlayer);
    }
    for (const [playerId, weeklyPoints] of byPlayer) {
      const position = positions.get(playerId);
      if (position === undefined || !isVariancePosition(position)) continue;
      observations.push({
        season,
        playerId,
        position,
        playerClass: rookieIds.has(playerId) ? "rookie" : "veteran",
        weeklyPoints,
      });
    }
  }
  return observations;
}

/**
 * Pooled per-game points VARIANCE, per player class and position — points^2, the unit
 * `seasonPointsBand` needs to compose with a games-count variance.
 *
 * PARTIAL PER POSITION, and deliberately so (the 2026-09-05 round). A cell no fit has ever measured
 * is ABSENT rather than zero, and `board.ts`'s `gameVarianceFor` reads `?? 0` — the games-only band
 * every position had before the variance round. An absent cell and a measured zero are different
 * claims, and a `Record` that could not tell them apart is how a fabricated number gets shipped.
 */
export type GameVariancePriors = Readonly<Record<PlayerClass, Partial<Readonly<Record<VariancePosition, number>>>>>;

/** The four this function's own observation loader can actually measure. See
 *  `GameVarianceFitOptions.positions`. */
const OBSERVABLE_POSITIONS: readonly VariancePosition[] = ["QB", "RB", "WR", "TE"];

export interface GameVarianceFitOptions {
  readonly heldOutSeasons: readonly number[];
  /**
   * Which cells to fit. Defaults to the four skill positions and NOT to all of
   * `VARIANCE_POSITIONS`, because `loadGameVarianceObservations` reads `player_week_observations`,
   * which holds no kicker row and no team-defence row: asking for those cells would pool an empty
   * sample and write 0, a fabricated measurement indistinguishable from a real one. `kdef-fit.ts`
   * passes `["K", "DEF"]` with observations built from the kicking and team-defence archives
   * instead.
   */
  readonly positions?: readonly VariancePosition[];
}

/**
 * THE POOLED (WITHIN-PLAYER-SEASON) VARIANCE ESTIMATOR — the same estimator an ANOVA calls the
 * within-group variance: sum every player-season's own sum of squared deviations from HIS OWN season
 * mean, divide by the sum of degrees of freedom (his own game count minus one), across every
 * player-season in the cell. A player-season with fewer than two recorded weeks contributes nothing
 * — a single game has no within-season spread to measure — rather than a zero that would understate
 * the position's real variance.
 */
function pooledVariance(observations: readonly GameVarianceObservation[]): number {
  let sumSquares = 0;
  let degreesOfFreedom = 0;
  for (const observation of observations) {
    const { weeklyPoints } = observation;
    if (weeklyPoints.length < 2) continue;
    const mean = weeklyPoints.reduce((sum, value) => sum + value, 0) / weeklyPoints.length;
    const squares = weeklyPoints.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    sumSquares += squares;
    degreesOfFreedom += weeklyPoints.length - 1;
  }
  return degreesOfFreedom > 0 ? sumSquares / degreesOfFreedom : 0;
}

/**
 * THE MINIMUM POOLED SAMPLE SIZE (in player-seasons contributing at least two weeks) a cell needs
 * before this fit trusts it as its OWN measurement rather than falling back to the position's
 * combined rookie+veteran pool. Twenty is a documented floor, not a search: below it a single
 * unusual player-season can move a position's whole variance estimate by a large fraction, the exact
 * instability Task 1's isotonic fix exists to guard against elsewhere in this calibration round.
 */
const MINIMUM_POOLED_PLAYER_SEASONS = 20;

export function fitGameVariance(
  observations: readonly GameVarianceObservation[],
  { heldOutSeasons, positions = OBSERVABLE_POSITIONS }: GameVarianceFitOptions,
): GameVariancePriors {
  const forbidden = new Set(heldOutSeasons);
  for (const observation of observations) {
    if (forbidden.has(observation.season)) {
      throw new Error(
        `The per-game variance fit was handed ${observation.season}, which is held out. A parameter fitted on a season it is later scored on is not a measurement.`,
      );
    }
  }

  const result = {} as Record<PlayerClass, Partial<Record<VariancePosition, number>>>;
  for (const playerClass of ["rookie", "veteran"] as const) {
    result[playerClass] = {};
    for (const position of positions) {
      const cell = observations.filter((o) => o.playerClass === playerClass && o.position === position);
      const eligible = cell.filter((o) => o.weeklyPoints.length >= 2);
      if (eligible.length >= MINIMUM_POOLED_PLAYER_SEASONS) {
        result[playerClass][position] = pooledVariance(cell);
        continue;
      }
      // THE FALLBACK: a class/position cell too thin to trust on its own borrows the position's
      // COMBINED rookie+veteran pool instead of asserting its own unstable number — an honest
      // "we cannot separate these populations at this position yet" rather than a confident-looking
      // guess. THIS BRANCH DOES ENGAGE on the 2023-2024 fit: rookie QB has only 15 eligible
      // player-seasons, below `MINIMUM_POOLED_PLAYER_SEASONS` (20), so its own variance cell borrows
      // the combined QB pool rather than the thin rookie-only sample. Every OTHER class/position
      // cell in that fit cleared the threshold on its own; see
      // `docs/research/2026-09-04-rookie-calibration-backtest.md` for the real cell sizes.
      const atPosition = observations.filter((o) => o.position === position);
      result[playerClass][position] = pooledVariance(atPosition);
    }
  }
  return result;
}

/**
 * ONE SEASON BAND, HONESTLY COMPOSED FROM BOTH SOURCES (calibration fix round, 2026-09-04, Task 4).
 *
 * SEASON POINTS = SUM OVER THE GAMES HE PLAYS OF HIS OWN PER-GAME POINTS — a randomly-stopped sum,
 * and the law of total variance for exactly that shape is `Var(season) = E[games] * Var(per-game) +
 * Var(games) * E[per-game]^2`, treating per-game performance as i.i.d. with mean `perGamePoints` and
 * variance `perGameVariance`, independent of how many games he plays. That independence is a
 * documented simplification (a player who gets hurt mid-game contributes a partial week this model
 * does not separately track), not a measured fact, and is the SAME simplification implicit in
 * `board.ts`'s pre-existing `perGamePoints * games` composition for the mean.
 *
 * `Var(games)` is taken EXACTLY off `GamesPlayedOutlook.probabilities` — the beta-binomial's own
 * full distribution `availability.ts` already computes — rather than approximated from the floor and
 * ceiling, since the exact probability vector is already sitting right there.
 *
 * THE TAIL: a normal approximation on the composed mean/variance, at the 10th and 90th percentiles
 * (z = ±1.2816). Season points are not exactly normal (bounded below at zero, a right skew from
 * occasional big games), and this is the documented approximation — `docs/research/2026-09-04-
 * rookie-calibration-backtest.md` reports the REAL coverage this produces against 2025's actual
 * outcomes, which is the honest test of whether the approximation is good enough to ship.
 */
export function seasonPointsBand(
  perGamePoints: number,
  games: GamesPlayedOutlook,
  perGameVariance: number,
): { readonly floor: number; readonly median: number; readonly ceiling: number } {
  return seasonPointsInterval(perGamePoints, games, perGameVariance, Z90);
}

/** The tenth and ninetieth percentiles, which is the band the board renders. */
export const Z90 = 1.2815515655446004;

/**
 * The twenty-fifth and seventy-fifth percentiles — the "most seasons" interval the kicker and team
 * defence preregistration's gate G3 is measured on (the 2026-09-05 round).
 *
 * A DELIBERATE DIFFERENCE FROM THE BAND THE BOARD RENDERS, and it is recorded rather than glossed:
 * the spec names p25 to p75 for that gate and `seasonPointsBand` computes p10 to p90. Rather than
 * measure the gate on a wider interval than the one the spec wrote down (which would make it easier
 * to pass), the judgment computes the named interval from the same composed mean and variance. See
 * the preregistration document for the amendment recording this.
 */
export const Z75 = 0.6744897501960817;

/**
 * The composed interval at an arbitrary z, which both percentile pairs above go through so the two
 * can never be computed from different arithmetic.
 */
export function seasonPointsInterval(
  perGamePoints: number,
  games: GamesPlayedOutlook,
  perGameVariance: number,
  z: number,
  /**
   * HOW WRONG THE PROJECTION ITSELF TYPICALLY IS, in season points squared (the 2026-09-05 kicker
   * and team defence round). Defaults to 0, which is byte-identical to every band this function
   * produced before the parameter existed.
   *
   * THE THIRD SOURCE OF SPREAD, AND THE ONE THIS COMPOSITION WAS MISSING. The two terms above are
   * both about OUTCOMES given a correct projection: how many games he plays, and how much his own
   * weekly output varies around his own season mean. Neither says anything about how far the
   * projected per-game rate is from his real one. That was found on a development check, not
   * argued from theory: the 2013-2023 kicker fit scored on 2024 put only 23.5% of outcomes inside
   * an interval meant to hold 50%, and the missing width is exactly parameter uncertainty. A
   * kicker's projected volume is his club's shrunk attempt rate, and a club's real attempt rate
   * moves season to season by far more than the model's certainty about it implied.
   *
   * MEASURED, NEVER CHOSEN: it is the variance of the residual between what the model projected for
   * a season and what that season actually scored, taken leave-one-season-out over the fit window.
   * See `fitKickerPriors` and `fitDefensePriors`.
   *
   * ADDED RATHER THAN COMPOUNDED, because the projection error and the outcome noise are different
   * random quantities and a variance of a sum of independent terms is the sum of their variances.
   * The independence is a documented simplification, the same class as the one the first two terms
   * already make.
   */
  projectionErrorVariance = 0,
): { readonly floor: number; readonly median: number; readonly ceiling: number } {
  const meanSeason = perGamePoints * games.expected;
  const gamesVariance = games.probabilities.reduce((sum, probability, count) => sum + probability * (count - games.expected) ** 2, 0);
  const seasonVariance =
    games.expected * perGameVariance + gamesVariance * perGamePoints ** 2 + Math.max(0, projectionErrorVariance);
  const sd = Math.sqrt(Math.max(0, seasonVariance));
  return {
    floor: Math.max(0, meanSeason - z * sd),
    median: meanSeason,
    ceiling: meanSeason + z * sd,
  };
}
