import { and, eq, max } from "drizzle-orm";
import type { ReadonlyDb } from "@research/db/client";
import { preseasonProjections } from "@research/db/schema";
import { allPositions } from "@research/projections/backtest";
import { HELD_OUT_SEASONS } from "@research/projections/model/fitted";
import { BOARD_SOURCE } from "@research/projections/preseason/board-store";
import { actualSeasonPoints, scoreOrdering } from "@research/projections/preseason/scorecard";
import type { HeldOutScore } from "../artifacts";

/** The served board's newest stored generation for one season: nfl player id to projected points. */
async function storedServedBoard(db: ReadonlyDb, season: number): Promise<ReadonlyMap<string, number>> {
  const [latest] = await db
    .select({ asOf: max(preseasonProjections.asOf) })
    .from(preseasonProjections)
    .where(and(eq(preseasonProjections.season, season), eq(preseasonProjections.source, BOARD_SOURCE)));
  if (latest?.asOf == null) return new Map();
  const rows = await db
    .select({ playerId: preseasonProjections.playerId, points: preseasonProjections.projectedPoints })
    .from(preseasonProjections)
    .where(and(eq(preseasonProjections.season, season), eq(preseasonProjections.source, BOARD_SOURCE), eq(preseasonProjections.asOf, latest.asOf)));
  return new Map(rows.map((row) => [row.playerId, row.points] as const));
}

/**
 * THE HELD-OUT BACKTEST, as the nightly gate reads it: for each held-out season (`HELD_OUT_SEASONS`,
 * never fitted on), the stored served board's points against what every player on it scored. The
 * board is only ever rewritten by the fit, so this number moves only when the fit moved it, and the
 * gate compares it with the last clean run.
 */
export async function heldOutScores(db: ReadonlyDb): Promise<readonly HeldOutScore[]> {
  const positions = await allPositions(db);
  const scores: HeldOutScore[] = [];
  for (const season of HELD_OUT_SEASONS) {
    const board = await storedServedBoard(db, season);
    const actual = await actualSeasonPoints(db, season, positions);
    const { overall } = scoreOrdering(board, actual, new Set(board.keys()), null);
    scores.push({ season, rankCorrelation: overall.rankCorrelation, sampleSize: overall.sampleSize });
  }
  return scores;
}
