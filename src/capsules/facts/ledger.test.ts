import { describe, expect, it } from "vitest";
import { depthNames, depthNumbers, depthTeamCodes } from "./ledger";
import { EMPTY_DEPTH } from "./types";

describe("the depth ledger", () => {
  it("contributes nothing at all for a player the depth stores held nothing for", () => {
    expect(depthNumbers(EMPTY_DEPTH)).toEqual([]);
    expect(depthNames(EMPTY_DEPTH)).toEqual([]);
    expect(depthTeamCodes(EMPTY_DEPTH)).toEqual([]);
  });

  // The sentence for a fall down the board says "moved him down 11 picks", never "down -11", so the
  // ABSOLUTE value is the number on the page and the signed one alone would leave it ungrounded.
  it("grounds a market fall by the size the sentence prints as well as by its signed value", () => {
    const numbers = depthNumbers({
      ...EMPTY_DEPTH,
      marketMovement: { latestAdp: 24.5, latestAt: "2026-09-07", earlierAdp: 13, earlierAt: "2026-08-08", picks: -11.5 },
    });
    expect(numbers).toContain(-11.5);
    expect(numbers).toContain(11.5);
  });
});
