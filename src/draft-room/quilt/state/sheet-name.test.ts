import { describe, expect, it } from "vitest";
import { QUILT_CONFIG } from "./config";
import { sheetDisplayName } from "./sheet-name";

/** The eight longest names on the 2026 board (the dev database's players table, 2026-09-10). */
const LONGEST = ["Christian McCaffrey", "Lil'Jordan Humphrey", "Marvin Harrison Jr.", "Jaxon Smith-Njigba", "Kenneth Walker III", "TreVeyon Henderson", "Amon-Ra St. Brown", "Tetairoa McMillan"];

const surnameOf = (name: string): string => name.trim().split(/\s+/).slice(1).join(" ");

describe("sheetDisplayName (no surname is ever cut)", () => {
  it("keeps a whole name that fits the column", () => {
    expect(sheetDisplayName("Josh Allen", "QB")).toBe("Josh Allen");
    expect(sheetDisplayName("Jaxon Smith-Njigba", "overall")).toBe("Jaxon Smith-Njigba");
  });

  it("fits the eight longest names on the board inside a position column, whole surname first", () => {
    for (const name of LONGEST) {
      const shown = sheetDisplayName(name, "RB");
      expect(shown.length, name).toBeLessThanOrEqual(QUILT_CONFIG.sheet.nameChars.position);
      expect(shown.endsWith(surnameOf(name)), `${name} → ${shown}`).toBe(true);
    }
  });

  it("uses the wall's grammar first, and the surname alone only when that is still too long", () => {
    expect(sheetDisplayName("Christian McCaffrey", "RB")).toBe("C. McCaffrey");
    expect(sheetDisplayName("Jaxon Smith-Njigba", "WR")).toBe("Smith-Njigba");
    expect(sheetDisplayName("Marvin Harrison Jr.", "WR")).toBe("Harrison Jr.");
  });

  it("gives the Overall column its wider budget", () => {
    expect(sheetDisplayName("Jaxon Smith-Njigba", "overall")).toBe("Jaxon Smith-Njigba");
  });
});
