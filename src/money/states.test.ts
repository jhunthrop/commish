import { describe, expect, it } from "vitest";
import { assertEnableable, MONEY_STATES, moneyIsLive, US_STATE_CODES } from "./states";

describe("MONEY_STATES", () => {
  it("ships with no state enabled, so money is dark until the founder names a list with counsel", () => {
    expect(MONEY_STATES.enabled).toHaveLength(0);
    expect(moneyIsLive()).toBe(false);
  });

  it("names the five states that have never permitted paid fantasy sports", () => {
    expect(MONEY_STATES.neverEligible).toEqual(["HI", "ID", "MT", "NV", "WA"]);
  });

  it("leaves CA off both lists, pending counsel reconciliation of the AG opinion with DFPI guidance", () => {
    expect(MONEY_STATES.neverEligible as readonly string[]).not.toContain("CA");
    expect(MONEY_STATES.enabled.some((entry) => entry.state === "CA")).toBe(false);
  });

  it("cannot enable a state without stating its minimum age", () => {
    // The entry shape is { state, minAge }, so the compiler is the enforcement. This test pins
    // the runtime half: the never-eligible five refuse membership even if typed in.
    for (const s of MONEY_STATES.neverEligible) {
      expect(() => assertEnableable(s)).toThrow(/has never permitted paid fantasy/);
    }
  });

  it("does not refuse a state outside the never-eligible five", () => {
    expect(() => assertEnableable("TN")).not.toThrow();
  });
});

describe("US_STATE_CODES", () => {
  it("lists exactly fifty states plus the District of Columbia", () => {
    expect(US_STATE_CODES).toHaveLength(51);
    expect(new Set(US_STATE_CODES).size).toBe(51);
    expect(US_STATE_CODES).toContain("DC");
  });
});
