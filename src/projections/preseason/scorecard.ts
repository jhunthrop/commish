import type { ReadonlyDb } from "@/db/client";
import type { Position } from "@/domain/player";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import { statLinesAsOf } from "@/projections/lines";
import { RANK_BANDS, scoreCard, type Observation, type RankBandName, type ScoreCard } from "@/projections/metrics";
import type { BoardEntry } from "./board";

/**
 * THE BENCHMARK SCORECARD MACHINERY — extracted from `scripts/preseason-report.ts` (where it was
 * built and first proved out) so `scripts/market-edge-scorecard.ts` (Task 11's own held-out-season
 * run) scores every arm with the IDENTICAL rules, rather than a second, drifting copy of "what
 * counts as a match" and "how a band is assigned." One reader-visible consequence: a number this
 * module returns means the same thing wherever it is printed.
 */

const LAST_REGULAR_WEEK = 18;

/** Far past any correction: outcomes are scored against, never fed in. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");

/** What every player on a board actually scored over the regular season. Zero for a man who never played. */
export async function actualSeasonPoints(
  db: ReadonlyDb,
  season: number,
  positions: ReadonlyMap<string, Position>,
): Promise<ReadonlyMap<string, number>> {
  const rows = await statLinesAsOf(db, { season, week: { from: 1, to: LAST_REGULAR_WEEK }, asOf: FINAL });
  const totals = new Map<string, number>();
  for (const row of rows) {
    const position = positions.get(row.line.playerId);
    if (position === undefined) continue;
    totals.set(row.line.playerId, (totals.get(row.line.playerId) ?? 0) + computeFantasyPoints(row.line, position, PPR_SCORING));
  }
  return totals;
}

/**
 * Scores one ordering against outcomes, banded by a COMMON prior where one is given.
 *
 * Banding by a shared ranking rather than by each source's own is the fix every previous research
 * document in this engine asked for and none could apply: model v1 and model v2 both record that a
 * band-by-band comparison between sources is "indicative rather than exact" because the two arms do
 * not hold the same players in a band, and both name average draft position as the fix. This phase
 * ingested it, so the fix is available here for the first time.
 */
export function scoreOrdering(
  predicted: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
  eligible: ReadonlySet<string>,
  bandBy: ReadonlyMap<string, number> | null,
): { readonly overall: ScoreCard; readonly byBand: Readonly<Record<RankBandName, ScoreCard>> } {
  const rows = [...predicted.entries()]
    .filter(([playerId]) => eligible.has(playerId) && actual.has(playerId))
    .map(([playerId, value]) => ({ playerId, value, actual: actual.get(playerId)! }));

  const order = [...rows].sort((a, b) => {
    if (bandBy === null) return b.value - a.value || a.playerId.localeCompare(b.playerId);
    return (bandBy.get(a.playerId) ?? Infinity) - (bandBy.get(b.playerId) ?? Infinity) || a.playerId.localeCompare(b.playerId);
  });
  const bandOf = new Map(order.map((row, index) => [row.playerId, index + 1] as const));

  const observationsIn = (from: number, to: number): readonly Observation[] =>
    rows
      .filter((row) => {
        const rank = bandOf.get(row.playerId)!;
        return rank >= from && rank <= to;
      })
      .map((row) => ({ predicted: row.value, actual: row.actual }));

  return {
    overall: scoreCard(rows.map((row) => ({ predicted: row.value, actual: row.actual }))),
    byBand: Object.fromEntries(
      RANK_BANDS.map((band) => [band.name, scoreCard(observationsIn(band.from, band.to))]),
    ) as Record<RankBandName, ScoreCard>,
  };
}

export function boardPoints(board: readonly BoardEntry[]): ReadonlyMap<string, number> {
  return new Map(board.map((entry) => [entry.playerId, entry.projectedPoints] as const));
}

export function boardValues(board: readonly BoardEntry[]): ReadonlyMap<string, number> {
  return new Map(board.map((entry) => [entry.playerId, entry.valueOverReplacement] as const));
}
