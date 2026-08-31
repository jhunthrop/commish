// Measures the six football "laws" (`LAW_SPECS`) against real nflverse history and writes
// `src/projections/laws/measured.json`, the committed evidence `registry()` reads. Run:
//   npm run laws:measure                 (measures, writes measured.json)
//   npm run laws:measure -- --check      (recomputes, exits 1 on any drift from the committed file)
// (dotenv -e .env.local -- tsx scripts/measure-laws.ts [--check])
//
// THE HELD-OUT SPLIT RULE, decided here and nowhere else: `buildPopulations` is asked for every
// season `MEASURE_SEASONS.from..MEASURE_SEASONS.to - 1` (the terminal season is never asked for —
// it has no season-N+1 actuals to build against, so including it would spend a full population
// pass on rows that get thrown away, ledger ruling M5). Out of that population, a player-season
// point counts as HELD OUT exactly when its season-N+1 OUTCOME lands in a held-out year — i.e.
// `point.season + 1` is a member of `HELD_OUT_SEASONS`, equivalently `point.season` is a member of
// `HELD_OUT_SEASONS.map(year => year - 1)`. Every verdict this script writes is measured on held-out
// points ONLY; the rest of the built population (seasons before the held-out predictor seasons) is
// discarded after the split rather than folded into the measurement, because a law's grade must
// answer "does this hold on seasons the model never got to see," not "does this hold somewhere in
// fourteen years of history including the years everything else in this codebase is fitted on."
//
// STRATIFICATION lives in one place: `registry.ts`'s `stratumKeyFor`, called here for every law.
// See that function's docblock for the season/position rule.
//
// `measureEffect` (harness.ts) THROWS on zero matched pairs. That throw is left to propagate here,
// uncaught and unswallowed: a law whose held-out population matched nothing is a population-builder
// bug (condition too strict, wrong stratification, caliper too tight, or too few held-out seasons),
// and the one honest response is to fail the whole run loudly rather than write a registry entry
// for evidence that does not exist.
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
import { matchedPairsStratified, measureEffect, verdictFor } from "@/projections/laws/harness";
import { HELD_OUT_SEASONS, MEASURE_SEASONS } from "@/projections/laws/config";
import { buildPopulations, LAW_SPECS, type LawSpec } from "@/projections/laws/populations";
import { MEASURED_JSON_PATH, stratumKeyFor, type MeasuredEntry, type MeasuredJson } from "@/projections/laws/registry";
import type { LawMeasurement, LawVerdict, PlayerSeasonPoint } from "@/projections/laws/types";

const OUTPUT_PATH = MEASURED_JSON_PATH;

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

/** A point is held out exactly when its season-N+1 outcome lands in a held-out year. See header. */
const HELD_OUT_PREDICTOR_SEASONS: ReadonlySet<number> = new Set(HELD_OUT_SEASONS.map((year) => year - 1));
function isHeldOut(point: PlayerSeasonPoint): boolean {
  return HELD_OUT_PREDICTOR_SEASONS.has(point.season);
}

interface LawResult {
  readonly id: string;
  readonly measurement: LawMeasurement;
  readonly verdict: LawVerdict;
}

/** One law's held-out measurement: filter to held-out points, match stratified, measure, grade. */
function measureLaw(spec: LawSpec, population: readonly PlayerSeasonPoint[]): LawResult {
  const heldOut = population.filter(isHeldOut);
  const pairs = matchedPairsStratified(heldOut, spec.caliper, (point) => stratumKeyFor(spec, point));
  const measurement = measureEffect(pairs); // throws loudly on zero matched pairs — never caught here
  return { id: spec.id, measurement, verdict: verdictFor(measurement, spec.expectedSign) };
}

async function measureAll(db: ReadonlyDb): Promise<readonly LawResult[]> {
  const seasons = measurementSeasons();
  const populations = await buildPopulations(db, seasons);
  return LAW_SPECS.map((spec) => {
    const population = populations.get(spec.id);
    if (population === undefined) {
      throw new Error(`buildPopulations produced no entry for law "${spec.id}" — LAW_SPECS and buildPopulations have drifted apart.`);
    }
    return measureLaw(spec, population);
  });
}

function toMeasuredJson(results: readonly LawResult[]): MeasuredJson {
  const sorted = [...results].sort((a, b) => a.id.localeCompare(b.id));
  const entries = sorted.map((result): readonly [string, MeasuredEntry] => [result.id, { ...result.measurement, verdict: result.verdict }]);
  return Object.fromEntries(entries) as MeasuredJson;
}

function renderMeasuredJson(measuredJson: MeasuredJson): string {
  return `${JSON.stringify(measuredJson, null, 2)}\n`;
}

function printTable(results: readonly LawResult[]): void {
  const header = `${"law".padEnd(26)}${"effect".padStart(8)}   ${"95% CI".padStart(17)}   ${"n".padStart(4)}   verdict`;
  console.log(`\n${header}`);
  console.log("-".repeat(header.length));
  for (const { id, measurement, verdict } of [...results].sort((a, b) => a.id.localeCompare(b.id))) {
    const [low, high] = measurement.ci;
    const ci = `[${low.toFixed(3).padStart(7)}, ${high.toFixed(3).padStart(7)}]`;
    console.log(`${id.padEnd(26)}${measurement.effect.toFixed(3).padStart(8)}   ${ci}   ${String(measurement.sample).padStart(4)}   ${verdict}`);
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
    console.log(`\n${OUTPUT_PATH} matches the measured evidence — no drift.`);
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
