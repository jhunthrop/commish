import { describe, expect, it } from "vitest";
import { QUILT_CONFIG } from "./config";
import { estimateNameWidthPx, sheetDisplayName } from "./sheet-name";

/** The eight longest names on the 2026 board (the dev database's players table, 2026-09-10),
 *  and the wide eleven-character names the pixel check caught a character budget letting through. */
const LONGEST = ["Christian McCaffrey", "Lil'Jordan Humphrey", "Marvin Harrison Jr.", "Jaxon Smith-Njigba", "Kenneth Walker III", "TreVeyon Henderson", "Amon-Ra St. Brown", "Tetairoa McMillan"];
const WIDE = ["Chase Brown", "Sam LaPorta", "Ladd McConkey", "Jason Myers"];

const surnameOf = (name: string): string => name.trim().split(/\s+/).slice(1).join(" ");

describe("sheetDisplayName (no surname is ever cut)", () => {
  it("keeps a whole name that fits the column", () => {
    expect(sheetDisplayName("Josh Allen", "QB")).toBe("Josh Allen");
    expect(sheetDisplayName("Cam Little", "K")).toBe("Cam Little");
    expect(sheetDisplayName("Amon-Ra St. Brown", "overall")).toBe("Amon-Ra St. Brown");
  });

  it("fits the longest and the widest names on the board inside a position column, whole surname first", () => {
    for (const name of [...LONGEST, ...WIDE]) {
      const shown = sheetDisplayName(name, "RB");
      // Inside the budget, or the whole surname when nothing shorter is honest (a hyphenated
      // surname): the grammar never cuts it, and the spec measures the pixels at 1440.
      const wholeSurname = shown === surnameOf(name);
      expect(estimateNameWidthPx(shown) <= QUILT_CONFIG.sheet.nameWidthPx.position || wholeSurname, `${name} → ${shown}`).toBe(true);
      expect(surnameOf(name).startsWith(shown.replace(/^[A-Z]\. /, "")), `${name} → ${shown}`).toBe(true);
    }
  });

  it("uses the wall's grammar first, the surname alone when that is still too wide, and drops a suffix last", () => {
    expect(sheetDisplayName("Chase Brown", "RB")).toBe("C. Brown");
    expect(sheetDisplayName("Tetairoa McMillan", "WR")).toBe("T. McMillan");
    expect(sheetDisplayName("Christian McCaffrey", "RB")).toBe("McCaffrey");
    expect(sheetDisplayName("Jaxon Smith-Njigba", "WR")).toBe("Smith-Njigba");
    expect(sheetDisplayName("Kenneth Walker III", "RB")).toBe("Walker III");
    expect(sheetDisplayName("Marvin Harrison Jr.", "WR")).toBe("Harrison");
  });

  it("calls a defense by its nickname past the budget, never by the person grammar", () => {
    expect(sheetDisplayName("Los Angeles Rams", "DEF")).toBe("Rams");
    expect(sheetDisplayName("New England Patriots", "DEF")).toBe("Patriots");
    expect(sheetDisplayName("Houston Texans", "DEF")).toBe("Texans");
  });

  it("gives the Overall column its wider budget", () => {
    expect(sheetDisplayName("Christian McCaffrey", "overall")).toBe("C. McCaffrey");
    expect(sheetDisplayName("Kenneth Walker III", "overall")).toBe("Kenneth Walker III");
  });
});
