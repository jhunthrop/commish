import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { adpSnapshots, nflPlayers, playerCrosswalk, players, preseasonRosters } from "@/db/schema";
import type { FfcResponse } from "@/projections/preseason/publishers";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { ADP_SNAPSHOT_CONFIG, adpSnapshotHistory, ingestAdpSnapshot } from "./adp-snapshot";

/** A fixture `fetch` standing in for Fantasy Football Calculator's live feed, exactly like
 *  `publishers.test.ts`'s own fixtures — this suite never touches the network. */
function fixtureFetch(body: FfcResponse): typeof globalThis.fetch {
  return (async () => ({ ok: true, json: async () => body }) as unknown as Response) as typeof globalThis.fetch;
}

const ROSTER_ASOF = new Date("2026-08-01T00:00:00.000Z");

describe("ingestAdpSnapshot", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("resolves the fixture feed against the current roster and writes an append-only row per player", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);

    const fixture: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 8.4 }] };
    const result = await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(fixture), now: () => new Date("2026-09-01T00:00:00.000Z") });

    expect(result).toEqual({ candidatesRead: 1, resolutionRate: 1, written: 1 });
    const rows = await db.select().from(adpSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ playerId: "nfl-1", source: ADP_SNAPSHOT_CONFIG.source, format: ADP_SNAPSHOT_CONFIG.format, adp: 8.4 });
  });

  it("writes nothing, honestly, when nothing on the roster resolves", async () => {
    const fixture: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Nobody On Roster", position: "WR", team: "LAR", adp: 1 }] };
    const result = await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(fixture) });
    expect(result.written).toBe(0);
    expect(await db.select().from(adpSnapshots)).toHaveLength(0);
  });

  it("a retried capture of the identical instant never doubles a row (the unique index)", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    const fixture: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 8.4 }] };
    const now = () => new Date("2026-09-01T00:00:00.000Z");

    await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(fixture), now });
    const second = await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(fixture), now });

    expect(second.written).toBe(0); // the identical (player, source, instant) already exists
    expect(await db.select().from(adpSnapshots)).toHaveLength(1);
  });

  it("a later capture is a genuinely new, append-only row, never an overwrite of the earlier one", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    const day1: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 8.4 }] };
    const day2: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 7.9 }] };

    await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(day1), now: () => new Date("2026-09-01T00:00:00.000Z") });
    await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(day2), now: () => new Date("2026-09-02T00:00:00.000Z") });

    const rows = await db.select().from(adpSnapshots);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.adp).sort()).toEqual([7.9, 8.4]);
  });
});

describe("adpSnapshotHistory", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
  });

  it("resolves a product player id through the crosswalk to his own snapshot history, oldest first", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(players).values([{ id: "p1", name: "Puka Nacua", position: "WR", nflTeam: "LAR" }]);
    await db.insert(playerCrosswalk).values([{ playerId: "p1", nflPlayerId: "nfl-1", method: "espn_id", resolvedAt: new Date() }]);
    await db.insert(adpSnapshots).values([
      { playerId: "nfl-1", source: ADP_SNAPSHOT_CONFIG.source, format: ADP_SNAPSHOT_CONFIG.format, adp: 8.4, capturedAt: new Date("2026-09-02T00:00:00.000Z") },
      { playerId: "nfl-1", source: ADP_SNAPSHOT_CONFIG.source, format: ADP_SNAPSHOT_CONFIG.format, adp: 7.9, capturedAt: new Date("2026-09-01T00:00:00.000Z") },
    ]);

    const history = await adpSnapshotHistory(db, "p1");
    expect(history.map((h) => h.adp)).toEqual([7.9, 8.4]); // oldest first
  });

  it("returns an empty history for a player the crosswalk never placed", async () => {
    expect(await adpSnapshotHistory(db, "unknown")).toEqual([]);
  });
});
