// Fits the blend's cap/scale constants via a small grid search against the store's own historical
// market boards, model boards and season outcomes, generating the committed
// `src/projections/market/blend-fitted.ts`.
// Run: npm run projections:blend:fit
//      npm run projections:blend:fit -- --check   (recomputes, exits 1 on any drift)
//
// TRAIN SEASONS: `HISTORICAL_ROSTER_FLOOR` (2013) through `BLEND_TRAIN_CUTOFF_SEASON` (2021),
// inclusive — the identical window `market-curve-fit.ts` and `rookie-curve-fit.ts` fit on, for the
// identical reason: the lower bound is the floor this repository's weekly stat lines are actually
// backfilled to, and the upper bound is this task's own boundary, enforced structurally inside
// `scoreBlendConstants` itself so a mistake here fails loudly rather than quietly leaking a later
// season into the score. The final-bar seasons, 2023 and 2024, are never read by this script at all.
//
// THE GRID. Three constants, four values each — `lawCapPoints`, `availabilityCapPoints`,
// `totalCapPoints` — the same small, hand-picked ladder for every one of them (2, 5, 10, 20, 40
// season points), scored by rank correlation (`spearman`, `metrics.ts`) pooled across every train
// season and every skill position. 5^3 = 125 combinations, each a full blend of every train row —
// small enough to run in one pass with no pruning. `totalCapPoints` combinations below the larger of
// the other two are skipped: a total cap tighter than either individual cap would make that cap
// unreachable, so scoring it would waste a grid cell without ever exercising the constant it names.
import { readFileSync, writeFileSync } from "node:fs";
import { createDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import type { Position } from "@/domain/player";
import {
  BLEND_TRAIN_CUTOFF_SEASON,
  scoreBlendConstants,
  type BlendConstants,
  type BlendTrainRow,
} from "@/projections/market/blend";
import { marketBoard } from "@/projections/market/curve";
import { statLinesAsOfForMeasurement } from "@/projections/nflverse/derived-stat-lines";
import { HISTORICAL_ROSTER_FLOOR } from "@/projections/nflverse/rosters";
import { LAST_POSSIBLE_WEEK } from "@/projections/store";
import { computeFantasyPoints } from "@/scoring/compute";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@/projections/preseason/fitted";
import { FITTED_MODEL } from "@/projections/model/source";
import { loadPreseason, preseasonCandidates, SHIPPED_PRESEASON_FEATURES, type PreseasonPriors } from "@/projections/preseason/source";
import type { ReadonlyDb } from "@/db/client";

const OUTPUT = "src/projections/market/blend-fitted.ts";
const GRID = [2, 5, 10, 20, 40] as const;

/** Far past any correction: a fit measures completed seasons, never a point-in-time product read. */
const FINAL_OUTCOME = new Date("9999-12-31T00:00:00.000Z");

const PRIORS: PreseasonPriors = {
  model: FITTED_MODEL,
  availability: FITTED_AVAILABILITY_PRIORS,
  rookies: FITTED_ROOKIE_PRIORS,
  depth: FITTED_DEPTH_PRIORS,
  career: FITTED_CAREER_PRIORS,
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:blend:fit\`, which loads .env.local.`);
  }
  return value;
}

function trainSeasons(): readonly number[] {
  const seasons: number[] = [];
  for (let season = HISTORICAL_ROSTER_FLOOR; season <= BLEND_TRAIN_CUTOFF_SEASON; season += 1) seasons.push(season);
  return seasons;
}

/**
 * What every player actually scored over one completed regular season — the identical
 * `statLinesAsOfForMeasurement`-backed sum `market/curve.ts`'s `loadMarketCurveObservations` and
 * `preseason/rookie-curve.ts`'s `loadRookieCurveObservations` each already read, so a season inside
 * `STAT_LINE_GAPS` (2019) never comes back silently zeroed for this script either.
 */
async function actualSeasonPoints(db: ReadonlyDb, season: number, positions: ReadonlyMap<string, Position>): Promise<ReadonlyMap<string, number>> {
  const lines = await statLinesAsOfForMeasurement(db, { season, week: { from: 1, to: LAST_POSSIBLE_WEEK }, asOf: FINAL_OUTCOME });
  const totals = new Map<string, number>();
  for (const { line } of lines) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    totals.set(line.playerId, (totals.get(line.playerId) ?? 0) + computeFantasyPoints(line, position, PPR_SCORING));
  }
  return totals;
}

/** One train season's worth of rows: every player who appears on BOTH that season's market board
 *  and its model board, joined to what he actually scored (zero, not dropped, for a listed player
 *  who never recorded a stat line — the identical counting choice `market/curve.ts`'s own train
 *  loader makes). */
async function rowsForSeason(db: ReadonlyDb, season: number): Promise<{ readonly rows: readonly BlendTrainRow[]; readonly droppedCount: number }> {
  const inputs = await loadPreseason(db, season);
  const candidates = preseasonCandidates(inputs, SHIPPED_PRESEASON_FEATURES, PRIORS);
  const { entries: market, droppedCount } = await marketBoard(db, season);
  const marketByPlayer = new Map(market.map((entry) => [entry.playerId, entry] as const));
  const actual = await actualSeasonPoints(db, season, inputs.positions);

  const rows: BlendTrainRow[] = [];
  for (const candidate of candidates) {
    const marketEntry = marketByPlayer.get(candidate.playerId);
    if (marketEntry === undefined) continue;
    rows.push({ season, market: marketEntry, candidate, actualPoints: actual.get(candidate.playerId) ?? 0 });
  }
  return { rows, droppedCount };
}

function header(): string {
  return `import type { BlendConstants } from "./blend";

/**
 * GENERATED by \`npm run projections:blend:fit\`. Do not edit by hand.
 *
 * Fit by a small grid search over predictor seasons up to and including \`BLEND_TRAIN_CUTOFF_SEASON\`
 * (2021), scored by rank correlation against those seasons' own outcomes. See
 * \`scripts/blend-fit.ts\` for the grid and the chosen combination's score.
 */
`;
}

function render(constants: BlendConstants): string {
  return `${header()}
export const FITTED_BLEND_CONSTANTS: BlendConstants = ${JSON.stringify(constants, null, 2)};
`;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const db = createDb(requireEnv("DATABASE_URL"));

  const seasons = trainSeasons();
  console.log(`BLEND FIT, train seasons ${seasons.join(", ")}`);

  const rows: BlendTrainRow[] = [];
  for (const season of seasons) {
    const { rows: seasonRows, droppedCount } = await rowsForSeason(db, season);
    rows.push(...seasonRows);
    console.log(
      `  ${season}: ${seasonRows.length} rows (players on both the market and model boards), ` +
        `${droppedCount} market row(s) dropped (unresolved position)`,
    );
  }
  await db.$client.end();

  console.log(`\nfit on ${rows.length} (player, season) rows across seasons ${seasons.join(", ")}`);

  let best: { constants: BlendConstants; score: number } | null = null;
  let scored = 0;
  let skipped = 0;
  for (const lawCapPoints of GRID) {
    for (const availabilityCapPoints of GRID) {
      for (const totalCapPoints of GRID) {
        if (totalCapPoints < Math.max(lawCapPoints, availabilityCapPoints)) {
          skipped += 1;
          continue;
        }
        const constants: BlendConstants = { lawCapPoints, availabilityCapPoints, totalCapPoints };
        const score = scoreBlendConstants(rows, constants, { heldOutSeasons: [] });
        scored += 1;
        if (score !== null && (best === null || score > best.score)) best = { constants, score };
      }
    }
  }

  console.log(`scored ${scored} grid cells (${skipped} skipped: totalCapPoints below the larger of the other two caps)`);

  if (best === null) {
    throw new Error("The blend grid search found no scoreable combination — every cell returned null from `spearman`.");
  }

  console.log(
    `\nBEST: lawCapPoints=${best.constants.lawCapPoints}  availabilityCapPoints=${best.constants.availabilityCapPoints}  ` +
      `totalCapPoints=${best.constants.totalCapPoints}  (spearman rho=${best.score.toFixed(4)} on the train rows)`,
  );

  const rendered = render(best.constants);

  if (check) {
    const committed = readFileSync(OUTPUT, "utf-8");
    if (committed !== rendered) {
      console.error(`\n${OUTPUT} does not match the fitted constants. Run \`npm run projections:blend:fit\` and commit the result.`);
      process.exit(1);
    }
    console.log(`\n${OUTPUT} matches the fitted constants. No drift.`);
    return;
  }

  writeFileSync(OUTPUT, rendered);
  console.log(`\nwrote ${OUTPUT}`);
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
