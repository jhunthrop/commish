import type { TeamMetricRow } from "@/capsules/facts/team-context";
import { SCHEDULE_METRICS } from "@/projections/nflverse/schedule";
import type { TeamLastSeason, TeamRecord, TeamWinTotal } from "./contract";

/**
 * LAST SEASON'S RECORD AND POINTS ALLOWED, AND THE BOOKS' WIN TOTAL — pure over the team-week
 * rows the store holds, the same `TeamMetricRow` shape `team-context.ts` reads.
 *
 * `game_result` is `1` a win, `0.5` a tie, `0` a loss, emitted only for a game the schedule file
 * carried both scores for (`schedule.ts`), so a count of rows IS a count of games played and a
 * season with no rows is a season with no record, never 0-0.
 */

const WIN = 1;
const TIE = 0.5;

/** The record the result rows sum to, or `null` when there are none. */
export function recordFor(rows: readonly TeamMetricRow[]): TeamRecord | null {
  const results = rows.filter((row) => row.metric === SCHEDULE_METRICS.gameResult).map((row) => row.value);
  if (results.length === 0) return null;
  const wins = results.filter((value) => value === WIN).length;
  const ties = results.filter((value) => value === TIE).length;
  return { wins, losses: results.length - wins - ties, ties };
}

/** Points allowed summed over the weeks that carry the figure, or `null` when none does. */
export function pointsAllowedFor(rows: readonly TeamMetricRow[]): TeamLastSeason["pointsAllowed"] {
  const values = rows.filter((row) => row.metric === SCHEDULE_METRICS.pointsAllowed).map((row) => row.value);
  if (values.length === 0) return null;
  return { points: values.reduce((sum, value) => sum + value, 0), games: values.length };
}

/** Last season as the store states it, or `null` when it holds neither a result nor a score. */
export function lastSeasonFor(season: number, rows: readonly TeamMetricRow[]): TeamLastSeason | null {
  const record = recordFor(rows);
  const pointsAllowed = pointsAllowedFor(rows);
  return record === null && pointsAllowed === null ? null : { season, record, pointsAllowed };
}

/** A win-total row as the vegas ingest writes it: the line, stamped when the book posted it. */
export interface WinTotalRow {
  readonly metric: string;
  readonly value: number;
  readonly asOf: Date;
}

/** The posted win total for `season`, dated, or `null` when the books' file holds none. */
export function winTotalFor(season: number, rows: readonly WinTotalRow[], metric: string): TeamWinTotal | null {
  const line = rows.find((row) => row.metric === metric);
  return line === undefined ? null : { season, line: line.value, asOf: line.asOf.toISOString().slice(0, 10) };
}
