import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { DRAFT_CLOCK_SCHEDULE, DRAFT_PAUSE_WINDOW } from "@/draft-engine";
import { loadDraftConfig } from "./setup";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("loadDraftConfig", () => {
  it("returns null for a draft that doesn't exist", async () => {
    expect(await loadDraftConfig(db, "draft_ghost")).toBeNull();
  });

  it("carries the deploy's clock schedule AND its pause window beside it — the same kind of tunable, injected the same way", async () => {
    const fixture = await seedDraftFixture(db, {
      draftId: "draft_setup_1",
      leagueId: "league_setup_1",
      format: "snake",
      teamCount: 2,
      slotConfig: SPRINT_ROSTER_SLOTS,
      kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
      auctionBudget: null,
    });

    const config = await loadDraftConfig(db, fixture.draftId);
    expect(config).not.toBeNull();
    expect(config!.clockSchedule).toBe(DRAFT_CLOCK_SCHEDULE);
    expect(config!.pauseWindow).toBe(DRAFT_PAUSE_WINDOW);
    expect(config).toMatchObject({
      draftId: fixture.draftId,
      leagueId: fixture.leagueId,
      format: "snake",
      auctionBudget: null,
    });
  });
});
