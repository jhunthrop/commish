import { describe, it, expect } from "vitest";
import { isPrintableDisplayName, stripHiddenCharacters } from "./display-name";

/** Built from code points so this file, too, contains no invisible characters. */
const ch = (code: number): string => String.fromCharCode(code);

describe("isPrintableDisplayName", () => {
  it("accepts ordinary names, in any script", () => {
    expect(isPrintableDisplayName("Ada Lovelace")).toBe(true);
    expect(isPrintableDisplayName("Renée O'Brien-Smith")).toBe(true);
    expect(isPrintableDisplayName("山田 太郎")).toBe(true);
    expect(isPrintableDisplayName("Иван")).toBe(true);
    expect(isPrintableDisplayName("محمد")).toBe(true);
    expect(isPrintableDisplayName("Coach 🏈")).toBe(true);
  });

  it("refuses C0 and C1 control characters, including newline and NUL", () => {
    expect(isPrintableDisplayName(`Ada${ch(0x00)}Lovelace`)).toBe(false);
    expect(isPrintableDisplayName(`Ada${ch(0x0a)}Lovelace`)).toBe(false);
    expect(isPrintableDisplayName(`Ada${ch(0x1f)}Lovelace`)).toBe(false);
    expect(isPrintableDisplayName(`Ada${ch(0x7f)}Lovelace`)).toBe(false);
    expect(isPrintableDisplayName(`Ada${ch(0x9f)}Lovelace`)).toBe(false);
  });

  it("refuses zero-width characters, which make two different names look identical", () => {
    expect(isPrintableDisplayName(`Commish${ch(0x200b)} Support`)).toBe(false);
    expect(isPrintableDisplayName(`Ada${ch(0x200d)}Lovelace`)).toBe(false);
    expect(isPrintableDisplayName(`${ch(0xfeff)}Ada`)).toBe(false);
    expect(isPrintableDisplayName(`Ada${ch(0x2060)}Lovelace`)).toBe(false);
  });

  it("refuses the bidi override and isolate set, which reorders what is around it", () => {
    expect(isPrintableDisplayName(`${ch(0x202e)}enalevoL adA`)).toBe(false);
    expect(isPrintableDisplayName(`${ch(0x202a)}Ada`)).toBe(false);
    expect(isPrintableDisplayName(`${ch(0x2066)}Ada`)).toBe(false);
    expect(isPrintableDisplayName(`${ch(0x2069)}Ada`)).toBe(false);
    expect(isPrintableDisplayName(`${ch(0x200f)}Ada`)).toBe(false);
  });

  it("leaves an ordinary space alone — the ban is on the invisible, not the empty", () => {
    expect(isPrintableDisplayName("Ada Lovelace Jr")).toBe(true);
  });
});

describe("stripHiddenCharacters", () => {
  it("returns an ordinary name completely untouched, in any script", () => {
    for (const name of ["Ada Lovelace", "Renée O'Brien-Smith", "山田 太郎", "Иван", "محمد", "Coach 🏈"]) {
      expect(stripHiddenCharacters(name)).toBe(name);
    }
  });

  it("removes every character the printable rule refuses, and only those", () => {
    expect(stripHiddenCharacters(`Ada${ch(0x00)}Lovelace`)).toBe("AdaLovelace");
    expect(stripHiddenCharacters(`${ch(0x202e)}Sunday Money`)).toBe("Sunday Money");
    expect(stripHiddenCharacters(`Commish${ch(0x200b)} Support`)).toBe("Commish Support");
    expect(stripHiddenCharacters(`${ch(0xfeff)}Ada${ch(0x2060)}Lovelace${ch(0x2069)}`)).toBe("AdaLovelace");
  });

  it("removes EVERY occurrence, not just the first — the regex is global", () => {
    // A one-shot regex would leave the second override in place, which for a bidi control is the
    // whole attack: the pair is what reverses a run of text rather than the single opener.
    const doubled = `${ch(0x202e)}Sunday${ch(0x202e)} Money${ch(0x202e)}`;
    expect(stripHiddenCharacters(doubled)).toBe("Sunday Money");
  });

  it("leaves behind a string the printable rule then accepts, which is the contract", () => {
    // The two functions are one rule stated twice; a value that survives the strip must pass the
    // check, or the boundary and the belt would disagree about what "printable" means.
    for (const hostile of [`${ch(0x202e)}abc`, `a${ch(0x0a)}b`, `${ch(0x200d)}${ch(0xfeff)}x`]) {
      expect(isPrintableDisplayName(stripHiddenCharacters(hostile))).toBe(true);
    }
  });
});
