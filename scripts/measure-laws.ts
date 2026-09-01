// Measures the six football "laws" (`LAW_SPECS`) against real nflverse history and writes
// `src/projections/laws/measured.json`, the committed evidence `registry()` reads. Run:
//   npm run laws:measure                 (measures, writes measured.json)
//   npm run laws:measure -- --check      (recomputes, exits 1 on any drift from the committed file)
// (dotenv -e .env.local -- tsx scripts/measure-laws.ts [--check])
//
// FULL-WINDOW MEASUREMENT, ROLLING-FOLD OUT-OF-SAMPLE DIRECTION REPLICATION (this wave,
// 2026-08-31 — supersedes an earlier single held-out-pair measurement). `buildPopulations` is
// asked for every season `MEASURE_SEASONS.from..MEASURE_SEASONS.to - 1` (the terminal season is
// never asked for — it has no season-N+1 actuals to build against, so including it would spend a
// full population pass on rows that get thrown away, ledger ruling M5). Every law's
// `effect`/`ci`/`sample` is then measured over EVERY matched pair in that full window — not
// held-out points only. That window now includes the seasons `projection-fit.ts` fits the model
// on, so the full-window CI alone is no longer sufficient evidence: a law "confirmed" only there
// would be confirmed on the model's own training data. `verdictForFullWindow` (registry.ts) adds
// the missing piece: `confirmed` additionally requires EVERY REPLICATION FOLD
// (`config.ts`'s `REPLICATION_FOLDS`, one predictor season per fold) that matched at least one
// pair to point the same direction as the full-window effect. Each fold's subset is a PARTITION of
// the full window's own matched pairs, not a second, separate match: because matching is
// stratified by season (see `stratumKeyFor`), a pair's two sides always share one season, so
// filtering matched pairs down to one predictor season at a time gives exactly the pairs a
// per-season match would have produced anyway, for free.
//
// ONE FLOOR SETS `MEASURE_SEASONS.from`, AND A ONCE-MID-WINDOW HOLE IS NOW FILLED — both are
// upstream nflverse facts, not choices: `config.ts` documents the snap-count floor (2013) in full,
// and `STAT_LINE_GAPS` (`nflverse/stat-lines.ts`) names the seasons whose published weekly stats
// file nflverse never released — `stats_player_week_2019.csv` is a deterministic 404. THAT USED TO
// mean no 2019 stat-line season was ever built and a player-season whose outcome fell there dropped
// out of both pools. It no longer does: `populations.ts`'s `seasonScoring` reads through
// `nflverse/derived-stat-lines.ts`'s `statLinesAsOfForMeasurement`, which admits a pbp-derived stat
// line for exactly the seasons named in `STAT_LINE_GAPS` — nowhere else, and never on a product
// surface. A player-season whose outcome falls in a gap year is measured on the derived line now;
// the tri-state "no evidence is not false" rule (`populations.ts`) still drops a player-season with
// genuinely no line at all (derived or published) from both pools, which is the only way this
// window can still come up short of a full season's worth of matched pairs.
//
// STRATIFICATION lives in one place: `registry.ts`'s `stratumKeyFor`. See that function's docblock
// for the season/position rule.
//
// `measureEffect` (harness.ts) THROWS on zero matched pairs — for the FULL WINDOW that throw is
// left to propagate, uncaught: a law whose full-window population matched nothing at all is a
// population-builder bug and the honest response is to fail the whole run loudly. A REPLICATION
// FOLD is different: a law can legitimately have a full-window match but zero pairs in one
// predictor season, and that is not a bug — it is exactly the "this fold contributed no evidence"
// case `verdictForFullWindow` treats as skippable rather than disagreeing. So each fold's effect is
// computed WITHOUT calling `measureEffect` when that fold's subset is empty; its `effect` is `null`
// instead.
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
import { matchedPairsStratified, measureEffect } from "@/projections/laws/harness";
import { MEASURE_SEASONS, REPLICATION_FOLDS } from "@/projections/laws/config";
import { buildPopulations, LAW_SPECS, type LawSpec } from "@/projections/laws/populations";
import { STAT_LINE_GAPS } from "@/projections/nflverse/stat-lines";
import {
  foldEffectsFor,
  MEASURED_JSON_PATH,
  stratumKeyFor,
  trainEffectFor,
  verdictForFullWindow,
  type FoldEffect,
  type MeasuredEntry,
  type MeasuredJson,
} from "@/projections/laws/registry";
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

/**
 * e.g. "2013-2023 (2019 rebuilt from play-by-play), direction replicated on predictor seasons
 * 2021-2023".
 *
 * This string renders verbatim on `/player-laws` (`measuredFigures`'s "Seasons" figure) — a reader
 * there is not expected to know what "pbp" or "derived" mean. Fix round, M1: an earlier version said
 * "pbp-derived", which is precise for an engineer reading this file and jargon for everyone who
 * reads the page it produces. Naming these explicitly as PREDICTOR seasons (rather than reusing the
 * old "held out" label) matters now that one fold, 2021, sits inside the seasons the projection
 * model fits on — see `config.ts`'s own note on why that overlap is intentional.
 */
function seasonsLabel(): string {
  const window = `${MEASURE_SEASONS.from}-${MEASURE_SEASONS.to - 1}`;
  const gapNote = STAT_LINE_GAPS.length === 0 ? "" : ` (${STAT_LINE_GAPS.join(", ")} rebuilt from play-by-play)`;
  const folds = [...REPLICATION_FOLDS].sort((a, b) => a - b);
  const replicated = folds.length === 1 ? `${folds[0]}` : `${folds[0]}-${folds[folds.length - 1]}`;
  return `${window}${gapNote}, direction replicated on predictor seasons ${replicated}`;
}

interface LawResult {
  readonly id: string;
  readonly measurement: LawMeasurement;
  /** The SAME matched-pairs measurement, restricted to predictor seasons <= LAW_TRAIN_CUTOFF_SEASON
   *  (C1 fix round) — see `registry.ts`'s `trainEffectFor` for the full rationale. */
  readonly trainEffect: number;
  readonly foldEffects: readonly FoldEffect[];
  readonly verdict: LawVerdict;
}

/** One law's full-window measurement, its train-only effect (C1 fix round), plus one effect per
 *  replication fold (see header). */
function measureLaw(spec: LawSpec, population: readonly PlayerSeasonPoint[]): LawResult {
  const pairs = matchedPairsStratified(population, spec.caliper, (point) => stratumKeyFor(spec, point));
  const fullWindow = measureEffect(pairs); // throws loudly on zero matched pairs — never caught here
  const measurement: LawMeasurement = { ...fullWindow, seasons: seasonsLabel() };
  const trainEffect = trainEffectFor(pairs);

  const foldEffects = foldEffectsFor(pairs);

  return { id: spec.id, measurement, trainEffect, foldEffects, verdict: verdictForFullWindow(measurement, spec.expectedSign, foldEffects) };
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
    { ...result.measurement, trainEffect: result.trainEffect, foldEffects: result.foldEffects, verdict: result.verdict },
  ]);
  return Object.fromEntries(entries) as MeasuredJson;
}

function renderMeasuredJson(measuredJson: MeasuredJson): string {
  return `${JSON.stringify(measuredJson, null, 2)}\n`;
}

/** Column width for one fold's own cell, wide enough for a right-justified header like "fold 2023"
 *  and a right-justified effect like "-1.667" or "n/a". */
const FOLD_COLUMN_WIDTH = 10;

function printTable(results: readonly LawResult[]): void {
  const foldHeaders = REPLICATION_FOLDS.map((season) => `fold ${season}`.padStart(FOLD_COLUMN_WIDTH)).join("   ");
  const header = `${"law".padEnd(26)}${"effect".padStart(8)}   ${"train".padStart(8)}   ${"95% CI".padStart(17)}   ${"n".padStart(4)}   ${foldHeaders}   verdict`;
  console.log(`\n${header}`);
  console.log("-".repeat(header.length));
  for (const { id, measurement, trainEffect, foldEffects, verdict } of [...results].sort((a, b) => a.id.localeCompare(b.id))) {
    const [low, high] = measurement.ci;
    const ci = `[${low.toFixed(3).padStart(7)}, ${high.toFixed(3).padStart(7)}]`;
    const foldCells = foldEffects
      .map((fold) => (fold.effect === null ? "n/a" : fold.effect.toFixed(3)).padStart(FOLD_COLUMN_WIDTH))
      .join("   ");
    console.log(
      `${id.padEnd(26)}${measurement.effect.toFixed(3).padStart(8)}   ${trainEffect.toFixed(3).padStart(8)}   ${ci}   ${String(measurement.sample).padStart(4)}   ${foldCells}   ${verdict}`,
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
