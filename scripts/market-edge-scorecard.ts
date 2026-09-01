// THE FINAL SCORECARD — Task 11 of the market-edge round. Scores the shipped blended board, the
// law-ablated blend, and the raw model against the market (ADP), consensus (ECR) and the naive
// floor, on the two outcome seasons no fitted constant in this whole round has ever touched: 2023
// and 2024. Reuses `preseason-report.ts`'s own scorecard machinery (`preseason/scorecard.ts`,
// extracted for exactly this reuse) so a number printed here means the same thing it means there.
// Run: npm run projections:market-edge:scorecard
// (dotenv -e .env.local -- tsx scripts/market-edge-scorecard.ts)
//
// THE DECISIVE SEASON RULING (progress.md, Task 3's fix round): `FIT_SEASONS` for the projection
// model is [2021, 2022], so a predictor-2023 fold is genuinely out-of-fit while a predictor-2022
// fold is not. Applied to THIS scorecard's own seasons: outcome 2024 (predicted from the 2023
// season, a season the model never fit on) is the decisive bar season. Outcome 2023 is reported
// alongside with an in-fit caveat, never as the deciding number on its own.
//
// THE ADP SELF-REFERENCE CAVEAT (`preseason-report.ts`'s own comment, M6/fix-round-2): every listed
// player's blended points are anchored to `BENCHMARK_SOURCES.adp` (`ffc_adp_ppr_12`) — the SAME feed
// this script's own "AGAINST ADP" column reads. A strong ADP correlation for the blend is expected
// by construction for a listed player, not independent evidence the blend adds anything. The bar
// still names ADP as what must be beaten (the plan's own spec), so this script computes it plainly
// mechanically per Ruling P3 — but the load-bearing evidence for whether the blend is WORTH ANYTHING
// is blend-vs-raw (does departing from a pure model help), blend-vs-ECR (an independent feed),
// blend-vs-naive (the dumbest defensible floor), and blend-vs-law-ablated (how much of any lift is
// law evidence specifically, versus the availability-gap channel `blend-fitted.ts`'s own train-time
// decomposition already named as doing nearly all of the work).
//
// THE C1 RESIDUAL, restated for this document (blend.ts's own `scoreBlendConstants` docblock,
// clause C1(iii)): no stat line, ADP row, or outcome from 2023/2024 ever reaches the FIT of the
// blend's own constants or a confirmed law's `trainEffect` value used inside it. What is NOT
// train-clean is LAW SELECTION: whether a `"law"` reason exists on a candidate at all depends on
// `registry()`'s own verdict, which requires fold agreement across `REPLICATION_FOLDS` (2021, 2022,
// 2023) — so 2023's own outcomes help decide WHICH laws are confirmed, never how much a confirmed
// one moves a player. `blend-fitted.ts` bounds this at a single confirmed law's own `lawCapPoints`
// (2 points/player, capped), the same bound every other consumer of `registry()`'s confirmed laws
// already carries.
//
// "BEYOND NOISE" (Ruling P3): a band's bootstrap 95% interval on the rank-correlation DIFFERENCE
// between two arms, seeded and deterministic (`rank-correlation-bootstrap.ts`). A band only counts
// as lost to a benchmark when that interval excludes zero in the benchmark's favour — a negative
// point-estimate difference whose interval still spans zero is noise, not a loss, and is reported as
// such rather than rounded into a verdict the sample cannot support.
import { createDb, type ReadonlyDb } from "@/db/client";
import type { Position } from "@/domain/player";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { PPR_SCORING } from "@/domain/scoring";
import { computeFantasyPoints } from "@/scoring/compute";
import { allPositions } from "@/projections/backtest";
import { naiveProjection } from "@/projections/benchmarks/naive";
import { statLinesAsOf } from "@/projections/lines";
import { RANK_BANDS, type ScoreCard } from "@/projections/metrics";
import type { LeagueShape } from "@/projections/decide/replacement";
import { shippedPreseasonCandidates, withLawsAblated } from "@/projections/market/blend";
import { FITTED_BLEND_CONSTANTS } from "@/projections/market/blend-fitted";
import { FITTED_MODEL } from "@/projections/model/source";
import { BENCHMARK_SOURCES } from "@/projections/preseason/benchmarks";
import { preseasonBoard, type BoardEntry } from "@/projections/preseason/board";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@/projections/preseason/fitted";
import { actualSeasonPoints, boardPoints, gradableInputs, scoreOrdering } from "@/projections/preseason/scorecard";
import { loadPreseason, type PreseasonPriors } from "@/projections/preseason/source";
import { preseasonRankingsAsOf } from "@/projections/preseason/store";
import { bootstrapRankCorrelationDifference, type RankCorrelationDifferenceRow } from "@/projections/rank-correlation-bootstrap";

const SEASONS = process.argv.slice(2).map(Number).filter(Number.isFinite);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : [2023, 2024];
/** Predicted from 2023, a season `FIT_SEASONS` never included — see the header. */
const DECISIVE_SEASON = 2024;
const LAST_REGULAR_WEEK = 18;
/** Far past any correction: outcomes and benchmarks alike are scored against, never fed in. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");
/** Matches `scripts/decision-report.ts`'s own naive-benchmark convention exactly: the naive floor
 *  projects a rate (points per game), so scoring it against a season total needs one shared
 *  per-game-to-season multiplier, applied identically to every player it projects. */
const GAMES_IN_A_SEASON = 17;
/** Matches `laws/harness.ts`'s own `BOOTSTRAP.resamples`; a different constant on purpose, since this
 *  bootstrap resamples players for a rank-correlation difference, not matched pairs for an effect. */
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

/** The comparisons this scorecard bootstraps a CI for, per position per band. `primary` is always
 *  the shipped blend except the last row, which isolates the availability channel alone. */
const COMPARISONS: readonly { readonly primary: string; readonly baseline: string }[] = [
  { primary: "blend", baseline: "ADP" },
  { primary: "blend", baseline: "raw" },
  { primary: "blend", baseline: "ECR" },
  { primary: "blend", baseline: "naive" },
  { primary: "blend", baseline: "law-ablated" },
  { primary: "law-ablated", baseline: "ADP" },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:market-edge:scorecard\`, which loads .env.local.`);
  }
  return value;
}

function rho(score: ScoreCard): string {
  return score.rankCorrelation === null ? "   n/a" : score.rankCorrelation.toFixed(4).padStart(7);
}

async function buildBoard(
  db: ReadonlyDb,
  inputs: Awaited<ReturnType<typeof loadPreseason>>,
  options: Parameters<typeof shippedPreseasonCandidates>[3],
): Promise<readonly BoardEntry[]> {
  const candidates = await shippedPreseasonCandidates(db, inputs, PRIORS, options);
  return preseasonBoard(candidates, { season: inputs.season, asOf: inputs.moment, rules: PPR_SCORING, shape: SHAPE });
}

/** THE NAIVE FLOOR, composed to a season total the same way `decision-report.ts` already does:
 *  last season's per-game rate, times one shared full-season multiplier. Every rookie is invisible
 *  to this benchmark by construction (`naiveProjection`'s own docblock) — that is its honest and
 *  total blind spot, not a bug in this script. */
async function naiveSeasonPoints(
  db: ReadonlyDb,
  season: number,
  positions: ReadonlyMap<string, Position>,
): Promise<ReadonlyMap<string, number>> {
  const history = await statLinesAsOf(db, { season: season - 1, week: { from: 1, to: LAST_REGULAR_WEEK }, asOf: FINAL });
  const lines = naiveProjection(history, { season, week: 1 });
  const totals = new Map<string, number>();
  for (const line of lines) {
    const position = positions.get(line.playerId);
    if (position === undefined) continue;
    totals.set(line.playerId, computeFantasyPoints(line, position, PPR_SCORING) * GAMES_IN_A_SEASON);
  }
  return totals;
}

/** The subset of `ids`, ordered by `bandBy` ascending (lower is better, matching a published
 *  rank), that falls in one `RANK_BANDS` band. Mirrors `scoreOrdering`'s own internal band
 *  assignment exactly, so a bootstrap population and the printed table's own bands agree. */
function bandMembers(
  ids: ReadonlySet<string>,
  bandBy: ReadonlyMap<string, number>,
  band: { readonly from: number; readonly to: number },
): ReadonlySet<string> {
  const ordered = [...ids].sort(
    (a, b) => (bandBy.get(a) ?? Infinity) - (bandBy.get(b) ?? Infinity) || a.localeCompare(b),
  );
  return new Set(ordered.slice(band.from - 1, band.to));
}

function fmtDiff(value: number | null): string {
  if (value === null) return "   n/a";
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function fmtCi(ci: readonly [number, number] | null): string {
  if (ci === null) return "n/a";
  return `[${ci[0] >= 0 ? "+" : ""}${ci[0].toFixed(4)}, ${ci[1] >= 0 ? "+" : ""}${ci[1].toFixed(4)}]`;
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const positions = await allPositions(db);

  for (const season of TARGET_SEASONS) {
    // Task 2 / fix round I3: `gradableInputs` is the convergence point all four grading scripts now
    // call through, immediately after `loadPreseason` and before anything reads `inputs` for
    // grading. `loadPreseason(db, season)` never passes an explicit `BoardMoment`, so this always
    // resolves to the replay arm today; the guard is defence in depth for the day a live moment
    // reaches this call site.
    const inputs = gradableInputs(await loadPreseason(db, season));
    const actual = await actualSeasonPoints(db, season, positions);

    const rawBoard = await buildBoard(db, inputs, { raw: true });
    const blendBoardEntries = await buildBoard(db, inputs, {});
    const ablatedBoard = await buildBoard(db, inputs, { constants: withLawsAblated(FITTED_BLEND_CONSTANTS) });

    const adpRows = await preseasonRankingsAsOf(db, { season, source: BENCHMARK_SOURCES.adp, asOf: FINAL });
    const ecrRows = await preseasonRankingsAsOf(db, { season, source: BENCHMARK_SOURCES.ecr, asOf: FINAL });
    const adpRankOf = new Map(adpRows.map((row) => [row.playerId, row.rank] as const));
    const ecrRankOf = new Map(ecrRows.map((row) => [row.playerId, row.rank] as const));
    const adpValueOf = new Map([...adpRankOf].map(([playerId, rank]) => [playerId, -rank] as const));
    const ecrValueOf = new Map([...ecrRankOf].map(([playerId, rank]) => [playerId, -rank] as const));
    const naiveValueOf = await naiveSeasonPoints(db, season, positions);

    console.log(`\n${"=".repeat(100)}`);
    console.log(
      `${season} MARKET-EDGE SCORECARD${season === DECISIVE_SEASON ? " (DECISIVE: predictor 2023, out-of-fit)" : " (predictor 2022, IN-FIT caveat -- FIT_SEASONS includes 2022)"}`,
    );
    console.log(`${"=".repeat(100)}`);
    console.log(
      `boards: raw ${rawBoard.length}  blend ${blendBoardEntries.length}  law-ablated ${ablatedBoard.length}  ` +
        `ADP rows ${adpRows.length}  ECR rows ${ecrRows.length}`,
    );

    const arms: readonly { readonly name: string; readonly predicted: ReadonlyMap<string, number> }[] = [
      { name: "blend", predicted: boardPoints(blendBoardEntries) },
      { name: "law-ablated", predicted: boardPoints(ablatedBoard) },
      { name: "raw", predicted: boardPoints(rawBoard) },
      { name: "ADP", predicted: adpValueOf },
      { name: "ECR", predicted: ecrValueOf },
      { name: "naive", predicted: naiveValueOf },
    ];
    const armByName = new Map(arms.map((arm) => [arm.name, arm.predicted] as const));

    /** Prints the scorecard table plus the bootstrapped comparisons for one population, banded by
     *  `adpRankOf`. Shared by the POOLED (all four positions, the primary bar reading) and the
     *  PER-POSITION breakdowns below so both read off one implementation. */
    function reportPopulation(label: string, common: ReadonlySet<string>): void {
      console.log(`\n${label}  (n=${common.size})`);
      for (const arm of arms) {
        const scored = scoreOrdering(arm.predicted, actual, common, adpRankOf);
        console.log(
          `  ${arm.name.padEnd(13)} overall ${rho(scored.overall)} n=${String(scored.overall.sampleSize).padStart(4)}   ` +
            RANK_BANDS.map((band) => `${band.name} ${rho(scored.byBand[band.name])} n=${scored.byBand[band.name].sampleSize}`).join(
              "  ",
            ),
        );
      }

      console.log(`  BOOTSTRAP (seed ${BOOTSTRAP_SEED}, ${BOOTSTRAP_RESAMPLES} resamples), rank-correlation difference, primary minus baseline:`);
      for (const { primary, baseline } of COMPARISONS) {
        const primaryMap = armByName.get(primary)!;
        const baselineMap = armByName.get(baseline)!;
        const pairPop = new Set([...common].filter((id) => primaryMap.has(id) && baselineMap.has(id) && actual.has(id)));

        const rowsFor = (ids: ReadonlySet<string>): readonly RankCorrelationDifferenceRow[] =>
          [...ids].map((id) => ({ primary: primaryMap.get(id)!, baseline: baselineMap.get(id)!, actual: actual.get(id)! }));

        const overall = bootstrapRankCorrelationDifference(rowsFor(pairPop), { seed: BOOTSTRAP_SEED, resamples: BOOTSTRAP_RESAMPLES });
        console.log(
          `    ${primary} vs ${baseline}`.padEnd(24) +
            `overall ${fmtDiff(overall.difference)} ${fmtCi(overall.ci)} ${overall.beyondNoise ? "BEYOND NOISE" : "within noise"} n=${pairPop.size}`,
        );
        for (const band of RANK_BANDS) {
          const inBand = bandMembers(pairPop, adpRankOf, band);
          const result = bootstrapRankCorrelationDifference(rowsFor(inBand), { seed: BOOTSTRAP_SEED, resamples: BOOTSTRAP_RESAMPLES });
          const lostBeyondNoise = result.beyondNoise === true && result.difference !== null && result.difference < 0;
          console.log(
            `      ${band.name.padEnd(8)} ${fmtDiff(result.difference)} ${fmtCi(result.ci)} ` +
              `${result.beyondNoise ? (lostBeyondNoise ? "LOST BEYOND NOISE" : "WON BEYOND NOISE") : "within noise"} n=${inBand.size}`,
          );
        }
      }
    }

    // THE BAR'S OWN POPULATION: all four scored positions pooled, exactly the way
    // `preseason-report.ts`'s existing "AGAINST MARKET (ADP)" section already reads it (RANK_BANDS
    // was built for a five-hundred-plus-player pool; a single position's own ADP coverage runs
    // 20-70 deep and starves the deeper bands, printed and visible below as a real, honestly
    // reported finding rather than smoothed over).
    const everyoneAtScoredPositions = new Set(rawBoard.filter((entry) => SCORED.includes(entry.position)).map((entry) => entry.playerId));
    const pooledCommon = new Set([...everyoneAtScoredPositions].filter((id) => actual.has(id) && adpRankOf.has(id)));
    reportPopulation("ALL FOUR POSITIONS POOLED (the bar's own population)", pooledCommon);

    for (const position of SCORED) {
      const atPosition = new Set(rawBoard.filter((entry) => entry.position === position).map((entry) => entry.playerId));
      const common = new Set([...atPosition].filter((id) => actual.has(id) && adpRankOf.has(id)));
      reportPopulation(`${position} only`, common);
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
