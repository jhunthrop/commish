import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, players, teams, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import {
  createSheet,
  defaultSheetFor,
  deleteSheet,
  duplicateSheet,
  getSheet,
  listSheets,
  removeEntry,
  renameSheet,
  reorderEntries,
  replaceEntries,
  sheetEntryCount,
  upsertEntry,
} from "./service";

/**
 * FULL COVERAGE OF THE SHEET STORE'S SERVICE LAYER (spec §4, §10) — every read and write the
 * CRUD API (`/api/draft/sheets/**`), the sheet page, and the room's SHEET tab will all go
 * through, DB-backed rather than mocked: the ownership filter and the rank arithmetic are both
 * genuinely SQL, and a mock would only prove the mock agrees with itself.
 */
describe("draft sheet service", () => {
  let db: Db;
  const USER_A = "user-a";
  const USER_B = "user-b";
  const LEAGUE_ID = "league-1";
  const PLAYER_1 = "player-1";
  const PLAYER_2 = "player-2";
  const PLAYER_3 = "player-3";

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(users).values([
      { id: USER_A, displayName: "A", email: "a@example.com" },
      { id: USER_B, displayName: "B", email: "b@example.com" },
    ]);
    await db.insert(leagues).values({ id: LEAGUE_ID, name: "Test League", format: "snake", teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, commissionerUserId: USER_A });
    await db.insert(teams).values({ id: "team-a", leagueId: LEAGUE_ID, userId: USER_A, name: "A's team" });
    await db.insert(players).values([
      { id: PLAYER_1, name: "Player One", position: "RB", nflTeam: "SF" },
      { id: PLAYER_2, name: "Player Two", position: "WR", nflTeam: "DAL" },
      { id: PLAYER_3, name: "Player Three", position: "QB", nflTeam: "MIA" },
    ]);
  });

  afterEach(async () => {
    await truncateAll(db);
  });

  describe("createSheet / listSheets / getSheet", () => {
    it("creates an empty sheet and lists it with a zero entry count", async () => {
      const sheet = await createSheet(db, USER_A, { name: "My board" });
      expect(sheet.userId).toBe(USER_A);
      expect(sheet.leagueId).toBeNull();

      const summaries = await listSheets(db, USER_A);
      expect(summaries).toHaveLength(1);
      expect(summaries[0]).toMatchObject({ id: sheet.id, name: "My board", entryCount: 0 });
    });

    it("scopes a sheet to a league when one is given", async () => {
      const sheet = await createSheet(db, USER_A, { name: "League sheet", leagueId: LEAGUE_ID });
      expect(sheet.leagueId).toBe(LEAGUE_ID);
    });

    it("never lists or reads another user's sheet — ownership is the one non-oracle answer", async () => {
      const sheet = await createSheet(db, USER_A, { name: "A's sheet" });
      expect(await listSheets(db, USER_B)).toEqual([]);
      expect(await getSheet(db, USER_B, sheet.id)).toBeNull();
      expect(await getSheet(db, USER_A, sheet.id)).not.toBeNull();
    });

    it("answers null for a sheet id that does not exist at all", async () => {
      expect(await getSheet(db, USER_A, "no-such-sheet")).toBeNull();
    });
  });

  describe("renameSheet / deleteSheet / duplicateSheet", () => {
    it("renames a sheet the caller owns", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Old name" });
      const renamed = await renameSheet(db, USER_A, sheet.id, "New name");
      expect(renamed?.name).toBe("New name");
    });

    it("refuses to rename a stranger's sheet", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Mine" });
      expect(await renameSheet(db, USER_B, sheet.id, "Stolen")).toBeNull();
      expect((await getSheet(db, USER_A, sheet.id))?.name).toBe("Mine");
    });

    it("deletes a sheet and cascades its entries", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Doomed" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }]);
      expect(await deleteSheet(db, USER_A, sheet.id)).toBe(true);
      expect(await getSheet(db, USER_A, sheet.id)).toBeNull();
    });

    it("returns false deleting a sheet that is not the caller's own", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Mine" });
      expect(await deleteSheet(db, USER_B, sheet.id)).toBe(false);
    });

    it("duplicates a sheet's whole order, notes, tags and tiers under a fresh id", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Original", leagueId: LEAGUE_ID });
      await replaceEntries(db, USER_A, sheet.id, [
        { playerId: PLAYER_1, tierLabel: "Tier 1", note: "love him", tag: "target" },
        { playerId: PLAYER_2 },
      ]);
      const copy = await duplicateSheet(db, USER_A, sheet.id, "Copy");
      expect(copy).not.toBeNull();
      expect(copy!.id).not.toBe(sheet.id);
      expect(copy!.leagueId).toBe(LEAGUE_ID);
      const withEntries = await getSheet(db, USER_A, copy!.id);
      expect(withEntries?.entries).toEqual([
        expect.objectContaining({ playerId: PLAYER_1, rank: 1, tierLabel: "Tier 1", note: "love him", tag: "target" }),
        expect.objectContaining({ playerId: PLAYER_2, rank: 2 }),
      ]);
    });
  });

  describe("replaceEntries", () => {
    it("assigns dense 1-based ranks from array position", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      const result = await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_2 }, { playerId: PLAYER_1 }, { playerId: PLAYER_3 }]);
      expect(result?.entries.map((entry) => [entry.playerId, entry.rank])).toEqual([
        [PLAYER_2, 1],
        [PLAYER_1, 2],
        [PLAYER_3, 3],
      ]);
    });

    it("wholly replaces a prior entry list rather than merging with it", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }, { playerId: PLAYER_2 }]);
      const result = await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_3 }]);
      expect(result?.entries.map((entry) => entry.playerId)).toEqual([PLAYER_3]);
    });

    it("null for a sheet that is not the caller's own", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      expect(await replaceEntries(db, USER_B, sheet.id, [{ playerId: PLAYER_1 }])).toBeNull();
    });
  });

  describe("reorderEntries", () => {
    it("re-ranks to the given order", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }, { playerId: PLAYER_2 }, { playerId: PLAYER_3 }]);
      const result = await reorderEntries(db, USER_A, sheet.id, [PLAYER_3, PLAYER_1, PLAYER_2]);
      expect(result?.entries.map((entry) => entry.playerId)).toEqual([PLAYER_3, PLAYER_1, PLAYER_2]);
    });

    it("appends any existing entry the given order forgot, rather than dropping it", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }, { playerId: PLAYER_2 }, { playerId: PLAYER_3 }]);
      const result = await reorderEntries(db, USER_A, sheet.id, [PLAYER_2]);
      expect(result?.entries.map((entry) => entry.playerId)).toEqual([PLAYER_2, PLAYER_1, PLAYER_3]);
    });

    it("ignores an id in the order that is not actually on the sheet", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }]);
      const result = await reorderEntries(db, USER_A, sheet.id, ["not-on-sheet", PLAYER_1]);
      expect(result?.entries.map((entry) => entry.playerId)).toEqual([PLAYER_1]);
    });
  });

  describe("upsertEntry", () => {
    it("appends a new player at the bottom of the sheet", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }]);
      const result = await upsertEntry(db, USER_A, sheet.id, PLAYER_2, { tag: "target" });
      expect(result?.entries.map((entry) => [entry.playerId, entry.rank, entry.tag])).toEqual([
        [PLAYER_1, 1, null],
        [PLAYER_2, 2, "target"],
      ]);
    });

    it("edits an existing entry's tier/note/tag in place, without moving its rank", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }, { playerId: PLAYER_2 }]);
      const result = await upsertEntry(db, USER_A, sheet.id, PLAYER_1, { note: "sleeper", tag: "avoid" });
      const entry = result?.entries.find((row) => row.playerId === PLAYER_1);
      expect(entry).toMatchObject({ rank: 1, note: "sleeper", tag: "avoid" });
    });

    it("leaves fields the patch omits untouched", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1, note: "keep me", tag: "target" }]);
      const result = await upsertEntry(db, USER_A, sheet.id, PLAYER_1, { tierLabel: "Tier 1" });
      const entry = result?.entries[0];
      expect(entry).toMatchObject({ note: "keep me", tag: "target", tierLabel: "Tier 1" });
    });
  });

  describe("removeEntry", () => {
    it("drops the player and closes the rank gap behind him", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }, { playerId: PLAYER_2 }, { playerId: PLAYER_3 }]);
      const result = await removeEntry(db, USER_A, sheet.id, PLAYER_2);
      expect(result?.entries.map((entry) => [entry.playerId, entry.rank])).toEqual([
        [PLAYER_1, 1],
        [PLAYER_3, 2],
      ]);
    });

    it("is a no-op removal of a player who was never on the sheet", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }]);
      const result = await removeEntry(db, USER_A, sheet.id, PLAYER_2);
      expect(result?.entries.map((entry) => entry.playerId)).toEqual([PLAYER_1]);
    });
  });

  describe("sheetEntryCount / defaultSheetFor", () => {
    it("counts entries without loading the full sheet", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      await replaceEntries(db, USER_A, sheet.id, [{ playerId: PLAYER_1 }, { playerId: PLAYER_2 }]);
      expect(await sheetEntryCount(db, USER_A, sheet.id)).toBe(2);
    });

    it("answers null for a sheet id that is not the caller's own", async () => {
      const sheet = await createSheet(db, USER_A, { name: "Sheet" });
      expect(await sheetEntryCount(db, USER_B, sheet.id)).toBeNull();
    });

    it("finds the caller's own format-default (no-league) sheet", async () => {
      expect(await defaultSheetFor(db, USER_A, null)).toBeNull();
      const sheet = await createSheet(db, USER_A, { name: "Default" });
      const found = await defaultSheetFor(db, USER_A, null);
      expect(found?.id).toBe(sheet.id);
    });

    it("finds the caller's own league-scoped sheet, never a different league's", async () => {
      const sheet = await createSheet(db, USER_A, { name: "League sheet", leagueId: LEAGUE_ID });
      expect((await defaultSheetFor(db, USER_A, LEAGUE_ID))?.id).toBe(sheet.id);
      expect(await defaultSheetFor(db, USER_A, "some-other-league")).toBeNull();
    });
  });
});
