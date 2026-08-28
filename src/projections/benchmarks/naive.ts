import { STAT_FIELDS, type StatLine } from "@/domain/player";
import type { SeasonStatLine } from "../lines";

/**
 * THE FLOOR EVERY FUTURE MODEL MUST CLEAR: last season's points per game.
 *
 * The engine spec names three benchmarks — naive, ADP and ECR — and this is the first of them for
 * a blunt reason: if a model cannot beat "he'll do roughly what he did last year", we have
 * nothing, and no amount of feature engineering above it is worth reviewing. It is deliberately
 * the dumbest defensible answer, so that beating it means something.
 *
 * It is expressed as a predicted `StatLine`, not as a number of points, even though "points per
 * game" is how it is described. Two reasons, and both are the spec's own: a projection IS a
 * predicted `StatLine` and there is to be no parallel component type; and `computeFantasyPoints`
 * is linear in the components, so averaging the components and composing gives EXACTLY the same
 * number as averaging the points — while also making the benchmark work unchanged in a superflex
 * TE-premium league, where a points-per-game figure from PPR would be meaningless.
 */

/** The name this benchmark appears under on a scoreboard. */
export const NAIVE_SOURCE_NAME = "naive-prior-season-ppg";

export interface NaiveTarget {
  readonly season: number;
  readonly week: number;
}

/**
 * Averages each player's prior-season components per GAME PLAYED.
 *
 * Games played, not games scheduled: "points per game" is the stated definition of this floor, and
 * dividing by the seventeen a season holds would silently make it a different, much harsher
 * benchmark for anyone who missed time. (Whether that harsher version predicts better is a real
 * question — and one for the harness to answer once there is something to compare, not for this
 * function to decide by arithmetic.)
 *
 * A player with no prior season gets NO projection rather than a projection of zero. Every rookie
 * is invisible to this benchmark, which is its honest and total blind spot; emitting zeros would
 * dress that ignorance up as a confident wrong opinion and score it as one.
 */
export function naiveProjection(
  history: readonly SeasonStatLine[],
  { season, week }: NaiveTarget,
): readonly StatLine[] {
  const priorSeason = season - 1;
  const totals = new Map<string, { games: number; sums: Record<string, number> }>();

  for (const { season: rowSeason, line } of history) {
    if (rowSeason !== priorSeason) continue;
    const running =
      totals.get(line.playerId) ??
      { games: 0, sums: Object.fromEntries(STAT_FIELDS.map((field) => [field, 0])) };
    running.games += 1;
    for (const field of STAT_FIELDS) running.sums[field] += line[field];
    totals.set(line.playerId, running);
  }

  // Sorted by player id rather than left in map order: the caller's history arrives from a database
  // read whose order is stable, but a benchmark whose output order depended on it would make a
  // `ScoreCard` subtly irreproducible, and rank correlation is sensitive to tie ordering.
  return [...totals.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([playerId, { games, sums }]) => ({
      playerId,
      week,
      ...(Object.fromEntries(STAT_FIELDS.map((field) => [field, sums[field]! / games])) as Omit<
        StatLine,
        "playerId" | "week"
      >),
    }));
}
