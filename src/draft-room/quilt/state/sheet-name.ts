import { shortName } from "../components/quilt-cell";
import { QUILT_CONFIG } from "./config";
import type { SheetColumnKey } from "./sheet-columns";

/**
 * THE NAME ON A SHEET ROW (P1: the person before the number; review M5). A column of the
 * approved width holds a whole name up to a budget of characters beside the 28px face, the rank
 * and the figure. Past the budget the row uses the wall's grammar ("J. Gibbs"), and when even
 * that is too long for the column the surname stands alone: a surname is never cut by an
 * ellipsis. The budgets are measured against the display face at the row's size and live in
 * `QUILT_CONFIG.sheet.nameChars`.
 */
export function sheetDisplayName(name: string, column: SheetColumnKey): string {
  const budget = column === "overall" ? QUILT_CONFIG.sheet.nameChars.overall : QUILT_CONFIG.sheet.nameChars.position;
  if (name.length <= budget) return name;
  const short = shortName(name);
  if (short.length <= budget) return short;
  const words = name.trim().split(/\s+/);
  return words.length < 2 ? name : words.slice(1).join(" ");
}
