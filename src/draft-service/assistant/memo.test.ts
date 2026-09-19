import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoomFacts } from "./memo";
import { heldRoomFacts, resetAdvisorMemoForTests, roomFactsFor, seatShortlistFor } from "./memo";

/** Facts told apart by their `fromPick`, which is all these tests need to distinguish. */
const facts = (fromPick: number): RoomFacts => ({ table: { runs: 1, fromPick, throughPick: fromPick, played: [] }, tiers: {}, collapses: [] });

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetAdvisorMemoForTests();
});

describe("roomFactsFor (the per-process memo, async compute)", () => {
  it("computes once per room state and serves the held facts to every later ask for that sequence", async () => {
    const compute = vi.fn(async () => facts(1));
    const first = await roomFactsFor("d1", 3, compute);
    const second = await roomFactsFor("d1", 3, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(heldRoomFacts("d1", 3)).toBe(first);
    expect(heldRoomFacts("d1", 4)).toBeNull();
  });

  it("two concurrent asks for one state share ONE in-flight compute (the compute is async now, so the window is real)", async () => {
    let release: () => void = () => undefined;
    const compute = vi.fn(() => new Promise<RoomFacts>((resolve) => { release = () => resolve(facts(2)); }));
    const a = roomFactsFor("d1", 5, compute);
    const b = roomFactsFor("d1", 5, compute);
    await settle();
    expect(compute).toHaveBeenCalledTimes(1);
    release();
    expect(await a).toBe(await b);
  });

  it("a newer sequence replaces the room's entry, and a compute that fails is forgotten so the next ask computes again", async () => {
    await roomFactsFor("d1", 1, async () => facts(3));
    await roomFactsFor("d1", 2, async () => facts(4));
    expect(heldRoomFacts("d1", 1)).toBeNull();
    expect(heldRoomFacts("d1", 2)).not.toBeNull();
    await expect(roomFactsFor("d2", 1, async () => Promise.reject(new Error("sim failed")))).rejects.toThrow("sim failed");
    expect(heldRoomFacts("d2", 1)).toBeNull();
    const retry = vi.fn(async () => facts(5));
    await roomFactsFor("d2", 1, retry);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("seat shortlists ride the held entry, single-flight per seat, and compute every time for a state the room does not hold", async () => {
    const compute = vi.fn(async () => []);
    expect(await seatShortlistFor("d1", 9, "t1", compute)).toEqual([]);
    expect(await seatShortlistFor("d1", 9, "t1", compute)).toEqual([]);
    expect(compute).toHaveBeenCalledTimes(2);
    await roomFactsFor("d1", 9, async () => facts(9));
    const a = seatShortlistFor("d1", 9, "t1", compute);
    const b = seatShortlistFor("d1", 9, "t1", compute);
    expect(await a).toBe(await b);
    expect(compute).toHaveBeenCalledTimes(3);
    // A failed compute is forgotten: the next ask computes again.
    await expect(seatShortlistFor("d1", 9, "t2", async () => Promise.reject(new Error("no")))).rejects.toThrow("no");
    expect(await seatShortlistFor("d1", 9, "t2", compute)).toEqual([]);
    expect(compute).toHaveBeenCalledTimes(4);
  });

  it("rememberRoomFacts holds facts computed elsewhere (a store read) as if this process had computed them", async () => {
    const { rememberRoomFacts } = await import("./memo");
    const held = facts(6);
    rememberRoomFacts("d3", 7, held);
    const compute = vi.fn(async () => facts(7));
    expect(await roomFactsFor("d3", 7, compute)).toBe(held);
    expect(compute).not.toHaveBeenCalled();
  });
});
