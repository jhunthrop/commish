import { describe, expect, it } from "vitest";
import { KDEF_DECISION, KDEF_POSITIONS, marketOrderPositions, shipsProjectedRows } from "./kdef-decision";

describe("the kicker and team defence decision", () => {
  it("names a verdict for both positions and only those two", () => {
    expect(Object.keys(KDEF_DECISION).sort()).toEqual(["DEF", "K"]);
    for (const verdict of Object.values(KDEF_DECISION)) {
      expect(["projected", "market_order"]).toContain(verdict);
    }
    expect([...KDEF_POSITIONS].sort()).toEqual(["DEF", "K"]);
  });

  /**
   * PINNED TO THE RESULTS DOCUMENT. Both positions failed their preregistered gates on 2025, so
   * both ship in market order. This case is what makes flipping either value a deliberate act with
   * a failing test behind it rather than an edit somebody makes in passing: a new verdict needs a
   * new judgment run and a new results document, and this test is where that argument lands.
   */
  it("ships both positions in market order, as the single 2025 judgment decided", () => {
    expect(KDEF_DECISION.K).toBe("market_order");
    expect(KDEF_DECISION.DEF).toBe("market_order");
    expect([...marketOrderPositions()].sort()).toEqual(["DEF", "K"]);
  });

  it("says nothing about a position it does not govern", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      expect(shipsProjectedRows(position)).toBe(true);
    }
  });

  it("agrees with itself: a position that ships projected rows is not in the fallback list", () => {
    for (const position of KDEF_POSITIONS) {
      expect(shipsProjectedRows(position)).toBe(!marketOrderPositions().includes(position));
    }
  });
});
