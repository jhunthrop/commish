import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import { createDraftStore } from "./store";
import { createDraftTicker } from "./ticker";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
let now = "2026-09-01T00:00:00.000Z";
const clock = { now: () => now };

beforeEach(async () => {
  await truncateAll(db);
  now = "2026-09-01T00:00:00.000Z";
});

afterAll(async () => {
  await truncateAll(db);
});

async function liveDraft() {
  const fixture = await seedDraftFixture(db, {
    draftId: "draft_tick", leagueId: "league_tick", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  const store = createDraftStore({ db, publish: async () => "1-0", clock });
  await store.startDraft(fixture.draftId);
  return { fixture, store, ticker: createDraftTicker({ db, store, clock }) };
}

describe("draft ticker", () => {
  it("does nothing while the clock is still running", async () => {
    const { ticker, store, fixture } = await liveDraft();
    // Started 9+ days from kickoff: the 8-hour tier is in force, so 07:00 is still early.
    now = "2026-09-01T07:00:00.000Z";
    expect(await ticker.tick()).toEqual([]);
    expect((await store.getDraftState(fixture.draftId))?.picks).toHaveLength(0);
  });

  it("submits TIMER_EXPIRE once the deadline has passed, producing an autopick", async () => {
    const { ticker, store, fixture } = await liveDraft();
    now = "2026-09-01T09:00:00.000Z";
    expect(await ticker.tick()).toEqual([{ draftId: fixture.draftId, applied: true }]);
    const state = await store.getDraftState(fixture.draftId);
    expect(state?.picks).toHaveLength(1);
    expect(state?.picks[0]?.auto).toBe(true);
  });

  it("ignores drafts that aren't in progress", async () => {
    const { ticker } = await liveDraft();
    await truncateAll(db);
    expect(await ticker.tick()).toEqual([]);
  });

  // P3 (controller ruling): the brief's version of this test ended in `expect(true).toBe(true)`,
  // which asserts nothing. Replaced with real assertions on the native timer plumbing: start()
  // creates exactly one interval even when called twice (idempotent), and stop() clears that
  // exact interval — including being idempotent itself — so no further tick can ever fire.
  it("start() creates exactly one interval (idempotent) and stop() clears it (idempotent)", async () => {
    const { ticker } = await liveDraft();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");

    try {
      ticker.start();
      ticker.start(); // idempotent: must not create a second interval
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      const timerHandle = setIntervalSpy.mock.results[0]?.value;

      ticker.stop();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
      expect(clearIntervalSpy).toHaveBeenCalledWith(timerHandle);

      ticker.stop(); // idempotent: stopping again must not clear again
      expect(clearIntervalSpy).toHaveBeenCalledTimes(1);

      // start() again after stop() must create a fresh interval, not silently no-op forever.
      ticker.start();
      expect(setIntervalSpy).toHaveBeenCalledTimes(2);
      ticker.stop();
      expect(clearIntervalSpy).toHaveBeenCalledTimes(2);
    } finally {
      setIntervalSpy.mockRestore();
      clearIntervalSpy.mockRestore();
    }
  });
});
