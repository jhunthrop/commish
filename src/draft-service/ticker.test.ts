import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, players } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import { currentDeadline } from "@/draft-engine";
import type { AutoStartOutcome } from "./auto-start";
import { createDraftStore, type DraftStore } from "./store";
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
    // Queued (Task 5): the 8h tier here is well past the 1h skip floor, so a queueless team on
    // the clock would be skipped rather than autopicked — this test is about the autopick path.
    const onClockState = await store.getDraftState(fixture.draftId);
    const onClockTeamId = onClockState!.draftOrder[0]!;
    await store.applyAction(fixture.draftId, { v: DRAFT_ACTION_VERSION, type: "SET_QUEUE", timestamp: now, teamId: onClockTeamId, playerIds: ["qb1"] });
    // The raw 8h deadline would be 08:00Z, but `loadDraftConfig` attaches the real overnight
    // freeze (2-5 AM ET) and this turn's start (8 PM ET, 8/31) runs straight into it, pushing
    // the true deadline to 11:00Z — proof, in passing, that the ticker's own expiry sweep
    // inherits the pause for free by reading `currentDeadline` and nothing else.
    now = "2026-09-01T12:00:00.000Z";
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
    now = "2026-09-01T12:00:00.000Z"; // past the in-progress draft's (pause-extended) deadline
    expect(await ticker.tick()).toEqual([{ draftId: fixture.draftId, applied: true }]);
  });

  // A real "applyAction rejected" outcome reaching `ticker.tick()` is covered two ways
  // elsewhere, and a third test here would just restate one of them under a spy:
  //   - "draft ticker — R-B4 store-level regression" below proves the actual rejection this
  //     scenario produces — a real concurrent pick racing a now-stale TIMER_EXPIRE — comes back
  //     as `{ ok: false, reason: "The clock hasn't run out yet." }` from `store.applyAction`
  //     itself (Task 6's freshness check is what makes a raw out-of-band DB insert no longer
  //     enough to force that path — see the comment there).
  //   - "draft ticker — onOutcome logging (I5)" below proves `tickOne`'s own plumbing: given
  //     ANY `{ ok: false, reason }` from `store.applyAction`, `tick()` surfaces exactly
  //     `{ draftId, applied: false, reason }` in its result and to `onOutcome`.
  // Together those cover both halves (the rejection reason is real; the ticker forwards it
  // faithfully) without re-deriving the race through a `getDraftState` spy here too.

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
    now = "2026-09-01T12:00:00.000Z"; // past the (pause-extended) deadline
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

  it("skips a draft whose row says in_progress but whose replayed state is somehow null", async () => {
    // The scan's own SELECT filters on `drafts.status = 'in_progress'`, so real Postgres never
    // hands `tickOne` a draft id `getDraftState` then can't rebuild — a stub store is the only
    // way to put it in that state.
    // liveDraft()'s own store.startDraft() call is what leaves a real `drafts.status =
    // 'in_progress'` row for the ticker's scan to find; this test only replaces the STORE the
    // ticker reads through, never the row.
    await liveDraft();
    now = "2026-09-01T09:00:00.000Z";
    const store = {
      getDraftState: async () => null,
      applyAction: async () => ({ ok: false as const, reason: "n/a" }),
      invalidate: () => {},
    } as unknown as DraftStore;
    const ticker = createDraftTicker({ db, store, clock });
    expect(await ticker.tick()).toEqual([]);
  });

  it("tick() catches a per-draft error, logs it, and reports it — a stuck draft must not stop the scan", async () => {
    const { fixture } = await liveDraft();
    now = "2026-09-01T09:00:00.000Z";
    const store = {
      getDraftState: async () => { throw new Error("connection reset"); },
      applyAction: async () => ({ ok: false as const, reason: "n/a" }),
      invalidate: () => {},
    } as unknown as DraftStore;
    const onOutcome = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ticker = createDraftTicker({ db, store, clock, onOutcome });
      const outcomes = await ticker.tick();
      const expected = { draftId: fixture.draftId, applied: false, reason: "Something went wrong checking this draft's clock." };
      expect(outcomes).toEqual([expected]);
      expect(onOutcome).toHaveBeenCalledWith(expected);
      expect(errorSpy).toHaveBeenCalledWith("[draft] ticker failed for draft", fixture.draftId, expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("start()'s interval actually fires a real tick, skips an overlapping one, and recovers from tick() itself rejecting", async () => {
    // A `db` whose first query hangs until released, so a second interval firing while the
    // first tick is still in flight proves the `running` guard (line 121) rather than merely
    // asserting it fired once by luck of timing. Releasing it to REJECT (not resolve) is what
    // reaches `start()`'s own `.catch()` (lines 124-126), which `tick()` itself never triggers —
    // `tick()`'s internal try/catch (the test above) only guards a single draft's `tickOne`.
    let callCount = 0;
    let releaseFirstCall: ((error: Error) => void) | undefined;
    const failingDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: () => {
                callCount += 1;
                if (callCount === 1) return new Promise((_resolve, reject) => { releaseFirstCall = reject; });
                return Promise.reject(new Error("db down"));
              },
            }),
          }),
        }),
      }),
    } as unknown as Db;
    const store = {
      getDraftState: async () => null,
      applyAction: async () => ({ ok: false as const, reason: "n/a" }),
      invalidate: () => {},
    } as unknown as DraftStore;
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const ticker = createDraftTicker({ db: failingDb, store, clock, intervalMs: 5 });
    try {
      ticker.start();
      // Give the interval time to fire several times while the first call is still hanging.
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(callCount).toBe(1); // the overlap guard suppressed every later firing

      releaseFirstCall?.(new Error("db down"));
      // Let the rejection propagate through start()'s `.catch().finally()`.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(errorSpy).toHaveBeenCalledWith("[draft] ticker failed", expect.any(Error));

      // `running` was reset in `.finally()`, so a later interval can fire again.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(callCount).toBeGreaterThan(1);
    } finally {
      ticker.stop();
      errorSpy.mockRestore();
    }
  });
});

describe("draft ticker — onOutcome logging (I5)", () => {
  it("logs the first applied:false outcome for a draft, then rate-limits further logs until tickWarnIntervalMs has passed", async () => {
    const { fixture, store: realStore } = await liveDraft();
    // Past the (pause-extended) initial deadline, so tickOne always attempts an expiry.
    now = "2026-09-01T12:00:00.000Z";
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
    now = "2026-09-01T12:00:59.999Z";
    await ticker.tick();
    expect(onOutcome).toHaveBeenCalledTimes(1);

    // At/after the interval — logs again.
    now = "2026-09-01T12:01:00.000Z";
    await ticker.tick();
    expect(onOutcome).toHaveBeenCalledTimes(2);
  });

  it("defaults onOutcome to a rate-limited console.warn", async () => {
    const { fixture, store: realStore } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z"; // past the (pause-extended) deadline
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

describe("draft ticker — auto-start (Task 7)", () => {
  it("runs auto-start FIRST, mapping its outcomes ahead of the expiry scan's own", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z"; // past the live draft's own (pause-extended) deadline, so it also expires this tick
    const calls: string[] = [];
    const autoStart = async (): Promise<readonly AutoStartOutcome[]> => {
      calls.push("auto-start");
      return [{ draftId: "draft_other", started: false, reason: "kept for its commissioner" }];
    };
    const ticking = createDraftTicker({ db, store, clock, autoStart });

    const outcomes = await ticking.tick();
    expect(calls).toEqual(["auto-start"]);
    // Auto-start's own outcome, mapped `started` -> `applied`, comes first — then the expiry
    // scan's own outcome for the live draft it started already.
    expect(outcomes).toEqual([
      { draftId: "draft_other", applied: false, reason: "kept for its commissioner" },
      { draftId: fixture.draftId, applied: true },
    ]);
  });

  it("defaults to the real autoStartDueDrafts and actually starts a due public matchmade draft, same tick", async () => {
    await seedDraftFixture(db, {
      draftId: "draft_due", leagueId: "league_due", format: "snake", teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-01T00:00:00.000Z"), auctionBudget: null,
      isPublicMatchmade: true,
    });
    await db.insert(players).values([
      { id: "dqb1", name: "DQB One", position: "QB", nflTeam: "KC" },
      { id: "drb1", name: "DRB One", position: "RB", nflTeam: "SF" },
      { id: "dwr1", name: "DWR One", position: "WR", nflTeam: "NYJ" },
      { id: "dqb2", name: "DQB Two", position: "QB", nflTeam: "KC" },
      { id: "drb2", name: "DRB Two", position: "RB", nflTeam: "SF" },
      { id: "dwr2", name: "DWR Two", position: "WR", nflTeam: "NYJ" },
    ]);
    const store = createDraftStore({ db, publish: async () => "1-0", clock, deliverNotice: async () => {} });
    const ticking = createDraftTicker({ db, store, clock });

    now = "2026-09-01T00:01:00.000Z"; // past the fixed kickoff, seconds after the draft would open
    const outcomes = await ticking.tick();
    expect(outcomes).toContainEqual({ draftId: "draft_due", applied: true, reason: undefined });

    const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, "draft_due"));
    expect(row?.status).toBe("in_progress");
    // The clock the START_DRAFT itself set only just started — this SAME tick's expiry scan
    // must not treat a draft that is seconds old as already timed out.
    const state = await store.getDraftState("draft_due");
    expect(state?.pickNumber).toBe(1);
    expect(state?.picks).toHaveLength(0);
  });

  it("logs and continues to the expiry scan when the auto-start SCAN itself throws", async () => {
    // Distinct from a single due draft's own failure (already isolated inside
    // `autoStartDueDrafts`, per its own docblock) — this is the scan's OWN query failing before
    // it ever produces a row, which must not skip the expiry scan below it any more than one
    // in-progress draft's DB error skips the rest of THAT scan.
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z"; // past the live draft's own (pause-extended) deadline
    const autoStart = async (): Promise<never> => {
      throw new Error("auto-start connection reset");
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ticking = createDraftTicker({ db, store, clock, autoStart });
      const outcomes = await ticking.tick();
      // The expiry scan still ran and expired the live draft, despite auto-start's own failure.
      expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
      expect(errorSpy).toHaveBeenCalledWith("[draft] auto-start scan failed", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });
});
