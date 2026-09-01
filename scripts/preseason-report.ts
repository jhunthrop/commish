// Scores the preseason board against what actually happened, against the market, and against expert
// consensus, on seasons no parameter has ever seen.
// Run: npm run projections:preseason [season ...]   (defaults to the held-out seasons)
//
// THE SCRIPT THAT DECIDES WHETHER PHASE 6 WAS WORTH DOING. Everything else in
// `src/projections/preseason/**` is an argument; this is the measurement. It reads the store only —
// no network — so an ablation is cheap to re-run, for the reason `projection-ablate.ts` gives: an
// ablation that is expensive to run is an ablation that gets skipped.
//
// Every board it builds is taken at the preseason moment, which `loadPreseason` derives as one
// millisecond before the earliest stamp the season carries and then asserts against the store. A
// board that could see the season it is predicting throws rather than scoring well.
import { createDb, type ReadonlyDb } from "@/db/client";
import { PPR_SCORING } from "@/domain/scoring";
import { BENCH_SLOT, STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import type { Position } from "@/domain/player";
import { allPositions } from "@/projections/backtest";
import { nflPlayers } from "@/db/schema";
import { FITTED_MODEL } from "@/projections/model/source";
import { RANK_BANDS, type ScoreCard } from "@/projections/metrics";
import type { LeagueShape } from "@/projections/decide/replacement";
import { shippedPreseasonCandidates } from "@/projections/market/blend";
import { BENCHMARK_SOURCES } from "@/projections/preseason/benchmarks";
import { overlapTiers, preseasonBoard, type BoardEntry } from "@/projections/preseason/board";
import {
  FITTED_AVAILABILITY_PRIORS,
  FITTED_CAREER_PRIORS,
  FITTED_DEPTH_PRIORS,
  FITTED_ROOKIE_PRIORS,
} from "@/projections/preseason/fitted";
import { actualSeasonPoints, boardPoints, boardValues, gradableInputs, scoreOrdering } from "@/projections/preseason/scorecard";
import {
  SHIPPED_PRESEASON_FEATURES,
  loadPreseason,
  offseasonSegmentFor,
  preseasonCandidates,
  rookieSegmentFor,
  type PreseasonFeatures,
  type PreseasonInputs,
  type PreseasonPriors,
} from "@/projections/preseason/source";
import { UNDRAFTED_PICK } from "@/projections/preseason/rookies";
import { preseasonRankingsAsOf } from "@/projections/preseason/store";

const SEASONS = process.argv.slice(2).map(Number);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : [2023, 2024];

/** Far past any correction: outcomes and benchmarks alike are scored against, never fed in. */
const FINAL = new Date("9999-12-31T00:00:00.000Z");

/**
 * The league the board is computed for: twelve teams, PPR, no kickers and no defences.
 *
 * Identical to `decision-report.ts`' shape on purpose, so a board measured here drops straight into
 * that harness and the two documents are talking about the same league. Kickers and defences are
 * excluded because Phase 2 projects neither and their slots would be guaranteed blanks.
 */
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

/**
 * Each ablation: the shipped board with ONE thing changed, and the segment it is judged on.
 *
 * `features` is the arm the shipped board is compared AGAINST, so the printed line always reads
 * "what we would have had -> what we ship". For the two rookie-ordering flags that means the arm is
 * the setting we rejected, which is the honest way round: the claim being tested is that turning
 * the landing term off and the pick curve on made the class order better.
 */
const ABLATIONS: readonly { readonly name: string; readonly features: PreseasonFeatures; readonly segment: string }[] = [
  { name: "availability", features: { ...SHIPPED_PRESEASON_FEATURES, availability: false }, segment: "everyone" },
  { name: "offseason", features: { ...SHIPPED_PRESEASON_FEATURES, offseason: false }, segment: "changed situation" },
  { name: "rookies", features: { ...SHIPPED_PRESEASON_FEATURES, rookies: false }, segment: "rookies" },
  { name: "rookie landing", features: { ...SHIPPED_PRESEASON_FEATURES, rookieLanding: true }, segment: "rookies" },
  { name: "rookie pick curve", features: { ...SHIPPED_PRESEASON_FEATURES, rookiePickCurve: false }, segment: "rookies" },
  { name: "depth chart", features: { ...SHIPPED_PRESEASON_FEATURES, depthChart: false }, segment: "everyone" },
  { name: "career stage", features: { ...SHIPPED_PRESEASON_FEATURES, careerStage: false }, segment: "everyone" },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run projections:preseason\`, which loads .env.local.`);
  }
  return value;
}

function rho(score: ScoreCard): string {
  return score.rankCorrelation === null ? "   n/a" : score.rankCorrelation.toFixed(4).padStart(7);
}

function delta(before: ScoreCard, after: ScoreCard): string {
  if (before.rankCorrelation === null || after.rankCorrelation === null) return "   n/a";
  const difference = after.rankCorrelation - before.rankCorrelation;
  return `${difference >= 0 ? "+" : ""}${difference.toFixed(4)}`;
}

/** The rookie class ordered by draft capital and nothing else. The `before` arm Task 3 has to beat. */
function draftCapitalOnly(inputs: PreseasonInputs, eligible: ReadonlySet<string>): ReadonlyMap<string, number> {
  return new Map(
    inputs.roster
      .filter((row) => eligible.has(row.playerId))
      // An undrafted man sits behind the last pick of the draft, which is what a team saying nothing
      // about him means. The constant is `rookies.ts`' own, so the counterfactual and the capital
      // curve it is scored against can never disagree about where undrafted sits. Negated so higher
      // is better, as every other column in this report is.
      .map((row) => [row.playerId, -(row.draftPick ?? UNDRAFTED_PICK)] as const),
  );
}

/** THE RAW MODEL BOARD — never blended. Every ablation below toggles a MODEL feature, and an
 *  ablation compared against a market-blended "after" arm would be measuring two changes (the
 *  feature AND the blend) at once; ablations stay on this function's own output, "before" and
 *  "after" alike, so what moved is always the one flag being tested. */
function build(inputs: PreseasonInputs, features: PreseasonFeatures): readonly BoardEntry[] {
  return preseasonBoard(preseasonCandidates(inputs, features, PRIORS), {
    season: inputs.season,
    asOf: inputs.moment,
    rules: PPR_SCORING,
    shape: SHAPE,
  });
}

/**
 * THE SHIPPED BOARD (M6 fix round, 2026-08-31) — market-blended, via `shippedPreseasonCandidates`'s
 * own default. This is what a reader of this script's headline numbers (the top 20, the scorecard
 * against the outcome, the comparison against the published market/consensus benchmarks) should be
 * shown: the board this engine actually ships, not an intermediate the market blend never touched.
 * The raw model stays reachable, unchanged, as `build`'s own output — every ablation below reads
 * that, never this.
 */
async function buildShipped(db: ReadonlyDb, inputs: PreseasonInputs): Promise<readonly BoardEntry[]> {
  const candidates = await shippedPreseasonCandidates(db, inputs, PRIORS);
  return preseasonBoard(candidates, { season: inputs.season, asOf: inputs.moment, rules: PPR_SCORING, shape: SHAPE });
}

function printBands(label: string, banded: ReturnType<typeof scoreOrdering>): void {
  console.log(`  ${label.padEnd(24)} overall ${rho(banded.overall)} n=${String(banded.overall.sampleSize).padStart(4)}   ` +
    RANK_BANDS.map((band) => `${band.name} ${rho(banded.byBand[band.name])}`).join("  "));
}

async function main(): Promise<void> {
  const db = createDb(requireEnv("DATABASE_URL"));
  const positions = await allPositions(db);
  const names = new Map(
    (await db.select({ id: nflPlayers.id, name: nflPlayers.name }).from(nflPlayers)).map((row) => [row.id, row.name] as const),
  );

  for (const season of TARGET_SEASONS) {
    // Fix round I3: `gradableInputs` is the convergence point every grading script calls through,
    // immediately after `loadPreseason` — see its own docblock in `preseason/scorecard.ts`.
    const inputs = gradableInputs(await loadPreseason(db, season));
    const actual = await actualSeasonPoints(db, season, positions);
    const everyone = new Set(actual.keys());

    console.log(`\n${"=".repeat(96)}`);
    console.log(`${season} PRESEASON BOARD, 12-team PPR, taken at ${inputs.moment.toISOString()}`);
    console.log(`${"=".repeat(96)}\n`);

    const rawBoard = build(inputs, SHIPPED_PRESEASON_FEATURES);
    const board = await buildShipped(db, inputs);
    console.log(
      `board (shipped, market-blended): ${board.length} players from a ${inputs.roster.length}-man week-one roster, ` +
        `${inputs.usage.length} prior usage rows, ${inputs.teamObservations.length} team facts`,
    );

    console.log("\nTOP 20, the board's own order (projected points), with the draft-value rank beside it");
    for (const entry of board.slice(0, 20)) {
      const scored = actual.get(entry.playerId) ?? 0;
      console.log(
        `  ${String(entry.rank).padStart(3)} ${entry.position} ${entry.team.padEnd(3)} ${(names.get(entry.playerId) ?? entry.playerId).padEnd(22)}` +
          `proj ${entry.projectedPoints.toFixed(0).padStart(4)}  vor ${entry.valueOverReplacement.toFixed(0).padStart(4)} (#${String(entry.valueRank).padStart(3)})  ` +
          `games ${entry.expectedGames.toFixed(1).padStart(4)}  tier ${entry.tier}  actual ${scored.toFixed(0).padStart(4)}`,
      );
    }

    console.log("\nAGAINST THE OUTCOME, banded by our own rank");
    printBands("the board (points)", scoreOrdering(boardPoints(board), actual, everyone, null));
    printBands("draft-value view (VOR)", scoreOrdering(boardValues(board), actual, everyone, null));

    // The two published benchmarks, scored like for like: only players BOTH sources had an opinion
    // about, so neither is credited for breadth. Model v1 established that discipline and the same
    // reasoning applies with more force here, because a published board stops at about two hundred
    // names and ours does not.
    //
    // SELF-REFERENTIAL CAVEAT (fix round 2, review finding): `board` here is the SHIPPED,
    // MARKET-BLENDED board (M6 fix round 1) — and `BENCHMARK_SOURCES.adp` (`ffc_adp_ppr_12`) is the
    // EXACT SAME feed `market/curve.ts`'s market curve, and therefore `market/blend.ts`'s own
    // `marketPoints` anchor, is built from. For every LISTED player, "our board" below is not an
    // independent read scored against the market — it is a number anchored to that market's own
    // rank, plus a capped delta, being compared back against the market's own rank. A strong
    // "AGAINST MARKET (ADP)" correlation here is expected by construction, not evidence the blend
    // adds anything; it does NOT hold for "AGAINST CONSENSUS (ECR)" below, a genuinely independent
    // feed, or for `rawBoard`'s own numbers (never blended). Task 11's own scorecard must weight the
    // ECR comparison and the raw-vs-blend delta as the load-bearing evidence, and read the ADP
    // comparison here as a sanity check on the blend's own arithmetic rather than a result.
    for (const [label, source] of [
      ["market (ADP)", BENCHMARK_SOURCES.adp],
      ["consensus (ECR)", BENCHMARK_SOURCES.ecr],
    ] as const) {
      const published = await preseasonRankingsAsOf(db, { season, source, asOf: FINAL });
      const rankOf = new Map(published.map((row) => [row.playerId, row.rank] as const));
      const common = new Set(
        published.map((row) => row.playerId).filter((playerId) => actual.has(playerId) && boardValues(board).has(playerId)),
      );
      if (common.size === 0) {
        console.log(`\nAGAINST ${label.toUpperCase()}: no overlap; the benchmark is not ingested for ${season}.`);
        continue;
      }
      // Lower is better in both published units, so the sign is flipped to make "higher predicted"
      // mean "better" for every column in the table.
      const benchmark = new Map([...rankOf].map(([playerId, rank]) => [playerId, -rank] as const));
      console.log(`\nAGAINST ${label.toUpperCase()}, like for like on ${common.size} players, banded by the benchmark's own rank`);
      printBands(label, scoreOrdering(benchmark, actual, common, rankOf));
      printBands("our board", scoreOrdering(boardPoints(board), actual, common, rankOf));
      printBands("our draft-value view", scoreOrdering(boardValues(board), actual, common, rankOf));
    }

    console.log("\nABLATIONS, on the segment each group targets");
    const segments = new Map<string, ReadonlySet<string>>([
      ["everyone", everyone],
      ["changed situation", offseasonSegmentFor(inputs, PRIORS)],
      ["rookies", rookieSegmentFor(inputs)],
    ]);
    for (const ablation of ABLATIONS) {
      const without = build(inputs, ablation.features);
      const segment = segments.get(ablation.segment)!;
      const eligible = new Set([...segment].filter((playerId) => actual.has(playerId)));
      const before =
        ablation.name === "rookies"
          ? // Switching rookies OFF removes them from the board entirely, so there is no `before`
            // ordering of the same people to compare against. The honest counterfactual is the
            // thing a board would do instead: rank the class by draft capital alone, with no
            // landing spot, no efficiency and no composition. That is what the task has to beat.
            scoreOrdering(draftCapitalOnly(inputs, eligible), actual, eligible, null)
          : scoreOrdering(boardPoints(without), actual, eligible, null);
      // Ablated on the ORDERING THE BOARD SHIPS, which is points. Measuring an ablation on a view
      // the board does not lead with would be answering a question nobody asks. `rawBoard`, not the
      // market-blended `board` (M6 fix round) — see `build`'s own docblock for why.
      const after = scoreOrdering(boardPoints(rawBoard), actual, eligible, null);
      console.log(
        `  ${ablation.name.padEnd(14)} on ${ablation.segment.padEnd(18)} ${rho(before.overall)} -> ${rho(after.overall)}  ` +
          `${delta(before.overall, after.overall)}   n=${after.overall.sampleSize} (before n=${before.overall.sampleSize})` +
          `${ablation.name === "rookies" ? "  [before = draft capital alone]" : ""}`,
      );
      // BAND BY BAND UNDER THE ABLATION TOO, because a pooled figure over five hundred players is
      // the number model v3 recorded the news pass at zero on while it moved the two bands a manager
      // decides in by the largest margins in the project. A group is allowed to be worth nothing
      // overall and worth something where the product lives, and a report that could not show the
      // difference would keep hiding it.
      console.log(
        `  ${"".padEnd(14)}    ` +
          RANK_BANDS.map(
            (band) =>
              `${band.name} ${rho(before.byBand[band.name])}->${rho(after.byBand[band.name])} ${delta(before.byBand[band.name], after.byBand[band.name])}`,
          ).join("  "),
      );
    }

    console.log("\nTIERS: the shipped gap rule against the spec's own overlap rule");
    for (const position of SCORED) {
      const pool = board.filter((entry) => entry.position === position);
      const shipped = new Set(pool.map((entry) => entry.tier)).size;
      const overlap = new Set(
        overlapTiers(pool.map((entry) => ({ value: entry.valueOverReplacement, outlook: entry.outlook }))),
      ).size;
      console.log(
        `  ${position}  ${String(pool.length).padStart(3)} players   gap rule ${String(shipped).padStart(3)} tiers   overlap rule ${String(overlap).padStart(3)} tiers`,
      );
    }

    console.log("\nREASONS ATTACHED, by code");
    const counts = new Map<string, number>();
    for (const entry of board) {
      for (const reason of entry.reasons) counts.set(reason.code, (counts.get(reason.code) ?? 0) + 1);
    }
    for (const [code, count] of [...counts].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${code.padEnd(26)} ${count}`);
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
