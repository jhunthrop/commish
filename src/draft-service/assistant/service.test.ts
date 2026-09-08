import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@/db/schema";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { getDraftStore } from "@/draft-service";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { simulateRoomOdds } from "../sim/room-odds";
import { ADVISOR_CONFIG } from "./config";
import { resetAdvisorMemoForTests } from "./memo";
import { recommendNow } from "./recommend";
import { advisorFor, warmAdvisorRoom } from "./service";

const db = createTestDb();
const DRAFT_ID = "draft_advisor_service";

async function fixture() {
  const f = await seedDraftFixture(db, {
    draftId: DRAFT_ID, leagueId: "league_advisor_service", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  const asOf = new Date("2026-09-01T00:00:00.000Z");
  const positions = ["QB", "RB", "WR", "QB", "RB", "WR"] as const;
  await db.insert(nflPlayers).values(positions.map((position, i) => ({ id: `nfl-p${i}`, name: `Player ${i}`, position })));
  await db.insert(players).values(positions.map((position, i) => ({ id: `p${i}`, name: `Player ${i}`, position, nflTeam: "SF" })));
  await db.insert(playerCrosswalk).values(positions.map((_, i) => ({ playerId: `p${i}`, nflPlayerId: `nfl-p${i}`, method: "espn_id", resolvedAt: new Date() })));
  await db.insert(preseasonProjections).values(
    positions.map((position, i) => ({
      season: PRODUCT_SEASON, source: BOARD_SOURCE, playerId: `nfl-p${i}`, rank: i + 1, positionRank: 1, projectedPoints: 300 - i * 10,
      valueOverReplacement: 0, valueRank: i + 1, expectedGames: 17, floorPoints: 0, medianPoints: 0, ceilingPoints: 0, tier: 0, asOf,
    })),
  );
  const started = await getDraftStore().startDraft(DRAFT_ID);
  if (!started.ok) throw new Error(started.reason);
  const userFor = (teamId: string) => f.userIds[f.teamIds.indexOf(teamId)]!;
  return { onClockUser: userFor(started.state.draftOrder[0]!), waitingUser: userFor(started.state.draftOrder[1]!) };
}

beforeEach(async () => {
  await truncateAll(db);
  getDraftStore().invalidate(DRAFT_ID);
  resetAdvisorMemoForTests();
});

describe("advisorFor", () => {
  it("simulates one room state once, serves a second viewer from the same table, and recommends once per viewer per state", async () => {
    const { onClockUser, waitingUser } = await fixture();
    const simulate = vi.fn(simulateRoomOdds);
    const recommend = vi.fn(recommendNow);
    const first = await advisorFor(db, DRAFT_ID, onClockUser, { simulate, recommend });
    const second = await advisorFor(db, DRAFT_ID, waitingUser, { simulate, recommend });
    const again = await advisorFor(db, DRAFT_ID, waitingUser, { simulate, recommend });
    expect(simulate).toHaveBeenCalledTimes(1);
    // The on-clock seat's own shortlist is computed once for the R-3 exclusion inside the room
    // facts and once as its card; the waiting seat once, its second request served from memory.
    expect(recommend).toHaveBeenCalledTimes(2);
    expect(again).toEqual(second);
    expect(first!.onTheClock).toBe(true);
    expect(second!.onTheClock).toBe(false);
    expect(second!.pickNumber).toBe(2);
    expect(first!.odds!.runs).toBeGreaterThan(0);
    expect(second!.odds!.pickNumber).toBe(2);
    expect(first!.pick!.playerId).toMatch(/^p\d$/);
    // One depth for every seat: the memoised shortlist is the ten the tab's selector can show,
    // so a selector change never costs a second request.
    for (const call of recommend.mock.calls) expect(call[0].shortlistSize).toBe(ADVISOR_CONFIG.shortlistSize);
    expect(first!.candidates[0]!.playerId).toBe(first!.pick!.playerId);
    expect(first!.candidates.length).toBeGreaterThan(1);
    expect(first!.signals).toEqual({ run: null, collapses: expect.any(Array) });
  });

  it("warmAdvisorRoom computes the room facts for the current state ahead of any viewer, so the viewer's own request simulates nothing", async () => {
    const { onClockUser } = await fixture();
    const simulate = vi.fn(simulateRoomOdds);
    await warmAdvisorRoom(db, DRAFT_ID, { simulate });
    expect(simulate).toHaveBeenCalledTimes(1);
    const view = await advisorFor(db, DRAFT_ID, onClockUser, { simulate });
    expect(view).not.toBeNull();
    expect(simulate).toHaveBeenCalledTimes(1);
    // Warming again for the same sequence is free, and a draft that does not exist is a no-op.
    await warmAdvisorRoom(db, DRAFT_ID, { simulate });
    await warmAdvisorRoom(db, "no_such_draft", { simulate });
    expect(simulate).toHaveBeenCalledTimes(1);
  });

  it("is null for a member with no seat and before the draft runs", async () => {
    const { onClockUser } = await fixture();
    expect(await advisorFor(db, DRAFT_ID, "stranger")).toBeNull();
    getDraftStore().invalidate(DRAFT_ID);
    expect(await advisorFor(db, "no_such_draft", onClockUser)).toBeNull();
  });
});
