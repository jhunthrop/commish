// Backfills the context store: the schedule, and a season of play-by-play reduced to team-week
// facts (pace, line, what each defence allowed) and player-week facts (red-zone touches, air
// yards). Run: npm run projections:context [firstSeason] [lastSeason]
// (dotenv -e .env.local -- tsx scripts/projection-context.ts 2020 2024)
//
// Separate from `projection-backfill.ts` because the costs are two orders of magnitude apart. A
// season of play-by-play is a hundred megabytes and every column of it; the participation backfill
// is a few megabytes. Bundling them would put a very long download on the path of anybody who
// wanted the player store rebuilt.
//
// Nothing here is held in memory: the client streams the file, the aggregator keeps one small
// record per team-week, and the plays are discarded as they arrive.
//
// nflverse is free, so this spends no upstream request budget.
import { createDb } from "@/db/client";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestCoaches, ingestInjuryReports, ingestOpponentDefence, ingestPlayByPlay, ingestSchedule } from "@/projections/nflverse/ingest";
import { ingestInjuries } from "@/projections/nflverse/injuries";
import { ingestRosterWeeks } from "@/projections/nflverse/roster-weeks";

const FIRST_SEASON = Number(process.argv[2] ?? 2020);
const LAST_SEASON = Number(process.argv[3] ?? 2024);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:context\`, which loads .env.local.`);
  }
  return value;
}

async function main(): Promise<void> {
  if (!Number.isInteger(FIRST_SEASON) || !Number.isInteger(LAST_SEASON) || FIRST_SEASON > LAST_SEASON) {
    throw new Error(`Seasons must be whole numbers with the first no later than the last; got ${FIRST_SEASON}..${LAST_SEASON}.`);
  }
  const db = createDb(requireEnv("DATABASE_URL"));
  const seasons = Array.from({ length: LAST_SEASON - FIRST_SEASON + 1 }, (_, index) => FIRST_SEASON + index);

  // One small file covers every season, so it is fetched once rather than once per season.
  const scheduleRows = await ingestSchedule(db, seasons);
  console.log(`schedule: ${scheduleRows} new team-week observations across ${seasons.join(", ")}`);

  const client = createNflverseClient();
  for (const season of seasons) {
    const started = Date.now();
    const report = await ingestPlayByPlay(db, client, season);
    console.log(
      `${season}: ${report.playsRead} plays -> ${report.teamWeeks} team-weeks and ${report.playerWeeks} player-weeks, ` +
        `${report.observationsWritten} new observations in ${((Date.now() - started) / 1000).toFixed(0)}s` +
        (report.unknownPlayers === 0 ? "" : `, ${report.unknownPlayers} touch-takers the universe does not project`),
    );
  }

  // Last, because a coach's prior pace can only be computed once the seasons he coached are in the
  // store. Running it before the play-by-play would silently produce a table of nulls.
  const coachRows = await ingestCoaches(db, seasons);
  console.log(`coaches: ${coachRows} new team-week observations`);

  // Also last, and for the same reason: a defence can only be rated once what it allowed is stored.
  const opponentRows = await ingestOpponentDefence(db, seasons);
  console.log(`opponent adjustment: ${opponentRows} new team-week observations`);

  // The news pass's retrieval. Under a megabyte a season against the play-by-play's hundred, and the
  // only feed here whose stamps come from a publisher rather than from a game's date.
  for (const report of await ingestInjuryReports(db, client, seasons)) {
    console.log(
      `${report.season}: ${report.reportRows} injury report rows -> ${report.observationsWritten} new observations` +
        (report.unknownPlayers === 0 ? "" : `, ${report.unknownPlayers} listed players the universe does not project`) +
        (report.unstamped === 0 ? "" : `, ${report.unstamped} rows with no filing timestamp skipped (unstamped, not stored)`),
    );
  }

  // The SAME release, archived verbatim rather than turned into ordinals — `nflverse_injuries`,
  // which a fact sheet reads for the report's own words ("Knee", "Out") rather than a model's
  // number. See `injuries.ts`'s own docblock for why this is a second table and not a second read
  // of `ingestInjuryReports` above.
  for (const report of await ingestInjuries(db, client, seasons)) {
    console.log(
      `${report.season}: ${report.rowsRead} injury report rows archived -> ${report.written} new/changed rows` +
        (report.unknownToUniverse === 0 ? "" : `, ${report.unknownToUniverse} listed players the universe does not hold`),
    );
  }

  // A DIFFERENT WEEKLY RELEASE, archived verbatim — `nflverse_roster_weeks`, which stays explicit
  // about a reserve-list placement even for the weeks a player has since vanished from the injury
  // report entirely. See `roster-weeks.ts`'s own docblock for the real case (Malik Nabers, 2025)
  // this closes and `availability/season-end.ts`'s `deriveSeasonEndFromStatus`/`deriveSeasonEnding`
  // for the derivation it feeds.
  for (const report of await ingestRosterWeeks(db, client, seasons)) {
    console.log(
      `${report.season}: ${report.rowsRead} weekly roster rows archived -> ${report.written} new/changed rows` +
        (report.unknownToUniverse === 0 ? "" : `, ${report.unknownToUniverse} listed players the universe does not hold`),
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
