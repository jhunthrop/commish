import { describe, expect, it } from "vitest";
import { oddsPhrase } from "./odds-phrase";

describe("oddsPhrase", () => {
  it("rounds to quarters with fixed, pinned phrasings", () => {
    expect(oddsPhrase(0.95)).toBe("better than 9 in 10");
    expect(oddsPhrase(0.75)).toBe("about 3 in 4");
    expect(oddsPhrase(0.5)).toBe("about 1 in 2");
    expect(oddsPhrase(0.25)).toBe("about 1 in 4");
    expect(oddsPhrase(0.05)).toBe("long odds");
  });
});
