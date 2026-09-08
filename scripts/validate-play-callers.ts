// Validates data/play-callers/play-callers.csv and exits nonzero on any problem.
// Run: npm run facts:play-callers
//
// The reading and the checks live in `./lib/play-callers-csv.ts`, shared with `coaches-ingest.ts`
// so the ingest can never write a file this validator would refuse.
import { FACT_SEASONS } from "@/projections/nflverse/team-eras";
import { HEAD_COACH_SEASONS, loadPlayCallers, PLAY_CALLERS_CSV_PATH } from "./lib/play-callers-csv";

const { rows, problems } = loadPlayCallers(PLAY_CALLERS_CSV_PATH);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(
  `${PLAY_CALLERS_CSV_PATH}: ${rows.length} rows, every team-season ${FACT_SEASONS[0]}-${FACT_SEASONS[FACT_SEASONS.length - 1]} covered, head coaches complete for ${HEAD_COACH_SEASONS.join(", ")}`,
);
