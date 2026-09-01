import type { DiscoveryFacts } from "../discovery-facts";
import type { LawPosition } from "../populations";
import type { Law } from "../types";
import { DISCOVERY_QUANTILES } from "./quantiles";
import {
  QUANTILE_LEVELS,
  QUANTITY_DEFS,
  type AndClause,
  type ClaimParts,
  type Clause,
  type DeltaClause,
  type QuantileLevel,
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
 */
export const CANDIDATE_CAP = 2000;

/** Three-valued (Kleene) AND: `false` wins over `null` (an antecedent already known to fail makes the
 *  whole AND false regardless of the other half being unknown), but `null` wins over `true` (a known
 *  true half cannot rescue an unknown one). Matches the brief's own statement of the rule verbatim. */
function kleeneAnd(a: boolean | null, b: boolean | null): boolean | null {
  if (a === false || b === false) return false;
  if (a === null || b === null) return null;
  return true;
}

const QUANTILE_TAG: Readonly<Record<QuantileLevel, string>> = { 0.7: "q70", 0.8: "q80", 0.9: "q90" };

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

function thresholdConditionOf(def: QuantityDef, threshold: number): (facts: DiscoveryFacts) => boolean | null {
  return (facts) => {
    const value = def.get(facts.current);
    return value === null ? null : value >= threshold;
  };
}

function deltaConditionOf(def: QuantityDef, threshold: number, direction: DeltaClause["direction"]): (facts: DiscoveryFacts) => boolean | null {
  return (facts) => {
    const current = def.get(facts.current);
    const prior = facts.prior === null ? null : def.get(facts.prior);
    if (current === null || prior === null) return null;
    return direction === "rose_into" ? prior < threshold && current >= threshold : prior >= threshold && current < threshold;
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
 *     for — the quantity is at or above its train-window quantile mark.
 *   - DELTA: the same (quantity, position, level) triples, twice each — crossed UP into the top band
 *     from below it the year before, or crossed DOWN out of it — needing `facts.prior`.
 *   - AND: pairwise ANDs of two THRESHOLD candidates on DISTINCT quantities within the same
 *     position. THIS IS THE DOCUMENTED PRUNING RULE the brief asks for: an AND of every single
 *     condition (threshold and delta both, same-quantity pairs included) would multiply the count by
 *     roughly the single-condition count per position, which at eleven quantities across four
 *     positions clears the 2,000 cap by a wide margin. Restricting AND-pairs to threshold-only,
 *     distinct-quantity combinations is a structural choice made ONCE here, not a random subsample
 *     applied after the fact — the same candidate set is produced on every run, deterministically,
 *     and stays under the cap without `enforceCap` ever needing to trim it (see that function's own
 *     docblock, and `generate.test.ts`'s cap test, which exercises the trim directly with synthetic
 *     data rather than waiting for the real vocabulary to grow past the line).
 */
export function generateCandidatesFrom(quantiles: QuantileTable): readonly CandidateLaw[] {
  const thresholdCandidates: CandidateLaw[] = [];
  const deltaCandidates: CandidateLaw[] = [];
  const thresholdSinglesByPosition = new Map<LawPosition, ThresholdSingle[]>();

  for (const def of QUANTITY_DEFS) {
    for (const position of def.positions) {
      const thresholdsForPosition = quantiles[def.id]?.[position];
      if (thresholdsForPosition === undefined) continue;

      for (const level of QUANTILE_LEVELS) {
        const threshold = thresholdsForPosition[level];

        const thresholdClause: ThresholdClause = { kind: "threshold", quantityId: def.id, quantileLevel: level };
        const thresholdId = idFor(position, thresholdClause);
        const thresholdConditionFn = thresholdConditionOf(def, threshold);
        thresholdCandidates.push({
          id: thresholdId,
          position,
          template: "threshold",
          condition: thresholdConditionFn,
          claimParts: { position, clause: thresholdClause },
        });
        const singles = thresholdSinglesByPosition.get(position) ?? [];
        singles.push({ def, level, clause: thresholdClause, id: thresholdId, condition: thresholdConditionFn });
        thresholdSinglesByPosition.set(position, singles);

        for (const direction of ["rose_into", "fell_out_of"] as const) {
          const deltaClause: DeltaClause = { kind: "delta", quantityId: def.id, quantileLevel: level, direction };
          deltaCandidates.push({
            id: idFor(position, deltaClause),
            position,
            template: "delta",
            condition: deltaConditionOf(def, threshold, direction),
            claimParts: { position, clause: deltaClause },
          });
        }
      }
    }
  }

  const andCandidates: CandidateLaw[] = [];
  for (const [position, singles] of thresholdSinglesByPosition) {
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
