import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { nflPlayers, playerCrosswalk, players } from "@research-ts/db/schema";
import { createTestDb, recordStatements, truncateAll } from "@research-ts/db/test-db";
import type { Player } from "@research-ts/domain/player";
import { reasonsByLeaguePlayerId } from "./reasons-by-player";

const db = createTestDb();

const SOURCE = "test_board_v1";
const SEASON = 2026;
const LEAGUE_PLAYERS: readonly Player[] = [
  { id: "4362628", name: "Placed Player", position: "WR", nflTeam: "KC", adp: null, headshotUrl: null },
  { id: "9999999", name: "Unplaced Player", position: "RB", nflTeam: "SF", adp: null, headshotUrl: null },
];

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(nflPlayers).values({ id: "00-0033280", name: "Placed Player", position: "WR" });
  await db.insert(players).values(LEAGUE_PLAYERS.map((player) => ({ id: player.id, name: player.name, position: player.position, nflTeam: player.nflTeam })));
  await db.insert(playerCrosswalk).values({ playerId: "4362628", nflPlayerId: "00-0033280", method: "espn_id", resolvedAt: new Date("2026-09-01T00:00:00.000Z") });
});

afterAll(async () => {
  await truncateAll(db);
});

describe("reasonsByLeaguePlayerId (finding 6: the board's reasons and the crosswalk, memoized per instance)", () => {
  it("reads the crosswalk and the board once, then serves the same map from memory with no statement", async () => {
    const first = await reasonsByLeaguePlayerId(db, LEAGUE_PLAYERS, SOURCE, SEASON);
    expect(first).toEqual({});
    const statements = await recordStatements(db, async (logged) => {
      expect(await reasonsByLeaguePlayerId(logged, LEAGUE_PLAYERS, SOURCE, SEASON)).toBe(first);
    });
    expect(statements).toEqual([]);
  });

  it("keys by board source and season, not by the league", async () => {
    await reasonsByLeaguePlayerId(db, LEAGUE_PLAYERS, SOURCE, SEASON);
    const statements = await recordStatements(db, (logged) => reasonsByLeaguePlayerId(logged, LEAGUE_PLAYERS, SOURCE, SEASON + 1));
    expect(statements.length).toBeGreaterThan(0);
  });
});
