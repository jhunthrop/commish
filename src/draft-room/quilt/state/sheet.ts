/**
 * MY SHEET — the manager's editable copy of our board (the `SheetAndLens` mock's bottom half).
 *
 * The model is deliberately tiny: an ORDER (player ids, the manager's own ranking) and NOTES
 * (player id → the manager's own words). Everything else on the sheet's rows — position, ADP,
 * "you N · board M", drafted strikethrough — is derived at render time from the room's own data,
 * so the sheet can never disagree with the room about a fact.
 *
 * PERSISTENCE IS THE BROWSER'S (`localStorage`, via the codec below), a recorded judgment call:
 * no server table for draft prep exists, and the room's own private-plan object (the autopick
 * queue) is where sheet order becomes something the server honors — `sheetQueueSeed` below is
 * that bridge. Losing a sheet to a cleared browser loses prep words, never money or picks.
 */
export interface CheatSheet {
  /** The manager's own order, best first. Always a permutation of the board the room served. */
  readonly order: readonly string[];
  /** Player id → the manager's own note. Absence is "no note"; the empty string never persists. */
  readonly notes: Readonly<Record<string, string>>;
}

/** A fresh sheet is the board itself — the user's copy starts as our copy. */
export function seedSheet(boardIds: readonly string[]): CheatSheet {
  return { order: boardIds, notes: {} };
}

/**
 * A stored sheet meets today's board: ids the board no longer serves drop out (their notes too),
 * and board ids the sheet has never seen enter at their board position among the survivors —
 * a new arrival slots in where we rank him rather than hiding at the bottom of a prep list
 * written before he existed.
 */
export function reconcileSheet(sheet: CheatSheet, boardIds: readonly string[]): CheatSheet {
  const board = new Map(boardIds.map((id, index) => [id, index]));
  const kept = sheet.order.filter((id) => board.has(id));
  const known = new Set(kept);
  const order = [...kept];
  // Insert each unseen board id at its board index, clamped — walked in board order so two
  // arrivals keep their own relative order.
  for (const [id, index] of board) {
    if (known.has(id)) continue;
    order.splice(Math.min(index, order.length), 0, id);
  }
  const notes = Object.fromEntries(Object.entries(sheet.notes).filter(([id]) => board.has(id)));
  return { order, notes };
}

/** Move a player `delta` places (negative is up). Off-list ids and no-op moves return the sheet. */
export function moveInSheet(sheet: CheatSheet, playerId: string, delta: number): CheatSheet {
  const from = sheet.order.indexOf(playerId);
  if (from === -1) return sheet;
  const to = Math.max(0, Math.min(sheet.order.length - 1, from + delta));
  if (to === from) return sheet;
  const order = [...sheet.order];
  order.splice(from, 1);
  order.splice(to, 0, playerId);
  return { ...sheet, order };
}

/** Set (or, with an empty string, clear) the manager's note for a player. */
export function setSheetNote(sheet: CheatSheet, playerId: string, note: string): CheatSheet {
  const trimmed = note.trim();
  if (trimmed === "") {
    const rest = Object.fromEntries(Object.entries(sheet.notes).filter(([id]) => id !== playerId));
    return { ...sheet, notes: rest };
  }
  return { ...sheet, notes: { ...sheet.notes, [playerId]: trimmed } };
}

/** The queue pre-seed: the sheet's top `count` still-undrafted players, sheet order. */
export function sheetQueueSeed(sheet: CheatSheet, available: ReadonlySet<string>, count: number): readonly string[] {
  return sheet.order.filter((id) => available.has(id)).slice(0, count);
}

/** playerId → 1-based sheet rank, for the "you N · board M" comparison everywhere it prints. */
export function sheetRanks(sheet: CheatSheet): ReadonlyMap<string, number> {
  return new Map(sheet.order.map((id, index) => [id, index + 1]));
}

/** The storage codec. `decodeSheet` trusts nothing: any malformed shape reads as "no sheet". */
export function encodeSheet(sheet: CheatSheet): string {
  return JSON.stringify(sheet);
}

export function decodeSheet(raw: string | null): CheatSheet | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { order, notes } = parsed as { order?: unknown; notes?: unknown };
    if (!Array.isArray(order) || !order.every((id): id is string => typeof id === "string")) return null;
    if (typeof notes !== "object" || notes === null) return null;
    if (!Object.values(notes).every((note) => typeof note === "string")) return null;
    return { order, notes: notes as Readonly<Record<string, string>> };
  } catch {
    return null;
  }
}
