import { describe, expect, it } from "vitest";
import type { BoardReason } from "../preseason/board";
import { lawReasonsFor, magnitudeForLaw } from "./board-reasons";
import type { LawConditionFacts } from "./populations";
import type { Law, LawVerdict } from "./types";

/**
 * `lawReasonsFor` AND `magnitudeForLaw`, DRIVEN WITH HAND-BUILT FIXTURES — no `registry()`, no
 * `measured.json` on disk, exactly the same discipline `registry.test.ts` states for `registryFrom`.
 * Every law id used below is a REAL one from `populations.ts`'s `LAW_CONDITIONS` (there is no other
 * way to reach a condition predicate — see `lawReasonsFor`'s own docblock on why `laws` alone is not
 * enough), with `verdict`/`measured` overridden per fixture so the real registry's current content
 * can never make one of these tests pass or fail by accident.
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

function lawFixture(id: string, verdict: LawVerdict, effect = -2.5): Law {
  return {
    id,
    position: "WR",
    claim: `Fixture claim for ${id}.`,
    measured: { effect, ci: [effect - 1, effect + 1], sample: 100, seasons: "fixture" },
    verdict,
    modelPath: null,
    hasFoldEvidence: true,
    origin: "tribal",
  };
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

describe("lawReasonsFor", () => {
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

    const reasons = lawReasonsFor(facts, laws);

    expect(reasons).toEqual<readonly BoardReason[]>([{ code: "law", lawId: "target_share_persistence", effect: 1.8, magnitude: 0.3 }]);
  });

  it("drops a debunked law's reason even when its condition is true", () => {
    const facts = factsFixture({ targetShare: 0.3 });
    const laws: readonly Law[] = [lawFixture("target_share_persistence", "debunked")];
    expect(lawReasonsFor(facts, laws)).toEqual([]);
  });

  it("drops a confirmed law's reason when its condition is false", () => {
    const facts = factsFixture({ targetShare: 0.1 }); // below the 0.24 threshold
    const laws: readonly Law[] = [lawFixture("target_share_persistence", "confirmed")];
    expect(lawReasonsFor(facts, laws)).toEqual([]);
  });

  it("carries the REGISTRY's own effect, never one recomputed from the player's facts", () => {
    const facts = factsFixture({ targetShare: 0.5 });
    const laws: readonly Law[] = [lawFixture("target_share_persistence", "confirmed", 7.25)];
    const [reason] = lawReasonsFor(facts, laws);
    expect(reason?.code).toBe("law");
    expect(reason && "effect" in reason ? reason.effect : undefined).toBe(7.25);
  });

  it("returns one reason per confirmed-and-true law when a player trips more than one", () => {
    const facts = factsFixture({ targetShare: 0.3, bestTeammateTargetShare: 0.35 });
    const laws: readonly Law[] = [
      lawFixture("target_share_persistence", "confirmed", 1.8),
      lawFixture("wr_target_competition", "confirmed", -2.4),
    ];
    const reasons = lawReasonsFor(facts, laws);
    expect(reasons.map((reason) => (reason.code === "law" ? reason.lawId : null)).sort()).toEqual([
      "target_share_persistence",
      "wr_target_competition",
    ]);
  });

  it("throws when a TRIBAL law id in the registry has no condition predicate — registry and populations.ts have drifted", () => {
    const laws: readonly Law[] = [lawFixture("not_a_real_law", "confirmed")];
    expect(() => lawReasonsFor(factsFixture(), laws)).toThrow(/not_a_real_law.*no condition predicate/);
  });

  it("skips a CONFIRMED DISCOVERED law silently rather than throwing — its condition is a DiscoveryFacts predicate, not a LawConditionFacts one", () => {
    const discovered: Law = { ...lawFixture("threshold:RB:touches:q70", "confirmed"), origin: "discovered" };
    expect(() => lawReasonsFor(factsFixture(), [discovered])).not.toThrow();
    expect(lawReasonsFor(factsFixture(), [discovered])).toEqual([]);
  });

  it("keeps a tribal confirmed-and-true law alongside a skipped discovered one", () => {
    const facts = factsFixture({ targetShare: 0.3 });
    const tribal = lawFixture("target_share_persistence", "confirmed", 1.8);
    const discovered: Law = { ...lawFixture("threshold:WR:targetShare:q70", "confirmed"), origin: "discovered" };
    const reasons = lawReasonsFor(facts, [tribal, discovered]);
    expect(reasons).toEqual<readonly BoardReason[]>([{ code: "law", lawId: "target_share_persistence", effect: 1.8, magnitude: 0.3 }]);
  });
});
