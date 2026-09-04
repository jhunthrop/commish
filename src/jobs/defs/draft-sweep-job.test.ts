import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, players } from "@/db/schema";
import type { Clock } from "@/domain/timing";
import { createDraftAdvancer } from "@/draft-service/advance";
import { createDraftStore, type DraftStore } from "@/draft-service/store";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { createMockBotDriver } from "@/mock-draft-service/driver";
import { JOB_DEFINITIONS } from "../registry";
import { SCHEDULES } from "../schedules";
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
    advance: createDraftAdvancer({ db, store, mockDriver: createMockBotDriver({ db, store }) }).advance,
    newId: () => crypto.randomUUID(),
    maxActions,
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
