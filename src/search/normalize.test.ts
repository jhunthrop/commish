import { describe, expect, it } from "vitest";
import { normalizeSearchText, searchTokens } from "./normalize";

describe("normalizeSearchText", () => {
  it("lowercases and strips diacritics", () => {
    expect(normalizeSearchText("José Ramírez")).toBe("jose ramirez");
  });

  it("drops apostrophes and periods so the two spellings of a name meet", () => {
    expect(normalizeSearchText("Ja'Marr Chase")).toBe("jamarr chase");
    expect(normalizeSearchText("St. Brown")).toBe("st brown");
    expect(normalizeSearchText("St Brown")).toBe("st brown");
    expect(normalizeSearchText("Ja’Marr")).toBe("jamarr");
  });

  it("turns a hyphen into a word break so both spellings of a hyphenated name meet", () => {
    expect(normalizeSearchText("Smith-Njigba")).toBe("smith njigba");
    expect(normalizeSearchText("Smith Njigba")).toBe("smith njigba");
    expect(normalizeSearchText("Amon-Ra St. Brown")).toBe("amon ra st brown");
  });

  it("collapses whitespace and trims", () => {
    expect(normalizeSearchText("  Jahmyr   Gibbs ")).toBe("jahmyr gibbs");
    expect(normalizeSearchText("")).toBe("");
    expect(normalizeSearchText("   ")).toBe("");
  });

  it("keeps digits, so 49ers stays searchable", () => {
    expect(normalizeSearchText("49ers")).toBe("49ers");
  });
});

describe("searchTokens", () => {
  it("splits the normalized text into words", () => {
    expect(searchTokens("Amon-Ra St. Brown")).toEqual(["amon", "ra", "st", "brown"]);
  });

  it("is empty for blank input", () => {
    expect(searchTokens("  ")).toEqual([]);
  });
});
