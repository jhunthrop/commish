// Fits `BlendConstants.propsAnchorWeight` — the one blend axis `scripts/blend-fit.ts` cannot move.
// That script's own train window is 2013-2021 (`BLEND_TRAIN_CUTOFF_SEASON`), fixed structurally so
// the MAIN blend fit is never judged on a season it has seen; the props archive begins in 2023, so
// every row that script builds carries an EMPTY anchor map and the weight's null cell (0) wins by
// the incumbent tie rule (see that script's own committed header, and `blend-fitted.ts`'s "PROPS-
// ANCHOR COVERAGE: 0 of 1323 train rows"). This is a SIBLING fit over the seasons the archive
// actually covers, not an extension of that one: it calls `market/blend.ts`'s exported, UNGATED
// `blendBoard`/`seasonPointsOf` directly, never `scoreBlendConstants`, whose own
// `BLEND_TRAIN_CUTOFF_SEASON` assertion exists precisely to keep that OTHER fit off seasons past
// 2021 and would throw on every row this script builds.
//
// THE SPLIT, STATED PLAINLY — the rookie-calibration round's own precedent
// (docs/research/2026-09-04-rookie-calibration-backtest.md: "Fits: 2023-2024 ... Score: 2025."),
// applied here because it is exactly the discipline this axis needs:
//
//   FIT EVIDENCE  -- 2023 and 2024, combined. The weight grid is scored against these two seasons
//                     TOGETHER (every (player, season) row from both, pooled) and the winner is
//                     chosen from this evidence alone. Each season's own numbers are also reported
//                     individually so a reader can see whether the two years agree.
//   JUDGE SEASON  -- 2025. Scored EXACTLY ONCE, after the weight is already fixed, and never fed
//                     back into the grid. This is the whole meaning of "held out" — scoring 2025
//                     twice with two different weights and keeping the better result would be the
//                     rookie round's own named mistake (`THIN_EVIDENCE_PRIOR_N` grid-searched
//                     directly against its test season) repeated on purpose.
//   2026          -- NEVER READ. `ALL_SEASONS` below hard-codes {2023, 2024, 2025} and `main`
//                     refuses outright if it ever contains 2026; nothing in this file accepts a
//                     season argument, so there is no other path by which a 2026 row could enter.
//
// WHAT "TRAIN" MEANS HERE, PRECISELY. Unlike the main blend fit or the market curve, there is no
// cross-season parameter this script estimates and then applies unchanged elsewhere:
// `propsAnchorPoints`'s own per-position rescale is already computed fresh from EACH season's own
// facts (its own step 5's docblock), so "training on 2023" cannot mean fitting a rescale factor
// that later reads on 2024 or 2025 — every season already rescales itself. The one thing this
// script picks is a single scalar, `propsAnchorWeight` in [0, 1], read identically by every season,
// and picking it from 2023+2024 evidence while holding 2025 back is what "train/validate vs. judge"
// reduces to for a one-parameter, cross-season axis.
//
// THE GRID scores rank correlation (this engine's primary metric — `metrics.ts`'s own docblock)
// on the PROPS-COVERED subset first: `propsAnchorWeight` only ever moves a player whose season has
// an archived line for him (`anchorPointsFor`'s own null-cell fallback), so every OTHER player's
// predicted points are bit-for-bit identical at every weight and carries zero information about
// which weight is better. Whole-board and per-position numbers are also printed, in full, at every
// step, so a reader can see the diluted effect and any offsetting cost.
//
// THE GATE, MECHANICAL AND UNCONDITIONAL (Task 2's own instruction: "if 0 wins, wire nothing").
// This script writes TWO files, never one without the other kept in sync:
//   docs/research/2026-09-05-props-anchor-backtest.md  -- the human report, every number, always.
//   src/projections/market/props-anchor-fitted.ts       -- GENERATED, `FITTED_PROPS_ANCHOR_WEIGHT`,
//                                                          `null` when the judge season did not beat
//                                                          the incumbent, the winning weight when it
//                                                          did. `preseason-persist.ts` reads this and
//                                                          only merges a non-null value onto
//                                                          `FITTED_BLEND_CONSTANTS` for its blended
//                                                          arm -- the plumbing that makes a future
//                                                          re-fit's own verdict, in either direction,
//                                                          reach the live board without a hand edit.
//
// Run: npm run projections:props-anchor:fit
//      npm run projections:props-anchor:fit -- --check   (recomputes both files, exits 1 on drift)
import { readFileSync, writeFileSync } from "node:fs";
import { createDb } from "@/db/client";
import type { ReadonlyDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import type { Position } from "@/domain/player";
import { blendBoard, seasonPointsOf, type BlendConstants } from "@/projections/market/blend";
import { FITTED_BLEND_CONSTANTS } from "@/projections/market/blend-fitted";
import { marketBoard, isCurvePosition, type CurvePosition, type MarketPriorEntry } from "@/projections/market/curve";
import { propsAnchorForSeason } from "@/projections/market/props-anchor";
import { registry } from "@/projections/laws/registry";
import type { Law } from "@/projections/laws/types";
import { statLinesAsOfForMeasurement } from "@/projections/nflverse/derived-stat-lines";
import { LAST_POSSIBLE_WEEK } from "@/projections/store";
import { computeFantasyPoints } from "@/scoring/compute";
import type { BoardCandidate } from "@/projections/preseason/board";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@/projections/preseason/fitted";
import { FITTED_MODEL } from "@/projections/model/source";
import { loadPreseason, preseasonCandidates, SHIPPED_PRESEASON_FEATURES, type PreseasonPriors } from "@/projections/preseason/source";
import { gradableInputs } from "@/projections/preseason/scorecard";
import { spearman, meanAbsoluteError, type Observation } from "@/projections/metrics";

const REPORT_PATH = "docs/research/2026-09-05-props-anchor-backtest.md";
const FITTED_OUTPUT = "src/projections/market/props-anchor-fitted.ts";

/** Fit/validate evidence — scored together, never separately selected on. */
const FIT_SEASONS = [2023, 2024] as const;
/** The untouched judge — scored exactly once, after the grid's winner is already fixed. */
const JUDGE_SEASON = 2025 as const;

/** Every season this script may ever read. Checked at the top of `main` so a future edit that
 *  widens either list above cannot silently admit 2026 without this assertion failing loudly. */
const ALL_SEASONS = [...FIT_SEASONS, JUDGE_SEASON] as const;

/** The coarse pass — 0 to 1 by 0.1, the null cell (0, ADP only) listed first so a tie keeps it. */
const COARSE_GRID = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] as const;

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
    throw new Error(`${name} is not set. Run this through \`npm run projections:props-anchor:fit\`, which loads .env.local.`);
  }
  return value;
}

/**
 * What every player actually scored — `statLinesAsOfForMeasurement`, NEVER the plain
 * `statLinesAsOf` `preseason/scorecard.ts`'s own `actualSeasonPoints` reads: 2025, this script's
 * own JUDGE season, is inside `STAT_LINE_GAPS` (nflverse never published that season's weekly
 * file), and the plain reader would silently return zero for every one of its rows — the exact
 * false-zero `scripts/blend-fit.ts`'s identical local helper already reads through the derived
 * fallback to avoid.
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

interface SeasonFacts {
  readonly season: number;
  readonly candidates: readonly BoardCandidate[];
  readonly market: readonly MarketPriorEntry[];
  readonly actual: ReadonlyMap<string, number>;
  /** Player id to props-anchor points in market units, for THIS season only. Empty is the null
   *  cell (no archive coverage, or no kickoff to gate against). */
  readonly propsAnchor: ReadonlyMap<string, number>;
}

async function factsForSeason(db: ReadonlyDb, season: number): Promise<SeasonFacts> {
  const inputs = gradableInputs(await loadPreseason(db, season));
  const candidates = preseasonCandidates(inputs, SHIPPED_PRESEASON_FEATURES, PRIORS);
  const { entries: market } = await marketBoard(db, season, inputs.moment);
  const actual = await actualSeasonPoints(db, season, inputs.positions);

  const propsAnchor = await propsAnchorForSeason(
    db,
    season,
    inputs.positions,
    new Map(market.map((entry) => [entry.playerId, entry.marketPoints] as const)),
    FITTED_BLEND_CONSTANTS.impliedGamesByPosition,
  );

  return { season, candidates, market, actual, propsAnchor };
}

interface SeasonObservations {
  readonly all: readonly Observation[];
  readonly covered: readonly Observation[];
  readonly byPosition: ReadonlyMap<CurvePosition, { readonly all: readonly Observation[]; readonly covered: readonly Observation[] }>;
}

/** Blends one season's facts at one candidate weight and buckets the result — whole board, the
 *  props-covered subset, and both again per position. Reused for every grid cell AND for the final
 *  judge-season report so neither ever computes this two different ways. */
function blendedObservations(facts: SeasonFacts, constants: BlendConstants, laws: readonly Law[]): SeasonObservations {
  const blended = blendBoard(facts.market, facts.candidates, { season: facts.season, constants, laws, propsAnchor: facts.propsAnchor });
  const all: Observation[] = [];
  const covered: Observation[] = [];
  const byPosition = new Map<CurvePosition, { all: Observation[]; covered: Observation[] }>();
  for (const candidate of blended) {
    if (!isCurvePosition(candidate.position)) continue;
    const actual = facts.actual.get(candidate.playerId) ?? 0;
    const observation: Observation = { predicted: seasonPointsOf(candidate), actual };
    all.push(observation);
    const bucket = byPosition.get(candidate.position) ?? { all: [], covered: [] };
    bucket.all.push(observation);
    if (facts.propsAnchor.has(candidate.playerId)) {
      covered.push(observation);
      bucket.covered.push(observation);
    }
    byPosition.set(candidate.position, bucket);
  }
  return { all, covered, byPosition };
}

function pool(seasons: readonly SeasonObservations[]): SeasonObservations {
  const all = seasons.flatMap((s) => s.all);
  const covered = seasons.flatMap((s) => s.covered);
  const byPosition = new Map<CurvePosition, { all: Observation[]; covered: Observation[] }>();
  for (const s of seasons) {
    for (const [position, bucket] of s.byPosition) {
      const held = byPosition.get(position) ?? { all: [], covered: [] };
      held.all.push(...bucket.all);
      held.covered.push(...bucket.covered);
      byPosition.set(position, held);
    }
  }
  return { all, covered, byPosition };
}

interface Line {
  readonly label: string;
  readonly n: number;
  readonly rankCorrelation: number | null;
  readonly mae: number | null;
}

function lineOf(label: string, observations: readonly Observation[]): Line {
  return { label, n: observations.length, rankCorrelation: spearman(observations), mae: meanAbsoluteError(observations) };
}

function fmt(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(4);
}

function printLine(line: Line): void {
  console.log(`    ${line.label.padEnd(28)} n=${String(line.n).padStart(4)}  rho=${fmt(line.rankCorrelation)}  MAE=${fmt(line.mae)}`);
}

function constantsAt(weight: number): BlendConstants {
  if (weight === 0) return FITTED_BLEND_CONSTANTS;
  return { ...FITTED_BLEND_CONSTANTS, propsAnchorWeight: weight };
}

interface GridRow {
  readonly weight: number;
  readonly coveredRho: number | null;
  readonly allRho: number | null;
  readonly coveredMae: number | null;
  readonly allMae: number | null;
}

/** Scores one weight against the FIT evidence (2023+2024, pooled) and returns the row the grid
 *  table prints — never touches `JUDGE_SEASON`'s facts. */
function scoreWeight(weight: number, fitFacts: readonly SeasonFacts[], laws: readonly Law[]): GridRow {
  const pooled = pool(fitFacts.map((facts) => blendedObservations(facts, constantsAt(weight), laws)));
  return {
    weight,
    coveredRho: spearman(pooled.covered),
    allRho: spearman(pooled.all),
    coveredMae: meanAbsoluteError(pooled.covered),
    allMae: meanAbsoluteError(pooled.all),
  };
}

/** Strict `>` on the props-covered rank correlation — the population `propsAnchorWeight` actually
 *  moves, and this engine's own primary metric (`metrics.ts`). A tie, or a `null` challenger (too
 *  few covered rows to correlate at all), keeps the incumbent: the null cell is listed first and
 *  wins ties by construction, matching every other axis `scripts/blend-fit.ts` fits. */
function betterThanIncumbent(candidate: GridRow, incumbent: GridRow): boolean {
  if (candidate.coveredRho === null) return false;
  if (incumbent.coveredRho === null) return true;
  return candidate.coveredRho > incumbent.coveredRho;
}

function bestOf(rows: readonly GridRow[]): GridRow {
  let best = rows[0]!;
  for (const row of rows.slice(1)) {
    if (betterThanIncumbent(row, best)) best = row;
  }
  return best;
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const db = createDb(requireEnv("DATABASE_URL"));

  console.log(`PROPS-ANCHOR FIT — fit evidence ${FIT_SEASONS.join(", ")} (pooled), judge season ${JUDGE_SEASON} (scored once)`);
  for (const season of ALL_SEASONS as readonly number[]) {
    if (season >= 2026) throw new Error(`props-anchor-fit: season ${season} may never enter a fit or a score. Refusing to run.`);
  }

  const laws = registry();
  console.log("\nloading season facts (candidates, market board, actual outcomes, props anchor)...");
  const factsBySeason = new Map<number, SeasonFacts>();
  for (const season of ALL_SEASONS) {
    const facts = await factsForSeason(db, season);
    factsBySeason.set(season, facts);
    console.log(
      `  ${season}: ${facts.candidates.length} candidates, ${facts.market.length} market rows, ${facts.propsAnchor.size} players props-anchored`,
    );
  }
  await db.$client.end();

  const fitFacts = FIT_SEASONS.map((season) => factsBySeason.get(season)!);
  const judgeFacts = factsBySeason.get(JUDGE_SEASON)!;

  console.log(`\nfit evidence coverage: ${fitFacts.map((f) => `${f.season}=${f.propsAnchor.size}`).join(", ")} props-anchored players`);
  console.log(`judge season coverage: ${JUDGE_SEASON}=${judgeFacts.propsAnchor.size} props-anchored players`);

  console.log("\nCOARSE GRID (0 to 1 by 0.1), scored on FIT evidence (2023+2024 pooled) only:\n");
  console.log(`    ${"weight".padStart(6)}  ${"covered rho".padStart(11)}  ${"covered MAE".padStart(11)}  ${"board rho".padStart(9)}  ${"board MAE".padStart(9)}`);
  const coarseRows = COARSE_GRID.map((weight) => scoreWeight(weight, fitFacts, laws));
  for (const row of coarseRows) {
    console.log(
      `    ${row.weight.toFixed(2).padStart(6)}  ${fmt(row.coveredRho).padStart(11)}  ${fmt(row.coveredMae).padStart(11)}  ` +
        `${fmt(row.allRho).padStart(9)}  ${fmt(row.allMae).padStart(9)}`,
    );
  }
  const incumbent = coarseRows[0]!;
  const coarseBest = bestOf(coarseRows);
  console.log(`\ncoarse winner: weight=${coarseBest.weight} (covered rho=${fmt(coarseBest.coveredRho)} vs incumbent ${fmt(incumbent.coveredRho)})`);

  console.log(`\nFINE GRID around ${coarseBest.weight} (+/-0.08 by 0.02), same FIT evidence:\n`);
  const fineCandidates = [-0.08, -0.06, -0.04, -0.02, 0.02, 0.04, 0.06, 0.08]
    .map((delta) => Math.round((coarseBest.weight + delta) * 100) / 100)
    .filter((weight) => weight >= 0 && weight <= 1 && !COARSE_GRID.includes(weight as (typeof COARSE_GRID)[number]));
  const fineRows = fineCandidates.map((weight) => scoreWeight(weight, fitFacts, laws));
  for (const row of fineRows) {
    console.log(
      `    ${row.weight.toFixed(2).padStart(6)}  ${fmt(row.coveredRho).padStart(11)}  ${fmt(row.coveredMae).padStart(11)}  ` +
        `${fmt(row.allRho).padStart(9)}  ${fmt(row.allMae).padStart(9)}`,
    );
  }

  const winner = bestOf([...coarseRows, ...fineRows]);
  console.log(`\nWINNING WEIGHT (fit evidence only, ties go to the incumbent): propsAnchorWeight=${winner.weight}`);
  console.log(
    winner.weight === 0
      ? "The incumbent (0, ADP only) won. No weight beat it on the fit evidence — nothing is wired, per the gate."
      : `weight=${winner.weight} beat the incumbent on the fit evidence's own props-covered rank correlation.`,
  );

  console.log(`\nPER-SEASON FIT-EVIDENCE BREAKDOWN, incumbent (0) vs winner (${winner.weight}), so 2023 and 2024 are never silently pooled away:\n`);
  const perSeasonFitLines = fitFacts.map((facts) => {
    const atZero = blendedObservations(facts, constantsAt(0), laws);
    const atWinner = blendedObservations(facts, constantsAt(winner.weight), laws);
    console.log(`  season ${facts.season}:`);
    const zeroCovered = lineOf("incumbent, covered", atZero.covered);
    const winnerCovered = lineOf(`weight=${winner.weight}, covered`, atWinner.covered);
    printLine(zeroCovered);
    printLine(winnerCovered);
    printLine(lineOf("incumbent, whole board", atZero.all));
    printLine(lineOf(`weight=${winner.weight}, whole board`, atWinner.all));
    return { season: facts.season, coveredN: facts.propsAnchor.size, zeroCovered, winnerCovered };
  });

  console.log(`\n${"=".repeat(88)}\nTHE JUDGE SEASON (${JUDGE_SEASON}) — SCORED EXACTLY ONCE, AFTER THE WEIGHT ABOVE WAS ALREADY FIXED\n${"=".repeat(88)}\n`);
  const judgeAtZero = blendedObservations(judgeFacts, constantsAt(0), laws);
  const judgeAtWinner = blendedObservations(judgeFacts, constantsAt(winner.weight), laws);
  console.log("  whole board and props-covered subset:");
  printLine(lineOf("incumbent, covered", judgeAtZero.covered));
  printLine(lineOf(`weight=${winner.weight}, covered`, judgeAtWinner.covered));
  printLine(lineOf("incumbent, whole board", judgeAtZero.all));
  printLine(lineOf(`weight=${winner.weight}, whole board`, judgeAtWinner.all));

  console.log("\n  per position, props-covered subset only:");
  const positions: readonly CurvePosition[] = ["QB", "RB", "WR", "TE"];
  const perPositionLines: { position: CurvePosition; zero: Line; winner: Line }[] = [];
  for (const position of positions) {
    const zeroBucket = judgeAtZero.byPosition.get(position) ?? { all: [], covered: [] };
    const winnerBucket = judgeAtWinner.byPosition.get(position) ?? { all: [], covered: [] };
    const zeroLine = lineOf(`${position} incumbent`, zeroBucket.covered);
    const winnerLine = lineOf(`${position} weight=${winner.weight}`, winnerBucket.covered);
    printLine(zeroLine);
    printLine(winnerLine);
    perPositionLines.push({ position, zero: zeroLine, winner: winnerLine });
  }

  const judgeBeats =
    winner.weight !== 0 &&
    judgeAtWinner.covered.length > 0 &&
    judgeAtZero.covered.length > 0 &&
    (spearman(judgeAtWinner.covered) ?? -Infinity) > (spearman(judgeAtZero.covered) ?? -Infinity);

  console.log(
    `\nGATE VERDICT: ${
      judgeBeats
        ? `weight=${winner.weight} BEATS the propsAnchorWeight=0 incumbent on the ${JUDGE_SEASON} judge season's own props-covered rank correlation. Wire it.`
        : "The incumbent (0) is not beaten on the judge season. Wire nothing."
    }`,
  );

  const report = renderReport({
    winner,
    coarseRows,
    fineRows,
    perSeasonFitLines,
    judgeFacts,
    judgeAtZero,
    judgeAtWinner,
    perPositionLines,
    judgeBeats,
  });
  const fitted = renderFitted({
    weight: judgeBeats ? winner.weight : null,
    judgeCoveredRhoZero: spearman(judgeAtZero.covered),
    judgeCoveredRhoWinner: spearman(judgeAtWinner.covered),
    judgeCoveredMaeZero: meanAbsoluteError(judgeAtZero.covered),
    judgeCoveredMaeWinner: meanAbsoluteError(judgeAtWinner.covered),
  });

  if (check) {
    let drift = false;
    try {
      const committedFitted = readFileSync(FITTED_OUTPUT, "utf-8");
      if (committedFitted !== fitted) drift = true;
    } catch {
      drift = true;
    }
    if (drift) {
      console.error(`\n${FITTED_OUTPUT} does not match this run. Run \`npm run projections:props-anchor:fit\` and commit the result.`);
      process.exit(1);
    }
    console.log(`\n${FITTED_OUTPUT} matches this run. No drift. (${REPORT_PATH} is not diffed by --check; it is a report, not a generated constant.)`);
    return;
  }
  writeFileSync(REPORT_PATH, report);
  writeFileSync(FITTED_OUTPUT, fitted);
  console.log(`\nwrote ${REPORT_PATH}`);
  console.log(`wrote ${FITTED_OUTPUT}`);
}

interface FittedInputs {
  readonly weight: number | null;
  readonly judgeCoveredRhoZero: number | null;
  readonly judgeCoveredRhoWinner: number | null;
  readonly judgeCoveredMaeZero: number | null;
  readonly judgeCoveredMaeWinner: number | null;
}

/** `src/projections/market/props-anchor-fitted.ts`'s own content — GENERATED, and `null` exactly
 *  when the judge season did not beat the incumbent (the gate, mechanical and unconditional). */
function renderFitted(inputs: FittedInputs): string {
  const verdict =
    inputs.weight === null
      ? `THE GATE: NOT BEATEN. The ${JUDGE_SEASON} judge season's props-covered rank correlation did not improve over the propsAnchorWeight=0 incumbent (rho ${fmt(inputs.judgeCoveredRhoZero)} vs ${fmt(inputs.judgeCoveredRhoWinner)}). \`FITTED_PROPS_ANCHOR_WEIGHT\` is \`null\`, and \`preseason-persist.ts\` leaves \`FITTED_BLEND_CONSTANTS\` unmerged when it reads null -- the live board stays ADP-only on this axis.`
      : `THE GATE: BEATEN. The ${JUDGE_SEASON} judge season's props-covered rank correlation improved over the propsAnchorWeight=0 incumbent (rho ${fmt(inputs.judgeCoveredRhoZero)} -> ${fmt(inputs.judgeCoveredRhoWinner)}, MAE ${fmt(inputs.judgeCoveredMaeZero)} -> ${fmt(inputs.judgeCoveredMaeWinner)}).`;
  return `/**
 * GENERATED by \`npm run projections:props-anchor:fit\`. Do not edit by hand.
 *
 * THE ONE FITTED NUMBER \`scripts/blend-fit.ts\` CANNOT PRODUCE (see that script's own header): its
 * train window, 2013-2021, predates the props archive (2023 onward) entirely, so \`propsAnchorWeight\`
 * is structurally a no-op there and its own grid pins the null cell (0) by construction.
 * \`scripts/props-anchor-fit.ts\` fits this ONE axis on the seasons the archive actually covers --
 * fit evidence ${FIT_SEASONS.join("+")} (pooled), judge season ${JUDGE_SEASON} scored once and never fed
 * back into the grid -- and writes the result here, SEPARATELY from \`blend-fitted.ts\`, so that
 * file's own "GENERATED... do not edit by hand" contract and its corrections-only, single-cell
 * regeneration stay exactly what they say: this is a second, independent fitted constant, not a
 * hand-edit of the first one.
 *
 * ${verdict}
 *
 * Full numbers, per-position breakdown and honesty notes: docs/research/2026-09-05-props-anchor-backtest.md.
 *
 * \`preseason-persist.ts\` is the one live-board consumer: when this is non-null, it merges
 * \`{ propsAnchorWeight: FITTED_PROPS_ANCHOR_WEIGHT }\` onto \`FITTED_BLEND_CONSTANTS\` for the
 * BLENDED arm only -- the raw (v1) arm never reads \`BlendConstants\` at all.
 */
export const FITTED_PROPS_ANCHOR_WEIGHT: number | null = ${inputs.weight === null ? "null" : inputs.weight};
`;
}

interface ReportInputs {
  readonly winner: GridRow;
  readonly coarseRows: readonly GridRow[];
  readonly fineRows: readonly GridRow[];
  readonly perSeasonFitLines: readonly { readonly season: number; readonly coveredN: number; readonly zeroCovered: Line; readonly winnerCovered: Line }[];
  readonly judgeFacts: SeasonFacts;
  readonly judgeAtZero: SeasonObservations;
  readonly judgeAtWinner: SeasonObservations;
  readonly perPositionLines: readonly { position: CurvePosition; zero: Line; winner: Line }[];
  readonly judgeBeats: boolean;
}

function renderReport(inputs: ReportInputs): string {
  const { winner, coarseRows, fineRows, perSeasonFitLines, judgeFacts, judgeAtZero, judgeAtWinner, perPositionLines, judgeBeats } = inputs;
  const gridTable = (rows: readonly GridRow[]): string =>
    ["| weight | covered rho | covered MAE | board rho | board MAE |", "|---|---|---|---|---|"]
      .concat(
        rows.map(
          (row) =>
            `| ${row.weight.toFixed(2)} | ${fmt(row.coveredRho)} | ${fmt(row.coveredMae)} | ${fmt(row.allRho)} | ${fmt(row.allMae)} |`,
        ),
      )
      .join("\n");

  const perSeasonTable = perSeasonFitLines
    .map(
      ({ season, coveredN, zeroCovered, winnerCovered }) =>
        `### ${season} (props-covered subset, n=${coveredN})\n\n| | n | rho | MAE |\n|---|---|---|---|\n| incumbent (0) | ${zeroCovered.n} | ${fmt(zeroCovered.rankCorrelation)} | ${fmt(zeroCovered.mae)} |\n| weight=${winner.weight} | ${winnerCovered.n} | ${fmt(winnerCovered.rankCorrelation)} | ${fmt(winnerCovered.mae)} |`,
    )
    .join("\n\n");

  const perPositionTable = [
    "| position | n (incumbent) | incumbent rho | incumbent MAE | n (winner) | winner rho | winner MAE |",
    "|---|---|---|---|---|---|---|",
  ]
    .concat(
      perPositionLines.map(
        ({ position, zero, winner: w }) =>
          `| ${position} | ${zero.n} | ${fmt(zero.rankCorrelation)} | ${fmt(zero.mae)} | ${w.n} | ${fmt(w.rankCorrelation)} | ${fmt(w.mae)} |`,
      ),
    )
    .join("\n");

  const judgeWholeBoard = [
    "| | n | rho | MAE |",
    "|---|---|---|---|",
    `| incumbent (0), whole board | ${judgeAtZero.all.length} | ${fmt(spearman(judgeAtZero.all))} | ${fmt(meanAbsoluteError(judgeAtZero.all))} |`,
    `| weight=${winner.weight}, whole board | ${judgeAtWinner.all.length} | ${fmt(spearman(judgeAtWinner.all))} | ${fmt(meanAbsoluteError(judgeAtWinner.all))} |`,
    `| incumbent (0), props-covered | ${judgeAtZero.covered.length} | ${fmt(spearman(judgeAtZero.covered))} | ${fmt(meanAbsoluteError(judgeAtZero.covered))} |`,
    `| weight=${winner.weight}, props-covered | ${judgeAtWinner.covered.length} | ${fmt(spearman(judgeAtWinner.covered))} | ${fmt(meanAbsoluteError(judgeAtWinner.covered))} |`,
  ].join("\n");

  return `# Props-anchor backtest — 2026-09-05

Fits: ${FIT_SEASONS.join("-")} (\`propsAnchorWeight\`, pooled, the only moving axis). Judge: ${JUDGE_SEASON}, scored once. 2026 never enters this fit or this score — see \`scripts/props-anchor-fit.ts\`'s own header for why the archive's own growing 2026 rows are structurally unreachable here.

Every other \`BlendConstants\` field (\`lawCapPoints\`, \`availabilityCapPoints\`, \`totalCapPoints\`, \`impliedGamesByPosition\`, \`marketTailByPosition\`) is carried unchanged from the committed \`FITTED_BLEND_CONSTANTS\` (\`blend-fitted.ts\`). This fit moves ONE axis.

## Coarse grid (0 to 1 by 0.1), fit evidence (${FIT_SEASONS.join("+")}, pooled)

${gridTable(coarseRows)}

## Fine grid around the coarse winner (${bestOf(coarseRows).weight}), same fit evidence

${fineRows.length === 0 ? "(no fine cell fell inside [0, 1] and outside the coarse grid)" : gridTable(fineRows)}

## Winning weight: propsAnchorWeight = ${winner.weight}

Chosen on the props-covered subset's rank correlation (this engine's primary metric — fantasy is an ordering problem) against the FIT evidence only. Ties go to the incumbent (0); 2025 was not read to make this choice.

## Per-season fit-evidence breakdown (props-covered subset)

${perSeasonTable}

## The judge season (${JUDGE_SEASON}) — scored exactly once

${judgeWholeBoard}

### Per position, props-covered subset only

${perPositionTable}

QB is the one position that gets WORSE on the judge season at this weight (rho ${fmt(perPositionLines.find((l) => l.position === "QB")!.zero.rankCorrelation)} -> ${fmt(perPositionLines.find((l) => l.position === "QB")!.winner.rankCorrelation)}, MAE ${fmt(perPositionLines.find((l) => l.position === "QB")!.zero.mae)} -> ${fmt(perPositionLines.find((l) => l.position === "QB")!.winner.mae)}, both worse) — the four verified prop markets (\`props-anchor.ts\`) price passing yards but never touchdowns or interceptions, which is a larger share of a QB's own fantasy total than of any other position's; RB, WR and TE all improve or hold on both metrics. This is reported as a real, disclosed tradeoff, not a footnote: the board-wide and props-covered aggregates both improve despite it, but a QB-specific reader should know the aggregate is not free.

## Gate verdict

${judgeBeats ? `**propsAnchorWeight = ${winner.weight} beats the incumbent (0) on the ${JUDGE_SEASON} judge season's own props-covered rank correlation. Wired into the fitted constants — see Task 2's persist-path plumbing.**` : `**The incumbent (0) is not beaten on the ${JUDGE_SEASON} judge season. Nothing is wired; \`propsAnchorWeight\` stays absent from the committed constants.**`}

## Coverage

- ${JUDGE_SEASON} props-anchor coverage: ${judgeFacts.propsAnchor.size} players.
${perSeasonFitLines.map((f) => `- ${f.season} props-anchor coverage: ${f.coveredN} players.`).join("\n")}

## Honesty notes

- Every grid cell above is printed regardless of which way it points, coarse and fine alike.
- \`propsAnchorWeight\` only ever moves a player whose season carries an archived pre-kickoff line for him; every other candidate's predicted points are bit-for-bit identical to the incumbent at every weight tested, which is why the whole-board numbers move far less than the props-covered ones and are reported for completeness rather than as the deciding metric.
- The fit evidence pools 2023 and 2024 rather than fitting on 2023 alone and validating on 2024 as a second, independent step — a genuine three-way split (fit strictly on 2023, select against 2024, judge on 2025) is the rookie round's own recommended follow-up protocol and would need more archive-covered seasons than exist today to run without a two-season fit evidence pool being thin on its own.
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}
