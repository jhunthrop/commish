import { NFL_TEAM_NAMES } from "@/domain/nfl-team-names";
import type { BoardRow } from "@/draft-hq/board/service";
import { isProjectedRow } from "@/draft-hq/board/service";
import type { MatchFields } from "./match";
import { normalizeSearchText } from "./normalize";
import type { SearchResult } from "./contract";

/**
 * THE INDEX'S ROWS, BUILT FROM THE BOARD AND THE TEAM TABLE. Pure: `service.ts` reads the board
 * and hands the rows here; nothing in this file knows a database exists.
 *
 * ONE ENTRY PER BOARD ROW AND ONE PER TEAM, each carrying the words it may be found by
 * (`fields`, already normalized so the matcher never folds a string twice), the result the overlay
 * renders, and `order`, the tie-break among equally strong matches: the served board first
 * (projected rows in `overallRank` order), then the 32 teams, then the market-order kickers and
 * defenses. That ordering is what puts Ja'Marr Chase above Jacksonville on "ja" and Jacksonville
 * above a kicker, without a magic number anywhere: each block's offset is the size of the block
 * before it.
 *
 * A TEAM'S NAME WORDS ARE ITS CITY, ITS NICKNAME AND ITS CODE, so "det", "detroit" and "lions" all
 * find the Lions page at the name priority. A code `NFL_TEAM_NAMES` does not hold makes no team
 * entry at all: the name is the entry, and this file invents none.
 */

export interface SearchEntry {
  readonly fields: MatchFields;
  readonly result: SearchResult;
  /** Sort position among equally strong matches; lower first. */
  readonly order: number;
}

/** Normalized words a player may be found by through his club. Empty for a code the table lacks. */
function teamWordsFor(code: string): readonly string[] {
  const names = NFL_TEAM_NAMES[code.toUpperCase()];
  if (names === undefined) return code === "" ? [] : [normalizeSearchText(code)];
  return [normalizeSearchText(code), normalizeSearchText(names.city), normalizeSearchText(names.nickname)];
}

function playerEntry(row: BoardRow, order: number): SearchEntry {
  return {
    fields: { name: normalizeSearchText(row.name), team: teamWordsFor(row.team), position: normalizeSearchText(row.position) },
    result: {
      kind: "player",
      player: { id: row.playerId, name: row.name, position: row.position, nflTeam: row.team, headshotUrl: row.headshotUrl, adp: row.marketAdp },
      positionRank: row.positionRankInValue ?? row.marketOrderRank,
      boardRank: row.overallRank,
      byeWeek: row.byeWeek,
      rosterStatus: row.rosterStatus,
    },
    order,
  };
}

function teamEntry(code: string, byeWeek: number | null, order: number): SearchEntry | null {
  const names = NFL_TEAM_NAMES[code];
  if (names === undefined) return null;
  const name = `${names.city} ${names.nickname}`;
  return {
    fields: { name: normalizeSearchText(`${name} ${code}`), team: [], position: null },
    result: { kind: "team", code, name, byeWeek },
    order,
  };
}

/** Every entry the index searches, from the served board rows and the product's team codes. */
export function searchEntriesFor(rows: readonly BoardRow[], teamCodes: readonly string[], byes: ReadonlyMap<string, number>): readonly SearchEntry[] {
  const projected = rows.filter(isProjectedRow);
  const marketOrder = rows.filter((row) => !isProjectedRow(row));
  const teams = teamCodes.flatMap((code, index) => {
    const entry = teamEntry(code, byes.get(code) ?? null, projected.length + index);
    return entry === null ? [] : [entry];
  });
  return [
    ...projected.map((row, index) => playerEntry(row, index)),
    ...teams,
    ...marketOrder.map((row, index) => playerEntry(row, projected.length + teams.length + index)),
  ];
}
