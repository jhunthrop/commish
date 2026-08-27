import { describe, expect, it } from "vitest";
import { FIXTURE_LEAGUE_NAME_PREFIXES, isFixtureLeagueName } from "./fixtures";

describe("isFixtureLeagueName", () => {
  it("recognizes every prefix this repo actually seeds", () => {
    expect(isFixtureLeagueName("E2E Money Dark 1787678163994")).toBe(true);
    expect(isFixtureLeagueName("E2E League 1787678163994")).toBe(true);
    expect(isFixtureLeagueName("Mobile360UnbrokenOverlongIdentifierFixture")).toBe(true);
    expect(isFixtureLeagueName("Mobile360 Hold League")).toBe(true);
  });

  it("never flags a normal league name, even one that shares a word", () => {
    expect(isFixtureLeagueName("Rookie Snake Room")).toBe(false);
    expect(isFixtureLeagueName("The Longshot League 5")).toBe(false);
    expect(isFixtureLeagueName("Free For All League")).toBe(false);
    // Contains "E2E" but not as a leading, space-terminated prefix.
    expect(isFixtureLeagueName("The E2E Fan Club League")).toBe(false);
  });

  it("is anchored at the start of the name, not anywhere in it", () => {
    expect(isFixtureLeagueName("Somewhere Mobile360 Later")).toBe(false);
  });

  it("stays in sync with the one exported prefix list", () => {
    for (const prefix of FIXTURE_LEAGUE_NAME_PREFIXES) {
      expect(isFixtureLeagueName(`${prefix}anything`)).toBe(true);
    }
  });
});
