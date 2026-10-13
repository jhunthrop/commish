// THE RECORD PAGE'S READ OF THE REGISTER. Exempt from the register wall by name
// (`projections/register/test-support.ts`'s WALL_EXEMPT_FILES and the eslint quarantine), for the
// reason the season-week steps are: it publishes the register's running score and feeds nothing
// back. Nothing in the nightly run's fit or capsule steps imports this module.
import type { ReadonlyDb } from "@research-ts/db/client";
import { runningScoreboard } from "@research-ts/projections/register/grade";
import { roleOf } from "@research-ts/projections/register/sources";
import { REGISTER_SCORING } from "@research-ts/projections/register/store";
import { describeScoring } from "@research-ts/scoring/describe";
import type { RecordFile } from "../artifacts";

/**
 * The register's running score for `season`, every tracked board and every column, as the record
 * page prints it. The method sentence names what the numbers are, so the page never has to.
 */
export async function readRecord(db: ReadonlyDb, runId: string, season: number): Promise<RecordFile> {
  const scores = await runningScoreboard(db, season);
  return {
    runId,
    season,
    method:
      `Each week's projections were frozen before that week's first kickoff and graded after its last game, ` +
      `scored ${describeScoring(REGISTER_SCORING)}. Spearman is the rank agreement with what players scored, ` +
      `mean absolute rank error how far the order missed on average. ADP and the expert consensus are graded the same way.`,
    columns: scores.map((score) => ({
      boardSource: score.boardSource,
      role: roleOf(score.boardSource),
      column: score.column,
      weeks: score.weeks,
      spearman: score.spearman,
      meanAbsoluteRankError: score.meanAbsoluteRankError,
    })),
  };
}
