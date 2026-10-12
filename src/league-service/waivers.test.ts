import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { leagueWaivers, rosterSlots, teams, waiverClaims } from "@/db/schema";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { claimPlayer, CLAIM_REFUSALS } from "./claims";
import { processWaivers, WAIVER_PERIOD_HOURS } from "./waivers";
import { players } from "@research/db/schema";
import { twoTeamLeague } from "./test-support";

/** `twoTeamLeague` + one unowned RB: team one (u1) is FULL (4 of 4 slots), team_2 (u2) is
 *  empty, and "rb3" is the wire. The shape every case here needs. */
async function openRosterLeague(db2: ReturnType<typeof createTestDb>) {
  const league = await twoTeamLeague(db2);
  await db2.insert(players).values([{ id: "rb3", name: "RB Three", position: "RB", nflTeam: "PIT" }]);
  return {
    leagueId: league.leagueId,
    ownerUserId: "u1",
    ownerTeamId: league.teamId,
    rivalUserId: "u2",
    rivalTeamId: "team_2",
    rosteredId: "rb2",
    freeAgentId: "rb3",
  };
}

const db = createTestDb();
let nowIso = "2026-08-20T17:00:00.000Z";
const clock = { now: () => nowIso };
let counter = 0;
const logger = createAuditLogger({ newId: () => `wv_evt_${(counter += 1)}` });
const deps = { audit: logger, clock };

function hoursLater(hours: number): string {
  return new Date(Date.parse("2026-08-20T17:00:00.000Z") + hours * 3_600_000).toISOString();
}

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
  nowIso = "2026-08-20T17:00:00.000Z";
});

afterAll(async () => {
  await truncateAll(db);
});

describe("waivers v1", () => {
  it("a drop opens a waiver window for the dropped player", async () => {
    const league = await openRosterLeague(db);
    // Fill the roster so the claim needs a drop.
    const add = await claimPlayer(db, { leagueId: league.leagueId, userId: league.ownerUserId, addPlayerId: league.freeAgentId, dropPlayerId: league.rosteredId }, deps);
    expect(add.ok).toBe(true);
    const [window] = await db
      .select()
      .from(leagueWaivers)
      .where(and(eq(leagueWaivers.leagueId, league.leagueId), eq(leagueWaivers.playerId, league.rosteredId)));
    expect(window).toBeDefined();
    expect(window!.until.toISOString()).toBe(hoursLater(WAIVER_PERIOD_HOURS));
  });

  it("a claim on a waivered player FILES rather than executes, and re-filing refuses", async () => {
    const league = await openRosterLeague(db);
    await db.insert(leagueWaivers).values({ leagueId: league.leagueId, playerId: league.freeAgentId, until: new Date(hoursLater(2)) });

    const filed = await claimPlayer(db, { leagueId: league.leagueId, userId: league.rivalUserId, addPlayerId: league.freeAgentId }, deps);
    expect(filed).toMatchObject({ ok: true, waiverFiled: true, clearsAt: hoursLater(2) });
    // He is NOT on the rival's roster.
    const rows = await db.select().from(rosterSlots).where(eq(rosterSlots.playerId, league.freeAgentId));
    expect(rows).toHaveLength(0);

    const again = await claimPlayer(db, { leagueId: league.leagueId, userId: league.rivalUserId, addPlayerId: league.freeAgentId }, deps);
    expect(again).toEqual({ ok: false, status: 409, reason: CLAIM_REFUSALS.alreadyFiled });
  });

  it("resolution awards by waiver priority, moves the winner to last, and tells the loser why", async () => {
    const league = await openRosterLeague(db);
    await db.update(teams).set({ waiverPriority: 5 }).where(eq(teams.id, league.ownerTeamId));
    await db.update(teams).set({ waiverPriority: 2 }).where(eq(teams.id, league.rivalTeamId));
    await db.insert(leagueWaivers).values({ leagueId: league.leagueId, playerId: league.freeAgentId, until: new Date(hoursLater(1)) });

    expect((await claimPlayer(db, { leagueId: league.leagueId, userId: league.ownerUserId, addPlayerId: league.freeAgentId, dropPlayerId: league.rosteredId }, deps)).ok).toBe(true);
    expect((await claimPlayer(db, { leagueId: league.leagueId, userId: league.rivalUserId, addPlayerId: league.freeAgentId }, deps)).ok).toBe(true);

    nowIso = hoursLater(1.5);
    const { awarded } = await processWaivers(db, clock);
    expect(awarded).toBe(1);

    // The rival (priority 2) wins; the player lands on his roster.
    const holder = await db.select().from(rosterSlots).where(eq(rosterSlots.playerId, league.freeAgentId));
    expect(holder).toHaveLength(1);
    expect(holder[0]!.teamId).toBe(league.rivalTeamId);

    const [winnerTeam] = await db.select({ p: teams.waiverPriority }).from(teams).where(eq(teams.id, league.rivalTeamId));
    expect(winnerTeam!.p).toBe(6);

    const claims = await db.select().from(waiverClaims).where(eq(waiverClaims.leagueId, league.leagueId));
    const won = claims.find((row) => row.teamId === league.rivalTeamId);
    const lost = claims.find((row) => row.teamId === league.ownerTeamId);
    expect(won?.status).toBe("won");
    expect(lost?.status).toBe("lost");
    expect(lost?.note).toBe("A team with better waiver priority won him.");

    // The window is spent.
    expect(await db.select().from(leagueWaivers).where(eq(leagueWaivers.leagueId, league.leagueId))).toHaveLength(0);
  });

  it("an expired window with no bids simply clears to first-come-first-served", async () => {
    const league = await openRosterLeague(db);
    await db.insert(leagueWaivers).values({ leagueId: league.leagueId, playerId: league.freeAgentId, until: new Date(hoursLater(1)) });
    nowIso = hoursLater(2);
    expect((await processWaivers(db, clock)).awarded).toBe(0);
    expect(await db.select().from(leagueWaivers)).toHaveLength(0);
    // And an ordinary claim now executes instantly.
    const claim = await claimPlayer(db, { leagueId: league.leagueId, userId: league.rivalUserId, addPlayerId: league.freeAgentId }, deps);
    expect(claim).toMatchObject({ ok: true, added: league.freeAgentId });
  });
});
