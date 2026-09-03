import { describe, it, expect } from "vitest";
import type { Position } from "@/domain/player";
import type { CompletedPick } from "@/draft-engine";
import type { Verdict } from "../lib/verdict";
import {
  bestAvailableFraction,
  byeStackWeek,
  debriefCounts,
  earlyRoundsBestAvailable,
  firstRoundByPosition,
  formatPickSlot,
  mockHabits,
  notableReviews,
  positionShape,
  roomAverageFirstRound,
  type JudgedReview,
} from "./debrief";
import type { PickReview } from "./pick-review";

function review(overrides: Partial<PickReview> & Pick<PickReview, "pickNumber">): PickReview {
  return { playerId: `p${overrides.pickNumber}`, bestAvailableDelta: 0, positionRank: 1, positionBestDelta: 0, ...overrides };
}

function pick(pickNumber: number, teamId: string, playerId: string, round: number): CompletedPick {
  return { pickNumber, round, teamId, playerId, slot: "BENCH", slotIndex: 0, price: null, timestamp: "2026-09-01T00:00:00.000Z", auto: false };
}

function verdict(slip: number): Verdict {
  return { kind: slip > 6 ? "steal" : slip < -6 ? "reach" : "even", slip, value: String(slip), comparison: undefined };
}

function judged(pickNumber: number, slip: number, bestAvailableDelta: number): JudgedReview {
  return { review: review({ pickNumber, bestAvailableDelta }), verdict: verdict(slip) };
}

describe("debriefCounts", () => {
  it("counts best-available strictly at zero overall delta and reaches at the stated threshold", () => {
    const reviews = [
      review({ pickNumber: 1, bestAvailableDelta: 0 }),
      // Position-best but not overall-best: NOT counted best available — the sentence claims overall.
      review({ pickNumber: 2, bestAvailableDelta: 3, positionBestDelta: 0 }),
      review({ pickNumber: 3, bestAvailableDelta: 5 }),
      review({ pickNumber: 4, bestAvailableDelta: 9 }),
    ];
    expect(debriefCounts(reviews)).toEqual({ total: 4, bestAvailable: 1, reaches: 2 });
  });

  it("renders the fraction the history rows carry", () => {
    expect(bestAvailableFraction({ total: 15, bestAvailable: 9, reaches: 3 })).toBe("9 of 15");
  });
});

describe("formatPickSlot", () => {
  it("prints round.slot with a padded slot, the way a board reads", () => {
    expect(formatPickSlot(1, 12)).toBe("1.01");
    expect(formatPickSlot(12, 12)).toBe("1.12");
    expect(formatPickSlot(13, 12)).toBe("2.01");
    expect(formatPickSlot(20, 12)).toBe("2.08");
  });

  it("degrades to the bare pick number for a nonsense team count rather than dividing by zero", () => {
    expect(formatPickSlot(7, 0)).toBe("7");
  });
});

const POSITIONS = new Map<string, Position>([
  ["rb1", "RB"],
  ["rb2", "RB"],
  ["wr1", "WR"],
  ["te1", "TE"],
  ["te2", "TE"],
  ["qb1", "QB"],
]);

describe("firstRoundByPosition", () => {
  it("names the first round each position was taken, ignoring other seats and later repeats", () => {
    const picks = [
      pick(1, "me", "rb1", 1),
      pick(2, "opp", "te2", 1),
      pick(3, "me", "rb2", 2),
      pick(4, "me", "te1", 3),
    ];
    const first = firstRoundByPosition(picks, POSITIONS, "me");
    expect(first.get("RB")).toBe(1);
    expect(first.get("TE")).toBe(3);
    expect(first.has("WR")).toBe(false);
  });
});

describe("roomAverageFirstRound", () => {
  it("averages the OTHER seats and rounds to a whole round", () => {
    const picks = [
      pick(1, "me", "te1", 6),
      pick(2, "a", "te2", 3),
      pick(3, "b", "qb1", 5),
      pick(4, "b", "rb1", 5),
    ];
    // Seat b never drafted a TE — the clause drops rather than averaging a partial room.
    expect(roomAverageFirstRound(picks, POSITIONS, ["me", "a", "b"], "TE", "me")).toBeNull();
  });

  it("returns the average when every other seat took the position", () => {
    const picks = [pick(1, "a", "te1", 3), pick(2, "b", "te2", 6)];
    expect(roomAverageFirstRound(picks, POSITIONS, ["me", "a", "b"], "TE", "me")).toBe(5);
  });

  it("is null for a room of one — there is no room to compare to", () => {
    expect(roomAverageFirstRound([], POSITIONS, ["me"], "TE", "me")).toBeNull();
  });
});

describe("positionShape", () => {
  it("counts early rounds only and names the leader, ties going to the earlier lean", () => {
    const picks = [
      pick(1, "me", "rb1", 1),
      pick(2, "me", "wr1", 2),
      pick(3, "me", "rb2", 3),
      // Past shapeRounds (6): never counted.
      pick(4, "me", "te1", 7),
    ];
    const shape = positionShape(picks, POSITIONS, "me");
    expect(shape.counts.get("RB")).toBe(2);
    expect(shape.counts.get("WR")).toBe(1);
    expect(shape.counts.has("TE")).toBe(false);
    expect(shape.leader).toEqual({ position: "RB", count: 2 });
  });

  it("has no leader when the team made no early picks", () => {
    expect(positionShape([], POSITIONS, "me").leader).toBeNull();
  });
});

describe("byeStackWeek", () => {
  const byes = new Map([
    ["KC", 8],
    ["SF", 8],
    ["DAL", 8],
    ["GB", 5],
  ]);

  it("names the most-shared bye week once three or more sit together", () => {
    expect(byeStackWeek(["KC", "SF", "DAL", "GB"], byes)).toEqual({ week: 8, count: 3 });
  });

  it("stays silent under the threshold — two sharing a bye is every roster ever", () => {
    expect(byeStackWeek(["KC", "SF", "GB"], byes)).toBeNull();
  });

  it("ignores teams the schedule read has no bye for", () => {
    expect(byeStackWeek(["KC", "SF", "???"], byes)).toBeNull();
  });
});

describe("notableReviews", () => {
  it("names the biggest positive slip and the deepest reach past the threshold", () => {
    const entries = [judged(1, 11, 0), judged(2, 4, 2), judged(3, -9, 8), judged(4, -3, 5)];
    const notable = notableReviews(entries);
    expect(notable.best?.review.pickNumber).toBe(1);
    expect(notable.worstReach?.review.pickNumber).toBe(3);
  });

  it("stays honestly silent when nothing qualifies — no least-bad best, no under-threshold reach", () => {
    const notable = notableReviews([judged(1, -2, 2), judged(2, 0, 1)]);
    expect(notable.best).toBeNull();
    expect(notable.worstReach).toBeNull();
  });
});

describe("mockHabits", () => {
  it("is null under two completed mocks — one data point is an anecdote", () => {
    expect(mockHabits([{ firstTeRound: 6, earlyBestAvailable: true }])).toBeNull();
  });

  it("states the TE pattern only when every mock drafted one", () => {
    const habits = mockHabits([
      { firstTeRound: 6, earlyBestAvailable: true },
      { firstTeRound: 7, earlyBestAvailable: false },
      { firstTeRound: 5, earlyBestAvailable: true },
    ]);
    expect(habits).toEqual({ mockCount: 3, firstTeRounds: [6, 7, 5], earlyBestAvailableCount: 2 });
  });

  it("drops the TE clause, not the card, when one mock never drafted a tight end", () => {
    const habits = mockHabits([
      { firstTeRound: 6, earlyBestAvailable: true },
      { firstTeRound: null, earlyBestAvailable: true },
    ]);
    expect(habits?.firstTeRounds).toBeNull();
    expect(habits?.earlyBestAvailableCount).toBe(2);
  });
});

describe("earlyRoundsBestAvailable", () => {
  it("is true only when every first-two-round pick took the board's best", () => {
    const reviews = [review({ pickNumber: 8, bestAvailableDelta: 0 }), review({ pickNumber: 17, bestAvailableDelta: 0 }), review({ pickNumber: 30, bestAvailableDelta: 9 })];
    expect(earlyRoundsBestAvailable(reviews, 12)).toBe(true);
    expect(earlyRoundsBestAvailable([review({ pickNumber: 8, bestAvailableDelta: 1 })], 12)).toBe(false);
  });

  it("reads false, never vacuously true, for a team with no early picks", () => {
    expect(earlyRoundsBestAvailable([], 12)).toBe(false);
  });
});
