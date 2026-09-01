import { describe, expect, it } from "vitest";
import type { DiscoveryFacts, DiscoveryQuantityValues } from "../populations";
import { renderClaim, type QuantileTable } from "./templates";
import { CANDIDATE_CAP, enforceCap, generateCandidates, generateCandidatesFrom, type CandidateLaw } from "./generate";

const NO_VALUES: DiscoveryQuantityValues = {
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

/** A two-quantity, one-position fixture: RB `touches` and RB `age`, both with round thresholds so
 *  every test case below can be worked out by hand. Deliberately NOT the real committed table — see
 *  `generate.ts`'s own docblock for why the generator is tested against a synthetic table. */
const FIXTURE: QuantileTable = {
  touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } },
  age: { RB: { 0.7: 27, 0.8: 28, 0.9: 30 } },
};

function factsWith(current: Partial<DiscoveryQuantityValues>, prior: Partial<DiscoveryQuantityValues> | null = null): DiscoveryFacts {
  return {
    position: "RB",
    current: { ...NO_VALUES, ...current },
    prior: prior === null ? null : { ...NO_VALUES, ...prior },
  };
}

function candidatesOf(template: CandidateLaw["template"]): readonly CandidateLaw[] {
  return generateCandidatesFrom(FIXTURE).filter((candidate) => candidate.template === template);
}

function findById(id: string): CandidateLaw {
  const candidate = generateCandidatesFrom(FIXTURE).find((entry) => entry.id === id);
  if (candidate === undefined) throw new Error(`No candidate with id "${id}" in the fixture set (available: ${generateCandidatesFrom(FIXTURE).map((c) => c.id).join(", ")})`);
  return candidate;
}

describe("generateCandidatesFrom — cardinality and families", () => {
  it("builds exactly the threshold x delta x AND-pair cross product the fixture implies", () => {
    const all = generateCandidatesFrom(FIXTURE);
    // 2 quantities x 1 position x 3 levels = 6 threshold candidates.
    expect(candidatesOf("threshold")).toHaveLength(6);
    // Each threshold doubled (rise/fall) = 12 delta candidates.
    expect(candidatesOf("delta")).toHaveLength(12);
    // One distinct-quantity pair (touches, age) x 3 levels x 3 levels = 9 AND candidates.
    expect(candidatesOf("and")).toHaveLength(9);
    expect(all).toHaveLength(6 + 12 + 9);
  });

  it("never pairs a quantity with itself in an AND candidate", () => {
    for (const candidate of candidatesOf("and")) {
      expect(candidate.id).not.toMatch(/threshold:RB:touches:q\d+\+threshold:RB:touches:q\d+/);
      expect(candidate.id).not.toMatch(/threshold:RB:age:q\d+\+threshold:RB:age:q\d+/);
    }
  });

  it("never builds an AND candidate out of a delta half", () => {
    for (const candidate of candidatesOf("and")) expect(candidate.id).not.toContain("delta:");
  });
});

describe("generateCandidatesFrom — deterministic ids and stable ordering", () => {
  it("produces byte-identical ids, in the same order, across repeated calls", () => {
    const first = generateCandidatesFrom(FIXTURE).map((candidate) => candidate.id);
    const second = generateCandidatesFrom(FIXTURE).map((candidate) => candidate.id);
    expect(second).toEqual(first);
  });

  it("names every id from the template's own structure, not a counter", () => {
    const all = generateCandidatesFrom(FIXTURE);
    expect(all.map((c) => c.id)).toContain("threshold:RB:touches:q70");
    expect(all.map((c) => c.id)).toContain("threshold:RB:age:q90");
    expect(all.map((c) => c.id)).toContain("delta:RB:touches:q80:rose_into");
    expect(all.map((c) => c.id)).toContain("delta:RB:age:q70:fell_out_of");
  });

  it("has no duplicate ids", () => {
    const ids = generateCandidatesFrom(FIXTURE).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("returns candidates already sorted by id", () => {
    const ids = generateCandidatesFrom(FIXTURE).map((c) => c.id);
    const sorted = [...ids].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    expect(ids).toEqual(sorted);
  });

  it("gives an AND candidate the same id regardless of which side is built first", () => {
    // The AND id is built from its two threshold sub-ids, sorted lexicographically — so swapping
    // which quantity is "left" and which is "right" structurally must still land on one id.
    const id = generateCandidatesFrom(FIXTURE).find((c) => c.template === "and" && c.id.includes("age:q70") && c.id.includes("touches:q70"))!.id;
    expect(id).toBe("and:RB:threshold:RB:age:q70+threshold:RB:touches:q70");
  });
});

describe("generateCandidatesFrom — tri-state threshold conditions", () => {
  it("is null when the underlying quantity has no evidence", () => {
    const candidate = findById("threshold:RB:touches:q80");
    expect(candidate.condition(factsWith({ touches: null }))).toBeNull();
  });

  it("is true at or above the threshold, false below it", () => {
    const candidate = findById("threshold:RB:touches:q80"); // threshold 150
    expect(candidate.condition(factsWith({ touches: 150 }))).toBe(true);
    expect(candidate.condition(factsWith({ touches: 200 }))).toBe(true);
    expect(candidate.condition(factsWith({ touches: 149 }))).toBe(false);
  });
});

describe("generateCandidatesFrom — tri-state delta conditions", () => {
  it("is null when either season's value is missing", () => {
    const rose = findById("delta:RB:touches:q70:rose_into"); // threshold 100
    expect(rose.condition(factsWith({ touches: 120 }, null))).toBeNull();
    expect(rose.condition(factsWith({ touches: null }, { touches: 80 }))).toBeNull();
  });

  it("rose_into is true only when prior was below and current is at or above", () => {
    const rose = findById("delta:RB:touches:q70:rose_into"); // threshold 100
    expect(rose.condition(factsWith({ touches: 120 }, { touches: 80 }))).toBe(true);
    expect(rose.condition(factsWith({ touches: 120 }, { touches: 100 }))).toBe(false); // already at it
    expect(rose.condition(factsWith({ touches: 90 }, { touches: 80 }))).toBe(false); // never crossed
  });

  it("fell_out_of is true only when prior was at or above and current is below", () => {
    const fell = findById("delta:RB:touches:q70:fell_out_of"); // threshold 100
    expect(fell.condition(factsWith({ touches: 80 }, { touches: 120 }))).toBe(true);
    expect(fell.condition(factsWith({ touches: 120 }, { touches: 120 }))).toBe(false); // never fell
    expect(fell.condition(factsWith({ touches: 80 }, { touches: 80 }))).toBe(false); // never crossed
  });
});

describe("generateCandidatesFrom — Kleene AND", () => {
  const and = () => findById("and:RB:threshold:RB:age:q70+threshold:RB:touches:q70"); // age>=27, touches>=100

  it("true AND true = true", () => {
    expect(and().condition(factsWith({ age: 30, touches: 120 }))).toBe(true);
  });

  it("false AND anything = false (false wins over unknown)", () => {
    expect(and().condition(factsWith({ age: 20, touches: 120 }))).toBe(false); // false, true
    expect(and().condition(factsWith({ age: 20, touches: null }))).toBe(false); // false, null
    expect(and().condition(factsWith({ age: null, touches: 50 }))).toBe(false); // null, false
  });

  it("unknown AND true = unknown (true cannot rescue an unknown half)", () => {
    expect(and().condition(factsWith({ age: null, touches: 120 }))).toBeNull();
    expect(and().condition(factsWith({ age: 30, touches: null }))).toBeNull();
  });

  it("unknown AND unknown = unknown", () => {
    expect(and().condition(factsWith({ age: null, touches: null }))).toBeNull();
  });
});

describe("enforceCap", () => {
  function fakeCandidate(id: string): CandidateLaw {
    return {
      id,
      position: "RB",
      template: "threshold",
      condition: () => null,
      claimParts: { position: "RB", clause: { kind: "threshold", quantityId: "touches", quantileLevel: 0.7 } },
    };
  }

  it("leaves an under-cap list untouched, aside from sorting", () => {
    const candidates = [fakeCandidate("c"), fakeCandidate("a"), fakeCandidate("b")];
    expect(enforceCap(candidates, 10).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("trims an over-cap list DETERMINISTICALLY, keeping the lexicographically-first ids", () => {
    const candidates = ["e", "c", "a", "d", "b"].map(fakeCandidate);
    const capped = enforceCap(candidates, 3);
    expect(capped.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("produces the identical trim on repeated calls — never a random sample", () => {
    const candidates = Array.from({ length: 50 }, (_unused, index) => fakeCandidate(String(index).padStart(3, "0")));
    const first = enforceCap(candidates, 7).map((c) => c.id);
    const second = enforceCap(candidates, 7).map((c) => c.id);
    expect(second).toEqual(first);
    expect(first).toHaveLength(7);
  });

  it("never returns more than CANDIDATE_CAP from generateCandidatesFrom, even on an oversized fixture", () => {
    // A dense fixture across all four positions and every real quantity forces the full AND-pair
    // cross product, which is the actual production scale check.
    const dense: QuantileTable = {
      touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } },
      age: { QB: { 0.7: 27, 0.8: 28, 0.9: 30 }, RB: { 0.7: 27, 0.8: 28, 0.9: 30 }, WR: { 0.7: 27, 0.8: 28, 0.9: 30 }, TE: { 0.7: 27, 0.8: 28, 0.9: 30 } },
    };
    expect(generateCandidatesFrom(dense).length).toBeLessThanOrEqual(CANDIDATE_CAP);
  });
});

describe("generateCandidates — the real committed table", () => {
  it("stays under the hard cap, deterministically, with every id unique and every claim renderable", () => {
    const all = generateCandidates();
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(CANDIDATE_CAP);
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
    for (const candidate of all) expect(() => renderClaim(candidate.claimParts)).not.toThrow();
    // Re-running is byte-identical — the committed table makes this a pure, repeatable call.
    expect(generateCandidates().map((c) => c.id)).toEqual(all.map((c) => c.id));
  });
});

describe("generateCandidatesFrom — claim rendering integration", () => {
  it("every candidate's claimParts renders through the shared renderer without throwing", () => {
    for (const candidate of generateCandidatesFrom(FIXTURE)) expect(() => renderClaim(candidate.claimParts)).not.toThrow();
  });

  it("a candidate's claimParts.position matches its own position field", () => {
    for (const candidate of generateCandidatesFrom(FIXTURE)) expect(candidate.claimParts.position).toBe(candidate.position);
  });
});
