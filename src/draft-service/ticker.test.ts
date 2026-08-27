import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import type { Db } from "@/db/client";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, players } from "@/db/schema";
import { DRAFT_ACTION_VERSION } from "@/domain/draft";
import { currentDeadline } from "@/draft-engine";
import type { HouseFactoryOutcome } from "@/league-service/house-factory";
import { HOUSE_CATALOG } from "@/matchmaking/house-catalog";
import { MOCK_CONFIG } from "@/mock-draft/config";
import type { MockStartOutcome } from "@/mock-draft-service/driver";
import type { AutoStartOutcome } from "./auto-start";
import { DRAFT_SERVICE_CONFIG } from "./config";
import { createDraftStore, type DraftStore } from "./store";
import { createDraftTicker } from "./ticker";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
let now = "2026-09-01T00:00:00.000Z";
const clock = { now: () => now };

/**
 * A no-op stand-in for the real `ensureHouseCatalog`, injected into every ticker test below that
 * has nothing to do with the house-catalog shelf — the same "so a test can stub it without
 * seeding a fixture for every ticker test that has nothing to do with it" reasoning `autoStart`'s
 * own default already gets. Unlike `autoStartDueDrafts`, the real `ensureHouseCatalog` is not
 * passive: it CREATES real, public-matchmade house leagues whose drafts can become due on a later
 * tick, which would otherwise widen these unrelated tests' `tick()` assertions with outcomes they
 * were never written to expect. `describe("draft ticker — house reconcile ...")`, further down,
 * is where the real default is exercised on purpose.
 */
const NO_OP_HOUSE_RECONCILE = async (): Promise<HouseFactoryOutcome> => ({
  opened: [],
  retired: [],
  refused: [],
});

beforeEach(async () => {
  await truncateAll(db);
  now = "2026-09-01T00:00:00.000Z";
});

afterAll(async () => {
  await truncateAll(db);
});

async function liveDraft() {
  const fixture = await seedDraftFixture(db, {
    draftId: "draft_tick",
    leagueId: "league_tick",
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
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
  return {
    fixture,
    store,
    ticker: createDraftTicker({
      db,
      store,
      clock,
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
    }),
  };
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
    await store.applyAction(fixture.draftId, {
      v: DRAFT_ACTION_VERSION,
      type: "SET_QUEUE",
      timestamp: now,
      teamId: onClockTeamId,
      playerIds: ["qb1"],
    });
    // The raw 8h deadline would be 08:00Z, but `loadDraftConfig` attaches the real overnight
    // freeze (2-5 AM ET) and this turn's start (8 PM ET, 8/31) runs straight into it, pushing
    // the true deadline to 11:00Z — proof, in passing, that the ticker's own expiry sweep
    // inherits the pause for free by reading `currentDeadline` and nothing else.
    now = "2026-09-01T12:00:00.000Z";
    expect(await ticker.tick()).toEqual([
      { draftId: fixture.draftId, applied: true },
    ]);
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
      draftId: "draft_tick_scheduled",
      leagueId: "league_tick_scheduled",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
    });
    now = "2026-09-01T12:00:00.000Z"; // past the in-progress draft's (pause-extended) deadline
    expect(await ticker.tick()).toEqual([
      { draftId: fixture.draftId, applied: true },
    ]);
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
    const nudger = {
      nudge: async () => {
        calls.push("nudged");
        return "published" as const;
      },
    };
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      nudger,
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
    });
    now = "2026-09-01T07:00:00.000Z"; // inside the turn
    expect(await ticking.tick()).toEqual([]);
    expect(calls).toEqual(["nudged"]);
    now = "2026-09-01T12:00:00.000Z"; // past the (pause-extended) deadline
    expect(await ticking.tick()).toEqual([
      { draftId: fixture.draftId, applied: true },
    ]);
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
    const ticker = createDraftTicker({
      db,
      store,
      clock,
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
    });
    expect(await ticker.tick()).toEqual([]);
  });

  it("tick() catches a per-draft error, logs it, and reports it — a stuck draft must not stop the scan", async () => {
    const { fixture } = await liveDraft();
    now = "2026-09-01T09:00:00.000Z";
    const store = {
      getDraftState: async () => {
        throw new Error("connection reset");
      },
      applyAction: async () => ({ ok: false as const, reason: "n/a" }),
      invalidate: () => {},
    } as unknown as DraftStore;
    const onOutcome = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ticker = createDraftTicker({
        db,
        store,
        clock,
        onOutcome,
        reconcileHouse: NO_OP_HOUSE_RECONCILE,
      });
      const outcomes = await ticker.tick();
      const expected = {
        draftId: fixture.draftId,
        applied: false,
        reason: "Something went wrong checking this draft's clock.",
      };
      expect(outcomes).toEqual([expected]);
      expect(onOutcome).toHaveBeenCalledWith(expected);
      expect(errorSpy).toHaveBeenCalledWith(
        "[draft] ticker failed for draft",
        fixture.draftId,
        expect.any(Error),
      );
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
                if (callCount === 1)
                  return new Promise((_resolve, reject) => {
                    releaseFirstCall = reject;
                  });
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
    const ticker = createDraftTicker({
      db: failingDb,
      store,
      clock,
      intervalMs: 5,
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
    });
    try {
      ticker.start();
      // Give the interval time to fire several times while the first call is still hanging.
      await new Promise((resolve) => setTimeout(resolve, 40));
      expect(callCount).toBe(1); // the overlap guard suppressed every later firing

      releaseFirstCall?.(new Error("db down"));
      // Let the rejection propagate through start()'s `.catch().finally()`.
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(errorSpy).toHaveBeenCalledWith(
        "[draft] ticker failed",
        expect.any(Error),
      );

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
    const applyAction = vi.fn(async () => ({
      ok: false as const,
      reason: "boom",
    }));
    const store = { ...realStore, applyAction };
    const onOutcome = vi.fn();
    const ticker = createDraftTicker({
      db,
      store,
      clock,
      onOutcome,
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
    });

    const first = await ticker.tick();
    expect(first).toEqual([
      { draftId: fixture.draftId, applied: false, reason: "boom" },
    ]);
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith({
      draftId: fixture.draftId,
      applied: false,
      reason: "boom",
    });

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
    const store = {
      ...realStore,
      applyAction: async () => ({ ok: false as const, reason: "boom" }),
    };
    const ticker = createDraftTicker({
      db,
      store,
      clock,
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await ticker.tick();
      expect(warnSpy).toHaveBeenCalledWith("[draft] tick not applied", {
        draftId: fixture.draftId,
        applied: false,
        reason: "boom",
      });
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
      v: DRAFT_ACTION_VERSION,
      type: "MAKE_PICK",
      timestamp: now,
      teamId: onClockTeamId,
      playerId: "qb1",
    });
    expect(picked.ok).toBe(true);

    // The ticker's now-stale TIMER_EXPIRE — computed against the superseded deadline —
    // must not be allowed to autopick for whoever's turn it now is.
    const stale = await store.applyAction(fixture.draftId, {
      v: DRAFT_ACTION_VERSION,
      type: "TIMER_EXPIRE",
      timestamp: staleDeadline,
    });
    expect(stale).toEqual({
      ok: false,
      reason: "The clock hasn't run out yet.",
    });
  });
});

describe("draft ticker — auto-start (Task 7)", () => {
  it("runs auto-start FIRST, mapping its outcomes ahead of the expiry scan's own", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z"; // past the live draft's own (pause-extended) deadline, so it also expires this tick
    const calls: string[] = [];
    const autoStart = async (): Promise<readonly AutoStartOutcome[]> => {
      calls.push("auto-start");
      return [
        {
          draftId: "draft_other",
          started: false,
          reason: "kept for its commissioner",
        },
      ];
    };
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart,
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
    });

    const outcomes = await ticking.tick();
    expect(calls).toEqual(["auto-start"]);
    // Auto-start's own outcome, mapped `started` -> `applied`, comes first — then the expiry
    // scan's own outcome for the live draft it started already.
    expect(outcomes).toEqual([
      {
        draftId: "draft_other",
        applied: false,
        reason: "kept for its commissioner",
      },
      { draftId: fixture.draftId, applied: true },
    ]);
  });

  it("defaults to the real autoStartDueDrafts and actually starts a due public matchmade draft, same tick", async () => {
    await seedDraftFixture(db, {
      draftId: "draft_due",
      leagueId: "league_due",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-01T00:00:00.000Z"),
      auctionBudget: null,
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
    const store = createDraftStore({
      db,
      publish: async () => "1-0",
      clock,
      deliverNotice: async () => {},
    });
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
    });

    now = "2026-09-01T00:01:00.000Z"; // past the fixed kickoff, seconds after the draft would open
    const outcomes = await ticking.tick();
    expect(outcomes).toContainEqual({
      draftId: "draft_due",
      applied: true,
      reason: undefined,
    });

    const [row] = await db
      .select({ status: drafts.status })
      .from(drafts)
      .where(eq(drafts.id, "draft_due"));
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
      const ticking = createDraftTicker({
        db,
        store,
        clock,
        autoStart,
        reconcileHouse: NO_OP_HOUSE_RECONCILE,
      });
      const outcomes = await ticking.tick();
      // The expiry scan still ran and expired the live draft, despite auto-start's own failure.
      expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
      expect(errorSpy).toHaveBeenCalledWith(
        "[draft] auto-start scan failed",
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe("draft ticker — house reconcile (Phase 3.5 addendum, Task 13)", () => {
  const noOutcome: HouseFactoryOutcome = { opened: [], retired: [], refused: [] };

  it("runs house reconcile SECOND: after auto-start, before the expiry scan", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z"; // past the live draft's own (pause-extended) deadline
    const calls: string[] = [];
    const autoStart = async (): Promise<readonly AutoStartOutcome[]> => {
      calls.push("auto-start");
      return [];
    };
    const reconcileHouse = async (): Promise<HouseFactoryOutcome> => {
      calls.push("house-reconcile");
      return noOutcome;
    };
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart,
      reconcileHouse,
    });

    const outcomes = await ticking.tick();
    expect(calls).toEqual(["auto-start", "house-reconcile"]);
    // The expiry scan's own outcome is unaffected — house reconcile contributes nothing to the
    // returned outcomes array, only to the rate-limited log below.
    expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
  });

  it("reports a shortfall it could not fill through the same rate-limited onOutcome every expiry failure uses", async () => {
    const { store } = await liveDraft();
    const reconcileHouse = async (): Promise<HouseFactoryOutcome> => ({
      opened: [],
      retired: [],
      refused: [
        {
          rung: "open_12",
          reason: "Something went wrong opening this league.",
        },
      ],
    });
    const onOutcome = vi.fn();
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => [],
      reconcileHouse,
      onOutcome,
    });

    await ticking.tick();
    expect(onOutcome).toHaveBeenCalledWith({
      draftId: "house:open_12",
      applied: false,
      reason: "Something went wrong opening this league.",
    });
  });

  it("calls reconcileHouse on the first tick, then withholds it until houseReconcileIntervalMs has passed", async () => {
    const { store } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z";
    let calls = 0;
    const reconcileHouse = async (): Promise<HouseFactoryOutcome> => {
      calls += 1;
      return noOutcome;
    };
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => [],
      reconcileHouse,
    });

    await ticking.tick();
    expect(calls).toBe(1);

    // Same instant again — still gated.
    await ticking.tick();
    expect(calls).toBe(1);

    // Just under the interval — a tick before it does not reconcile.
    now = "2026-09-01T12:00:29.999Z";
    await ticking.tick();
    expect(calls).toBe(1);

    // At/after the interval — a tick after it does.
    now = new Date(
      Date.parse("2026-09-01T12:00:00.000Z") +
        DRAFT_SERVICE_CONFIG.houseReconcileIntervalMs,
    ).toISOString();
    await ticking.tick();
    expect(calls).toBe(2);
  });

  it("logs and continues to the expiry scan when reconcileHouse itself throws", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z"; // past the live draft's own (pause-extended) deadline
    const reconcileHouse = async (): Promise<never> => {
      throw new Error("house reconcile connection reset");
    };
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ticking = createDraftTicker({
        db,
        store,
        clock,
        autoStart: async () => [],
        reconcileHouse,
      });
      const outcomes = await ticking.tick();
      // The expiry scan still ran and expired the live draft, despite house reconcile's own failure.
      expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
      expect(errorSpy).toHaveBeenCalledWith(
        "[draft] house reconcile failed",
        expect.any(Error),
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("defaults to the real ensureHouseCatalog and actually opens the shelf on a cold database", async () => {
    const { store } = await liveDraft();
    const ticking = createDraftTicker({ db, store, clock });

    await ticking.tick();
    const rows = await db
      .select({ id: leagues.id })
      .from(leagues)
      .where(eq(leagues.houseRung, "open_12"));
    expect(rows).toHaveLength(HOUSE_CATALOG.rungs.open_12.openAtOnce);
  });
});

/**
 * Phase 4.5, Task 6: the ticker's three MOCK lanes — the due-start scan, the bot driver hook in
 * `tickOne`, and the interval-gated retention sweep. These tests pin the WIRING (ordering,
 * outcome mapping, failure isolation, the per-tick bot budget); the lanes' own behavior against
 * real rooms lives with them, in `@/mock-draft-service/driver.test.ts` and `sweep.test.ts`.
 */
describe("draft ticker — mock lanes (Phase 4.5, Task 6)", () => {
  const NO_MOCK_STARTS = async (): Promise<readonly MockStartOutcome[]> => [];
  const NO_SWEEP = async (): Promise<readonly never[]> => [];

  /** A started 2-team all-bot mock draft on the 30s practice clock. Callers seed players first. */
  async function liveMockDraft(id: string) {
    const fixture = await seedDraftFixture(db, {
      draftId: `draft_${id}`,
      leagueId: `league_${id}`,
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
      isMock: true,
      botTeams: 2,
      mockPickSeconds: 30,
    });
    const store = createDraftStore({ db, publish: async () => "1-0", clock });
    await store.startDraft(fixture.draftId);
    return { fixture, store };
  }

  async function seedSharedPlayers() {
    await db.insert(players).values([
      { id: "mqb1", name: "MQB One", position: "QB", nflTeam: "KC" },
      { id: "mqb2", name: "MQB Two", position: "QB", nflTeam: "KC" },
      { id: "mrb1", name: "MRB One", position: "RB", nflTeam: "SF" },
      { id: "mrb2", name: "MRB Two", position: "RB", nflTeam: "SF" },
      { id: "mwr1", name: "MWR One", position: "WR", nflTeam: "NYJ" },
      { id: "mwr2", name: "MWR Two", position: "WR", nflTeam: "NYJ" },
    ]);
  }

  it("runs the mock due-start THIRD and the sweep FOURTH: after auto-start and house reconcile, before the expiry scan", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z"; // past the live draft's own (pause-extended) deadline
    const calls: string[] = [];
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => {
        calls.push("auto-start");
        return [];
      },
      reconcileHouse: async () => {
        calls.push("house-reconcile");
        return { opened: [], retired: [], refused: [] };
      },
      startDueMocks: async () => {
        calls.push("mock-due-start");
        return [];
      },
      sweepMocks: async () => {
        calls.push("mock-sweep");
        return [];
      },
    });

    const outcomes = await ticking.tick();
    expect(calls).toEqual(["auto-start", "house-reconcile", "mock-due-start", "mock-sweep"]);
    // The expiry scan still ran last: the live draft expired on this same tick.
    expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
  });

  it("maps due-start outcomes: a start joins the outcomes, a failure is reported, the mapped-409 race is absorbed silently", async () => {
    const { store } = await liveDraft();
    const startDueMocks = async (): Promise<readonly MockStartOutcome[]> => [
      { leagueId: "league_started", started: true, draftId: "draft_started_mock" },
      { leagueId: "league_failed", started: false, benignRace: false, reason: "boom" },
      { leagueId: "league_race", started: false, benignRace: true, reason: "This draft has already started." },
    ];
    const onOutcome = vi.fn();
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks,
      sweepMocks: NO_SWEEP,
      onOutcome,
    });

    const outcomes = await ticking.tick();
    expect(outcomes).toContainEqual({ draftId: "draft_started_mock", applied: true });
    expect(outcomes).toContainEqual({ draftId: "mock:league_failed", applied: false, reason: "boom" });
    // The benign race maps to NOTHING: not an outcome, not a warning — the room the scan wanted
    // started exists, another instance simply got there first.
    expect(outcomes.map((outcome) => outcome.draftId)).not.toContain("mock:league_race");
    expect(onOutcome).toHaveBeenCalledTimes(1);
    expect(onOutcome).toHaveBeenCalledWith({ draftId: "mock:league_failed", applied: false, reason: "boom" });
  });

  it("logs and continues to the expiry scan when the due-start scan itself throws", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ticking = createDraftTicker({
        db,
        store,
        clock,
        autoStart: async () => [],
        reconcileHouse: NO_OP_HOUSE_RECONCILE,
        startDueMocks: async () => {
          throw new Error("mock scan connection reset");
        },
        sweepMocks: NO_SWEEP,
      });
      const outcomes = await ticking.tick();
      expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
      expect(errorSpy).toHaveBeenCalledWith("[draft] mock due-start scan failed", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("runs the sweep on the first tick, then withholds it until sweepIntervalMs has passed — wired to the driver's own meta invalidation", async () => {
    const { store } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z";
    let sweeps = 0;
    let sweepDeps: { invalidateDriverMeta?: (draftId: string) => void } | undefined;
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks: NO_MOCK_STARTS,
      sweepMocks: async (_sweepDb, deps) => {
        sweeps += 1;
        sweepDeps = deps;
        return [];
      },
    });

    await ticking.tick();
    expect(sweeps).toBe(1);
    // Fix round (review MEDIUM): the ticker hands the sweep its OWN driver's `invalidateDraft`,
    // so a swept room's cached bot meta dies with the room — the seam's behavior is proven in
    // `driver.test.ts`/`sweep.test.ts`; this pins that the default wiring actually connects it.
    expect(typeof sweepDeps?.invalidateDriverMeta).toBe("function");

    // Same instant — still gated.
    await ticking.tick();
    expect(sweeps).toBe(1);

    // Just under the interval.
    now = new Date(Date.parse("2026-09-01T12:00:00.000Z") + MOCK_CONFIG.sweepIntervalMs - 1).toISOString();
    await ticking.tick();
    expect(sweeps).toBe(1);

    // At/after the interval.
    now = new Date(Date.parse("2026-09-01T12:00:00.000Z") + MOCK_CONFIG.sweepIntervalMs).toISOString();
    await ticking.tick();
    expect(sweeps).toBe(2);
  });

  it("logs and continues to the expiry scan when the sweep throws", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ticking = createDraftTicker({
        db,
        store,
        clock,
        autoStart: async () => [],
        reconcileHouse: NO_OP_HOUSE_RECONCILE,
        startDueMocks: NO_MOCK_STARTS,
        sweepMocks: async () => {
          throw new Error("sweep connection reset");
        },
      });
      const outcomes = await ticking.tick();
      expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
      expect(errorSpy).toHaveBeenCalledWith("[draft] mock sweep failed", expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("hands a live mock draft to the bot driver and maps its pick to an applied outcome", async () => {
    await seedSharedPlayers();
    const { fixture, store } = await liveMockDraft("wire_pick");
    const seenStates: unknown[] = [];
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks: NO_MOCK_STARTS,
      sweepMocks: NO_SWEEP,
      driveMockPick: async (state) => {
        seenStates.push(state);
        return { picked: true as const, picks: 1 };
      },
    });

    const outcomes = await ticking.tick();
    expect(seenStates).toHaveLength(1);
    expect(seenStates[0]).toMatchObject({ config: { draftId: fixture.draftId, isMock: true } });
    expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
  });

  it("surfaces the driver's refusal through the same rate-limited reporter every lane uses", async () => {
    await seedSharedPlayers();
    const { fixture, store } = await liveMockDraft("wire_refuse");
    const onOutcome = vi.fn();
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks: NO_MOCK_STARTS,
      sweepMocks: NO_SWEEP,
      driveMockPick: async () => ({ picked: false as const, reason: "bot boom" }),
      onOutcome,
    });

    const outcomes = await ticking.tick();
    const expected = { draftId: fixture.draftId, applied: false, reason: "bot boom" };
    expect(outcomes).toEqual([expected]);
    expect(onOutcome).toHaveBeenCalledWith(expected);
  });

  it("falls through to the ordinary clock check when the driver has nothing to do", async () => {
    await seedSharedPlayers();
    const { fixture, store } = await liveMockDraft("wire_null");
    now = "2026-09-01T00:00:31.000Z"; // past the mock's own 30s practice clock
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks: NO_MOCK_STARTS,
      sweepMocks: NO_SWEEP,
      driveMockPick: async () => null,
    });

    const outcomes = await ticking.tick();
    expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
    // The clock acted, not the driver: the pick the fall-through produced is an autopick.
    const state = await store.getDraftState(fixture.draftId);
    expect(state?.picks).toHaveLength(1);
    expect(state?.picks[0]?.auto).toBe(true);
  });

  it("logs a driver failure and still checks that draft's clock the same tick", async () => {
    await seedSharedPlayers();
    const { fixture, store } = await liveMockDraft("wire_throw");
    now = "2026-09-01T00:00:31.000Z"; // past the mock's own 30s practice clock
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ticking = createDraftTicker({
        db,
        store,
        clock,
        autoStart: async () => [],
        reconcileHouse: NO_OP_HOUSE_RECONCILE,
        startDueMocks: NO_MOCK_STARTS,
        sweepMocks: NO_SWEEP,
        driveMockPick: async () => {
          throw new Error("driver connection reset");
        },
      });
      const outcomes = await ticking.tick();
      expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
      expect(errorSpy).toHaveBeenCalledWith("[draft] mock bot driver failed for draft", fixture.draftId, expect.any(Error));
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("never hands a REAL draft to the bot driver", async () => {
    const { store, fixture } = await liveDraft();
    now = "2026-09-01T12:00:00.000Z";
    const driveMockPick = vi.fn(async () => null);
    const ticking = createDraftTicker({
      db,
      store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks: NO_MOCK_STARTS,
      sweepMocks: NO_SWEEP,
      driveMockPick,
    });

    const outcomes = await ticking.tick();
    expect(driveMockPick).not.toHaveBeenCalled();
    expect(outcomes).toEqual([{ draftId: fixture.draftId, applied: true }]);
  });

  it("bounds bot picks per tick: at the budget, later mock drafts fall through to the ordinary clock check", async () => {
    await seedSharedPlayers();
    const first = await liveMockDraft("wire_budget_a");
    const second = await liveMockDraft("wire_budget_b");
    const driveMockPick = vi.fn(async () => ({ picked: true as const, picks: 1 }));
    const ticking = createDraftTicker({
      db,
      store: first.store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks: NO_MOCK_STARTS,
      sweepMocks: NO_SWEEP,
      driveMockPick,
      maxBotPicksPerTick: 1,
    });

    const outcomes = await ticking.tick();
    // One budgeted pick; the second mock draft was not driven this tick (and, inside its own
    // clock, produced no outcome at all).
    expect(driveMockPick).toHaveBeenCalledTimes(1);
    expect(outcomes).toHaveLength(1);
    expect([first.fixture.draftId, second.fixture.draftId]).toContain(outcomes[0]!.draftId);

    // A zero budget never invokes the driver at all.
    driveMockPick.mockClear();
    const stopped = createDraftTicker({
      db,
      store: first.store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks: NO_MOCK_STARTS,
      sweepMocks: NO_SWEEP,
      driveMockPick,
      maxBotPicksPerTick: 0,
    });
    await stopped.tick();
    expect(driveMockPick).not.toHaveBeenCalled();
  });

  it("a sim stretch spends its whole pick count: one stretch can exhaust the budget for the tick", async () => {
    // Sim-to-next-pick (the founder's directive): a lone human's room lands a whole bot
    // stretch in one drive, and the budget is spent per PICK, never per call — so a budget of
    // 3 is gone after one 3-pick stretch, and the second live mock is not driven this tick.
    await seedSharedPlayers();
    const first = await liveMockDraft("wire_sim_budget_a");
    await liveMockDraft("wire_sim_budget_b");
    const driveMockPick = vi.fn(async () => ({ picked: true as const, picks: 3 }));
    const ticking = createDraftTicker({
      db,
      store: first.store,
      clock,
      autoStart: async () => [],
      reconcileHouse: NO_OP_HOUSE_RECONCILE,
      startDueMocks: NO_MOCK_STARTS,
      sweepMocks: NO_SWEEP,
      driveMockPick,
      maxBotPicksPerTick: 3,
    });

    await ticking.tick();
    expect(driveMockPick).toHaveBeenCalledTimes(1);
  });
});
