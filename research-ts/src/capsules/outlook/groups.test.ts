import { describe, expect, it } from "vitest";
import type { Law } from "@research-ts/projections/laws/types";
import type { BoardReason } from "@research-ts/projections/preseason/board";
import { groupReasons, lawGroupLabel } from "./groups";

function discoveredLaw(over: Partial<Law> = {}): Law {
  return {
    id: "threshold:WR:snapShare:q70",
    position: "WR",
    claim: "Fixture claim.",
    measured: { effect: -1, ci: [-2, -0.5], sample: 100, seasons: "fixture" },
    trainEffect: -1,
    verdict: "confirmed",
    modelPath: null,
    hasFoldEvidence: true,
    origin: "discovered",
    primaryQuantityId: "snapShare",
    primaryQuantityNoun: "snap share",
    primaryQuantityUnit: "percent",
    ...over,
  };
}

describe("groupReasons", () => {
  it("collapses two discovered laws sharing a primaryQuantityId into one group, net effect summed, headline stated once", () => {
    const lawA = discoveredLaw({ id: "threshold:WR:snapShare:q70" });
    const lawB = discoveredLaw({ id: "and:WR:snapShare:q70+threshold:WR:teamAirYardsShare:q70" });
    const reasons: readonly BoardReason[] = [
      { code: "law", lawId: lawA.id, effect: -1.2, magnitude: 0.848 },
      { code: "law", lawId: lawB.id, effect: -0.6, magnitude: 0.848 },
    ];
    const groups = groupReasons(reasons, [lawA, lawB]);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.kind).toBe("law");
    if (group.kind !== "law") throw new Error("expected a law group");
    expect(group.headline).toBe("84.8% snap share");
    expect(group.netEffect).toBeCloseTo(-1.8);
    expect(group.members).toHaveLength(2);
    // Strongest member first inside the group, for the receipts.
    expect(group.members[0]!.lawId).toBe(lawA.id);
  });

  it("keeps two tribal laws as separate groups — distinct quantities never merge just because they're both tribal", () => {
    const reasons: readonly BoardReason[] = [
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
      { code: "law", lawId: "rb_workload_cliff", effect: -0.9, magnitude: 320 },
    ];
    const groups = groupReasons(reasons, []);
    expect(groups).toHaveLength(2);
    expect(groups.map((group) => group.key).sort()).toEqual(["age", "touches"]);
  });

  it("orders law groups by |net effect| descending", () => {
    const reasons: readonly BoardReason[] = [
      { code: "law", lawId: "rb_workload_cliff", effect: -0.5, magnitude: 300 },
      { code: "law", lawId: "rb_age_curve", effect: -2.5, magnitude: 30 },
    ];
    const groups = groupReasons(reasons, []);
    expect(groups.map((group) => group.key)).toEqual(["age", "touches"]);
  });

  it("HIGH fix, fix round 1: a tribal law and a discovered law measuring the SAME quantity (age) merge into ONE group, effect summed — the founder's own screenshot case", () => {
    const discoveredAgeLaw = discoveredLaw({
      id: "and:RB:threshold:RB:age:q70+threshold:RB:experienceYear:q70",
      position: "RB",
      primaryQuantityId: "age",
      primaryQuantityNoun: "age",
      primaryQuantityUnit: "two_decimal",
    });
    const reasons: readonly BoardReason[] = [
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
      { code: "law", lawId: discoveredAgeLaw.id, effect: -0.7, magnitude: 29 },
    ];
    const groups = groupReasons(reasons, [discoveredAgeLaw]);
    expect(groups).toHaveLength(1);
    const group = groups[0]!;
    expect(group.kind).toBe("law");
    if (group.kind !== "law") throw new Error("expected a law group");
    expect(group.key).toBe("age");
    expect(group.members).toHaveLength(2);
    expect(group.netEffect).toBeCloseTo(-2.5);
    // The tribal member's own curated headline wins over the discovered mechanical one, even
    // though the discovered member here would NOT be the strongest by |effect| either way — see
    // `headlineSourceOf`'s own docblock for why this is never left to whichever effect is bigger.
    expect(group.headline).toBe("Age 29 season");
  });

  it("the tribal headline wins even when the discovered member's own |effect| is the larger of the two", () => {
    const discoveredAgeLaw = discoveredLaw({
      id: "threshold:RB:age:q90",
      position: "RB",
      primaryQuantityId: "age",
      primaryQuantityNoun: "age",
      primaryQuantityUnit: "two_decimal",
    });
    const reasons: readonly BoardReason[] = [
      { code: "law", lawId: "rb_age_curve", effect: -1.2, magnitude: 29 },
      { code: "law", lawId: discoveredAgeLaw.id, effect: -5, magnitude: 29 },
    ];
    const group = groupReasons(reasons, [discoveredAgeLaw])[0]!;
    if (group.kind !== "law") throw new Error("expected a law group");
    // The discovered member sorts first inside the group (bigger |effect|) but never supplies the
    // group's own headline.
    expect(group.members[0]!.lawId).toBe(discoveredAgeLaw.id);
    expect(group.headline).toBe("Age 29 season");
  });

  it("drops market_anchor, scarcity and tier_cliff entirely — they feed the verdict, never a peer chip", () => {
    const reasons: readonly BoardReason[] = [
      { code: "market_anchor", marketPoints: 200, delta: 5 },
      { code: "scarcity", positionRank: 12, replacementLevel: 140 },
      { code: "tier_cliff", playersLeftInTier: 2, dropToNextTier: 3 },
    ];
    expect(groupReasons(reasons, [])).toEqual([]);
  });

  it("keeps every other non-law code as its own singleton fact group, in board order, after every law group", () => {
    const reasons: readonly BoardReason[] = [
      { code: "changed_team", from: "SF", to: "MIA" },
      { code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 },
      { code: "availability", expectedGames: 14, floorGames: 10, ceilingGames: 17 },
    ];
    const groups = groupReasons(reasons, []);
    expect(groups.map((group) => group.key)).toEqual(["age", "changed_team", "availability"]);
    expect(groups[1]).toEqual({ kind: "fact", key: "changed_team", reason: reasons[0] });
    expect(groups[2]).toEqual({ kind: "fact", key: "availability", reason: reasons[2] });
  });

  it("returns nothing for an empty reason list — the honest absence", () => {
    expect(groupReasons([], [])).toEqual([]);
  });

  it("falls back to lawId as the group key for a discovered law the registry no longer carries", () => {
    const reasons: readonly BoardReason[] = [{ code: "law", lawId: "stale_discovered_id", effect: -1, magnitude: 5 }];
    const groups = groupReasons(reasons, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe("stale_discovered_id");
  });
});

describe("lawGroupLabel", () => {
  it("states a single-member group plainly, no 'together'", () => {
    const reasons: readonly BoardReason[] = [{ code: "law", lawId: "rb_age_curve", effect: -1.8, magnitude: 29 }];
    const [group] = groupReasons(reasons, []);
    expect(lawGroupLabel(group as Extract<(typeof group), { kind: "law" }>)).toBe("-1.8 pts, Age 29 season");
  });

  it("marks a multi-member group as 'together', with the member count", () => {
    const lawA = discoveredLaw({ id: "threshold:WR:snapShare:q70" });
    const lawB = discoveredLaw({ id: "and:WR:snapShare:q70+threshold:WR:teamAirYardsShare:q70" });
    const reasons: readonly BoardReason[] = [
      { code: "law", lawId: lawA.id, effect: -1.2, magnitude: 0.848 },
      { code: "law", lawId: lawB.id, effect: -0.6, magnitude: 0.848 },
    ];
    const [group] = groupReasons(reasons, [lawA, lawB]);
    const label = lawGroupLabel(group as Extract<(typeof group), { kind: "law" }>);
    expect(label).toContain("together");
    expect(label).toContain("2 laws");
    expect(label).toContain("-1.8 pts");
  });
});
