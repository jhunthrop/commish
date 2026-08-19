import { describe, expect, it } from "vitest";
import type { StatLine } from "@/domain/player";
import { fakeStatsProvider } from "./test-support";

const LINE: StatLine = {
  playerId: "p1",
  week: 1,
  passingYards: 0,
  passingTouchdowns: 0,
  interceptions: 0,
  rushingYards: 0,
  rushingTouchdowns: 0,
  receivingYards: 0,
  receivingTouchdowns: 0,
  receptions: 0,
  fumblesLost: 0,
  fieldGoalsMade: 0,
  extraPointsMade: 0,
  sacks: 0,
  defensiveInterceptions: 0,
  defensiveTouchdowns: 0,
};

describe("fakeStatsProvider", () => {
  it("listPlayers answers the scripted roster, or an empty list when none was scripted", async () => {
    const scripted = fakeStatsProvider({ players: [{ id: "p1", name: "A Player", position: "WR", nflTeam: "SF" }], games: {} });
    await expect(scripted.listPlayers()).resolves.toEqual([{ id: "p1", name: "A Player", position: "WR", nflTeam: "SF" }]);

    const unscripted = fakeStatsProvider({ games: {} });
    await expect(unscripted.listPlayers()).resolves.toEqual([]);
  });

  it("getGameStatLines answers a scripted game's lines, or an empty list for an unknown game", async () => {
    const game = { gameId: "g1", week: 1, status: "final" as const, homeNflTeam: "SF", awayNflTeam: "SEA" };
    const provider = fakeStatsProvider({ games: { 1: [{ ...game, lines: [LINE] }] } });

    await expect(provider.getGameStatLines(game)).resolves.toEqual([LINE]);
    await expect(provider.getGameStatLines({ ...game, gameId: "unknown-game" })).resolves.toEqual([]);
  });

  it("getWeeklyStatLines flattens every scripted game's lines for that week", async () => {
    const otherLine: StatLine = { ...LINE, playerId: "p2" };
    const provider = fakeStatsProvider({
      games: {
        1: [
          { gameId: "g1", week: 1, status: "final", homeNflTeam: "SF", awayNflTeam: "SEA", lines: [LINE] },
          { gameId: "g2", week: 1, status: "final", homeNflTeam: "DAL", awayNflTeam: "NYG", lines: [otherLine] },
        ],
      },
    });

    await expect(provider.getWeeklyStatLines(1)).resolves.toEqual([LINE, otherLine]);
    await expect(provider.getWeeklyStatLines(2)).resolves.toEqual([]);
  });
});
