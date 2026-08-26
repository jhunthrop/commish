import { describe, expect, it } from "vitest";
import type { Player, StatLine } from "@/domain/player";
import { deriveMockGames } from "./games";

function player(id: string, nflTeam: string): Player {
  return { id, name: id, position: "WR", nflTeam, headshotUrl: null };
}

function line(playerId: string, week: number): StatLine {
  return {
    playerId,
    week,
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
}

describe("deriveMockGames", () => {
  it("pairs the teams that produced stat lines that week, sorted, into games", () => {
    const players = [player("p1", "SEA"), player("p2", "SF"), player("p3", "WAS"), player("p4", "CAR")];
    const lines = [line("p1", 1), line("p2", 1), line("p3", 1), line("p4", 1)];
    const games = deriveMockGames(1, players, lines, "final");
    expect(games).toEqual([
      { gameId: "mock-1-CAR-SEA", week: 1, status: "final", homeNflTeam: "CAR", awayNflTeam: "SEA" },
      { gameId: "mock-1-SF-WAS", week: 1, status: "final", homeNflTeam: "SF", awayNflTeam: "WAS" },
    ]);
  });

  it("drops an odd-one-out team rather than emitting a one-team fixture", () => {
    const players = [player("p1", "SEA"), player("p2", "SF"), player("p3", "WAS")];
    const lines = [line("p1", 1), line("p2", 1), line("p3", 1)];
    const games = deriveMockGames(1, players, lines, "final");
    expect(games).toEqual([{ gameId: "mock-1-SEA-SF", week: 1, status: "final", homeNflTeam: "SEA", awayNflTeam: "SF" }]);
    const pairedTeams = new Set(games.flatMap((game) => [game.homeNflTeam, game.awayNflTeam]));
    expect(pairedTeams.has("WAS")).toBe(false);
  });

  it("ignores a stat line whose player is not in the roster", () => {
    const players = [player("p1", "SEA"), player("p2", "SF")];
    const lines = [line("p1", 1), line("p2", 1), line("ghost", 1)];
    const games = deriveMockGames(1, players, lines, "final");
    expect(games).toEqual([{ gameId: "mock-1-SEA-SF", week: 1, status: "final", homeNflTeam: "SEA", awayNflTeam: "SF" }]);
  });

  it("returns no games for a week with no stat lines", () => {
    expect(deriveMockGames(99, [player("p1", "SEA")], [], "final")).toEqual([]);
  });

  it("carries the status it was given onto every game", () => {
    const players = [player("p1", "SEA"), player("p2", "SF")];
    const lines = [line("p1", 1), line("p2", 1)];
    const games = deriveMockGames(1, players, lines, "in_progress");
    expect(games.every((game) => game.status === "in_progress")).toBe(true);
  });
});
