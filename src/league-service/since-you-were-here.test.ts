import { beforeEach, describe, expect, it } from "vitest";
import { leagues, players, teams, users } from "@/db/schema";
import { countingDb, createTestDb, truncateAll } from "@/db/test-db";
import type { AuditEventInput } from "@/domain/audit";
import { createAuditLogger, type AuditLogger } from "@/integrity-service/audit-logger";
import { latestActivityByLeague } from "./since-you-were-here";

const db = createTestDb();

let seq = 0;
function loggerFor(prefix: string): AuditLogger {
  return createAuditLogger({ newId: () => `evt_${prefix}_${(seq += 1)}` });
}

async function record(logger: AuditLogger, input: AuditEventInput): Promise<void> {
  await db.transaction((tx) => logger.record(tx, input));
}

/** Two leagues, two managers each, with the rows every renderer here needs to resolve a name. */
async function seedTwoLeagues(): Promise<void> {
  await db.insert(users).values([
    { id: "u_me", email: "me@test.local", displayName: "Justin Hunthrop" },
    { id: "u_rey", email: "rey@test.local", displayName: "Rey Okafor" },
  ]);
  for (const id of ["lg_one", "lg_two"]) {
    await db.insert(leagues).values({ id, name: id, format: "snake", teamCount: 2, commissionerUserId: "u_me" });
    await db.insert(teams).values([
      { id: `${id}_mine`, leagueId: id, userId: "u_me", name: "Bay Bandits" },
      { id: `${id}_theirs`, leagueId: id, userId: "u_rey", name: "Iron Owls" },
    ]);
  }
  await db.insert(players).values({ id: "p_nabers", name: "Malik Nabers", position: "WR", nflTeam: "NYG" });
}

function pick(leagueId: string, pickNumber: number, at: string): AuditEventInput {
  return {
    eventType: "draft_pick",
    actorId: "u_rey",
    actorType: "user",
    leagueId,
    payload: { draftId: "d", teamId: `${leagueId}_theirs`, playerId: "p_nabers", position: "WR", round: 1, pickNumber, slot: "WR", slotIndex: 0, price: null, auto: false },
    occurredAt: at,
  };
}

function lineupChange(leagueId: string, actorId: string, at: string): AuditEventInput {
  return {
    eventType: "lineup_change",
    actorId,
    actorType: "user",
    leagueId,
    payload: { teamId: `${leagueId}_mine`, weekNumber: 3, starters: [{ slot: "WR", slotIndex: 0, playerId: "p_nabers" }] },
    occurredAt: at,
  };
}

function tradeProposed(leagueId: string, at: string): AuditEventInput {
  return {
    eventType: "trade_proposed",
    actorId: "u_rey",
    actorType: "user",
    leagueId,
    payload: { tradeId: "tr_1", proposerTeamId: `${leagueId}_theirs`, counterpartyTeamId: `${leagueId}_mine`, proposerAssetIds: ["p_nabers"], counterpartyAssetIds: [] },
    occurredAt: at,
  };
}

beforeEach(async () => {
  await truncateAll(db);
  seq = 0;
  await seedTwoLeagues();
});

describe("latestActivityByLeague", () => {
  it("answers the newest visible row per league, in one window statement plus the batched names", async () => {
    const one = loggerFor("one");
    const two = loggerFor("two");
    await record(one, pick("lg_one", 1, "2026-08-20T17:00:00.000Z"));
    await record(one, pick("lg_one", 2, "2026-08-20T17:00:05.000Z"));
    await record(two, pick("lg_two", 1, "2026-08-20T17:00:10.000Z"));

    const counting = countingDb(db);
    const latest = await latestActivityByLeague(counting.db, { leagueIds: ["lg_one", "lg_two"], viewerUserId: "u_me" });

    expect([...latest.keys()].sort()).toEqual(["lg_one", "lg_two"]);
    expect(latest.get("lg_one")?.headline).toContain("Malik Nabers");
    expect(latest.get("lg_one")?.actor).toMatchObject({ userId: "u_rey", name: "Rey Okafor" });
    expect(latest.get("lg_one")?.kind).toBe("pick");
    // ONE statement walks both chains: the window, plus at most the three batched name lookups
    // `listLeagueActivity` already pays for one league.
    expect(counting.selectCount()).toBeLessThanOrEqual(4);
  });

  it("takes the NEWEST row of each league, not the newest across all of them", async () => {
    const one = loggerFor("one");
    const two = loggerFor("two");
    await record(one, pick("lg_one", 7, "2026-08-20T17:00:00.000Z"));
    await record(two, pick("lg_two", 9, "2026-08-21T17:00:00.000Z"));

    const latest = await latestActivityByLeague(db, { leagueIds: ["lg_one", "lg_two"], viewerUserId: "u_me" });
    expect(latest.get("lg_one")?.occurredAt).toBe("2026-08-20T17:00:00.000Z");
    expect(latest.get("lg_two")?.occurredAt).toBe("2026-08-21T17:00:00.000Z");
  });

  it("never surfaces a lineup change, not even the reader's own", async () => {
    const one = loggerFor("one");
    await record(one, lineupChange("lg_one", "u_me", "2026-08-20T18:00:00.000Z"));

    const latest = await latestActivityByLeague(db, { leagueIds: ["lg_one"], viewerUserId: "u_me" });
    expect(latest.has("lg_one")).toBe(false);
  });

  it("never surfaces a trade negotiation, and falls through to the newest thing that is visible", async () => {
    const one = loggerFor("one");
    await record(one, pick("lg_one", 3, "2026-08-20T17:00:00.000Z"));
    await record(one, tradeProposed("lg_one", "2026-08-20T19:00:00.000Z"));

    const latest = await latestActivityByLeague(db, { leagueIds: ["lg_one"], viewerUserId: "u_me" });
    // The proposal is the newest row in the chain and renders nothing, so the pick beneath it is
    // what the line says.
    expect(latest.get("lg_one")?.occurredAt).toBe("2026-08-20T17:00:00.000Z");
    expect(latest.get("lg_one")?.kind).toBe("pick");
  });

  it("is absent, never a placeholder, for a league with nothing visible at all", async () => {
    const latest = await latestActivityByLeague(db, { leagueIds: ["lg_one", "lg_two"], viewerUserId: "u_me" });
    expect(latest.size).toBe(0);
  });

  it("reads nothing at all when asked about no leagues", async () => {
    const counting = countingDb(db);
    expect((await latestActivityByLeague(counting.db, { leagueIds: [], viewerUserId: "u_me" })).size).toBe(0);
    expect(counting.selectCount()).toBe(0);
  });

  it("never reaches into a league the caller did not ask about", async () => {
    const one = loggerFor("one");
    const two = loggerFor("two");
    await record(one, pick("lg_one", 1, "2026-08-20T17:00:00.000Z"));
    await record(two, pick("lg_two", 1, "2026-08-20T17:00:05.000Z"));

    const latest = await latestActivityByLeague(db, { leagueIds: ["lg_one"], viewerUserId: "u_me" });
    expect([...latest.keys()]).toEqual(["lg_one"]);
  });
});
