import { describe, expect, it } from "vitest";
import { bigOddsText, collapseText, factsLine, headerLine, oddsTooltipText, percentText, runText, runsOverRuns, runsText, stampText } from "./format";
import { advisorView } from "./test-view";

const BANNED = /[—;]/;

describe("advisor format", () => {
  it("states odds as runs over runs, a percent for a row's glance, and the runs in the tooltip", () => {
    expect(runsText({ survival: 0.46, runs: 200 })).toBe("92 of 200 runs");
    expect(bigOddsText({ survival: 0.46, runs: 200 })).toBe("92 of 200");
    expect(runsOverRuns(57, 200)).toBe("57 of 200");
    expect(percentText(0.46)).toBe("46%");
    expect(oddsTooltipText(92, 200)).toBe("still there at your next pick, 92 of 200 runs");
  });

  it("writes the strip's chips in plain words: the run with its window, the collapse with its count and drop", () => {
    expect(runText({ position: "RB", count: 3, window: 4 })).toBe("Backs are going, 3 of the last 4 picks");
    expect(collapseText({ position: "WR", playersLeftInTier: 2, dropToNextTier: 14.25 })).toBe("2 receivers left before a 14.3 point drop");
    expect(collapseText({ position: "TE", playersLeftInTier: 1, dropToNextTier: 20.6 })).toBe("Last tight end before a 20.6 point drop");
    for (const text of [runText({ position: "QB", count: 4, window: 4 }), collapseText({ position: "RB", playersLeftInTier: 3, dropToNextTier: 9 })]) expect(text).not.toMatch(BANNED);
  });

  it("writes the header line in the ruled words, on and off the clock", () => {
    expect(headerLine(advisorView())).toBe("You're on the clock");
    expect(headerLine(advisorView({ onTheClock: false, pickNumber: 17, picksUntilYourTurn: 11 }))).toBe("Your next pick is 2.07, 11 picks away");
    expect(headerLine(advisorView({ onTheClock: false, pickNumber: 17, picksUntilYourTurn: 1 }))).toBe("Your next pick is 2.07, 1 pick away");
  });

  it("writes the facts line and the stamp, with no banned punctuation", () => {
    expect(factsLine("WR", 4, "DET", 6)).toBe("WR 4, DET, bye 6");
    expect(factsLine("WR", 4, "DET", null)).toBe("WR 4, DET");
    const stamp = stampText(advisorView({ stamp: { computedAtPick: 4, sequence: 9 } }));
    expect(stamp).toBe("As of 1.04 · 200 runs");
    for (const text of [stamp, headerLine(advisorView()), factsLine("WR", 4, "DET", 6)]) expect(text).not.toMatch(BANNED);
  });
});
