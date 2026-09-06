import { describe, expect, it } from "vitest";
import { marketOrderNoteFor } from "./market-order-note";

describe("marketOrderNoteFor", () => {
  it("says nothing at all for a position that carries a projection", () => {
    for (const position of ["QB", "RB", "WR", "TE"] as const) {
      expect(marketOrderNoteFor(position)).toBeNull();
    }
  });

  it("names the ordering and the reason for a position that fell back", () => {
    const kicker = marketOrderNoteFor("K");
    expect(kicker).toContain("Kickers");
    expect(kicker).toContain("usually drafted");
    expect(marketOrderNoteFor("DEF")).toContain("Team defenses");
  });

  it("uses the position in full, never an abbreviation a first-timer has to decode", () => {
    expect(marketOrderNoteFor("DEF")).not.toMatch(/\bDEF\b/);
    expect(marketOrderNoteFor("K")).not.toMatch(/\bK\b/);
  });

  /** The house copy rules: no em-dashes, no semicolons, no competitor names. */
  it("obeys the copy rules", () => {
    for (const position of ["K", "DEF"] as const) {
      const note = marketOrderNoteFor(position)!;
      expect(note).not.toMatch(/[—–;]/);
      expect(note).not.toMatch(/sleeper|espn|yahoo|underdog|ffpc|apex/i);
    }
  });
});
