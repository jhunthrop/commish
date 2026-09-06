import { describe, expect, it } from "vitest";
import { VARIANCE_POSITIONS } from "./game-variance";
import { FITTED_GAME_VARIANCE } from "./game-variance-fitted";
import { SHIPPED_GAME_VARIANCE } from "./fitted-variance";
import { FITTED_KDEF_GAME_VARIANCE } from "./kdef-fitted";

describe("the composed per-game variance table", () => {
  it("carries a measured cell for every position the board bands on", () => {
    for (const playerClass of ["rookie", "veteran"] as const) {
      for (const position of VARIANCE_POSITIONS) {
        expect(SHIPPED_GAME_VARIANCE[playerClass][position]).toBeGreaterThan(0);
      }
    }
  });

  /**
   * A COLLISION WOULD REPLACE ONE MEASURED CELL WITH ANOTHER AND LOOK LIKE NOTHING. The two
   * generated halves are supposed to carry disjoint positions; if a future fit ever widened one of
   * them, the spread in `fitted-variance.ts` would silently pick a winner. This is the test that
   * refuses to let that happen quietly.
   */
  it("composes two disjoint halves, so neither can silently overwrite the other", () => {
    for (const playerClass of ["rookie", "veteran"] as const) {
      const skill = Object.keys(FITTED_GAME_VARIANCE[playerClass]);
      const kdef = Object.keys(FITTED_KDEF_GAME_VARIANCE[playerClass]);
      expect(skill.filter((position) => kdef.includes(position))).toEqual([]);
    }
  });

  it("leaves every skill cell exactly as its own fit produced it", () => {
    for (const playerClass of ["rookie", "veteran"] as const) {
      for (const [position, variance] of Object.entries(FITTED_GAME_VARIANCE[playerClass])) {
        expect(SHIPPED_GAME_VARIANCE[playerClass][position as keyof typeof FITTED_GAME_VARIANCE.rookie]).toBe(variance);
      }
    }
  });
});
