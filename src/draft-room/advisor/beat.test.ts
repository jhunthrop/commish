import { describe, expect, it } from "vitest";
import { postPickBeat } from "./beat";
import { advisorView, nextPick } from "./test-view";

const name = (id: string) => ({ rb1: "Avery Stone" })[id] ?? id;

describe("postPickBeat", () => {
  it("says Best available when you took the card's pick", () => {
    expect(postPickBeat({ pickedPlayerId: "rb1", prePickView: advisorView({ pick: nextPick({ makeItBack: { survival: 0.2, runs: 200 } }) }), playerName: name })).toBe("Best available.");
  });

  it("names the card's pick with its runs when you passed on him", () => {
    expect(postPickBeat({ pickedPlayerId: "wr1", prePickView: advisorView({ pick: nextPick({ makeItBack: { survival: 0.2, runs: 200 } }) }), playerName: name })).toBe(
      "Our board had Avery Stone first. 40 of 200 runs still had him at your next turn.",
    );
  });

  it("drops the odds sentence when there were none, and is null with no pick", () => {
    expect(postPickBeat({ pickedPlayerId: "wr1", prePickView: advisorView({ pick: nextPick({ makeItBack: null }) }), playerName: name })).toBe("Our board had Avery Stone first.");
    expect(postPickBeat({ pickedPlayerId: "wr1", prePickView: advisorView({ pick: null }), playerName: name })).toBeNull();
  });
});
