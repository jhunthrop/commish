import { describe, expect, it } from "vitest";
import type { Position } from "@research-ts/domain/player";
import { STANDARD_ROSTER_SLOTS, type RosterSlotConfig } from "@research-ts/domain/roster";
import { SUPERFLEX_ROSTER_SLOTS } from "@research-ts/domain/roster-shape";
import {
  replacementLevel,
  startingDemand,
  valueBoard,
  valueOverReplacement,
  type LeagueShape,
  type SeasonProjection,
} from "./replacement";

/** A pool of `count` players at one position, descending from `top` in even steps of `step`. */
function pool(position: Position, count: number, top: number, step: number): readonly SeasonProjection[] {
  return Array.from({ length: count }, (_, index) => ({
    playerId: `${position}${index + 1}`,
    position,
    projectedPoints: top - index * step,
  }));
}

const TWELVE_TEAM: LeagueShape = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS };
const TWELVE_TEAM_SUPERFLEX: LeagueShape = { teamCount: 12, rosterSlots: SUPERFLEX_ROSTER_SLOTS };

/**
 * A pool shaped like a real season: quarterbacks score the most points and are the flattest
 * position, backs score fewer and fall away fast. That shape is the entire reason a draft board
 * is not a points ranking.
 */
const REALISTIC: readonly SeasonProjection[] = [
  ...pool("QB", 40, 330, 4),
  ...pool("RB", 60, 300, 5),
  ...pool("WR", 80, 290, 3),
  ...pool("TE", 30, 220, 6),
];

describe("startingDemand", () => {
  it("derives dedicated demand from the league's own slot rows and team count", () => {
    const demand = startingDemand(REALISTIC, TWELVE_TEAM);
    // 12 teams x 1 QB slot. Nothing here is a constant: it is the config, multiplied out.
    expect(demand.get("QB")).toBe(12);
    expect(demand.get("TE")).toBe(12);
  });

  it("changes when the league changes, which is the whole claim", () => {
    const tenTeam: LeagueShape = { teamCount: 10, rosterSlots: STANDARD_ROSTER_SLOTS };
    expect(startingDemand(REALISTIC, tenTeam).get("QB")).toBe(10);

    const threeBacks: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.map((slot) =>
      slot.slot === "RB" ? { ...slot, count: 3 } : slot,
    );
    const demand = startingDemand(REALISTIC, { teamCount: 12, rosterSlots: threeBacks });
    expect(demand.get("RB")).toBeGreaterThanOrEqual(36);
  });

  it("hands each flex slot to whichever position has the best player still unclaimed", () => {
    const demand = startingDemand(REALISTIC, TWELVE_TEAM);
    const flexed = demand.get("RB")! - 24 + (demand.get("WR")! - 24) + (demand.get("TE")! - 12);
    expect(flexed).toBe(12);
    // In THIS pool the 25th receiver (218) beats the 25th back (180), so every flex spot in the
    // league lands on a receiver. That is a fact about the pool, not a rule.
    expect(demand.get("WR")).toBe(36);
    expect(demand.get("RB")).toBe(24);
  });

  it("moves the flex to backs when the backs are the deeper pool, with no rule changed", () => {
    const deepBacks: readonly SeasonProjection[] = [
      ...pool("QB", 40, 330, 4),
      ...pool("RB", 60, 300, 2),
      ...pool("WR", 80, 290, 6),
      ...pool("TE", 30, 220, 6),
    ];
    const demand = startingDemand(deepBacks, TWELVE_TEAM);
    expect(demand.get("RB")).toBe(36);
    expect(demand.get("WR")).toBe(24);
  });

  it("counts a superflex slot as demand for quarterbacks", () => {
    const standard = startingDemand(REALISTIC, TWELVE_TEAM);
    const superflex = startingDemand(REALISTIC, TWELVE_TEAM_SUPERFLEX);
    expect(standard.get("QB")).toBe(12);
    expect(superflex.get("QB")).toBeGreaterThan(20);
  });
});

describe("replacementLevel", () => {
  it("is the last starter at the position, not the last dedicated starter", () => {
    const levels = replacementLevel(REALISTIC, TWELVE_TEAM);
    const demand = levels.startingDemand.get("RB")!;
    // The 12th back is nowhere near replacement in a league that starts two plus a flex.
    expect(levels.byPosition.get("RB")).toBeLessThan(300 - 11 * 5);
    expect(levels.byPosition.get("RB")).toBe(300 - (demand - 1) * 5);
  });

  it("is zero when the pool cannot fill the league's starting slots", () => {
    const thin: readonly SeasonProjection[] = pool("TE", 4, 200, 10);
    const levels = replacementLevel(thin, TWELVE_TEAM);
    // Eight teams would start nobody at tight end, and nobody scores nothing.
    expect(levels.byPosition.get("TE")).toBe(0);
  });

  it("has no entry for a position the league never starts", () => {
    const noKicker: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== "K");
    const levels = replacementLevel(REALISTIC, { teamCount: 12, rosterSlots: noKicker });
    expect(levels.byPosition.has("K")).toBe(false);
  });
});

describe("valueOverReplacement", () => {
  it("THE LOAD-BEARING CASE: a quarterback who outscores a back still ranks below him", () => {
    const levels = replacementLevel(REALISTIC, TWELVE_TEAM);
    const quarterback = REALISTIC.find((p) => p.playerId === "QB1")!;
    const back = REALISTIC.find((p) => p.playerId === "RB1")!;

    expect(quarterback.projectedPoints).toBeGreaterThan(back.projectedPoints);
    expect(valueOverReplacement(quarterback, levels)).toBeLessThan(valueOverReplacement(back, levels));
  });

  it("throws rather than guessing when the league starts nobody at that position", () => {
    const noKicker: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== "K");
    const levels = replacementLevel(REALISTIC, { teamCount: 12, rosterSlots: noKicker });
    expect(() =>
      valueOverReplacement({ playerId: "K1", position: "K", projectedPoints: 140 }, levels),
    ).toThrow(/K/);
  });
});

describe("valueBoard", () => {
  it("orders by value over replacement, not by points", () => {
    const board = valueBoard(REALISTIC, TWELVE_TEAM);
    const pointsOrder = [...REALISTIC].sort((a, b) => b.projectedPoints - a.projectedPoints);
    expect(pointsOrder[0]!.position).toBe("QB");
    expect(board[0]!.position).not.toBe("QB");
  });

  it("SUPERFLEX: the same players, the same projections, a different board", () => {
    const standard = valueBoard(REALISTIC, TWELVE_TEAM);
    const superflex = valueBoard(REALISTIC, TWELVE_TEAM_SUPERFLEX);
    const rankOf = (board: ReturnType<typeof valueBoard>, playerId: string): number =>
      board.findIndex((entry) => entry.playerId === playerId) + 1;

    // The format where generic rankings fail worst. A second startable quarterback drains the
    // position's supply, which is what makes the top of it scarce.
    expect(rankOf(superflex, "QB1")).toBeLessThan(rankOf(standard, "QB1"));
    expect(superflex.find((e) => e.playerId === "QB1")!.valueOverReplacement).toBeGreaterThan(
      standard.find((e) => e.playerId === "QB1")!.valueOverReplacement,
    );
  });

  it("ranks each player within his own position and carries the level he was measured against", () => {
    const board = valueBoard(REALISTIC, TWELVE_TEAM);
    const back = board.find((entry) => entry.playerId === "RB3")!;
    expect(back.positionRank).toBe(3);
    expect(back.valueOverReplacement).toBeCloseTo(back.projectedPoints - back.replacementLevel, 9);
  });

  it("leaves out players the league cannot start rather than valuing them at zero", () => {
    const noKicker: readonly RosterSlotConfig[] = STANDARD_ROSTER_SLOTS.filter((slot) => slot.slot !== "K");
    const withKicker = [...REALISTIC, { playerId: "K1", position: "K" as Position, projectedPoints: 140 }];
    const board = valueBoard(withKicker, { teamCount: 12, rosterSlots: noKicker });
    expect(board.some((entry) => entry.playerId === "K1")).toBe(false);
  });
});
