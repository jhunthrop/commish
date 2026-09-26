import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

import { createTestDb, truncateAll } from "@/db/test-db";
import { nflPlayers, playerCrosswalk, players, preseasonProjections } from "@/db/schema";
import { BOARD_SOURCE } from "@/projections/preseason/board-store";
import { PRODUCT_SEASON } from "@/projections/preseason/current";
import { awaitDraftFollowThroughForTests, getDraftStore } from "@/draft-service";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "@/draft-service/test-support";
import { simulateRoomOdds } from "../sim/room-odds";
import { ADVISOR_CONFIG } from "./config";
import { createMemoryRoomFactsStore } from "./facts-store";
import { resetAdvisorMemoForTests } from "./memo";
import { recommendNow } from "./recommend";
import { advisorFor, publishRoomFacts, warmAdvisorRoom } from "./service";

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
  // The process-wide store's own follow-through (item 1) computes the start's facts at once
  // outside a request scope; these tests count THEIR simulate, so that entry is forgotten.
  await awaitDraftFollowThroughForTests();
  resetAdvisorMemoForTests();
  const userFor = (teamId: string) => f.userIds[f.teamIds.indexOf(teamId)]!;
  return { onClockUser: userFor(started.state.draftOrder[0]!), waitingUser: userFor(started.state.draftOrder[1]!) };
}

/** A fresh cross-process store per test: the default is the shared Redis, which the fixture's own
 *  follow-through writes to, and these tests count THEIR simulate. */
let facts = createMemoryRoomFactsStore();

beforeEach(async () => {
  await truncateAll(db);
  getDraftStore().invalidate(DRAFT_ID);
  resetAdvisorMemoForTests();
  facts = createMemoryRoomFactsStore();
});

describe("advisorFor", () => {
  it("simulates one room state once, serves a second viewer from the same table, and recommends once per viewer per state", async () => {
    const { onClockUser, waitingUser } = await fixture();
    const simulate = vi.fn(simulateRoomOdds);
    const recommend = vi.fn(recommendNow);
    const first = await advisorFor(db, DRAFT_ID, onClockUser, { simulate, recommend, facts });
    const second = await advisorFor(db, DRAFT_ID, waitingUser, { simulate, recommend, facts });
    const again = await advisorFor(db, DRAFT_ID, waitingUser, { simulate, recommend, facts });
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
    await warmAdvisorRoom(db, DRAFT_ID, { simulate, facts });
    expect(simulate).toHaveBeenCalledTimes(1);
    const view = await advisorFor(db, DRAFT_ID, onClockUser, { simulate, facts });
    expect(view).not.toBeNull();
    expect(simulate).toHaveBeenCalledTimes(1);
    // Warming again for the same sequence is free, and a draft that does not exist is a no-op.
    await warmAdvisorRoom(db, DRAFT_ID, { simulate, facts });
    await warmAdvisorRoom(db, "no_such_draft", { simulate, facts });
    expect(simulate).toHaveBeenCalledTimes(1);
  });

  it("publishRoomFacts computes for the state it is handed (the pick's own invocation, nothing re-read), and a viewer racing it shares the one in-flight compute (item 1)", async () => {
    const { onClockUser } = await fixture();
    const state = (await getDraftStore().getDraftState(DRAFT_ID))!;
    let release: (() => void) | null = null;
    const simulate = vi.fn((input: Parameters<typeof simulateRoomOdds>[0]) => new Promise<ReturnType<typeof simulateRoomOdds>>((resolve) => { release = () => resolve(simulateRoomOdds(input)); }));
    const publishing = publishRoomFacts(db, state, { simulate, facts });
    const viewing = advisorFor(db, DRAFT_ID, onClockUser, { simulate, facts });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(simulate).toHaveBeenCalledTimes(1);
    release!();
    await publishing;
    expect(await viewing).not.toBeNull();
    expect(simulate).toHaveBeenCalledTimes(1);
    // A state that is not running publishes nothing.
    await publishRoomFacts(db, { ...state, phase: "complete" }, { simulate, facts });
    expect(simulate).toHaveBeenCalledTimes(1);
  });

  it("a viewer on ANOTHER instance reads the facts the pick's invocation wrote, and simulates nothing (item 2: the cross-process store)", async () => {
    const { onClockUser, waitingUser } = await fixture();
    const state = (await getDraftStore().getDraftState(DRAFT_ID))!;
    const simulate = vi.fn(simulateRoomOdds);
    await publishRoomFacts(db, state, { simulate, facts });
    expect(simulate).toHaveBeenCalledTimes(1);
    expect(facts.held.size).toBe(1);
    // The other instance: an empty process memo, the same store.
    resetAdvisorMemoForTests();
    const view = await advisorFor(db, DRAFT_ID, onClockUser, { simulate, facts });
    expect(view).not.toBeNull();
    expect(simulate).toHaveBeenCalledTimes(1);
    // And it remembered what it read: a second seat on that instance touches neither.
    facts.held.clear();
    expect(await advisorFor(db, DRAFT_ID, waitingUser, { simulate, facts })).not.toBeNull();
    expect(simulate).toHaveBeenCalledTimes(1);
    // A miss everywhere computes once and writes for the next instance.
    resetAdvisorMemoForTests();
    expect(await advisorFor(db, DRAFT_ID, waitingUser, { simulate, facts })).not.toBeNull();
    expect(simulate).toHaveBeenCalledTimes(2);
    expect(facts.held.size).toBe(1);
  });

  it("the default simulation yields to the event loop between chunks, so the pick's own invocation never holds it for the whole table (item 1)", async () => {
    const { onClockUser } = await fixture();
    const view = await advisorFor(db, DRAFT_ID, onClockUser);
    expect(view!.odds!.runs).toBe(ADVISOR_CONFIG.runs);
    expect(ADVISOR_CONFIG.simChunkRuns).toBeLessThan(ADVISOR_CONFIG.runs);
  });

  it("is null for a member with no seat and before the draft runs", async () => {
    const { onClockUser } = await fixture();
    expect(await advisorFor(db, DRAFT_ID, "stranger")).toBeNull();
    getDraftStore().invalidate(DRAFT_ID);
    expect(await advisorFor(db, "no_such_draft", onClockUser)).toBeNull();
  });
});
