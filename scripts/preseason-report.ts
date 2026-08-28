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
import { computeFantasyPoints } from "@/scoring/compute";
import { allPositions } from "@/projections/backtest";
import { nflPlayers } from "@/db/schema";
import { statLinesAsOf } from "@/projections/lines";
import { FITTED_MODEL } from "@/projections/model/source";
import { RANK_BANDS, scoreCard, type Observation, type RankBandName, type ScoreCard } from "@/projections/metrics";
import type { LeagueShape } from "@/projections/decide/replacement";
import { BENCHMARK_SOURCES } from "@/projections/preseason/benchmarks";
import { overlapTiers, preseasonBoard, type BoardEntry } from "@/projections/preseason/board";
import { FITTED_AVAILABILITY_PRIORS, FITTED_ROOKIE_PRIORS } from "@/projections/preseason/fitted";
import {
  ALL_PRESEASON_FEATURES,
  loadPreseason,
  offseasonSegmentFor,
  preseasonCandidates,
  rookieSegmentFor,
  type PreseasonFeatures,
  type PreseasonInputs,
  type PreseasonPriors,
} from "@/projections/preseason/source";
import { preseasonRankingsAsOf } from "@/projections/preseason/store";

const SEASONS = process.argv.slice(2).map(Number);
const TARGET_SEASONS = SEASONS.length > 0 ? SEASONS : [2023, 2024];
const LAST_REGULAR_WEEK = 18;

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
};

/** Each ablation: one of Phase 6's groups switched off, and the segment it is judged on. */
const ABLATIONS: readonly { readonly name: string; readonly features: PreseasonFeatures; readonly segment: string }[] = [
  { name: "availability", features: { ...ALL_PRESEASON_FEATURES, availability: false }, segment: "everyone" },
  { name: "offseason", features: { ...ALL_PRESEASON_FEATURES, offseason: false }, segment: "changed situation" },
  { name: "rookies", features: { ...ALL_PRESEASON_FEATURES, rookies: false }, segment: "rookies" },
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

/** What every player on a board actually scored over the regular season. Zero for a man who never played. */
async function actualSeasonPoints(
  db: ReadonlyDb,
  season: number,
  positions: ReadonlyMap<string, Position>,
): Promise<ReadonlyMap<string, number>> {
  const rows = await statLinesAsOf(db, { season, week: { from: 1, to: LAST_REGULAR_WEEK }, asOf: FINAL });
  const totals = new Map<string, number>();
  for (const row of rows) {
    const position = positions.get(row.line.playerId);
    if (position === undefined) continue;
    totals.set(row.line.playerId, (totals.get(row.line.playerId) ?? 0) + computeFantasyPoints(row.line, position, PPR_SCORING));
  }
  return totals;
}

/**
 * Scores one ordering against outcomes, banded by a COMMON prior where one is given.
 *
 * Banding by a shared ranking rather than by each source's own is the fix every previous research
 * document in this engine asked for and none could apply: model v1 and model v2 both record that a
 * band-by-band comparison between sources is "indicative rather than exact" because the two arms do
 * not hold the same players in a band, and both name average draft position as the fix. This phase
 * ingested it, so the fix is available here for the first time.
 */
function scoreOrdering(
  predicted: ReadonlyMap<string, number>,
  actual: ReadonlyMap<string, number>,
  eligible: ReadonlySet<string>,
  bandBy: ReadonlyMap<string, number> | null,
): { readonly overall: ScoreCard; readonly byBand: Readonly<Record<RankBandName, ScoreCard>> } {
  const rows = [...predicted.entries()]
    .filter(([playerId]) => eligible.has(playerId) && actual.has(playerId))
    .map(([playerId, value]) => ({ playerId, value, actual: actual.get(playerId)! }));

  const order = [...rows].sort((a, b) => {
    if (bandBy === null) return b.value - a.value || a.playerId.localeCompare(b.playerId);
    return (bandBy.get(a.playerId) ?? Infinity) - (bandBy.get(b.playerId) ?? Infinity) || a.playerId.localeCompare(b.playerId);
  });
  const bandOf = new Map(order.map((row, index) => [row.playerId, index + 1] as const));

  const observationsIn = (from: number, to: number): readonly Observation[] =>
    rows
      .filter((row) => {
        const rank = bandOf.get(row.playerId)!;
        return rank >= from && rank <= to;
      })
      .map((row) => ({ predicted: row.value, actual: row.actual }));

  return {
    overall: scoreCard(rows.map((row) => ({ predicted: row.value, actual: row.actual }))),
    byBand: Object.fromEntries(
      RANK_BANDS.map((band) => [band.name, scoreCard(observationsIn(band.from, band.to))]),
    ) as Record<RankBandName, ScoreCard>,
  };
}

function boardValues(board: readonly BoardEntry[]): ReadonlyMap<string, number> {
  return new Map(board.map((entry) => [entry.playerId, entry.valueOverReplacement] as const));
}

function boardPoints(board: readonly BoardEntry[]): ReadonlyMap<string, number> {
  return new Map(board.map((entry) => [entry.playerId, entry.projectedPoints] as const));
}

/** The rookie class ordered by draft capital and nothing else. The `before` arm Task 3 has to beat. */
function draftCapitalOnly(inputs: PreseasonInputs, eligible: ReadonlySet<string>): ReadonlyMap<string, number> {
  return new Map(
    inputs.roster
      .filter((row) => eligible.has(row.playerId))
      // An undrafted man sits behind the last pick of the draft, which is what a team saying nothing
      // about him means. Negated so higher is better, as every other column in this report is.
      .map((row) => [row.playerId, -(row.draftPick ?? 300)] as const),
  );
}

function build(inputs: PreseasonInputs, features: PreseasonFeatures): readonly BoardEntry[] {
  return preseasonBoard(preseasonCandidates(inputs, features, PRIORS), {
    season: inputs.season,
    asOf: inputs.moment,
    rules: PPR_SCORING,
    shape: SHAPE,
  });
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
    const inputs = await loadPreseason(db, season);
    const actual = await actualSeasonPoints(db, season, positions);
    const everyone = new Set(actual.keys());

    console.log(`\n${"=".repeat(96)}`);
    console.log(`${season} PRESEASON BOARD, 12-team PPR, taken at ${inputs.moment.toISOString()}`);
    console.log(`${"=".repeat(96)}\n`);

    const board = build(inputs, ALL_PRESEASON_FEATURES);
    console.log(
      `board: ${board.length} players from a ${inputs.roster.length}-man week-one roster, ` +
        `${inputs.usage.length} prior usage rows, ${inputs.teamObservations.length} team facts`,
    );

    console.log("\nTOP 20 BY VALUE OVER REPLACEMENT");
    for (const entry of board.slice(0, 20)) {
      const scored = actual.get(entry.playerId) ?? 0;
      console.log(
        `  ${String(entry.rank).padStart(3)} ${entry.position} ${entry.team.padEnd(3)} ${(names.get(entry.playerId) ?? entry.playerId).padEnd(22)}` +
          `proj ${entry.projectedPoints.toFixed(0).padStart(4)}  vor ${entry.valueOverReplacement.toFixed(0).padStart(4)}  ` +
          `games ${entry.expectedGames.toFixed(1).padStart(4)}  tier ${entry.tier}  actual ${scored.toFixed(0).padStart(4)}`,
      );
    }

    console.log("\nAGAINST THE OUTCOME, banded by our own rank");
    printBands("value over replacement", scoreOrdering(boardValues(board), actual, everyone, null));
    printBands("projected points", scoreOrdering(boardPoints(board), actual, everyone, null));

    // The two published benchmarks, scored like for like: only players BOTH sources had an opinion
    // about, so neither is credited for breadth. Model v1 established that discipline and the same
    // reasoning applies with more force here, because a published board stops at about two hundred
    // names and ours does not.
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
      printBands("our board (VOR)", scoreOrdering(boardValues(board), actual, common, rankOf));
      printBands("our board (points)", scoreOrdering(boardPoints(board), actual, common, rankOf));
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
          : scoreOrdering(boardValues(without), actual, eligible, null);
      const after = scoreOrdering(boardValues(board), actual, eligible, null);
      console.log(
        `  ${ablation.name.padEnd(14)} on ${ablation.segment.padEnd(18)} ${rho(before.overall)} -> ${rho(after.overall)}  ` +
          `${delta(before.overall, after.overall)}   n=${after.overall.sampleSize} (before n=${before.overall.sampleSize})` +
          `${ablation.name === "rookies" ? "  [before = draft capital alone]" : ""}`,
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
