import { describe, expect, it } from "vitest";
import { roundPoints } from "@research-ts/scoring";
import { leagueMedian, medianResultFor } from "./median";

describe("leagueMedian", () => {
  it("averages the two middle scores in an even league, on the same rounding the scores use", () => {
    expect(leagueMedian([100, 110, 120, 130])).toBe(115);
    expect(leagueMedian([100.01, 110.02, 120.03, 130.04])).toBe(roundPoints((110.02 + 120.03) / 2));
  });

  it("takes the middle score in an odd league, which is what a bye week leaves behind", () => {
    // An odd team count gets a BYE in `generateSchedule` and the bye team has no matchup, so it
    // has no score that week and plays no median game. The median is over the teams that played.
    expect(leagueMedian([100, 110, 130])).toBe(110);
  });

  it("has no median for a week nobody played", () => {
    expect(leagueMedian([])).toBeNull();
  });

  it("is order-independent — the same scores in any order produce the same median", () => {
    expect(leagueMedian([130, 100, 120, 110])).toBe(115);
    expect(leagueMedian([130, 100, 110])).toBe(110);
  });
});

describe("medianResultFor", () => {
  it("counts a score equal to the median as a tie, in both directions", () => {
    expect(medianResultFor(115, 115)).toBe("tie");
    expect(medianResultFor(115.01, 115)).toBe("win");
    expect(medianResultFor(114.99, 115)).toBe("loss");
  });
});
