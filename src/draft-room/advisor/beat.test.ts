import { describe, expect, it } from "vitest";
import type { AdvisorView, NowCandidate } from "@/draft-service/assistant/view";
import { postPickBeat } from "./beat";

function candidate(playerId: string, makeItBack: NowCandidate["makeItBack"]): NowCandidate {
  return { playerId, position: "RB", valueOverReplacement: 40, positionRank: 1, makeItBack, fillsSlot: "RB", reasons: [], templateReason: "x" };
}

function view(now: readonly NowCandidate[]): AdvisorView {
  return {
    pickNumber: 4,
    onTheClock: true,
    picksUntilYourTurn: 0,
    teamCount: 10,
    stamp: { computedAtPick: 4, sequence: 4 },
    now,
    plan: { computedAtPick: 4, runs: 200, horizon: 3, reachFloor: 0.25, turns: [] },
    signals: { run: null, collapses: [], ahead: [] },
    yourBuild: [],
    winningBuilds: null,
    computedBasis: "gen1",
    names: { rb1: "Avery Stone" },
    strategyTemplate: "",
    voice: { status: "absent", strategy: null, reasons: {} },
    ledger: { numbers: [], names: [] },
  };
}

const name = (id: string) => ({ rb1: "Avery Stone" })[id] ?? id;

describe("postPickBeat", () => {
  it("says Best available when you took the top candidate", () => {
    expect(postPickBeat({ pickedPlayerId: "rb1", prePickView: view([candidate("rb1", { survival: 0.2, runs: 200 })]), playerName: name })).toBe("Best available.");
  });

  it("names the board's first choice with its runs when you passed on him", () => {
    expect(postPickBeat({ pickedPlayerId: "wr1", prePickView: view([candidate("rb1", { survival: 0.2, runs: 200 })]), playerName: name })).toBe(
      "Our board had Avery Stone first. 40 of 200 runs still had him at your next turn.",
    );
  });

  it("drops the odds sentence when there were none, and is null with no candidates", () => {
    expect(postPickBeat({ pickedPlayerId: "wr1", prePickView: view([candidate("rb1", null)]), playerName: name })).toBe("Our board had Avery Stone first.");
    expect(postPickBeat({ pickedPlayerId: "wr1", prePickView: view([]), playerName: name })).toBeNull();
  });
});
