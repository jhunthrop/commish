import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players as playersTable } from "@/db/schema";
import type { Position } from "@/domain/player";
import { boardRows, isProjectedRow, type BoardOptions, type BoardRow } from "@/draft-hq/board/service";
import { byeWeeksByTeam } from "@/league-service/nfl-schedule";
import type { SheetEntry, SheetWithEntries } from "./types";

/**
 * MY SHEET'S SERVER-SIDE READ MODEL — joins a sheet's own entries to real player identity (name,
 * position, team, bye) and the evidence board's own opinion (rank, whether it disagrees with the
 * manager's own order), all fetched once per page render so the client component never has to.
 */
export interface SheetEntryView extends SheetEntry {
  readonly name: string;
  readonly position: Position;
  readonly team: string;
  readonly byeWeek: number | null;
  /** The evidence board's own overall rank for this player, or `null` when he is not on it
   *  (unresolved crosswalk, or a position this shape does not start). Never invented. */
  readonly boardRank: number | null;
}

export interface BoardOption {
  readonly playerId: string;
  readonly name: string;
  readonly position: Position;
  readonly team: string;
  readonly rank: number;
}

const BOARD_OPTIONS_LIMIT = 300;

/**
 * Every entry on a sheet, with real identity and the board's own rank layered on — a player the
 * board never ranked (a deep sleeper, an unresolved crosswalk) still gets his real name and team
 * from the product's own player directory, just no `boardRank` to compare against.
 */
export async function sheetEntryViews(
  db: Db,
  sheet: SheetWithEntries,
  // THE SHEET READS THE BOARD THE PAGE'S OWN CONTEXT NAMES (fix round 1, H3): the same
  // `{shape, leagueId, format}` triple the Board stop hands `boardRows`, so a player's number is
  // the same number on both stops. It used to be a shape alone, which silently meant "league-free".
  options: BoardOptions,
): Promise<{ readonly entries: readonly SheetEntryView[]; readonly board: readonly BoardRow[] }> {
  const board = await boardRows(db, options);
  const boardById = new Map(board.map((row) => [row.playerId, row]));

  const missingIds = sheet.entries.map((entry) => entry.playerId).filter((id) => !boardById.has(id));
  const missingRows =
    missingIds.length === 0
      ? []
      : await db
          .select({ id: playersTable.id, name: playersTable.name, position: playersTable.position, team: playersTable.nflTeam })
          .from(playersTable)
          .where(inArray(playersTable.id, missingIds));
  const byes = missingRows.length === 0 ? new Map<string, number>() : await byeWeeksByTeam(db);
  const missingById = new Map(missingRows.map((row) => [row.id, row]));

  const entries: SheetEntryView[] = sheet.entries.map((entry) => {
    const boardRow = boardById.get(entry.playerId);
    if (boardRow !== undefined) {
      return { ...entry, name: boardRow.name, position: boardRow.position, team: boardRow.team, byeWeek: boardRow.byeWeek, boardRank: boardRow.rank };
    }
    const fallback = missingById.get(entry.playerId);
    if (fallback === undefined) {
      // A sheet entry the product's own player directory no longer carries at all — dropped
      // upstream, or a corrupted id. Render him honestly rather than inventing a name.
      return { ...entry, name: "Unknown player", position: "DEF", team: "", byeWeek: null, boardRank: null };
    }
    return { ...entry, name: fallback.name, position: fallback.position, team: fallback.team, byeWeek: byes.get(fallback.team) ?? null, boardRank: null };
  });

  return { entries, board };
}

/**
 * PROJECTED ROWS ONLY (the 2026-09-05 kicker and team defence round). `BoardOption.rank` is the
 * shipped board's own rank, and a market-order row has none, so it cannot be an option under this
 * shape without inventing one.
 *
 * NOT A REGRESSION: before that round these two positions had no board rows at all, so they were
 * never in this picker either. Letting a manager add one from here is a real feature and needs
 * `BoardOption.rank` to become nullable along with every surface that renders it, which is a
 * separate change from putting the positions on the board.
 */
export function boardOptionsFrom(board: readonly BoardRow[], limit: number = BOARD_OPTIONS_LIMIT): readonly BoardOption[] {
  return board
    .filter(isProjectedRow)
    .slice(0, limit)
    .map((row) => ({ playerId: row.playerId, name: row.name, position: row.position, team: row.team, rank: row.rank }));
}
