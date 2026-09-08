// One-shot: the board in draft order as a CSV a manager can paste into another site's custom
// rankings tool (rank, player, team, position, bye, tier, our projection, ADP). Projected
// positions come first in value order, then K and DEF in ADP order, exactly as the board shows.
// (dotenv -e .env.local -- tsx scripts/rankings-export.ts [outfile])
import { writeFileSync } from "node:fs";
import { createDb } from "@/db/client";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { boardRows, type BoardRow } from "@/draft-hq/board/service";

const DEFAULT_OUTFILE = "commish-rankings.csv";
const EXPORT_SHAPE = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS } as const;
const HEADER = ["Rank", "Player", "Team", "Pos", "Bye", "Tier", "Proj Pts", "ADP"] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set. Run this through \`npm run rankings:export\`, which loads .env.local.`);
  }
  return value;
}

function csvField(value: string | number | null): string {
  if (value === null) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Board order: value order for projected rows, then the ADP-ordered rows behind them. */
function inBoardOrder(rows: readonly BoardRow[]): readonly BoardRow[] {
  const projected = rows.filter((row) => row.valueRank !== null).sort((a, b) => (a.valueRank ?? 0) - (b.valueRank ?? 0));
  const byAdp = rows.filter((row) => row.valueRank === null).sort((a, b) => (a.marketOrderRank ?? Infinity) - (b.marketOrderRank ?? Infinity));
  return [...projected, ...byAdp];
}

function rowToCsv(row: BoardRow, rank: number): string {
  const fields = [
    rank,
    row.name,
    row.team,
    row.position,
    row.byeWeek,
    // The board numbers tiers from zero; a person reads the top tier as tier 1.
    row.tier === null ? null : row.tier + 1,
    row.projectedPoints === null ? null : row.projectedPoints.toFixed(1),
    row.marketAdp === null ? null : row.marketAdp.toFixed(1),
  ];
  return fields.map(csvField).join(",");
}

async function main(): Promise<void> {
  const outfile = process.argv[2] ?? DEFAULT_OUTFILE;
  const db = createDb(requireEnv("DATABASE_URL"));
  const rows = inBoardOrder(await boardRows(db, { shape: EXPORT_SHAPE }));
  const lines = [HEADER.join(","), ...rows.map((row, index) => rowToCsv(row, index + 1))];
  writeFileSync(outfile, `${lines.join("\n")}\n`);
  console.log(`Wrote ${rows.length} ranked players to ${outfile}.`);
  await db.$client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
