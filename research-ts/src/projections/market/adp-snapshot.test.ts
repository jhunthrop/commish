import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { adpSnapshots, nflPlayers, playerCrosswalk, players, preseasonRosters } from "@research-ts/db/schema";
import type { FfcResponse } from "@research-ts/projections/preseason/publishers";
import { PRODUCT_SEASON } from "@research-ts/projections/preseason/current";
import { BENCHMARK_SOURCES } from "@research-ts/projections/preseason/benchmarks";
import { ADP_SNAPSHOT_CONFIG, ADP_SNAPSHOT_CAPTURES, ADP_SNAPSHOT_REQUESTS_PER_FIRE, adpSnapshotHistory, ingestAdpSnapshot } from "./adp-snapshot";

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
    const result = await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(fixture), now: () => new Date("2026-09-01T00:00:00.000Z"), formats: ["ppr"] });

    expect(result).toEqual({ candidatesRead: 1, resolutionRate: 1, written: 1, byFormat: [{ format: "ppr", candidatesRead: 1, resolutionRate: 1, written: 1, error: null }] });
    const rows = await db.select().from(adpSnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ playerId: "nfl-1", source: ADP_SNAPSHOT_CONFIG.source, format: ADP_SNAPSHOT_CONFIG.format, adp: 8.4 });
  });

  it("writes nothing, honestly, when nothing on the roster resolves", async () => {
    const fixture: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Nobody On Roster", position: "WR", team: "LAR", adp: 1 }] };
    const result = await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(fixture), formats: ["ppr"] });
    expect(result.written).toBe(0);
    expect(await db.select().from(adpSnapshots)).toHaveLength(0);
  });

  it("a retried capture of the identical instant never doubles a row (the unique index)", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    const fixture: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 8.4 }] };
    const now = () => new Date("2026-09-01T00:00:00.000Z");

    await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(fixture), now, formats: ["ppr"] });
    const second = await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(fixture), now, formats: ["ppr"] });

    expect(second.written).toBe(0); // the identical (player, source, instant) already exists
    expect(await db.select().from(adpSnapshots)).toHaveLength(1);
  });

  it("a later capture is a genuinely new, append-only row, never an overwrite of the earlier one", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    const day1: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 8.4 }] };
    const day2: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 7.9 }] };

    await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(day1), now: () => new Date("2026-09-01T00:00:00.000Z"), formats: ["ppr"] });
    await ingestAdpSnapshot(db, { fetchImpl: fixtureFetch(day2), now: () => new Date("2026-09-02T00:00:00.000Z"), formats: ["ppr"] });

    const rows = await db.select().from(adpSnapshots);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.adp).sort()).toEqual([7.9, 8.4]);
  });

  it("captures all three formats by default, one fetch each, under each format's own source and format (the scoring-formats round)", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    const requested: string[] = [];
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      requested.push(url);
      const adp = url.includes("/adp/ppr?") ? 8.4 : url.includes("/adp/half-ppr?") ? 10.1 : 14.2;
      const body: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp }] };
      return { ok: true, json: async () => body } as unknown as Response;
    }) as typeof globalThis.fetch;
    const now = () => new Date("2026-09-01T00:00:00.000Z");

    const result = await ingestAdpSnapshot(db, { fetchImpl, now });

    expect(requested).toHaveLength(ADP_SNAPSHOT_CAPTURES.length);
    expect(result.written).toBe(3);
    expect(result.byFormat.map((entry) => entry.format)).toEqual(["ppr", "half", "std"]);
    const rows = (await db.select().from(adpSnapshots)).sort((a, b) => a.adp - b.adp);
    expect(rows.map((row) => [row.source, row.format, row.adp])).toEqual([
      [BENCHMARK_SOURCES.adp, "ppr_12", 8.4],
      [BENCHMARK_SOURCES.adpHalf, "half_12", 10.1],
      [BENCHMARK_SOURCES.adpStd, "std_12", 14.2],
    ]);
    // The same instant, three formats: the unique index separates them by source, so a retry of
    // the whole fire still writes nothing new.
    expect((await ingestAdpSnapshot(db, { fetchImpl, now })).written).toBe(0);
  });

  it("budgets one upstream request per format, three a fire", () => {
    expect(ADP_SNAPSHOT_REQUESTS_PER_FIRE).toBe(3);
    expect(ADP_SNAPSHOT_CAPTURES.map((capture) => capture.format)).toEqual(["ppr", "half", "std"]);
  });

  /** A feed that answers PPR and standard but fails half PPR with an HTTP error. */
  function halfDownFetch(): typeof globalThis.fetch {
    return (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/adp/half-ppr?")) return { ok: false, status: 503 } as unknown as Response;
      const body: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: url.includes("/adp/ppr?") ? 8.4 : 14.2 }] };
      return { ok: true, json: async () => body } as unknown as Response;
    }) as typeof globalThis.fetch;
  }

  it("a failed secondary format never costs the PPR capture: each format is its own try, its own row, named in the result", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);

    const result = await ingestAdpSnapshot(db, { fetchImpl: halfDownFetch(), now: () => new Date("2026-09-01T00:00:00.000Z") });

    expect(result.written).toBe(2);
    expect(result.byFormat.map((entry) => [entry.format, entry.written, entry.error === null])).toEqual([
      ["ppr", 1, true],
      ["half", 0, false],
      ["std", 1, true],
    ]);
    expect(result.byFormat[1]!.error).toMatch(/HTTP 503/);
    const rows = await db.select().from(adpSnapshots);
    expect(rows.map((row) => row.source).sort()).toEqual([BENCHMARK_SOURCES.adp, BENCHMARK_SOURCES.adpStd].sort());
  });

  it("a failed PPR capture still throws, after the other formats have had their turn, naming every outcome", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(preseasonRosters).values([{ season: PRODUCT_SEASON, team: "LAR", playerId: "nfl-1", position: "WR", status: "active", asOf: ROSTER_ASOF }]);
    const pprDown = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/adp/ppr?")) return { ok: false, status: 500 } as unknown as Response;
      const body: FfcResponse = { meta: { end_date: "2026-08-30" }, players: [{ name: "Puka Nacua", position: "WR", team: "LAR", adp: 12 }] };
      return { ok: true, json: async () => body } as unknown as Response;
    }) as typeof globalThis.fetch;

    await expect(ingestAdpSnapshot(db, { fetchImpl: pprDown, now: () => new Date("2026-09-01T00:00:00.000Z") })).rejects.toThrow(/the ppr capture failed \(.*HTTP 500.*\); half: 1 written; std: 1 written/);
    // The secondary rows landed and stay; the job's retry re-fetches PPR and finds them no-ops.
    expect((await db.select().from(adpSnapshots)).map((row) => row.source).sort()).toEqual([BENCHMARK_SOURCES.adpHalf, BENCHMARK_SOURCES.adpStd].sort());
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

  it("reads one format's own history, never another format's rows (the scoring-formats round)", async () => {
    await db.insert(nflPlayers).values([{ id: "nfl-1", name: "Puka Nacua", position: "WR" }]);
    await db.insert(players).values([{ id: "p1", name: "Puka Nacua", position: "WR", nflTeam: "LAR" }]);
    await db.insert(playerCrosswalk).values([{ playerId: "p1", nflPlayerId: "nfl-1", method: "espn_id", resolvedAt: new Date() }]);
    const capturedAt = new Date("2026-09-02T00:00:00.000Z");
    await db.insert(adpSnapshots).values([
      { playerId: "nfl-1", source: BENCHMARK_SOURCES.adp, format: "ppr_12", adp: 8.4, capturedAt },
      { playerId: "nfl-1", source: BENCHMARK_SOURCES.adpHalf, format: "half_12", adp: 10.1, capturedAt },
    ]);

    expect((await adpSnapshotHistory(db, "p1")).map((h) => h.adp)).toEqual([8.4]);
    expect((await adpSnapshotHistory(db, "p1", 90, "half")).map((h) => h.adp)).toEqual([10.1]);
  });

  it("returns an empty history for a player the crosswalk never placed", async () => {
    expect(await adpSnapshotHistory(db, "unknown")).toEqual([]);
  });
});
