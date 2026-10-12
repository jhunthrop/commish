import { matchedPairsStratified, measureEffect, bootstrapStatistics, type MatchedPair } from "../harness";
import { canonicalPointOrder, POINTS_PER_GAME_CALIPER, type LawPosition } from "../populations";
import {
  foldEffectsFor,
  stratumKeyFor,
  verdictForDiscoveredLaw,
  type DiscoveredEntry,
  type DiscoveredJson,
  type FoldEffect,
} from "../registry";
import type { LawMeasurement, LawVerdict, PlayerSeasonPoint } from "../types";
import type { DiscoveryFacts } from "../discovery-facts";
import type { CandidateLaw } from "./generate";
import { DISCOVERY_QUANTILES } from "./quantiles";
import { primaryQuantityDefOf, renderSignedClaim } from "./templates";

/**
 * THE LAW DISCOVERY TRIAL (Task 7, 2026-08-31; fix round 1, same date) — measuring all 1,737 of
 * `discovery/generate.ts`'s mechanically generated candidates under false-discovery control, then
 * replicating the survivors on the full window, exactly the pipeline `matchedPairsStratified`/
 * `measureEffect` (`harness.ts`) and `verdictForFullWindow` (`registry.ts`) already run for the six
 * tribal laws, extended with the two new steps a 1,737-candidate family needs and a single
 * hand-picked claim never did: controlling how many "confirmed" verdicts are expected to be false
 * alarms, AND not fooling itself about which of a discovered law's own replication seasons are
 * genuinely out of sample.
 *
 * THE PIPELINE, IN ORDER:
 *
 *   1. TRAIN SCREEN, WITH A MINIMUM SAMPLE FLOOR. Every candidate's train-window population
 *      (`DISCOVERY_TRAIN_SEASONS`, 2003-2021 since the 2026-09-01 window extension — see `config.ts`'s own docblock for why discovery's
 *      window stops short of `MEASURE_SEASONS`) is matched the identical stratified way a tribal law
 *      is (`matchedPairsStratified`, keyed by `stratumKeyFor` — a discovered candidate is always a
 *      single concrete position, never `"all"`, so this reduces to season-only stratification).
 *      `measureCandidateOnTrain` PRE-CHECKS the matched pair count against `MIN_TRAIN_PAIRS` (20)
 *      BEFORE ever calling `bootstrapStatistics` — a narrow AND-of-two-quantiles condition can easily
 *      match nobody, or next to nobody, on nine train seasons, and both are reported UNTESTABLE
 *      (excluded from the BH family, never counted as a non-survivor — a candidate that never had
 *      enough evidence to screen was never in a position to survive or fail one). This is a
 *      PRE-CHECK, not a caught throw: `bootstrapStatistics` itself still throws on exactly zero
 *      pairs (see `harness.ts`), but this module never lets that throw fire, because it screens the
 *      pair COUNT first and `bootstrapStatistics` is only ever called once that count already clears
 *      the floor.
 *
 *      WHY A FLOOR AT ALL (fix round, CRITICAL 1): the bootstrap standard error `bootstrapStatistics`
 *      returns is the standard deviation of 1,000 seeded resample MEANS. With a handful of pairs —
 *      one, in the worst case — every resample draws the SAME pair over and over (resampling with
 *      replacement from a pool of one has nowhere else to go), so every resample mean is identical
 *      and `se` comes back EXACTLY zero regardless of how large the point estimate is. A p-value
 *      computed from a zero standard error is not "very significant" — it is UNDEFINED, and the one
 *      honest response is to refuse to test the candidate at all, never to score it. 20 pairs is
 *      comfortably past the point where a real (non-degenerate) population can produce `se === 0` by
 *      chance; `measureCandidateOnTrain` ALSO refuses to test a candidate whose bootstrap somehow
 *      still returns `se === 0` even above that floor (a genuinely degenerate population, every
 *      matched pair sharing the identical difference) — see that function's own comment.
 *
 *   2. SIGN DERIVATION. A candidate never asserts a sign (`generate.ts`'s own docblock: "no expected
 *      sign... the generator has not measured anything yet"). `signOf` reads it straight off the
 *      train-window effect: negative effect, `expectedSign: -1`; positive or exactly zero,
 *      `expectedSign: 1` (the zero case is a coin-flip default that never actually happens with real
 *      floating-point data, not a case this pipeline expects to matter).
 *
 *   3. BENJAMINI-HOCHBERG at q=0.10, OVER THE TESTABLE FAMILY ONLY. RULING P2 (binding), REVISED
 *      (fix round, CRITICAL 2): the reference distribution is STUDENT'S T with `df = pairs - 1`, not
 *      the standard normal — `t = effect / se`, `p = I_x(df/2, 1/2)` where `x = df/(df + t^2)`
 *      (the regularized incomplete beta function; the classic closed form for a two-sided
 *      t-distribution tail probability, `betaIncompleteRegularized` below). An external review
 *      measured the normal approximation firing at roughly 9x its nominal rate at n=5 — the normal
 *      distribution's tails are too thin for a standard-error ESTIMATED from a small bootstrap
 *      sample, exactly the textbook reason Student's t exists in the first place (t accounts for the
 *      extra uncertainty in an ESTIMATED standard error the way the normal distribution, built for a
 *      KNOWN one, cannot). `MIN_TRAIN_PAIRS` = 20 keeps df >= 19 for every candidate that reaches this
 *      step, where t and the normal are already close, but "close" is not "identical", and using t
 *      throughout costs nothing (both are O(1) per candidate against 1,000 bootstrap resamples) while
 *      normal risks the exact anti-conservatism CRITICAL 2 found. A raw bootstrap resample QUANTILE
 *      RANK is still never used, for the reason the original ruling gives: at m=1,737 candidates,
 *      `q/m ≈ 0.0000576`, far below the 1/1000 granularity floor a resample-rank p-value could ever
 *      resolve, degenerating every BH comparison to a coin flip on ties.
 *
 *      BH-UNDER-PRDS, NOT BY (fix round, MINOR): Benjamini-Hochberg's own 1995 guarantee — false
 *      discovery rate at most `q` — holds unconditionally under independence and, more relevantly
 *      here, under POSITIVE REGRESSION DEPENDENCY (PRDS) among the true nulls' p-values (Benjamini &
 *      Yekutieli, 2001). This family is exactly the PRDS case: many candidates share overlapping
 *      player populations and overlapping quantities (a WR's `age` and `experienceYear` move
 *      together; an AND-pair built from two already-tested single quantities inherits both halves'
 *      correlation), so p-values are positively dependent, not independent, but never NEGATIVELY
 *      dependent in a way that would break PRDS. The stricter Benjamini-Yekutieli procedure (dividing
 *      `q` by the harmonic number `sum(1/i, i=1..m)`, roughly `ln(m) + 0.577`) controls FDR under
 *      ARBITRARY dependence, including negative dependence, but at a steep power cost this family's
 *      known-PRDS structure does not require paying.
 *
 *   4. FULL-WINDOW REPLICATION. Every BH survivor is re-measured on the FULL window (predictor
 *      seasons `MEASURE_SEASONS.from`-`MEASURE_SEASONS.to - 1`, 2003-2023 — the same window the six
 *      tribal laws use), matched the identical stratified way. `measureEffect` is left UNCAUGHT here
 *      (unlike the train stage): the full window's per-season strata for every train season are the
 *      identical rows train measurement already matched successfully, so a survivor that cleared
 *      `MIN_TRAIN_PAIRS` on the train window is guaranteed at least that many full-window pairs too —
 *      a throw at this stage would mean train and full-window population-building have silently
 *      drifted apart, a real bug worth failing loudly on, not an expected outcome the way a
 *      train-stage shortfall is.
 *
 *      ONLY 2022 AND 2023 ARE GENUINELY OUT-OF-SAMPLE FOR A DISCOVERED LAW (fix round, IMPORTANT 1
 *      RULING). `REPLICATION_FOLDS` is `[2021, 2022, 2023]`, the identical three predictor seasons a
 *      tribal law replicates on — but `DISCOVERY_TRAIN_SEASONS.to` is 2021: THIS candidate's own
 *      antecedent condition, and the quantile thresholds it was built from, were fitted using 2021 as
 *      a train season. A tribal law's antecedent is hand-picked, with no train/fit step at all, so
 *      every one of its three folds is equally out-of-sample for IT; a discovered law's 2021 fold sits
 *      INSIDE its own screen's training window, the identical "two of three folds are in-fit"
 *      situation `config.ts`'s own docblock already flags for the projection MODEL (`FIT_SEASONS`)
 *      relative to a tribal law's replication folds — the same shape of problem, one level up the
 *      pipeline, now caught for discovery too rather than only for the model it feeds.
 *
 *   5. VERDICT AND THE OUT-OF-TRAIN REPLICATION GATE. `verdictForDiscoveredLaw` (`registry.ts`) is
 *      `verdictForFullWindow`'s own CI/sign/fold-agreement rule (now with the `>= 40` full-window pair
 *      floor applied ORIGIN-BLIND to every law, tribal included — IMPORTANT 4 RULING), PLUS one more
 *      gate specific to discovery: at least one OUT-OF-TRAIN fold (2022 or 2023 — never 2021) must
 *      itself carry `>= MIN_OUT_OF_TRAIN_FOLD_PAIRS` (5) matched pairs AND agree in direction with the
 *      full-window effect (IMPORTANT 2 RULING). `FoldEffect.pairs` (new field, this fix round) is what
 *      makes that pair-count check possible without a second, separate matching pass — see
 *      `registry.ts`'s own `foldEffectsFor` (fix round 2, NEW-7: now the ONE shared implementation,
 *      imported here and by `scripts/measure-laws.ts` both, rather than duplicated between them).
 *      Only a `confirmed` verdict here means the candidate REPLICATED on
 *      evidence the discovery screen itself never trained on: BH already controlled how many false
 *      alarms are expected across the whole screened family, and this is the pipeline's confirmatory
 *      check that a specific survivor's own OUT-OF-SAMPLE evidence, not merely its in-sample evidence,
 *      is strong enough to trust.
 *
 * A BH SURVIVOR THAT FAILS REPLICATION STAYS IN `discovered.json`, with its own non-confirmed
 * verdict — the honest record of "flagged by the screen, did not hold up," never quietly dropped.
 * Only a `confirmed` entry is chip/deviation-eligible (Task 8's concern; `registry.ts`'s
 * `chipEligibleLaws` is the one predicate that flips the day that wiring lands).
 *
 * EVERYTHING IN THIS FILE IS DB-FREE AND PURE, given already-fetched `DiscoverySeasonRow`s —
 * `scripts/discover-laws.ts` owns the one DB-reading pass (`discoveryFactsForSeason`/
 * `factsForSeason`/`actualPointsPerGame`, each run ONCE per season regardless of candidate count,
 * batching the shared read the same way `buildPopulations` batches it for the six tribal laws) and
 * hands this module the resulting rows.
 */

// ---------------------------------------------------------------------------------------------
// Benjamini-Hochberg, over a two-sided Student's-t p-value (Ruling P2, revised CRITICAL 2).
// ---------------------------------------------------------------------------------------------

/** One candidate's id and its two-sided p-value — `benjaminiHochberg`'s only input shape. */
export interface PValueEntry {
  readonly id: string;
  readonly pValue: number;
}

/** The false-discovery rate this pipeline controls to. */
export const BH_Q = 0.1;

/** Below this many TRAIN matched pairs, a candidate is UNTESTABLE — never scored, never counted as a
 *  non-survivor. See this module's own docblock (step 1, CRITICAL 1) for why a floor exists at all:
 *  without one, a candidate matching a single pair gets a bootstrap standard error of exactly zero,
 *  and a p-value computed from a zero standard error is undefined, not "maximally significant". */
export const MIN_TRAIN_PAIRS = 20;

/**
 * The regularized incomplete beta function `I_x(a, b)`, via the standard continued-fraction
 * evaluation (Numerical Recipes in C, 2nd ed., §6.4) — the one piece of numerical machinery
 * `twoSidedPValue` needs to evaluate a Student's-t tail probability without a statistics dependency.
 * `logGamma` (Lanczos approximation, g=7, the widely-published 9-term coefficient set) supplies the
 * log-gamma prefactor; `betaContinuedFraction` is Lentz's algorithm for the continued fraction itself.
 * Both are standard, independently-checkable numerical methods — `measure.test.ts`'s own tests check
 * the RESULT (`twoSidedPValue`) against textbook t-table critical values, not these internals in
 * isolation, the same "check the visible number, not the machinery" discipline `harness.ts` applies
 * to its own bootstrap.
 */
function logGamma(x: number): number {
  const LANCZOS_G = 7;
  const LANCZOS_COEFFICIENTS = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // Reflection formula, for the small-x half this function never actually needs here (every real
    // call passes a/2 or 1/2 with a >= MIN_TRAIN_PAIRS - 1 >= 19, so a/2 >= 9.5) but is included so
    // the function is correct for any positive-or-above-reflection input, not narrowly special-cased.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const shifted = x - 1;
  let accumulator = LANCZOS_COEFFICIENTS[0]!;
  for (let i = 1; i < LANCZOS_G + 2; i += 1) accumulator += LANCZOS_COEFFICIENTS[i]! / (shifted + i);
  const t = shifted + LANCZOS_G + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(accumulator);
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITERATIONS = 200;
  const EPSILON = 3e-9;
  const FLOOR = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FLOOR) d = FLOOR;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITERATIONS; m += 1) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FLOOR) d = FLOOR;
    c = 1 + aa / c;
    if (Math.abs(c) < FLOOR) c = FLOOR;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FLOOR) d = FLOOR;
    c = 1 + aa / c;
    if (Math.abs(c) < FLOOR) c = FLOOR;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPSILON) break;
  }
  return h;
}

function regularizedIncompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const logBt = logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const bt = Math.exp(logBt);
  return x < (a + 1) / (a + b + 2) ? (bt * betaContinuedFraction(x, a, b)) / a : 1 - (bt * betaContinuedFraction(1 - x, b, a)) / b;
}

/**
 * The two-sided Student's-t p-value RULING P2 (revised, CRITICAL 2) requires: `t = effect / se`,
 * `p = I_x(df/2, 1/2)` where `x = df/(df + t^2)` — the standard closed form for a two-sided
 * t-distribution tail probability (Abramowitz & Stegun 26.7.1), evaluated via the regularized
 * incomplete beta function above. `se` must be POSITIVE and `df` at least 1: both are PRECONDITIONS
 * this function enforces by throwing, never by guessing a sentinel p-value — `measureCandidateOnTrain`
 * is the one caller, and it screens `se === 0` (a degenerate, zero-variance bootstrap) and
 * `pairs.length < MIN_TRAIN_PAIRS` BEFORE ever reaching this function, exactly the CRITICAL 1 fix: a
 * zero standard error must never again be silently read as "maximally significant".
 */
export function twoSidedPValue(effect: number, se: number, df: number): number {
  if (se <= 0) {
    throw new Error(
      "twoSidedPValue: se must be positive — a zero-or-negative standard error is undefined for a p-value, never significant. The caller must filter this out as untestable first.",
    );
  }
  if (df < 1) {
    throw new Error("twoSidedPValue: df must be at least 1.");
  }
  const t = effect / se;
  const x = df / (df + t * t);
  return regularizedIncompleteBeta(df / 2, 0.5, x);
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
 * per-candidate tie-break rule of its own. Valid under independence or PRDS (this module's own
 * docblock, step 3) — never under arbitrary dependence, which this family does not exhibit.
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

/** Exported (fix round) so `measure.test.ts`'s null battery drives the SAME matching call
 *  `measureCandidateOnTrain`/`measureCandidateFullWindow` use internally, rather than a parallel
 *  reimplementation — "test the pipeline, not the theorem" means the test must go through this exact
 *  function. */
export function matchedPairsFor(candidate: CandidateLaw, population: readonly PlayerSeasonPoint[]): readonly MatchedPair[] {
  return matchedPairsStratified(population, POINTS_PER_GAME_CALIPER, (point) => stratumKeyFor({ position: candidate.position }, point));
}

// ---------------------------------------------------------------------------------------------
// Per-candidate measurement.
// ---------------------------------------------------------------------------------------------

/** A candidate's train-window screening result — `null` means UNTESTABLE (fewer than
 *  `MIN_TRAIN_PAIRS` matched pairs on the train window, or a degenerate zero-variance bootstrap;
 *  step 1 of this module's own docblock). */
export interface TrainScreenResult {
  readonly pValue: number;
  readonly expectedSign: -1 | 1;
  readonly trainEffect: number;
}

/**
 * Step 1 + step 2 of the pipeline, for one candidate: build its train-window population, match it,
 * and — if it cleared `MIN_TRAIN_PAIRS` AND its bootstrap standard error came back positive — compute
 * its two-sided Student's-t p-value and derived sign. Returns `null` (untestable) rather than
 * throwing in EITHER shortfall case, so `runDiscoveryPipeline` can count it and move on rather than
 * aborting the whole trial.
 *
 * BOTH CHECKS ARE PRE-CHECKS, NEVER A CAUGHT THROW (fix round, MINOR — an earlier docblock here said
 * "catches it", which was never true: `bootstrapStatistics` is only ever called once
 * `pairs.length >= MIN_TRAIN_PAIRS` already holds, so its own zero-pairs throw can never fire from
 * this function, and there is nothing to catch). The `se === 0` check after the bootstrap call is
 * the CRITICAL 1 fix itself: a degenerate population (every matched pair sharing the identical
 * before/after difference — vanishingly unlikely with real data at 20+ pairs, but not impossible)
 * must be excluded, never scored as `p = 0`.
 */
export function measureCandidateOnTrain(candidate: CandidateLaw, trainRows: readonly DiscoverySeasonRow[]): TrainScreenResult | null {
  const population = populationForCandidate(candidate, trainRows);
  const pairs = matchedPairsFor(candidate, population);
  if (pairs.length < MIN_TRAIN_PAIRS) return null;

  const { effect, se } = bootstrapStatistics(pairs);
  if (se === 0) return null;

  const df = pairs.length - 1;
  return { pValue: twoSidedPValue(effect, se, df), expectedSign: signOf(effect), trainEffect: effect };
}

/** Step 4 + step 5 of the pipeline, for one BH survivor: full-window measurement, fold effects, and
 *  the verdict `verdictForDiscoveredLaw` computes from them (CI/sign/fold-agreement, the origin-blind
 *  `>= 40` pair floor, AND the out-of-train fold gate — see `registry.ts`'s own docblock for the full
 *  rule). `measureEffect` is left to throw uncaught here — see this module's own docblock for why
 *  that is a real-bug signal at this stage, unlike the train stage. */
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
 *
 * `renderSignedClaim` is called with the COMMITTED `DISCOVERY_QUANTILES` table — the same table
 * `generateCandidates()` built every candidate FROM — so a survivor's claim states the actual
 * committed threshold, never a re-derived or re-guessed number.
 */
export function runDiscoveryPipeline(
  candidates: readonly CandidateLaw[],
  rows: readonly DiscoverySeasonRow[],
  trainSeasonMax: number,
  seasonsLabel: string,
): DiscoveredJson {
  const trainRows = rows.filter((row) => row.season <= trainSeasonMax);

  let untestable = 0;
  const testable: { readonly candidate: CandidateLaw; readonly pValue: number; readonly expectedSign: -1 | 1; readonly trainEffect: number }[] = [];
  for (const candidate of candidates) {
    const result = measureCandidateOnTrain(candidate, trainRows);
    if (result === null) {
      untestable += 1;
      continue;
    }
    testable.push({ candidate, pValue: result.pValue, expectedSign: result.expectedSign, trainEffect: result.trainEffect });
  }

  const survivorIds = benjaminiHochberg(
    testable.map(({ candidate, pValue }) => ({ id: candidate.id, pValue })),
    BH_Q,
  );
  const survivors = testable.filter(({ candidate }) => survivorIds.has(candidate.id));

  const laws: Record<string, DiscoveredEntry> = {};
  let replicated = 0;
  for (const { candidate, expectedSign, trainEffect } of survivors) {
    const { measurement, foldEffects, verdict } = measureCandidateFullWindow(candidate, rows, expectedSign, seasonsLabel);
    if (verdict === "confirmed") replicated += 1;
    // The candidate's own PRESENTATION data (Task 8 fix round) — written here, once, so a client
    // bundle (`ReasonChip`) never needs to import `generateCandidates()` or `templates.ts` itself to
    // build a discovered law's headline. See `primaryQuantityDefOf`'s own docblock for the "primary
    // = the AND clause's left half" rule this reads.
    const primaryQuantityDef = primaryQuantityDefOf(candidate.claimParts.clause);
    laws[candidate.id] = {
      effect: measurement.effect,
      // trainEffect (C1 fix round) is CARRIED STRAIGHT THROUGH from `measureCandidateOnTrain`'s own
      // step-1 result, never recomputed here: it is the identical `DISCOVERY_TRAIN_SEASONS`-bounded
      // measurement `trainEffectFor` would produce, and this pipeline already paid for one bootstrap
      // pass to get it — a second call would burn 1,000 more seeded resamples for the same number.
      trainEffect,
      ci: measurement.ci,
      sample: measurement.sample,
      seasons: measurement.seasons,
      foldEffects,
      verdict,
      origin: "discovered",
      position: candidate.position,
      template: candidate.template,
      claim: renderSignedClaim(candidate.claimParts, expectedSign, DISCOVERY_QUANTILES),
      expectedSign,
      primaryQuantityId: primaryQuantityDef.id,
      primaryQuantityNoun: primaryQuantityDef.shortLabel,
      primaryQuantityUnit: primaryQuantityDef.magnitudeUnit,
    };
  }

  return {
    counts: { candidates: candidates.length, untestable, bhSurvivors: survivors.length, replicated },
    laws,
  };
}
