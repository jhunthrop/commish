import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@research-ts/db/client";
import { nflPlayers, nflverseInjuries, nflverseRosterWeeks } from "@research-ts/db/schema";
import { createTestDb, truncateAll } from "@research-ts/db/test-db";
import { availabilityStoreCoverage, injuryReportsBySeason, rosterWeeksBySeason, seasonAvailabilityRecords } from "./season-record";

const SHOUGH = "00-0040743";
const LOST = "00-0000002";

describe("seasonAvailabilityRecords", () => {
  const activeWeeks = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18].map((week) => ({ week, status: "ACT", statusDetail: "" }));
  const shoughWeeks = [3, 8, 9, 10, 12, 13, 14, 15, 16, 17, 18];

  it("reads a healthy backup as eleven games played and none unavailable", () => {
    const records = seasonAvailabilityRecords({
      season: 2025,
      teamGames: 17,
      covered: true,
      playedWeeks: new Map([[SHOUGH, shoughWeeks]]),
      rosterRows: new Map([[SHOUGH, activeWeeks]]),
      injuryRows: new Map([[SHOUGH, [{ week: 16, reportStatus: "", primaryInjury: "" }]]]),
    });
    expect(records.get(SHOUGH)).toEqual({ season: 2025, gamesPlayed: 11, teamGames: 17, gamesUnavailable: 0, gamesSuspended: 0 });
  });

  it("hears a man who never played because he spent the season on a reserve list", () => {
    const records = seasonAvailabilityRecords({
      season: 2025,
      teamGames: 17,
      covered: true,
      playedWeeks: new Map(),
      rosterRows: new Map([[LOST, Array.from({ length: 18 }, (_, index) => ({ week: index + 1, status: "RES", statusDetail: "" }))]]),
      injuryRows: new Map(),
    });
    expect(records.get(LOST)).toEqual({ season: 2025, gamesPlayed: 0, teamGames: 17, gamesUnavailable: 17, gamesSuspended: 0 });
  });

  it("reads an uncovered season as played games with no availability claim, and drops nobody it cannot count", () => {
    const records = seasonAvailabilityRecords({
      season: 2025,
      teamGames: 17,
      covered: false,
      playedWeeks: new Map([[SHOUGH, shoughWeeks]]),
      rosterRows: new Map(),
      injuryRows: new Map(),
    });
    expect(records.get(SHOUGH)).toEqual({ season: 2025, gamesPlayed: 11, teamGames: 17, gamesUnavailable: null, gamesSuspended: null });
  });

  it("counts a suspension apart from the unavailable weeks: Rashee Rice, 2025, six suspended, three to a knee, eight played", () => {
    const RICE = "00-0039067";
    const rows = [
      ...[1, 2, 3, 4, 5, 6].map((week) => ({ week, status: "RES", statusDetail: "R40" })),
      ...[7, 8, 9, 11, 12, 13, 14, 15].map((week) => ({ week, status: "ACT", statusDetail: "A01" })),
      { week: 16, status: "INA", statusDetail: "A01" },
      { week: 17, status: "RES", statusDetail: "R01" },
      { week: 18, status: "RES", statusDetail: "R01" },
    ];
    const records = seasonAvailabilityRecords({
      season: 2025,
      teamGames: 17,
      covered: true,
      playedWeeks: new Map([[RICE, [7, 8, 9, 11, 12, 13, 14, 15]]]),
      rosterRows: new Map([[RICE, rows]]),
      injuryRows: new Map([[RICE, [{ week: 16, reportStatus: "Out", primaryInjury: "Knee" }]]]),
    });
    expect(records.get(RICE)).toEqual({ season: 2025, gamesPlayed: 8, teamGames: 17, gamesUnavailable: 3, gamesSuspended: 6 });
  });

  it("carries no record for a season he only sat suspended: neither played nor unavailable, the season says nothing about his availability", () => {
    const records = seasonAvailabilityRecords({
      season: 2025,
      teamGames: 17,
      covered: true,
      playedWeeks: new Map(),
      rosterRows: new Map([[LOST, Array.from({ length: 17 }, (_, index) => ({ week: index + 1, status: "SUS", statusDetail: "" }))]]),
      injuryRows: new Map(),
    });
    expect(records.has(LOST)).toBe(false);
  });

  it("carries no record for a man who was neither played nor unavailable: a practice-squad year says nothing", () => {
    const records = seasonAvailabilityRecords({
      season: 2025,
      teamGames: 17,
      covered: true,
      playedWeeks: new Map(),
      rosterRows: new Map([[LOST, [{ week: 1, status: "DEV", statusDetail: "" }, { week: 2, status: "DEV", statusDetail: "" }]]]),
      injuryRows: new Map(),
    });
    expect(records.has(LOST)).toBe(false);
  });
});

describe("the designation store reads", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(nflPlayers).values([
      { id: SHOUGH, name: "Tyler Shough", position: "QB" },
      { id: LOST, name: "Reserve Man", position: "RB" },
    ]);
    await db.insert(nflverseRosterWeeks).values([
      { season: 2025, week: 1, playerId: SHOUGH, team: "NO", status: "ACT", position: "QB" },
      { season: 2025, week: 2, playerId: SHOUGH, team: "NO", status: "ACT", position: "QB" },
      { season: 2025, week: 1, playerId: LOST, team: "SF", status: "RES", position: "RB" },
      { season: 2024, week: 1, playerId: LOST, team: "SF", status: "ACT", position: "RB" },
    ]);
    await db.insert(nflverseInjuries).values([{ season: 2025, week: 2, playerId: SHOUGH, reportStatus: "Questionable", primaryInjury: "Ankle", practiceStatus: "" }]);
  });

  it("calls a season covered only when BOTH stores hold a row for it", async () => {
    expect(await availabilityStoreCoverage(db, [2023, 2024, 2025])).toEqual(new Set([2025]));
  });

  it("keys every roster week and every report by season, then by player, in week order", async () => {
    const roster = await rosterWeeksBySeason(db, [2024, 2025]);
    expect(roster.get(2025)?.get(SHOUGH)).toEqual([
      { week: 1, status: "ACT", statusDetail: "" },
      { week: 2, status: "ACT", statusDetail: "" },
    ]);
    expect(roster.get(2024)?.get(LOST)).toEqual([{ week: 1, status: "ACT", statusDetail: "" }]);
    const reports = await injuryReportsBySeason(db, [2025]);
    expect(reports.get(2025)?.get(SHOUGH)).toEqual([{ week: 2, reportStatus: "Questionable", primaryInjury: "Ankle" }]);
    expect(reports.get(2025)?.has(LOST)).toBe(false);
  });

  it("returns an empty map, not a missing one, for a season with no rows", async () => {
    expect((await rosterWeeksBySeason(db, [2019])).get(2019)?.size).toBe(0);
  });
});
