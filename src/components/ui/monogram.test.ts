import { describe, expect, it } from "vitest";
import { monogramsFor } from "./monogram";

describe("monogramsFor", () => {
  it("gives every non-colliding league its ordinary crest mark, unchanged", () => {
    expect(monogramsFor(["Backyard Bandits", "Sunday Regulars", "Monday Maulers"])).toEqual(["BB", "SR", "MM"]);
  });

  it("resolves a trailing-series collision with the series' own number: DS then DS2", () => {
    expect(monogramsFor(["Dev Season League", "Dev Season League II"])).toEqual(["DS", "DS2"]);
  });

  it("resolves a plain collision with a word-skip letter: TL then TLS", () => {
    // "Tidal Legends" claims TL first; "The Longest Shot" skips to its third word's letter.
    expect(monogramsFor(["Tidal Legends", "The Longest Shot"])).toEqual(["TL", "TLS"]);
  });

  it("falls to an appended counter digit when a name has no third word to skip to", () => {
    expect(monogramsFor(["Dire Straits", "Dark Skies"])).toEqual(["DS", "DS2"]);
  });

  it("keeps counting collisions past the first pair, never past three characters", () => {
    const marks = monogramsFor(["Dire Straits", "Dark Skies", "Dry Spell"]);
    expect(marks).toEqual(["DS", "DS2", "DS3"]);
    for (const mark of marks) expect(mark.length).toBeLessThanOrEqual(3);
  });

  it("never hands two leagues the same monogram, even for identical names", () => {
    const marks = monogramsFor(["Dev Season League", "Dev Season League", "Dev Season League"]);
    expect(new Set(marks).size).toBe(marks.length);
  });

  // The stability rule, both halves. Assignment order is the caller's league order (the shell
  // read's createdAt asc), and the function is pure over the current list:
  it("upgrades a league to its preferred form when the sibling that held it leaves", () => {
    expect(monogramsFor(["Dire Straits", "Dark Skies"])).toEqual(["DS", "DS2"]);
    // "Dire Straits" left; "Dark Skies" now claims DS itself.
    expect(monogramsFor(["Dark Skies"])).toEqual(["DS"]);
  });

  it("leaves unrelated monograms byte-identical when a sibling leaves", () => {
    const before = monogramsFor(["Backyard Bandits", "Dire Straits", "Sunday Regulars"]);
    const after = monogramsFor(["Backyard Bandits", "Sunday Regulars"]);
    expect(after).toEqual([before[0], before[2]]);
  });

  it("keeps the trailing-number rule's marks intact across a numbered house series", () => {
    // shortNameFor already separates these ("O40"/"O41"); no collision machinery should fire.
    expect(monogramsFor(["Open 12-team League 40", "Open 12-team League 41"])).toEqual(["O40", "O41"]);
  });

  it("returns an empty list for an empty list", () => {
    expect(monogramsFor([])).toEqual([]);
  });
});
