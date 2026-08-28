// Measures the naive benchmark — last season's points per game — over a real NFL season, and
// prints a ScoreCard per week and per rank band. Run: npm run projections:report
// (dotenv -e .env.local -- tsx scripts/projection-report.ts [targetSeason])
//
// This is Phase 1's whole deliverable: the number every future model has to beat, measured rather
// than asserted. It ingests first (idempotently — `recordObservations` writes only what is new) so
// one command takes an empty store to a printed scoreboard, then replays the target season through
// `replay`, which is structurally unable to show the benchmark anything stamped after the week it
// is projecting.
//
// nflverse is free, so unlike `ingest-once.ts` and `ingest-adp.ts` this spends no upstream request
// budget and prints no budget line. It does reach the network, which is why it is a script an
// operator runs and never anything the product calls.
import { createDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { replay, type ProjectionSource } from "@/projections/backtest";
import { naiveProjection, NAIVE_SOURCE_NAME } from "@/projections/benchmarks/naive";
import { RANK_BANDS, type ScoreCard } from "@/projections/metrics";
import { createNflverseClient } from "@/projections/nflverse/client";
import { ingestPlayerUniverse, ingestSeason } from "@/projections/nflverse/ingest";

/** The season to replay. Its prior season is ingested too, because that is what naive projects from. */
const TARGET_SEASON = Number(process.argv[2] ?? 2024);
const LAST_REGULAR_WEEK = 18;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:report\`, which loads .env.local.`);
  }
  return value;
}

function percent(value: number | null): string {
  return value === null ? "  n/a " : `${(value * 100).toFixed(1)}%`;
}

function card(name: string, score: ScoreCard): string {
  const rho = score.rankCorrelation === null ? " n/a " : score.rankCorrelation.toFixed(3);
  const mae = score.meanAbsoluteError === null ? " n/a " : score.meanAbsoluteError.toFixed(2);
  const rmse = score.rootMeanSquaredError === null ? " n/a " : score.rootMeanSquaredError.toFixed(2);
  return `${name.padEnd(12)} rho ${rho}   MAE ${mae.padStart(6)}   RMSE ${rmse.padStart(6)}   n=${score.sampleSize}`;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const client = createNflverseClient();

  // Identity is an id join against the HISTORICAL universe (Phase 2, Task 1), not a name join
  // against today's roster. The rate below is therefore a measurement of nflverse's own id
  // coverage rather than of our matching, and it no longer decays going backwards.
  const universe = await ingestPlayerUniverse(db, client);

  /** The last week of each ingested season, so week 1 of the target can be dated from the one before. */
  const weekAsOfBySeason = new Map<number, ReadonlyMap<number, Date>>();

  for (const season of [TARGET_SEASON - 1, TARGET_SEASON]) {
    const report = await ingestSeason(db, client, universe, season);
    weekAsOfBySeason.set(season, report.weekAsOf);

    // The resolution rate is printed every run, not only when it looks wrong. A bad join is silent
    // by nature — an unmatched player is indistinguishable from one who did not play — so the
    // number that would reveal it has to be in front of whoever ran the report.
    console.log(
      `${season}: ${report.participationRows} participation rows, ${report.statLines} stat lines, ` +
        `${report.observationsWritten} new observations | universe ${percent(report.participationResolution)} participation, ` +
        `${percent(report.statLineResolution)} weekly stats (${report.unresolved.length} unresolved)`,
    );
    for (const unresolved of [...report.unresolved].sort((a, b) => b.occurrences - a.occurrences).slice(0, 10)) {
      console.log(`    unresolved: ${unresolved.name} (${unresolved.id}) x${unresolved.occurrences}`);
    }
  }

  /**
   * Week W is replayed from the moment week W-1's numbers landed — the last thing knowable before
   * W's games. Week 1 borrows the prior season's final week, which is honest: nothing about the new
   * season has happened yet, and the naive benchmark only ever looks at the season before anyway.
   */
  const target = weekAsOfBySeason.get(TARGET_SEASON)!;
  const prior = weekAsOfBySeason.get(TARGET_SEASON - 1)!;
  const priorSeasonEnd = new Date(Math.max(...[...prior.values()].map((date) => date.getTime())));
  const asOfForWeek = (week: number): Date => target.get(week - 1) ?? priorSeasonEnd;

  const source: ProjectionSource = {
    name: NAIVE_SOURCE_NAME,
    project: ({ history, season, week }) => naiveProjection(history, { season, week }),
  };
  const weeks = Array.from({ length: LAST_REGULAR_WEEK }, (_, index) => index + 1);
  const result = await replay(db, { season: TARGET_SEASON, weeks, source, rules: PPR_SCORING, asOfForWeek });

  console.log(`\n${result.source} over ${TARGET_SEASON}, PPR, scored against actual weekly outcomes\n`);
  console.log("BY WEEK");
  for (const week of result.weeks) console.log(`  ${card(`week ${week.week}`, week.overall)}`);
  console.log("\nBY RANK BAND (pooled over every replayed week, banded by the benchmark's own projected rank)");
  for (const band of RANK_BANDS) console.log(`  ${card(band.name, result.byRankBand[band.name])}`);
  console.log(`\n  ${card("OVERALL", result.overall)}`);

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
