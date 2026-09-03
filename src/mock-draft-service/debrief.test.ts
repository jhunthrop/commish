import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, users } from "@/db/schema";
import type { Player } from "@/domain/player";
import type { CompletedPick, DraftStateView } from "@/draft-engine";
import { createMockRoom } from "./creation";
import {
  completedMockDebriefs,
  habitFactsOf,
  summarizeCompletedMock,
  tableForMockRoom,
  type MockDebriefDeps,
} from "./debrief";
import { mockLifecycleDeps } from "./test-support";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

function player(id: string, position: Player["position"]): Player {
  return { id, name: `Name ${id}`, position, nflTeam: "KC", headshotUrl: null, adp: null };
}

function pick(pickNumber: number, teamId: string, playerId: string, round: number): CompletedPick {
  return { pickNumber, round, teamId, playerId, slot: "BENCH", slotIndex: 0, price: null, timestamp: "2026-08-25T12:00:00.000Z", auto: false };
}

// A tiny two-seat, two-round draft: my 1.01 takes the board's best (p1); my 2.02 reaches past
// six higher-ranked players (takes p8 while p2..p7 minus the one the opponent took remain).
const PLAYERS = [
  player("p1", "RB"),
  player("p2", "WR"),
  player("p3", "WR"),
  player("p4", "RB"),
  player("p5", "TE"),
  player("p6", "QB"),
  player("p7", "WR"),
  player("p8", "TE"),
];
const PICKS = [
  pick(1, "me", "p1", 1),
  pick(2, "opp", "p2", 1),
  pick(3, "opp", "p5", 2),
  pick(4, "me", "p8", 2),
];

describe("summarizeCompletedMock", () => {
  const summary = summarizeCompletedMock({
    draftId: "d1",
    mode: "solo",
    teamCount: 2,
    startedAgoMs: 60_000,
    myTeamId: "me",
    players: PLAYERS,
    picks: PICKS,
    draftOrder: ["opp", "me"],
    // At pick 4, four higher-ranked players (p3, p4, p6, p7) are still available — real slippage,
    // but under the reach threshold of five, so no reach is counted.
  });

  it("counts against the board at the moment of each pick and finds the seat", () => {
    expect(summary.counts).toEqual({ total: 2, bestAvailable: 1, reaches: 0 });
    expect(summary.seat).toBe(2);
    expect(summary.mode).toBe("solo");
  });

  it("derives the shape, the first TE round and the early-rounds fact from the log", () => {
    expect(summary.firstTeRound).toBe(2);
    expect(summary.shapeLeader).not.toBeNull();
    // Pick 4 (round 2, within teamCount*2) was not best available, so the early fact is false.
    expect(summary.earlyBestAvailable).toBe(false);
  });

  it("names no worst reach under the threshold and feeds the habits card honestly", () => {
    expect(summary.worstReach).toBeNull();
    expect(habitFactsOf(summary)).toEqual({ firstTeRound: 2, earlyBestAvailable: false });
  });
});

describe("completedMockDebriefs", () => {
  async function seedCompletedSolo(hostId: string): Promise<{ draftId: string; leagueId: string; teamId: string }> {
    await db.insert(users).values({ id: hostId, email: `${hostId}@test.local`, displayName: hostId }).onConflictDoNothing();
    const created = await createMockRoom(
      db,
      { hostUserId: hostId, mode: "solo", teamCount: 8, pickSeconds: 60, scoringPreset: "half_ppr", rosterShape: "standard" },
      mockLifecycleDeps(db),
    );
    if (!created.ok) throw new Error(created.reason);
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.id, created.draftId));
    return { draftId: created.draftId, leagueId: created.leagueId, teamId: created.teamId };
  }

  function fakeDeps(myTeamId: string): MockDebriefDeps {
    const view = { picks: PICKS.map((entry) => ({ ...entry, teamId: entry.teamId === "me" ? myTeamId : "opp" })), draftOrder: ["opp", myTeamId] } as unknown as DraftStateView;
    return {
      loadView: () => Promise.resolve(view),
      loadPlayers: () => Promise.resolve(PLAYERS),
    };
  }

  it("summarizes the caller's completed rooms, newest first, through the injected loads", async () => {
    const seeded = await seedCompletedSolo("u_debrief");
    const summaries = await completedMockDebriefs(db, "u_debrief", fakeDeps(seeded.teamId));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ draftId: seeded.draftId, teamCount: 8, counts: { total: 2, bestAvailable: 1 } });
  });

  it("returns nothing for another caller and for an unfinished room", async () => {
    const seeded = await seedCompletedSolo("u_mine");
    await db.insert(users).values({ id: "u_other", email: "u_other@test.local", displayName: "other" }).onConflictDoNothing();
    expect(await completedMockDebriefs(db, "u_other", fakeDeps(seeded.teamId))).toEqual([]);

    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.id, seeded.draftId));
    expect(await completedMockDebriefs(db, "u_mine", fakeDeps(seeded.teamId))).toEqual([]);
  });

  it("degrades a room whose stored state cannot load to no summary, never a partial one", async () => {
    await seedCompletedSolo("u_gone");
    const deps: MockDebriefDeps = { loadView: () => Promise.resolve(null), loadPlayers: () => Promise.resolve(PLAYERS) };
    expect(await completedMockDebriefs(db, "u_gone", deps)).toEqual([]);
  });

  it("re-derives the table a room was set with from what is actually stored", async () => {
    const seeded = await seedCompletedSolo("u_table");
    expect(await tableForMockRoom(db, seeded.leagueId)).toEqual({
      teamCount: 8,
      pickSeconds: 60,
      scoringPreset: "half_ppr",
      rosterShape: "standard",
    });
    expect(await tableForMockRoom(db, "no_such_league")).toBeNull();
  });
});
