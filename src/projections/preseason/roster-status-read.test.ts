import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { captureSnapshots, nflPlayers, nflverseRosterWeeks, playerCrosswalk, players } from "@/db/schema";
import { recordObservations } from "../store";
import { DEPTH_METRIC, DEPTH_SOURCE } from "./depth";
import { rosterStatusesAsOf } from "./roster-status-read";

const SEASON = 2026;
const SWEEP_AT = new Date("2026-09-05T12:45:00.000Z");
const LIST_AT = new Date("2026-09-05T22:35:00.000Z");
const DEPTH_AT = new Date("2026-09-01T12:20:00.000Z");
/** The stamp the roster ingest claims for the week-one file (`preseason_rosters.as_of`). */
const WEEK_ONE_STAMP = new Date("2026-09-01T00:00:00.000Z");
const AS_OF = new Date("2026-09-08T00:00:00.000Z");
const READ = { season: SEASON, weekOneStampedAt: WEEK_ONE_STAMP } as const;

const ACTIVE = "00-0000001";
const IR = "00-0000002";
const PRACTICE = "00-0000003";
const CHARTED = "00-0000004";
const SILENT = "00-0000005";
const CROSSWALKED = "00-0000006";

describe("rosterStatusesAsOf", () => {
  let db: Db;

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(nflPlayers).values([
      { id: ACTIVE, name: "Active Back", position: "RB", espnId: "101" },
      { id: IR, name: "Reserve Back", position: "RB", espnId: "102" },
      { id: PRACTICE, name: "Squad Back", position: "RB", espnId: "103" },
      { id: CHARTED, name: "Charted End", position: "TE", espnId: "104" },
      { id: SILENT, name: "Silent End", position: "TE", espnId: null },
      { id: CROSSWALKED, name: "Crosswalked Back", position: "RB", espnId: null },
    ]);
    // The crosswalk carries the Tank01 id for a man whose universe row has no ESPN id.
    await db.insert(players).values({ id: "106", name: "Crosswalked Back", position: "RB", nflTeam: "KC" });
    await db.insert(playerCrosswalk).values({ playerId: "106", nflPlayerId: CROSSWALKED, method: "espn_id", resolvedAt: LIST_AT });
  });

  async function captureHarvest(sweepAt: Date, listAt: Date): Promise<void> {
    await db.insert(captureSnapshots).values([
      {
        source: "tank01_injuries",
        capturedAt: sweepAt,
        digest: `sweep-${sweepAt.toISOString()}`,
        payload: [{ team: "KC", roster: [{ playerID: "101", espnID: "101" }, { playerID: "106", espnID: "106" }] }],
      },
      {
        source: "tank01_player_list",
        capturedAt: listAt,
        digest: `list-${listAt.toISOString()}`,
        payload: [
          { playerID: "101", espnID: "101", team: "KC", isFreeAgent: "False", injury: { designation: "" } },
          { playerID: "102", espnID: "102", team: "KC", isFreeAgent: "False", injury: { designation: "Injured Reserve" } },
          { playerID: "106", espnID: "106", team: "KC", isFreeAgent: "False", injury: { designation: "" } },
        ],
      },
    ]);
  }

  it("reads the harvest first, the week-one roster second, the depth chart third, and stays silent otherwise", async () => {
    await captureHarvest(SWEEP_AT, LIST_AT);
    await db.insert(nflverseRosterWeeks).values([
      { season: SEASON, week: 1, playerId: IR, team: "KC", status: "ACT", position: "RB" },
      { season: SEASON, week: 1, playerId: PRACTICE, team: "NO", status: "DEV", position: "RB" },
    ]);
    await recordObservations(db, [{ season: SEASON, week: 1, playerId: CHARTED, source: DEPTH_SOURCE, metric: DEPTH_METRIC, value: 2, asOf: DEPTH_AT }]);

    const statuses = await rosterStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [ACTIVE, IR, PRACTICE, CHARTED, SILENT, CROSSWALKED] });

    expect(statuses.get(ACTIVE)).toEqual({ kind: "active", source: "tank01_roster_sweep", observedAt: SWEEP_AT, team: "KC" });
    // The harvest's own word outranks a week-one file that still says active.
    expect(statuses.get(IR)).toEqual({ kind: "injured_reserve", source: "tank01_player_list", observedAt: LIST_AT, team: "KC" });
    expect(statuses.get(PRACTICE)).toEqual({ kind: "practice_squad", source: "nflverse_roster_week_1", observedAt: WEEK_ONE_STAMP, team: "NO" });
    expect(statuses.get(CHARTED)).toEqual({ kind: "active", source: "depth_chart", observedAt: DEPTH_AT, team: null });
    expect(statuses.has(SILENT)).toBe(false);
    expect(statuses.get(CROSSWALKED)?.kind).toBe("active");
  });

  it("reads only captures at or before the moment, and only the newest of them", async () => {
    const earlier = new Date("2026-08-28T03:51:00.000Z");
    await db.insert(captureSnapshots).values({
      source: "tank01_player_list",
      capturedAt: earlier,
      digest: "list-early",
      payload: [{ playerID: "102", espnID: "102", team: "KC", isFreeAgent: "True", injury: { designation: "" } }],
    });
    await captureHarvest(SWEEP_AT, LIST_AT);

    const before = await rosterStatusesAsOf(db, { ...READ, asOf: new Date("2026-09-01T00:00:00.000Z"), playerIds: [IR] });
    expect(before.get(IR)).toEqual({ kind: "no_roster", source: "tank01_player_list", observedAt: earlier, team: null });

    const after = await rosterStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [IR] });
    expect(after.get(IR)?.kind).toBe("injured_reserve");
  });

  it("stamps a week-one roster status with the roster ingest's own stamp, and reads a code it does not know as silence", async () => {
    await db.insert(nflverseRosterWeeks).values([
      { season: SEASON, week: 1, playerId: IR, team: "KC", status: "RES", position: "RB" },
      { season: SEASON, week: 1, playerId: PRACTICE, team: "NO", status: "TRC", position: "RB" },
    ]);
    const statuses = await rosterStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [IR, PRACTICE] });
    expect(statuses.get(IR)).toEqual({ kind: "injured_reserve", source: "nflverse_roster_week_1", observedAt: WEEK_ONE_STAMP, team: "KC" });
    expect(statuses.has(PRACTICE)).toBe(false);
  });

  it("returns nothing for an empty population without touching the store", async () => {
    expect((await rosterStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [] })).size).toBe(0);
  });
});
