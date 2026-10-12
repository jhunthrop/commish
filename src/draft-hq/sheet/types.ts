/**
 * MY SHEET'S SERVER SHAPE (spec §4, §10) — shared by the service layer, the CRUD API, the sheet
 * page and the room's SHEET drawer tab, so the four of them can never carry four slightly
 * different ideas of what an entry is.
 */

/** The three tags spec §4 names, worded in the enum as `avoid`/`never` (`@research/db/schema`'s
 *  `draftSheetTagEnum`) — this is the presentation spelling every surface renders. */
export type SheetTag = "target" | "avoid" | "never";

export const SHEET_TAG_LABEL: Readonly<Record<SheetTag, string>> = {
  target: "Target",
  avoid: "Avoid early",
  never: "Never draft",
};

/** One row on a sheet — the manager's own rank plus whatever he attached to that player. */
export interface SheetEntry {
  readonly id: string;
  readonly playerId: string;
  /** 1-based, dense, unique within the sheet. */
  readonly rank: number;
  readonly tierLabel: string | null;
  readonly note: string | null;
  readonly tag: SheetTag | null;
}

export interface Sheet {
  readonly id: string;
  readonly userId: string;
  readonly leagueId: string | null;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SheetWithEntries extends Sheet {
  readonly entries: readonly SheetEntry[];
}

/** The sheet picker's own row — no entries, just enough to list and choose. */
export interface SheetSummary extends Sheet {
  readonly entryCount: number;
}

/** A caller-supplied entry write — `rank` is assigned by the service from array position, never
 *  trusted from the caller, so a write can never produce a gap or a duplicate. */
export interface SheetEntryInput {
  readonly playerId: string;
  readonly tierLabel?: string | null;
  readonly note?: string | null;
  readonly tag?: SheetTag | null;
}
