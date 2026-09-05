import { inArray } from "drizzle-orm";
import type { Db } from "@/db/client";
import { players as playersTable } from "@/db/schema";
import type { Position } from "@/domain/player";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@/domain/roster";
import { boardRows, type BoardRow } from "@/draft-hq/board/service";
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

function shapeFor(rosterSlots: readonly RosterSlotConfig[] | null, teamCount: number | null): { readonly teamCount: number; readonly rosterSlots: readonly RosterSlotConfig[] } {
  return { teamCount: teamCount ?? 12, rosterSlots: rosterSlots ?? STANDARD_ROSTER_SLOTS };
}

/**
 * Every entry on a sheet, with real identity and the board's own rank layered on — a player the
 * board never ranked (a deep sleeper, an unresolved crosswalk) still gets his real name and team
 * from the product's own player directory, just no `boardRank` to compare against.
 */
export async function sheetEntryViews(
  db: Db,
  sheet: SheetWithEntries,
  leagueShape: { readonly rosterSlots: readonly RosterSlotConfig[] | null; readonly teamCount: number | null } | null,
): Promise<{ readonly entries: readonly SheetEntryView[]; readonly board: readonly BoardRow[] }> {
  const shape = shapeFor(leagueShape?.rosterSlots ?? null, leagueShape?.teamCount ?? null);
  const board = await boardRows(db, { shape });
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

export function boardOptionsFrom(board: readonly BoardRow[], limit: number = BOARD_OPTIONS_LIMIT): readonly BoardOption[] {
  return board.slice(0, limit).map((row) => ({ playerId: row.playerId, name: row.name, position: row.position, team: row.team, rank: row.rank }));
}
