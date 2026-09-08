/** A complete `AdvisorView` for the room's own tests, overridable field by field. Not a test
 *  file itself (no `.test.`), so several suites can share it. */
import type { AdvisorView, NextPick } from "@/draft-service/assistant/view";

export function nextPick(over: Partial<NextPick> = {}): NextPick {
  return {
    playerId: "rb1",
    position: "RB",
    positionRank: 3,
    valueOverReplacement: 41.2,
    fillsSlot: "RB",
    makeItBack: { survival: 0.46, runs: 200 },
    why: "He is the last back before a 20.6 point drop, and he fills your RB slot. 2 of the 3 seats before you take a back most often in our 200 runs.",
    whyShape: "cliff:0",
    ...over,
  };
}

export function advisorView(over: Partial<AdvisorView> = {}): AdvisorView {
  return {
    pickNumber: 1,
    onTheClock: true,
    picksUntilYourTurn: 0,
    teamCount: 10,
    stamp: { computedAtPick: 1, sequence: 1 },
    runs: 200,
    pick: nextPick(),
    odds: { pickNumber: 20, runs: 200, survived: { rb1: 92, wr1: 160, te1: 30 } },
    tiers: { rb1: { tier: 1, left: 2, size: 4 }, wr1: { tier: 2, left: 5, size: 6 }, te1: { tier: 1, left: 1, size: 3 } },
    ...over,
  };
}
