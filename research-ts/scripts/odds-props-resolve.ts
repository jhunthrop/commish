// Resolves every distinct (player name, season) pair the props archive has observed
// (`player_prop_observations`) against that season's own `nfl_players` roster, and writes matched
// rows to `props_player_map`. Never a runtime dependency of anything else -- an operator script,
// run once per backfill, same shape as `scripts/build-crosswalk.ts`'s own report.
//
// Run: npm run projections:odds:resolve
//
// THE MATCH RATE IS REPORTED TWO WAYS, BY SEASON: by distinct name (each name counts once,
// regardless of how many archived lines it carries) and by observation count (each archived row
// counts once, so a miss on a name with a hundred lines weighs a hundred times a miss on a name
// with one). Both are printed, because a resolver that only reported the first could look excellent
// while missing a handful of high-volume names -- the exact way `build-crosswalk.ts`'s own docblock
// warns a report of only successes reports 100% every time.
//
// THE UNMATCHED SUMMARY IS ALSO WRITTEN TO THE WORKSPACE (not just printed), so the record survives
// past this run's own terminal scrollback.
import { writeFileSync } from "node:fs";
import { createDb } from "@research-ts/db/client";
import { requireEnv } from "@research-ts/projections/odds/http";
import { observationCountsByPropName, resolveAllPropNames, type UnmatchedPropName } from "@research-ts/projections/odds/player-map";

const UNMATCHED_REPORT_PATH = ".superpowers/sdd/2026-09-01-props-backfill/props-unmatched-report.json";
/** How many of each season's unmatched names to name in the printed summary -- enough to see the
 *  shape without a thousand-line report (`build-crosswalk.ts`'s own `NAMED_MISSES` convention). */
const NAMED_MISSES = 20;

function percent(matched: number, total: number): string {
  return total === 0 ? "n/a" : `${((matched / total) * 100).toFixed(1)}%`;
}

interface SeasonReport {
  readonly season: number;
  readonly distinctNames: number;
  readonly distinctNamesMatched: number;
  readonly totalObservations: number;
  readonly observationsMatched: number;
  readonly methodCounts: { readonly exact: number; readonly loose: number };
  readonly unmatchedByCount: readonly { readonly propName: string; readonly reason: string; readonly observations: number }[];
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));

  // THE RESOLVE CORE (fix round 1, MEDIUM 1a) — `player-map.ts`'s `resolveAllPropNames`, the same
  // function the props-preseason-snapshot job now calls after every capture. This script is the
  // operator's own REPORT on top of that core, never a second implementation of it.
  const { observed, matched, unmatched, written } = await resolveAllPropNames(db);
  const counts = await observationCountsByPropName(db);
  const seasons = [...new Set(observed.map((o) => o.season))].sort((a, b) => a - b);

  console.log(`odds-props-resolve: ${observed.length} distinct (name, season) pair(s) observed across ${seasons.length} season(s).`);
  if (seasons.length === 0) {
    console.log("Nothing to resolve -- the archive holds no observations. Run projections:odds:backfill first.");
    await db.$client.end();
    return;
  }

  const matchedKeys = new Set(matched.map((m) => `${m.propName}|${m.season}`));
  const unmatchedBySeason = new Map<number, UnmatchedPropName[]>();
  for (const miss of unmatched) {
    const list = unmatchedBySeason.get(miss.season);
    if (list === undefined) unmatchedBySeason.set(miss.season, [miss]);
    else list.push(miss);
  }

  const seasonReports: SeasonReport[] = seasons.map((season) => {
    const namesThisSeason = observed.filter((o) => o.season === season);
    const matchedThisSeason = namesThisSeason.filter((o) => matchedKeys.has(`${o.propName}|${o.season}`));
    const totalObservations = namesThisSeason.reduce((sum, o) => sum + (counts.get(`${o.propName}|${o.season}`) ?? 0), 0);
    const observationsMatched = matchedThisSeason.reduce((sum, o) => sum + (counts.get(`${o.propName}|${o.season}`) ?? 0), 0);
    const methodCounts = { exact: 0, loose: 0 };
    for (const row of matched) {
      if (row.season !== season) continue;
      methodCounts[row.method] += 1;
    }
    const unmatchedThisSeason = (unmatchedBySeason.get(season) ?? [])
      .map((miss) => ({ propName: miss.propName, reason: miss.reason, observations: counts.get(`${miss.propName}|${miss.season}`) ?? 0 }))
      .sort((a, b) => b.observations - a.observations);

    return {
      season,
      distinctNames: namesThisSeason.length,
      distinctNamesMatched: matchedThisSeason.length,
      totalObservations,
      observationsMatched,
      methodCounts,
      unmatchedByCount: unmatchedThisSeason,
    };
  });

  console.log(`\n${"=".repeat(96)}`);
  console.log("PLAYER-PROP NAME RESOLUTION: player_prop_observations against each season's own nfl_players roster");
  console.log(`${"=".repeat(96)}\n`);
  console.log(`rows written to props_player_map: ${written}\n`);

  for (const report of seasonReports) {
    console.log(`season ${report.season}:`);
    console.log(
      `  by distinct name:        ${report.distinctNamesMatched}/${report.distinctNames} matched ` +
        `(${percent(report.distinctNamesMatched, report.distinctNames)})`,
    );
    console.log(
      `  by observation count:    ${report.observationsMatched}/${report.totalObservations} matched ` +
        `(${percent(report.observationsMatched, report.totalObservations)})`,
    );
    console.log(`  method breakdown:        exact=${report.methodCounts.exact}, loose=${report.methodCounts.loose}`);
    if (report.unmatchedByCount.length > 0) {
      console.log(`  top unmatched names (of ${report.unmatchedByCount.length}):`);
      for (const miss of report.unmatchedByCount.slice(0, NAMED_MISSES)) {
        console.log(`    ${miss.propName} -- ${miss.reason}, ${miss.observations} observation(s)`);
      }
    }
    console.log("");
  }

  writeFileSync(
    UNMATCHED_REPORT_PATH,
    JSON.stringify({ generatedAt: new Date().toISOString(), rowsWritten: written, seasons: seasonReports }, null, 2),
  );
  console.log(`Unmatched summary saved to ${UNMATCHED_REPORT_PATH}`);

  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
