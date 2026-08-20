import { describe, it, expect } from "vitest";
import { isPrintableDisplayName } from "./display-name";

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
