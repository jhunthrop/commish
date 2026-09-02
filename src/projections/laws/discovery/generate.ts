import type { DiscoveryFacts } from "../discovery-facts";
import type { LawPosition } from "../populations";
import type { Law } from "../types";
import { DISCOVERY_QUANTILES } from "./quantiles";
import {
  QUANTILE_LEVELS,
  QUANTILE_TAG,
  QUANTITY_DEFS,
  sideOf,
  type AndClause,
  type ClaimParts,
  type Clause,
  type DeltaClause,
  type QuantileLevel,
  type QuantileSide,
  type QuantileTable,
  type QuantityDef,
  type ThresholdClause,
} from "./templates";

/**
 * THE CANDIDATE GENERATOR — every testable condition Task 7's discovery harness will grade under FDR
 * control, built mechanically from `templates.ts`'s vocabulary and a committed quantile table.
 *
 * WHY `generateCandidates` TAKES NO ARGUMENTS, even though the math inside is a pure function of a
 * quantile table. Task 7 imports it by this exact zero-arg signature. The table itself is fitted
 * ONCE, offline, from TRAIN predictor seasons only (`scripts/discovery-quantile-fit.ts`, the same
 * committed-constant pattern `preseason-fit.ts` and `projection-fit.ts` already use) and committed
 * to the sibling `./quantiles.ts` — so this module's dependency on the database is not merely
 * narrow, it is ZERO: importing it touches no network and no filesystem beyond its own committed
 * sibling. `generateCandidatesFrom` underneath is the actual pure function, same input always
 * producing the same output, and it is what every test in this file calls, with a small synthetic
 * quantile table rather than the real ~37-entry one — so a test is about the TEMPLATE LOGIC, never
 * about what a real fit happened to measure the last time someone ran it.
 */

export type CandidateTemplate = "threshold" | "delta" | "and";

/** One candidate law: a testable condition, its rendered claim, and nothing about its effect — no
 *  `expectedSign`, because the generator has not measured anything yet (Task 7 does that). */
export interface CandidateLaw {
  readonly id: string;
  readonly position: Law["position"];
  readonly template: CandidateTemplate;
  readonly condition: (facts: DiscoveryFacts) => boolean | null;
  readonly claimParts: ClaimParts;
}

/**
 * THE HARD CAP. Never exceeded by returning MORE than this many candidates — see `enforceCap`'s own
 * docblock for what happens if the structural design below ever produces more.
 *
 * RAISED FROM 2,000 TO 3,000 (Task 3, the vegas-laws plan), deliberately and once. Two quantities
 * joined the vocabulary that round, and the AND family grows QUADRATICALLY in the threshold-single
 * count: 1,737 candidates became 2,487, which the old cap would have trimmed. That trim is not a
 * neutral subsample — `enforceCap`'s own docblock says so in bold — and at 2,000 it would have kept
 * AND candidates alone ("and:" sorts before "delta:" and "threshold:") and silently dropped EVERY
 * single-condition candidate in the family, including the four confirmed laws' own ids. A cap that
 * would delete the existing evidence rather than bound it is the wrong number, not a constraint to
 * respect.
 *
 * WHAT THE CAP IS AND IS NOT. It is a determinism-and-bias guard on the generator, plus a bound on
 * how long a run takes. It is NOT the multiple-comparisons control: that is Benjamini-Hochberg at
 * q=0.10 over the testable family (`discovery/measure.ts`), which grows STRICTER as the family
 * grows, never looser. Raising the cap therefore cannot make a candidate easier to confirm; it makes
 * every candidate harder, which is the honest cost of a wider vocabulary and exactly the cost the
 * plan asked to be paid in the open. 3,000 leaves the current 2,487 real headroom without inviting
 * an unbounded vocabulary: the next expansion faces this same explicit decision rather than
 * discovering a silent trim in its output.
 *
 * RAISED AGAIN, FROM 3,000 TO 6,000 (Task 2, the discovery-expansion plan) — and the paragraph above
 * is exactly why this number is stated rather than discovered. This round doubled the quantile levels
 * (a LOW band mirroring the high one) and added five quantities, which the family-size projection in
 * that task's report puts near 4,800 candidates once the quantile table is refitted at the new
 * levels. 6,000 clears that with headroom and leaves the trim unfired, which is the only state in
 * which `enforceCap`'s id-order bias is harmless. It is deliberately NOT the projection plus a
 * handful: a cap that tracks the family exactly would fire on the first refit that happens to cover
 * one more position than the last one did.
 */
export const CANDIDATE_CAP = 6000;

/** Three-valued (Kleene) AND: `false` wins over `null` (an antecedent already known to fail makes the
 *  whole AND false regardless of the other half being unknown), but `null` wins over `true` (a known
 *  true half cannot rescue an unknown one). Matches the brief's own statement of the rule verbatim. */
function kleeneAnd(a: boolean | null, b: boolean | null): boolean | null {
  if (a === false || b === false) return false;
  if (a === null || b === null) return null;
  return true;
}


/** Deterministic id from a clause's own structure — never a counter, a hash, or a random suffix, so
 *  the same candidate gets the same id on every run and a stable id-sort (`sortById`) is possible. */
function idFor(position: LawPosition, clause: Clause): string {
  switch (clause.kind) {
    case "threshold":
      return `threshold:${position}:${clause.quantityId}:${QUANTILE_TAG[clause.quantileLevel]}`;
    case "delta":
      return `delta:${position}:${clause.quantityId}:${QUANTILE_TAG[clause.quantileLevel]}:${clause.direction}`;
    case "and": {
      const left = idFor(position, clause.left);
      const right = idFor(position, clause.right);
      const [first, second] = left < right ? [left, right] : [right, left];
      return `and:${position}:${first}+${second}`;
    }
  }
}

/**
 * IN-BAND, the one predicate both single templates are built from: at or ABOVE the mark on the high
 * band, at or BELOW it on the low band. Written once, here, so a threshold candidate and the delta
 * candidates over the same (quantity, position, level) can never disagree about where the band's
 * edge is or which side of it a player sits on — the delta templates below are defined purely as
 * "was he in the band last season, is he in it this season", never as their own inequalities.
 *
 * BOTH BANDS ARE CLOSED AT THE MARK (`>=` high, `<=` low). A player exactly ON a threshold is IN the
 * band either way, which is the reading `renderSignedClaim` states in words ("is 9.0 or more", "is
 * 6.0 or less") and the one `formatValue`'s rounding direction is chosen to keep honest.
 */
function isInBand(value: number, threshold: number, side: QuantileSide): boolean {
  return side === "high" ? value >= threshold : value <= threshold;
}

function thresholdConditionOf(def: QuantityDef, threshold: number, side: QuantileSide): (facts: DiscoveryFacts) => boolean | null {
  return (facts) => {
    const value = def.get(facts.current);
    return value === null ? null : isInBand(value, threshold, side);
  };
}

/**
 * A CROSSING, expressed as a change of band membership between season N-1 and season N.
 *
 * `direction` names the VALUE's own motion (`DeltaClause`'s docblock), which on the high band means
 * `rose_into` enters the band and on the low band means `rose_into` LEAVES it. Deriving both from
 * `isInBand` rather than writing four inequalities keeps that inversion in one place and makes the
 * high-side behaviour provably unchanged: for `side === "high"`, `rose_into` is still
 * `prior < threshold && current >= threshold`, and `fell_out_of` still its complement pair.
 */
function deltaConditionOf(
  def: QuantityDef, threshold: number, side: QuantileSide, direction: DeltaClause["direction"],
): (facts: DiscoveryFacts) => boolean | null {
  const enters = (side === "high") === (direction === "rose_into");
  return (facts) => {
    const current = def.get(facts.current);
    const prior = facts.prior === null ? null : def.get(facts.prior);
    if (current === null || prior === null) return null;
    const wasIn = isInBand(prior, threshold, side);
    const isIn = isInBand(current, threshold, side);
    return enters ? !wasIn && isIn : wasIn && !isIn;
  };
}

function sortById(candidates: readonly CandidateLaw[]): readonly CandidateLaw[] {
  return [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * THE CAP, ENFORCED DETERMINISTICALLY — never by random sampling. If the naive cross product below
 * (threshold x delta x AND-pairs) ever exceeds `CANDIDATE_CAP` as new quantities are added, the
 * overflow is trimmed by keeping the first `CANDIDATE_CAP` candidates in canonical id order, which
 * is reproducible: the same candidate set always produces the same kept subset, unlike a random
 * sample that would depend on a seed nobody could recover from the committed output alone.
 *
 * TODAY'S STRUCTURAL DESIGN STAYS WELL UNDER THE CAP WITHOUT EVER REACHING THIS TRIM (see the
 * AND-pair restriction in `generateCandidatesFrom`'s own docblock), so this function is exercised by
 * a dedicated unit test with a synthetic oversized list rather than by the real candidate set.
 *
 * NOT A NEUTRAL SAMPLE IF IT EVER FIRES: ascending id order is a mechanical property of the
 * template (family name, then position, then quantity id, then quantile), not a random or
 * effect-weighted draw, so a real overflow would systematically favor candidates whose ids happen to
 * sort first (e.g. every "and:" id before any "threshold:" one, alphabetically) rather than sampling
 * the design space evenly — acceptable only because today's design keeps this trim from ever firing
 * in production; a future vocabulary expansion that relies on it regularly should reconsider the
 * trim strategy (e.g. keep-N-per-template-family) rather than assume this bias is harmless at scale.
 */
export function enforceCap(candidates: readonly CandidateLaw[], cap: number): readonly CandidateLaw[] {
  const ordered = sortById(candidates);
  return ordered.length <= cap ? ordered : ordered.slice(0, cap);
}

interface ThresholdSingle {
  readonly def: QuantityDef;
  readonly level: QuantileLevel;
  readonly clause: ThresholdClause;
  readonly id: string;
  readonly condition: (facts: DiscoveryFacts) => boolean | null;
}

/**
 * THE PURE GENERATOR — same `quantiles` in, same candidates out, always. Three template families:
 *
 *   - THRESHOLD: one candidate per (quantity, eligible position, quantile level) the table has data
 *     for — the quantity is at or above its train-window quantile mark on the HIGH band, at or below
 *     it on the LOW one.
 *   - DELTA: the same (quantity, position, level) triples, twice each — the value crossed the mark
 *     upward, or downward — needing `facts.prior`. On the high band those read as entering and
 *     leaving the top band; on the low band the same two motions read as leaving and entering the
 *     bottom one (`DeltaClause`'s own docblock).
 *   - AND: pairwise ANDs of two THRESHOLD candidates on DISTINCT quantities within the same
 *     position. THIS IS THE DOCUMENTED PRUNING RULE the brief asks for: an AND of every single
 *     condition (threshold and delta both, same-quantity pairs included) would multiply the count by
 *     roughly the single-condition count per position, which at thirteen quantities across four
 *     positions clears the cap by a wide margin. Restricting AND-pairs to threshold-only,
 *     distinct-quantity combinations is a structural choice made ONCE here, not a random subsample
 *     applied after the fact — the same candidate set is produced on every run, deterministically,
 *     and stays under the cap without `enforceCap` ever needing to trim it (see that function's own
 *     docblock, and `generate.test.ts`'s cap test, which exercises the trim directly with synthetic
 *     data rather than waiting for the real vocabulary to grow past the line).
 *
 * THE AND FAMILY IS HIGH-SIDE ONLY (Task 2, the discovery-expansion plan), and this is the second
 * deliberate pruning rule rather than an oversight. AND is the one family that grows QUADRATICALLY
 * in the single count and MULTIPLICATIVELY in the level count: admitting the low band on both halves
 * would take its level combinations from nine to thirty-six and, at the vocabulary this round lands,
 * would add roughly eleven thousand candidates to a family of under five thousand. Benjamini-Hochberg
 * divides by exactly that number, so the whole family — the twelve laws already discovered included —
 * would pay three times over for a shape nothing in the plan asked for. What the plan DID ask for is
 * the founder's collapse hypothesis, and that is a SINGLE low-side threshold ("his team's win total
 * is in the bottom band"), which the threshold and delta families above state directly.
 *
 * REVERSIBLE, AND ORDERED ON PURPOSE: the low side proves itself on singles first, where it costs
 * about a thousand candidates, and a later round can spend the AND family on it knowing whether the
 * low band carries signal at all. The report accompanying this task carries the projected counts for
 * both the same-side and the fully-mixed AND alternatives, so that decision is a number, not a guess.
 */
export function generateCandidatesFrom(quantiles: QuantileTable): readonly CandidateLaw[] {
  const thresholdCandidates: CandidateLaw[] = [];
  const deltaCandidates: CandidateLaw[] = [];
  const highSideSinglesByPosition = new Map<LawPosition, ThresholdSingle[]>();

  for (const def of QUANTITY_DEFS) {
    for (const position of def.positions) {
      const thresholdsForPosition = quantiles[def.id]?.[position];
      if (thresholdsForPosition === undefined) continue;

      // DEGENERATE-LEVEL DEDUPE, per band. Two levels of the same band can fit the SAME number for a
      // quantity with mass at a point (the committed table has three today, all
      // `incomingCoachTenureSeasons` at q70 = q80 = 2, and the low band will have more: a share whose
      // 10th and 20th percentiles are both zero). Two candidates whose conditions are byte-identical
      // predicates are not two hypotheses — they are one hypothesis charged twice to the family that
      // Benjamini-Hochberg divides by, and if it survives they become two `discovered.json` entries
      // with the same effect and, since `renderTitle` prints the value, the same heading. The first
      // level in `QUANTILE_LEVELS`' declared order wins, deterministically; the later duplicates
      // produce no candidates in any template family.
      const seenThresholdsBySide = new Map<QuantileSide, Set<number>>();

      for (const level of QUANTILE_LEVELS) {
        // A level the table does not carry (see `QuantileThresholds`' own docblock: a committed table
        // fitted before a level existed). Skipped rather than read as `undefined`, which would build
        // a candidate whose condition is false for every player who ever lived.
        const threshold = thresholdsForPosition[level];
        if (threshold === undefined) continue;

        const side = sideOf(level);
        const seen = seenThresholdsBySide.get(side) ?? new Set<number>();
        seenThresholdsBySide.set(side, seen);
        if (seen.has(threshold)) continue;
        seen.add(threshold);

        const thresholdClause: ThresholdClause = { kind: "threshold", quantityId: def.id, quantileLevel: level };
        const thresholdId = idFor(position, thresholdClause);
        const thresholdConditionFn = thresholdConditionOf(def, threshold, side);

        // THE MATCH-KEY EXCLUSION (`QuantityDef.isMatchKeyQuantity`, whose docblock carries the
        // proof): a LEVEL condition on the quantity the matched design pairs players by makes every
        // condition row outrank every control row on the match key, so the measured effect is a
        // property of the matcher rather than of the claim. Such a quantity produces DELTA candidates
        // only. Read off the quantity, never branched on an id, exactly as the year-over-year
        // exclusion below is.
        if (!def.isMatchKeyQuantity) {
          thresholdCandidates.push({
            id: thresholdId,
            position,
            template: "threshold",
            condition: thresholdConditionFn,
            claimParts: { position, clause: thresholdClause },
          });
          // AND-pairs are built from HIGH-side singles only — see `generateCandidatesFrom`'s own
          // docblock for the pruning rule and what the low-side AND family would have cost.
          if (side === "high") {
            const singles = highSideSinglesByPosition.get(position) ?? [];
            singles.push({ def, level, clause: thresholdClause, id: thresholdId, condition: thresholdConditionFn });
            highSideSinglesByPosition.set(position, singles);
          }
        }

        // A quantity that is ITSELF a difference, or that is a career constant, declares that it has
        // no meaningful year-over-year template (`QuantityDef.supportsYearOverYearDelta`,
        // `templates.ts`) and produces threshold and AND candidates only. Read off the quantity
        // rather than branched on an id here, so the three template families stay mechanical.
        if (!def.supportsYearOverYearDelta) continue;
        for (const direction of ["rose_into", "fell_out_of"] as const) {
          const deltaClause: DeltaClause = { kind: "delta", quantityId: def.id, quantileLevel: level, direction };
          deltaCandidates.push({
            id: idFor(position, deltaClause),
            position,
            template: "delta",
            condition: deltaConditionOf(def, threshold, side, direction),
            claimParts: { position, clause: deltaClause },
          });
        }
      }
    }
  }

  const andCandidates: CandidateLaw[] = [];
  for (const [position, singles] of highSideSinglesByPosition) {
    for (let i = 0; i < singles.length; i++) {
      for (let j = i + 1; j < singles.length; j++) {
        const left = singles[i]!;
        const right = singles[j]!;
        if (left.def.id === right.def.id) continue; // distinct quantities only — the pruning rule.
        const andClause: AndClause = { kind: "and", left: left.clause, right: right.clause };
        andCandidates.push({
          id: idFor(position, andClause),
          position,
          template: "and",
          condition: (facts) => kleeneAnd(left.condition(facts), right.condition(facts)),
          claimParts: { position, clause: andClause },
        });
      }
    }
  }

  return enforceCap([...thresholdCandidates, ...deltaCandidates, ...andCandidates], CANDIDATE_CAP);
}

export function generateCandidates(): readonly CandidateLaw[] {
  return generateCandidatesFrom(DISCOVERY_QUANTILES);
}
