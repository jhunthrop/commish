import type { Db } from "@research-ts/db/client";
import { GENERIC_BOARD_SHAPE } from "@research-ts/board/generic-board";
import { boardRows } from "@research-ts/board/service";
import { seedOrderFrom } from "@/draft-room/quilt/state/sheet-seed";
import { completedMockRoomsQuery, mockDebriefDeps } from "@/mock-draft-service/debrief";
import type { SheetEntryInput } from "./types";

/**
 * MY SHEET'S TWO SEED SOURCES (spec §4) — "seed from the evidence board" and "seed from your
 * mock history," both producing a plain `SheetEntryInput[]` the caller then hands to
 * `replaceEntries` or appends via a bulk write. Neither writes to the database itself: seeding is
 * a READ that proposes an order, and the API route decides whether it replaces or merges.
 */

const DEFAULT_BOARD_SEED_LIMIT = 200;

/** The top of the default (generic PPR, 12-team) evidence board, in its own rank order — a
 *  league-scoped seed would need the caller's own league shape, which the route layer supplies
 *  by calling `boardRows` directly with that shape instead when one is available; this helper is
 *  the no-league-context default. */
export async function seedFromBoard(db: Db, limit: number = DEFAULT_BOARD_SEED_LIMIT): Promise<readonly SheetEntryInput[]> {
  const rows = await boardRows(db, { shape: GENERIC_BOARD_SHAPE });
  return rows.slice(0, limit).map((row) => ({ playerId: row.playerId }));
}

/**
 * THE MOCK-HISTORY SEED (spec §4: "the user's mock history, existing sheet-seed logic") — reuses
 * `@/draft-room/quilt/state/sheet-seed`'s own `seedOrderFrom` unchanged: the caller's own picks
 * from their most recent COMPLETED mock, in pick order, then the rest of that mock's own board in
 * board order. `null` when the caller has no completed mock to seed from.
 */
export async function seedFromMockHistory(db: Db, userId: string): Promise<readonly SheetEntryInput[] | null> {
  const [room] = await completedMockRoomsQuery(db, userId);
  if (room === undefined) return null;
  const deps = mockDebriefDeps(db);
  const [view, players] = await Promise.all([deps.loadView(room.draftId), deps.loadPlayers(room.leagueId)]);
  if (view === null || players.length === 0) return null;
  const myPickPlayerIds = view.picks
    .filter((pick) => pick.teamId === room.teamId)
    .sort((a, b) => a.pickNumber - b.pickNumber)
    .map((pick) => pick.playerId);
  const boardIds = players.map((player) => player.id);
  return seedOrderFrom(myPickPlayerIds, boardIds).map((playerId) => ({ playerId }));
}
