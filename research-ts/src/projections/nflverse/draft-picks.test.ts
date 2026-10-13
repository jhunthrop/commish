import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { parseCsv } from "./csv";
import { readFixture } from "./fixtures";
import { createNflverseClient } from "./client";
import { recordNflPlayers } from "../universe";
import {
  draftKnownByAsOf,
  draftPicksFor,
  ingestDraftPicks,
  mapDraftPicks,
  recordDraftPicks,
  type DraftPickRow,
} from "./draft-picks";

/**
 * Read against a real slice of the real release, not a hand-written table — the same discipline
 * `rosters.test.ts` and `players.test.ts` follow: a hand-written fixture tests our understanding of
 * the file rather than the file, and the thing that breaks in practice is the file.
 */
const DRAFT_2020 = parseCsv(readFixture("draft_picks_2020_slice.csv"));

describe("draftKnownByAsOf", () => {
  it("stamps the first of May of the draft year", () => {
    expect(draftKnownByAsOf(2020).toISOString()).toBe("2020-05-01T00:00:00.000Z");
    expect(draftKnownByAsOf(1999).toISOString()).toBe("1999-05-01T00:00:00.000Z");
  });

  it("is EARLIER than the season it describes ever kicks off", () => {
    // Every NFL opener since the merger has fallen in September; the first of May is months before
    // any of them, which is what keeps a rookie curve fit against this table honest about timing.
    expect(draftKnownByAsOf(2020).getTime()).toBeLessThan(Date.UTC(2020, 8, 1));
  });
});

describe("mapDraftPicks", () => {
  const entries = mapDraftPicks(DRAFT_2020);

  it("reads one draft class, one row per selection", () => {
    expect(entries.length).toBeGreaterThan(50);
    expect(new Set(entries.map((entry) => entry.pick)).size).toBe(entries.length);
  });

  it("drops a real pick PFR never assigned a gsis id to, rather than throwing over one man", () => {
    // Cole McDonald, round 7 pick 224 of the 2020 draft, exactly as the release publishes him — a
    // blank gsis_id column, not a synthetic gap.
    expect(entries.find((entry) => entry.pick === 224)).toBeUndefined();
  });

  it("carries the overall pick, round, position and drafting club for the first pick of the class", () => {
    const burrow = entries.find((entry) => entry.playerId === "00-0036442");
    expect(burrow).toMatchObject({ season: 2020, round: 1, pick: 1, position: "QB", team: "CIN" });
  });

  it("is sorted by (season, pick), so a fit over it is reproducible run to run", () => {
    expect(entries.map((entry) => entry.pick)).toEqual([...entries].sort((a, b) => a.pick - b.pick).map((entry) => entry.pick));
  });

  it("stamps every row with draftKnownByAsOf by default", () => {
    expect(new Set(entries.map((entry) => entry.asOf.toISOString()))).toEqual(new Set([draftKnownByAsOf(2020).toISOString()]));
  });

  it("stamps with a caller-supplied function instead, when given one", () => {
    const fixed = new Date("2020-04-23T12:00:00.000Z");
    const custom = mapDraftPicks(DRAFT_2020, () => fixed);
    expect(custom.every((entry) => entry.asOf.getTime() === fixed.getTime())).toBe(true);
  });
});

describe("the store", () => {
  const db = createTestDb();

  const BURROW: DraftPickRow = { season: 2020, round: 1, pick: 1, playerId: "00-0036442", position: "QB", team: "CIN", asOf: draftKnownByAsOf(2020) };
  const HERBERT: DraftPickRow = { season: 2020, round: 1, pick: 6, playerId: "00-0036355", position: "QB", team: "LAC", asOf: draftKnownByAsOf(2020) };

  beforeEach(async () => {
    await truncateAll(db);
    await recordNflPlayers(db, [
      { id: "00-0036442", espnId: null, pfrId: "BurrJo01", name: "Joe Burrow", position: "QB", latestTeam: "CIN", rookieSeason: 2020, lastSeason: 2025 },
      { id: "00-0036355", espnId: null, pfrId: "HerbJu00", name: "Justin Herbert", position: "QB", latestTeam: "LAC", rookieSeason: 2020, lastSeason: 2025 },
    ]);
  });

  describe("recordDraftPicks", () => {
    it("writes rows and reports how many were ACTUALLY new, so a re-run reads as a no-op", async () => {
      expect(await recordDraftPicks(db, [BURROW])).toBe(1);
      expect(await recordDraftPicks(db, [BURROW])).toBe(0);
    });

    it("refuses a player the universe does not hold, rather than orphaning a row", async () => {
      await expect(recordDraftPicks(db, [{ ...BURROW, playerId: "00-9999999" }])).rejects.toThrow();
    });
  });

  describe("draftPicksFor", () => {
    it("reads back only the requested seasons, ordered by (season, pick)", async () => {
      await recordDraftPicks(db, [HERBERT, BURROW, { ...BURROW, season: 2021, pick: 1, playerId: "00-0036355" }]);
      const rows = await draftPicksFor(db, [2020]);
      expect(rows.map((row) => row.pick)).toEqual([1, 6]);
      expect(rows.every((row) => row.season === 2020)).toBe(true);
    });

    it("answers empty for a season with no ingested picks, never a guess", async () => {
      expect(await draftPicksFor(db, [2019])).toEqual([]);
    });
  });

  describe("ingestDraftPicks", () => {
    it("fetches, filters to the known universe, and writes — reporting what it dropped", async () => {
      const client = createNflverseClient({
        fetch: (async () => new Response(readFixture("draft_picks_2020_slice.csv"), { status: 200 })) as typeof globalThis.fetch,
      });
      const report = await ingestDraftPicks(db, client);
      // The fixture carries 77 real picks with a gsis id (one, Cole McDonald, dropped by
      // `mapDraftPicks` itself); of those, only the two seeded above are in this test's universe.
      expect(report.written).toBe(2);
      expect(report.unknownToUniverse).toBe(report.entriesRead - 2);
      const rows = await draftPicksFor(db, [2020]);
      expect(rows.map((row) => row.playerId).sort()).toEqual(["00-0036355", "00-0036442"]);
    });

    it("is idempotent — a re-run of a landed ingestion writes nothing new", async () => {
      const client = createNflverseClient({
        fetch: (async () => new Response(readFixture("draft_picks_2020_slice.csv"), { status: 200 })) as typeof globalThis.fetch,
      });
      await ingestDraftPicks(db, client);
      const second = await ingestDraftPicks(db, client);
      expect(second.written).toBe(0);
    });
  });
});
