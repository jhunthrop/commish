import { describe, expect, it } from "vitest";
import type { Position } from "@research-ts/domain/player";
import { scoringUsageFor, type ScoringTally } from "./scoring-usage";

function tally(overrides: Partial<ScoringTally> = {}): ScoringTally {
  return { redZoneCarries: 0, redZoneTargets: 0, insideTenCarries: 0, insideTenTargets: 0, airYards: 0, airYardTargets: 0, ...overrides };
}

const positions = new Map<string, Position>([
  ["a", "RB"],
  ["b", "RB"],
]);
const names = new Map([
  ["a", "A Back"],
  ["b", "B Back"],
]);

describe("scoringUsageFor", () => {
  it("sums carries and targets into one touch count and ranks it among the peers with a real reading", () => {
    const out = scoringUsageFor(
      2025,
      new Map([
        ["a", tally({ redZoneCarries: 30, redZoneTargets: 6, insideTenCarries: 12, insideTenTargets: 2 })],
        ["b", tally({ redZoneCarries: 10, redZoneTargets: 1 })],
      ]),
      positions,
      names,
    );
    expect(out.get("a")!.redZoneTouches).toEqual({ value: 36, positionRank: 1, qualifierCount: 2, namedNeighbor: null });
    expect(out.get("b")!.redZoneTouches).toEqual({ value: 11, positionRank: 2, qualifierCount: 2, namedNeighbor: "A Back" });
    expect(out.get("a")!.insideTenTouches!.value).toBe(14);
  });

  it("refuses an average depth of target with no readable target behind it", () => {
    const out = scoringUsageFor(2025, new Map([["a", tally({ redZoneCarries: 5 })], ["b", tally({ airYards: 400, airYardTargets: 50 })]]), positions, names);
    expect(out.get("a")!.targetDepth).toBeNull();
    expect(out.get("b")!.targetDepth).toMatchObject({ value: 8, qualifierCount: 1 });
  });

  it("ranks a real zero and never invents one for a player the feed did not place", () => {
    const out = scoringUsageFor(2025, new Map([["a", tally({ redZoneCarries: 4 })], ["b", tally()]]), positions, names);
    expect(out.get("b")!.redZoneTouches).toMatchObject({ value: 0, positionRank: 2, qualifierCount: 2 });
    expect(out.has("z")).toBe(false);
  });

  it("skips a player the universe has no position for rather than pooling him with everybody", () => {
    const out = scoringUsageFor(2025, new Map([["z", tally({ redZoneCarries: 9 })]]), positions, names);
    expect(out.size).toBe(0);
  });
});
