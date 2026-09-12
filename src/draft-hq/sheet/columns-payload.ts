import type { Player } from "@/domain/player";
import type { BoardRow } from "@/draft-hq/board/service";
import type { SheetMark } from "@/draft-room/quilt/state/sheet-columns";
import type { SheetEntryView } from "./view";

/**
 * WHAT THE DRAFT AREA'S SHEET HANDS ITS COLUMNS (the Draft area round, 2026-09-12, founder
 * amendment 2) — the exact facts the draft room's own `SheetColumn` reads, assembled on the
 * server from the board this page already fetched, so the surface outside a room renders through
 * the SAME component rather than through a second list that would drift from it.
 *
 * Pure over rows already in hand: no query of its own, so a test can hold a board and a sheet
 * and check the ladder, the order and the numbers with no database at all.
 *
 * WHAT IS ABSENT AND WHY. There is no next pick outside a room, so there are no survival odds and
 * every row's number is `value`, points over a replacement at his position. Nothing is taken, so
 * every man is available and no band counts men left. Both absences are the honest shape of the
 * facts here, not a mode the component is put into.
 */
export interface SheetStanding {
  /** 1-based, the way a manager counts tiers out loud (`tierNumber`'s own ruling). */
  readonly tier: number;
  readonly left: number;
  readonly size: number;
  /** How far the ladder falls after this tier. Zero on the last tier, which has no next drop. */
  readonly drop: number;
}

export interface SheetColumnsPayload {
  /** The manager's own order, best first. */
  readonly order: readonly string[];
  /**
   * THE BOARD'S ORDER FOR THE MEN ON THIS SHEET — what "N of yours moved" counts against and
   * what Match our board restores.
   *
   * RESTRICTED TO THE SHEET, and that restriction is the whole correctness of the pair. A sheet
   * is a SUBSET of the board (a manager drops the men he will never draft, and the board holds
   * hundreds), and comparing a subset position-by-position against the full board counts every
   * row below the first gap as "moved" — a number nothing a manager could do would ever bring to
   * zero, on a button whose whole promise is that it does. Market-order kickers and defenses
   * ride along, because a seeded sheet holds them; the "Not on an active roster" band does not,
   * because it holds no ordering at all and a sheet never seeds from it.
   */
  readonly boardIds: readonly string[];
  readonly players: readonly Player[];
  /** Points over replacement, per player the board prices. */
  readonly values: readonly (readonly [string, number])[];
  /** His place in his POSITION's ladder, and in the board's ladder across positions. */
  readonly tiers: Readonly<Record<string, SheetStanding>>;
  readonly overallTiers: Readonly<Record<string, SheetStanding>>;
  /** The men this sheet calls targets. They wear the row's amber edge flag, the same mark a
   *  queued player wears in a room — one channel for "yours", never a second colour. */
  readonly targets: readonly string[];
  /** What the manager wrote on each man he wrote anything on: his note, his tag, his own tier
   *  label. Only the rows that carry one, so an untouched sheet ships an empty list. */
  readonly marks: readonly (readonly [string, SheetMark])[];
}

function playerOf(row: BoardRow): Player {
  return { id: row.playerId, name: row.name, position: row.position, nflTeam: row.team, headshotUrl: row.headshotUrl, adp: row.marketAdp };
}

function standingOf(tier: number | null, left: number | null, drop: number | null): SheetStanding | null {
  if (tier === null) return null;
  // `left` and `size` are the ROOM's own live fields (how many of this tier are still on the
  // board). Nothing is taken outside a room, so a band here counts its own rows and reads only
  // `tier` and `drop` off this standing; both are filled honestly rather than left to a caller to
  // guess at — `playersLeftInTier` is the board's "left, him included", which on the first man of
  // a tier is the tier's own size.
  return { tier: tier + 1, left: left ?? 0, size: left ?? 0, drop: drop ?? 0 };
}

/**
 * `entries` is the sheet in the manager's order; `board` is the board under his own league shape.
 * A player on the sheet the board never priced still gets his real identity from the entry itself
 * (`SheetEntryView` already resolved it), just no number and no tier — the sheet is allowed to
 * hold a man the engine has no opinion about, and the row says so with a dash.
 */
export function sheetColumnsPayload(entries: readonly SheetEntryView[], board: readonly BoardRow[]): SheetColumnsPayload {
  const byId = new Map(board.map((row) => [row.playerId, row] as const));
  const onSheet = new Set(entries.map((entry) => entry.playerId));
  const players: Player[] = [];
  const values: (readonly [string, number])[] = [];
  const tiers: Record<string, SheetStanding> = {};
  const overallTiers: Record<string, SheetStanding> = {};

  for (const entry of entries) {
    const row = byId.get(entry.playerId);
    players.push(
      row === undefined
        ? { id: entry.playerId, name: entry.name, position: entry.position, nflTeam: entry.team, headshotUrl: null, adp: null }
        : playerOf(row),
    );
    if (row === undefined) continue;
    if (row.valueOverReplacement !== null) values.push([row.playerId, row.valueOverReplacement]);
    const position = standingOf(row.tier, row.playersLeftInTier, row.dropToNextTier);
    if (position !== null) tiers[row.playerId] = position;
    const overall = standingOf(row.overallTier, row.overallPlayersLeftInTier, row.overallDropToNextTier);
    if (overall !== null) overallTiers[row.playerId] = overall;
  }

  return {
    order: entries.map((entry) => entry.playerId),
    boardIds: board.filter((row) => row.rosterStatus?.excluded !== true && onSheet.has(row.playerId)).map((row) => row.playerId),
    players,
    values,
    tiers,
    overallTiers,
    targets: entries.filter((entry) => entry.tag === "target").map((entry) => entry.playerId),
    marks: entries
      .filter((entry) => entry.note !== null || entry.tag !== null || entry.tierLabel !== null)
      .map((entry) => [entry.playerId, { note: entry.note, tag: entry.tag, tierLabel: entry.tierLabel }] as const),
  };
}
