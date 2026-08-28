import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import {
  playerTeamsAsOf,
  recordPlayerTeams,
  recordTeamObservations,
  teamObservationsAsOf,
  type PlayerWeekTeam,
  type TeamWeekObservation,
} from "./team-store";

const db = createTestDb();

const TUESDAY = new Date("2024-10-15T12:00:00.000Z");
const WEDNESDAY = new Date("2024-10-16T12:00:00.000Z");
const SUNDAY = new Date("2024-10-20T20:00:00.000Z");

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(nflPlayers).values([
    { id: "p1", pfrId: "OneOn00", name: "One", position: "WR", latestTeam: "CLE", rookieSeason: 2020, lastSeason: 2024 },
    { id: "p2", pfrId: "TwoTw00", name: "Two", position: "WR", latestTeam: "BUF", rookieSeason: 2019, lastSeason: 2024 },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
});

function teamFact(over: Partial<TeamWeekObservation> = {}): TeamWeekObservation {
  return {
    season: 2024,
    week: 6,
    team: "CLE",
    source: "nflverse_pbp",
    metric: "pace_seconds_per_play",
    value: 28.4,
    asOf: TUESDAY,
    ...over,
  };
}

function playerTeam(over: Partial<PlayerWeekTeam> = {}): PlayerWeekTeam {
  return { season: 2024, week: 6, playerId: "p1", team: "CLE", asOf: TUESDAY, ...over };
}

describe("recordTeamObservations", () => {
  it("writes every row it is given", async () => {
    expect(
      await recordTeamObservations(db, [teamFact(), teamFact({ metric: "line_stuffed_rate", value: 0.18 }), teamFact({ team: "BUF" })]),
    ).toBe(3);
  });

  it("re-recording an identical fact writes nothing — an ingestion re-run is not a restatement", async () => {
    await recordTeamObservations(db, [teamFact()]);
    expect(await recordTeamObservations(db, [teamFact()])).toBe(0);
  });

  it("refuses a batch stating two different values for one fact at one moment", async () => {
    await expect(recordTeamObservations(db, [teamFact({ value: 28.4 }), teamFact({ value: 31.1 })])).rejects.toThrow(/contradict/i);
  });

  it("refuses a non-finite value rather than storing a NaN a metric will later throw on", async () => {
    await expect(recordTeamObservations(db, [teamFact({ value: Number.NaN })])).rejects.toThrow(/finite/i);
  });
});

describe("teamObservationsAsOf — the leakage defence, one level up", () => {
  it("cannot see a fact stamped after the moment being replayed", async () => {
    await recordTeamObservations(db, [teamFact({ value: 28.4, asOf: TUESDAY }), teamFact({ value: 31.1, asOf: SUNDAY })]);
    const known = await teamObservationsAsOf(db, { season: 2024, week: 6, asOf: WEDNESDAY });
    expect(known).toEqual([expect.objectContaining({ team: "CLE", value: 28.4, asOf: TUESDAY })]);
  });

  it("takes the latest restatement at or before the as-of", async () => {
    await recordTeamObservations(db, [teamFact({ value: 28.4, asOf: TUESDAY }), teamFact({ value: 31.1, asOf: SUNDAY })]);
    const after = await teamObservationsAsOf(db, { season: 2024, week: 6, asOf: new Date("2024-10-21T00:00:00.000Z") });
    expect(after.map((row) => row.value)).toEqual([31.1]);
  });

  it("keeps teams, sources and metrics apart rather than collapsing them", async () => {
    await recordTeamObservations(db, [
      teamFact(),
      teamFact({ team: "BUF" }),
      teamFact({ source: "nflverse_schedule" }),
      teamFact({ metric: "line_stuffed_rate", value: 0.18 }),
    ]);
    expect(await teamObservationsAsOf(db, { season: 2024, week: 6, asOf: WEDNESDAY })).toHaveLength(4);
  });

  it("reads a week range in one query, still as-of", async () => {
    await recordTeamObservations(db, [
      teamFact({ week: 4, value: 1 }),
      teamFact({ week: 5, value: 2 }),
      teamFact({ week: 6, value: 3, asOf: SUNDAY }),
    ]);
    const known = await teamObservationsAsOf(db, { season: 2024, week: { from: 1, to: 6 }, asOf: WEDNESDAY });
    expect(known.map((row) => [row.week, row.value])).toEqual([[4, 1], [5, 2]]);
  });

  it("filters to one source when asked", async () => {
    await recordTeamObservations(db, [teamFact(), teamFact({ source: "nflverse_schedule" })]);
    const known = await teamObservationsAsOf(db, { season: 2024, week: 6, asOf: WEDNESDAY, source: "nflverse_schedule" });
    expect(known.map((row) => row.source)).toEqual(["nflverse_schedule"]);
  });
});

describe("playerTeamsAsOf — a trade is knowable only once it has been played", () => {
  it("does not show a move stamped after the replay moment", async () => {
    await recordPlayerTeams(db, [
      playerTeam({ week: 6, team: "CLE", asOf: TUESDAY }),
      playerTeam({ week: 7, team: "BUF", asOf: SUNDAY }),
    ]);
    const known = await playerTeamsAsOf(db, { season: 2024, week: { from: 1, to: 18 }, asOf: WEDNESDAY });
    expect(known.map((row) => [row.week, row.team])).toEqual([[6, "CLE"]]);
  });

  it("shows the move once the week that proves it has landed", async () => {
    await recordPlayerTeams(db, [
      playerTeam({ week: 6, team: "CLE", asOf: TUESDAY }),
      playerTeam({ week: 7, team: "BUF", asOf: SUNDAY }),
    ]);
    const known = await playerTeamsAsOf(db, { season: 2024, week: { from: 1, to: 18 }, asOf: new Date("2024-10-21T00:00:00.000Z") });
    expect(known.map((row) => [row.week, row.team])).toEqual([[6, "CLE"], [7, "BUF"]]);
  });

  it("re-recording an identical edge writes nothing", async () => {
    await recordPlayerTeams(db, [playerTeam()]);
    expect(await recordPlayerTeams(db, [playerTeam()])).toBe(0);
  });
});
