import { describe, expect, it } from "vitest";
import type { Db } from "@/db/client";
import { drafts, players, playerStatLines, rosterSlots, teams, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { createLeague } from "@/league-service/creation";
import { writeSchedule } from "@/league-service/schedule";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { evaluateTradeBeforeExecute, type EvaluateTradeInput } from "./trade-fairness";

const db = createTestDb();

const SLOTS = [
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
];

const clock = { now: () => "2026-08-21T00:00:00.000Z" };

/**
 * One league, two teams. `p_star` scores a huge line in every one of the three weeks the
 * `weekNumber: 4` trend window reads (weeks 1-3): 300 rushing yards and 5 touchdowns a week is
 * 60 fantasy points a week under standard scoring, which is what makes the gap in
 * `GROTESQUELY_LOPSIDED` real arithmetic rather than a hand-picked number. `p_scrub` never plays
 * at all, so it values at exactly 0.
 */
async function fairnessLeague(db: Db): Promise<{ readonly leagueId: string; readonly teamA: string; readonly teamB: string }> {
  await db.insert(users).values([
    { id: "fair_u_a", email: "fair_u_a@test.local", displayName: "Manager A" },
    { id: "fair_u_b", email: "fair_u_b@test.local", displayName: "Manager B" },
  ]);
  const created = await createLeague({ db, clock, newId: () => `fair_lg_${crypto.randomUUID()}` }, {
    name: "Fairness League",
    format: "snake",
    teamCount: 2,
    scoringPreset: "standard",
    auctionBudget: null,
    rosterSlots: SLOTS,
    commissionerUserId: "fair_u_a",
    teamName: "Team A",
    experienceTier: "beginner",
    stakeTier: 0,
    isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  const teamB = "fair_team_b";
  await db.insert(teams).values({ id: teamB, leagueId: created.leagueId, userId: "fair_u_b", name: "Team B" });
  await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));

  await db.insert(players).values([
    { id: "p_star", name: "Star", position: "RB", nflTeam: "KC" },
    { id: "p_scrub", name: "Scrub", position: "RB", nflTeam: "SF" },
    { id: "p_even_a", name: "Even A", position: "RB", nflTeam: "DAL" },
    { id: "p_even_b", name: "Even B", position: "RB", nflTeam: "MIA" },
  ]);
  await db.insert(rosterSlots).values([
    { teamId: created.teamId, slot: "RB", slotIndex: 0, playerId: "p_star" },
    { teamId: created.teamId, slot: "BENCH", slotIndex: 0, playerId: "p_even_a" },
    { teamId: teamB, slot: "RB", slotIndex: 0, playerId: "p_scrub" },
    { teamId: teamB, slot: "BENCH", slotIndex: 0, playerId: "p_even_b" },
  ]);
  await db.insert(playerStatLines).values([
    ...[1, 2, 3].map((week) => ({ playerId: "p_star", week, rushingYards: 300, rushingTouchdowns: 5 })),
    ...[1, 2, 3].map((week) => ({ playerId: "p_even_a", week, rushingYards: 50 })),
    ...[1, 2, 3].map((week) => ({ playerId: "p_even_b", week, rushingYards: 50 })),
  ]);
  await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [created.teamId, teamB], weeks: 4 }));

  return { leagueId: created.leagueId, teamA: created.teamId, teamB };
}

async function grotesquelyLopsided(db: Db): Promise<EvaluateTradeInput> {
  const league = await fairnessLeague(db);
  return {
    leagueId: league.leagueId,
    weekNumber: 4,
    proposerTeamId: league.teamA,
    counterpartyTeamId: league.teamB,
    proposerAssetIds: ["p_star"],
    counterpartyAssetIds: ["p_scrub"],
  };
}

describe("evaluateTradeBeforeExecute", () => {
  it("never holds a trade while no hold threshold is configured, however lopsided it is", async () => {
    await truncateAll(db);
    expect(INTEGRITY_CONFIG.trade.autoHoldThreshold).toBeNull();
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, input));
    expect(evaluation.gap).toBeGreaterThan(50);
    expect(evaluation.hold).toBe(false);
    expect(evaluation.flagWorthy).toBe(true);
  });

  it("holds when a threshold IS supplied, so Plan D inherits a proven branch and not an idea", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, autoHoldThreshold: 40 }));
    expect(evaluation.hold).toBe(true);
  });

  it("does not hold a threshold the gap never reaches", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    const evaluation = await db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, autoHoldThreshold: 1000 }));
    expect(evaluation.hold).toBe(false);
  });

  it("values a ghost player as a refusal rather than as zero points", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    await expect(
      db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, proposerAssetIds: ["p_star", "p_ghost"] })),
    ).rejects.toThrow(/couldn't value/);
  });

  it("refuses when a whole team no longer resolves in the league", async () => {
    await truncateAll(db);
    const input = await grotesquelyLopsided(db);
    await expect(
      db.transaction((tx) => evaluateTradeBeforeExecute(tx, { ...input, counterpartyTeamId: "team_ghost" })),
    ).rejects.toThrow(/couldn't value/);
  });

  it("reports an even trade as even, with no flag and no hold", async () => {
    await truncateAll(db);
    const league = await fairnessLeague(db);
    const evaluation = await db.transaction((tx) =>
      evaluateTradeBeforeExecute(tx, {
        leagueId: league.leagueId,
        weekNumber: 4,
        proposerTeamId: league.teamA,
        counterpartyTeamId: league.teamB,
        proposerAssetIds: ["p_even_a"],
        counterpartyAssetIds: ["p_even_b"],
      }),
    );
    expect(evaluation.balance.verdict).toBe("even");
    expect(evaluation.flagWorthy).toBe(false);
    expect(evaluation.hold).toBe(false);
  });
});
