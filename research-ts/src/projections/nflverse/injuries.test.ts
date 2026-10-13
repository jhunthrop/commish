import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { recordNflPlayers } from "../universe";
import { parseCsv, type CsvRow } from "./csv";
import { readFixture } from "./fixtures";
import { createNflverseClient } from "./client";
import { ingestInjuries, injuryRowsFor, mapInjuryRows, recordInjuryRows, type InjuryRow } from "./injuries";

/** Read against a real slice of the real release, matching `draft-picks.test.ts`'s own discipline:
 *  a hand-written table tests our understanding of the file rather than the file itself. */
const BUF_2024_W1_3 = parseCsv(readFixture("injuries_2024_buf_w1-3.csv"));

/** The post-2025 shape: `season_type` added, `date_modified` gone entirely. */
const BUF_2025_W1_3 = parseCsv(readFixture("injuries_2025_buf_w1-3.csv"));

function row(over: Partial<Record<string, string>> = {}): CsvRow {
  return {
    season: "2024",
    game_type: "REG",
    team: "CLE",
    week: "3",
    gsis_id: "00-0000001",
    position: "WR",
    full_name: "Someone Fake",
    report_status: "Out",
    report_primary_injury: "Knee",
    practice_status: "Did Not Participate In Practice",
    date_modified: "2024-09-20T19:05:30Z",
    ...over,
  };
}

/** The 2025+ shape: `season_type` present, `date_modified` genuinely absent from the header —
 *  not merely blank, since `"date_modified" in row` is how `mapInjuryRows` tells the two shapes
 *  apart. Building this by deleting the key (rather than typing a literal without it) keeps the
 *  fixture in one place if the base `row()` shape ever grows another column. */
function row2025(over: Partial<Record<string, string>> = {}): CsvRow {
  const base: Record<string, string> = { ...row(), season_type: "REG", ...over };
  delete base.date_modified;
  return base;
}

describe("mapInjuryRows", () => {
  it("reads the real BUF week 1-3 slice into one row per (season, week, gsis_id)", () => {
    const rows = mapInjuryRows(BUF_2024_W1_3);
    expect(rows.length).toBeGreaterThan(0);
    const keys = rows.map((r) => `${r.season}|${r.week}|${r.playerId}`);
    expect(new Set(keys).size).toBe(rows.length);
  });

  it("carries Josh Allen's own row verbatim, including a blank game-status designation", () => {
    const rows = mapInjuryRows(BUF_2024_W1_3);
    const allen = rows.find((r) => r.playerId === "00-0034857" && r.week === 2);
    expect(allen).toMatchObject({ reportStatus: "", primaryInjury: "" });
  });

  it("carries a real Out designation and its own injury text verbatim", () => {
    const rows = mapInjuryRows(BUF_2024_W1_3);
    const taronJohnson = rows.find((r) => r.playerId === "00-0034376" && r.week === 2);
    expect(taronJohnson).toMatchObject({ reportStatus: "Out", primaryInjury: "Forearm" });
  });

  it("drops a row whose season type this product does not score", () => {
    expect(mapInjuryRows([row({ game_type: "POST" })])).toEqual([]);
  });

  it("drops a row with no gsis id", () => {
    expect(mapInjuryRows([row({ gsis_id: "" })])).toEqual([]);
  });

  it("refuses a file missing a column this ingestion reads, rather than silently coarsening every row", () => {
    const withoutReportStatus: Record<string, string> = { ...row() };
    delete withoutReportStatus.report_status;
    expect(() => mapInjuryRows([withoutReportStatus as CsvRow])).toThrow(/missing column/);
  });

  it("throws on an unreadable season or week rather than guessing", () => {
    expect(() => mapInjuryRows([row({ week: "" })])).toThrow(/no readable season\/week/);
  });

  it("keeps the later date_modified when the source publishes two rows for one player-week", () => {
    const earlier = row({ report_status: "Questionable", date_modified: "2024-12-15T03:34:33Z" });
    const later = row({ report_status: "Out", date_modified: "2024-12-15T14:17:06Z" });
    const rows = mapInjuryRows([earlier, later]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ reportStatus: "Out" });

    // Order in the source file must not matter — the later timestamp always wins.
    const reversed = mapInjuryRows([later, earlier]);
    expect(reversed[0]).toMatchObject({ reportStatus: "Out" });
  });

  it("empty input is not a shape drift — a season nflverse has not published rows for yet", () => {
    expect(mapInjuryRows([])).toEqual([]);
  });

  it("the 2024 shape (date_modified present) still stamps every row with a real Date, unchanged", () => {
    const rows = mapInjuryRows(BUF_2024_W1_3);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.dateModified).toBeInstanceOf(Date);
    }
  });

  it("the 2025 shape (date_modified absent, season_type present) ingests with null stamps, ignoring season_type", () => {
    const rows = mapInjuryRows(BUF_2025_W1_3);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.dateModified).toBeNull();
    }
    // Tre'Davious White moves Doubtful (week 1) -> Questionable (week 2) in the real release.
    const white = rows.find((r) => r.playerId === "00-0033884" && r.week === 1);
    expect(white).toMatchObject({ reportStatus: "Doubtful", primaryInjury: "Groin" });
  });

  it("refuses a 2025-shape file missing report_status, exactly as the 2024 shape does", () => {
    const withoutReportStatus: Record<string, string> = { ...row2025() };
    delete withoutReportStatus.report_status;
    expect(() => mapInjuryRows([withoutReportStatus as CsvRow])).toThrow(/missing column/);
  });

  it("two null-stamped revisions of one player-week: the later row in file order wins, since neither carries a filing timestamp to compare", () => {
    const earlier = row2025({ report_status: "Questionable" });
    const later = row2025({ report_status: "Out" });
    expect(mapInjuryRows([earlier, later])[0]).toMatchObject({ reportStatus: "Out" });
    // Reversed file order flips which row is "later" — last-row-wins, not a stable preference.
    expect(mapInjuryRows([later, earlier])[0]).toMatchObject({ reportStatus: "Questionable" });
  });

});

describe("the store", () => {
  const db = createTestDb();

  const ALLEN = { id: "00-0034857", espnId: null, pfrId: "AlleJo02", name: "Josh Allen", position: "QB", latestTeam: "BUF", rookieSeason: 2018, lastSeason: 2025 };

  beforeEach(async () => {
    await truncateAll(db);
    await recordNflPlayers(db, [ALLEN]);
  });

  const OUT_ROW: InjuryRow = {
    season: 2024,
    week: 5,
    playerId: ALLEN.id,
    reportStatus: "Out",
    primaryInjury: "Knee",
    practiceStatus: "Did Not Participate In Practice",
    dateModified: new Date("2024-10-04T19:00:00Z"),
  };

  describe("recordInjuryRows", () => {
    it("writes rows and reports how many were ACTUALLY new, so a re-run reads as a no-op", async () => {
      expect(await recordInjuryRows(db, [OUT_ROW])).toBe(1);
      expect(await recordInjuryRows(db, [OUT_ROW])).toBe(0);
    });

    it("upserts a revised designation for the same natural key, rather than duplicating or discarding it", async () => {
      await recordInjuryRows(db, [OUT_ROW]);
      const revised: InjuryRow = { ...OUT_ROW, reportStatus: "Questionable", dateModified: new Date("2024-10-05T12:00:00Z") };
      expect(await recordInjuryRows(db, [revised])).toBe(1);

      const rows = await injuryRowsFor(db, ALLEN.id, 2024);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ reportStatus: "Questionable" });
    });

    it("refuses a player the universe does not hold, rather than orphaning a row", async () => {
      await expect(recordInjuryRows(db, [{ ...OUT_ROW, playerId: "00-9999999" }])).rejects.toThrow();
    });

    it("writes a null date_modified (the 2025+ shape) and reads it back as null, never a fabricated stamp", async () => {
      const nullStamped: InjuryRow = { ...OUT_ROW, dateModified: null };
      expect(await recordInjuryRows(db, [nullStamped])).toBe(1);
      const rows = await injuryRowsFor(db, ALLEN.id, 2024);
      expect(rows[0]!.dateModified).toBeNull();
    });

    it("two null-stamped re-ingestions of an unchanged row: the second is a true no-op, exactly like two stamped ones", async () => {
      const nullStamped: InjuryRow = { ...OUT_ROW, dateModified: null };
      expect(await recordInjuryRows(db, [nullStamped])).toBe(1);
      expect(await recordInjuryRows(db, [nullStamped])).toBe(0);
    });

    it("a null incoming date_modified never erases a stamp already on record — stamped wins", async () => {
      await recordInjuryRows(db, [OUT_ROW]);
      // Same key, a genuinely different designation, but the incoming row carries no stamp at all.
      const revisedButUnstamped: InjuryRow = { ...OUT_ROW, reportStatus: "Questionable", dateModified: null };
      expect(await recordInjuryRows(db, [revisedButUnstamped])).toBe(1);

      const rows = await injuryRowsFor(db, ALLEN.id, 2024);
      expect(rows[0]).toMatchObject({ reportStatus: "Questionable" });
      expect(rows[0]!.dateModified).toEqual(OUT_ROW.dateModified);
    });

    it("a real incoming stamp always replaces whatever was on record, stamped or null", async () => {
      const nullStamped: InjuryRow = { ...OUT_ROW, dateModified: null };
      await recordInjuryRows(db, [nullStamped]);
      const nowStamped: InjuryRow = { ...OUT_ROW, reportStatus: "Questionable", dateModified: new Date("2024-10-06T00:00:00Z") };
      expect(await recordInjuryRows(db, [nowStamped])).toBe(1);

      const rows = await injuryRowsFor(db, ALLEN.id, 2024);
      expect(rows[0]!.dateModified).toEqual(nowStamped.dateModified);
    });
  });

  describe("injuryRowsFor", () => {
    it("reads back only the requested player and season, in week order", async () => {
      await recordInjuryRows(db, [
        OUT_ROW,
        { ...OUT_ROW, week: 6 },
        { ...OUT_ROW, season: 2023, week: 5 },
      ]);
      const rows = await injuryRowsFor(db, ALLEN.id, 2024);
      expect(rows.map((r) => r.week)).toEqual([5, 6]);
    });

    it("answers empty for a player-season with nothing archived, never a guess", async () => {
      expect(await injuryRowsFor(db, ALLEN.id, 2019)).toEqual([]);
    });
  });

  describe("ingestInjuries", () => {
    it("fetches, filters to the known universe, and writes — reporting what it dropped", async () => {
      const client = createNflverseClient({
        fetch: (async () => new Response(readFixture("injuries_2024_buf_w1-3.csv"), { status: 200 })) as typeof globalThis.fetch,
      });
      const [report] = await ingestInjuries(db, client, [2024]);
      expect(report!.season).toBe(2024);
      // Only Josh Allen is in this test's universe; every other BUF player in the fixture is dropped.
      const expectedWritten = mapInjuryRows(BUF_2024_W1_3).filter((r) => r.playerId === ALLEN.id).length;
      expect(report!.written).toBe(expectedWritten);
      expect(report!.unknownToUniverse).toBe(report!.rowsRead > 0 ? mapInjuryRows(BUF_2024_W1_3).length - expectedWritten : 0);

      // Josh Allen is not on the week-1 report at all (no row for him that week) — only weeks 2-3.
      const rows = await injuryRowsFor(db, ALLEN.id, 2024);
      expect(rows.map((r) => r.week)).toEqual([2, 3]);
    });

    it("ingests the 2025 shape (no date_modified column) end to end, archiving the row with a null stamp", async () => {
      const WHITE = { id: "00-0033884", espnId: null, pfrId: "WhitTr00", name: "Tre'Davious White", position: "CB", latestTeam: "BUF", rookieSeason: 2017, lastSeason: 2025 };
      await recordNflPlayers(db, [WHITE]);
      const client = createNflverseClient({
        fetch: (async () => new Response(readFixture("injuries_2025_buf_w1-3.csv"), { status: 200 })) as typeof globalThis.fetch,
      });
      const [report] = await ingestInjuries(db, client, [2025]);
      expect(report!.season).toBe(2025);
      expect(report!.written).toBeGreaterThan(0);

      const rows = await injuryRowsFor(db, WHITE.id, 2025);
      expect(rows.length).toBeGreaterThan(0);
      for (const r of rows) {
        expect(r.dateModified).toBeNull();
      }
      expect(rows.find((r) => r.week === 1)).toMatchObject({ reportStatus: "Doubtful" });
    });

    it("is idempotent — a re-run of a landed ingestion writes nothing new", async () => {
      const client = createNflverseClient({
        fetch: (async () => new Response(readFixture("injuries_2024_buf_w1-3.csv"), { status: 200 })) as typeof globalThis.fetch,
      });
      await ingestInjuries(db, client, [2024]);
      const [second] = await ingestInjuries(db, client, [2024]);
      expect(second!.written).toBe(0);
    });
  });
});
