import { describe, expect, it } from "vitest";
import type { DiscoveryFacts, DiscoveryQuantityValues } from "../discovery-facts";
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
  incomingTeamWinTotal: null,
  incomingTeamWinTotalDelta: null,
  insideTenTouchShare: null,
  teamAirYardsShare: null,
  gamesPlayed: null,
  draftPick: null,
  pointsPerGame: null,
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

  it("stays under CANDIDATE_CAP on a multi-position fixture (shape check, not a cap-scale replica)", () => {
    // Two quantities across all four positions -> ~54 candidates (6+4+4+4 threshold, doubled for
    // delta, plus one RB AND-pair x9 levels) — nowhere near CANDIDATE_CAP. This only proves
    // `generateCandidatesFrom` still returns a `<= cap` result once more than one position is in
    // play, not that the trim itself works at cap scale — THAT is `enforceCap`'s own synthetic
    // oversized-list tests above, and the real committed table's count (`generateCandidates`,
    // tested below) is the actual production-scale figure (1,737, well under the 2,000 cap).
    const twoQuantitiesAcrossPositions: QuantileTable = {
      touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } },
      age: { QB: { 0.7: 27, 0.8: 28, 0.9: 30 }, RB: { 0.7: 27, 0.8: 28, 0.9: 30 }, WR: { 0.7: 27, 0.8: 28, 0.9: 30 }, TE: { 0.7: 27, 0.8: 28, 0.9: 30 } },
    };
    expect(generateCandidatesFrom(twoQuantitiesAcrossPositions).length).toBeLessThanOrEqual(CANDIDATE_CAP);
  });
});

/**
 * TASK 2 — the low band, the match-key exclusion, the degenerate-level dedupe and the missing-level
 * skip, all against fixtures that carry BOTH bands (`FIXTURE` above deliberately still carries only
 * the high three, which is what proves the low band is additive: every count above is unchanged).
 */
const BOTH_BANDS: QuantileTable = {
  touches: { RB: { 0.1: 10, 0.2: 20, 0.3: 40, 0.7: 100, 0.8: 150, 0.9: 200 } },
  age: { RB: { 0.1: 22, 0.2: 23, 0.3: 24, 0.7: 27, 0.8: 28, 0.9: 30 } },
  pointsPerGame: { RB: { 0.1: 3, 0.2: 5, 0.3: 7, 0.7: 12, 0.8: 14, 0.9: 17 } },
};

function bothBands(template: CandidateLaw["template"]): readonly CandidateLaw[] {
  return generateCandidatesFrom(BOTH_BANDS).filter((candidate) => candidate.template === template);
}

function bothBandsById(id: string): CandidateLaw {
  const candidate = generateCandidatesFrom(BOTH_BANDS).find((entry) => entry.id === id);
  if (candidate === undefined) throw new Error(`No candidate with id "${id}" in the both-bands fixture set`);
  return candidate;
}

describe("generateCandidatesFrom — the low band", () => {
  it("builds the cross product over SIX levels, with the match-key quantity contributing deltas only", () => {
    // touches + age at 6 levels each = 12 thresholds; pointsPerGame contributes none.
    expect(bothBands("threshold")).toHaveLength(12);
    // All three quantities support the crossing template: 3 x 6 x 2 = 36.
    expect(bothBands("delta")).toHaveLength(36);
    // AND is HIGH-side only and match-key-free: 3 touches levels x 3 age levels = 9.
    expect(bothBands("and")).toHaveLength(9);
  });

  it("tags a low level q10/q20/q30 in an id and leaves every high-side id exactly as it was", () => {
    const ids = generateCandidatesFrom(BOTH_BANDS).map((candidate) => candidate.id);
    expect(ids).toContain("threshold:RB:touches:q10");
    expect(ids).toContain("threshold:RB:touches:q30");
    expect(ids).toContain("delta:RB:age:q20:fell_out_of");
    expect(ids).toContain("threshold:RB:touches:q70");
    expect(ids).toContain("delta:RB:age:q70:fell_out_of");
  });

  it("is TRUE at or BELOW a low threshold and false above it, the exact mirror of the high band", () => {
    const low = bothBandsById("threshold:RB:touches:q20"); // threshold 20, low band
    expect(low.condition(factsWith({ touches: 20 }))).toBe(true);
    expect(low.condition(factsWith({ touches: 5 }))).toBe(true);
    expect(low.condition(factsWith({ touches: 21 }))).toBe(false);
    const high = bothBandsById("threshold:RB:touches:q80"); // threshold 150, high band
    expect(high.condition(factsWith({ touches: 150 }))).toBe(true);
    expect(high.condition(factsWith({ touches: 149 }))).toBe(false);
  });

  it("stays tri-state on the low band: no evidence is unknown, never a low value", () => {
    expect(bothBandsById("threshold:RB:touches:q10").condition(factsWith({ touches: null }))).toBeNull();
  });

  it("reads a low-band fell_out_of as falling INTO the bottom band", () => {
    const fell = bothBandsById("delta:RB:touches:q20:fell_out_of"); // threshold 20, low band
    expect(fell.condition(factsWith({ touches: 15 }, { touches: 40 }))).toBe(true); // came down across it
    expect(fell.condition(factsWith({ touches: 15 }, { touches: 18 }))).toBe(false); // was already inside
    expect(fell.condition(factsWith({ touches: 40 }, { touches: 15 }))).toBe(false); // went the other way
  });

  it("reads a low-band rose_into as climbing OUT of the bottom band", () => {
    const rose = bothBandsById("delta:RB:touches:q20:rose_into");
    expect(rose.condition(factsWith({ touches: 40 }, { touches: 15 }))).toBe(true);
    expect(rose.condition(factsWith({ touches: 40 }, { touches: 30 }))).toBe(false); // was already outside
    expect(rose.condition(factsWith({ touches: 20 }, { touches: 15 }))).toBe(false); // exactly on the mark is still IN the band
  });

  it("leaves the high band's own crossing semantics unchanged", () => {
    const rose = bothBandsById("delta:RB:touches:q70:rose_into"); // threshold 100, high band
    expect(rose.condition(factsWith({ touches: 120 }, { touches: 80 }))).toBe(true);
    expect(rose.condition(factsWith({ touches: 120 }, { touches: 100 }))).toBe(false);
  });
});

describe("generateCandidatesFrom — the match-key exclusion (pointsPerGame)", () => {
  it("builds NO threshold candidate over the quantity the matched design pairs players by", () => {
    for (const candidate of generateCandidatesFrom(BOTH_BANDS)) {
      if (candidate.template === "threshold") expect(candidate.id).not.toContain("pointsPerGame");
    }
  });

  it("builds NO AND candidate containing it either, on either half", () => {
    for (const candidate of bothBands("and")) expect(candidate.id).not.toContain("pointsPerGame");
  });

  it("DOES build its crossing candidates, on both bands and in both directions", () => {
    const ids = bothBands("delta").map((candidate) => candidate.id);
    expect(ids).toContain("delta:RB:pointsPerGame:q80:rose_into");
    expect(ids).toContain("delta:RB:pointsPerGame:q80:fell_out_of");
    expect(ids).toContain("delta:RB:pointsPerGame:q20:fell_out_of");
    expect(ids.filter((id) => id.includes("pointsPerGame"))).toHaveLength(12);
  });

  it("evaluates a production crossing exactly like any other quantity's", () => {
    const rose = bothBandsById("delta:RB:pointsPerGame:q80:rose_into"); // threshold 14
    expect(rose.condition(factsWith({ pointsPerGame: 16 }, { pointsPerGame: 9 }))).toBe(true);
    expect(rose.condition(factsWith({ pointsPerGame: 16 }, { pointsPerGame: 15 }))).toBe(false);
    expect(rose.condition(factsWith({ pointsPerGame: 16 }, null))).toBeNull();
  });
});

describe("generateCandidatesFrom — the AND family stays high-side only", () => {
  it("names no low level in any AND id", () => {
    for (const candidate of bothBands("and")) {
      expect(candidate.id).not.toMatch(/q[123]0/);
    }
  });

  it("builds every high x high pair of distinct quantities, and exactly those", () => {
    const ids = bothBands("and").map((candidate) => candidate.id).sort();
    expect(ids).toHaveLength(9);
    expect(ids).toContain("and:RB:threshold:RB:age:q70+threshold:RB:touches:q90");
    expect(ids).toContain("and:RB:threshold:RB:age:q90+threshold:RB:touches:q70");
  });
});

describe("generateCandidatesFrom — degenerate-level dedupe", () => {
  // q70 and q80 fit the SAME number, exactly as `incomingCoachTenureSeasons` does three times over in
  // the real committed table. The two candidates would be byte-identical predicates.
  const TIED: QuantileTable = {
    touches: { RB: { 0.1: 0, 0.2: 0, 0.3: 5, 0.7: 100, 0.8: 100, 0.9: 200 } },
    age: { RB: { 0.1: 22, 0.2: 23, 0.3: 24, 0.7: 27, 0.8: 28, 0.9: 30 } },
  };

  it("keeps the FIRST level in declared order and drops the later duplicate, in every template family", () => {
    const ids = generateCandidatesFrom(TIED).map((candidate) => candidate.id);
    expect(ids).toContain("threshold:RB:touches:q70");
    expect(ids).not.toContain("threshold:RB:touches:q80");
    expect(ids).toContain("delta:RB:touches:q70:rose_into");
    expect(ids).not.toContain("delta:RB:touches:q80:rose_into");
    expect(ids.some((id) => id.includes("and:") && id.includes("touches:q80"))).toBe(false);
  });

  it("dedupes each band separately, never across them", () => {
    const ids = generateCandidatesFrom(TIED).map((candidate) => candidate.id);
    // The low band's own tie (q10 = q20 = 0) drops q20 and keeps q10, independently of the high tie.
    expect(ids).toContain("threshold:RB:touches:q10");
    expect(ids).not.toContain("threshold:RB:touches:q20");
    expect(ids).toContain("threshold:RB:touches:q30");
  });

  it("leaves an untied quantity's every level intact", () => {
    const ids = generateCandidatesFrom(TIED).map((candidate) => candidate.id);
    for (const tag of ["q10", "q20", "q30", "q70", "q80", "q90"]) expect(ids).toContain(`threshold:RB:age:${tag}`);
  });

  it("is deterministic: the same table always drops the same levels", () => {
    expect(generateCandidatesFrom(TIED).map((c) => c.id)).toEqual(generateCandidatesFrom(TIED).map((c) => c.id));
  });
});

describe("generateCandidatesFrom — a level the table does not carry", () => {
  const HIGH_ONLY: QuantileTable = { touches: { RB: { 0.7: 100, 0.8: 150, 0.9: 200 } } };

  it("SKIPS the missing levels rather than building a candidate whose threshold is undefined", () => {
    const ids = generateCandidatesFrom(HIGH_ONLY).map((candidate) => candidate.id);
    expect(ids.filter((id) => id.startsWith("threshold:"))).toHaveLength(3);
    for (const tag of ["q10", "q20", "q30"]) expect(ids.some((id) => id.includes(tag))).toBe(false);
  });

  it("never builds a condition that is false for every player alive — the failure a non-partial type would have hidden", () => {
    // A candidate built on an `undefined` threshold compares every real number against `undefined`,
    // which is false for every player and every prior season. Sweeping a grid of both seasons proves
    // each generated candidate is satisfiable by SOMEBODY, whatever its template and direction.
    const values = [0, 1, 50, 100, 250, 1000];
    for (const candidate of generateCandidatesFrom(HIGH_ONLY)) {
      const satisfiable = values.some((current) =>
        values.some((prior) => candidate.condition(factsWith({ touches: current }, { touches: prior })) === true),
      );
      expect(satisfiable, `${candidate.id} is false for every (current, prior) pair`).toBe(true);
    }
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
