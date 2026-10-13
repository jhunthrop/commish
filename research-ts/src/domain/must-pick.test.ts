import { describe, expect, it } from "vitest";
import { mustPickLine } from "./must-pick";

describe("mustPickLine", () => {
  it("names the two late positions the way the room badges them", () => {
    expect(mustPickLine(["K", "DEF"])).toBe("Your next pick must be a K or a D/ST.");
  });

  it("reads one position plainly and three with the last joined by or", () => {
    expect(mustPickLine(["DEF"])).toBe("Your next pick must be a D/ST.");
    expect(mustPickLine(["QB", "TE", "K"])).toBe("Your next pick must be a QB, a TE or a K.");
  });

  it("gives a back its spoken article", () => {
    expect(mustPickLine(["RB", "WR"])).toBe("Your next pick must be an RB or a WR.");
  });

  it("refuses an empty set rather than printing a sentence about nothing", () => {
    expect(() => mustPickLine([])).toThrow(/at least one position/);
  });
});
