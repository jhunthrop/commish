// Backfills the two history tables a kicker's and a team defence's projection are composed from.
// Run: npm run projections:kdef:backfill [season ...]   (defaults to 2013 through 2025)
//
// A ONE-SHOT BACKFILL, NOT A JOB, deliberately. Every recurring ingestion in this product registers
// in the owned Postgres job system; this one covers a fixed, closed span of completed seasons that
// will never change again, so a scheduled re-run would be work that can only ever report zero. The
// current season's own kicking and defence lines arrive through the live stats feed, not here.
//
// 2026 IS NOT IN THE DEFAULT SPAN AND MUST NOT BE ADDED TO IT. The data year is held out
// (`docs/superpowers/specs/2026-09-05-kicker-defense-projections-design.md`, and the standing
// "launch 2027, data year 2026" ruling); ingesting it would put a pristine season one query away
// from a fit.
import { createDb } from "@research/db/client";
import { seedTeamDefenseUniverse } from "@research/projections/crosswalk";
import { createNflverseClient } from "@research/projections/nflverse/client";
import { ingestKickingWeeks } from "@research/projections/nflverse/kicking-weeks";
import { SCHEDULE_SOURCE_CONFIG } from "@research/projections/nflverse/schedule";
import { ingestTeamDefenseWeeks } from "@research/projections/nflverse/team-defense-weeks";

/** The first season the model reads. Earlier seasons exist in the release and are deliberately not
 *  ingested: the game before this is a different one for both positions (the extra point moved to
 *  the fifteen in 2015, and the kickoff and touchback rules have moved twice since 2013), and a fit
 *  window is a claim about a comparable population. */
const FIRST_SEASON = 2013;
/** The last COMPLETED season. 2026 is the held-out data year and is refused below. */
const LAST_SEASON = 2025;

const REQUESTED = process.argv.slice(2).map(Number);
const SEASONS =
  REQUESTED.length > 0
    ? REQUESTED
    : Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, index) => FIRST_SEASON + index);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:kdef:backfill\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  for (const season of SEASONS) {
    if (!Number.isInteger(season) || season < 1999 || season > LAST_SEASON) {
      throw new Error(
        `${season} is not a season this backfill covers (1999 to ${LAST_SEASON}). ` +
          `${LAST_SEASON + 1} is the held-out data year and is refused on purpose.`,
      );
    }
  }

  const db = createDb(requireEnv("DATABASE_URL"));
  const client = createNflverseClient();

  console.log("seeding the 32 synthetic team-defence universe rows...");
  console.log(`  ${await seedTeamDefenseUniverse(db)} written (0 means they were already there)`);

  console.log(`\n${"=".repeat(88)}`);
  console.log(`KICKING WEEKS, ${SEASONS[0]} to ${SEASONS[SEASONS.length - 1]}`);
  console.log(`${"=".repeat(88)}`);
  for (const report of await ingestKickingWeeks(db, client, SEASONS)) {
    console.log(
      `  ${report.season}  file ${String(report.rowsRead).padStart(6)} rows   kicker weeks ${String(report.kickerRows).padStart(4)}   ` +
        `written ${String(report.written).padStart(4)}   not in the universe ${report.unknownToUniverse}`,
    );
  }

  console.log(`\n${"=".repeat(88)}`);
  console.log(`TEAM DEFENCE WEEKS, ${SEASONS[0]} to ${SEASONS[SEASONS.length - 1]}`);
  console.log(`${"=".repeat(88)}`);
  // The schedule file lives on a different host from the release assets, so it needs its own
  // client — see `ingestTeamDefenseWeeks`. It is what fills `points_allowed`.
  const scheduleClient = createNflverseClient({ baseUrl: SCHEDULE_SOURCE_CONFIG.baseUrl });
  for (const report of await ingestTeamDefenseWeeks(db, client, SEASONS, scheduleClient)) {
    console.log(
      `  ${report.season}  file ${String(report.rowsRead).padStart(6)} rows   written ${String(report.written).padStart(4)}   ` +
        `unpaired (dropped, never zeroed) ${report.unpaired}   no points allowed ${report.withoutPointsAllowed}`,
    );
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
