import { beforeEach, describe, expect, it, vi } from "vitest";
import { ADVISOR_CONFIG } from "./config";
import { resetAdvisorMemoForTests, roomFactsFor, type RoomFacts } from "./memo";

function facts(fromPick: number): RoomFacts {
  return { table: { runs: 1, fromPick, throughPick: fromPick, played: [] }, tiers: {} };
}

describe("roomFactsFor", () => {
  beforeEach(() => resetAdvisorMemoForTests());

  it("computes once per room state and serves every later viewer of that state from memory", () => {
    const compute = vi.fn(() => facts(4));
    const first = roomFactsFor("d1", 4, compute);
    const second = roomFactsFor("d1", 4, compute);
    expect(second).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("replaces the room's facts on a new sequence, so a pick event evicts the old state", () => {
    const old = roomFactsFor("d1", 4, () => facts(4));
    const fresh = roomFactsFor("d1", 5, () => facts(5));
    expect(fresh).not.toBe(old);
    const again = vi.fn(() => facts(4));
    roomFactsFor("d1", 4, again);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently computed room past the bound", () => {
    for (let i = 0; i <= ADVISOR_CONFIG.memoRooms; i += 1) roomFactsFor(`d${i}`, 1, () => facts(1));
    const recompute = vi.fn(() => facts(1));
    roomFactsFor("d0", 1, recompute);
    expect(recompute).toHaveBeenCalledTimes(1);
    const kept = vi.fn(() => facts(1));
    roomFactsFor(`d${ADVISOR_CONFIG.memoRooms}`, 1, kept);
    expect(kept).not.toHaveBeenCalled();
  });
});
