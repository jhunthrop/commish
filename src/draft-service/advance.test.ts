import { asc, eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftActions, drafts, players } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import type { DraftAction } from "@/domain/draft";
import { createMockBotDriver, type MockBotDriver } from "@/mock-draft-service/driver";
import { createDraftAdvancer, draftLoopTarget, runDraftAdvanceLoop, type DraftAdvancer } from "./advance";
import { createDraftStore, type DraftStore } from "./store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();

const BASE_NOW = "2026-09-01T00:00:00.000Z";
let now = BASE_NOW;
const clock: Clock = { now: () => now };
const atMs = (offsetMs: number): string => new Date(Date.parse(BASE_NOW) + offsetMs).toISOString();

function testStore(): DraftStore {
  return createDraftStore({ db, publish: async () => "0-0", clock });
}

function testAdvancer(store: DraftStore, overrides?: { readonly maxActionsPerAdvance?: number; readonly mockDriver?: MockBotDriver }): DraftAdvancer {
  return createDraftAdvancer({
    db,
    store,
    mockDriver: overrides?.mockDriver ?? createMockBotDriver({ db, store }),
    maxActionsPerAdvance: overrides?.maxActionsPerAdvance,
  });
}

/** Six players — exactly what a 2-team sprint-roster draft (2 × QB/RB/WR) can fully seat. */
async function seedSprintPlayers(): Promise<void> {
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
}

/**
 * A 2-team, all-HUMAN mock room on 60s clocks: no bot ever picks, so every one of its six turns
 * runs its clock out — the cleanest board for proving the catch-up loop's expiry chaining.
 * `kickoffAt` sits a day out so the deferred-start lane never fires under these tests.
 */
async function seedAbandonedMock(id: string, opts?: { readonly startsAtMs?: number; readonly botTeams?: number; readonly pickSeconds?: number }) {
  const fixture = await seedDraftFixture(db, {
    draftId: `draft_${id}`,
    leagueId: `league_${id}`,
    format: "snake",
    teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date(opts?.startsAtMs ?? Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
    auctionBudget: null,
    isMock: true,
    botTeams: opts?.botTeams ?? 0,
    mockPickSeconds: opts?.pickSeconds ?? 60,
  });
  await seedSprintPlayers();
  return fixture;
}

async function actionLog(draftId: string): Promise<readonly { readonly sequence: number; readonly action: DraftAction }[]> {
  const rows = await db
    .select({ sequence: draftActions.sequence, action: draftActions.action })
    .from(draftActions)
    .where(eq(draftActions.draftId, draftId))
    .orderBy(asc(draftActions.sequence));
  return rows.map((row) => ({ sequence: row.sequence, action: row.action as DraftAction }));
}

beforeEach(async () => {
  await truncateAll(db);
  now = BASE_NOW;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("catch-up chaining (the decided timestamp semantics)", () => {
  it("an abandoned draft catches up in clock-sized steps — every expiry stamped at ITS deadline, never at read time", async () => {
    const fixture = await seedAbandonedMock("chain");
    const store = testStore();
    await store.startDraft(fixture.draftId);

    // Ten abandoned minutes on 60s clocks: the six-pick sprint board owes six expiries, due at
    // T+60s, T+120s, ... T+360s — each turn's deadline chained from the PREVIOUS action's due
    // instant (`turnStartedAt` is always the applied action's own timestamp).
    now = atMs(10 * 60_000);
    const outcome = await testAdvancer(store).advance(fixture.draftId, now);
    expect(outcome.applied).toBe(6);
    expect(outcome.exhausted).toBe(false);

    const log = await actionLog(fixture.draftId);
    expect(log.map((row) => row.action.type)).toEqual(["START_DRAFT", ...Array.from({ length: 6 }, () => "TIMER_EXPIRE")]);
    const expiries = log.slice(1);
    expiries.forEach((row, i) => {
      expect(row.action.timestamp).toBe(atMs((i + 1) * 60_000));
    });

    const state = (await store.getDraftState(fixture.draftId))!;
    expect(state.phase).toBe("complete");
    expect(state.picks.every((pick) => pick.auto)).toBe(true);
    // A finished mock settles in the same call — its liveDraftsQuery slot is freed immediately.
    const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, fixture.draftId));
    expect(row?.status).toBe("complete");
  });

  it("catch-up is byte-identical to the stepped schedule: one call at T+10min replays exactly what 1s-stepped calls produce", async () => {
    // BOT seats this time, so the proof covers seeded think-delays and MAKE_PICKs, not only
    // expiries. Stepped first: advance once per simulated second across the whole window — the
    // closest thing to a live per-second driver that still stamps due instants.
    const stepped = await seedAbandonedMock("stepped", { botTeams: 2, pickSeconds: 30 });
    const store = testStore();
    await store.startDraft(stepped.draftId);
    const advancer = testAdvancer(store);
    for (let second = 1; second <= 120; second += 1) {
      await advancer.advance(stepped.draftId, atMs(second * 1000));
    }
    const steppedLog = await actionLog(stepped.draftId);
    expect((await store.getDraftState(stepped.draftId))!.phase).toBe("complete");

    // Same seeds, same ids' shapes, fresh tables: the one-shot catch-up.
    await truncateAll(db);
    now = BASE_NOW;
    const oneShot = await seedAbandonedMock("stepped", { botTeams: 2, pickSeconds: 30 });
    const store2 = testStore();
    await store2.startDraft(oneShot.draftId);
    now = atMs(120 * 1000);
    await testAdvancer(store2).advance(oneShot.draftId, now);
    const oneShotLog = await actionLog(oneShot.draftId);

    expect(oneShotLog).toEqual(steppedLog);
    expect(oneShotLog.length).toBeGreaterThan(1);
  });

  it("catch-up across a clock-tier tightening: each turn's clock derives from its own chained instant (fix round MEDIUM 4)", async () => {
    // A REAL draft (the full DRAFT_CLOCK_SCHEDULE, not a mock's single tier) whose abandonment
    // window straddles the 2-hours-before-kickoff tightening: kickoff sits 2h25m after the
    // start, so turns 1-3 run in the 10-minute tier (>2h out) and turn 4's chained start lands
    // INSIDE 2h — the tightened 90s clock. Stamping "now" instead of chaining would have judged
    // every turn against read time and given all six the tightened clock.
    const kickoffMs = Date.parse(BASE_NOW) + (2 * 60 + 25) * 60_000;
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_tier",
      leagueId: "league_tier",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(kickoffMs),
      auctionBudget: null,
    });
    await seedSprintPlayers();
    const store = testStore();
    await store.startDraft(fixture.draftId);

    now = atMs(60 * 60_000); // an hour of abandonment — every turn, both tiers, long overdue
    const outcome = await testAdvancer(store).advance(fixture.draftId, now);
    expect(outcome.applied).toBe(6);

    const log = await actionLog(fixture.draftId);
    expect(log.map((row) => row.action.type)).toEqual(["START_DRAFT", ...Array.from({ length: 6 }, () => "TIMER_EXPIRE")]);
    // Turns 1-3: 600s clocks (chained instants still >2h before kickoff). Turns 4-6: their
    // chained starts are inside 2h, so the TIGHTENED 90s clock prices their deadlines.
    const offsets = log.slice(1).map((row) => (Date.parse(row.action.timestamp) - Date.parse(BASE_NOW)) / 1000);
    expect(offsets).toEqual([600, 1200, 1800, 1890, 1980, 2070]);
    expect((await store.getDraftState(fixture.draftId))!.phase).toBe("complete");
  });

  it("stops at the action ceiling and reports exhaustion; the next call resumes from the log", async () => {
    const fixture = await seedAbandonedMock("bounded");
    const store = testStore();
    await store.startDraft(fixture.draftId);

    now = atMs(10 * 60_000);
    const advancer = testAdvancer(store, { maxActionsPerAdvance: 2 });
    const first = await advancer.advance(fixture.draftId, now);
    expect(first).toMatchObject({ applied: 2, exhausted: true });
    expect((await actionLog(fixture.draftId))).toHaveLength(3);

    const second = await advancer.advance(fixture.draftId, now);
    expect(second).toMatchObject({ applied: 2, exhausted: true });
    const third = await advancer.advance(fixture.draftId, now);
    expect(third).toMatchObject({ applied: 2, exhausted: false });
    expect((await store.getDraftState(fixture.draftId))!.phase).toBe("complete");
  });

  it("applies nothing while the clock is still running, and never throws for a draft that does not exist", async () => {
    const fixture = await seedAbandonedMock("idle");
    const store = testStore();
    await store.startDraft(fixture.draftId);

    now = atMs(30_000); // half the first 60s clock
    const outcome = await testAdvancer(store).advance(fixture.draftId, now);
    expect(outcome).toMatchObject({ applied: 0, exhausted: false });
    expect(await actionLog(fixture.draftId)).toHaveLength(1);

    const missing = await testAdvancer(store).advance("draft_never_existed", now);
    expect(missing).toMatchObject({ applied: 0 });
  });
});

describe("concurrent advancers (two readers reopening the same abandoned room)", () => {
  it("both serialize through the store's guards: one consistent log, strictly-once sequences, no throw", async () => {
    const fixture = await seedAbandonedMock("race");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    store.invalidate(fixture.draftId);

    now = atMs(10 * 60_000);
    // Two SEPARATE stores — separate caches, separate keyed mutexes — so the race is refereed by
    // the cross-instance guards (`drafts FOR UPDATE`, the in-lock replay, `admitCommand`'s
    // deadline re-check, the sequence unique index), not by the in-process queue.
    const [a, b] = await Promise.all([
      testAdvancer(testStore()).advance(fixture.draftId, now),
      testAdvancer(testStore()).advance(fixture.draftId, now),
    ]);

    const log = await actionLog(fixture.draftId);
    expect(log.map((row) => row.action.type)).toEqual(["START_DRAFT", ...Array.from({ length: 6 }, () => "TIMER_EXPIRE")]);
    // Strictly-once: sequences are unique and gapless regardless of which racer applied which.
    expect(log.map((row) => row.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    log.slice(1).forEach((row, i) => {
      expect(row.action.timestamp).toBe(atMs((i + 1) * 60_000));
    });
    // Between them the racers applied exactly the six due actions — a losing racer's duplicate
    // was refused harmlessly, never double-applied.
    expect(a.applied + b.applied).toBe(6);
    expect((await testStore().getDraftState(fixture.draftId))!.phase).toBe("complete");
  });
});

describe("deferred starts (the production incident: a room whose start nobody retried)", () => {
  it("starts a scheduled mock whose starts_at has passed — the solo-start-deferred-to-the-ticker retry now rides any read", async () => {
    const fixture = await seedAbandonedMock("deferred", { startsAtMs: Date.parse(BASE_NOW) - 60_000, botTeams: 2 });
    const store = testStore();

    const outcome = await testAdvancer(store).advance(fixture.draftId, now);
    expect(outcome.applied).toBeGreaterThanOrEqual(1);
    const state = (await store.getDraftState(fixture.draftId))!;
    expect(state.phase).toBe("in_progress");
    const [row] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, fixture.draftId));
    expect(row?.status).toBe("in_progress");
  });

  it("a deferred all-bot room reopened much later starts on the first advance and drafts through on the following ones", async () => {
    const fixture = await seedAbandonedMock("deferredlate", { startsAtMs: Date.parse(BASE_NOW) - 60_000, botTeams: 2, pickSeconds: 30 });
    const store = testStore();
    const advancer = testAdvancer(store);

    // The reader arrives 10 minutes after the room fell due. The start stamps at the moment it
    // finally runs (exactly what the live due scan would do — the log records when the room
    // REALLY began), so the bots' seeded think-delays run from there: the same call applies the
    // start, and the drivers' next ticks carry the picks.
    const reopenedAtMs = 10 * 60_000;
    now = atMs(reopenedAtMs);
    const first = await advancer.advance(fixture.draftId, now);
    expect(first).toMatchObject({ applied: 1, phase: "in_progress" });

    for (let step = 1; step <= 12 && (await store.getDraftState(fixture.draftId))!.phase !== "complete"; step += 1) {
      now = atMs(reopenedAtMs + step * 10_000);
      await advancer.advance(fixture.draftId, now);
    }
    const state = (await store.getDraftState(fixture.draftId))!;
    expect(state.phase).toBe("complete");
    expect(state.picks.every((pick) => !pick.auto)).toBe(true); // bots picked, nobody timed out
  });

  it("leaves a mock whose window has not fired untouched", async () => {
    const fixture = await seedAbandonedMock("notdue", { botTeams: 2 });
    const store = testStore();
    const outcome = await testAdvancer(store).advance(fixture.draftId, now);
    expect(outcome).toMatchObject({ applied: 0 });
    expect((await store.getDraftState(fixture.draftId))!.phase).toBe("scheduled");
  });

  it("starts a due, FULL public matchmade league through the real auto-start seam — and never touches a private league", async () => {
    const publicDue = await seedDraftFixture(db, {
      draftId: "draft_pub",
      leagueId: "league_pub",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) - 60_000),
      auctionBudget: null,
      isPublicMatchmade: true,
    });
    const privateDue = await seedDraftFixture(db, {
      draftId: "draft_priv",
      leagueId: "league_priv",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) - 60_000),
      auctionBudget: null,
      isPublicMatchmade: false,
    });
    await seedSprintPlayers();
    const store = testStore();
    const advancer = testAdvancer(store);

    const startedPublic = await advancer.advance(publicDue.draftId, now);
    expect(startedPublic.applied).toBeGreaterThanOrEqual(1);
    expect((await store.getDraftState(publicDue.draftId))!.phase).toBe("in_progress");

    const leftPrivate = await advancer.advance(privateDue.draftId, now);
    expect(leftPrivate).toMatchObject({ applied: 0 });
    expect((await store.getDraftState(privateDue.draftId))!.phase).toBe("scheduled");
  });

  it("never starts a due public league that is still short a seat", async () => {
    const short = await seedDraftFixture(db, {
      draftId: "draft_short",
      leagueId: "league_short",
      format: "snake",
      teamCount: 12,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) - 60_000),
      auctionBudget: null,
      isPublicMatchmade: true,
      filledTeams: 3,
    });
    await seedSprintPlayers();
    const store = testStore();
    const outcome = await testAdvancer(store).advance(short.draftId, now);
    expect(outcome).toMatchObject({ applied: 0 });
    expect((await store.getDraftState(short.draftId))!.phase).toBe("scheduled");
  });
});

describe("transient errors vs a missing draft (fix round HIGH 1: the tri-state outcome)", () => {
  it("a transient store failure reports outcome 'error' — distinct from not_found — and the next call succeeds", async () => {
    const fixture = await seedAbandonedMock("flaky");
    const real = testStore();
    await real.startDraft(fixture.draftId);

    let thrown = false;
    const flaky: DraftStore = {
      ...real,
      getDraftState: async (draftId) => {
        if (!thrown) {
          thrown = true;
          throw new Error("simulated transient DB failure");
        }
        return real.getDraftState(draftId);
      },
    };
    now = atMs(10 * 60_000);
    const advancer = createDraftAdvancer({ db, store: flaky, mockDriver: createMockBotDriver({ db, store: flaky }) });

    const first = await advancer.advance(fixture.draftId, now);
    expect(first.outcome).toBe("error");
    expect(first.applied).toBe(0);

    const second = await advancer.advance(fixture.draftId, now);
    expect(second.outcome).toBe("ok");
    expect(second.phase).toBe("complete");
  });

  it("a draft that does not exist is 'not_found', never 'error'", async () => {
    const outcome = await testAdvancer(testStore()).advance("draft_never_was", now);
    expect(outcome.outcome).toBe("not_found");
    expect(outcome.phase).toBeNull();
  });
});

describe("a wedged draft is visible (fix round MEDIUM 3)", () => {
  it("the refusal breaker with due work still pending logs one distinguishing structured line and flags the outcome", async () => {
    // A board that can genuinely wedge: only QBs — enough to pass reduceStart's COUNT guard
    // (6 players for 6 slots), but once every QB slot is filled the next expiry's autopick
    // finds no eligible player and the store refuses — forever.
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_wedge",
      leagueId: "league_wedge",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
      isMock: true,
      botTeams: 0,
      mockPickSeconds: 60,
    });
    // Distinct ids from `seedSprintPlayers` — the benign half of this test seeds those too.
    await db.insert(players).values(
      Array.from({ length: 6 }, (_, i) => ({ id: `wqb${i + 1}`, name: `Wedge QB ${i + 1}`, position: "QB" as const, nflTeam: "KC" })),
    );
    const store = testStore();
    await store.startDraft(fixture.draftId);

    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      now = atMs(10 * 60_000);
      const outcome = await testAdvancer(store).advance(fixture.draftId, now);
      // Both QB slots autopicked, then the wedge: due work remains, refused twice.
      expect(outcome.applied).toBe(2);
      expect(outcome.wedged).toBe(true);
      expect(outcome.outcome).toBe("ok");
      const wedgedLines = errorLog.mock.calls.filter((call) => String(call[0]).includes("advance wedged"));
      expect(wedgedLines).toHaveLength(1);
      const detail = wedgedLines[0]![1] as { draftId: string; reason: string; dueWork: string };
      expect(detail.draftId).toBe(fixture.draftId);
      expect(detail.reason).toContain("No eligible player");
      expect(detail.dueWork).toContain("expire");
    } finally {
      errorLog.mockRestore();
    }

    // The benign nothing-due path never wears the wedged label.
    const idle = await seedAbandonedMock("notwedged");
    const idleStore = testStore();
    await idleStore.startDraft(idle.draftId);
    const quiet = await testAdvancer(idleStore).advance(idle.draftId, now);
    expect(quiet.wedged).toBe(false);
  });
});

describe("dissolved drafts are terminal (fix round MEDIUM 2)", () => {
  it("advance treats a dissolved draft as not_found and applies nothing, even with an in_progress log behind it", async () => {
    const fixture = await seedAbandonedMock("dissolved");
    const store = testStore();
    await store.startDraft(fixture.draftId);
    await db.update(drafts).set({ status: "dissolved" }).where(eq(drafts.id, fixture.draftId));

    now = atMs(10 * 60_000);
    const outcome = await testAdvancer(store).advance(fixture.draftId, now);
    expect(outcome.outcome).toBe("not_found");
    expect(outcome.applied).toBe(0);
    expect(await actionLog(fixture.draftId)).toHaveLength(1); // the START_DRAFT only — no expiry ever landed
  });

  it("draftLoopTarget gates the SSE loop: live drafts watched, complete and dissolved never", async () => {
    const live = await seedAbandonedMock("looklive");
    expect(await draftLoopTarget(db, live.leagueId)).toBe(live.draftId);

    await db.update(drafts).set({ status: "dissolved" }).where(eq(drafts.id, live.draftId));
    expect(await draftLoopTarget(db, live.leagueId)).toBeNull();

    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.id, live.draftId));
    expect(await draftLoopTarget(db, live.leagueId)).toBeNull();

    expect(await draftLoopTarget(db, "league_without_draft")).toBeNull();
  });
});

describe("runDraftAdvanceLoop (the SSE watcher's tick)", () => {
  it("keeps ticking through a transient error and succeeds later — one log per error streak, never per tick (the reviewer's repro)", async () => {
    vi.useFakeTimers();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const script: ("error" | "ok")[] = ["error", "error", "ok", "ok"];
      const phases: ("in_progress" | "complete")[] = ["in_progress", "complete"];
      const advance = vi.fn(async (draftId: string) => {
        const kind = script.shift() ?? "ok";
        if (kind === "error") return { draftId, applied: 0, exhausted: false, phase: null, outcome: "error" as const, wedged: false };
        return { draftId, applied: 1, exhausted: false, phase: phases.shift() ?? ("complete" as const), outcome: "ok" as const, wedged: false };
      });
      const controller = new AbortController();
      runDraftAdvanceLoop("draft_flaky_loop", controller.signal, { advance, clock, intervalMs: 1_000 });

      await vi.advanceTimersByTimeAsync(10_000);
      // The two transient errors did NOT kill the loop: the later ok ticks ran, and the loop
      // stopped itself only on completion.
      expect(advance.mock.calls.length).toBe(4);
      // One structured line for the whole error streak, not one per erroring tick.
      expect(errorLog.mock.calls.filter((call) => String(call[0]).includes("advance loop"))).toHaveLength(1);
    } finally {
      errorLog.mockRestore();
      vi.useRealTimers();
    }
  });

  it("stops on not_found — a vanished draft holds no timer open", async () => {
    vi.useFakeTimers();
    try {
      const advance = vi.fn(async (draftId: string) => ({
        draftId,
        applied: 0,
        exhausted: false,
        phase: null,
        outcome: "not_found" as const,
        wedged: false,
      }));
      const controller = new AbortController();
      runDraftAdvanceLoop("draft_vanished", controller.signal, { advance, clock, intervalMs: 1_000 });
      await vi.advanceTimersByTimeAsync(5_000);
      expect(advance.mock.calls.length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("advances on the interval while connected, never overlaps, and stops cleanly on abort", async () => {
    vi.useFakeTimers();
    try {
      const calls: string[] = [];
      let release: (() => void) | null = null;
      const advance = vi.fn(async (draftId: string) => {
        calls.push(draftId);
        // The first call blocks until released — interval fires during it must be skipped.
        if (calls.length === 1) await new Promise<void>((resolve) => (release = resolve));
        return { draftId, applied: 0, exhausted: false, phase: "in_progress" as const, outcome: "ok" as const, wedged: false };
      });
      const controller = new AbortController();
      runDraftAdvanceLoop("draft_loop", controller.signal, { advance, clock, intervalMs: 1_000 });

      await vi.advanceTimersByTimeAsync(3_000);
      expect(calls).toHaveLength(1); // still in flight: the overlap guard skipped two fires
      release!();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(calls.length).toBeGreaterThanOrEqual(2);

      const settled = calls.length;
      controller.abort();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(calls.length).toBe(settled); // no tick after disconnect
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops itself once the draft completes (or vanishes) — a finished room holds no timer open", async () => {
    vi.useFakeTimers();
    try {
      const phases: ("in_progress" | "complete")[] = ["in_progress", "complete"];
      const advance = vi.fn(async (draftId: string) => ({
        draftId,
        applied: 0,
        exhausted: false,
        phase: phases.shift() ?? "complete",
        outcome: "ok" as const,
        wedged: false,
      }));
      const controller = new AbortController();
      runDraftAdvanceLoop("draft_done", controller.signal, { advance, clock, intervalMs: 1_000 });

      await vi.advanceTimersByTimeAsync(10_000);
      // First interval tick sees in_progress, second sees complete and stops the loop.
      expect(advance.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
