import { describe, expect, it } from "vitest";
import type { BoardReason } from "../preseason/board";
import { lawReasonsFor, magnitudeForDiscoveredLaw, magnitudeForLaw } from "./board-reasons";
import type { DiscoveryFacts, DiscoveryQuantityValues } from "./discovery-facts";
import type { CandidateLaw } from "./discovery/generate";
import type { LawConditionFacts } from "./populations";
import type { Law, LawVerdict } from "./types";

/**
 * `lawReasonsFor`, `magnitudeForLaw` AND `magnitudeForDiscoveredLaw`, DRIVEN WITH HAND-BUILT FIXTURES
 * — no `registry()`, no `measured.json`/`discovered.json` on disk, no real `generateCandidates()`,
 * exactly the same discipline `registry.test.ts` states for `registryFrom`. Every TRIBAL law id used
 * below is a REAL one from `populations.ts`'s `LAW_CONDITIONS` (there is no other way to reach a
 * condition predicate); every DISCOVERED candidate is a small, hand-built `CandidateLaw` passed
 * through `lawReasonsFor`'s own `candidates` parameter, so this file's pass/fail can never move with
 * a future `npm run laws:discover` re-run.
 */

function factsFixture(overrides: Partial<LawConditionFacts> = {}): LawConditionFacts {
  return {
    touches: null,
    age: null,
    bestTeammateTargetShare: null,
    incomingCoachTenureIsZero: null,
    incomingCoachPriorPassRateOverExpected: null,
    targetShare: null,
    touchdownPointsShare: null,
    touchdownPointsShareThreshold: null,
    ...overrides,
  };
}

/** `primaryQuantityId` defaults to `null` for a tribal fixture and matters ONLY for a discovered one
 *  reaching `lawReasonsFor`'s own consistency guard (Task 8 fix round) — a test whose discovered
 *  fixture's candidate has quantity `"touchdownPointsShare"` as its primary must pass that same
 *  string here, or the guard throws before the condition is ever evaluated. `primaryQuantityNoun`/
 *  `primaryQuantityUnit` are never read by anything in THIS file (that is `reason-chip.test.tsx`'s
 *  concern), so they get a fixed placeholder whenever the id is non-null. */
function lawFixture(
  id: string,
  verdict: LawVerdict,
  effect = -2.5,
  origin: Law["origin"] = "tribal",
  primaryQuantityId: string | null = null,
): Law {
  return {
    id,
    position: "WR",
    claim: `Fixture claim for ${id}.`,
    measured: { effect, ci: [effect - 1, effect + 1], sample: 100, seasons: "fixture" },
    trainEffect: effect,
    verdict,
    modelPath: null,
    hasFoldEvidence: true,
    origin,
    primaryQuantityId,
    primaryQuantityNoun: primaryQuantityId === null ? null : "fixture noun",
    primaryQuantityUnit: primaryQuantityId === null ? null : "whole",
  };
}

const NO_QUANTITIES: DiscoveryQuantityValues = {
  touches: null,
  age: null,
  targetShare: null,
  touchdownPointsShare: null,
  redZoneTouchShare: null,
  targetDepth: null,
  snapShare: null,
  incomingCoachTenureSeasons: null,
  incomingCoachPriorPassRateOverExpected: null,
  experienceYear: null,
  teamPaceSecondsPerPlay: null,
};

function discoveryFactsFixture(
  current: Partial<DiscoveryQuantityValues> = {},
  prior: Partial<DiscoveryQuantityValues> | null = null,
): DiscoveryFacts {
  return {
    position: "WR",
    current: { ...NO_QUANTITIES, ...current },
    prior: prior === null ? null : { ...NO_QUANTITIES, ...prior },
  };
}

type QuantityKey = keyof DiscoveryQuantityValues;

/** A minimal THRESHOLD candidate: true when the named quantity's current value clears `threshold`. */
function thresholdCandidateFixture(id: string, quantityId: QuantityKey, threshold: number): CandidateLaw {
  return {
    id,
    position: "WR",
    template: "threshold",
    condition: (facts) => {
      const value = facts.current[quantityId];
      return value === null ? null : value >= threshold;
    },
    claimParts: { position: "WR", clause: { kind: "threshold", quantityId, quantileLevel: 0.7 } },
  };
}

/** A minimal DELTA candidate: true when the named quantity ROSE into `threshold` from below it. */
function deltaCandidateFixture(id: string, quantityId: QuantityKey, threshold: number): CandidateLaw {
  return {
    id,
    position: "WR",
    template: "delta",
    condition: (facts) => {
      const current = facts.current[quantityId];
      const prior = facts.prior === null ? null : facts.prior[quantityId];
      if (current === null || prior === null) return null;
      return prior < threshold && current >= threshold;
    },
    claimParts: { position: "WR", clause: { kind: "delta", quantityId, quantileLevel: 0.7, direction: "rose_into" } },
  };
}

/** A minimal AND candidate — `left`/`right` named explicitly, matching `generate.ts`'s own shape
 *  (an AND is always built from two THRESHOLD singles), so a test can pin which one the generic
 *  "primary = left" rule reads. */
function andCandidateFixture(
  id: string,
  left: { readonly quantityId: QuantityKey; readonly threshold: number },
  right: { readonly quantityId: QuantityKey; readonly threshold: number },
): CandidateLaw {
  return {
    id,
    position: "WR",
    template: "and",
    condition: (facts) => {
      const l = facts.current[left.quantityId];
      const r = facts.current[right.quantityId];
      if (l === null || r === null) return null;
      return l >= left.threshold && r >= right.threshold;
    },
    claimParts: {
      position: "WR",
      clause: {
        kind: "and",
        left: { kind: "threshold", quantityId: left.quantityId, quantileLevel: 0.7 },
        right: { kind: "threshold", quantityId: right.quantityId, quantileLevel: 0.8 },
      },
    },
  };
}

function candidatesFixture(...candidates: readonly CandidateLaw[]): ReadonlyMap<string, CandidateLaw> {
  return new Map(candidates.map((candidate) => [candidate.id, candidate] as const));
}

describe("magnitudeForLaw", () => {
  it("reads his own touches for rb_workload_cliff", () => {
    expect(magnitudeForLaw("rb_workload_cliff", factsFixture({ touches: 312 }))).toBe(312);
  });

  it("reads his own age for rb_age_curve", () => {
    expect(magnitudeForLaw("rb_age_curve", factsFixture({ age: 29 }))).toBe(29);
  });

  it("reads his BEST TEAMMATE's target share for wr_target_competition, not his own", () => {
    const facts = factsFixture({ targetShare: 0.18, bestTeammateTargetShare: 0.27 });
    expect(magnitudeForLaw("wr_target_competition", facts)).toBe(0.27);
  });

  it("reads his OWN target share for target_share_persistence", () => {
    expect(magnitudeForLaw("target_share_persistence", factsFixture({ targetShare: 0.31 }))).toBe(0.31);
  });

  it("reads his touchdown-points share OVER his position's threshold for td_regression", () => {
    const facts = factsFixture({ touchdownPointsShare: 0.45, touchdownPointsShareThreshold: 0.3 });
    expect(magnitudeForLaw("td_regression", facts)).toBeCloseTo(1.5, 10);
  });

  it("falls back to the raw share for td_regression when the threshold is zero, rather than dividing by it", () => {
    const facts = factsFixture({ touchdownPointsShare: 0.2, touchdownPointsShareThreshold: 0 });
    expect(magnitudeForLaw("td_regression", facts)).toBe(0.2);
  });

  it("reads the incoming coach's own prior pass-rate-over-expected for play_caller_fingerprint", () => {
    expect(magnitudeForLaw("play_caller_fingerprint", factsFixture({ incomingCoachPriorPassRateOverExpected: 0.04 }))).toBe(0.04);
  });

  it("returns null when the specific fact a law's magnitude reads is itself unknown", () => {
    expect(magnitudeForLaw("rb_workload_cliff", factsFixture())).toBeNull();
  });

  it("returns null for a law id it has no case for", () => {
    expect(magnitudeForLaw("not_a_real_law", factsFixture({ touches: 400 }))).toBeNull();
  });
});

describe("magnitudeForDiscoveredLaw", () => {
  it("reads the player's own CURRENT value of the quantity, for a THRESHOLD candidate", () => {
    const candidate = thresholdCandidateFixture("threshold:WR:touchdownPointsShare:q70", "touchdownPointsShare", 0.3);
    const facts = discoveryFactsFixture({ touchdownPointsShare: 0.35 });
    expect(magnitudeForDiscoveredLaw(candidate, facts)).toBe(0.35);
  });

  it("reads the player's own CURRENT value of the quantity, for a DELTA candidate too — same single-clause rule", () => {
    const candidate = deltaCandidateFixture("delta:WR:targetShare:q70:rose_into", "targetShare", 0.2);
    const facts = discoveryFactsFixture({ targetShare: 0.27 }, { targetShare: 0.1 });
    expect(magnitudeForDiscoveredLaw(candidate, facts)).toBe(0.27);
  });

  it("reads the PRIMARY (left) clause's quantity for an AND candidate, never the right one", () => {
    const candidate = andCandidateFixture(
      "and:WR:left+right",
      { quantityId: "touchdownPointsShare", threshold: 0.3 },
      { quantityId: "incomingCoachTenureSeasons", threshold: 0 },
    );
    const facts = discoveryFactsFixture({ touchdownPointsShare: 0.41, incomingCoachTenureSeasons: 0 });
    expect(magnitudeForDiscoveredLaw(candidate, facts)).toBe(0.41);
  });

  it("returns null when the primary quantity's own current value is itself unknown", () => {
    const candidate = thresholdCandidateFixture("threshold:WR:touchdownPointsShare:q70", "touchdownPointsShare", 0.3);
    expect(magnitudeForDiscoveredLaw(candidate, discoveryFactsFixture())).toBeNull();
  });
});

describe("lawReasonsFor — tribal laws", () => {
  it("produces a reason only for a law that is both CONFIRMED and TRUE, from a fixture registry mixing all three", () => {
    // One fact set that trips two REAL laws' conditions at once, so the test isolates the verdict
    // filter from the condition filter: target_share_persistence and wr_target_competition are both
    // true here, and rb_age_curve's condition is null (no age known) regardless of its verdict.
    const facts = factsFixture({ targetShare: 0.3, bestTeammateTargetShare: 0.35 });
    const laws: readonly Law[] = [
      lawFixture("target_share_persistence", "confirmed", 1.8), // confirmed + true -> kept
      lawFixture("wr_target_competition", "weak", -3.1), // weak + true -> dropped by verdict
      lawFixture("rb_age_curve", "confirmed", -1.2), // confirmed + null condition -> dropped
    ];

    const reasons = lawReasonsFor(facts, null, laws);

    expect(reasons).toEqual<readonly BoardReason[]>([{ code: "law", lawId: "target_share_persistence", effect: 1.8, magnitude: 0.3 }]);
  });

  it("drops a debunked law's reason even when its condition is true", () => {
    const facts = factsFixture({ targetShare: 0.3 });
    const laws: readonly Law[] = [lawFixture("target_share_persistence", "debunked")];
    expect(lawReasonsFor(facts, null, laws)).toEqual([]);
  });

  it("drops a confirmed law's reason when its condition is false", () => {
    const facts = factsFixture({ targetShare: 0.1 }); // below the 0.24 threshold
    const laws: readonly Law[] = [lawFixture("target_share_persistence", "confirmed")];
    expect(lawReasonsFor(facts, null, laws)).toEqual([]);
  });

  it("carries the REGISTRY's own effect, never one recomputed from the player's facts", () => {
    const facts = factsFixture({ targetShare: 0.5 });
    const laws: readonly Law[] = [lawFixture("target_share_persistence", "confirmed", 7.25)];
    const [reason] = lawReasonsFor(facts, null, laws);
    expect(reason?.code).toBe("law");
    expect(reason && "effect" in reason ? reason.effect : undefined).toBe(7.25);
  });

  it("returns one reason per confirmed-and-true law when a player trips more than one", () => {
    const facts = factsFixture({ targetShare: 0.3, bestTeammateTargetShare: 0.35 });
    const laws: readonly Law[] = [
      lawFixture("target_share_persistence", "confirmed", 1.8),
      lawFixture("wr_target_competition", "confirmed", -2.4),
    ];
    const reasons = lawReasonsFor(facts, null, laws);
    expect(reasons.map((reason) => (reason.code === "law" ? reason.lawId : null)).sort()).toEqual([
      "target_share_persistence",
      "wr_target_competition",
    ]);
  });

  it("throws when a TRIBAL law id in the registry has no condition predicate — registry and populations.ts have drifted", () => {
    const laws: readonly Law[] = [lawFixture("not_a_real_law", "confirmed")];
    expect(() => lawReasonsFor(factsFixture(), null, laws)).toThrow(/not_a_real_law.*no condition predicate/);
  });

  it("skips a tribal law entirely when `facts` is null — no evidence at all, never a false-condition guess", () => {
    const laws: readonly Law[] = [lawFixture("target_share_persistence", "confirmed")];
    expect(lawReasonsFor(null, null, laws)).toEqual([]);
  });
});

describe("lawReasonsFor — discovered laws (Task 8)", () => {
  it("produces a reason for a CONFIRMED discovered law whose candidate condition is true, magnitude from the primary quantity", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "confirmed", -1.4, "discovered", "touchdownPointsShare")];
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.35 });

    const reasons = lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate));

    expect(reasons).toEqual<readonly BoardReason[]>([{ code: "law", lawId: "wr_td_share_high", effect: -1.4, magnitude: 0.35 }]);
  });

  it("never emits for a WEAK discovered law, even when its candidate condition is true", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "weak", -1.4, "discovered", "touchdownPointsShare")];
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.35 });

    expect(lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate))).toEqual([]);
  });

  it("never emits for a DEBUNKED discovered law either", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "debunked", -1.4, "discovered", "touchdownPointsShare")];
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.35 });

    expect(lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate))).toEqual([]);
  });

  it("never emits when discoveryFacts is null, even for a confirmed discovered law", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "confirmed", -1.4, "discovered", "touchdownPointsShare")];

    expect(lawReasonsFor(null, null, laws, candidatesFixture(candidate))).toEqual([]);
  });

  it("never emits when the candidate's own condition is false", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "confirmed", -1.4, "discovered", "touchdownPointsShare")];
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.1 }); // below 0.3

    expect(lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate))).toEqual([]);
  });

  it("never emits when the candidate's own condition is unknown (null) rather than false", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "confirmed", -1.4, "discovered", "touchdownPointsShare")];
    const discoveryFacts = discoveryFactsFixture(); // touchdownPointsShare unknown

    expect(lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate))).toEqual([]);
  });

  it("reads the AND candidate's PRIMARY (left) quantity as magnitude, end to end through lawReasonsFor", () => {
    const candidate = andCandidateFixture(
      "wr_td_and_coach",
      { quantityId: "touchdownPointsShare", threshold: 0.3 },
      { quantityId: "incomingCoachTenureSeasons", threshold: 0 },
    );
    const laws: readonly Law[] = [lawFixture("wr_td_and_coach", "confirmed", -1.7, "discovered", "touchdownPointsShare")];
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.41, incomingCoachTenureSeasons: 0 });

    const reasons = lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate));

    expect(reasons).toEqual<readonly BoardReason[]>([{ code: "law", lawId: "wr_td_and_coach", effect: -1.7, magnitude: 0.41 }]);
  });

  it("throws when a confirmed discovered law's id has no matching candidate — registry and generateCandidates() have drifted", () => {
    const laws: readonly Law[] = [lawFixture("orphan_discovered_id", "confirmed", -1, "discovered")];
    expect(() => lawReasonsFor(null, discoveryFactsFixture({ touchdownPointsShare: 0.5 }), laws, candidatesFixture())).toThrow(
      /orphan_discovered_id.*no matching candidate/,
    );
  });

  it("keeps a tribal confirmed-and-true law alongside a confirmed-and-true discovered one", () => {
    const facts = factsFixture({ targetShare: 0.3 });
    const tribal = lawFixture("target_share_persistence", "confirmed", 1.8);
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const discovered = lawFixture("wr_td_share_high", "confirmed", -1.4, "discovered", "touchdownPointsShare");
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.4 });

    const reasons = lawReasonsFor(facts, discoveryFacts, [tribal, discovered], candidatesFixture(candidate));

    expect(reasons.map((reason) => (reason.code === "law" ? reason.lawId : null)).sort()).toEqual(["target_share_persistence", "wr_td_share_high"]);
  });

  it("defaults `candidates` to the real generateCandidates() when omitted — real confirmed ids resolve", () => {
    // Not asserting on WHICH ids are confirmed today (that would couple this test to
    // `discovered.json`) — only that a REAL candidate id (present in every discovery round, since
    // `touches`/RB/q70 is one of the earliest-fitted quantities) resolves without throwing.
    const candidateId = "threshold:RB:touches:q70";
    const laws: readonly Law[] = [lawFixture(candidateId, "confirmed", -1, "discovered", "touches")];
    expect(() => lawReasonsFor(null, discoveryFactsFixture({ touches: 0 }, null), laws)).not.toThrow();
  });
});

/**
 * THE CONSISTENCY GUARD (Task 8 fix round, IMPORTANT 2 RULING) — `law.primaryQuantityId` (persisted
 * once at discovery time, `discovery/measure.ts`) must equal what `primaryQuantityDefOf` computes
 * FRESH from the matched candidate's own `claimParts.clause`. This is the drift check that keeps a
 * CLIENT bundle (`ReasonChip`, which reads the persisted field and never recomputes it) from ever
 * silently rendering a headline for the wrong quantity.
 */
describe("lawReasonsFor — discovered primaryQuantityId consistency guard (Task 8 fix round)", () => {
  it("passes silently when the persisted primaryQuantityId agrees with the live template", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "confirmed", -1.4, "discovered", "touchdownPointsShare")];
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.35 });
    expect(() => lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate))).not.toThrow();
  });

  it("throws when the persisted primaryQuantityId disagrees with the live template's own primary quantity", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    // Persisted as "age" — stale relative to the candidate's REAL primary quantity, "touchdownPointsShare".
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "confirmed", -1.4, "discovered", "age")];
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.35 });
    expect(() => lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate))).toThrow(
      /wr_td_share_high.*persisted primaryQuantityId \("age"\) disagrees.*"touchdownPointsShare"/,
    );
  });

  it("throws on the SAME disagreement even when the candidate's own condition would be false — drift is checked before condition truth", () => {
    const candidate = thresholdCandidateFixture("wr_td_share_high", "touchdownPointsShare", 0.3);
    const laws: readonly Law[] = [lawFixture("wr_td_share_high", "confirmed", -1.4, "discovered", "age")];
    const discoveryFacts = discoveryFactsFixture({ touchdownPointsShare: 0.1 }); // below 0.3 — condition would be false
    expect(() => lawReasonsFor(null, discoveryFacts, laws, candidatesFixture(candidate))).toThrow(/disagrees/);
  });
});
