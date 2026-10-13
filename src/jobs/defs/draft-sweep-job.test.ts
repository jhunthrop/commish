import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research-ts/db/schema";
import { drafts } from "@/db/schema";
import type { Clock } from "@research-ts/domain/timing";
import { createDraftAdvancer } from "@/draft-service/advance";
import { DRAFT_ADVANCE_CONFIG } from "@/draft-service/config";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { createMockBotDriver } from "@/mock-draft-service/driver";
import { JOBS_CONFIG } from "../config";
import { JOB_DEFINITIONS } from "../registry";
import { SCHEDULES } from "../schedules";
import { createMemoryWakeSet, WAKE_MEMBERS, wakeMember } from "../wake";
import { DRAFT_SWEEP_JOB_NAME, draftSweepJob, sweepDrafts } from "./draft-sweep-job";

const db = createTestDb();

const BASE_NOW = "2026-09-01T00:00:00.000Z";
let now = BASE_NOW;
const clock: Clock = { now: () => now };

function testStore(): DraftStore {
  return createDraftStore({ db, publish: async () => "0-0", clock });
}

function sweepContext(store: DraftStore, maxActions?: number) {
  return {
    db,
    clock,
    store,
    advance: createDraftAdvancer({ db, store, mockDriver: createMockBotDriver({ db }) }).advance,
    newId: () => crypto.randomUUID(),
    maxActions,
    // The two lanes carried over from the dev ticker, stubbed: these tests are about the drafts.
    reconcileHouse: async () => ({ opened: [], retired: [], refused: [] }),
    sweepMocks: async () => [],
  };
}

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

beforeEach(async () => {
  await truncateAll(db);
  now = BASE_NOW;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("the draft-sweep job (driver 3 — the backstop for rooms nobody is watching)", () => {
  it("is registered, scheduled every minute with a short catch-up window, and shaped as one bounded step", () => {
    expect(JOB_DEFINITIONS.get(DRAFT_SWEEP_JOB_NAME)).toBe(draftSweepJob);
    expect(draftSweepJob.stepNames).toEqual(["sweep"]);
    const schedule = SCHEDULES.find((entry) => entry.job === DRAFT_SWEEP_JOB_NAME);
    expect(schedule).toBeDefined();
    expect(schedule!.cron).toBe("* * * * *");
    // Level-triggered: a slept-through backlog must never replay as a queue of no-ops.
    expect(schedule!.catchUpMs).toBeDefined();
    expect(schedule!.catchUpMs!).toBeLessThanOrEqual(10 * 60_000);
    // Neon cost audit finding 1: the minute fire is held behind the wake gate.
    expect(schedule!.gate).toBe("draft-attention");
  });

  it("writes what it learned into the wake set: each live draft's next deadline, the earliest future kickoff, the safety marker", async () => {
    const live = await seedDraftFixture(db, {
      draftId: "draft_sw_wake",
      leagueId: "league_sw_wake",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
      isMock: true,
      botTeams: 0,
      mockPickSeconds: 60,
    });
    await seedDraftFixture(db, {
      draftId: "draft_sw_future",
      leagueId: "league_sw_future",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 2 * 60 * 60_000),
      auctionBudget: null,
    });
    await seedSprintPlayers();
    const store = testStore();
    await store.startDraft(live.draftId); // first 60s clock runs from BASE_NOW

    now = new Date(Date.parse(BASE_NOW) + 30_000).toISOString();
    const wake = createMemoryWakeSet();
    await sweepDrafts({ ...sweepContext(store), wake });

    const membersAt = async (offsetMs: number) => (await wake.due(Date.parse(BASE_NOW) + offsetMs)).members;
    expect(await membersAt(59_999)).toEqual([]);
    expect(await membersAt(60_000)).toEqual([wakeMember.draft(live.draftId)]);
    // The 24h mock kickoff is the same row's own kickoff; the real league's 2h kickoff is earliest.
    expect(await membersAt(2 * 60 * 60_000)).toContain(WAKE_MEMBERS.scheduledDrafts);
    expect(await membersAt(2 * 60 * 60_000 - 1)).not.toContain(WAKE_MEMBERS.scheduledDrafts);
    expect(await membersAt(30_000 + JOBS_CONFIG.sweepMaxQuietMs)).toContain(WAKE_MEMBERS.sweepSafety);
    expect(await membersAt(30_000 + JOBS_CONFIG.sweepMaxQuietMs - 1)).not.toContain(WAKE_MEMBERS.sweepSafety);
  });

  it("stops before a draft it has no time left for, registering it as due now, so the attempt timeout is never reached (item 4)", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sw_time",
      leagueId: "league_sw_time",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
      isMock: true,
      botTeams: 0,
      mockPickSeconds: 60,
    });
    await seedSprintPlayers();
    const store = testStore();
    await store.startDraft(fixture.draftId);
    now = new Date(Date.parse(BASE_NOW) + 10 * 60_000).toISOString();
    const wake = createMemoryWakeSet();
    // The executor's cut-off is closer than the reserve: no draft is started.
    const outOfTime = await sweepDrafts({ ...sweepContext(store), wake, deadlineAt: new Date(Date.parse(now) + DRAFT_ADVANCE_CONFIG.sweepReserveMs - 1) });
    expect(outOfTime.summary).toContain("0 actions across 0 of 1 live drafts");
    expect(outOfTime.summary).toContain("budget hit");
    expect((await wake.due(Date.parse(now))).members).toContain(wakeMember.draft(fixture.draftId));
    expect((await store.getDraftState(fixture.draftId))!.phase).toBe("in_progress");
    // With time to spare, the same sweep takes it.
    const inTime = await sweepDrafts({ ...sweepContext(store), wake: createMemoryWakeSet(), deadlineAt: new Date(Date.parse(now) + 60_000) });
    expect(inTime.summary).toContain("6 actions across 1 of 1 live drafts");
  });

  it("forgets a finished draft and names no kickoff once nothing is scheduled", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sw_forget",
      leagueId: "league_sw_forget",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
      isMock: true,
      botTeams: 0,
      mockPickSeconds: 60,
    });
    await seedSprintPlayers();
    const store = testStore();
    await store.startDraft(fixture.draftId);
    const wake = createMemoryWakeSet();
    await wake.add(wakeMember.draft(fixture.draftId), Date.parse(BASE_NOW));
    await wake.add(WAKE_MEMBERS.scheduledDrafts, Date.parse(BASE_NOW));

    now = new Date(Date.parse(BASE_NOW) + 10 * 60_000).toISOString();
    await sweepDrafts({ ...sweepContext(store), wake });
    expect((await store.getDraftState(fixture.draftId))!.phase).toBe("complete");
    const farFuture = await wake.due(Date.parse(BASE_NOW) + 365 * 24 * 60 * 60_000);
    expect(farFuture.members).toEqual([WAKE_MEMBERS.sweepSafety]);
  });

  it("one sweep starts a due mock room AND advances an abandoned in-progress draft to completion", async () => {
    // An all-human mock started and then abandoned: six 60s clocks owed.
    const abandoned = await seedDraftFixture(db, {
      draftId: "draft_sw_gone",
      leagueId: "league_sw_gone",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
      isMock: true,
      botTeams: 0,
      mockPickSeconds: 60,
    });
    await seedSprintPlayers();
    const store = testStore();
    await store.startDraft(abandoned.draftId);

    // A solo-style room whose deferred start nobody ever retried (the incident).
    const deferred = await seedDraftFixture(db, {
      draftId: "draft_sw_due",
      leagueId: "league_sw_due",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) - 60_000),
      auctionBudget: null,
      isMock: true,
      botTeams: 2,
      mockPickSeconds: 30,
    });

    now = new Date(Date.parse(BASE_NOW) + 10 * 60_000).toISOString();
    const outcome = await sweepDrafts(sweepContext(store));
    expect(outcome.summary).toContain("sweep");

    const abandonedState = (await store.getDraftState(abandoned.draftId))!;
    expect(abandonedState.phase).toBe("complete");
    const [settled] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, abandoned.draftId));
    expect(settled?.status).toBe("complete");

    const [deferredRow] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, deferred.draftId));
    expect(deferredRow?.status).toBe("in_progress");
  });

  it("surfaces a wedged draft in the step detail so the admin jobs page shows it (fix round MEDIUM 3)", async () => {
    // Only QBs (six, passing reduceStart's count guard): after both QB slots fill, every
    // further expiry's autopick is refused and the advance breaker trips wedged.
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sw_wedge",
      leagueId: "league_sw_wedge",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
      isMock: true,
      botTeams: 0,
      mockPickSeconds: 60,
    });
    await db.insert(players).values([
      { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
      { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
      { id: "qb3", name: "QB Three", position: "QB", nflTeam: "KC" },
      { id: "qb4", name: "QB Four", position: "QB", nflTeam: "KC" },
      { id: "qb5", name: "QB Five", position: "QB", nflTeam: "KC" },
      { id: "qb6", name: "QB Six", position: "QB", nflTeam: "KC" },
    ]);
    const store = testStore();
    await store.startDraft(fixture.draftId);

    now = new Date(Date.parse(BASE_NOW) + 10 * 60_000).toISOString();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const outcome = await sweepDrafts(sweepContext(store));
      expect(outcome.summary).toContain("WEDGED");
      expect(outcome.detail.some((line) => line.includes(`wedged: ${fixture.draftId}`))).toBe(true);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("bounds its work per tick: the action budget stops the sweep, and the next sweep resumes from the log", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_sw_budget",
      leagueId: "league_sw_budget",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date(Date.parse(BASE_NOW) + 24 * 60 * 60 * 1000),
      auctionBudget: null,
      isMock: true,
      botTeams: 0,
      mockPickSeconds: 60,
    });
    await seedSprintPlayers();
    const store = testStore();
    await store.startDraft(fixture.draftId);

    now = new Date(Date.parse(BASE_NOW) + 10 * 60_000).toISOString();
    await sweepDrafts(sweepContext(store, 2));
    expect((await store.getDraftState(fixture.draftId))!.picks).toHaveLength(2);

    await sweepDrafts(sweepContext(store, 2));
    await sweepDrafts(sweepContext(store, 2));
    expect((await store.getDraftState(fixture.draftId))!.phase).toBe("complete");
  });
});
