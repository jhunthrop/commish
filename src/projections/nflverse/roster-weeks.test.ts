import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { recordNflPlayers } from "../universe";
import { parseCsv, type CsvRow } from "./csv";
import { readFixture } from "./fixtures";
import { createNflverseClient } from "./client";
import { ingestRosterWeeks, mapRosterWeekRows, recordRosterWeekRows, rosterWeekRowsFor, type RosterWeekRow } from "./roster-weeks";

/** Read against a real slice of the real release, matching `injuries.test.ts`'s own discipline: a
 *  hand-written table tests our understanding of the file rather than the file itself. Carries the
 *  real, measured season-ending IR case (Malik Nabers, 2025) `roster-weeks.ts`'s own docblock and
 *  `manifest.json` describe. */
const NYG_2025 = parseCsv(readFixture("roster_weekly_2025_nyg_w1-4-5-18.csv"));

const NABERS_ID = "00-0039337";

function row(over: Partial<Record<string, string>> = {}): CsvRow {
  return {
    season: "2025",
    team: "NYG",
    position: "WR",
    depth_chart_position: "WR",
    jersey_number: "1",
    status: "ACT",
    full_name: "Someone Fake",
    first_name: "Someone",
    last_name: "Fake",
    birth_date: "2000-01-01",
    height: "72",
    weight: "200",
    college: "Nowhere",
    gsis_id: "00-0000001",
    espn_id: "1",
    sportradar_id: "",
    yahoo_id: "",
    rotowire_id: "",
    pff_id: "",
    pfr_id: "FakeSo00",
    fantasy_data_id: "",
    sleeper_id: "",
    years_exp: "1",
    headshot_url: "",
    ngs_position: "WR",
    week: "1",
    game_type: "REG",
    status_description_abbr: "A01",
    football_name: "Someone",
    esb_id: "",
    gsis_it_id: "",
    smart_id: "",
    entry_year: "2024",
    rookie_year: "2024",
    draft_club: "NYG",
    draft_number: "50",
    ...over,
  };
}

describe("mapRosterWeekRows", () => {
  it("reads the real NYG slice into one row per (season, week, gsis_id)", () => {
    const rows = mapRosterWeekRows(NYG_2025);
    expect(rows.length).toBeGreaterThan(0);
    const keys = rows.map((r) => `${r.season}|${r.week}|${r.playerId}`);
    expect(new Set(keys).size).toBe(rows.length);
  });

  it("carries Malik Nabers active in week 1, reserve from week 5 on — the real 2025 ACL case", () => {
    const rows = mapRosterWeekRows(NYG_2025);
    const byWeek = new Map(rows.filter((r) => r.playerId === NABERS_ID).map((r) => [r.week, r]));
    expect(byWeek.get(1)).toMatchObject({ status: "ACT", team: "NYG", position: "WR" });
    expect(byWeek.get(4)).toMatchObject({ status: "ACT" });
    expect(byWeek.get(5)).toMatchObject({ status: "RES" });
    expect(byWeek.get(18)).toMatchObject({ status: "RES" });
  });

  it("drops a row whose season type this product does not score", () => {
    expect(mapRosterWeekRows([row({ game_type: "WC" })])).toEqual([]);
  });

  it("drops a row with no gsis id", () => {
    expect(mapRosterWeekRows([row({ gsis_id: "" })])).toEqual([]);
  });

  it("refuses a file missing a column this ingestion reads, rather than silently coarsening every row", () => {
    const withoutStatus: Record<string, string> = { ...row() };
    delete withoutStatus.status;
    expect(() => mapRosterWeekRows([withoutStatus as CsvRow])).toThrow(/missing column/);
  });

  it("throws on an unreadable season or week rather than guessing", () => {
    expect(() => mapRosterWeekRows([row({ week: "" })])).toThrow(/no readable season\/week/);
  });

  it("empty input is not a shape drift — a season nflverse has not published rows for yet", () => {
    expect(mapRosterWeekRows([])).toEqual([]);
  });

  it("keeps the later row in file order for a duplicate (season, week, gsis_id) key", () => {
    const earlier = row({ status: "ACT", team: "NYG" });
    const later = row({ status: "RES", team: "NYG" });
    expect(mapRosterWeekRows([earlier, later])[0]).toMatchObject({ status: "RES" });
    // Order in the source file must not matter to the RULE (last row wins) even though it
    // changes which candidate that is.
    expect(mapRosterWeekRows([later, earlier])[0]).toMatchObject({ status: "ACT" });
  });
});

describe("the store", () => {
  const db = createTestDb();

  const NABERS = { id: NABERS_ID, espnId: null, pfrId: "NabeMa00", name: "Malik Nabers", position: "WR", latestTeam: "NYG", rookieSeason: 2024, lastSeason: 2025 };

  beforeEach(async () => {
    await truncateAll(db);
    await recordNflPlayers(db, [NABERS]);
  });

  const RES_ROW: RosterWeekRow = {
    season: 2025,
    week: 5,
    playerId: NABERS.id,
    team: "NYG",
    status: "RES",
    position: "WR",
  };

  describe("recordRosterWeekRows", () => {
    it("writes rows and reports how many were ACTUALLY new, so a re-run reads as a no-op", async () => {
      expect(await recordRosterWeekRows(db, [RES_ROW])).toBe(1);
      expect(await recordRosterWeekRows(db, [RES_ROW])).toBe(0);
    });

    it("upserts a revised status for the same natural key, rather than duplicating or discarding it", async () => {
      await recordRosterWeekRows(db, [RES_ROW]);
      const revised: RosterWeekRow = { ...RES_ROW, status: "ACT" };
      expect(await recordRosterWeekRows(db, [revised])).toBe(1);

      const rows = await rosterWeekRowsFor(db, NABERS.id, 2025);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: "ACT" });
    });

    it("refuses a player the universe does not hold, rather than orphaning a row", async () => {
      await expect(recordRosterWeekRows(db, [{ ...RES_ROW, playerId: "00-9999999" }])).rejects.toThrow();
    });
  });

  describe("rosterWeekRowsFor", () => {
    it("reads back only the requested player and season, in week order", async () => {
      await recordRosterWeekRows(db, [
        { ...RES_ROW, week: 1, status: "ACT" },
        RES_ROW,
        { ...RES_ROW, season: 2024, week: 5 },
      ]);
      const rows = await rosterWeekRowsFor(db, NABERS.id, 2025);
      expect(rows.map((r) => r.week)).toEqual([1, 5]);
    });

    it("answers empty for a player-season with nothing archived, never a guess", async () => {
      expect(await rosterWeekRowsFor(db, NABERS.id, 2019)).toEqual([]);
    });
  });

  describe("ingestRosterWeeks", () => {
    it("fetches, filters to the known universe, and writes — reporting what it dropped", async () => {
      const client = createNflverseClient({
        fetch: (async () => new Response(readFixture("roster_weekly_2025_nyg_w1-4-5-18.csv"), { status: 200 })) as typeof globalThis.fetch,
      });
      const [report] = await ingestRosterWeeks(db, client, [2025]);
      expect(report!.season).toBe(2025);
      // Only Malik Nabers is in this test's universe; every other NYG player in the fixture is dropped.
      const expectedWritten = mapRosterWeekRows(NYG_2025).filter((r) => r.playerId === NABERS.id).length;
      expect(report!.written).toBe(expectedWritten);
      expect(report!.unknownToUniverse).toBe(mapRosterWeekRows(NYG_2025).length - expectedWritten);

      const rows = await rosterWeekRowsFor(db, NABERS.id, 2025);
      expect(rows.map((r) => [r.week, r.status])).toEqual([
        [1, "ACT"],
        [4, "ACT"],
        [5, "RES"],
        [18, "RES"],
      ]);
    });

    it("is idempotent — a re-run of a landed ingestion writes nothing new", async () => {
      const client = createNflverseClient({
        fetch: (async () => new Response(readFixture("roster_weekly_2025_nyg_w1-4-5-18.csv"), { status: 200 })) as typeof globalThis.fetch,
      });
      await ingestRosterWeeks(db, client, [2025]);
      const [second] = await ingestRosterWeeks(db, client, [2025]);
      expect(second!.written).toBe(0);
    });
  });
});
