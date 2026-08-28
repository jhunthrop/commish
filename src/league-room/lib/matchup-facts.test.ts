import { describe, expect, it } from "vitest";
import type { MatchupLineupEntry, MatchupSide } from "../contract";
import { benchPoints, marginSentence, summaryOf, topStarter, yetToPlayCount } from "./matchup-facts";

/**
 * The facts that answer "can I still win?" and "what did I leave on the bench?", both of which
 * Gameday's spec names as the difference between a scoreboard and a sports app. Every one of them
 * is arithmetic over the matchup wire, which is why they are testable without a database, a
 * socket or a rendered component.
 */

const entry = (overrides: Partial<MatchupLineupEntry>): MatchupLineupEntry => ({
  slot: "QB",
  slotIndex: 0,
  playerId: "p1",
  playerName: "A Passer",
  position: "QB",
  nflTeam: "BUF",
  headshotUrl: null,
  adp: null,
  points: 10,
  ...overrides,
});

const side = (overrides: Partial<MatchupSide> = {}): MatchupSide => ({
  teamId: "t1",
  teamName: "Bay Bandits",
  score: 10,
  starters: [],
  bench: [],
  ...overrides,
});

describe("yetToPlayCount", () => {
  it("counts starters who hold a player and have no stat line yet", () => {
    const s = side({
      starters: [entry({ points: null }), entry({ slotIndex: 1, points: null }), entry({ slotIndex: 2, points: 14 })],
    });
    expect(yetToPlayCount(s)).toBe(2);
  });

  // An unfilled FLEX is not a reason for hope. `points === null` alone would count it, which is
  // how a manager with a hole in their lineup gets told they have somebody left to play.
  it("does not count an empty slot as a player still to come", () => {
    const s = side({ starters: [entry({ playerId: null, playerName: null, position: null, points: null })] });
    expect(yetToPlayCount(s)).toBe(0);
  });

  it("counts only starters, never the bench", () => {
    const s = side({ starters: [entry({ points: 12 })], bench: [entry({ slot: "BENCH", points: null })] });
    expect(yetToPlayCount(s)).toBe(0);
  });
});

describe("benchPoints", () => {
  it("sums every bench player who actually scored", () => {
    const s = side({ bench: [entry({ slot: "BENCH", points: 12.5 }), entry({ slot: "BENCH", slotIndex: 1, points: 6 })] });
    expect(benchPoints(s)).toBe(18.5);
  });

  // The same ruling `NOT_STARTED_DASH` makes for a player: before any bench game has kicked off,
  // "0.00 on your bench" is a claim about a Sunday that has not happened.
  it("answers null, never zero, when nobody on the bench has played", () => {
    const s = side({ bench: [entry({ slot: "BENCH", points: null })] });
    expect(benchPoints(s)).toBeNull();
  });

  // Zero IS a real answer once games are in — a manager who benched correctly has earned it.
  it("answers zero for a bench that played and produced nothing", () => {
    const s = side({ bench: [entry({ slot: "BENCH", points: 0 })] });
    expect(benchPoints(s)).toBe(0);
  });
});

describe("topStarter", () => {
  it("picks the highest real score in the lineup", () => {
    const s = side({ starters: [entry({ points: 8 }), entry({ slotIndex: 1, points: 21.5 }), entry({ slotIndex: 2, points: null })] });
    expect(topStarter(s)?.points).toBe(21.5);
  });

  it("answers null before anybody has scored", () => {
    expect(topStarter(side({ starters: [entry({ points: null })] }))).toBeNull();
  });
});

describe("marginSentence", () => {
  const matchup = summaryOf({
    weekNumber: 5,
    final: true,
    weekStatus: "final",
    home: side({ teamId: "t1", teamName: "Bay Bandits", score: 112.5 }),
    away: side({ teamId: "t2", teamName: "Iron Owls", score: 98.25 }),
  });

  it("speaks in the second person to a manager reading their own game", () => {
    expect(marginSentence(matchup, "t1")).toBe("You are up 14.25.");
    expect(marginSentence(matchup, "t2")).toBe("You are down 14.25.");
  });

  it("writes about somebody else's game in the third person", () => {
    expect(marginSentence(matchup, null)).toBe("Bay Bandits leads by 14.25.");
  });

  it("says nothing at all when either side has no score, rather than guessing against a dash", () => {
    const pending = { ...matchup, awayScore: null };
    expect(marginSentence(pending, "t1")).toBeNull();
  });

  it("names a tie as a tie rather than a zero margin", () => {
    const tied = { ...matchup, awayScore: 112.5 };
    expect(marginSentence(tied, "t1")).toBe("You are tied at 112.50.");
    expect(marginSentence(tied, null)).toBe("Tied at 112.50 apiece.");
  });
});
