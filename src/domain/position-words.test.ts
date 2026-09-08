import { describe, expect, it } from "vitest";
import { positionWord } from "./position-words";

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
