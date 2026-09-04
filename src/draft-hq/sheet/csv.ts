import type { SheetTag, SheetEntryInput } from "./types";
import type { BoardOption } from "./view";
import type { SheetEntryView } from "./view";

/**
 * MY SHEET'S CSV IMPORT/EXPORT (spec §4) — a simple, honest round trip. Export writes
 * `name,rank,tier,note,tag`; import expects the same four columns (name required, the rest
 * optional) in any order, and a name it cannot match to a real player is REPORTED, never
 * silently dropped (the caller decides whether to fix the file and retry).
 */

const HEADER = ["name", "rank", "tier", "note", "tag"] as const;

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function sheetToCsv(entries: readonly SheetEntryView[]): string {
  const lines = entries.map((entry) => [entry.name, String(entry.rank), entry.tierLabel ?? "", entry.note ?? "", entry.tag ?? ""].map(csvField).join(","));
  return [HEADER.join(","), ...lines].join("\n");
}

/** One line of RFC4180-ish CSV, quoted fields and doubled-quote escapes included — no library,
 *  since this format is exactly what `sheetToCsv` above writes and nothing richer. */
function parseCsvLine(line: string): readonly string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

const TAG_VALUES: ReadonlySet<string> = new Set(["target", "avoid", "never"]);

export interface ParsedSheetCsv {
  readonly rows: readonly SheetEntryInput[];
  /** Every name the file named that could not be matched to a real player — reported so the
   *  caller can fix the file, never dropped without a trace. */
  readonly unresolvedNames: readonly string[];
}

/**
 * Resolves a CSV's own `name` column against `universe` (the board's own player list — the same
 * "add a player" search this page already offers, so a name that could not be added by hand
 * could not be imported either). Matching is exact, case-insensitive: a fuzzy match risks
 * attaching one man's row to another, which this product's crosswalk module treats as the one
 * unacceptable identity failure everywhere else it appears.
 */
export function parseSheetCsv(text: string, universe: readonly BoardOption[]): ParsedSheetCsv {
  const byName = new Map<string, string>();
  for (const option of universe) {
    const key = option.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, option.playerId);
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { rows: [], unresolvedNames: [] };

  const header = parseCsvLine(lines[0]!).map((cell) => cell.trim().toLowerCase());
  const nameIndex = header.indexOf("name");
  if (nameIndex === -1) return { rows: [], unresolvedNames: [] };
  const rankIndex = header.indexOf("rank");
  const tierIndex = header.indexOf("tier");
  const noteIndex = header.indexOf("note");
  const tagIndex = header.indexOf("tag");

  const resolved: { readonly input: SheetEntryInput; readonly rank: number | null; readonly fileOrder: number }[] = [];
  const unresolvedNames: string[] = [];

  lines.slice(1).forEach((line, fileOrder) => {
    const cells = parseCsvLine(line);
    const name = cells[nameIndex]?.trim() ?? "";
    if (name === "") return;
    const playerId = byName.get(name.toLowerCase());
    if (playerId === undefined) {
      unresolvedNames.push(name);
      return;
    }
    const rawTag = tagIndex === -1 ? "" : (cells[tagIndex]?.trim().toLowerCase() ?? "");
    const tag: SheetTag | null = TAG_VALUES.has(rawTag) ? (rawTag as SheetTag) : null;
    const rawRank = rankIndex === -1 ? "" : (cells[rankIndex]?.trim() ?? "");
    const rank = rawRank === "" || Number.isNaN(Number(rawRank)) ? null : Number(rawRank);
    resolved.push({
      input: {
        playerId,
        tierLabel: tierIndex === -1 || (cells[tierIndex]?.trim() ?? "") === "" ? null : cells[tierIndex]!.trim(),
        note: noteIndex === -1 || (cells[noteIndex]?.trim() ?? "") === "" ? null : cells[noteIndex]!.trim(),
        tag,
      },
      rank,
      fileOrder,
    });
  });

  const ordered = resolved.every((row) => row.rank !== null)
    ? [...resolved].sort((a, b) => a.rank! - b.rank!)
    : [...resolved].sort((a, b) => a.fileOrder - b.fileOrder);

  return { rows: ordered.map((row) => row.input), unresolvedNames };
}
