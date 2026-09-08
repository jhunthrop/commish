import { describe, expect, it } from "vitest";
import type { SeatAhead } from "@/draft-service/assistant/view";
import { changedSinceLine, collapseText, isReachAt, oddsLineText, percentText, runsText, seatAheadText } from "./format";

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

  it("caps the names, departures first, and counts the rest, always in one sentence", () => {
    const line = changedSinceLine(
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
    expect(line).toBe("C and E came off the plan, B at 2.07 fell from 90% to 20%, and 2 more changes.");
    const departuresOnly = changedSinceLine(
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ kind: "left_plan" as const, playerId: `p${n}`, turn: 1 })),
      (id) => `RB ${id.slice(1)}`,
      10,
      () => 17,
    );
    expect(departuresOnly).toBe("RB 1, RB 2 and RB 3 came off the plan, and 6 more changes.");
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

  it("words the changed-since line as one sentence, with no banned punctuation", () => {
    const line = changedSinceLine(
      [
        { kind: "odds_moved", playerId: "rb4", turn: 1, from: 0.5, to: 0.2 },
        { kind: "left_plan", playerId: "rb5", turn: 1 },
      ],
      (id) => ({ rb4: "Avery Stone", rb5: "Blake Rivers" })[id] ?? id,
      10,
      () => 17,
    );
    expect(line).toBe("Blake Rivers came off the plan, and Avery Stone at 2.07 fell from 50% to 20%.");
    expect(line).not.toMatch(BANNED);
    expect(changedSinceLine([], (id) => id, 10, () => 17)).toBeNull();
    expect(changedSinceLine([{ kind: "odds_moved", playerId: "a", turn: 1, from: 0.2, to: 0.6 }], (id) => id.toUpperCase(), 10, () => 17)).toBe("A at 2.07 rose from 20% to 60%.");
  });

  it("words the odds line with a verb at zero, in between, and at every run", () => {
    expect(oddsLineText({ survival: 0, runs: 100 }, 17, 10)).toBe("Gone before 2.07 in every run.");
    expect(oddsLineText({ survival: 0.44, runs: 100 }, 17, 10)).toBe("Still there at 2.07 in 44 of 100 runs.");
    expect(oddsLineText({ survival: 1, runs: 100 }, 17, 10)).toBe("Still there at 2.07 in every run.");
  });
});
