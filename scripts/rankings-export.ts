// One-shot: the board in draft order as a CSV a manager can paste into another site's custom
// rankings tool (rank, player, team, position, bye, tier, scoring, our projection, ADP). Projected
// positions come first in value order, then K and DEF in ADP order, exactly as the board shows.
// (dotenv -e .env.local -- tsx scripts/rankings-export.ts [--format=ppr|half|std] [outfile])
//
// `--format` (the scoring-formats round, 2026-09-08) picks which of the three stored boards is
// exported; PPR when omitted. The format rides on every row in its own "Scoring" column and in the
// default file name, so a file read away from this screen still says what its numbers are under.
import { writeFileSync } from "node:fs";
import { createDb } from "@/db/client";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { boardRows, type BoardRow } from "@/draft-hq/board/service";
import { BOARD_FORMAT_SPECS, BOARD_FORMATS, DEFAULT_BOARD_FORMAT, isBoardFormat, type BoardFormat } from "@/projections/preseason/board-formats";

const EXPORT_SHAPE = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } as const;
/** "Over repl" is the board's own ranking key and the number its rows print on screen (fix round 2):
 *  a file read away from the board needs it, or a reader cannot reproduce the order the rows are in.
 *  Beside "Proj Pts" and never instead of it — a value over a replacement player and a season point
 *  total are different claims, and this file states both. */
export const EXPORT_HEADER = ["Rank", "Player", "Team", "Pos", "Bye", "Tier", "Scoring", "Proj Pts", "Over repl", "ADP"] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run rankings:export\`, which loads .env.local.`);
  }
  return value;
}

export interface ExportArguments {
  readonly format: BoardFormat;
  readonly outfile: string;
}

/** `--format=half` and an optional positional out file; the default file name carries the format. */
export function parseExportArguments(argv: readonly string[]): ExportArguments {
  const flag = argv.find((argument) => argument.startsWith("--format="));
  const raw = flag?.slice("--format=".length);
  if (raw !== undefined && !isBoardFormat(raw)) throw new Error(`"${raw}" is not a board format (${BOARD_FORMATS.join(", ")}).`);
  const format = raw ?? DEFAULT_BOARD_FORMAT;
  const outfile = argv.find((argument) => !argument.startsWith("--")) ?? `commish-rankings-${format}.csv`;
  return { format, outfile };
}

function csvField(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Board order: value order for projected rows, then the ADP-ordered rows behind them. A player the
 *  roster-status gate took off the board (`BoardRow.rosterStatus.excluded`) is left out of the file
 *  entirely: he holds no rank in either order, and a nameless row in a spreadsheet gets one by accident. */
function inBoardOrder(rows: readonly BoardRow[]): readonly BoardRow[] {
  const ranked = rows.filter((row) => row.rosterStatus?.excluded !== true);
  const projected = ranked.filter((row) => row.valueRank !== null).sort((a, b) => (a.valueRank ?? 0) - (b.valueRank ?? 0));
  const byAdp = ranked.filter((row) => row.valueRank === null).sort((a, b) => (a.marketOrderRank ?? Infinity) - (b.marketOrderRank ?? Infinity));
  return [...projected, ...byAdp];
}

function rowToCsv(row: BoardRow, rank: number, scoringLabel: string): string {
  const fields = [
    rank,
    row.name,
    row.team,
    row.position,
    row.byeWeek,
    // The board numbers tiers from zero; a person reads the top tier as tier 1.
    row.tier === null ? null : row.tier + 1,
    scoringLabel,
    row.projectedPoints === null ? null : row.projectedPoints.toFixed(1),
    row.valueOverReplacement === null ? null : row.valueOverReplacement.toFixed(1),
    row.marketAdp === null ? null : row.marketAdp.toFixed(1),
  ];
  return fields.map(csvField).join(",");
}

/** The whole file as lines, header first: the rows in board order, each naming its scoring. Pure,
 *  so a test can pin the format column without a database. */
export function exportLines(rows: readonly BoardRow[], format: BoardFormat): readonly string[] {
  const label = BOARD_FORMAT_SPECS[format].label;
  return [EXPORT_HEADER.join(","), ...inBoardOrder(rows).map((row, index) => rowToCsv(row, index + 1, label))];
}

async function main(): Promise<void> {
  const { format, outfile } = parseExportArguments(process.argv.slice(2));
  const db = createDb(requireEnv("DATABASE_URL"));
  const rows = await boardRows(db, { shape: EXPORT_SHAPE, format });
  const lines = exportLines(rows, format);
  writeFileSync(outfile, `${lines.join("\n")}\n`);
  console.log(`Wrote ${lines.length - 1} ranked players (${BOARD_FORMAT_SPECS[format].label}) to ${outfile}.`);
  await db.$client.end();
}

// Runs `main` only when this file is the process entry point, never when a test imports
// `exportLines` — the identical guard `scripts/board-top.ts` carries for the identical reason.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
