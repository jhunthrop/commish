// Validates data/play-callers/play-callers.csv and exits nonzero on any problem.
// Run: npm run facts:play-callers
//
// FAILS LOUDLY when the CSV does not exist yet, rather than treating an absent file as zero rows to
// validate: a missing file and an empty-but-present file are different claims, and only the first is
// "nothing has been assembled here yet". `readFileSync` already throws for a missing path; this
// catches that and re-throws with the fact that matters to whoever is reading the console output —
// which file, and what to do about it — rather than a bare ENOENT with a stack trace.
import { readFileSync } from "node:fs";
import { parsePlayCallers, validatePlayCallers } from "@/projections/nflverse/play-callers";
import { FACT_SEASONS, finalWeekOf, nflTeamsBySeason } from "@/projections/nflverse/team-eras";

const CSV_PATH = "data/play-callers/play-callers.csv";

function readCsv(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot validate play-callers: ${path} does not exist yet (${reason}).`);
  }
}

const csv = readCsv(CSV_PATH);
const rows = parsePlayCallers(csv);
const problems = validatePlayCallers(rows, FACT_SEASONS, nflTeamsBySeason, finalWeekOf);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
console.log(`${CSV_PATH}: ${rows.length} rows, every team-season ${FACT_SEASONS[0]}-${FACT_SEASONS[FACT_SEASONS.length - 1]} covered`);
