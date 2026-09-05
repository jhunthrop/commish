import type { SheetTag, SheetEntryInput } from "./types";
import type { BoardOption } from "./view";
import type { SheetEntryView } from "./view";

/**
 * MY SHEET'S CSV IMPORT/EXPORT (spec §4) — a simple, honest round trip. Export writes
 * `name,rank,tier,note,tag`; import expects the same four columns (name required, the rest
 * optional) in any order. A name it cannot match to a real player, or a second row for a player
 * already matched earlier in the file, is REPORTED, never silently dropped (the caller decides
 * whether to fix the file and retry) — fix round 1, HIGH 2. Every exported field is also guarded
 * against CSV formula injection (fix round 1, MEDIUM 2) and that guard is removed again on
 * import, so a manager's own note or tier label round-trips unchanged.
 */

const HEADER = ["name", "rank", "tier", "note", "tag"] as const;

/**
 * Fix round 1, MEDIUM 2 — CSV FORMULA INJECTION (OWASP's own guidance: a field opening with
 * `=`, `+`, `-`, `@`, a tab or a carriage return is a live formula the instant a spreadsheet
 * opens the file, not text). A manager's own note or tier label is free text HE wrote, and this
 * export is the one path that could carry `=HYPERLINK(...)` or `=cmd|...` out of this product and
 * into Excel's formula engine on the next open. The guard is a single leading apostrophe INSIDE
 * the field — Excel and Sheets both render it as the literal text that follows and never evaluate
 * it — applied here, in the one function every exported field already passes through, so no
 * export call site can forget it.
 */
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

function neutralizeFormula(value: string): string {
  return FORMULA_PREFIXES.some((prefix) => value.startsWith(prefix)) ? `'${value}` : value;
}

function csvField(value: string): string {
  const guarded = neutralizeFormula(value);
  return /[",\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
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
  /**
   * Fix round 1, HIGH 2: a second (or later) row naming a player already resolved earlier in the
   * file. `draft_sheet_entries_sheet_player_idx` is a UNIQUE `(sheet_id, player_id)` index, so
   * writing two rows for the same player would otherwise throw the constraint at
   * `replaceEntries`' bulk insert and lose the WHOLE import behind a generic 500. The first
   * occurrence wins (file order) and every later one is dropped and named here — the same
   * "reported, never silently dropped" channel `unresolvedNames` already is, so a caller sees
   * both kinds of skipped row in one place.
   */
  readonly duplicateNames: readonly string[];
}

/**
 * Resolves a CSV's own `name` column against `universe` (the board's own player list — the same
 * "add a player" search this page already offers, so a name that could not be added by hand
 * could not be imported either). Matching is exact, case-insensitive: a fuzzy match risks
 * attaching one man's row to another, which this product's crosswalk module treats as the one
 * unacceptable identity failure everywhere else it appears.
 */
/**
 * The inverse of `neutralizeFormula`: a cell whose first character is the guard apostrophe AND
 * whose second character is one of the formula-trigger characters had the apostrophe ADDED by
 * `csvField` on export, so it comes back off here — a round trip through this product's own
 * export is lossless. A field that happens to start with a real apostrophe followed by an
 * ordinary character is left alone; that ambiguity is the same one every spreadsheet's own CSV
 * import carries, not a gap this function introduces.
 */
function stripFormulaGuard(value: string): string {
  return value.length >= 2 && value[0] === "'" && FORMULA_PREFIXES.includes(value[1]!) ? value.slice(1) : value;
}

/** A cell's value, trimmed and with the export's own formula guard removed — the one place every
 *  column read in `parseSheetCsv` goes through, so none of them can forget either step. */
function cellAt(cells: readonly string[], index: number): string {
  if (index === -1) return "";
  return stripFormulaGuard((cells[index] ?? "").trim());
}

export function parseSheetCsv(text: string, universe: readonly BoardOption[]): ParsedSheetCsv {
  const byName = new Map<string, string>();
  for (const option of universe) {
    const key = option.name.trim().toLowerCase();
    if (!byName.has(key)) byName.set(key, option.playerId);
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return { rows: [], unresolvedNames: [], duplicateNames: [] };

  const header = parseCsvLine(lines[0]!).map((cell) => cell.trim().toLowerCase());
  const nameIndex = header.indexOf("name");
  if (nameIndex === -1) return { rows: [], unresolvedNames: [], duplicateNames: [] };
  const rankIndex = header.indexOf("rank");
  const tierIndex = header.indexOf("tier");
  const noteIndex = header.indexOf("note");
  const tagIndex = header.indexOf("tag");

  const resolved: { readonly input: SheetEntryInput; readonly rank: number | null; readonly fileOrder: number }[] = [];
  const unresolvedNames: string[] = [];
  const duplicateNames: string[] = [];
  // Fix round 1, HIGH 2: every playerId already resolved earlier in this file — the dedupe set
  // that keeps a second row for the same man from ever reaching the unique-index write.
  const seenPlayerIds = new Set<string>();

  lines.slice(1).forEach((line, fileOrder) => {
    const cells = parseCsvLine(line);
    const name = cellAt(cells, nameIndex);
    if (name === "") return;
    const playerId = byName.get(name.toLowerCase());
    if (playerId === undefined) {
      unresolvedNames.push(name);
      return;
    }
    if (seenPlayerIds.has(playerId)) {
      duplicateNames.push(name);
      return;
    }
    seenPlayerIds.add(playerId);
    const rawTag = cellAt(cells, tagIndex).toLowerCase();
    const tag: SheetTag | null = TAG_VALUES.has(rawTag) ? (rawTag as SheetTag) : null;
    const rawRank = cellAt(cells, rankIndex);
    const rank = rawRank === "" || Number.isNaN(Number(rawRank)) ? null : Number(rawRank);
    const tierLabel = cellAt(cells, tierIndex);
    const note = cellAt(cells, noteIndex);
    resolved.push({
      input: {
        playerId,
        tierLabel: tierLabel === "" ? null : tierLabel,
        note: note === "" ? null : note,
        tag,
      },
      rank,
      fileOrder,
    });
  });

  const ordered = resolved.every((row) => row.rank !== null)
    ? [...resolved].sort((a, b) => a.rank! - b.rank!)
    : [...resolved].sort((a, b) => a.fileOrder - b.fileOrder);

  return { rows: ordered.map((row) => row.input), unresolvedNames, duplicateNames };
}
