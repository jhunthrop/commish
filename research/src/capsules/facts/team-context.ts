import { PBP_METRICS } from "@research/projections/nflverse/pbp";
import { SCHEDULE_METRICS } from "@research/projections/nflverse/schedule";
import type { PlayerFactsTeamContext } from "./types";

/**
 * THE OFFENCE HE PLAYS IN (spec §4, fact 10; inventory rows 10 and 10b).
 *
 * A projection sits inside an environment and the sheet described none of it: pace and pass rate
 * are the numeric fingerprint of whoever is calling the plays (`coaches.ts`'s own words), and the
 * sheet named neither, so the writer had a coaching change and no way to say what the offence it
 * changed actually looked like.
 *
 * THE MEAN OF THE WEEKS THE STORE HOLDS, never of a fixed seventeen — the identical honest rule
 * `coaches.ts`'s `seasonMeans` keeps: a season interrupted by a missing week is a season with fewer
 * weeks in the average, not a season with a zero in it.
 *
 * TWO DIFFERENT SEASONS IN ONE OBJECT, on purpose. Pace, pass rate and wins describe LAST season,
 * because that is the only season anybody has played. The implied team total and the spread describe
 * WEEK ONE of the season being drafted, because that is what the market says about this team now.
 * Mixing them would be a mistake; stating both, each dated, is the point.
 */

/** One team-week metric row, as `collect-depth.ts` reads it off `team_week_observations`. */
export interface TeamMetricRow {
  readonly week: number;
  readonly metric: string;
  readonly value: number;
}

function meanOf(rows: readonly TeamMetricRow[], metric: string, digits: number): number | null {
  const values = rows.filter((row) => row.metric === metric).map((row) => row.value);
  if (values.length === 0) return null;
  const factor = 10 ** digits;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * factor) / factor;
}

function sumOf(rows: readonly TeamMetricRow[], metric: string): number | null {
  const values = rows.filter((row) => row.metric === metric).map((row) => row.value);
  return values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0);
}

function firstOf(rows: readonly TeamMetricRow[], metric: string): number | null {
  return rows.find((row) => row.metric === metric)?.value ?? null;
}

/** One team's context, or `null` when neither store holds a single row about it. The team itself is
 *  NOT a parameter and is not carried on the fact: the sheet's own first line already names his
 *  team, and a second copy of a string is a second string that can disagree with the first. The
 *  caller passes the rows it has already narrowed to that team. */
export function teamContextFor(priorSeason: number, priorRows: readonly TeamMetricRow[], weekOneRows: readonly TeamMetricRow[]): PlayerFactsTeamContext | null {
  const context: PlayerFactsTeamContext = {
    priorSeason,
    paceSecondsPerPlay: meanOf(priorRows, PBP_METRICS.paceSecondsPerPlay, 1),
    passRate: meanOf(priorRows, PBP_METRICS.passRate, 3),
    wins: sumOf(priorRows, SCHEDULE_METRICS.gameResult),
    weekOneImpliedTotal: firstOf(weekOneRows, SCHEDULE_METRICS.impliedTeamTotal),
    weekOneSpread: firstOf(weekOneRows, SCHEDULE_METRICS.pointSpread),
  };
  const stated = [context.paceSecondsPerPlay, context.passRate, context.wins, context.weekOneImpliedTotal, context.weekOneSpread].some((value) => value !== null);
  return stated ? context : null;
}
