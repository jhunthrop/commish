import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { captureSnapshots, injuredReserve, lineupSlots, rosterSlots, statWeeks } from "@/db/schema";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { createTestDb, truncateAll } from "@/db/test-db";
import { freeAgents } from "./claims";
import { activateFromInjuredReserve, IR_REFUSALS, placeOnInjuredReserve } from "./injured-reserve";
import { twoTeamLeague } from "./test-support";

const db = createTestDb();
const clock = { now: () => "2026-08-20T17:00:00.000Z" };
let counter = 0;
const logger = createAuditLogger({ newId: () => `ir_evt_${(counter += 1)}` });
const deps = { audit: logger, clock };

/** Plants the harvested injuries snapshot the eligibility gate reads. */
async function plantDesignations(entries: readonly { readonly playerID: string; readonly designation: string }[]): Promise<void> {
  await db.insert(captureSnapshots).values({
    source: "tank01_injuries_by_date",
    digest: `d${(counter += 1)}`,
    payload: { injDate: "20260820", injList: entries },
    capturedAt: new Date(),
  });
}

beforeEach(async () => {
  await truncateAll(db);
  counter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("placeOnInjuredReserve", () => {
  it("parks an OUT player: roster row deleted, membership recorded, roster spot freed", async () => {
    const league = await twoTeamLeague(db);
    await plantDesignations([{ playerID: "qb2", designation: "O" }]);
    const result = await placeOnInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps);
    expect(result).toEqual({ ok: true });

    const rows = await db.select().from(rosterSlots).where(and(eq(rosterSlots.teamId, league.teamId), eq(rosterSlots.playerId, "qb2")));
    expect(rows).toHaveLength(0);
    const membership = await db.select().from(injuredReserve).where(eq(injuredReserve.teamId, league.teamId));
    expect(membership).toHaveLength(1);
    expect(membership[0]).toMatchObject({ playerId: "qb2", designationAtPlacement: "O" });
  });

  it("refuses a questionable player — Q is not out, and parking a probable player is the stash exploit", async () => {
    const league = await twoTeamLeague(db);
    await plantDesignations([{ playerID: "qb2", designation: "Q" }]);
    const result = await placeOnInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps);
    expect(result).toEqual({ ok: false, status: 409, reason: IR_REFUSALS.notEligible });
  });

  it("refuses a player the injuries feed does not name at all", async () => {
    const league = await twoTeamLeague(db);
    await plantDesignations([]);
    const result = await placeOnInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps);
    expect(result).toEqual({ ok: false, status: 409, reason: IR_REFUSALS.notEligible });
  });

  it("refuses a second placement while the one IR spot is taken", async () => {
    const league = await twoTeamLeague(db);
    await plantDesignations([
      { playerID: "qb2", designation: "O" },
      { playerID: "rb2", designation: "IR" },
    ]);
    expect(await placeOnInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps)).toEqual({ ok: true });
    expect(await placeOnInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "rb2" }, deps)).toEqual({
      ok: false,
      status: 409,
      reason: IR_REFUSALS.irFull,
    });
  });

  it("clears him from unlocked saved lineups and keeps him in locked ones", async () => {
    const league = await twoTeamLeague(db, { weeks: 4 });
    await db.insert(statWeeks).values([
      { week: 1, status: "final" },
      { week: 2, status: "scheduled" },
    ]);
    await db.insert(lineupSlots).values([
      { teamId: league.teamId, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb2" },
      { teamId: league.teamId, weekNumber: 2, slot: "QB", slotIndex: 0, playerId: "qb2" },
    ]);
    await plantDesignations([{ playerID: "qb2", designation: "IR" }]);
    expect(await placeOnInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps)).toEqual({ ok: true });

    const saved = await db.select().from(lineupSlots).where(eq(lineupSlots.teamId, league.teamId));
    expect(saved.find((row) => row.weekNumber === 1)?.playerId).toBe("qb2");
    expect(saved.find((row) => row.weekNumber === 2)?.playerId).toBeNull();
  });

  it("keeps a parked player OUT of the free-agent pool and OFF the claimable list", async () => {
    const league = await twoTeamLeague(db);
    await plantDesignations([{ playerID: "qb2", designation: "O" }]);
    expect(await placeOnInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps)).toEqual({ ok: true });
    const pool = await freeAgents(db, { leagueId: league.leagueId, position: "ALL" });
    expect(pool.agents.map((agent) => agent.id)).not.toContain("qb2");
  });
});

describe("activateFromInjuredReserve", () => {
  it("returns him to the roster through assignSlot and clears the membership", async () => {
    const league = await twoTeamLeague(db);
    await plantDesignations([{ playerID: "qb2", designation: "O" }]);
    expect(await placeOnInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps)).toEqual({ ok: true });
    expect(await activateFromInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps)).toEqual({ ok: true });

    const rows = await db.select().from(rosterSlots).where(and(eq(rosterSlots.teamId, league.teamId), eq(rosterSlots.playerId, "qb2")));
    expect(rows).toHaveLength(1);
    expect(await db.select().from(injuredReserve).where(eq(injuredReserve.teamId, league.teamId))).toHaveLength(0);
  });

  it("refuses activation for a player who is not on the injured reserve", async () => {
    const league = await twoTeamLeague(db);
    expect(await activateFromInjuredReserve(db, { leagueId: league.leagueId, userId: "u1", playerId: "qb2" }, deps)).toEqual({
      ok: false,
      status: 400,
      reason: IR_REFUSALS.notOnIr,
    });
  });
});
