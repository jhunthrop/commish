import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { tradeProposals, tradeVetoes, users, teams } from "@/db/schema";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { processTradeReviews, vetoTrade, vetoVotesRequired } from "./trade-review";
import { TRADE_GOVERNANCE_REFUSALS } from "./trades";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/** A bare under_review proposal with enough league members to vote. No rosters needed: veto
 *  mechanics never touch a player. */
async function underReviewTrade(memberCount: number) {
  const userRows = Array.from({ length: memberCount }, (_, i) => ({ id: `vu${i + 1}`, email: `vu${i + 1}@test.local`, displayName: `V ${i + 1}` }));
  await db.insert(users).values(userRows);
  const { createLeague } = await import("./creation");
  const clock = { now: () => "2026-08-20T12:00:00.000Z" };
  let n = 0;
  const created = await createLeague({ db, clock, newId: () => `veto_id_${(n += 1)}` }, {
    name: "Veto League", format: "snake", teamCount: memberCount, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }, { slot: "BENCH", count: 1, eligiblePositions: ["QB"] }],
    owner: { kind: "member", userId: "vu1", teamName: "T1" }, experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  const teamRows = Array.from({ length: memberCount - 1 }, (_, i) => ({
    id: `veto_t${i + 2}`, leagueId: created.leagueId, userId: `vu${i + 2}`, name: `T${i + 2}`,
  }));
  await db.insert(teams).values(teamRows);
  await db.insert(tradeProposals).values({
    id: "veto_trade",
    leagueId: created.leagueId,
    proposerTeamId: created.teamId!,
    counterpartyTeamId: "veto_t2",
    weekNumber: 1,
    proposerAssets: [],
    counterpartyAssets: [],
    fingerprint: "fp_veto",
    status: "under_review",
    proposedAt: new Date("2026-08-19T12:00:00.000Z"),
    expiresAt: new Date("2026-08-22T12:00:00.000Z"),
    reviewEndsAt: new Date("2026-08-21T12:00:00.000Z"),
  });
  return { leagueId: created.leagueId };
}

describe("trade governance", () => {
  it("scales the veto threshold with league size, floored at 3", () => {
    expect(vetoVotesRequired(12)).toBe(5);
    expect(vetoVotesRequired(10)).toBe(4);
    expect(vetoVotesRequired(8)).toBe(3);
    expect(vetoVotesRequired(4)).toBe(3);
  });

  it("refuses a party's vote and a second vote, counts the rest, and settles vetoed at the threshold", async () => {
    const { leagueId } = await underReviewTrade(6);

    // The proposer cannot vote on his own trade.
    expect(await vetoTrade(db, { leagueId, tradeId: "veto_trade", userId: "vu1" })).toEqual({
      ok: false, status: 409, reason: TRADE_GOVERNANCE_REFUSALS.partyCannotVeto,
    });

    expect(await vetoTrade(db, { leagueId, tradeId: "veto_trade", userId: "vu3" })).toEqual({ ok: true, votes: 1, required: 3 });
    expect(await vetoTrade(db, { leagueId, tradeId: "veto_trade", userId: "vu3" })).toEqual({
      ok: false, status: 409, reason: TRADE_GOVERNANCE_REFUSALS.alreadyVetoed,
    });
    expect(await vetoTrade(db, { leagueId, tradeId: "veto_trade", userId: "vu4" })).toEqual({ ok: true, votes: 2, required: 3 });
    expect(await vetoTrade(db, { leagueId, tradeId: "veto_trade", userId: "vu5" })).toEqual({ ok: true, votes: 3, required: 3 });

    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, "veto_trade"));
    expect(row!.status).toBe("vetoed");
    expect(await db.select().from(tradeVetoes).where(eq(tradeVetoes.tradeId, "veto_trade"))).toHaveLength(3);
  });

  it("the lazy processor settles a threshold-crossed review as vetoed when the window closes", async () => {
    const { leagueId } = await underReviewTrade(6);
    await db.insert(tradeVetoes).values([
      { tradeId: "veto_trade", userId: "vu3" },
      { tradeId: "veto_trade", userId: "vu4" },
      { tradeId: "veto_trade", userId: "vu5" },
    ]);
    const later = { now: () => "2026-08-21T13:00:00.000Z" };
    const outcome = await processTradeReviews(db, later);
    expect(outcome.vetoed).toBe(1);
    const [row] = await db.select().from(tradeProposals).where(eq(tradeProposals.id, "veto_trade"));
    expect(row!.status).toBe("vetoed");
    expect(row!.settledAt).not.toBeNull();
    void leagueId;
  });
});
