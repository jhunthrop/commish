// THE PER-FORMAT HELD-OUT SCORECARD (the scoring-formats round, 2026-09-08). For each scoring
// format, builds the market-blended board for the two held-out outcome seasons (2023 and 2024,
// replay moments) exactly as `preseason-persist.ts` builds it for that format, scores it against
// what every player actually scored UNDER THAT FORMAT'S RULES, and bootstraps the rank-correlation
// difference against that format's OWN ADP feed, per Ruling P3 ("beyond noise" is the bootstrap
// 95% interval on the difference excluding zero, `rank-correlation-bootstrap.ts`).
// Run: npm run projections:formats:scorecard [season ...]   (defaults to 2023 and 2024)
//
// THE BAR IS THE MARKET-EDGE CLOSEOUT'S OWN (`docs/research/2026-08-31-market-edge-closeout.md`,
// section 1): beat ADP on rank correlation on the decisive season, 2024 (predicted from 2023,
// which the model never fit on). 2023 is reported with the same in-fit caveat that document
// carries. The PPR arm printed here is the same board `market-edge-scorecard.ts` scores, run
// through the same machinery (`preseason/scorecard.ts`), so the three formats' numbers mean the
// same thing and PPR's is a check against the published verdict rather than a new claim.
//
// WHAT IS NOT FORMAT-CLEAN, NAMED RATHER THAN HIDDEN: the blend's caps and implied games
// (`blend-fitted.ts`) were fit in PPR points and are reused for every format; the law registry's
// train effects are PPR per-game deltas; the rookie curve is PPR, rescaled per candidate by his own
// stat mix (`market/blend.ts`'s `formatRatioOf`). Each format's ADP feed, fitted curve, raw arm
// scoring and unlisted tail ARE its own (`market/format-anchor.ts`). The half-PPR curve pools four
// train seasons (2018-2021) where PPR and standard pool nine.
import { createDb, type ReadonlyDb } from "@/db/client";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { allPositions } from "@/projections/backtest";
import { RANK_BANDS, type ScoreCard } from "@/projections/metrics";
import type { LeagueShape } from "@/projections/decide/replacement";
import { shippedPreseasonCandidates } from "@/projections/market/blend";
import { FITTED_MODEL } from "@/projections/model/source";
import { preseasonBoard } from "@/projections/preseason/board";
import { BOARD_FORMAT_SPECS, BOARD_FORMATS, type BoardFormat } from "@/projections/preseason/board-formats";
import { FITTED_AVAILABILITY_PRIORS, FITTED_CAREER_PRIORS, FITTED_DEPTH_PRIORS, FITTED_ROOKIE_PRIORS } from "@/projections/preseason/fitted";
import { actualSeasonPoints, boardPoints, gradableInputs, scoreOrdering } from "@/projections/preseason/scorecard";
import { loadPreseason, type PreseasonInputs, type PreseasonPriors } from "@/projections/preseason/source";
import { preseasonRankingsAsOf } from "@/projections/preseason/store";
import { bootstrapRankCorrelationDifference, type RankCorrelationDifferenceRow } from "@/projections/rank-correlation-bootstrap";

const SEASONS = process.argv.slice(2).map(Number).filter(Number.isFinite);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : [2023, 2024];
/** Predicted from 2023, a season `FIT_SEASONS` never included (the closeout's own ruling). */
const DECISIVE_SEASON = 2024;
/** Far past any correction: outcomes and benchmarks alike are scored against, never fed in. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");
/** The identical seed and resample count `market-edge-scorecard.ts` uses, so a PPR number here is
 *  comparable to the published one. */
const BOOTSTRAP_RESAMPLES = 1000;
const BOOTSTRAP_SEED = 20260901;

const SCORED: readonly Position[] = ["QB", "RB", "WR", "TE"];
const SLOTS: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter(
  (slot) => slot.slot === BENCH_SLOT || slot.eligiblePositions.every((position) => SCORED.includes(position)),
).map((slot) => ({ ...slot, eligiblePositions: slot.eligiblePositions.filter((position) => SCORED.includes(position)) }));
const SHAPE: LeagueShape = { teamCount: 12, rosterSlots: SLOTS };

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
    throw new Error(`${name} is not set. Run this through \`npm run projections:formats:scorecard\`, which loads .env.local.`);
  }
  return value;
}

function rho(score: ScoreCard): string {
  return score.rankCorrelation === null ? "   n/a" : score.rankCorrelation.toFixed(4).padStart(7);
}

function fmtDiff(value: number | null): string {
  return value === null ? "   n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function fmtCi(ci: readonly [number, number] | null): string {
  if (ci === null) return "n/a";
  return `[${ci[0] >= 0 ? "+" : ""}${ci[0].toFixed(4)}, ${ci[1] >= 0 ? "+" : ""}${ci[1].toFixed(4)}]`;
}

/** The subset of `ids` in one `RANK_BANDS` band by the format's own ADP, mirroring
 *  `scoreOrdering`'s own band assignment so the table and the bootstrap agree. */
function bandMembers(ids: ReadonlySet<string>, bandBy: ReadonlyMap<string, number>, band: { readonly from: number; readonly to: number }): ReadonlySet<string> {
  const ordered = [...ids].sort((a, b) => (bandBy.get(a) ?? Infinity) - (bandBy.get(b) ?? Infinity) || a.localeCompare(b));
  return new Set(ordered.slice(band.from - 1, band.to));
}

interface FormatArm {
  readonly format: BoardFormat;
  readonly boardSize: number;
  readonly adpRows: number;
  readonly predicted: ReadonlyMap<string, number>;
  readonly adpRankOf: ReadonlyMap<string, number>;
  readonly actual: ReadonlyMap<string, number>;
}

/** One format's blended board for one season, its own ADP and its own actuals. */
async function buildArm(db: ReadonlyDb, inputs: PreseasonInputs, positions: ReadonlyMap<string, Position>, format: BoardFormat): Promise<FormatArm> {
  const spec = BOARD_FORMAT_SPECS[format];
  const candidates = await shippedPreseasonCandidates(db, inputs, PRIORS, { format });
  const board = preseasonBoard(candidates, { season: inputs.season, asOf: inputs.moment, rules: spec.rules, shape: SHAPE });
  const adpRows = await preseasonRankingsAsOf(db, { season: inputs.season, source: spec.adpSource, asOf: FINAL });
  return {
    format,
    boardSize: board.length,
    adpRows: adpRows.length,
    predicted: boardPoints(board),
    adpRankOf: new Map(adpRows.map((row) => [row.playerId, row.rank] as const)),
    actual: await actualSeasonPoints(db, inputs.season, positions, spec.rules),
  };
}

function reportArm(arm: FormatArm, scoredPositions: ReadonlySet<string>): void {
  const common = new Set([...scoredPositions].filter((id) => arm.actual.has(id) && arm.adpRankOf.has(id) && arm.predicted.has(id)));
  const adpValueOf = new Map([...arm.adpRankOf].map(([playerId, rank]) => [playerId, -rank] as const));
  const blend = scoreOrdering(arm.predicted, arm.actual, common, arm.adpRankOf);
  const adp = scoreOrdering(adpValueOf, arm.actual, common, arm.adpRankOf);
  console.log(`\n  ${BOARD_FORMAT_SPECS[arm.format].label.toUpperCase().padEnd(9)} board ${arm.boardSize} rows, ADP ${arm.adpRows} rows, scored n=${common.size}`);
  for (const [name, scored] of [
    ["blend", blend],
    ["ADP", adp],
  ] as const) {
    console.log(
      `    ${name.padEnd(6)} overall ${rho(scored.overall)}   ` +
        RANK_BANDS.map((band) => `${band.name} ${rho(scored.byBand[band.name])} n=${scored.byBand[band.name].sampleSize}`).join("  "),
    );
  }
  const rowsFor = (ids: ReadonlySet<string>): readonly RankCorrelationDifferenceRow[] =>
    [...ids].map((id) => ({ primary: arm.predicted.get(id)!, baseline: adpValueOf.get(id)!, actual: arm.actual.get(id)! }));
  const overall = bootstrapRankCorrelationDifference(rowsFor(common), { seed: BOOTSTRAP_SEED, resamples: BOOTSTRAP_RESAMPLES });
  console.log(`    blend vs ADP  overall ${fmtDiff(overall.difference)} ${fmtCi(overall.ci)} ${overall.beyondNoise ? "BEYOND NOISE" : "within noise"}`);
  for (const band of RANK_BANDS) {
    const inBand = bandMembers(common, arm.adpRankOf, band);
    const result = bootstrapRankCorrelationDifference(rowsFor(inBand), { seed: BOOTSTRAP_SEED, resamples: BOOTSTRAP_RESAMPLES });
    const lost = result.beyondNoise === true && result.difference !== null && result.difference < 0;
    console.log(
      `      ${band.name.padEnd(8)} ${fmtDiff(result.difference)} ${fmtCi(result.ci)} ${result.beyondNoise ? (lost ? "LOST BEYOND NOISE" : "WON BEYOND NOISE") : "within noise"} n=${inBand.size}`,
    );
  }
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const positions = await allPositions(db);

  for (const season of TARGET_SEASONS) {
    const inputs = gradableInputs(await loadPreseason(db, season));
    console.log(`\n${"=".repeat(100)}`);
    console.log(`${season} SCORING-FORMAT SCORECARD${season === DECISIVE_SEASON ? " (DECISIVE: predictor 2023, out-of-fit)" : " (predictor 2022, IN-FIT caveat)"}  board taken at ${inputs.moment.toISOString()}`);
    console.log(`${"=".repeat(100)}`);
    const scoredPositions = new Set([...positions].filter(([, position]) => SCORED.includes(position)).map(([id]) => id));
    for (const format of BOARD_FORMATS) {
      reportArm(await buildArm(db, inputs, positions, format), scoredPositions);
    }
  }

  await db.$client.end();
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
