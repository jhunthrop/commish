import { describe, expect, it } from "vitest";
import type { SeatTendency } from "../sim/room-odds";
import { buildWhy, type WhyFacts } from "./why";

const BANNED = /[—;]/;

function seat(pickNumber: number, position: "RB" | "WR" | "QB"): SeatTendency {
  return { teamId: `t${pickNumber}`, pickNumber, runs: 200, topPosition: { value: position, share: 0.6 }, topPlayer: { value: "x", share: 0.3 } };
}

const BASE: WhyFacts = {
  position: "RB",
  positionRank: 4,
  fillsSlot: "RB",
  reasons: [],
  run: null,
  ahead: [seat(5, "RB"), seat(6, "WR"), seat(7, "RB")],
  runs: 200,
};

describe("buildWhy", () => {
  it("argues the tier he closes in plain words, then the seats ahead with their basis", () => {
    const why = buildWhy({ ...BASE, reasons: [{ code: "tier_cliff", position: "RB", dropToNextTier: 20.55, playersLeftInTier: 1 }] }, 0);
    expect(why.text).toBe("He is the last back before a 20.6 point drop, and he fills your RB slot. 2 of the 3 seats before you lean back in our 200 runs.");
    expect(why.shape).toBe("cliff:0");
  });

  it("names a run at his position ahead of the lean", () => {
    const why = buildWhy({ ...BASE, run: { position: "RB", count: 3, window: 4 }, ahead: [seat(5, "RB"), seat(6, "RB")] }, 1);
    expect(why.text).toBe("He fills your RB slot, and he is the No. 4 back on our board. Backs are going, 3 of the last 4 picks, and all 2 seats before you lean back in our 200 runs.");
    expect(why.shape).toBe("value:1");
  });

  it("ignores a run at another position, and says when no seat leans his way", () => {
    const why = buildWhy({ ...BASE, positionRank: 1, run: { position: "WR", count: 3, window: 4 }, ahead: [seat(5, "WR"), seat(6, "QB")] }, 2);
    expect(why.text).toBe("The best back on our board: he fills your RB slot. None of the 2 seats before you leans back in our 200 runs.");
  });

  it("handles one seat ahead, a bench spot, a full roster and no seats at all", () => {
    expect(buildWhy({ ...BASE, fillsSlot: "BENCH", ahead: [seat(5, "RB")] }, 0).text).toBe("He is the No. 4 back on our board, and he takes a bench spot. The seat before you leans back in our 200 runs.");
    expect(buildWhy({ ...BASE, fillsSlot: null, ahead: [seat(5, "WR")] }, 0).text).toBe("He is the No. 4 back on our board, and he has no open slot on your roster. The seat before you does not lean back in our 200 runs.");
    expect(buildWhy({ ...BASE, ahead: [] }, 0).text).toBe("He is the No. 4 back on our board, and he fills your RB slot. Nobody picks between now and your next turn.");
  });

  it("never argues a drop for a market-order position", () => {
    const why = buildWhy({ ...BASE, position: "K", positionRank: 2, fillsSlot: "K", reasons: [{ code: "tier_cliff", position: "K", dropToNextTier: 12, playersLeftInTier: 1 }] }, 0);
    expect(why.shape).toBe("value:0");
    expect(why.text).not.toMatch(/drop/);
  });

  it("rotates three shapes per family by the pick it was computed at, never a tier letter or a model word, no banned punctuation", () => {
    const cliff: WhyFacts = { ...BASE, reasons: [{ code: "tier_cliff", position: "WR", dropToNextTier: 9, playersLeftInTier: 3 }], position: "WR" };
    const shapes = [0, 1, 2, 3].map((variant) => buildWhy(cliff, variant));
    expect(shapes.map((why) => why.shape)).toEqual(["cliff:0", "cliff:1", "cliff:2", "cliff:0"]);
    expect(new Set(shapes.slice(0, 3).map((why) => why.text)).size).toBe(3);
    for (const why of shapes) {
      expect(why.text).not.toMatch(BANNED);
      expect(why.text).not.toMatch(/tier [A-Z]\b|prior|infer|one of 1\b/i);
      expect(why.text.split(/(?<=[.!?])\s+/).length).toBe(2);
    }
  });
});
