// Runs the FDR-controlled law discovery trial (Task 7) — every candidate `generateCandidates()`
// produces (2,487 today), screened on TRAIN predictor seasons under Benjamini-Hochberg at q=0.10,
// then replicated on the full window — and writes `src/projections/laws/discovered.json`. Run:
//   npm run laws:discover                (measures, writes discovered.json)
//   npm run laws:discover -- --check     (recomputes, exits 1 on any drift from the committed file)
// (dotenv -e .env.local -- tsx scripts/discover-laws.ts [--check])
//
// See `src/projections/laws/discovery/measure.ts`'s own docblock for the full five-step pipeline
// (train screen, sign derivation, BH, full-window replication, verdict) — everything there is pure,
// given already-fetched `DiscoverySeasonRow`s. This script owns the one DB-reading pass: every
// season's discovery facts, covariate points/game and season-N+1 actual, read ONCE per season
// (`buildSeasonRows` below) rather than once per candidate — the same "facts per season computed
// once across all candidates" batching `buildPopulations` already does for the six tribal laws.
//
// `factsForSeason`'s own `.pointsPerGame` (`populations.ts`) supplies the covariate — the identical
// `schedulePublishedAsOf(season + 1)`-gated read `discoveryFactsForSeason`'s own `current` half uses
// internally, just not exposed there — and `actualPointsPerGame` (also `populations.ts`, exported for
// this script) supplies the ungated season-N+1 outcome. Both are Task 6/tribal exports reused here
// rather than reimplemented, the "same actuals discipline" this task's own brief requires.
import { readFileSync, writeFileSync } from "node:fs";
import { createDb } from "@/db/client";
import type { ReadonlyDb } from "@/db/client";
import { allPositions } from "@/projections/backtest";
import { PPR_SCORING } from "@/domain/scoring";
import { DISCOVERY_TRAIN_SEASONS, MEASURE_SEASONS, REPLICATION_FOLDS } from "@/projections/laws/config";
import { discoveryFactsForSeason } from "@/projections/laws/discovery-facts";
import { actualPointsPerGame, factsForSeason } from "@/projections/laws/populations";
import { preseasonMomentFor } from "@/projections/preseason/source";
import { generateCandidates } from "@/projections/laws/discovery/generate";
import { MIN_TRAIN_PAIRS, runDiscoveryPipeline, type DiscoverySeasonRow } from "@/projections/laws/discovery/measure";
import { DISCOVERED_JSON_PATH, MIN_OUT_OF_TRAIN_FOLD_PAIRS, MIN_REPLICATION_PAIRS, type DiscoveredJson } from "@/projections/laws/registry";
import { STAT_LINE_GAPS } from "@/projections/nflverse/stat-lines";

const OUTPUT_PATH = DISCOVERED_JSON_PATH;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run laws:discover\`, which loads .env.local.`);
  }
  return value;
}

/** `MEASURE_SEASONS.from..MEASURE_SEASONS.to - 1` — the same "terminal season has no N+1 actuals"
 *  exclusion `scripts/measure-laws.ts`'s own `measurementSeasons` applies, for the identical reason. */
function fullWindowSeasons(): readonly number[] {
  const seasons: number[] = [];
  for (let season = MEASURE_SEASONS.from; season <= MEASURE_SEASONS.to - 1; season += 1) seasons.push(season);
  return seasons;
}

/** e.g. "2013-2023 (2019 rebuilt from play-by-play), direction discovered on predictor seasons
 *  2013-2021, replicated on predictor seasons 2021-2023 (2021 sits inside the discovery train
 *  window; only 2022 and 2023 are genuinely out-of-sample for a discovered law)" — `discovered.json`'s
 *  own `seasons` label, the discovery analogue of `measure-laws.ts`'s `seasonsLabel`. The
 *  parenthetical (fix round, IMPORTANT 1 RULING) is the one place a reader of the committed file
 *  itself, not just this repo's source, learns that a discovered law's 2021 fold is not the same kind
 *  of evidence its 2022/2023 folds are — see `discovery/measure.ts`'s own docblock (step 4) and
 *  `registry.ts`'s `verdictForDiscoveredLaw` for where that distinction actually changes a verdict. */
function seasonsLabel(): string {
  const window = `${MEASURE_SEASONS.from}-${MEASURE_SEASONS.to - 1}`;
  const gapNote = STAT_LINE_GAPS.length === 0 ? "" : ` (${STAT_LINE_GAPS.join(", ")} rebuilt from play-by-play)`;
  const folds = [...REPLICATION_FOLDS].sort((a, b) => a - b);
  const replicated = folds.length === 1 ? `${folds[0]}` : `${folds[0]}-${folds[folds.length - 1]}`;
  return (
    `${window}${gapNote}, direction discovered on predictor seasons ` +
    `${DISCOVERY_TRAIN_SEASONS.from}-${DISCOVERY_TRAIN_SEASONS.to}, replicated on predictor seasons ${replicated} ` +
    `(${DISCOVERY_TRAIN_SEASONS.to} sits inside the discovery train window; only seasons after it are genuinely out-of-sample for a discovered law)`
  );
}

/** Every season's `DiscoverySeasonRow`s, read ONCE regardless of candidate count — see this file's
 *  own header for why this batching matters at 2,487 candidates. */
async function buildSeasonRows(db: ReadonlyDb, seasons: readonly number[]): Promise<readonly DiscoverySeasonRow[]> {
  const positions = await allPositions(db);
  const rows: DiscoverySeasonRow[] = [];
  for (const season of seasons) {
    // `preseasonMomentFor(season + 1)` — the moment the season being PREDICTED had a preseason board
    // and nothing its games produced was knowable yet, which is the only gate a market line published
    // in August of that season is readable at. Identical derivation to a replay board's own moment;
    // see `discoveryFactsForSeason`'s `incomingAsOf` docblock.
    const incomingAsOf = await preseasonMomentFor(db, season + 1);
    const discoveryFacts = await discoveryFactsForSeason(db, season, positions, PPR_SCORING, true, incomingAsOf);
    const seasonFacts = await factsForSeason(db, season, positions, PPR_SCORING, true);
    const nextActual = await actualPointsPerGame(db, season + 1, positions, PPR_SCORING, true);
    for (const [playerId, facts] of discoveryFacts) {
      const covariate = seasonFacts.get(playerId);
      if (covariate === undefined) continue; // no scoring evidence this season under the shared gate
      rows.push({
        playerId,
        season,
        position: facts.position,
        facts,
        pointsPerGame: covariate.pointsPerGame,
        nextPointsPerGame: nextActual.get(playerId) ?? null,
      });
    }
  }
  return rows;
}

function renderDiscoveredJson(discoveredJson: DiscoveredJson): string {
  return `${JSON.stringify(discoveredJson, null, 2)}\n`;
}

function printSummary(candidateCount: number, discoveredJson: DiscoveredJson): void {
  const { counts, laws } = discoveredJson;
  console.log(`\nDISCOVERY TRIAL -- ${candidateCount} candidates`);
  console.log(`  candidates:   ${counts.candidates}`);
  console.log(
    `  untestable:   ${counts.untestable}  (could not be matched on enough training seasons -- fewer than ${MIN_TRAIN_PAIRS} matched pairs)`,
  );
  console.log(`  bhSurvivors:  ${counts.bhSurvivors}  (Benjamini-Hochberg at q=0.10 over the testable family, min ${MIN_TRAIN_PAIRS} train pairs)`);
  console.log(
    `  replicated:   ${counts.replicated}  (full-window confirmed: CI excludes zero, sign matches, every fold agrees, >= ${MIN_REPLICATION_PAIRS} pairs, ` +
      `and at least one out-of-train fold with >= ${MIN_OUT_OF_TRAIN_FOLD_PAIRS} pairs)`,
  );

  const entries = Object.entries(laws).sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) {
    console.log("\nNo BH survivors this run -- zero survivors is a legitimate, publishable result.");
    return;
  }

  console.log("\nBH SURVIVORS:");
  for (const [id, entry] of entries) {
    const [low, high] = entry.ci;
    console.log(
      `  ${id.padEnd(55)} effect=${entry.effect.toFixed(3).padStart(8)}  ci=[${low.toFixed(3)}, ${high.toFixed(3)}]  n=${entry.sample}  verdict=${entry.verdict}`,
    );
    console.log(`    claim: ${entry.claim}`);
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const db = createDb(requireEnv("DATABASE_URL"));

  const candidates = generateCandidates();
  const rows = await buildSeasonRows(db, fullWindowSeasons());
  await db.$client.end();

  const discoveredJson = runDiscoveryPipeline(candidates, rows, DISCOVERY_TRAIN_SEASONS.to, seasonsLabel());
  printSummary(candidates.length, discoveredJson);
  const rendered = renderDiscoveredJson(discoveredJson);

  if (check) {
    const committed = readFileSync(OUTPUT_PATH, "utf-8");
    if (committed !== rendered) {
      console.error(`\n${OUTPUT_PATH} does not match the discovered evidence. Run \`npm run laws:discover\` and commit the result.`);
      process.exit(1);
    }
    console.log(`\n${OUTPUT_PATH} matches the discovered evidence. No drift.`);
    return;
  }

  writeFileSync(OUTPUT_PATH, rendered);
  console.log(`\nwrote ${OUTPUT_PATH}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
