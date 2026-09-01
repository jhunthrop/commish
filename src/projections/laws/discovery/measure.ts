import { REPLICATION_FOLDS } from "../config";
import { matchedPairsStratified, measureEffect, bootstrapStatistics, type MatchedPair } from "../harness";
import { canonicalPointOrder, POINTS_PER_GAME_CALIPER, type LawPosition } from "../populations";
import { stratumKeyFor, verdictForDiscoveredLaw, type DiscoveredEntry, type DiscoveredJson, type FoldEffect } from "../registry";
import type { LawMeasurement, LawVerdict, PlayerSeasonPoint } from "../types";
import type { DiscoveryFacts } from "../discovery-facts";
import type { CandidateLaw } from "./generate";
import { renderSignedClaim } from "./templates";

/**
 * THE LAW DISCOVERY TRIAL (Task 7, 2026-08-31) — measuring all 1,737 of `discovery/generate.ts`'s
 * mechanically generated candidates under false-discovery control, then replicating the survivors on
 * the full window, exactly the pipeline `matchedPairsStratified`/`measureEffect` (`harness.ts`) and
 * `verdictForFullWindow` (`registry.ts`) already run for the six tribal laws, extended with the one
 * new step a 1,737-candidate family needs and a single hand-picked claim never did: controlling how
 * many "confirmed" verdicts are expected to be false alarms.
 *
 * THE PIPELINE, IN ORDER:
 *
 *   1. TRAIN SCREEN. Every candidate is measured on TRAIN predictor seasons only
 *      (`DISCOVERY_TRAIN_SEASONS`, 2013-2021 — see `config.ts`'s own docblock for why discovery's
 *      window stops short of `MEASURE_SEASONS`), stratified-matched the identical way a tribal law
 *      is (`matchedPairsStratified`, keyed by `stratumKeyFor` — a discovered candidate is always a
 *      single concrete position, never `"all"`, so this reduces to season-only stratification).
 *      `bootstrapStatistics` (`harness.ts`) THROWS on zero matched pairs, exactly like
 *      `measureEffect` does for a tribal law — but here that throw is EXPECTED, not a bug: a narrow
 *      AND-of-two-quantiles condition can easily match nobody on nine train seasons. `measureCandidateOnTrain`
 *      catches it per candidate and reports that candidate UNTESTABLE, excluded from the BH family
 *      entirely (never counted as a non-survivor — it was never in a position to survive or fail).
 *
 *   2. SIGN DERIVATION. A candidate never asserts a sign (`generate.ts`'s own docblock: "no expected
 *      sign... the generator has not measured anything yet"). `signOf` reads it straight off the
 *      train-window effect: negative effect, `expectedSign: -1`; positive or exactly zero,
 *      `expectedSign: 1` (the zero case is a coin-flip default that never actually happens with real
 *      floating-point data, not a case this pipeline expects to matter).
 *
 *   3. BENJAMINI-HOCHBERG at q=0.10, OVER THE TESTABLE FAMILY ONLY. RULING P2 (binding, this wave):
 *      the p-value BH consumes is a TWO-SIDED NORMAL-APPROXIMATION p-value —
 *      `z = effect / bootstrapSE`, `p = 2 * (1 - Φ(|z|))` — computed from `bootstrapStatistics`'s own
 *      `se` (the standard deviation of its 1,000 seeded resample means), NEVER a raw bootstrap
 *      resample quantile rank. A resample-rank p-value can only take values in {0, 1/1000, 2/1000,
 *      ...}, and Benjamini-Hochberg's own step-up rule compares the k-th smallest p-value against
 *      `(k/m)*q` — at m=1,737 candidates, `q/m ≈ 0.0000576`, well BELOW the 1/1000 granularity floor
 *      a resample-rank p-value could ever resolve, so every comparison would degenerate to "is the
 *      smallest attainable p-value (0 or 1/1000) below an even smaller number", which is either
 *      trivially true for a handful of candidates or never true for any of them depending on ties —
 *      not a real threshold at all. The normal approximation has no such floor. `benjaminiHochberg`
 *      is the general step-up procedure; the null-battery test in this module's own test file
 *      confirms it controls the false-survivor rate at or below `q` the way the Benjamini-Hochberg
 *      1995 proof says it must.
 *
 *   4. FULL-WINDOW REPLICATION. Every BH survivor is re-measured on the FULL window (predictor
 *      seasons `MEASURE_SEASONS.from`-`MEASURE_SEASONS.to - 1`, 2013-2023 — the same window the six
 *      tribal laws use), matched the identical stratified way. `measureEffect` is left UNCAUGHT here
 *      (unlike the train stage): the full window's per-season strata for every train season are the
 *      identical rows train measurement already matched successfully, so a survivor that had at
 *      least one train pair is guaranteed at least that many full-window pairs too — a throw at this
 *      stage would mean train and full-window population-building have silently drifted apart, a
 *      real bug worth failing loudly on, not an expected outcome the way a train-stage throw is.
 *
 *   5. VERDICT. `verdictForDiscoveredLaw` (`registry.ts`) — `verdictForFullWindow`'s own CI/sign/
 *      fold-agreement rule, plus the `>= 40` full-window pair floor that rule alone does not apply.
 *      Only a `confirmed` verdict here means the candidate REPLICATED: BH already controlled how many
 *      false alarms are expected across the whole screened family, and this is the pipeline's
 *      confirmatory check that a specific survivor's own evidence is strong enough on its own to
 *      trust, not just "probably not one of the false alarms in aggregate."
 *
 * A BH SURVIVOR THAT FAILS REPLICATION STAYS IN `discovered.json`, with its own non-confirmed
 * verdict — the honest record of "flagged by the screen, did not hold up," never quietly dropped.
 * Only a `confirmed` entry is chip/deviation-eligible (Task 8's concern, not this module's).
 *
 * EVERYTHING IN THIS FILE IS DB-FREE AND PURE, given already-fetched `DiscoverySeasonRow`s —
 * `scripts/discover-laws.ts` owns the one DB-reading pass (`discoveryFactsForSeason`/
 * `factsForSeason`/`actualPointsPerGame`, each run ONCE per season regardless of candidate count,
 * batching the shared read the same way `buildPopulations` batches it for the six tribal laws) and
 * hands this module the resulting rows.
 */

// ---------------------------------------------------------------------------------------------
// Benjamini-Hochberg, over a two-sided normal-approximation p-value (Ruling P2).
// ---------------------------------------------------------------------------------------------

/** One candidate's id and its two-sided p-value — `benjaminiHochberg`'s only input shape. */
export interface PValueEntry {
  readonly id: string;
  readonly pValue: number;
}

/** The false-discovery rate this pipeline controls to. */
export const BH_Q = 0.1;

/**
 * The standard normal CDF, via the Abramowitz & Stegun 7.1.26 rational approximation to `erf`
 * (max error 1.5e-7) — more than enough precision for a BH step-up threshold decision, and no
 * external statistics dependency for one function.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * The two-sided normal-approximation p-value RULING P2 requires: `z = effect / se`,
 * `p = 2 * (1 - Φ(|z|))`. `se === 0` is the degenerate case where every bootstrap resample landed on
 * the identical mean (possible with a tiny or degenerate pair set) — treated as maximally
 * significant (`p = 0`) when the effect is nonzero, and as no evidence at all (`p = 1`) when the
 * effect is also exactly zero, rather than dividing by zero.
 */
export function twoSidedPValue(effect: number, se: number): number {
  if (se === 0) return effect === 0 ? 1 : 0;
  const z = Math.abs(effect / se);
  return 2 * (1 - normalCdf(z));
}

/** The sign a candidate's own train-window effect committed to — never asserted up front (see this
 *  module's own docblock, step 2). `effect === 0` defaults to `1`, a case real floating-point data
 *  is not expected to hit. */
export function signOf(effect: number): -1 | 1 {
  return effect < 0 ? -1 : 1;
}

/**
 * The Benjamini-Hochberg (1995) step-up procedure: sort p-values ascending, find the LARGEST rank k
 * whose own p-value is `<= (k/m)*q`, and reject (survive) every candidate at or below that rank.
 * Ties in `pValue` are broken by the input order becoming the sort's own stable order — the exact
 * survivor SET is unaffected by which of two tied candidates sorts first, since both are either
 * below or above the same cutoff rank's threshold together in the typical case, and even where a tie
 * straddles the cutoff, standard BH takes the RANK cutoff on the sorted p-values themselves, not a
 * per-candidate tie-break rule of its own.
 */
export function benjaminiHochberg(entries: readonly PValueEntry[], q: number): ReadonlySet<string> {
  const m = entries.length;
  if (m === 0) return new Set();

  const sorted = [...entries].sort((a, b) => a.pValue - b.pValue);
  let cutoffRank = 0;
  for (let index = 0; index < m; index += 1) {
    const rank = index + 1;
    if (sorted[index]!.pValue <= (rank / m) * q) cutoffRank = rank;
  }
  return new Set(sorted.slice(0, cutoffRank).map((entry) => entry.id));
}

// ---------------------------------------------------------------------------------------------
// Population building — pure, given already-fetched season rows.
// ---------------------------------------------------------------------------------------------

/** One player's discovery facts and actuals for one season — `scripts/discover-laws.ts`'s own
 *  output shape, built ONCE per season (batched across every candidate, the same way
 *  `buildPopulations` batches `factsForSeason` across the six tribal laws) and handed to every
 *  candidate's population builder unchanged. `pointsPerGame` is read the identical
 *  `factsForSeason`-gated way `populations.ts` reads it for the tribal laws; `nextPointsPerGame` is
 *  read through `populations.ts`'s own exported `actualPointsPerGame` — the "same actuals discipline"
 *  Task 7's brief requires reusing rather than reimplementing. */
export interface DiscoverySeasonRow {
  readonly playerId: string;
  readonly season: number;
  readonly position: LawPosition;
  readonly facts: DiscoveryFacts;
  readonly pointsPerGame: number;
  readonly nextPointsPerGame: number | null;
}

/**
 * One candidate's `PlayerSeasonPoint` population, built from already-fetched rows: every row whose
 * position matches the candidate's own, with the candidate's OWN tri-state condition evaluated
 * against that row's facts — a `null` condition drops the row entirely (the identical "no evidence is
 * not false" rule `buildPopulations` applies to the six tribal laws). Sorted through
 * `canonicalPointOrder` (`populations.ts`) before returning, the SAME determinism anchor every other
 * law population goes through, so a re-ingest that changes nothing about who played cannot move a
 * discovered candidate's matched pairs or bootstrap draws either.
 */
export function populationForCandidate(candidate: CandidateLaw, rows: readonly DiscoverySeasonRow[]): readonly PlayerSeasonPoint[] {
  const points: PlayerSeasonPoint[] = [];
  for (const row of rows) {
    if (row.position !== candidate.position) continue;
    const condition = candidate.condition(row.facts);
    if (condition === null) continue;
    points.push({
      playerId: row.playerId,
      season: row.season,
      position: row.position,
      pointsPerGame: row.pointsPerGame,
      nextPointsPerGame: row.nextPointsPerGame,
      matchKey: row.pointsPerGame,
      condition,
    });
  }
  return [...points].sort(canonicalPointOrder);
}

function matchedPairsFor(candidate: CandidateLaw, population: readonly PlayerSeasonPoint[]): readonly MatchedPair[] {
  return matchedPairsStratified(population, POINTS_PER_GAME_CALIPER, (point) => stratumKeyFor({ position: candidate.position }, point));
}

// ---------------------------------------------------------------------------------------------
// Per-candidate measurement.
// ---------------------------------------------------------------------------------------------

/** A candidate's train-window screening result — `null` means UNTESTABLE (zero matched pairs on the
 *  train window; step 1 of this module's own docblock). */
export interface TrainScreenResult {
  readonly pValue: number;
  readonly expectedSign: -1 | 1;
  readonly trainEffect: number;
}

/** Step 1 + step 2 of the pipeline, for one candidate: build its train-window population, match it,
 *  and — if it matched at least one pair — compute its two-sided p-value and derived sign. Returns
 *  `null` (untestable) rather than throwing when the train window matched zero pairs, so
 *  `runDiscoveryPipeline` can count it and move on rather than aborting the whole trial. */
export function measureCandidateOnTrain(candidate: CandidateLaw, trainRows: readonly DiscoverySeasonRow[]): TrainScreenResult | null {
  const population = populationForCandidate(candidate, trainRows);
  const pairs = matchedPairsFor(candidate, population);
  if (pairs.length === 0) return null;

  const { effect, se } = bootstrapStatistics(pairs);
  return { pValue: twoSidedPValue(effect, se), expectedSign: signOf(effect), trainEffect: effect };
}

/** One BH survivor's fold effects — a PARTITION of its own full-window matched pairs by predictor
 *  season, the identical "no second match, just filter the pairs already built" discipline
 *  `scripts/measure-laws.ts`'s own `foldEffectsFor` uses for the six tribal laws (see that script's
 *  header for why this is safe: stratified matching keys on season, so a pair's two sides already
 *  share one). */
function foldEffectsFor(pairs: readonly MatchedPair[]): readonly FoldEffect[] {
  return REPLICATION_FOLDS.map((season) => {
    const foldPairs = pairs.filter((pair) => pair.condition.season === season);
    return { season, effect: foldPairs.length === 0 ? null : measureEffect(foldPairs).effect };
  });
}

/** Step 4 + step 5 of the pipeline, for one BH survivor: full-window measurement, fold effects, and
 *  the verdict `verdictForDiscoveredLaw` computes from them. `measureEffect` is left to throw
 *  uncaught here — see this module's own docblock for why that is a real-bug signal at this stage,
 *  unlike the train stage. */
export function measureCandidateFullWindow(
  candidate: CandidateLaw,
  fullRows: readonly DiscoverySeasonRow[],
  expectedSign: -1 | 1,
  seasonsLabel: string,
): { readonly measurement: LawMeasurement; readonly foldEffects: readonly FoldEffect[]; readonly verdict: LawVerdict } {
  const population = populationForCandidate(candidate, fullRows);
  const pairs = matchedPairsFor(candidate, population);
  const fullWindow = measureEffect(pairs);
  const measurement: LawMeasurement = { ...fullWindow, seasons: seasonsLabel };
  const foldEffects = foldEffectsFor(pairs);
  const verdict = verdictForDiscoveredLaw(measurement, expectedSign, foldEffects);
  return { measurement, foldEffects, verdict };
}

// ---------------------------------------------------------------------------------------------
// The whole trial.
// ---------------------------------------------------------------------------------------------

/**
 * THE WHOLE DISCOVERY TRIAL, pure given `rows` (every season's `DiscoverySeasonRow`s, TRAIN and FULL
 * windows both — `trainSeasonMax` is where this function itself draws the line, the same
 * "gate lives where the read happens, not where the caller remembers to filter" discipline
 * `computeQuantileTable` applies to the quantile fit). Runs every one of `candidates` through the
 * five-step pipeline this module's own docblock describes, and returns the exact `DiscoveredJson`
 * shape `scripts/discover-laws.ts` writes to `discovered.json` — deterministic end to end (same
 * candidates, same rows, same seeded bootstrap in, byte-identical counts and entries out), which is
 * what makes `laws:discover -- --check` a meaningful drift guard.
 */
export function runDiscoveryPipeline(
  candidates: readonly CandidateLaw[],
  rows: readonly DiscoverySeasonRow[],
  trainSeasonMax: number,
  seasonsLabel: string,
): DiscoveredJson {
  const trainRows = rows.filter((row) => row.season <= trainSeasonMax);

  let untestable = 0;
  const testable: { readonly candidate: CandidateLaw; readonly pValue: number; readonly expectedSign: -1 | 1 }[] = [];
  for (const candidate of candidates) {
    const result = measureCandidateOnTrain(candidate, trainRows);
    if (result === null) {
      untestable += 1;
      continue;
    }
    testable.push({ candidate, pValue: result.pValue, expectedSign: result.expectedSign });
  }

  const survivorIds = benjaminiHochberg(
    testable.map(({ candidate, pValue }) => ({ id: candidate.id, pValue })),
    BH_Q,
  );
  const survivors = testable.filter(({ candidate }) => survivorIds.has(candidate.id));

  const laws: Record<string, DiscoveredEntry> = {};
  let replicated = 0;
  for (const { candidate, expectedSign } of survivors) {
    const { measurement, foldEffects, verdict } = measureCandidateFullWindow(candidate, rows, expectedSign, seasonsLabel);
    if (verdict === "confirmed") replicated += 1;
    laws[candidate.id] = {
      effect: measurement.effect,
      ci: measurement.ci,
      sample: measurement.sample,
      seasons: measurement.seasons,
      foldEffects,
      verdict,
      origin: "discovered",
      position: candidate.position,
      template: candidate.template,
      claim: renderSignedClaim(candidate.claimParts, expectedSign),
      expectedSign,
    };
  }

  return {
    counts: { tested: candidates.length, untestable, bhSurvivors: survivors.length, replicated },
    laws,
  };
}
