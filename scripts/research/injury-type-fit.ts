// PRE-REGISTERED ROUND (2026-09-05): injury-type-conditioned availability. Binding pre-registration
// at `docs/research/2026-09-05-availability-injury-type-preregistration.md` (Amendment 1) plus the
// data-access Amendment 2 recorded in the results doc.
//
// TASK 2/3 — fits a class-conditional multiplier (`classMultiplier`) on the FIT seasons and judges
// it EXACTLY ONCE against the incumbent model on held-out 2025, using the dataset
// `scripts/research/injury-type-features.ts` produced. Every quantity the incumbent side of this
// comparison uses is the REAL, committed model code (`shrunkAvailabilityRate`,
// `expectedGamesPlayed`, `outlookFromRate`, `FITTED_AVAILABILITY_PRIORS`) — never reimplemented —
// so the only new mechanism this script measures is the class multiplier itself.
//
// Run: RESEARCH_CACHE_DIR=... npx tsx scripts/research/injury-type-fit.ts
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Position } from "@/domain/player";
import { FITTED_AVAILABILITY_PRIORS } from "@/projections/preseason/fitted";
import { expectedGamesPlayed, outlookFromRate, type AvailabilityInput } from "@/projections/preseason/availability";
import type { RosterStatus } from "@/projections/nflverse/rosters";
import type { AbsenceFeatures } from "./injury-type-features";

const CACHE_DIR = process.env.RESEARCH_CACHE_DIR ?? join(tmpdir(), "injury-type-research");
const INPUT_PATH = join(CACHE_DIR, "feature-dataset.json");

interface FeatureRow {
  readonly season: number;
  readonly playerId: string;
  readonly position: Position;
  readonly age: number | null;
  readonly status: RosterStatus;
  readonly projectedSnapShare: number;
  readonly history: readonly { season: number; gamesPlayed: number; teamGames: number }[];
  readonly gamesPlayed: number;
  readonly teamGames: number;
  readonly priorAbsence: AbsenceFeatures;
  readonly priorPriorHealthy: boolean;
}

const FIT_SEASONS = [2018, 2020, 2021, 2022, 2023, 2024] as const;
const JUDGE_SEASON = 2025;
const YEAR_ONE_MONTHS = 12; // discrete_terminal's "year one" boundary the hypothesis names.
const CLASS_PRIOR_N = 15; // shrinkage toward 1, analogous to `fit.ts`'s CELL_PRIOR_SEASONS=40, sized
// down because a class cell is a much smaller, ROUND-SPECIFIC population than a position/role cell.
const MULTIPLIER_BOUND = { min: 0.5, max: 1.5 } as const; // guards a thin cell; documented, not tuned.

type ClassKey = "healthy" | "discrete_terminal_year_one" | "discrete_terminal_later" | "recurring";

function classKeyOf(row: FeatureRow): ClassKey {
  const { absenceClass, terminalAbsenceAgeMonths } = row.priorAbsence;
  if (absenceClass === "healthy") return "healthy";
  if (absenceClass === "recurring") return "recurring";
  // discrete_terminal always carries a terminalAbsenceAgeMonths (see computeAbsenceFeatures).
  return (terminalAbsenceAgeMonths ?? 0) <= YEAR_ONE_MONTHS ? "discrete_terminal_year_one" : "discrete_terminal_later";
}

function toAvailabilityInput(row: FeatureRow): AvailabilityInput {
  return {
    position: row.position,
    age: row.age,
    status: row.status,
    designation: null,
    projectedSnapShare: row.projectedSnapShare,
    // THE ROUND'S OWN READING, PRESERVED AS RUN: this research judged its gate (FINAL, 2026-09-05)
    // with every unplayed game read as an absence. The shipped model has since moved to the
    // classified count (`availability/week-classification.ts`); restating this script's history
    // under the new rule would change numbers a FINAL results document already reports.
    history: row.history.map((entry) => ({ ...entry, gamesUnavailable: Math.max(0, entry.teamGames - entry.gamesPlayed), gamesSuspended: 0 })),
    baselineRate: null,
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function stddev(values: readonly number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Bootstrap the ratio `mean(actual)/mean(incumbentExpected)` for one class, for gate 4's
 *  "fitted with uncertainty" requirement. 2000 resamples, percentile CI. */
function bootstrapRatio(actual: readonly number[], expected: readonly number[], iterations = 2000): { ratio: number; se: number; ci90: [number, number] } {
  const n = actual.length;
  const pointRatio = mean(actual) / mean(expected);
  if (n < 2) return { ratio: pointRatio, se: NaN, ci90: [NaN, NaN] };
  const draws: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    let sumA = 0;
    let sumE = 0;
    for (let k = 0; k < n; k += 1) {
      const idx = Math.floor(Math.random() * n);
      sumA += actual[idx]!;
      sumE += expected[idx]!;
    }
    draws.push(sumA / sumE);
  }
  draws.sort((a, b) => a - b);
  const se = stddev(draws);
  const lo = draws[Math.floor(0.05 * iterations)]!;
  const hi = draws[Math.floor(0.95 * iterations)]!;
  return { ratio: pointRatio, se, ci90: [lo, hi] };
}

interface ClassFit {
  readonly n: number;
  readonly rawRatio: number;
  readonly se: number;
  readonly ci90: readonly [number, number];
  readonly shrunkMultiplier: number;
}

function fitClassMultiplier(rows: readonly FeatureRow[], key: ClassKey, incumbentRateOf: (row: FeatureRow) => number): ClassFit {
  const inClass = rows.filter((row) => classKeyOf(row) === key);
  const actualRates = inClass.map((row) => row.gamesPlayed / row.teamGames);
  const expectedRates = inClass.map(incumbentRateOf);
  const n = inClass.length;
  if (n === 0) return { n: 0, rawRatio: 1, se: NaN, ci90: [NaN, NaN], shrunkMultiplier: 1 };
  const { ratio, se, ci90 } = bootstrapRatio(actualRates, expectedRates);
  // Shrink toward 1 (no effect) in proportion to how much evidence the class carries, exactly the
  // discipline `fit.ts`'s `fitAgeMultipliers`/`fitStatusMultipliers` already use for a thin cell.
  const weight = n / (CLASS_PRIOR_N + n);
  const shrunkMultiplier = Math.min(MULTIPLIER_BOUND.max, Math.max(MULTIPLIER_BOUND.min, 1 * (1 - weight) + ratio * weight));
  return { n, rawRatio: ratio, se, ci90, shrunkMultiplier };
}

function outcomeCovered(actual: number, floor: number, ceiling: number): boolean {
  return actual >= floor && actual <= ceiling;
}

function mae(rows: readonly { actual: number; predicted: number }[]): number {
  return mean(rows.map((r) => Math.abs(r.actual - r.predicted)));
}

function main(): void {
  const rows: FeatureRow[] = JSON.parse(readFileSync(INPUT_PATH, "utf8"));
  const fitRows = rows.filter((r) => (FIT_SEASONS as readonly number[]).includes(r.season));
  const judgeRows = rows.filter((r) => r.season === JUDGE_SEASON);

  console.log(`FIT rows: ${fitRows.length} (seasons ${FIT_SEASONS.join(",")})`);
  console.log(`JUDGE rows: ${judgeRows.length} (season ${JUDGE_SEASON})`);

  const incumbentOutlook = (row: FeatureRow) =>
    expectedGamesPlayed(toAvailabilityInput(row), { season: row.season, priors: FITTED_AVAILABILITY_PRIORS });
  const incumbentRateOf = (row: FeatureRow) => incumbentOutlook(row).rate;

  // --- FIT: class multipliers on 2018-2024, on the RESIDUAL of the incumbent model. ---
  const classKeys: ClassKey[] = ["healthy", "discrete_terminal_year_one", "discrete_terminal_later", "recurring"];
  const classFits = new Map<ClassKey, ClassFit>();
  for (const key of classKeys) {
    classFits.set(key, key === "healthy" ? { n: fitRows.filter((r) => classKeyOf(r) === "healthy").length, rawRatio: 1, se: 0, ci90: [1, 1], shrunkMultiplier: 1 } : fitClassMultiplier(fitRows, key, incumbentRateOf));
  }

  console.log("\n=== Fitted class multipliers (2018-2024 fit population) ===");
  for (const key of classKeys) {
    const fit = classFits.get(key)!;
    console.log(
      `${key.padEnd(28)} n=${String(fit.n).padStart(4)}  rawRatio=${fit.rawRatio.toFixed(3)}  se=${Number.isNaN(fit.se) ? "n/a" : fit.se.toFixed(3)}  ci90=[${fit.ci90.map((v) => (Number.isNaN(v) ? "n/a" : v.toFixed(3))).join(", ")}]  shrunkMultiplier=${fit.shrunkMultiplier.toFixed(3)}`,
    );
  }

  const classMultiplierOf = (row: FeatureRow): number => classFits.get(classKeyOf(row))!.shrunkMultiplier;

  const newOutlookOf = (row: FeatureRow) => {
    const incumbent = incumbentOutlook(row);
    const multiplier = classMultiplierOf(row);
    const rate = Math.min(1, Math.max(0, incumbent.rate * multiplier));
    return outlookFromRate(row.teamGames, rate, FITTED_AVAILABILITY_PRIORS.concentration + FITTED_AVAILABILITY_PRIORS.concentrationPerSeason * row.history.length);
  };

  // --- JUDGE: gates on held-out 2025, exactly once. ---
  const judged = judgeRows.map((row) => ({
    row,
    actual: row.gamesPlayed,
    incumbent: incumbentOutlook(row),
    updated: newOutlookOf(row),
  }));

  const gate1Incumbent = mae(judged.map((j) => ({ actual: j.actual, predicted: j.incumbent.expected })));
  const gate1New = mae(judged.map((j) => ({ actual: j.actual, predicted: j.updated.expected })));

  const coverageOf = (pick: "incumbent" | "updated") =>
    mean(judged.map((j) => (outcomeCovered(j.actual, j[pick].distribution.floor, j[pick].distribution.ceiling) ? 1 : 0)));
  const gate2Incumbent = coverageOf("incumbent");
  const gate2New = coverageOf("updated");

  const healthyJudged = judged.filter((j) => j.row.priorAbsence.absenceClass === "healthy" && j.row.priorPriorHealthy);
  const gate3IncumbentMae = mae(healthyJudged.map((j) => ({ actual: j.actual, predicted: j.incumbent.expected })));
  const gate3NewMae = mae(healthyJudged.map((j) => ({ actual: j.actual, predicted: j.updated.expected })));

  console.log("\n=== GATES (held-out 2025, n=%d) ===".replace("%d", String(judged.length)));
  console.log(`Gate 1 (expected-games MAE, whole board): incumbent=${gate1Incumbent.toFixed(3)}  new=${gate1New.toFixed(3)}  delta=${(gate1New - gate1Incumbent).toFixed(3)}  ${gate1New < gate1Incumbent ? "PASS" : "FAIL"}`);
  console.log(`Gate 2 (p10-p90 coverage): incumbent=${gate2Incumbent.toFixed(4)}  new=${gate2New.toFixed(4)}  delta=${(gate2New - gate2Incumbent).toFixed(4)}  ${gate2New - gate2Incumbent >= 0.05 ? "PASS" : "FAIL"} (needs >= +0.05)`);
  console.log(`Gate 3 (healthy population, n=${healthyJudged.length}): incumbent MAE=${gate3IncumbentMae.toFixed(3)}  new MAE=${gate3NewMae.toFixed(3)}  delta=${(gate3NewMae - gate3IncumbentMae).toFixed(3)}  ${Math.abs(gate3NewMae - gate3IncumbentMae) < 1e-9 ? "PASS (identical by construction: classMultiplier.healthy = 1)" : gate3NewMae <= gate3IncumbentMae * 1.03 ? "PASS" : "FAIL"}`);

  console.log("\n=== Gate 4: the discrete_terminal effect, fitted with uncertainty ===");
  for (const key of ["discrete_terminal_year_one", "discrete_terminal_later", "recurring"] as ClassKey[]) {
    const fit = classFits.get(key)!;
    console.log(`${key}: multiplier=${fit.shrunkMultiplier.toFixed(3)} (raw ${fit.rawRatio.toFixed(3)}, se ${Number.isNaN(fit.se) ? "n/a" : fit.se.toFixed(3)}, 90% CI [${fit.ci90.map((v) => (Number.isNaN(v) ? "n/a" : v.toFixed(3))).join(", ")}], n=${fit.n})`);
  }

  // Per-position and per-class breakdown for the results doc.
  console.log("\n=== Per-position MAE (2025) ===");
  for (const position of ["QB", "RB", "WR", "TE"] as Position[]) {
    const subset = judged.filter((j) => j.row.position === position);
    if (subset.length === 0) continue;
    const inc = mae(subset.map((j) => ({ actual: j.actual, predicted: j.incumbent.expected })));
    const upd = mae(subset.map((j) => ({ actual: j.actual, predicted: j.updated.expected })));
    console.log(`${position}: n=${subset.length}  incumbent MAE=${inc.toFixed(3)}  new MAE=${upd.toFixed(3)}`);
  }

  console.log("\n=== FIT population class counts ===");
  for (const key of classKeys) console.log(`${key}: ${classFits.get(key)!.n}`);
  console.log("\n=== JUDGE population class counts (2025) ===");
  for (const key of classKeys) console.log(`${key}: ${judgeRows.filter((r) => classKeyOf(r) === key).length}`);

  const summary = {
    fitSeasons: FIT_SEASONS,
    judgeSeason: JUDGE_SEASON,
    fitRowCount: fitRows.length,
    judgeRowCount: judgeRows.length,
    classFits: Object.fromEntries(classFits),
    gate1: { incumbent: gate1Incumbent, updated: gate1New, pass: gate1New < gate1Incumbent },
    gate2: { incumbent: gate2Incumbent, updated: gate2New, delta: gate2New - gate2Incumbent, pass: gate2New - gate2Incumbent >= 0.05 },
    gate3: { incumbent: gate3IncumbentMae, updated: gate3NewMae, n: healthyJudged.length, pass: Math.abs(gate3NewMae - gate3IncumbentMae) < 1e-9 },
  };
  writeFileSync(join(CACHE_DIR, "gate-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nWrote gate summary to ${join(CACHE_DIR, "gate-summary.json")}`);
}

main();
