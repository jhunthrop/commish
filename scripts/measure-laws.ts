// Measures the six football "laws" (`LAW_SPECS`) against real nflverse history and writes
// `src/projections/laws/measured.json`, the committed evidence `registry()` reads. Run:
//   npm run laws:measure                 (measures, writes measured.json)
//   npm run laws:measure -- --check      (recomputes, exits 1 on any drift from the committed file)
// (dotenv -e .env.local -- tsx scripts/measure-laws.ts [--check])
//
// FULL-WINDOW MEASUREMENT, OUT-OF-SAMPLE DIRECTION REPLICATION (controller ruling — supersedes an
// earlier held-out-only measurement). `buildPopulations` is asked for every season
// `MEASURE_SEASONS.from..MEASURE_SEASONS.to - 1` (the terminal season is never asked for — it has
// no season-N+1 actuals to build against, so including it would spend a full population pass on
// rows that get thrown away, ledger ruling M5). Every law's `effect`/`ci`/`sample` is then measured
// over EVERY matched pair in that full window — not held-out points only. That window now includes
// the seasons `projection-fit.ts` fits the model on, so the full-window CI alone is no longer
// sufficient evidence: a law "confirmed" only there would be confirmed on the model's own training
// data. `verdictForFullWindow` (registry.ts) adds the missing piece: `confirmed` additionally
// requires the HELD-OUT SUBSET of those same matched pairs — the ones whose predictor season+1
// lands in `HELD_OUT_SEASONS` — to point the same direction as the full-window effect. That subset
// is a PARTITION of the full window's own matched pairs, not a second, separate match: because
// matching is stratified by season (see `stratumKeyFor`), a pair's two sides always share one
// season, so filtering matched pairs down to held-out predictor seasons gives exactly the pairs a
// held-out-only match would have produced anyway, for free.
//
// TWO FLOORS SET `MEASURE_SEASONS.from` AND PUNCH A HOLE IN THE MIDDLE OF THE WINDOW — both are
// upstream nflverse facts, not choices, and neither needs special-case code here: `config.ts`
// documents the snap-count floor (2013) in full, and `STAT_LINE_GAPS` below names the mid-window
// hole (nflverse's `stats_player_week_2019.csv` release does not exist — a deterministic 404, so no
// 2019 stat-line season is ever built). A player-season whose outcome falls in a gap year already
// has no `nextPointsPerGame` to match on, and the tri-state "no evidence is not false" rule
// (`populations.ts`) drops it from both pools — the hole shows up as fewer matched pairs, never as
// a crash or a silently wrong zero.
//
// STRATIFICATION lives in one place: `registry.ts`'s `stratumKeyFor`. See that function's docblock
// for the season/position rule.
//
// `measureEffect` (harness.ts) THROWS on zero matched pairs — for the FULL WINDOW that throw is
// left to propagate, uncaught: a law whose full-window population matched nothing at all is a
// population-builder bug and the honest response is to fail the whole run loudly. The HELD-OUT
// SUBSET is different: a law can legitimately have a full-window match but zero held-out pairs (a
// condition that never recurred in `HELD_OUT_SEASONS`), and that is not a bug — it is exactly the
// "cannot be confirmed" case `verdictForFullWindow` caps at `weak`. So the held-out subset's effect
// is computed WITHOUT calling `measureEffect` when it is empty; `heldOutEffect` is `null` instead.
//
// `--check` is the drift guard `registry.test.ts` cannot provide by itself: it recomputes every
// law's measurement from the SAME DB the real run reads (seeded bootstrap, so a rerun is
// byte-identical) and diffs the result against the committed `measured.json`. It costs a full pass
// of DB READS — the same population-building queries the real run makes — not any API request
// budget; nflverse and every store this reads from are already ingested and local to Postgres.
//
// DO NOT TUNE CALIPERS OR THRESHOLDS TO REACH A WANTED VERDICT. A debunked founder-favorite law is
// a RESULT, not a bug — the spec ships debunked laws as content, and `LAW_SPECS`'s calipers were
// fixed before this script ever ran.
import { readFileSync, writeFileSync } from "node:fs";
import { createDb } from "@/db/client";
import type { ReadonlyDb } from "@/db/client";
import { matchedPairsStratified, measureEffect, type MatchedPair } from "@/projections/laws/harness";
import { HELD_OUT_SEASONS, MEASURE_SEASONS } from "@/projections/laws/config";
import { buildPopulations, LAW_SPECS, type LawSpec } from "@/projections/laws/populations";
import { MEASURED_JSON_PATH, stratumKeyFor, verdictForFullWindow, type MeasuredEntry, type MeasuredJson } from "@/projections/laws/registry";
import type { LawMeasurement, LawVerdict, PlayerSeasonPoint } from "@/projections/laws/types";

const OUTPUT_PATH = MEASURED_JSON_PATH;

/** Seasons inside `MEASURE_SEASONS` whose stat-line CSV nflverse never published. See header. */
const STAT_LINE_GAPS: readonly number[] = [2019];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run laws:measure\`, which loads .env.local.`);
  }
  return value;
}

/** `MEASURE_SEASONS.from..MEASURE_SEASONS.to - 1` — see the header for why the terminal season is excluded. */
function measurementSeasons(): readonly number[] {
  const seasons: number[] = [];
  for (let season = MEASURE_SEASONS.from; season <= MEASURE_SEASONS.to - 1; season += 1) seasons.push(season);
  return seasons;
}

/** A matched pair is held out exactly when its (shared, stratified-on) predictor season's N+1
 *  outcome lands in a held-out year. See header. */
const HELD_OUT_PREDICTOR_SEASONS: ReadonlySet<number> = new Set(HELD_OUT_SEASONS.map((year) => year - 1));
function isHeldOutPair(pair: MatchedPair): boolean {
  return HELD_OUT_PREDICTOR_SEASONS.has(pair.condition.season);
}

/** e.g. "2013-2023 (2019 missing upstream), direction replicated on 2022-2023". */
function seasonsLabel(): string {
  const window = `${MEASURE_SEASONS.from}-${MEASURE_SEASONS.to - 1}`;
  const gapNote = STAT_LINE_GAPS.length === 0 ? "" : ` (${STAT_LINE_GAPS.join(", ")} missing upstream)`;
  const heldOutPredictors = [...HELD_OUT_PREDICTOR_SEASONS].sort((a, b) => a - b);
  const replicated = `${heldOutPredictors[0]}-${heldOutPredictors[heldOutPredictors.length - 1]}`;
  return `${window}${gapNote}, direction replicated on ${replicated}`;
}

interface LawResult {
  readonly id: string;
  readonly measurement: LawMeasurement;
  readonly heldOutEffect: number | null;
  readonly verdict: LawVerdict;
}

/** One law's full-window measurement, plus its held-out subset's effect (or `null` — see header). */
function measureLaw(spec: LawSpec, population: readonly PlayerSeasonPoint[]): LawResult {
  const pairs = matchedPairsStratified(population, spec.caliper, (point) => stratumKeyFor(spec, point));
  const fullWindow = measureEffect(pairs); // throws loudly on zero matched pairs — never caught here
  const measurement: LawMeasurement = { ...fullWindow, seasons: seasonsLabel() };

  const heldOutPairs = pairs.filter(isHeldOutPair);
  const heldOutEffect = heldOutPairs.length === 0 ? null : measureEffect(heldOutPairs).effect;

  return { id: spec.id, measurement, heldOutEffect, verdict: verdictForFullWindow(measurement, spec.expectedSign, heldOutEffect) };
}

async function measureAll(db: ReadonlyDb): Promise<readonly LawResult[]> {
  const seasons = measurementSeasons();
  const populations = await buildPopulations(db, seasons);
  return LAW_SPECS.map((spec) => {
    const population = populations.get(spec.id);
    if (population === undefined) {
      throw new Error(`buildPopulations produced no entry for law "${spec.id}": LAW_SPECS and buildPopulations have drifted apart.`);
    }
    return measureLaw(spec, population);
  });
}

function toMeasuredJson(results: readonly LawResult[]): MeasuredJson {
  const sorted = [...results].sort((a, b) => a.id.localeCompare(b.id));
  const entries = sorted.map((result): readonly [string, MeasuredEntry] => [
    result.id,
    { ...result.measurement, heldOutEffect: result.heldOutEffect, verdict: result.verdict },
  ]);
  return Object.fromEntries(entries) as MeasuredJson;
}

function renderMeasuredJson(measuredJson: MeasuredJson): string {
  return `${JSON.stringify(measuredJson, null, 2)}\n`;
}

function printTable(results: readonly LawResult[]): void {
  const header = `${"law".padEnd(26)}${"effect".padStart(8)}   ${"95% CI".padStart(17)}   ${"n".padStart(4)}   ${"heldOut".padStart(8)}   verdict`;
  console.log(`\n${header}`);
  console.log("-".repeat(header.length));
  for (const { id, measurement, heldOutEffect, verdict } of [...results].sort((a, b) => a.id.localeCompare(b.id))) {
    const [low, high] = measurement.ci;
    const ci = `[${low.toFixed(3).padStart(7)}, ${high.toFixed(3).padStart(7)}]`;
    const heldOut = heldOutEffect === null ? "n/a" : heldOutEffect.toFixed(3);
    console.log(
      `${id.padEnd(26)}${measurement.effect.toFixed(3).padStart(8)}   ${ci}   ${String(measurement.sample).padStart(4)}   ${heldOut.padStart(8)}   ${verdict}`,
    );
  }
}

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const db = createDb(requireEnv("DATABASE_URL"));

  const results = await measureAll(db);
  await db.$client.end();

  printTable(results);
  const rendered = renderMeasuredJson(toMeasuredJson(results));

  if (check) {
    const committed = readFileSync(OUTPUT_PATH, "utf-8");
    if (committed !== rendered) {
      console.error(
        `\n${OUTPUT_PATH} does not match the measured evidence. Run \`npm run laws:measure\` and commit the result.`,
      );
      process.exit(1);
    }
    console.log(`\n${OUTPUT_PATH} matches the measured evidence. No drift.`);
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
