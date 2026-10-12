import { describe, expect, it } from "vitest";
import { parseCsv } from "./csv";
import { readFixture, readManifest } from "./fixtures";
import {
  HISTORICAL_ROSTER_FLOOR,
  ROSTER_ASSET_FLOOR,
  ROSTER_SOURCE_CONFIG,
  mapWeek1Rosters,
  rosterStatusOf,
  week1RosterAsOf,
  week1RosterAsOfBoundedBy,
} from "./rosters";

/**
 * Read against a real slice of the real release, not a hand-written table, for the reason the other
 * nflverse suites give: a hand-written fixture tests our understanding of the file rather than the
 * file, and the thing that breaks in practice is the file.
 */
const BUFFALO_2024 = parseCsv(readFixture("roster_weekly_2024_buf_w1.csv"));

describe("week1RosterAsOf", () => {
  it("stamps the first of September, which is after the cutdown and before every opener since 2021", () => {
    expect(week1RosterAsOf(2024).toISOString()).toBe("2024-09-01T00:00:00.000Z");
    expect(week1RosterAsOf(2023).toISOString()).toBe("2023-09-01T00:00:00.000Z");
  });

  it("is EARLIER than the earliest game a season can produce, or a preseason board could not read it", () => {
    // The 2024 opener was 5 September. A stamp on or after it would be admitted by no preseason
    // moment and the whole ingestion would be inert.
    expect(week1RosterAsOf(2024).getTime()).toBeLessThan(Date.UTC(2024, 8, 5));
  });
});

describe("week1RosterAsOfBoundedBy (Task 3, ruling C — mirrors parseExpertConsensus's own earlerOf bound)", () => {
  it("keeps the September-1 convention unchanged for an ARCHIVE — the fetch happens long after it", () => {
    // Ingesting 2024 today (long after its own 1 September) must not move the stamp: every
    // measurement taken under the fixed convention has to stay pinned to it exactly.
    const fetchedAt = new Date("2026-09-01T12:00:00.000Z");
    expect(week1RosterAsOfBoundedBy(2024, fetchedAt)).toEqual(week1RosterAsOf(2024));
  });

  it("bounds to the fetch instant for a season whose file is fetched BEFORE its own first of September", () => {
    const fetchedAt = new Date("2026-08-20T15:00:00.000Z");
    const bounded = week1RosterAsOfBoundedBy(2026, fetchedAt);
    expect(bounded).toEqual(fetchedAt);
    expect(bounded.getTime()).toBeLessThan(week1RosterAsOf(2026).getTime());
  });

  it("is the EARLIER of the two, inclusive of the boundary", () => {
    const exact = week1RosterAsOf(2026);
    expect(week1RosterAsOfBoundedBy(2026, exact)).toEqual(exact);
    expect(week1RosterAsOfBoundedBy(2026, new Date(exact.getTime() + 1))).toEqual(exact);
  });
});

describe("rosterStatusOf", () => {
  it("FOLDS THE GAME-DAY INACTIVE LIST INTO ACTIVE, which is the leakage this coarsening exists to stop", () => {
    // INA is decided ninety minutes before kickoff. Distinguishing it here would smuggle a Sunday
    // fact into a row stamped in late August, in the one place it would flatter us most.
    expect(rosterStatusOf("INA")).toBe("active");
    expect(rosterStatusOf("ACT")).toBe("active");
  });

  it("keeps the reserve lists, which ARE settled at the cutdown and are the strongest signal there is", () => {
    expect(rosterStatusOf("RES")).toBe("reserve");
    expect(rosterStatusOf("PUP")).toBe("reserve");
    expect(rosterStatusOf("EXE")).toBe("reserve");
  });

  it("separates the practice squad from the roster and from being cut", () => {
    expect(rosterStatusOf("DEV")).toBe("practice_squad");
    expect(rosterStatusOf("CUT")).toBe("off_roster");
    expect(rosterStatusOf("RET")).toBe("off_roster");
  });

  it("reads an unrecognised code as a reserve designation rather than throwing", () => {
    // A code we have not seen is far likelier to be a new reserve list than a new way of being
    // available, and the conservative reading costs a player games rather than inventing him some.
    expect(rosterStatusOf("E14")).toBe("reserve");
  });
});

describe("mapWeek1Rosters", () => {
  const entries = mapWeek1Rosters(BUFFALO_2024, 2024);

  it("reads one club's week-one roster, one row per player", () => {
    expect(entries.length).toBeGreaterThan(50);
    expect(new Set(entries.map((entry) => entry.playerId)).size).toBe(entries.length);
    expect(new Set(entries.map((entry) => entry.team))).toEqual(new Set(["BUF"]));
  });

  it("carries the biography that never changes, which is what rookies and ageing are read from", () => {
    const allen = entries.find((entry) => entry.playerId === "00-0034857");
    expect(allen).toBeDefined();
    expect(allen!.position).toBe("QB");
    expect(allen!.status).toBe("active");
    expect(allen!.birthDate).toBe("1996-05-21");
    expect(allen!.draftYear).toBe(2018);
    expect(allen!.draftPick).toBe(7);
  });

  it("reads an undrafted player's pick as null rather than as zero", () => {
    // Zero is a pick number and null is a status. A board that read the undrafted as pick zero would
    // rank every one of them ahead of the first overall selection.
    const undrafted = entries.filter((entry) => entry.draftPick === null);
    expect(undrafted.length).toBeGreaterThan(0);
    for (const entry of undrafted) expect(entry.draftPick).toBeNull();
  });

  it("stamps every row at the cutdown, never at a game day", () => {
    for (const entry of entries) expect(entry.asOf).toEqual(week1RosterAsOf(2024));
  });

  it("keeps the cut and the practice squad rather than dropping them", () => {
    // "He was on nobody's roster" has to be a fact a board can read. Dropping the row would make it
    // indistinguishable from a player the release never carried.
    const statuses = new Set(entries.map((entry) => entry.status));
    expect(statuses).toContain("off_roster");
    expect(statuses).toContain("practice_squad");
    expect(statuses).toContain("reserve");
  });

  it("is sorted by player id, so a board built from it is reproducible run to run", () => {
    const ids = entries.map((entry) => entry.playerId);
    expect(ids).toEqual([...ids].sort());
  });

  it("REFUSES a season whose cutdown fell after the date it would stamp, with no as-of supplied", () => {
    // 2020's pandemic calendar pushed the cutdown to 5 September, after the first of September this
    // module claims. Ingesting it without an explicit stamp would assert we knew a roster five days
    // before it existed.
    expect(() => mapWeek1Rosters(BUFFALO_2024, 2020)).toThrow(/only ingested from 2021/);
  });

  it("drops rows for a season the file is not about, rather than mislabelling them", () => {
    expect(mapWeek1Rosters(BUFFALO_2024, 2023)).toHaveLength(0);
  });

  it("ACCEPTS a season before the fixed-stamp cutover once the caller supplies an honest as-of", () => {
    // This is `historicalWeek1RosterAsOf`'s whole reason to exist: a caller that has derived its own
    // honest stamp (from the season's own schedule, not a guessed calendar date) may hand it in
    // directly, and the module no longer refuses the season on its behalf.
    const historicalStamp = new Date("2015-09-09T23:59:59.999Z");
    expect(() => mapWeek1Rosters(BUFFALO_2024, 2015, historicalStamp)).not.toThrow();
  });

  it("stamps every row with the SUPPLIED as-of, not the fixed first-of-September one", () => {
    const historicalStamp = new Date("2015-09-09T23:59:59.999Z");
    const entriesFor2024RowsClaimedAs2024 = mapWeek1Rosters(BUFFALO_2024, 2024, historicalStamp);
    for (const entry of entriesFor2024RowsClaimedAs2024) expect(entry.asOf).toEqual(historicalStamp);
  });
});

describe("ROSTER_ASSET_FLOOR and HISTORICAL_ROSTER_FLOOR", () => {
  it("record the probed asset floor and the narrower scope this engine actually backfills to", () => {
    // Probed by hand against the live release on 2026-08-31: 2002 returned a real CSV body and 2001
    // a genuine HTTP 404. See the constants' own docblocks for the full account.
    expect(ROSTER_ASSET_FLOOR).toBe(2002);
    // MOVED FROM 2013 TO 2003 ON 2026-09-02 (fit-round Task 1), deliberately and on its own: the
    // previous round moved `MEASURE_SEASONS.from` to 2003 and left this constant alone precisely so
    // that the roster backfill would have to be argued for separately. It was. It no longer matches
    // `SNAP_COUNT_ASSET_FLOOR` (still 2013, an upstream fact nothing here can move).
    expect(HISTORICAL_ROSTER_FLOOR).toBe(2003);
    // Still ABOVE the asset floor: nflverse publishes `roster_weekly_2002.csv`, but a 2002 roster
    // could not be honestly stamped, because `historicalWeek1RosterAsOf` derives its stamp from the
    // season's own first kickoff and the schedule ingest reaches 2003.
    expect(ROSTER_ASSET_FLOOR).toBeLessThan(HISTORICAL_ROSTER_FLOOR);
  });
});

describe("the fixture", () => {
  it("is listed in the manifest, so an unrecorded request cannot silently hit the network", () => {
    const entry = readManifest().entries.find((candidate) => candidate.file === "roster_weekly_2024_buf_w1.csv");
    expect(entry).toBeDefined();
    expect(entry!.release).toBe(ROSTER_SOURCE_CONFIG.release);
    expect(entry!.asset).toBe(ROSTER_SOURCE_CONFIG.file(2024));
  });
});
