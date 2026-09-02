import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers } from "@/db/schema";
import { recordPropPlayerMap } from "../odds/player-map";
import { recordPropObservations, type PlayerPropObservation } from "../odds/props-store";
import { loadArchivedPropLines } from "./props-anchor";

/**
 * THE READER, against a real database (fit-round Task 3, deliverable C). `propsAnchorPoints`'s own
 * tests pin the leakage gate and the mapping on fixtures; this file pins the QUERY that feeds it —
 * the season scoping, the `fetched_at` narrowing and the name-map join — because a leak that lives
 * in a `where` clause is invisible to a pure-function test.
 */

const db = createTestDb();

const FIRST_KICKOFF = new Date("2023-09-07T20:20:00.000Z");
const WEEK_ONE_GAME = new Date("2023-09-10T17:00:00.000Z");
const BEFORE_KICKOFF = new Date("2023-09-05T12:00:00.000Z");
const AFTER_KICKOFF = new Date("2023-09-08T12:00:00.000Z");

function observation(overrides: Partial<PlayerPropObservation> = {}): PlayerPropObservation {
  return {
    eventId: "event-1",
    commenceTime: WEEK_ONE_GAME,
    bookmaker: "draftkings",
    market: "player_reception_yds",
    playerName: "Justin Jefferson",
    point: 90.5,
    overPrice: -110,
    underPrice: -110,
    fetchedAt: BEFORE_KICKOFF,
    ...overrides,
  };
}

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(nflPlayers).values([{ id: "p1", name: "Justin Jefferson", position: "WR", rookieSeason: 2020, lastSeason: 2026 }]);
  await recordPropPlayerMap(db, [{ propName: "Justin Jefferson", season: 2023, playerId: "p1", method: "exact" }]);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("loadArchivedPropLines", () => {
  it("resolves an archived line to a player id through the season-scoped name map", async () => {
    await recordPropObservations(db, [observation()]);
    const lines = await loadArchivedPropLines(db, 2023, FIRST_KICKOFF);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.playerId).toBe("p1");
    expect(lines[0]!.point).toBe(90.5);
    expect(lines[0]!.market).toBe("player_reception_yds");
  });

  it("NEVER returns a row stamped at or after kickoff — the gate is in the query as well as the mapping", async () => {
    await recordPropObservations(db, [observation({ fetchedAt: AFTER_KICKOFF }), observation({ fetchedAt: FIRST_KICKOFF })]);
    expect(await loadArchivedPropLines(db, 2023, FIRST_KICKOFF)).toHaveLength(0);
  });

  it("scopes to the season's own kickoffs: a 2024 game never feeds the 2023 anchor", async () => {
    await recordPropObservations(db, [
      observation({ commenceTime: new Date("2024-09-08T17:00:00.000Z"), fetchedAt: new Date("2024-09-01T12:00:00.000Z") }),
    ]);
    expect(await loadArchivedPropLines(db, 2023, FIRST_KICKOFF)).toHaveLength(0);
  });

  it("keeps a JANUARY kickoff with the season it belongs to, not the calendar year it falls in", async () => {
    await recordPropObservations(db, [observation({ commenceTime: new Date("2024-01-07T18:00:00.000Z") })]);
    const lines = await loadArchivedPropLines(db, 2023, FIRST_KICKOFF);
    expect(lines).toHaveLength(1);
  });

  it("drops an unresolved prop name rather than guessing at it", async () => {
    await recordPropObservations(db, [observation({ playerName: "Nobody At All" })]);
    expect(await loadArchivedPropLines(db, 2023, FIRST_KICKOFF)).toHaveLength(0);
  });

  it("drops a name mapped for a DIFFERENT season — the map is season-scoped and so is this read", async () => {
    await db.insert(nflPlayers).values([{ id: "p2", name: "Someone Else", position: "WR", rookieSeason: 2020, lastSeason: 2026 }]);
    await recordPropPlayerMap(db, [{ propName: "Someone Else", season: 2024, playerId: "p2", method: "exact" }]);
    await recordPropObservations(db, [observation({ playerName: "Someone Else" })]);
    expect(await loadArchivedPropLines(db, 2023, FIRST_KICKOFF)).toHaveLength(0);
  });

  it("returns every book's own row — the median across books is the mapping's job, not the query's", async () => {
    await recordPropObservations(db, [observation({ bookmaker: "draftkings" }), observation({ bookmaker: "fanduel", point: 88.5 })]);
    expect(await loadArchivedPropLines(db, 2023, FIRST_KICKOFF)).toHaveLength(2);
  });

  it("returns nothing at all for a season the archive does not cover — the null cell, cleanly", async () => {
    await recordPropObservations(db, [observation()]);
    expect(await loadArchivedPropLines(db, 2021, new Date("2021-09-09T20:20:00.000Z"))).toHaveLength(0);
  });
});
