import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { players } from "@/db/schema";
import { createTestDb, truncateAll, truncateJobTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { createDraftAdvancer, type AdvanceOutcome } from "@/draft-service/advance";
import type { DraftPacer } from "@/draft-service/pacing";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { createMockBotDriver } from "@/mock-draft-service/driver";
import { JOB_DEFINITIONS } from "../registry";
import { DRAFT_ADVANCE_JOB_NAME, draftAdvanceIdempotencyKey, draftAdvanceJob, DraftAdvanceTransientError, parseDraftAdvanceJobPayload, runDraftAdvanceStep, type DraftAdvanceJobDeps } from "./draft-advance-job";

const db = createTestDb();
const BASE_NOW = "2026-09-01T00:00:00.000Z";
let now = BASE_NOW;
const clock: Clock = { now: () => now };
const atMs = (offsetMs: number): string => new Date(Date.parse(BASE_NOW) + offsetMs).toISOString();

function testStore(): DraftStore {
  return createDraftStore({ db, publish: async () => "0-0", clock });
}

function recordingPacer() {
  const paced: AdvanceOutcome[] = [];
  const pacer: DraftPacer = {
    pace: async () => ({ kind: "nothing-due" }),
    paceFromOutcome: async (outcome) => {
      paced.push(outcome);
      return { kind: "scheduled", jobId: 1, dueAt: atMs(1_000), retired: 0 };
    },
  };
  return { pacer, paced };
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

function depsFor(store: DraftStore, overrides: Partial<DraftAdvanceJobDeps> = {}): DraftAdvanceJobDeps & { readonly published: number[]; readonly paced: AdvanceOutcome[] } {
  const { pacer, paced } = recordingPacer();
  const published: number[] = [];
  return {
    store,
    advance: createDraftAdvancer({ db, store, mockDriver: createMockBotDriver({ db, store }) }).advance,
    pacer,
    publishFacts: async (state) => { published.push(state.sequence); },
    clock,
    ...overrides,
    published,
    paced,
  };
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateJobTables(db);
  now = BASE_NOW;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("the draft-advance job", () => {
  it("is registered, shaped as one step, retries briefly, and keys by draft and sequence", () => {
    expect(JOB_DEFINITIONS.get(DRAFT_ADVANCE_JOB_NAME)).toBe(draftAdvanceJob);
    expect(draftAdvanceJob.stepNames).toEqual(["advance"]);
    expect(draftAdvanceJob.maxAttempts).toBe(3);
    expect(draftAdvanceJob.backoff.maxMs).toBeLessThanOrEqual(5_000);
    expect(draftAdvanceIdempotencyKey("d1", 7)).toBe("draft-advance:d1@7");
  });

  it("parses its payload at the boundary and refuses garbage", () => {
    expect(parseDraftAdvanceJobPayload({ draftId: "d1", sequence: 3 })).toEqual({ draftId: "d1", sequence: 3 });
    expect(() => parseDraftAdvanceJobPayload({ draftId: "", sequence: 3 })).toThrow(/draftId/);
    expect(() => parseDraftAdvanceJobPayload({ draftId: "d1", sequence: -1 })).toThrow(/sequence/);
    expect(() => parseDraftAdvanceJobPayload({ draftId: "d1", sequence: "3" })).toThrow(/sequence/);
  });

  it("applies the due work through the one advance routine, paces the next from the outcome, then publishes the facts for the new state", async () => {
    const fixture = await seedMock("job", 2);
    const store = testStore();
    const started = await store.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);
    const deps = depsFor(store);
    now = atMs(60_000);
    const outcome = await runDraftAdvanceStep({ draftId: fixture.draftId, sequence: started.state.sequence }, deps);
    expect(outcome.summary).toMatch(/applied \d+/);
    expect(deps.paced).toHaveLength(1);
    expect(deps.paced[0]!.applied).toBeGreaterThan(0);
    const fresh = (await store.getDraftState(fixture.draftId))!;
    expect(deps.published).toEqual(fresh.phase === "in_progress" ? [fresh.sequence] : []);
  });

  it("a superseded job (the log moved past its sequence) and a gone draft are quiet no-ops: no advance, no pace, no facts", async () => {
    const fixture = await seedMock("superseded", 2);
    const store = testStore();
    const started = await store.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);
    const advance = vi.fn(createDraftAdvancer({ db, store, mockDriver: createMockBotDriver({ db, store }) }).advance);
    const deps = depsFor(store, { advance });
    const stale = await runDraftAdvanceStep({ draftId: fixture.draftId, sequence: started.state.sequence - 1 }, deps);
    expect(stale.summary).toMatch(/superseded/);
    const gone = await runDraftAdvanceStep({ draftId: "draft_nowhere", sequence: 1 }, deps);
    expect(gone.summary).toMatch(/gone/);
    expect(advance).not.toHaveBeenCalled();
    expect(deps.paced).toEqual([]);
    expect(deps.published).toEqual([]);
  });

  it("a transient advance error is thrown as retryable, so the executor backs off rather than dead-lettering", async () => {
    const fixture = await seedMock("transient", 2);
    const store = testStore();
    const started = await store.startDraft(fixture.draftId);
    if (!started.ok) throw new Error(started.reason);
    const failing = async (draftId: string): Promise<AdvanceOutcome> => ({ draftId, applied: 0, exhausted: false, phase: null, outcome: "error", wedged: false, nextDueAt: null, sequence: null });
    const deps = depsFor(store, { advance: failing });
    await expect(runDraftAdvanceStep({ draftId: fixture.draftId, sequence: started.state.sequence }, deps)).rejects.toBeInstanceOf(DraftAdvanceTransientError);
    expect(deps.paced).toEqual([]);
  });
});
