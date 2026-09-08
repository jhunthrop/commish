import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomOddsTable } from "../sim/room-odds";
import { ADVISOR_CONFIG } from "./config";
import { resetAdvisorMemoForTests, roomTableFor } from "./memo";

function table(fromPick: number): RoomOddsTable {
  return { runs: 1, fromPick, throughPick: fromPick, played: [] };
}

describe("roomTableFor", () => {
  beforeEach(() => resetAdvisorMemoForTests());

  it("computes once per room state and serves every later viewer of that state from memory", () => {
    const compute = vi.fn(() => table(4));
    const first = roomTableFor("d1", 4, compute);
    const second = roomTableFor("d1", 4, compute);
    expect(second).toBe(first);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("replaces the room's table on a new sequence, so a pick event evicts the old state", () => {
    const old = roomTableFor("d1", 4, () => table(4));
    const fresh = roomTableFor("d1", 5, () => table(5));
    expect(fresh).not.toBe(old);
    const again = vi.fn(() => table(4));
    roomTableFor("d1", 4, again);
    expect(again).toHaveBeenCalledTimes(1);
  });

  it("evicts the least recently computed room past the bound", () => {
    for (let i = 0; i <= ADVISOR_CONFIG.memoRooms; i += 1) roomTableFor(`d${i}`, 1, () => table(1));
    const recompute = vi.fn(() => table(1));
    roomTableFor("d0", 1, recompute);
    expect(recompute).toHaveBeenCalledTimes(1);
    const kept = vi.fn(() => table(1));
    roomTableFor(`d${ADVISOR_CONFIG.memoRooms}`, 1, kept);
    expect(kept).not.toHaveBeenCalled();
  });
});
