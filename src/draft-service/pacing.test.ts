import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { jobs, players } from "@/db/schema";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { currentDeadline, teamOnClock } from "@/draft-engine";
import { DRAFT_ADVANCE_JOB_NAME, draftAdvanceIdempotencyKey } from "@/jobs/defs/draft-advance-job";
import type { SelfWake } from "@/jobs/self-wake";
import { createMemoryWakeSet, wakeMember } from "@/jobs/wake";
import { createMockBotDriver } from "@/mock-draft-service/driver";
import { createDraftAdvancer } from "./advance";
import { createDraftPacer, NO_OP_PACER, pacingEnabledIn, pendingPacingJobs } from "./pacing";
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

function recordingWake(): SelfWake & { readonly calls: { jobId: number; dueAtMs: number }[] } {
  const calls: { jobId: number; dueAtMs: number }[] = [];
  return { calls, wake: (jobId, dueAtMs) => { calls.push({ jobId, dueAtMs }); } };
}

async function seedMock(id: string, botTeams: number) {
  const fixture = await seedDraftFixture(db, {
    draftId: `draft_${id}`, leagueId: `league_${id}`, format: "snake", teamCount: 2, slotConfig: SPRINT_ROSTER_SLOTS,
    kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000), auctionBudget: null, isMock: true, botTeams, mockPickSeconds: 30,
  });
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  return fixture;
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
  now = BASE_NOW;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("pacingEnabledIn", () => {
  it("paces on Vercel or where a self URL says so, never under the dev ticker", () => {
    expect(pacingEnabledIn({ VERCEL: "1" })).toBe(true);
    expect(pacingEnabledIn({ JOBS_SELF_URL: "http://localhost:3151" })).toBe(true);
    expect(pacingEnabledIn({})).toBe(false);
    expect(pacingEnabledIn({ VERCEL: "", JOBS_SELF_URL: "" })).toBe(false);
  });
});

describe("the pacer", () => {
  it("a bot on the clock: one job at its seeded due instant, keyed by the sequence, registered in the wake set and self-woken; asked again, already scheduled", async () => {
    const fixture = await seedMock("pace", 2);
    const store = testStore();
    const started = await store.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);
    const mockDriver = createMockBotDriver({ db, store });
    const wake = createMemoryWakeSet();
    const selfWake = recordingWake();
    const pacer = createDraftPacer({ db, clock, mockDriver, wake, selfWake });

    const due = (await mockDriver.dueBotPick(started.state))!;
    const expectedMs = Math.ceil(due.dueAtMs);
    const paced = await pacer.pace(started.state);
    expect(paced.kind).toBe("scheduled");
    if (paced.kind !== "scheduled") throw new Error("unreachable");
    expect(paced.dueAt).toBe(new Date(expectedMs).toISOString());
    expect(paced.retired).toBe(0);
    const [row] = await db.select().from(jobs).where(eq(jobs.id, paced.jobId));
    expect(row).toMatchObject({ name: DRAFT_ADVANCE_JOB_NAME, idempotencyKey: draftAdvanceIdempotencyKey(fixture.draftId, started.state.sequence), status: "pending", payload: { draftId: fixture.draftId, sequence: started.state.sequence } });
    expect(row!.runAt.getTime()).toBe(expectedMs);
    expect((await wake.due(expectedMs)).members).toContain(wakeMember.job(paced.jobId));
    expect(selfWake.calls).toEqual([{ jobId: paced.jobId, dueAtMs: expectedMs }]);

    expect(await pacer.pace(started.state)).toEqual({ kind: "already-scheduled", dueAt: paced.dueAt });
    expect(selfWake.calls).toHaveLength(1);
  });

  it("a human on the clock: the deadline; and pacing a newer sequence retires the older pending job", async () => {
    const fixture = await seedMock("human", 1);
    const store = testStore();
    const started = await store.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);
    const mockDriver = createMockBotDriver({ db, store });
    const selfWake = recordingWake();
    const pacer = createDraftPacer({ db, clock, mockDriver, wake: createMemoryWakeSet(), selfWake });
    // Whichever seat is up first, drive until a HUMAN holds the clock.
    let state = started.state;
    const advancer = createDraftAdvancer({ db, store, mockDriver });
    while ((await mockDriver.dueBotPick(state)) !== null) {
      now = atMs(60_000);
      await advancer.advance(fixture.draftId, now, { maxActions: 1, followThrough: false });
      state = (await store.getDraftState(fixture.draftId))!;
    }
    expect(teamOnClock(state)).not.toBeNull();
    const first = await pacer.pace(state);
    expect(first.kind).toBe("scheduled");
    if (first.kind !== "scheduled") throw new Error("unreachable");
    expect(first.dueAt).toBe(currentDeadline(state));

    // The human picks: the next sequence is paced, and the deadline job it beat is retired.
    const picked = await store.applyAction(fixture.draftId, { v: 1, type: "MAKE_PICK", timestamp: now, teamId: teamOnClock(state)!, playerId: state.pool.find((p) => !state.picks.some((pick) => pick.playerId === p.playerId))!.playerId });
    if (!picked.ok) throw new Error(picked.reason);
    const second = await pacer.pace(picked.state);
    expect(second.kind).toBe("scheduled");
    if (second.kind !== "scheduled") throw new Error("unreachable");
    expect(second.retired).toBe(1);
    const [old] = await db.select({ status: jobs.status }).from(jobs).where(eq(jobs.id, first.jobId));
    expect(old?.status).toBe("succeeded");
    const chains = await pendingPacingJobs(db);
    expect(chains.get(fixture.draftId)?.runAt.toISOString()).toBe(second.dueAt);
  });

  it("nothing is due for a finished or a not-yet-started room, and the no-op pacer paces nothing", async () => {
    const fixture = await seedMock("done", 2);
    const store = testStore();
    const started = await store.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);
    const pacer = createDraftPacer({ db, clock, mockDriver: createMockBotDriver({ db, store }), wake: createMemoryWakeSet(), selfWake: recordingWake() });
    expect(await pacer.pace({ ...started.state, phase: "complete" })).toEqual({ kind: "nothing-due" });
    expect(await pacer.paceFromOutcome({ draftId: fixture.draftId, applied: 0, exhausted: false, phase: "in_progress", outcome: "ok", wedged: false, nextDueAt: null, sequence: 1 })).toEqual({ kind: "nothing-due" });
    expect(await pacer.paceFromOutcome({ draftId: fixture.draftId, applied: 0, exhausted: false, phase: null, outcome: "error", wedged: false, nextDueAt: null, sequence: null })).toEqual({ kind: "nothing-due" });
    const fromOutcome = await pacer.paceFromOutcome({ draftId: fixture.draftId, applied: 1, exhausted: false, phase: "in_progress", outcome: "ok", wedged: false, nextDueAt: atMs(700), sequence: 2 });
    expect(fromOutcome.kind).toBe("scheduled");
    expect(await NO_OP_PACER.pace(started.state)).toEqual({ kind: "nothing-due" });
    expect(await db.select().from(jobs)).toHaveLength(1);
  });
});
