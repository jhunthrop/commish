import { beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { captureSnapshots, nflPlayers, nflverseInjuries, nflverseRosterWeeks, playerCrosswalk, players } from "@/db/schema";
import { recordObservations } from "../store";
import { currentStatusesAsOf, sweepPhaseFor, weekOneRosterStampOf, withCurrentStatus } from "./current-status";
import { DEPTH_METRIC, DEPTH_SOURCE } from "./depth";
import type { PreseasonInputs } from "./source";

const SEASON = 2026;
const SWEEP_AT = new Date("2026-09-05T12:45:00.000Z");
const LIST_AT = new Date("2026-09-05T22:35:00.000Z");
const DEPTH_AT = new Date("2026-09-01T12:20:00.000Z");
/** The stamp the roster ingest claims for the week-one file (`preseason_rosters.as_of`). */
const WEEK_ONE_STAMP = new Date("2026-09-01T00:00:00.000Z");
const AS_OF = new Date("2026-09-08T00:00:00.000Z");
const READ = { season: SEASON, weekOneStampedAt: WEEK_ONE_STAMP, phase: "cutdown" } as const;
const LISTED_ONLY = "00-0000007";

/** A complete cutdown sweep: 32 clubs of 45, with the two sweep-active men on KC and the first of them Out. */
function completeSweep(): unknown {
  return Array.from({ length: 32 }, (_, club) => ({
    team: club === 0 ? "KC" : `C${club}`,
    roster: Array.from({ length: 45 }, (_, i) => ({
      espnID: club === 0 && i === 0 ? "101" : club === 0 && i === 1 ? "106" : `${club}-${i}`,
      injury: { designation: club === 0 && i === 0 ? "Out" : "" },
    })),
  }));
}

const ACTIVE = "00-0000001";
const IR = "00-0000002";
const PRACTICE = "00-0000003";
const CHARTED = "00-0000004";
const SILENT = "00-0000005";
const CROSSWALKED = "00-0000006";

describe("currentStatusesAsOf", () => {
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

  /** A one-club sweep by default (INCOMPLETE, so absence from it says nothing), or the complete one. */
  async function captureHarvest(sweepAt: Date, listAt: Date, sweep: unknown = [{ team: "KC", roster: [{ playerID: "101", espnID: "101" }, { playerID: "106", espnID: "106" }] }]): Promise<void> {
    await db.insert(captureSnapshots).values([
      { source: "tank01_injuries", capturedAt: sweepAt, digest: `sweep-${sweepAt.toISOString()}`, payload: sweep },
      {
        source: "tank01_player_list",
        capturedAt: listAt,
        digest: `list-${listAt.toISOString()}`,
        payload: [
          { playerID: "101", espnID: "101", team: "KC", isFreeAgent: "False", injury: { designation: "" } },
          { playerID: "102", espnID: "102", team: "KC", isFreeAgent: "False", injury: { designation: "Injured Reserve - Designated to Return" } },
          { playerID: "106", espnID: "106", team: "KC", isFreeAgent: "False", injury: { designation: "" } },
          { playerID: "107", espnID: "107", team: "NO", isFreeAgent: "False", injury: { designation: "" } },
        ],
      },
    ]);
  }

  it("does not read absence from an incomplete sweep as a status: the listed man falls through to the week-one row, and the summary says so", async () => {
    await db.insert(nflPlayers).values({ id: LISTED_ONLY, name: "Listed Back", position: "RB", espnId: "107" });
    await captureHarvest(SWEEP_AT, LIST_AT);
    await db.insert(nflverseRosterWeeks).values({ season: SEASON, week: 1, playerId: LISTED_ONLY, team: "NO", status: "DEV", position: "RB" });
    const read = await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [LISTED_ONLY, ACTIVE] });
    expect(read.sweep).toEqual({ capturedAt: SWEEP_AT, clubCount: 1, smallestClub: 2, complete: false });
    expect(read.statuses.get(LISTED_ONLY)?.kind).toBe("practice_squad");
    expect(read.statuses.get(LISTED_ONLY)?.source).toBe("nflverse_roster_week_1");
    // Membership of the partial sweep still counts.
    expect(read.statuses.get(ACTIVE)?.kind).toBe("active");
  });

  it("reads absence from a complete sweep as off the active roster, and the sweep's own Out as the detail on an active man", async () => {
    await db.insert(nflPlayers).values({ id: LISTED_ONLY, name: "Listed Back", position: "RB", espnId: "107" });
    // The list is OLDER than the sweep here, so the sweep's designation is the fresher word.
    await captureHarvest(SWEEP_AT, new Date(SWEEP_AT.getTime() - 60_000), completeSweep());
    const read = await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [LISTED_ONLY, ACTIVE] });
    expect(read.sweep?.complete).toBe(true);
    expect(read.statuses.get(LISTED_ONLY)).toEqual({ kind: "off_active_roster", source: "tank01_player_list", observedAt: new Date(SWEEP_AT.getTime() - 60_000), team: "NO", detail: null });
    expect(read.statuses.get(ACTIVE)).toEqual({ kind: "active", source: "tank01_roster_sweep", observedAt: SWEEP_AT, team: "KC", detail: "out" });
  });

  it("reads the harvest first, the week-one roster second, the depth chart third, and stays silent otherwise", async () => {
    await captureHarvest(SWEEP_AT, LIST_AT);
    await db.insert(nflverseRosterWeeks).values([
      { season: SEASON, week: 1, playerId: IR, team: "KC", status: "ACT", position: "RB" },
      { season: SEASON, week: 1, playerId: PRACTICE, team: "NO", status: "DEV", position: "RB" },
    ]);
    await recordObservations(db, [{ season: SEASON, week: 1, playerId: CHARTED, source: DEPTH_SOURCE, metric: DEPTH_METRIC, value: 2, asOf: DEPTH_AT }]);

    const { statuses } = await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [ACTIVE, IR, PRACTICE, CHARTED, SILENT, CROSSWALKED] });

    expect(statuses.get(ACTIVE)).toEqual({ kind: "active", source: "tank01_roster_sweep", observedAt: SWEEP_AT, team: "KC", detail: null });
    // The harvest's own word outranks a week-one file that still says active, detail included.
    expect(statuses.get(IR)).toEqual({ kind: "injured_reserve", source: "tank01_player_list", observedAt: LIST_AT, team: "KC", detail: "designated_to_return" });
    expect(statuses.get(PRACTICE)).toEqual({ kind: "practice_squad", source: "nflverse_roster_week_1", observedAt: WEEK_ONE_STAMP, team: "NO", detail: null });
    expect(statuses.get(CHARTED)).toEqual({ kind: "active", source: "depth_chart", observedAt: DEPTH_AT, team: null, detail: null });
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

    const before = await currentStatusesAsOf(db, { ...READ, asOf: new Date("2026-09-01T00:00:00.000Z"), playerIds: [IR] });
    expect(before.statuses.get(IR)).toEqual({ kind: "no_roster", source: "tank01_player_list", observedAt: earlier, team: null, detail: null });

    const after = await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [IR] });
    expect(after.statuses.get(IR)?.kind).toBe("injured_reserve");
  });

  it("stamps a week-one roster status with the roster ingest's own stamp, reads its detail code, and reads a code it does not know as silence", async () => {
    await db.insert(nflverseRosterWeeks).values([
      { season: SEASON, week: 1, playerId: IR, team: "KC", status: "RES", statusDetail: "R40", position: "RB" },
      { season: SEASON, week: 1, playerId: PRACTICE, team: "NO", status: "TRC", position: "RB" },
    ]);
    const { statuses, sweep } = await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [IR, PRACTICE] });
    expect(statuses.get(IR)).toEqual({ kind: "suspended", source: "nflverse_roster_week_1", observedAt: WEEK_ONE_STAMP, team: "KC", detail: "suspended_term" });
    expect(statuses.has(PRACTICE)).toBe(false);
    expect(sweep).toBeNull();
  });

  describe("the week-one report's Out, dated by the file's own stamp", () => {
    const report = (playerId: string, dateModified: Date | null, reportStatus = "Out") => ({ season: SEASON, week: 1, playerId, reportStatus, primaryInjury: "Knee", practiceStatus: "", dateModified });

    beforeEach(async () => {
      await db.insert(nflverseRosterWeeks).values([
        { season: SEASON, week: 1, playerId: ACTIVE, team: "KC", status: "ACT", position: "RB" },
        { season: SEASON, week: 1, playerId: IR, team: "KC", status: "RES", statusDetail: "R01", position: "RB" },
        { season: SEASON, week: 1, playerId: PRACTICE, team: "NO", status: "INA", position: "RB" },
        { season: SEASON, week: 1, playerId: CHARTED, team: "NO", status: "ACT", position: "TE" },
      ]);
    });

    it("marks an active man Out when the report is dated at or before the moment, and never a reserve man", async () => {
      await db.insert(nflverseInjuries).values([report(ACTIVE, new Date("2026-09-07T18:00:00.000Z")), report(IR, new Date("2026-09-07T18:00:00.000Z"))]);
      const { statuses } = await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [ACTIVE, IR] });
      expect(statuses.get(ACTIVE)).toEqual({ kind: "active", source: "nflverse_roster_week_1", observedAt: WEEK_ONE_STAMP, team: "KC", detail: "out" });
      expect(statuses.get(IR)?.detail).toBeNull();
    });

    it("does not read a report dated after the moment, an undated one, or one that is not an absence", async () => {
      await db.insert(nflverseInjuries).values([
        report(ACTIVE, new Date("2026-09-08T00:00:00.001Z")),
        report(PRACTICE, null),
        report(CHARTED, new Date("2026-09-07T18:00:00.000Z"), "Questionable"),
      ]);
      const { statuses } = await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [ACTIVE, PRACTICE, CHARTED] });
      expect(statuses.get(ACTIVE)?.detail).toBeNull();
      expect(statuses.get(PRACTICE)?.detail).toBeNull();
      expect(statuses.get(CHARTED)?.detail).toBeNull();
    });

    it("marks a Tank01-active man Out too when the dated report says so and the capture said nothing", async () => {
      await captureHarvest(SWEEP_AT, LIST_AT);
      await db.insert(nflverseInjuries).values(report(ACTIVE, new Date("2026-09-07T18:00:00.000Z")));
      const { statuses } = await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [ACTIVE] });
      expect(statuses.get(ACTIVE)).toEqual({ kind: "active", source: "tank01_roster_sweep", observedAt: SWEEP_AT, team: "KC", detail: "out" });
    });
  });

  it("returns nothing for an empty population without touching the store", async () => {
    expect(await currentStatusesAsOf(db, { ...READ, asOf: AS_OF, playerIds: [] })).toEqual({ statuses: new Map(), sweep: null });
  });
});

describe("withCurrentStatus", () => {
  let db: Db;

  function inputs(momentKind: PreseasonInputs["momentKind"]): PreseasonInputs {
    const row = (playerId: string, status: "active" | "reserve", asOf: Date) => ({
      season: SEASON,
      team: "KC",
      playerId,
      position: "RB",
      status,
      birthDate: null,
      draftYear: null,
      draftPick: null,
      draftClub: null,
      asOf,
    });
    return {
      season: SEASON,
      moment: AS_OF,
      momentKind,
      roster: [row(ACTIVE, "reserve", WEEK_ONE_STAMP), row(IR, "active", new Date("2026-09-02T00:00:00.000Z"))],
      positions: new Map(),
      history: [],
      usage: [],
      priorPlayerTeams: [],
      teamObservations: [],
      availability: new Map(),
      depthChart: new Map(),
      laws: [],
      lawFacts: new Map(),
      discoveryFacts: new Map(),
    };
  }

  beforeEach(async () => {
    db = createTestDb();
    await truncateAll(db);
    await db.insert(nflPlayers).values([
      { id: ACTIVE, name: "Active Back", position: "RB", espnId: "101" },
      { id: IR, name: "Reserve Back", position: "RB", espnId: "102" },
    ]);
    // A 32-club sweep of 42: whole at a played season's floor, partial at the cutdown's.
    await db.insert(captureSnapshots).values({
      source: "tank01_injuries",
      capturedAt: SWEEP_AT,
      digest: "sweep-42",
      payload: Array.from({ length: 32 }, (_, club) => ({ team: `C${club}`, roster: Array.from({ length: 42 }, (_, i) => ({ espnID: club === 0 && i === 0 ? "101" : `${club}-${i}` })) })),
    });
    await db.insert(nflverseRosterWeeks).values({ season: SEASON, week: 1, playerId: IR, team: "KC", status: "RES", statusDetail: "R48", position: "RB" });
  });

  it("attaches the resolution over the whole week-one roster, stamped with the roster's latest claim", async () => {
    const live = inputs("live");
    expect(weekOneRosterStampOf(live)).toEqual(new Date("2026-09-02T00:00:00.000Z"));
    const { inputs: statused, sweep } = await withCurrentStatus(db, live);
    expect(statused.currentStatus.get(ACTIVE)?.kind).toBe("active");
    expect(statused.currentStatus.get(IR)).toEqual({ kind: "injured_reserve", source: "nflverse_roster_week_1", observedAt: new Date("2026-09-02T00:00:00.000Z"), team: "KC", detail: "designated_to_return" });
    expect(sweep).toEqual({ capturedAt: SWEEP_AT, clubCount: 32, smallestClub: 42, complete: false });
    // Everything else on the inputs is carried through untouched.
    expect(statused.roster).toBe(live.roster);
  });

  it("judges the sweep at the cutdown floor for a live moment and the in-season floor for a replay", async () => {
    expect(sweepPhaseFor("live")).toBe("cutdown");
    expect(sweepPhaseFor("replay")).toBe("in_season");
    expect((await withCurrentStatus(db, inputs("live"))).sweep?.complete).toBe(false);
    expect((await withCurrentStatus(db, inputs("replay"))).sweep?.complete).toBe(true);
  });
});
