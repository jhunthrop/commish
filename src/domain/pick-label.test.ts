import { describe, expect, it } from "vitest";
import { pickLabel, pickLabelOf } from "./pick-label";

describe("pickLabel", () => {
  it("names a global pick by round and pick in round, two digits", () => {
    expect(pickLabel(1, 10)).toBe("1.01");
    expect(pickLabel(10, 10)).toBe("1.10");
    expect(pickLabel(11, 10)).toBe("2.01");
    expect(pickLabel(37, 10)).toBe("4.07");
    expect(pickLabel(4, 2)).toBe("2.02");
  });

  it("formats a round and seat directly", () => {
    expect(pickLabelOf(2, 5)).toBe("2.05");
  });

  it("refuses a pick number or team count that is not a positive whole number", () => {
    expect(() => pickLabel(0, 10)).toThrow(/positive/);
    expect(() => pickLabel(3, 0)).toThrow(/positive/);
    expect(() => pickLabel(1.5, 10)).toThrow(/positive/);
  });
});
