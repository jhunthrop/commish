import { describe, expect, it } from "vitest";
import { positionLabel, positionWord } from "./position-words";

describe("positionWord", () => {
  it("names every position in plain words, singular and plural", () => {
    expect(positionWord("QB", false)).toBe("quarterback");
    expect(positionWord("RB", true)).toBe("backs");
    expect(positionWord("WR", false)).toBe("receiver");
    expect(positionWord("TE", true)).toBe("tight ends");
    expect(positionWord("K", false)).toBe("kicker");
    expect(positionWord("DEF", true)).toBe("defenses");
  });
});

describe("positionLabel", () => {
  it("is the badge abbreviation, with the team defense as D/ST", () => {
    expect(positionLabel("QB")).toBe("QB");
    expect(positionLabel("K")).toBe("K");
    expect(positionLabel("DEF")).toBe("D/ST");
  });
});
