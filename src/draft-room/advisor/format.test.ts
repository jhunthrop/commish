import { describe, expect, it } from "vitest";
import type { SeatAhead } from "@/draft-service/assistant/view";
import { changedSinceLines, collapseText, isReachAt, percentText, runsText, seatAheadText } from "./format";

const BANNED = /[—;]/;

describe("advisor format", () => {
  it("states odds as runs over runs and a percent for the meter", () => {
    expect(runsText({ survival: 0.46, runs: 200 })).toBe("92 of 200 runs");
    expect(percentText(0.46)).toBe("46%");
  });

  it("calls a column a reach from the turn the odds fall under the floor", () => {
    const target = { playerId: "rb4", position: "RB" as const, valueOverReplacement: 1, positionRank: 4, oddsByTurn: [], reachFromTurn: 2 };
    expect(isReachAt(target, 1)).toBe(false);
    expect(isReachAt(target, 2)).toBe(true);
    expect(isReachAt(target, 3)).toBe(true);
    expect(isReachAt({ ...target, reachFromTurn: null }, 3)).toBe(false);
  });

  it("caps the changed-since lines, departures first, and counts the rest", () => {
    const lines = changedSinceLines(
      [
        { kind: "odds_moved", playerId: "a", turn: 1, from: 0.5, to: 0.4 },
        { kind: "odds_moved", playerId: "b", turn: 1, from: 0.9, to: 0.2 },
        { kind: "left_plan", playerId: "c", turn: 1 },
        { kind: "odds_moved", playerId: "d", turn: 1, from: 0.3, to: 0.6 },
        { kind: "left_plan", playerId: "e", turn: 1 },
      ],
      (id) => id.toUpperCase(),
      10,
      () => 17,
    );
    expect(lines).toEqual(["C is off the plan.", "E is off the plan.", "B at 2.07 moved down, 90% to 20%.", "2 more changes on the plan."]);
  });

  it("words a tier collapse from the board's own numbers", () => {
    expect(collapseText({ position: "WR", tierLabel: "A", playersLeftInTier: 1, dropToNextTier: 22.6 })).toBe("One WR left in tier A, then a 22.6 point drop.");
    expect(collapseText({ position: "RB", tierLabel: "B", playersLeftInTier: 3, dropToNextTier: 9.04 })).toBe("3 RB left in tier B, then a 9.0 point drop.");
  });

  it("says where a seat's read comes from, and when it is only the prior", () => {
    const base: SeatAhead = { teamId: "t5", seat: 5, pickNumber: 13, runs: 200, topPosition: { position: "RB", share: 0.54 }, topPlayer: { playerId: "rb6", share: 0.3 }, driver: { kind: "archetype", name: "rb_heavy", basis: "inferred", picksObserved: 3 } };
    const name = (id: string) => (id === "rb6" ? "Avery Stone" : id);
    expect(seatAheadText(base, name)).toEqual({ read: "Took a RB in 108 of 200 runs, most often Avery Stone.", basis: "Read from their own 3 picks so far." });
    expect(seatAheadText({ ...base, driver: { kind: "archetype", name: "best_available", basis: "prior", picksObserved: 1 } }, name).basis).toBe("The neutral prior: only 1 pick so far.");
    expect(seatAheadText({ ...base, driver: { kind: "archetype", name: "best_available", basis: "prior", picksObserved: 0 } }, name).basis).toBe("The neutral prior: no picks yet.");
    expect(seatAheadText({ ...base, driver: { kind: "autopick", picksObserved: 2 } }, name).basis).toBe("On autopick, so the clock's own policy.");
    expect(seatAheadText({ ...base, topPosition: null, topPlayer: null }, name).read).toBe("No read yet.");
  });

  it("words the changed-since lines, with no banned punctuation", () => {
    const lines = changedSinceLines(
      [
        { kind: "odds_moved", playerId: "rb4", turn: 1, from: 0.5, to: 0.2 },
        { kind: "left_plan", playerId: "rb5", turn: 1 },
      ],
      (id) => ({ rb4: "Avery Stone", rb5: "Blake Rivers" })[id] ?? id,
      10,
      () => 17,
    );
    expect(lines).toEqual(["Blake Rivers is off the plan.", "Avery Stone at 2.07 moved down, 50% to 20%."]);
    for (const line of lines) expect(line).not.toMatch(BANNED);
  });
});
