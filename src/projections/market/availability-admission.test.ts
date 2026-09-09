import { describe, expect, it } from "vitest";
import type { StatLine } from "@/domain/player";
import type { BoardCandidate, BoardReason } from "../preseason/board";
import type { RosterStatusKind } from "../preseason/roster-status";
import { admitAvailability, hasObservedReserveDesignation, impliedGamesFor, totalAdmittedDelta } from "./availability-admission";

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

function rosterStatus(status: RosterStatusKind): BoardReason {
  return { code: "roster_status", status, source: "tank01_player_list", observedAt: "2026-09-05T22:35:00.000Z", team: "GB" };
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

describe("hasObservedReserveDesignation", () => {
  it.each<RosterStatusKind>(["injured_reserve", "pup", "nfi", "suspended", "exempt"])("is true for a %s reason: a stated minimum absence somebody observed", (status) => {
    expect(hasObservedReserveDesignation(candidate(13, [rosterStatus(status)]))).toBe(true);
  });

  it("is false with no roster_status reason at all, and for a status that is not a reserve list", () => {
    expect(hasObservedReserveDesignation(candidate(13))).toBe(false);
    expect(hasObservedReserveDesignation(candidate(13, [rosterStatus("active")]))).toBe(false);
    expect(hasObservedReserveDesignation(candidate(13, [rosterStatus("practice_squad")]))).toBe(false);
  });
});

describe("admitAvailability", () => {
  it("prices the gap between expected and implied games off the anchor's own per-game rate, and caps it, for a player with no designation", () => {
    // Three games against twelve implied at a 120-point anchor: (3 - 12) * 120 / 12 = -90, capped at -20.
    expect(admitAvailability(candidate(3), 120, CONSTANTS)).toEqual({ delta: -20, bounded: true });
  });

  it("leaves a small gap uncapped either way, positive or negative", () => {
    expect(admitAvailability(candidate(13), 120, CONSTANTS)).toEqual({ delta: 10, bounded: true });
    expect(admitAvailability(candidate(11), 120, CONSTANTS)).toEqual({ delta: -10, bounded: true });
  });

  it("admits the FULL gap for a player carrying an observed reserve designation: anchor scaled to his games", () => {
    // Jacobs-shaped: 162.9 anchor, 3.0 games, 12.414 implied -> the term is -123.5 and the blended
    // price is 162.9 * 3 / 12.414 = 39.4, three games' worth of his own market price.
    const jacobs = { availabilityCapPoints: 20, impliedGamesByPosition: { ...CONSTANTS.impliedGamesByPosition, RB: 12.414048059149723 } };
    const admitted = admitAvailability(candidate(3, [rosterStatus("injured_reserve")]), 162.9, jacobs);
    expect(admitted.bounded).toBe(false);
    expect(admitted.delta).toBeCloseTo(-123.53, 1);
    expect(162.9 + admitted.delta).toBeCloseTo((162.9 * 3) / 12.414048059149723, 6);
  });

  it("keeps the cap for a roster_status reason that is not a reserve list", () => {
    expect(admitAvailability(candidate(3, [rosterStatus("active")]), 120, CONSTANTS)).toEqual({ delta: -20, bounded: true });
  });

  it("throws for a position the implied-games table carries no entry for", () => {
    expect(() => admitAvailability({ ...candidate(10), position: "K" }, 120, CONSTANTS)).toThrow(/no implied-games entry/);
    expect(() => impliedGamesFor("DEF", CONSTANTS.impliedGamesByPosition)).toThrow(/no implied-games entry/);
  });
});

describe("totalAdmittedDelta", () => {
  it("bounds laws PLUS a bounded availability term at the total cap, exactly as the blend always has", () => {
    expect(totalAdmittedDelta(30, { delta: -20, bounded: true }, 40)).toBe(10);
    expect(totalAdmittedDelta(30, { delta: 30, bounded: true }, 40)).toBe(40);
  });

  it("bounds the law channel alone and adds an UNBOUNDED availability term in full", () => {
    expect(totalAdmittedDelta(60, { delta: -123.5, bounded: false }, 40)).toBeCloseTo(40 - 123.5, 10);
    expect(totalAdmittedDelta(0, { delta: -123.5, bounded: false }, 40)).toBeCloseTo(-123.5, 10);
  });
});
