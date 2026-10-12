import { and, asc, eq, sql } from "drizzle-orm";
import type { Db, DbTx } from "@research/db/client";
import { draftSheetEntries, draftSheets } from "@/db/schema";
import type { Sheet, SheetEntry, SheetEntryInput, SheetSummary, SheetTag, SheetWithEntries } from "./types";

/**
 * MY SHEET'S SERVICE LAYER (spec §4, §10) — every read and write the sheet store makes, behind
 * one seam so the CRUD API (`/api/draft/sheets/**`), the sheet page, and the room's SHEET drawer
 * tab all go through the identical rank/ownership discipline rather than three copies of it.
 *
 * OWNERSHIP IS CHECKED HERE, ON EVERY READ AND WRITE, by requiring the caller's `userId` and
 * filtering every query on `draft_sheets.user_id = userId` — never trusted from a route param
 * alone. A sheet id that exists but belongs to somebody else reads exactly like a sheet id that
 * does not exist (`null`/`false`), the same non-oracle discipline `setDraftKickoff` already
 * holds for a league's commissioner-only actions: a stranger learns nothing about whether the
 * row exists.
 *
 * RANK IS NEVER CALLER-SUPPLIED. Every write that touches order (`reorderEntries`, `replaceEntries`,
 * `appendEntry`) assigns 1-based, dense ranks from array position server-side, so a sheet can
 * never store a gap or a duplicate rank no matter what a client sends.
 */

function rowToSheet(row: typeof draftSheets.$inferSelect): Sheet {
  return {
    id: row.id,
    userId: row.userId,
    leagueId: row.leagueId,
    name: row.name,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function rowToEntry(row: typeof draftSheetEntries.$inferSelect): SheetEntry {
  return {
    id: row.id,
    playerId: row.playerId,
    rank: row.rank,
    tierLabel: row.tierLabel,
    note: row.note,
    tag: row.tag as SheetTag | null,
  };
}

/** Every sheet a user owns, newest first, with its own entry count — the picker's own read. */
export async function listSheets(db: Db, userId: string): Promise<readonly SheetSummary[]> {
  const rows = await db
    .select({ sheet: draftSheets, entryCount: sql<number>`count(${draftSheetEntries.id})::int` })
    .from(draftSheets)
    .leftJoin(draftSheetEntries, eq(draftSheetEntries.sheetId, draftSheets.id))
    .where(eq(draftSheets.userId, userId))
    .groupBy(draftSheets.id)
    .orderBy(asc(draftSheets.createdAt));
  return rows.map((row) => ({ ...rowToSheet(row.sheet), entryCount: row.entryCount }));
}

/** One sheet, owned by `userId`, with every entry in rank order — `null` for a sheet that does
 *  not exist OR belongs to somebody else, the one non-oracle answer for both. */
export async function getSheet(db: Db, userId: string, sheetId: string): Promise<SheetWithEntries | null> {
  const [sheetRow] = await db.select().from(draftSheets).where(and(eq(draftSheets.id, sheetId), eq(draftSheets.userId, userId)));
  if (sheetRow === undefined) return null;
  const entryRows = await db.select().from(draftSheetEntries).where(eq(draftSheetEntries.sheetId, sheetId)).orderBy(asc(draftSheetEntries.rank));
  return { ...rowToSheet(sheetRow), entries: entryRows.map(rowToEntry) };
}

/** Just the entry count — the HQ card's own read, cheaper than a full `getSheet` when nothing
 *  else is needed. `null` sheet id means "the caller's default sheet, if one exists yet". */
export async function sheetEntryCount(db: Db, userId: string, sheetId: string): Promise<number | null> {
  const [sheetRow] = await db.select({ id: draftSheets.id }).from(draftSheets).where(and(eq(draftSheets.id, sheetId), eq(draftSheets.userId, userId)));
  if (sheetRow === undefined) return null;
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(draftSheetEntries).where(eq(draftSheetEntries.sheetId, sheetId));
  return row?.count ?? 0;
}

/** The caller's most recently created sheet for a given league scope (`null` league is the
 *  format-default sheet) — what a page with no sheet id in the URL falls back to, and what a
 *  room with no sheet of its own offers to seed FROM. `null` when none exists yet. */
export async function defaultSheetFor(db: Db, userId: string, leagueId: string | null): Promise<SheetWithEntries | null> {
  const where = leagueId === null ? and(eq(draftSheets.userId, userId), sql`${draftSheets.leagueId} IS NULL`) : and(eq(draftSheets.userId, userId), eq(draftSheets.leagueId, leagueId));
  const [row] = await db.select().from(draftSheets).where(where).orderBy(asc(draftSheets.createdAt)).limit(1);
  if (row === undefined) return null;
  return getSheet(db, userId, row.id);
}

export interface CreateSheetInput {
  readonly name: string;
  readonly leagueId?: string | null;
}

export async function createSheet(db: Db | DbTx, userId: string, input: CreateSheetInput): Promise<Sheet> {
  const id = crypto.randomUUID();
  const [row] = await db
    .insert(draftSheets)
    .values({ id, userId, leagueId: input.leagueId ?? null, name: input.name })
    .returning();
  return rowToSheet(row!);
}

export async function renameSheet(db: Db, userId: string, sheetId: string, name: string): Promise<Sheet | null> {
  const [row] = await db
    .update(draftSheets)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(draftSheets.id, sheetId), eq(draftSheets.userId, userId)))
    .returning();
  return row === undefined ? null : rowToSheet(row);
}

/** `true` when a sheet the caller owns was actually deleted; `false` for a stranger's sheet or
 *  one that never existed — cascades to its entries via the FK. */
export async function deleteSheet(db: Db, userId: string, sheetId: string): Promise<boolean> {
  const deleted = await db
    .delete(draftSheets)
    .where(and(eq(draftSheets.id, sheetId), eq(draftSheets.userId, userId)))
    .returning({ id: draftSheets.id });
  return deleted.length > 0;
}

/** A full copy: a fresh sheet row plus every entry, same order, same notes/tags/tiers. `null`
 *  when the source sheet does not exist or is not the caller's own. */
export async function duplicateSheet(db: Db, userId: string, sheetId: string, name: string): Promise<Sheet | null> {
  const source = await getSheet(db, userId, sheetId);
  if (source === null) return null;
  return db.transaction(async (tx) => {
    const created = await createSheet(tx, userId, { name, leagueId: source.leagueId });
    if (source.entries.length > 0) {
      await tx.insert(draftSheetEntries).values(
        source.entries.map((entry) => ({
          id: crypto.randomUUID(),
          sheetId: created.id,
          playerId: entry.playerId,
          rank: entry.rank,
          tierLabel: entry.tierLabel,
          note: entry.note,
          tag: entry.tag,
        })),
      );
    }
    return created;
  });
}

async function touchSheet(db: Db | DbTx, sheetId: string): Promise<void> {
  await db.update(draftSheets).set({ updatedAt: new Date() }).where(eq(draftSheets.id, sheetId));
}

/**
 * Replaces a sheet's ENTIRE entry list, in the order given — ranks are assigned 1..N from array
 * position, always. The one write path CSV import, "seed/re-seed from the board", and "seed from
 * mock history" all share, because all three are "here is the sheet's new, whole order" rather
 * than an edit to one row. `null` when the sheet is not the caller's own.
 */
export async function replaceEntries(db: Db, userId: string, sheetId: string, entries: readonly SheetEntryInput[]): Promise<SheetWithEntries | null> {
  const owned = await db.select({ id: draftSheets.id }).from(draftSheets).where(and(eq(draftSheets.id, sheetId), eq(draftSheets.userId, userId)));
  if (owned.length === 0) return null;
  await db.transaction(async (tx) => {
    await tx.delete(draftSheetEntries).where(eq(draftSheetEntries.sheetId, sheetId));
    if (entries.length > 0) {
      await tx.insert(draftSheetEntries).values(
        entries.map((entry, index) => ({
          id: crypto.randomUUID(),
          sheetId,
          playerId: entry.playerId,
          rank: index + 1,
          tierLabel: entry.tierLabel ?? null,
          note: entry.note ?? null,
          tag: entry.tag ?? null,
        })),
      );
    }
    await touchSheet(tx, sheetId);
  });
  return getSheet(db, userId, sheetId);
}

/**
 * Re-ranks a sheet to a new player-id order. Every id in `orderedPlayerIds` that is genuinely on
 * the sheet gets the rank matching its position in the array; any existing entry NOT mentioned
 * (a client sending a stale or partial array) keeps its relative order and is appended after —
 * so a reorder call can never silently drop a row the caller's array forgot. Ids that are not on
 * the sheet at all are ignored rather than erroring, the same "a caller bug costs nothing but the
 * bug" posture `PositionBadge` takes for a non-ordinal rank.
 */
export async function reorderEntries(db: Db, userId: string, sheetId: string, orderedPlayerIds: readonly string[]): Promise<SheetWithEntries | null> {
  const sheet = await getSheet(db, userId, sheetId);
  if (sheet === null) return null;
  const byPlayer = new Map(sheet.entries.map((entry) => [entry.playerId, entry]));
  const seen = new Set<string>();
  const ordered: SheetEntry[] = [];
  for (const playerId of orderedPlayerIds) {
    const entry = byPlayer.get(playerId);
    if (entry === undefined || seen.has(playerId)) continue;
    seen.add(playerId);
    ordered.push(entry);
  }
  for (const entry of sheet.entries) {
    if (!seen.has(entry.playerId)) ordered.push(entry);
  }
  await db.transaction(async (tx) => {
    for (const [index, entry] of ordered.entries()) {
      await tx.update(draftSheetEntries).set({ rank: index + 1 }).where(eq(draftSheetEntries.id, entry.id));
    }
    await touchSheet(tx, sheetId);
  });
  return getSheet(db, userId, sheetId);
}

export interface EntryPatch {
  readonly tierLabel?: string | null;
  readonly note?: string | null;
  readonly tag?: SheetTag | null;
}

/** Adds one player at the bottom of the sheet if he is not already on it, or applies `patch` to
 *  his existing row if he is — "Add to my sheet" (spec §3) and the room's per-pick edits share
 *  this. `null` when the sheet is not the caller's own. */
export async function upsertEntry(db: Db, userId: string, sheetId: string, playerId: string, patch: EntryPatch = {}): Promise<SheetWithEntries | null> {
  const sheet = await getSheet(db, userId, sheetId);
  if (sheet === null) return null;
  const existing = sheet.entries.find((entry) => entry.playerId === playerId);
  if (existing === undefined) {
    await db.transaction(async (tx) => {
      await tx.insert(draftSheetEntries).values({
        id: crypto.randomUUID(),
        sheetId,
        playerId,
        rank: sheet.entries.length + 1,
        tierLabel: patch.tierLabel ?? null,
        note: patch.note ?? null,
        tag: patch.tag ?? null,
      });
      await touchSheet(tx, sheetId);
    });
  } else {
    await db.transaction(async (tx) => {
      await tx
        .update(draftSheetEntries)
        .set({
          tierLabel: patch.tierLabel !== undefined ? patch.tierLabel : existing.tierLabel,
          note: patch.note !== undefined ? patch.note : existing.note,
          tag: patch.tag !== undefined ? patch.tag : existing.tag,
        })
        .where(eq(draftSheetEntries.id, existing.id));
      await touchSheet(tx, sheetId);
    });
  }
  return getSheet(db, userId, sheetId);
}

/** Drops one player from the sheet and re-ranks the survivors densely, in their existing order.
 *  `null` when the sheet is not the caller's own. */
export async function removeEntry(db: Db, userId: string, sheetId: string, playerId: string): Promise<SheetWithEntries | null> {
  const sheet = await getSheet(db, userId, sheetId);
  if (sheet === null) return null;
  const survivors = sheet.entries.filter((entry) => entry.playerId !== playerId);
  await db.transaction(async (tx) => {
    await tx.delete(draftSheetEntries).where(and(eq(draftSheetEntries.sheetId, sheetId), eq(draftSheetEntries.playerId, playerId)));
    for (const [index, entry] of survivors.entries()) {
      await tx.update(draftSheetEntries).set({ rank: index + 1 }).where(eq(draftSheetEntries.id, entry.id));
    }
    await touchSheet(tx, sheetId);
  });
  return getSheet(db, userId, sheetId);
}
