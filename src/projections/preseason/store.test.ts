import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { recordNflPlayers } from "../universe";
import { week1RosterAsOf, type PreseasonRosterEntry } from "../nflverse/rosters";
import {
  firstRosterSeasonsThrough,
  preseasonRankingsAsOf,
  preseasonRostersAsOf,
  recordPreseasonRankings,
  recordPreseasonRosters,
  type PreseasonRankingRow,
} from "./store";

/**
 * The preseason store's whole job is the `as_of` gate, so that is what these test. Offseason data is
 * the most dangerous kind in the engine — it arrives in one undated dump and a stamp is easy to
 * lose — and a leak here would not fail anything, it would simply make a backtested board look
 * brilliant.
 */
const db = createTestDb();

const CUTDOWN_2023 = week1RosterAsOf(2023);
const CUTDOWN_2024 = week1RosterAsOf(2024);

function entry(overrides: Partial<PreseasonRosterEntry> = {}): PreseasonRosterEntry {
  return {
    season: 2024,
    team: "BUF",
    playerId: "00-0034857",
    position: "QB",
    status: "active",
    birthDate: "1996-05-21",
    draftYear: 2018,
    draftPick: 7,
    draftClub: "BUF",
    asOf: CUTDOWN_2024,
    ...overrides,
  };
}

function ranking(overrides: Partial<PreseasonRankingRow> = {}): PreseasonRankingRow {
  return {
    season: 2024,
    source: "ffc_adp_ppr_12",
    playerId: "00-0034857",
    rank: 26.4,
    asOf: new Date("2024-09-02T00:00:00.000Z"),
    ...overrides,
  };
}

beforeEach(async () => {
  await truncateAll(db);
  await recordNflPlayers(db, [
    { id: "00-0034857", espnId: null, pfrId: "AlleJo02", name: "Josh Allen", position: "QB", latestTeam: "BUF", rookieSeason: 2018, lastSeason: 2024 },
    { id: "00-0036358", espnId: null, pfrId: "LambCe00", name: "CeeDee Lamb", position: "WR", latestTeam: "DAL", rookieSeason: 2020, lastSeason: 2024 },
  ]);
});

describe("recordPreseasonRosters", () => {
  it("writes rows and reports how many were ACTUALLY new, so a re-run reads as a no-op", async () => {
    expect(await recordPreseasonRosters(db, [entry()])).toBe(1);
    expect(await recordPreseasonRosters(db, [entry()])).toBe(0);
  });

  it("keeps a restatement as a new row rather than overwriting the old belief", async () => {
    await recordPreseasonRosters(db, [entry({ status: "active" })]);
    const later = new Date(CUTDOWN_2024.getTime() + 86_400_000);
    await recordPreseasonRosters(db, [entry({ status: "reserve", asOf: later })]);
    const asOfCutdown = await preseasonRostersAsOf(db, { season: 2024, asOf: CUTDOWN_2024 });
    const asOfLater = await preseasonRostersAsOf(db, { season: 2024, asOf: later });
    expect(asOfCutdown[0]!.status).toBe("active");
    expect(asOfLater[0]!.status).toBe("reserve");
  });
});

describe("preseasonRostersAsOf", () => {
  beforeEach(async () => {
    await recordPreseasonRosters(db, [
      entry(),
      entry({ playerId: "00-0036358", team: "DAL", position: "WR", draftYear: 2020, draftPick: 17, draftClub: "DAL", birthDate: "1999-04-08" }),
      entry({ season: 2023, asOf: CUTDOWN_2023, team: "BUF" }),
    ]);
  });

  it("REFUSES A ROW STAMPED AFTER THE MOMENT, which is the whole point of the table", async () => {
    const before = new Date(CUTDOWN_2024.getTime() - 1);
    expect(await preseasonRostersAsOf(db, { season: 2024, asOf: before })).toHaveLength(0);
    expect(await preseasonRostersAsOf(db, { season: 2024, asOf: CUTDOWN_2024 })).toHaveLength(2);
  });

  it("never reaches across seasons", async () => {
    const rows = await preseasonRostersAsOf(db, { season: 2023, asOf: CUTDOWN_2024 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.season).toBe(2023);
  });

  it("carries the biography a rookie prior and an availability model read", async () => {
    const rows = await preseasonRostersAsOf(db, { season: 2024, asOf: CUTDOWN_2024 });
    const lamb = rows.find((row) => row.playerId === "00-0036358")!;
    expect(lamb).toMatchObject({ team: "DAL", position: "WR", draftYear: 2020, draftPick: 17, birthDate: "1999-04-08" });
  });

  it("READS A SEASON BEFORE THE FIXED-STAMP CUTOVER, exactly like any other — the store itself has no opinion on ROSTER_SOURCE_CONFIG.earliestSeason; only the ingestion path does", async () => {
    // A schedule-derived stamp (`historicalWeek1RosterAsOf`'s own mechanism), not the fixed first of
    // September — 2015's real cutdown fell later in the calendar than 2024's did.
    const historicalStamp = new Date("2015-09-09T23:59:59.999Z");
    await recordPreseasonRosters(db, [entry({ season: 2015, asOf: historicalStamp, playerId: "00-0034857" })]);
    const rows = await preseasonRostersAsOf(db, { season: 2015, asOf: historicalStamp });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.season).toBe(2015);
    expect(rows[0]!.asOf).toEqual(historicalStamp);
  });

  it("is ordered by player id, so a board built from it is reproducible run to run", async () => {
    const rows = await preseasonRostersAsOf(db, { season: 2024, asOf: CUTDOWN_2024 });
    expect(rows.map((row) => row.playerId)).toEqual([...rows.map((row) => row.playerId)].sort());
  });
});

describe("preseasonRankingsAsOf", () => {
  it("gates a published board on its publication date, per source", async () => {
    const published = new Date("2024-09-02T00:00:00.000Z");
    await recordPreseasonRankings(db, [
      ranking(),
      ranking({ source: "fantasypros_ecr_ppr", rank: 21, asOf: new Date("2024-09-08T00:00:00.000Z") }),
    ]);
    expect(await preseasonRankingsAsOf(db, { season: 2024, source: "ffc_adp_ppr_12", asOf: published })).toHaveLength(1);
    expect(
      await preseasonRankingsAsOf(db, { season: 2024, source: "fantasypros_ecr_ppr", asOf: published }),
    ).toHaveLength(0);
  });

  it("keeps a fractional average draft position as it was published", async () => {
    await recordPreseasonRankings(db, [ranking({ rank: 26.4 })]);
    const [row] = await preseasonRankingsAsOf(db, { season: 2024, source: "ffc_adp_ppr_12", asOf: new Date("2099-01-01") });
    expect(row!.rank).toBeCloseTo(26.4, 10);
  });

  it("is idempotent, so a benchmark ingestion can be re-run without duplicating a board", async () => {
    expect(await recordPreseasonRankings(db, [ranking()])).toBe(1);
    expect(await recordPreseasonRankings(db, [ranking()])).toBe(0);
  });
});

describe("the foreign key to the historical universe", () => {
  it("refuses a player the universe does not hold, rather than orphaning a row", async () => {
    await expect(recordPreseasonRosters(db, [entry({ playerId: "00-9999999" })])).rejects.toThrow();
    void nflPlayers;
  });
});

describe("firstRosterSeasonsThrough", () => {
  it("returns the earliest season a player has a stamped row", async () => {
    await recordPreseasonRosters(db, [
      entry({ playerId: "00-0034857", season: 2018, asOf: week1RosterAsOf(2018) }),
      entry({ playerId: "00-0034857", season: 2020, asOf: week1RosterAsOf(2020) }),
      entry({ playerId: "00-0034857", season: 2024, asOf: CUTDOWN_2024 }),
    ]);
    const firstSeasons = await firstRosterSeasonsThrough(db, 2024);
    expect(firstSeasons.get("00-0034857")).toBe(2018);
  });

  it("is bounded by the season asked for, never reading a later row into an earlier answer", async () => {
    await recordPreseasonRosters(db, [
      entry({ playerId: "00-0034857", season: 2020, asOf: week1RosterAsOf(2020) }),
      entry({ playerId: "00-0034857", season: 2024, asOf: CUTDOWN_2024 }),
    ]);
    expect((await firstRosterSeasonsThrough(db, 2021)).get("00-0034857")).toBe(2020);
    expect((await firstRosterSeasonsThrough(db, 2019)).get("00-0034857")).toBeUndefined();
  });

  it("is silent about a player with no roster row at all", async () => {
    const firstSeasons = await firstRosterSeasonsThrough(db, 2024);
    expect(firstSeasons.has("00-0036358")).toBe(false);
  });

  it("keeps players independent", async () => {
    await recordPreseasonRosters(db, [
      entry({ playerId: "00-0034857", season: 2018, asOf: week1RosterAsOf(2018) }),
      entry({ playerId: "00-0036358", season: 2020, team: "DAL", position: "WR", asOf: week1RosterAsOf(2020) }),
    ]);
    const firstSeasons = await firstRosterSeasonsThrough(db, 2024);
    expect(firstSeasons.get("00-0034857")).toBe(2018);
    expect(firstSeasons.get("00-0036358")).toBe(2020);
  });
});
