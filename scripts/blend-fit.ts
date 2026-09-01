// Fits the blend's cap constants (and the market's own implied-games table) via a grid search
// against the store's own historical market boards, model boards and season outcomes, generating
// the committed `src/projections/market/blend-fitted.ts`.
// Run: npm run projections:blend:fit
//      npm run projections:blend:fit -- --check   (recomputes, exits 1 on any drift)
//
// TRAIN SEASONS: `HISTORICAL_ROSTER_FLOOR` (2013) through `BLEND_TRAIN_CUTOFF_SEASON` (2021),
// inclusive — the identical window `market-curve-fit.ts` and `rookie-curve-fit.ts` fit on, for the
// identical reason: the lower bound is the floor this repository's weekly stat lines are actually
// backfilled to, and the upper bound is this task's own boundary, enforced structurally inside
// `scoreBlendConstants` itself so a mistake here fails loudly rather than quietly leaking a later
// season into the score.
//
// WHAT "NEVER READ" ACTUALLY MEANS HERE (C1(iii)/M1 fix round, correcting an earlier, false claim
// this header made — "the final-bar seasons, 2023 and 2024, are never read by this script at all").
// No 2023/2024 STAT LINE, ADP row or model input is read by this script, and no OUTCOME from those
// seasons ever reaches a score `scoreBlendConstants` returns: `admittedDelta` (`market/blend.ts`)
// reads a law's `trainEffect`, never its full-window `effect` (C1(i)), so a law's own APPLIED
// MAGNITUDE never carries information from 2023/2024. What is NOT bounded by any of that is LAW
// SELECTION: `loadPreseason`'s default `laws` is `registry()`, and whether a law is CONFIRMED at
// all (`verdictForFullWindow`/`verdictForDiscoveredLaw`, `laws/registry.ts`) requires agreement
// across `REPLICATION_FOLDS` (2021, 2022, 2023) — so 2023's own year-over-year outcomes help decide
// WHICH laws exist as `"law"` BoardReasons for this script to blend at all, even though they never
// set HOW MUCH a confirmed law moves a player once it fires. The bound: this is a selection effect
// over a small, discrete set (six tribal laws plus a handful of discovered survivors), not a
// continuous leak into any one row's score, and every other consumer of `registry()`'s confirmed
// laws already lives with it (the raw board's own law reasons, `/player-laws`) — this script
// inherits the selection effect rather than introducing a new one.
//
// THE IMPLIED-GAMES TABLE (I3+I5 fix round) — `market/curve.ts`'s `fitImpliedGamesByPosition`, run
// on the market curve's OWN train population (`loadMarketCurveObservations` over the identical
// season range this script itself trains on). Committed alongside the cap constants as one field of
// the same `BlendConstants` object, with the SAME provenance: both are fit on TRAIN seasons only.
//
// THE GRID (I2 fix round, correcting the earlier grid's two mistakes). `lawCapPoints`,
// `availabilityCapPoints` and `totalCapPoints` each range over GRID — INCLUDING ZERO, so the
// zero-deviation "pure market, no admitted evidence at all" baseline is itself one of the scored
// cells rather than an unreachable edge case — with EVERY combination scored: the earlier version
// skipped any cell where `totalCapPoints` sat below the larger of the other two, on the theory that
// such a cell could never exercise `totalCapPoints`. That reasoning was backwards — a TIGHT total
// cap is exactly the binding, informative region this search needs to see (it is what makes the
// blend cautious), and pruning it away meant the search could never discover that a tight total cap
// was the best-scoring choice. Every one of GRID^3 cells is scored and its own rho logged below,
// not only the winner.
//
// THE UNLISTED FALLBACK'S OWN PRICING (C2 fix round 1, TIGHTENED fix round 2, SIMPLIFIED fix round
// 3, IMPORTANT 1) — an unlisted candidate's raw model season points, capped at
// `fitMarketTailByPosition`'s own structural tail (`BlendConstants.marketTailByPosition`), nothing
// else. Fix round 1 shipped an additional affine rescale layer (`fitUnlistedRescale`, an OLS fit per
// position over every TRAIN row's own (raw model points, market points) pair) to correct the raw
// model's own unlisted fallback landing implausibly high (an unlisted player at overall rank 20 in
// 2023, rank 43 in 2024). Fix round 2 found that rescale REGRESSED the board at QB (a fitted
// intercept inflating backup-caliber unlisted quarterbacks toward starter-level output) and forced
// QB to the identity transform as a fit-validity exception. Fix round 3's own audit found the
// rescale dead everywhere else too: every fitted intercept at RB/WR/TE already sat above that
// position's own tail, so `Math.min(rescaled, tail)` always discarded the rescale's output in favour
// of the tail — the layer never changed a single shipped number, it only collapsed every unlisted
// candidate at a position to the identical tail value, erasing the raw model's own ordering among
// them. The rescale is gone; `Math.min(rawPoints, tail)` is the whole rule now.
// `scripts/blend-diagnostic.ts` is the committed, re-runnable check — position mix of the board's
// own top 100 and the count of unlisted players still priced above their positional tail, never the
// single "best unlisted rank" number that hid the QB regression from fix round 1's own diagnostic.
import { readFileSync, writeFileSync } from "node:fs";
import { createDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import type { Position } from "@/domain/player";
import {
  BLEND_TRAIN_CUTOFF_SEASON,
  detectPlateau,
  fitMarketTailByPosition,
  scoreBlendConstants,
  type BlendConstants,
  type BlendTrainRow,
  type ScoredCell,
} from "@/projections/market/blend";
import { fitImpliedGamesByPosition, loadMarketCurveObservations, marketBoard } from "@/projections/market/curve";
import { registry } from "@/projections/laws/registry";
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
import { gradableInputs } from "@/projections/preseason/scorecard";
import type { ReadonlyDb } from "@/db/client";

const OUTPUT = "src/projections/market/blend-fitted.ts";
/** I2/I3+I5 fix round: zero included (the pure-market baseline), extended upward from the earlier
 *  [2,5,10,20,40] ladder toward 80 to give the availability/total axes real room for an interior
 *  optimum — see the real run's own printed verdict on whether one appeared. */
const GRID = [0, 2, 5, 10, 20, 40, 80] as const;

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
 * `STAT_LINE_GAPS` (2019, 2025) never comes back silently zeroed for this script either.
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
  // Fix round I3: `gradableInputs` is the convergence point every grading script calls through,
  // immediately after `loadPreseason` — see its own docblock in `preseason/scorecard.ts`. This
  // script's train rows feed the blend's own fitted constants from `actualSeasonPoints` below, so a
  // live board reaching this function would poison a fit with a non-existent outcome.
  const inputs = gradableInputs(await loadPreseason(db, season));
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

/** Everything about the winning cell fix round 2's own review asked to have RECORDED, not just
 *  printed to a console a reader may never see: the score itself, how large the plateau around it
 *  is, and the channel decomposition (pure market -> availability admitted -> laws admitted too). */
interface FitSummary {
  readonly bestScore: number;
  readonly pureMarketScore: number | null;
  readonly availabilityOnlyScore: number | null;
  readonly plateau: { readonly tiedCellCount: number; readonly anyTiedAtCeiling: boolean };
  readonly ceiling: number;
}

function header(summary: FitSummary): string {
  const lawShare =
    summary.pureMarketScore !== null && summary.availabilityOnlyScore !== null && summary.bestScore !== summary.availabilityOnlyScore
      ? (((summary.bestScore - summary.availabilityOnlyScore) / (summary.bestScore - summary.pureMarketScore)) * 100).toFixed(1)
      : "n/a";
  return `import type { BlendConstants } from "./blend";

/**
 * GENERATED by \`npm run projections:blend:fit\`. Do not edit by hand.
 *
 * Fit by a grid search over predictor seasons up to and including \`BLEND_TRAIN_CUTOFF_SEASON\`
 * (2021), scored by rank correlation against those seasons' own outcomes. \`impliedGamesByPosition\`
 * is the market curve's own train population's mean games played, per position
 * (\`fitImpliedGamesByPosition\`); \`marketTailByPosition\` caps the unlisted fallback at the market's
 * own cheapest drafted man per position (see \`market/blend.ts\`'s own docblocks). See
 * \`scripts/blend-fit.ts\` for the grid.
 *
 * THE WINNING SCORE: spearman rho = ${summary.bestScore.toFixed(4)} on the train rows.
 *
 * THE PLATEAU (fix round 2, ruling 4b): ${summary.plateau.tiedCellCount} of this grid's own cells
 * scored within 1e-4 of the winner — a genuine plateau, not a single sharp peak.
 * ${summary.plateau.anyTiedAtCeiling ? `At least one of those tied cells sits at this grid's own ceiling (${summary.ceiling}) on a cap axis; a wider grid might still move the winner.` : `None of the tied cells sits at this grid's own ceiling (${summary.ceiling}); the search found a genuine interior optimum, not one pinned to the edge of what it was allowed to try.`}
 *
 * THE CHANNEL DECOMPOSITION — pure market (every cap at zero) ${summary.pureMarketScore === null ? "n/a" : summary.pureMarketScore.toFixed(4)},
 * availability admitted alone (lawCapPoints at zero, the winning availability/total caps otherwise)
 * ${summary.availabilityOnlyScore === null ? "n/a" : summary.availabilityOnlyScore.toFixed(4)}, laws admitted too (the winning cell in full)
 * ${summary.bestScore.toFixed(4)} — laws' own share of the total lift over pure market is ${lawShare}%. Written down so
 * Task 11's own ablation of this board is not a surprise: the availability channel does almost all
 * of the work, laws add a real but small amount on top.
 */
`;
}

function render(constants: BlendConstants, summary: FitSummary): string {
  return `${header(summary)}
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

  console.log("\nfitting the market's own implied games-played table (I3+I5)...");
  const marketCurveObservations = await loadMarketCurveObservations(db, seasons);
  const impliedGamesByPosition = fitImpliedGamesByPosition(marketCurveObservations);
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    console.log(`  ${position}: ${impliedGamesByPosition[position].toFixed(2)} implied games`);
  }

  await db.$client.end();

  console.log(`\nfit on ${rows.length} (player, season) rows across seasons ${seasons.join(", ")}`);

  // `laws` computed ONCE, off the real committed registry, and passed to every grid cell explicitly
  // — `scoreBlendConstants`/`blendBoard` would otherwise default to calling `registry()` (a disk
  // read + JSON parse) on every single row of every single grid cell, which at GRID.length^3 cells
  // times `rows.length` rows would mean hundreds of thousands of redundant file reads.
  const laws = registry();

  console.log("\nfitting the structural tail guard, per position (fix round 2, ruling 2), the unlisted fallback's only pricing rule (fix round 3, IMPORTANT 1)...");
  const marketTailByPosition = fitMarketTailByPosition(rows);
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    console.log(`  ${position}: ${marketTailByPosition[position].toFixed(1)} pts (the market's own cheapest drafted man at this position)`);
  }

  console.log(`\nGRID (${GRID.join(", ")}), every cell scored (I2 fix round, no pruning):\n`);
  console.log(`${"lawCap".padStart(7)}  ${"availCap".padStart(9)}  ${"totalCap".padStart(9)}  ${"rho".padStart(8)}`);

  let best: { constants: BlendConstants; score: number } | null = null;
  let pureMarketScore: number | null = null;
  const cells: ScoredCell[] = [];
  for (const lawCapPoints of GRID) {
    for (const availabilityCapPoints of GRID) {
      for (const totalCapPoints of GRID) {
        const constants: BlendConstants = {
          lawCapPoints,
          availabilityCapPoints,
          totalCapPoints,
          impliedGamesByPosition,
          marketTailByPosition,
        };
        const score = scoreBlendConstants(rows, constants, { heldOutSeasons: [], laws });
        cells.push({ constants, score });
        console.log(
          `${String(lawCapPoints).padStart(7)}  ${String(availabilityCapPoints).padStart(9)}  ${String(totalCapPoints).padStart(9)}  ` +
            `${score === null ? "n/a".padStart(8) : score.toFixed(4).padStart(8)}`,
        );
        if (lawCapPoints === 0 && availabilityCapPoints === 0 && totalCapPoints === 0) pureMarketScore = score;
        if (score !== null && (best === null || score > best.score)) best = { constants, score };
      }
    }
  }

  console.log(`\nscored ${cells.length} grid cells (every combination; the I2 fix round removed the earlier pruning rule)`);
  console.log(
    `\nPURE MARKET BASELINE (lawCapPoints=0, availabilityCapPoints=0, totalCapPoints=0, zero deviation from marketPoints for every ` +
      `listed player): rho=${pureMarketScore === null ? "n/a" : pureMarketScore.toFixed(4)}`,
  );

  if (best === null) {
    throw new Error("The blend grid search found no scoreable combination; every cell returned null from `spearman`.");
  }

  const beatsPureMarket = pureMarketScore !== null && best.score > pureMarketScore;
  console.log(
    `\nBEST: lawCapPoints=${best.constants.lawCapPoints}  availabilityCapPoints=${best.constants.availabilityCapPoints}  ` +
      `totalCapPoints=${best.constants.totalCapPoints}  (spearman rho=${best.score.toFixed(4)} on the train rows, ` +
      `${beatsPureMarket ? "beats" : "does NOT beat"} the pure-market baseline)`,
  );

  // THE CHANNEL DECOMPOSITION (fix round 2) — the winning cell with lawCapPoints forced to zero,
  // isolating how much of the winner's own lift over pure market comes from the availability channel
  // alone versus laws on top of it.
  const availabilityOnlyConstants: BlendConstants = { ...best.constants, lawCapPoints: 0 };
  const availabilityOnlyScore = scoreBlendConstants(rows, availabilityOnlyConstants, { heldOutSeasons: [], laws });
  console.log(
    `\nCHANNEL DECOMPOSITION: pure market ${pureMarketScore === null ? "n/a" : pureMarketScore.toFixed(4)}  ->  availability admitted alone ` +
      `${availabilityOnlyScore === null ? "n/a" : availabilityOnlyScore.toFixed(4)}  ->  laws admitted too (the winner) ${best.score.toFixed(4)}`,
  );

  // THE PLATEAU GUARD (fix round 2, ruling 4b) — every cell within 1e-4 of the winner, not just the
  // winner itself; see `detectPlateau`'s own docblock for why that distinction matters.
  const ceiling = GRID[GRID.length - 1];
  const plateau = detectPlateau(cells, best.score, ceiling);
  console.log(
    `\nPLATEAU: ${plateau.tiedCellCount} of ${cells.length} cells scored within 1e-4 of the winner. ` +
      (plateau.anyTiedAtCeiling
        ? `At least one tied cell sits at this grid's own ceiling (${ceiling}) on a cap axis; a wider grid might still move the winner.`
        : `None of the tied cells sits at this grid's own ceiling (${ceiling}); a genuine interior optimum.`),
  );

  const rendered = render(best.constants, {
    bestScore: best.score,
    pureMarketScore,
    availabilityOnlyScore,
    plateau,
    ceiling,
  });

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
