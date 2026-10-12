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
import { createDb } from "@research-ts/db/client";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import { replayHeadToHead, replayOpportunity, SHARE_FIELDS, type ProjectionSource, type ReplayResult } from "@research-ts/projections/backtest";
import { naiveProjection, NAIVE_SOURCE_NAME } from "@research-ts/projections/benchmarks/naive";
import { RANK_BANDS, type ScoreCard } from "@research-ts/projections/metrics";
import { scoreShares } from "@research-ts/projections/model/fit";
import { FITTED_OPPORTUNITY_PRIORS, FIT_SEASONS, HELD_OUT_SEASONS } from "@research-ts/projections/model/fitted";
import { lastObservedPriors } from "@research-ts/projections/model/opportunity";
import { modelSource } from "@research-ts/projections/model/source";
import { createNflverseClient } from "@research-ts/projections/nflverse/client";
import { ingestPlayerUniverse, ingestSeason } from "@research-ts/projections/nflverse/ingest";

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

  /**
   * LAYER 1 ON ITS OWN TERMS, printed before any points scoreboard.
   *
   * If predicted target share is not better than "whatever his share was last week", nothing
   * composed on top of it can be — and that failure is invisible in a points table, where an
   * efficiency error and an opportunity error look identical.
   */
  const weeks = Array.from({ length: LAST_REGULAR_WEEK }, (_, index) => index + 1);
  if (!(FIT_SEASONS as readonly number[]).includes(TARGET_SEASON)) {
    const model = await replayOpportunity(db, { season: TARGET_SEASON, weeks, asOfForWeek, priors: FITTED_OPPORTUNITY_PRIORS });
    const floor = await replayOpportunity(db, {
      season: TARGET_SEASON,
      weeks,
      asOfForWeek,
      priors: lastObservedPriors(FITTED_OPPORTUNITY_PRIORS),
    });
    console.log(`\nOPPORTUNITY (layer 1), ${TARGET_SEASON}, predicted share against observed share`);
    console.log(`  parameters fitted on ${FIT_SEASONS.join(", ")}; held out: ${HELD_OUT_SEASONS.join(", ")}`);
    const shareLine = (name: string, observations: Parameters<typeof scoreShares>[0]) => {
      const score = scoreShares(observations);
      return `  ${name.padEnd(20)} rho ${(score.rankCorrelation ?? 0).toFixed(4)}   MAE ${(score.meanAbsoluteError ?? 0).toFixed(5)}   RMSE ${(score.rootMeanSquaredError ?? 0).toFixed(5)}   n=${score.sampleSize}`;
    };
    for (const field of SHARE_FIELDS) {
      console.log(shareLine(`${field} model`, model.byShare[field]));
      console.log(shareLine(`${field} last-week`, floor.byShare[field]));
    }
    console.log(shareLine("POOLED model", model.pooled));
    console.log(shareLine("POOLED last-week", floor.pooled));
  } else {
    console.log(`\nOPPORTUNITY: ${TARGET_SEASON} is a FIT season; its share numbers would be a description, not a measurement. Skipped.`);
  }

  const naive: ProjectionSource = {
    name: NAIVE_SOURCE_NAME,
    project: ({ history, season, week }) => naiveProjection(history, { season, week }),
  };
  const headToHead = await replayHeadToHead(db, {
    season: TARGET_SEASON,
    weeks,
    sources: [naive, modelSource()],
    rules: PPR_SCORING,
    asOfForWeek,
  });
  const [floor, model] = headToHead.full;

  console.log(`\nPOINTS, ${TARGET_SEASON}, PPR, scored against actual weekly outcomes`);
  console.log(`  ${model!.source} against the floor, ${floor!.source}\n`);
  for (const result of [floor!, model!]) {
    console.log(`${result.source}`);
    console.log("  BY WEEK");
    for (const week of result.weeks) console.log(`    ${card(`week ${week.week}`, week.overall)}`);
    console.log("  BY RANK BAND (banded by each source's OWN projected rank; see the caveat in the research doc)");
    for (const band of RANK_BANDS) console.log(`    ${card(band.name, result.byRankBand[band.name])}`);
    console.log(`    ${card("OVERALL", result.overall)}\n`);
  }

  // The single most informative line in the phase: the naive floor decays through a season because
  // it never stops reading January. Whether the model FLATTENS that curve is the direct test of
  // whether its in-season features are doing anything at all.
  // LIKE FOR LIKE. The model projects everyone with usage history, including rookies the naive
  // benchmark is structurally blind to, and those extra player-weeks are overwhelmingly low scorers
  // that are easy to order correctly. Restricting to the players BOTH sources projected removes
  // that advantage; the gap between this block and the one above is how much of the headline was
  // coverage rather than accuracy.
  console.log("SAME PLAYERS ONLY (every player both sources projected)");
  for (const result of headToHead.common) {
    console.log(`  ${result.source}`);
    for (const band of RANK_BANDS) console.log(`    ${card(band.name, result.byRankBand[band.name])}`);
    console.log(`    ${card("OVERALL", result.overall)}`);
  }

  console.log("\nWEEKLY DECAY (rank correlation), floor -> model");
  for (const week of floor!.weeks) {
    const ours = model!.weeks.find((candidate) => candidate.week === week.week)!;
    const delta = (ours.overall.rankCorrelation ?? 0) - (week.overall.rankCorrelation ?? 0);
    console.log(
      `  week ${String(week.week).padStart(2)}   ${(week.overall.rankCorrelation ?? 0).toFixed(3)} -> ${(ours.overall.rankCorrelation ?? 0).toFixed(3)}   ${delta >= 0 ? "+" : ""}${delta.toFixed(3)}`,
    );
  }
  const half = (result: ReplayResult, from: number, to: number) => {
    const weeksInRange = result.weeks.filter((week) => week.week >= from && week.week <= to);
    return weeksInRange.reduce((sum, week) => sum + (week.overall.rankCorrelation ?? 0), 0) / weeksInRange.length;
  };
  console.log(
    `  weeks 1-9    floor ${half(floor!, 1, 9).toFixed(3)}  model ${half(model!, 1, 9).toFixed(3)}\n` +
      `  weeks 10-18  floor ${half(floor!, 10, 18).toFixed(3)}  model ${half(model!, 10, 18).toFixed(3)}`,
  );

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
