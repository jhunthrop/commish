// Fits the blend's cap constants (and the market's own implied-games table) via a grid search
// against the store's own historical market boards, model boards and season outcomes, generating
// the committed `src/projections/market/blend-fitted.ts`.
// Run: npm run projections:blend:fit
//      npm run projections:blend:fit -- --check   (recomputes, exits 1 on any drift)
//
// TRAIN SEASONS: `BENCHMARK_BOARD_FLOOR` (2013) through `BLEND_TRAIN_CUTOFF_SEASON` (2021), inclusive —
// the identical window `market-curve-fit.ts` fits on, for the identical reason: this script blends a
// MARKET board with a model board, so a train season with no ADP board in the store contributes
// nothing but a hole. The upper bound is this task's own boundary, enforced structurally inside
// `scoreBlendConstants` itself so a mistake here fails loudly rather than quietly leaking a later
// season into the score.
//
// THIS WINDOW NO LONGER FOLLOWS `HISTORICAL_ROSTER_FLOOR` (fit-round Task 1), which moved to 2003
// when the week-one rosters were backfilled to the old decade. The ADP boards did not move with it
// and could not: the store holds `ffc_adp_ppr_12` for 2013 onward and for nothing earlier.
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
// THE GRID IS PINNED TO ONE CELL (fit-round Task 4, the corrections-only ruling). Every cap axis and
// every fit-round axis carries a single value, the v7 configuration's own, so this script performs a
// PRE-REGISTERED EVALUATION rather than a search. The full history of what the grid was and why it
// was restricted lives on the axis lists themselves, below; the short version is that a widened
// search chose a cell whose board then lost the decisive held-out bar, and selecting a replacement
// cell after that look would have burned the held-out season.
//
// WHAT THIS RUN STILL COMPUTES rather than carries: the two market-side TABLES,
// `impliedGamesByPosition` and `marketTailByPosition`, both of which are derived from the train
// population directly (never from a grid) and both of which MUST move with the completed store, and
// the pinned cell's own train rho plus its channel decomposition, reported for the record.
//
// THE FOUR NEW AXES (fit-round Task 3), crossed with those caps, EVERY ONE OF THEM CARRYING THE
// INCUMBENT AS ITS OWN NULL CELL — which is the property that makes this grid safe to widen at all:
// the fit can always choose today's board, so a new dimension can only be admitted by beating it on
// train.
//
//   - LAW-CLUSTER DEDUP (`lawClusterDedup`): the strongest law per correlation cluster instead of
//     the sum over it. Task 2's redundancy finding is the reason it exists as a choice.
//   - THE PER-PLAYER LAW-CHANNEL CAP (`playerLawCapPoints`): a bound on what the law channel as a
//     whole may spend on one player. Forty correlated goal-line laws are what a per-LAW cap cannot
//     control on its own.
//   - THE PROPS ANCHOR (`propsAnchorWeight`): how far off ADP toward the archived pre-kickoff props
//     anchor a listed player is priced. STRUCTURALLY A NO-OP ON TODAY'S TRAIN WINDOW: the props
//     archive holds 2023 and 2024, this fit trains on 2013-2021, so every train season's anchor map
//     is empty and every player falls back to ADP per player. The axis is fitted anyway, and its own
//     coverage number is printed and written into the generated header, because a dimension that
//     cannot move is a fact worth recording rather than a line of code worth hiding.
//   - THE AVAILABILITY RECENCY DECAY (`availabilityRecencyDecay`): the exponent
//     `shrunkAvailabilityRate` already weighs a player's own games history by. This is the one axis
//     that moves the MODEL rather than the blend, so it rebuilds the candidate rows per value; the
//     null cell is the committed `FITTED_AVAILABILITY_PRIORS`, used by reference.
//
// TIES GO TO THE INCUMBENT. Every axis lists its null cell FIRST and the winner comparison is a
// strict `>`, so an axis with no evidence to move on (the props one, today) cannot win by sort
// order, and a null-cell winner renders the identical object shape the committed file already has.
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
import { createDb } from "@research-ts/db/client";
import { PPR_SCORING } from "@research-ts/domain/scoring";
import type { Position } from "@research-ts/domain/player";
import {
  BLEND_TRAIN_CUTOFF_SEASON,
  detectPlateau,
  fitMarketTailByPosition,
  scoreBlendConstants,
  type BlendConstants,
  type BlendTrainRow,
  type ScoredCell,
} from "@research-ts/projections/market/blend";
import {
  fitImpliedGamesByPosition,
  loadMarketCurveObservations,
  marketBoard,
  type ImpliedGamesByPosition,
} from "@research-ts/projections/market/curve";
import { propsAnchorForSeason } from "@research-ts/projections/market/props-anchor";
import { withAvailabilityRecency } from "@research-ts/projections/preseason/availability";
import { registry } from "@research-ts/projections/laws/registry";
import { statLinesAsOfForMeasurement } from "@research-ts/projections/nflverse/derived-stat-lines";
import { BENCHMARK_BOARD_FLOOR } from "@research-ts/projections/preseason/benchmarks";
import { LAST_POSSIBLE_WEEK } from "@research-ts/projections/store";
import { computeFantasyPoints } from "@research-ts/scoring/compute";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@research-ts/projections/preseason/fitted";
import { FITTED_MODEL } from "@research-ts/projections/model/source";
import { loadPreseason, preseasonCandidates, SHIPPED_PRESEASON_FEATURES, type PreseasonPriors } from "@research-ts/projections/preseason/source";
import { gradableInputs } from "@research-ts/projections/preseason/scorecard";
import type { ReadonlyDb } from "@research-ts/db/client";
import { packagePath } from "@research-ts/lib/package-path";

const OUTPUT = packagePath("src/projections/market/blend-fitted.ts");

/**
 * THE CORRECTIONS-ONLY RESTRICTION (fit-round Task 4, founder ruling of 2026-09-02, after the v8
 * configuration's held-out bar break).
 *
 * THIS SCRIPT NO LONGER SEARCHES. Every axis below carries exactly ONE value, and that value is the
 * v7 configuration's own cell: the constants the board has been shipping and whose held-out verdict
 * (2024 blend vs ADP +0.1002 [+0.0041, +0.2089] BEYOND NOISE) is the one that stands. The run is a
 * PRE-REGISTERED EVALUATION, not a selection: it re-derives the two fitted TABLES that must move with
 * the completed store (`impliedGamesByPosition` and `marketTailByPosition`, both market-side and both
 * computed outside the grid), reports the train rho of the pinned cell for the record, and renders.
 * Nothing about the cell is chosen by anything this run measures.
 *
 * WHY, in one line, because a reader a year from now will otherwise assume a search happened: the
 * widened grid of the same task chose a different cell, that cell's board lost the decisive 2024 bar,
 * and the founder's ruling was to keep the round's genuine CORRECTIONS (the full-cohort rookie curve,
 * the re-measured law family, the pricing gate) while returning the blend's own semantics to the
 * configuration that had already earned its verdict. Selecting a NEW cell after a held-out look would
 * have burned the held-out season, which is exactly what the plan's STOP rule exists to prevent.
 *
 * THE GRID IS RESTORED BY WIDENING THESE FOUR LISTS AND THE THREE CAP LISTS BACK OUT, and the next
 * round that means to search should do so deliberately, with the multiple-comparisons cost the 54x
 * widening carried stated up front.
 */
const LAW_CAP_GRID = [2] as const;
const AVAILABILITY_CAP_GRID = [20] as const;
const TOTAL_CAP_GRID = [40] as const;

/** The cap ceiling the plateau report is read against. With the grid pinned to one cell there is no
 *  plateau to detect, and this is only what the generated header names as the edge of what the run
 *  was allowed to try — which, this round, is the pinned cell itself. */
const CAP_CEILING = TOTAL_CAP_GRID[TOTAL_CAP_GRID.length - 1];

/**
 * THE FOUR FIT-ROUND AXES (Task 3, deliverables B, C and D), and the ONE rule they all obey: THE
 * NULL CELL COMES FIRST IN EVERY LIST, and the winner comparison below is a STRICT `>`. A tie
 * therefore keeps the incumbent — which matters more than it sounds, because on the train window
 * some of these axes are expected to be exact no-ops (the props archive covers 2023 and 2024; this
 * fit trains on 2013-2021), and an axis that changes nothing must not be able to win by sort order.
 */
const LAW_CLUSTER_DEDUP_GRID = [false] as const;
/** `null` is the null cell: no per-player law-channel cap at all. */
const PLAYER_LAW_CAP_GRID = [null] as const;
/** `0` is the null cell: ADP only, and `anchorPointsFor` returns `marketPoints` untouched. */
const PROPS_ANCHOR_WEIGHT_GRID = [0] as const;
/** `null` is the null cell: the committed `FITTED_AVAILABILITY_PRIORS`, by reference. */
const AVAILABILITY_RECENCY_GRID = [null] as const;

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

/**
 * THE TRAIN WINDOW — `BENCHMARK_BOARD_FLOOR` through `BLEND_TRAIN_CUTOFF_SEASON`, inclusive, and the
 * ONE season list this whole script reads data for. Exported so `blend-fit-structure.test.ts` can
 * assert both halves of the structural pin: that it is disjoint from the seasons the scorecard judges
 * on, and that no other season list exists in this file for a data read to use.
 */
export function blendTrainSeasons(): readonly number[] {
  const seasons: number[] = [];
  for (let season = BENCHMARK_BOARD_FLOOR; season <= BLEND_TRAIN_CUTOFF_SEASON; season += 1) seasons.push(season);
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

/**
 * EVERY DATABASE READ ONE TRAIN SEASON NEEDS, made ONCE — the model inputs, the market board, the
 * outcomes, and the season's own props anchor. Kept separate from row construction (below) because
 * the availability-recency axis rebuilds the CANDIDATES for each of its values while every one of
 * these reads is identical across them: reading them once per season instead of once per (season,
 * recency) is the difference between nine model input loads and twenty-seven.
 */
interface SeasonFacts {
  readonly season: number;
  readonly inputs: Awaited<ReturnType<typeof gradableInputs>>;
  readonly marketByPlayer: ReadonlyMap<string, Awaited<ReturnType<typeof marketBoard>>["entries"][number]>;
  readonly actual: ReadonlyMap<string, number>;
  readonly droppedCount: number;
  /** Player id to props-anchor points in market units, EMPTY for a season the archive does not
   *  cover — which is every train season today, and is the null cell, cleanly. */
  readonly propsAnchor: ReadonlyMap<string, number>;
}

async function factsForSeason(db: ReadonlyDb, season: number, impliedGamesByPosition: ImpliedGamesByPosition): Promise<SeasonFacts> {
  // Fix round I3: `gradableInputs` is the convergence point every grading script calls through,
  // immediately after `loadPreseason` — see its own docblock in `preseason/scorecard.ts`. This
  // script's train rows feed the blend's own fitted constants from `actualSeasonPoints` below, so a
  // live board reaching this function would poison a fit with a non-existent outcome.
  const inputs = gradableInputs(await loadPreseason(db, season));
  const { entries: market, droppedCount } = await marketBoard(db, season, inputs.moment);
  const marketByPlayer = new Map(market.map((entry) => [entry.playerId, entry] as const));
  const actual = await actualSeasonPoints(db, season, inputs.positions);

  // THE PROPS ANCHOR (deliverable C) — `propsAnchorForSeason` (`market/props-anchor.ts`), the one
  // firstKickoffFor -> loadArchivedPropLines -> propsAnchorPoints sequence every caller of the
  // props archive shares (props-round plumbing, 2026-09-05). A season with no schedule rows at all
  // (never for a completed season) or no archived pre-kickoff lines yields an empty map, which is
  // exactly the ADP-only null cell.
  const propsAnchor = await propsAnchorForSeason(
    db,
    season,
    inputs.positions,
    new Map([...marketByPlayer].map(([playerId, entry]) => [playerId, entry.marketPoints] as const)),
    impliedGamesByPosition,
  );

  return { season, inputs, marketByPlayer, actual, droppedCount, propsAnchor };
}

/** One train season's worth of rows at ONE availability-recency value: every player who appears on
 *  BOTH that season's market board and its model board, joined to what he actually scored (zero, not
 *  dropped, for a listed player who never recorded a stat line — the identical counting choice
 *  `market/curve.ts`'s own train loader makes). */
function rowsForSeason(facts: SeasonFacts, recencyDecay: number | null): readonly BlendTrainRow[] {
  const priors: PreseasonPriors = { ...PRIORS, availability: withAvailabilityRecency(PRIORS.availability, recencyDecay) };
  const candidates = preseasonCandidates(facts.inputs, SHIPPED_PRESEASON_FEATURES, priors);
  const rows: BlendTrainRow[] = [];
  for (const candidate of candidates) {
    const marketEntry = facts.marketByPlayer.get(candidate.playerId);
    if (marketEntry === undefined) continue;
    rows.push({
      season: facts.season,
      market: marketEntry,
      candidate,
      actualPoints: facts.actual.get(candidate.playerId) ?? 0,
      propsAnchor: facts.propsAnchor,
    });
  }
  return rows;
}

/**
 * ONE POINT ON THE FOUR FIT-ROUND AXES. Held separately from `BlendConstants` while the grid runs
 * because `availabilityRecencyDecay` picks the ROW SET (it rebuilds candidates) while the other
 * three are constants, and because `constantsFor` OMITS every axis sitting at its null cell so the
 * generated file's shape is unchanged whenever the incumbent wins.
 */
interface FitAxes {
  readonly availabilityRecencyDecay: number | null;
  readonly propsAnchorWeight: number;
  readonly lawClusterDedup: boolean;
  readonly playerLawCapPoints: number | null;
}

interface BestCell {
  readonly constants: BlendConstants;
  readonly score: number;
  /** The row set this cell was scored on — the winner's own recency value picks it. */
  readonly rows: readonly BlendTrainRow[];
}

function isNullCell(axes: FitAxes): boolean {
  return (
    axes.availabilityRecencyDecay === AVAILABILITY_RECENCY_GRID[0] &&
    axes.propsAnchorWeight === PROPS_ANCHOR_WEIGHT_GRID[0] &&
    axes.lawClusterDedup === LAW_CLUSTER_DEDUP_GRID[0] &&
    axes.playerLawCapPoints === PLAYER_LAW_CAP_GRID[0]
  );
}

/** THE INCUMBENT'S OWN FILE SHAPE IS PRESERVED AT THE NULL CELL: an axis sitting at its null value
 *  contributes NO field, so a null-cell winner renders exactly the object shape the committed
 *  `blend-fitted.ts` already carries, and `market/blend.ts` reads its absence as the incumbent. */
function constantsFor(base: BlendConstants, axes: FitAxes): BlendConstants {
  return {
    ...base,
    ...(axes.lawClusterDedup ? { lawClusterDedup: true } : {}),
    ...(axes.playerLawCapPoints === null ? {} : { playerLawCapPoints: axes.playerLawCapPoints }),
    ...(axes.propsAnchorWeight === 0 ? {} : { propsAnchorWeight: axes.propsAnchorWeight }),
    ...(axes.availabilityRecencyDecay === null ? {} : { availabilityRecencyDecay: axes.availabilityRecencyDecay }),
  };
}

function axesOf(constants: BlendConstants): FitAxes {
  return {
    availabilityRecencyDecay: constants.availabilityRecencyDecay ?? null,
    propsAnchorWeight: constants.propsAnchorWeight ?? 0,
    lawClusterDedup: constants.lawClusterDedup ?? false,
    playerLawCapPoints: constants.playerLawCapPoints ?? null,
  };
}

function sameAxes(a: FitAxes, b: FitAxes): boolean {
  return (
    a.availabilityRecencyDecay === b.availabilityRecencyDecay &&
    a.propsAnchorWeight === b.propsAnchorWeight &&
    a.lawClusterDedup === b.lawClusterDedup &&
    a.playerLawCapPoints === b.playerLawCapPoints
  );
}

function describeAxes(axes: FitAxes): string {
  return (
    `recency=${axes.availabilityRecencyDecay ?? "committed"}  props=${axes.propsAnchorWeight}  ` +
    `dedup=${axes.lawClusterDedup}  playerLawCap=${axes.playerLawCapPoints ?? "none"}`
  );
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
  /** The winner's own position on the four fit-round axes, and how many rows carried a props anchor
   *  at all — both recorded in the generated header so a reader of the committed constants can see
   *  which axes had evidence to move on and which were structurally no-ops. */
  readonly axes: FitAxes;
  readonly propsAnchoredRows: number;
  readonly totalRows: number;
  readonly cellCount: number;
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
 * SINGLE-CELL REGENERATION PER THE CORRECTIONS-ONLY RULING (fit-round Task 4, 2026-09-02). CONSTANTS
 * CARRIED FROM THE v7 CONFIGURATION, TRAIN RHO REPORTED FOR THE RECORD, NOTHING SELECTED. This file
 * was not produced by a search: \`scripts/blend-fit.ts\`'s cap axes and fit-round axes each carry
 * exactly one value, the v7 cell, and the run below evaluated that one cell. The two market-side
 * tables ARE re-derived from the train population, because they must move with the store:
 * \`impliedGamesByPosition\` is the market curve's own train population's mean games played per
 * position (\`fitImpliedGamesByPosition\`) and \`marketTailByPosition\` caps the unlisted fallback at
 * the market's own cheapest drafted man per position (see \`market/blend.ts\`'s own docblocks).
 *
 * THE PINNED CELL'S SCORE: spearman rho = ${summary.bestScore.toFixed(4)} on ${summary.totalRows} train rows, over
 * predictor seasons up to and including \`BLEND_TRAIN_CUTOFF_SEASON\` (2021). This number is a
 * DESCRIPTION of the shipped configuration on this store, not a comparison and not a selection
 * criterion, and it is not comparable to any previous round's rho: the store's own population changed
 * underneath it when the crosswalk class fix landed.
 *
 * THE PLATEAU: ${summary.plateau.tiedCellCount} of ${summary.cellCount} cells scored within 1e-4 of the reported cell, which is
 * arithmetic rather than evidence when the grid holds one cell. No plateau claim is made this round.
 *
 * THE CHANNEL DECOMPOSITION, computed OUTSIDE the pinned cell purely to describe it: pure market
 * (every cap at zero) ${summary.pureMarketScore === null ? "n/a" : summary.pureMarketScore.toFixed(4)}, availability admitted alone (lawCapPoints at zero, the
 * pinned availability/total caps otherwise) ${summary.availabilityOnlyScore === null ? "n/a" : summary.availabilityOnlyScore.toFixed(4)}, laws admitted too (the pinned cell in full)
 * ${summary.bestScore.toFixed(4)}. Laws' own share of the total lift over pure market is ${lawShare}%.
 *
 * THE FIT-ROUND AXES (Task 3) all sit at their null cells, which is the v7 semantics exactly:
 * ${describeAxes(summary.axes)}. An axis absent from the object below sits at its null cell.
 * PROPS-ANCHOR COVERAGE: ${summary.propsAnchoredRows} of ${summary.totalRows} train rows sit in a season the props archive
 * covers. Zero is expected and is a statement about the archive's own span (2023-2024) against this
 * train window (2013-2021), never about props.
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

  const seasons = blendTrainSeasons();
  console.log(`BLEND FIT, train seasons ${seasons.join(", ")}`);

  // THE IMPLIED-GAMES TABLE IS FIT FIRST because the props anchor needs it: its own step 4 converts a
  // per-game props number into a season one through exactly this table (`props-anchor.ts`).
  console.log("\nfitting the market's own implied games-played table (I3+I5)...");
  const marketCurveObservations = await loadMarketCurveObservations(db, seasons);
  const impliedGamesByPosition = fitImpliedGamesByPosition(marketCurveObservations);
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    console.log(`  ${position}: ${impliedGamesByPosition[position].toFixed(2)} implied games`);
  }

  console.log("");
  const facts: SeasonFacts[] = [];
  for (const season of seasons) {
    const seasonFacts = await factsForSeason(db, season, impliedGamesByPosition);
    facts.push(seasonFacts);
    console.log(
      `  ${season}: ${seasonFacts.marketByPlayer.size} market rows, ${seasonFacts.droppedCount} dropped (unresolved position), ` +
        `${seasonFacts.propsAnchor.size} players props-anchored`,
    );
  }

  await db.$client.end();

  // ONE ROW SET PER AVAILABILITY-RECENCY VALUE (deliverable D). The candidates themselves move with
  // this axis — it changes `games.expected` — so it cannot be a constants-only dimension.
  const rowsByRecency = new Map<number | null, readonly BlendTrainRow[]>(
    AVAILABILITY_RECENCY_GRID.map((recency) => [recency, facts.flatMap((seasonFacts) => rowsForSeason(seasonFacts, recency))] as const),
  );
  const nullCellRecency = AVAILABILITY_RECENCY_GRID[0];
  const baselineRows = rowsByRecency.get(nullCellRecency)!;
  console.log(`\nfit on ${baselineRows.length} (player, season) rows across seasons ${seasons.join(", ")}`);
  const propsAnchoredRows = baselineRows.filter((row) => (row.propsAnchor?.size ?? 0) > 0).length;
  console.log(
    `props anchor coverage: ${propsAnchoredRows} of ${baselineRows.length} rows sit in a season with an archive. ` +
      "The props archive holds 2023 and 2024; this fit trains on 2013-2021, so a zero here is EXPECTED and the " +
      "props-weight axis is then an exact no-op whose null cell wins on the tie rule.",
  );

  // `laws` computed ONCE, off the real committed registry, and passed to every grid cell explicitly
  // — `scoreBlendConstants`/`blendBoard` would otherwise default to calling `registry()` (a disk
  // read + JSON parse) on every single row of every single grid cell, which at GRID.length^3 cells
  // times `rows.length` rows would mean hundreds of thousands of redundant file reads.
  const laws = registry();

  console.log("\nfitting the structural tail guard, per position (fix round 2, ruling 2), the unlisted fallback's only pricing rule (fix round 3, IMPORTANT 1)...");
  // Market-side only, and the market board does not move with any of this round's axes, so the
  // null-cell row set is the right (and the cheapest) population to fit it from.
  const marketTailByPosition = fitMarketTailByPosition(baselineRows);
  for (const position of ["QB", "RB", "WR", "TE"] as const) {
    console.log(`  ${position}: ${marketTailByPosition[position].toFixed(1)} pts (the market's own cheapest drafted man at this position)`);
  }

  console.log("\nTHE PINNED CELL (corrections-only ruling: a pre-registered evaluation, not a search):");
  console.log(`  lawCapPoints: ${LAW_CAP_GRID.join(", ")}`);
  console.log(`  availabilityCapPoints: ${AVAILABILITY_CAP_GRID.join(", ")}`);
  console.log(`  totalCapPoints: ${TOTAL_CAP_GRID.join(", ")}`);
  console.log(`  law-cluster dedup: ${LAW_CLUSTER_DEDUP_GRID.join(", ")}`);
  console.log(`  per-player law-channel cap: ${PLAYER_LAW_CAP_GRID.map((value) => value ?? "none").join(", ")}`);
  console.log(`  props-anchor weight: ${PROPS_ANCHOR_WEIGHT_GRID.join(", ")}`);
  console.log(`  availability recency decay: ${AVAILABILITY_RECENCY_GRID.map((value) => value ?? "committed").join(", ")}`);
  console.log("  every axis carries one value, the v7 configuration's own. NOTHING IS SELECTED BY THIS RUN.\n");

  let best: BestCell | null = null;
  const cells: ScoredCell[] = [];
  for (const availabilityRecencyDecay of AVAILABILITY_RECENCY_GRID) {
    const rows = rowsByRecency.get(availabilityRecencyDecay)!;
    for (const propsAnchorWeight of PROPS_ANCHOR_WEIGHT_GRID) {
      for (const lawClusterDedup of LAW_CLUSTER_DEDUP_GRID) {
        for (const playerLawCapPoints of PLAYER_LAW_CAP_GRID) {
          const axes: FitAxes = { availabilityRecencyDecay, propsAnchorWeight, lawClusterDedup, playerLawCapPoints };
          let bestInAxes: BestCell | null = null;
          for (const lawCapPoints of LAW_CAP_GRID) {
            for (const availabilityCapPoints of AVAILABILITY_CAP_GRID) {
              for (const totalCapPoints of TOTAL_CAP_GRID) {
                const constants = constantsFor(
                  { lawCapPoints, availabilityCapPoints, totalCapPoints, impliedGamesByPosition, marketTailByPosition },
                  axes,
                );
                const score = scoreBlendConstants(rows, constants, { heldOutSeasons: [], laws });
                cells.push({ constants, score });
                if (score === null) continue;
                if (bestInAxes === null || score > bestInAxes.score) bestInAxes = { constants, score, rows };
                if (best === null || score > best.score) best = { constants, score, rows };
              }
            }
          }
          // ONE LINE PER AXES COMBINATION rather than one per cell: the full cross is 18,522 cells and
          // a per-cell table would bury the run's own verdict in its own log. The cap axes' full table
          // is still printed below, for the winner's own axes, exactly as it always was.
          console.log(`${describeAxes(axes).padEnd(74)}  best rho ${bestInAxes === null ? "n/a" : bestInAxes.score.toFixed(4)}`);
        }
      }
    }
  }

  if (best !== null) {
    console.log(`\nTHE CAP TABLE AT THE PINNED AXES (${describeAxes(axesOf(best.constants))}), every cell:\n`);
    console.log(`${"lawCap".padStart(7)}  ${"availCap".padStart(9)}  ${"totalCap".padStart(9)}  ${"rho".padStart(8)}`);
    for (const cell of cells) {
      if (!sameAxes(axesOf(cell.constants), axesOf(best.constants))) continue;
      console.log(
        `${String(cell.constants.lawCapPoints).padStart(7)}  ${String(cell.constants.availabilityCapPoints).padStart(9)}  ` +
          `${String(cell.constants.totalCapPoints).padStart(9)}  ${cell.score === null ? "n/a".padStart(8) : cell.score.toFixed(4).padStart(8)}`,
      );
    }
  }

  console.log(`\nscored ${cells.length} grid cell(s)`);

  if (best === null) {
    throw new Error("The blend fit found no scoreable combination; every cell returned null from `spearman`.");
  }

  // THE PURE-MARKET BASELINE, computed OUTSIDE the grid (corrections-only ruling). It used to be one
  // of the searched cells; with the grid pinned to the v7 cell it is a separate, deliberate scoring
  // of the same rows at zero deviation, kept because the channel decomposition below is the only
  // thing that makes the reported rho readable. It cannot influence what is rendered.
  const pureMarketScore = scoreBlendConstants(
    best.rows,
    { ...best.constants, lawCapPoints: 0, availabilityCapPoints: 0, totalCapPoints: 0 },
    { heldOutSeasons: [], laws },
  );
  console.log(
    `\nPURE MARKET BASELINE (lawCapPoints=0, availabilityCapPoints=0, totalCapPoints=0, zero deviation from marketPoints for every ` +
      `listed player): rho=${pureMarketScore === null ? "n/a" : pureMarketScore.toFixed(4)}`,
  );

  const beatsPureMarket = pureMarketScore !== null && best.score > pureMarketScore;
  console.log(
    `\nTHE PINNED CELL: lawCapPoints=${best.constants.lawCapPoints}  availabilityCapPoints=${best.constants.availabilityCapPoints}  ` +
      `totalCapPoints=${best.constants.totalCapPoints}  ${describeAxes(axesOf(best.constants))}  ` +
      `(spearman rho=${best.score.toFixed(4)} on the train rows, ` +
      `${beatsPureMarket ? "beats" : "does NOT beat"} the pure-market baseline)`,
  );
  console.log(
    isNullCell(axesOf(best.constants))
      ? "Every fit-round axis sits at its null cell, which is the v7 semantics exactly: the rendered constants carry no new field."
      : "A fit-round axis is off its null cell, which the corrections-only ruling does not allow. Check the axis lists.",
  );

  // THE CHANNEL DECOMPOSITION (fix round 2) — the pinned cell with lawCapPoints forced to zero,
  // isolating how much of the winner's own lift over pure market comes from the availability channel
  // alone versus laws on top of it. Scored on the WINNER'S OWN row set, since the recency axis moves
  // the rows themselves.
  const availabilityOnlyConstants: BlendConstants = { ...best.constants, lawCapPoints: 0 };
  const availabilityOnlyScore = scoreBlendConstants(best.rows, availabilityOnlyConstants, { heldOutSeasons: [], laws });
  console.log(
    `\nCHANNEL DECOMPOSITION: pure market ${pureMarketScore === null ? "n/a" : pureMarketScore.toFixed(4)}  ->  availability admitted alone ` +
      `${availabilityOnlyScore === null ? "n/a" : availabilityOnlyScore.toFixed(4)}  ->  laws admitted too (the pinned cell) ${best.score.toFixed(4)}`,
  );

  // THE PLATEAU GUARD (fix round 2, ruling 4b) — every cell within 1e-4 of the reported one. With a
  // one-cell grid this is arithmetic rather than evidence, and the generated header says so.
  const ceiling = CAP_CEILING;
  const plateau = detectPlateau(cells, best.score, ceiling);
  console.log(
    `\nPLATEAU: ${plateau.tiedCellCount} of ${cells.length} cell(s) scored within 1e-4 of the reported cell, ` +
      "which with a pinned grid is a statement about the grid rather than about the objective's shape.",
  );

  const rendered = render(best.constants, {
    bestScore: best.score,
    pureMarketScore,
    availabilityOnlyScore,
    plateau,
    ceiling,
    axes: axesOf(best.constants),
    propsAnchoredRows,
    totalRows: baselineRows.length,
    cellCount: cells.length,
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

// GUARDED, the identical `import.meta.url` discipline `scripts/preseason-persist.ts` uses: importing
// this module (the structural pin, asking what season list it reads) must not run a fit.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
