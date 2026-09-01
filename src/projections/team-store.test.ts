import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { SCHEDULE_METRICS, SCHEDULE_SOURCE } from "./nflverse/schedule";
import {
  firstKickoffFor,
  playerTeamsAsOf,
  recordPlayerTeams,
  recordTeamObservations,
  requireFirstKickoffFor,
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

function kickoffFact(over: Partial<TeamWeekObservation> = {}): TeamWeekObservation {
  return {
    season: 2024,
    week: 1,
    team: "BUF",
    source: SCHEDULE_SOURCE.kickoff,
    metric: SCHEDULE_METRICS.kickoffInstant,
    value: 1,
    asOf: TUESDAY,
    ...over,
  };
}

/**
 * `firstKickoffFor`/`requireFirstKickoffFor` — the one shared definition of "a season's first
 * kickoff" (fix round, I4/I5), consolidating what `depth.ts`, `source.ts`'s live path and
 * `replay-moments.ts`'s `playerGameMomentsFor` each used to compute separately.
 */
describe("firstKickoffFor / requireFirstKickoffFor", () => {
  it("returns the earliest kickoff instant across every team in WEEK ONE", async () => {
    await recordTeamObservations(db, [
      kickoffFact({ asOf: new Date("2024-09-08T17:00:00.000Z") }),
      kickoffFact({ team: "CLE", asOf: new Date("2024-09-08T20:00:00.000Z") }),
    ]);
    expect(await firstKickoffFor(db, 2024)).toEqual(new Date("2024-09-08T17:00:00.000Z"));
  });

  it("returns null, not a throw, when the store holds no kickoff instants for the season", async () => {
    expect(await firstKickoffFor(db, 2024)).toBeNull();
  });

  /**
   * I1 (fix round review) — THE SINGLE POINT EVERYTHING ELSE REDUCES TO. Before this, the query took
   * `min(asOf)` over EVERY week's kickoff row, with no week predicate at all: a season whose week-1
   * ingest had not landed yet, but whose later weeks had, would silently report a LATER week's
   * kickoff as though it were the season's first — unlocking both a fake live moment past a real
   * October game and an ingest cutoff that trusts an in-season instant. This pins the fix two ways.
   */
  it("IGNORES a later week's kickoff even when it is stamped EARLIER than week one's own — week one only, never a minimum across weeks", async () => {
    await recordTeamObservations(db, [
      kickoffFact({ week: 1, team: "KC", asOf: new Date("2024-09-08T17:00:00.000Z") }),
      // Stamped BEFORE week one's own kickoff — a data quirk (a correction, a late-arriving row) that
      // must not let a later week win the "first kickoff" claim regardless of its own as-of.
      kickoffFact({ week: 6, team: "CLE", asOf: new Date("2024-09-01T00:00:00.000Z") }),
    ]);
    expect(await firstKickoffFor(db, 2024)).toEqual(new Date("2024-09-08T17:00:00.000Z"));
  });

  it("returns null — never a WRONG instant — when week one is absent from a partially-ingested schedule, even though later weeks are present", async () => {
    await recordTeamObservations(db, [
      kickoffFact({ week: 2, team: "KC", asOf: new Date("2024-09-15T17:00:00.000Z") }),
      kickoffFact({ week: 6, team: "CLE", asOf: new Date("2024-10-13T17:00:00.000Z") }),
    ]);
    expect(await firstKickoffFor(db, 2024)).toBeNull();
    await expect(requireFirstKickoffFor(db, 2024)).rejects.toThrow(/projections:context/);
  });

  /**
   * I5, the load-bearing case: a MISSING betting line must never hide the game that actually kicked
   * off first. `pointSpread` is deliberately never recorded here at all — this is the metric a
   * lined-games-only reader (the pre-fix-round `firstKickoffFor`/`playerGameMomentsFor`) would have
   * seen NOTHING for, and would therefore have missed this game's kickoff entirely, potentially
   * reporting the season's SECOND game as though it were the first.
   */
  it("finds the season's first kickoff even when that game carries no betting line at all", async () => {
    const openerKickoff = new Date("2024-09-05T23:20:00.000Z");
    await recordTeamObservations(db, [
      // The season's real opener: a kickoff-instant row and NOTHING under `pointSpread` — exactly
      // what a game past the market's pricing window (2026, week 6+) looks like in the store.
      kickoffFact({ team: "KC", week: 1, asOf: openerKickoff }),
      // A LATER, lined game — the kind a `pointSpread`-keyed minimum would have wrongly reported as
      // the season's first kickoff.
      { ...kickoffFact({ team: "BUF", week: 1, asOf: new Date(openerKickoff.getTime() + 3 * 86_400_000) }) },
      {
        season: 2024,
        week: 1,
        team: "BUF",
        source: SCHEDULE_SOURCE.kickoff,
        metric: SCHEDULE_METRICS.pointSpread,
        value: -3,
        asOf: new Date(openerKickoff.getTime() + 3 * 86_400_000),
      },
    ]);
    expect(await firstKickoffFor(db, 2024)).toEqual(openerKickoff);
    expect(await requireFirstKickoffFor(db, 2024)).toEqual(openerKickoff);
  });

  it("requireFirstKickoffFor names the context command when the store holds nothing for the season", async () => {
    await expect(requireFirstKickoffFor(db, 2024)).rejects.toThrow(/projections:context/);
  });
});
