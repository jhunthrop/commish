import { describe, expect, it } from "vitest";
import type { StatLine } from "@research/domain/player";
import type { BoardCandidate, BoardReason } from "../preseason/board";
import { admitAvailability, clampAbs, impliedGamesFor } from "./availability-admission";

const IMPLIED_GAMES = 12;
const CONSTANTS = { availabilityCapPoints: 20, impliedGamesByPosition: { QB: IMPLIED_GAMES, RB: IMPLIED_GAMES, WR: IMPLIED_GAMES, TE: IMPLIED_GAMES } } as const;

function line(): StatLine {
  return {
    playerId: "player-1",
    week: 1,
    passingYards: 0,
    passingTouchdowns: 0,
    interceptions: 0,
    rushingYards: 0,
    rushingTouchdowns: 0,
    receivingYards: 20,
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

function candidate(expectedGames: number, reasons: readonly BoardReason[] = []): BoardCandidate {
  return {
    playerId: "player-1",
    position: "RB",
    team: "GB",
    perGame: line(),
    games: { expected: expectedGames, rate: expectedGames / 17, distribution: { floor: 0, median: expectedGames, ceiling: 17 }, probabilities: [] },
    reasons,
  };
}

describe("admitAvailability", () => {
  it("prices the gap between expected and implied games off the anchor's own per-game rate, and caps it", () => {
    // Three games against twelve implied at a 120-point anchor: (3 - 12) * 120 / 12 = -90, capped at -20.
    expect(admitAvailability(candidate(3), 120, CONSTANTS)).toBe(-20);
  });

  it("leaves a small gap uncapped either way, positive or negative", () => {
    expect(admitAvailability(candidate(13), 120, CONSTANTS)).toBeCloseTo(10, 10);
    expect(admitAvailability(candidate(11), 120, CONSTANTS)).toBeCloseTo(-10, 10);
  });

  it("MEASURED PIN (2026-09-08 round): the cap stands for a player carrying an observed reserve designation; lifting it was worse on held-out 2023-2024", () => {
    const reserve: BoardReason = { code: "roster_status", status: "injured_reserve", source: "tank01_player_list", observedAt: "2026-09-05T22:35:00.000Z", team: "GB" };
    expect(admitAvailability(candidate(3, [reserve]), 162.9, CONSTANTS)).toBe(-20);
  });

  it("throws for a position the implied-games table carries no entry for", () => {
    expect(() => admitAvailability({ ...candidate(10), position: "K" }, 120, CONSTANTS)).toThrow(/no implied-games entry/);
    expect(() => impliedGamesFor("DEF", CONSTANTS.impliedGamesByPosition)).toThrow(/no implied-games entry/);
  });
});

describe("clampAbs", () => {
  it("bounds a value symmetrically", () => {
    expect(clampAbs(30, 20)).toBe(20);
    expect(clampAbs(-30, 20)).toBe(-20);
    expect(clampAbs(5, 20)).toBe(5);
  });
});
