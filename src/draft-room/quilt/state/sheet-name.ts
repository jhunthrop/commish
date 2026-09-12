import { shortName } from "../components/quilt-cell";
import { QUILT_CONFIG } from "./config";
import type { SheetColumnKey } from "./sheet-columns";

/**
 * THE NAME ON A SHEET ROW (P1: the person before the number; review M5). A column of the
 * approved width holds a whole name up to a measured pixel budget beside the 28px face, the rank
 * and the share. Past it the row uses the wall's grammar ("J. Gibbs"); when even that is too wide
 * the surname stands alone, and a generational suffix is the last thing to go. A defense is a
 * club, not a person: past the budget it goes by its nickname ("Rams"). Nothing here is ever cut
 * by an ellipsis; the spec measures the pixels at 1440 to hold the estimate honest.
 */
export function sheetDisplayName(name: string, column: SheetColumnKey): string {
  const budget = column === "overall" ? QUILT_CONFIG.sheet.nameWidthPx.overall : QUILT_CONFIG.sheet.nameWidthPx.position;
  if (estimateNameWidthPx(name) <= budget) return name;
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name;
  if (column === "DEF") return words[words.length - 1]!;
  const short = shortName(name);
  if (estimateNameWidthPx(short) <= budget) return short;
  const surname = words.slice(1);
  if (surname.length > 1 && estimateNameWidthPx(surname.join(" ")) > budget && SUFFIXES.has(surname[surname.length - 1]!)) return surname.slice(0, -1).join(" ");
  return surname.join(" ");
}

const SUFFIXES: ReadonlySet<string> = new Set(["Jr.", "Sr.", "II", "III", "IV"]);

/** Glyph classes of the display face at the row's 13px bold, measured against the 2026 board. */
const NARROW = /[Iiljtfr.'\-]/;
const WIDE = /[A-HJ-Zmw]/;
const GLYPH_PX = { narrow: 4.2, wide: 9.5, space: 3.6, other: 7.3 } as const;

/** The name's width at the row's size, from the glyph classes above: a proxy for the layout. */
export function estimateNameWidthPx(name: string): number {
  let width = 0;
  for (const glyph of name) {
    if (glyph === " ") width += GLYPH_PX.space;
    else if (NARROW.test(glyph)) width += GLYPH_PX.narrow;
    else if (WIDE.test(glyph)) width += GLYPH_PX.wide;
    else width += GLYPH_PX.other;
  }
  return width;
}
