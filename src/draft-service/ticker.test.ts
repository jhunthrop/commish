import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import { bestAvailableFor, currentDeadline, teamOnClock } from "@/draft-engine";
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

  it("only scans drafts with status='in_progress', leaving a merely scheduled draft in the same table untouched", async () => {
    const { ticker, fixture } = await liveDraft();
    // Present in `drafts`, but never started — must never appear in the ticker's SQL scan,
    // not merely be a no-op once loaded.
    await seedDraftFixture(db, {
      draftId: "draft_tick_scheduled", leagueId: "league_tick_scheduled", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    });
    now = "2026-09-01T09:00:00.000Z"; // past the in-progress draft's deadline
    expect(await ticker.tick()).toEqual([{ draftId: fixture.draftId, applied: true }]);
  });

  it("reports applied:false with the store's own rejection reason when applyAction is rejected", async () => {
    const { ticker, store, fixture } = await liveDraft();
    now = "2026-09-01T09:00:00.000Z"; // past the deadline
    // A real MAKE_PICK from a second store instance, landing between the ticker's read (which
    // decides the clock has run out) and its own TIMER_EXPIRE write. This is exactly the race
    // `admitTimerExpire` (admit.ts) exists to close: "the ticker reads state and computes a
    // deadline in one step, then submits TIMER_EXPIRE in a later, separate step; a legitimate
    // action can land in between and start a fresh clock for someone else." Task 6's freshness
    // check makes that race easier to hit (a raw out-of-band DB insert used to be enough to
    // force `applyAction`'s stale-cache/unique-index rejection — now the store just self-heals
    // from that on the next read — so provoking a genuine "reducer rejected" here means
    // injecting a real accepted action, not sabotaging the log directly).
    const secondStore = createDraftStore({ db, publish: async () => "1-0", clock });
    const spy = vi.spyOn(store, "getDraftState").mockImplementationOnce(async (draftId) => {
      const state = await secondStore.getDraftState(draftId);
      const onClock = state === null ? null : teamOnClock(state);
      const best = state === null || onClock === null ? null : bestAvailableFor(state, onClock);
      if (state === null || onClock === null || best === null) {
        throw new Error("test setup: expected a live draft with an available player");
      }
      const raced = await secondStore.applyAction(draftId, {
        v: DRAFT_ACTION_VERSION,
        type: "MAKE_PICK",
        timestamp: now,
        teamId: onClock,
        playerId: best.playerId,
      });
      if (!raced.ok) throw new Error(`test setup: racing pick was rejected: ${raced.reason}`);
      // Return the PRE-race state — this is what the ticker's own read actually saw, and is
      // still past its deadline, so `tickOne` proceeds to submit TIMER_EXPIRE against a clock
      // that (unbeknownst to it) has already been reset by the pick above.
      return state;
    });

    expect(await ticker.tick()).toEqual([
      { draftId: fixture.draftId, applied: false, reason: "The clock hasn't run out yet." },
    ]);
    spy.mockRestore();
  });

  // P3 (controller ruling): the brief's version of this test ended in `expect(true).toBe(true)`,
  // which asserts nothing. Replaced with real assertions on the native timer plumbing: start()
  // creates exactly one interval even when called twice (idempotent), and stop() clears that
  // exact interval — including being idempotent itself — so no further tick can ever fire.
  it("nudges a live draft instead of expiring it, and expires it without nudging", async () => {
    const { store, fixture } = await liveDraft();
    const calls: string[] = [];
    const nudger = { nudge: async () => { calls.push("nudged"); return "published" as const; } };
    const ticking = createDraftTicker({ db, store, clock, nudger });
    now = "2026-09-01T07:00:00.000Z"; // inside the turn
    expect(await ticking.tick()).toEqual([]);
    expect(calls).toEqual(["nudged"]);
    now = "2026-09-01T09:00:00.000Z"; // past the deadline
    expect(await ticking.tick()).toEqual([{ draftId: fixture.draftId, applied: true }]);
    expect(calls).toEqual(["nudged"]);
  });

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

describe("draft ticker — onOutcome logging (I5)", () => {
  it("logs the first applied:false outcome for a draft, then rate-limits further logs until tickWarnIntervalMs has passed", async () => {
    const { fixture, store: realStore } = await liveDraft();
    // Past the initial deadline, so tickOne always attempts an expiry.
    now = "2026-09-01T09:00:00.000Z";
    // Warm the real store's cache with the actual (past-deadline) draft state, then hand the
    // ticker a store whose applyAction always rejects — deterministic repeated failures,
    // without depending on the exact shape of a real race.
    await realStore.getDraftState(fixture.draftId);
    const applyAction = vi.fn(async () => ({ ok: false as const, reason: "boom" }));
    const store = { ...realStore, applyAction };
    const onOutcome = vi.fn();
    const ticker = createDraftTicker({ db, store, clock, onOutcome });

    const first = await ticker.tick();
    expect(first).toEqual([{ draftId: fixture.draftId, applied: false, reason: "boom" }]);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith({ draftId: fixture.draftId, applied: false, reason: "boom" });

    // Same instant, still failing — must NOT log again yet.
    await ticker.tick();
    expect(onOutcome).toHaveBeenCalledTimes(1);

    // Just under the interval — still rate-limited.
    now = "2026-09-01T09:00:59.999Z";
    await ticker.tick();
    expect(onOutcome).toHaveBeenCalledTimes(1);

    // At/after the interval — logs again.
    now = "2026-09-01T09:01:00.000Z";
    await ticker.tick();
    expect(onOutcome).toHaveBeenCalledTimes(2);
  });

  it("defaults onOutcome to a rate-limited console.warn", async () => {
    const { fixture, store: realStore } = await liveDraft();
    now = "2026-09-01T09:00:00.000Z";
    await realStore.getDraftState(fixture.draftId);
    const store = { ...realStore, applyAction: async () => ({ ok: false as const, reason: "boom" }) };
    const ticker = createDraftTicker({ db, store, clock });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await ticker.tick();
      expect(warnSpy).toHaveBeenCalledWith(
        "[draft] tick not applied",
        { draftId: fixture.draftId, applied: false, reason: "boom" },
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

describe("draft ticker — R-B4 store-level regression (check-then-act race)", () => {
  it("rejects a stale TIMER_EXPIRE submitted after a concurrent pick already advanced the turn", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T09:00:00.000Z"; // past the initial 8h deadline

    // What the ticker would have read on its way to computing a deadline to expire.
    const before = await store.getDraftState(fixture.draftId);
    const staleDeadline = currentDeadline(before!)!;
    const onClockTeamId = before!.draftOrder[0]!;

    // A legitimate pick — a real HTTP request, in production — lands in the gap between
    // the ticker's read and the applyAction call it hasn't made yet.
    const picked = await store.applyAction(fixture.draftId, {
      v: DRAFT_ACTION_VERSION, type: "MAKE_PICK", timestamp: now, teamId: onClockTeamId, playerId: "qb1",
    });
    expect(picked.ok).toBe(true);

    // The ticker's now-stale TIMER_EXPIRE — computed against the superseded deadline —
    // must not be allowed to autopick for whoever's turn it now is.
    const stale = await store.applyAction(fixture.draftId, {
      v: DRAFT_ACTION_VERSION, type: "TIMER_EXPIRE", timestamp: staleDeadline,
    });
    expect(stale).toEqual({ ok: false, reason: "The clock hasn't run out yet." });
  });
});
