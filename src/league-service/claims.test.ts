import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { leagueWaivers, players, teams, waiverClaims } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { pendingWaiverClaims } from "./claims";
import { twoTeamLeague } from "./test-support";
import { WAIVER_PERIOD_HOURS } from "./waivers";

const db = createTestDb();

const T0 = new Date("2026-08-20T17:00:00.000Z");

function minutesLater(minutes: number): Date {
  return new Date(T0.getTime() + minutes * 60_000);
}

let claimCounter = 0;

/** One `waiver_claims` row, explicit `createdAt` so filing order is the test's to control. */
function bid(input: { readonly leagueId: string; readonly teamId: string; readonly addPlayerId: string; readonly createdAt: Date }) {
  return { id: `wc_test_${(claimCounter += 1)}`, dropPlayerId: null, ...input };
}

/** `twoTeamLeague` plus a wire of free agents whose names make the sort assertions readable. */
async function leagueWithWire() {
  const league = await twoTeamLeague(db);
  await db.insert(players).values([
    { id: "fa_rb", name: "Alpha Back", position: "RB", nflTeam: "PIT" },
    { id: "fa_qb", name: "Bravo Arm", position: "QB", nflTeam: "CHI" },
    { id: "fa_wr", name: "Charlie Wide", position: "WR", nflTeam: "MIA" },
  ]);
  return { leagueId: league.leagueId, myTeamId: league.teamId, rivalTeamId: "team_2" };
}

beforeEach(async () => {
  await truncateAll(db);
  claimCounter = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("pendingWaiverClaims", () => {
  it("returns the team's pending claims with the window's clearsAt and a 1-based queue position", async () => {
    const league = await leagueWithWire();
    const until = minutesLater(90);
    await db.insert(leagueWaivers).values({ leagueId: league.leagueId, playerId: "fa_rb", until });
    await db.insert(waiverClaims).values(bid({ leagueId: league.leagueId, teamId: league.myTeamId, addPlayerId: "fa_rb", createdAt: T0 }));

    const claims = await pendingWaiverClaims(db, league.leagueId, league.myTeamId);
    expect(claims).toEqual([
      {
        claimId: "wc_test_1",
        playerId: "fa_rb",
        playerName: "Alpha Back",
        position: "RB",
        clearsAt: until.toISOString(),
        queuePosition: 1,
      },
    ]);
  });

  it("returns nothing when the team has no pending claims — rivals' bids and settled bids don't count", async () => {
    const league = await leagueWithWire();
    await db.insert(leagueWaivers).values({ leagueId: league.leagueId, playerId: "fa_rb", until: minutesLater(60) });
    await db.insert(waiverClaims).values([
      // The rival's live bid is not mine.
      bid({ leagueId: league.leagueId, teamId: league.rivalTeamId, addPlayerId: "fa_rb", createdAt: T0 }),
      // My own claim, but already resolved.
      { ...bid({ leagueId: league.leagueId, teamId: league.myTeamId, addPlayerId: "fa_rb", createdAt: T0 }), status: "won" as const },
    ]);
    expect(await pendingWaiverClaims(db, league.leagueId, league.myTeamId)).toEqual([]);
  });

  it("ranks a rival with better waiver priority ahead of me, even though I filed first", async () => {
    const league = await leagueWithWire();
    await db.update(teams).set({ waiverPriority: 1 }).where(eq(teams.id, league.rivalTeamId));
    await db.update(teams).set({ waiverPriority: 5 }).where(eq(teams.id, league.myTeamId));
    await db.insert(leagueWaivers).values({ leagueId: league.leagueId, playerId: "fa_rb", until: minutesLater(60) });
    await db.insert(waiverClaims).values([
      bid({ leagueId: league.leagueId, teamId: league.myTeamId, addPlayerId: "fa_rb", createdAt: T0 }),
      bid({ leagueId: league.leagueId, teamId: league.rivalTeamId, addPlayerId: "fa_rb", createdAt: minutesLater(5) }),
    ]);

    const [mine] = await pendingWaiverClaims(db, league.leagueId, league.myTeamId);
    expect(mine?.queuePosition).toBe(2);
  });

  it("breaks a priority tie by filing time — the earlier bid stands first in line", async () => {
    const league = await leagueWithWire();
    await db.insert(leagueWaivers).values({ leagueId: league.leagueId, playerId: "fa_rb", until: minutesLater(60) });
    await db.insert(waiverClaims).values([
      bid({ leagueId: league.leagueId, teamId: league.rivalTeamId, addPlayerId: "fa_rb", createdAt: T0 }),
      bid({ leagueId: league.leagueId, teamId: league.myTeamId, addPlayerId: "fa_rb", createdAt: minutesLater(5) }),
    ]);

    const [mine] = await pendingWaiverClaims(db, league.leagueId, league.myTeamId);
    expect(mine?.queuePosition).toBe(2);
    const [rivals] = await pendingWaiverClaims(db, league.leagueId, league.rivalTeamId);
    expect(rivals?.queuePosition).toBe(1);
  });

  it("falls back to filed-at plus the standard window when the waiver row is already gone", async () => {
    const league = await leagueWithWire();
    await db.insert(waiverClaims).values(bid({ leagueId: league.leagueId, teamId: league.myTeamId, addPlayerId: "fa_rb", createdAt: T0 }));

    const [claim] = await pendingWaiverClaims(db, league.leagueId, league.myTeamId);
    expect(claim?.clearsAt).toBe(new Date(T0.getTime() + WAIVER_PERIOD_HOURS * 3_600_000).toISOString());
  });

  it("sorts by clearsAt, then player name inside the same window", async () => {
    const league = await leagueWithWire();
    const soon = minutesLater(30);
    const later = minutesLater(120);
    await db.insert(leagueWaivers).values([
      { leagueId: league.leagueId, playerId: "fa_rb", until: soon },
      { leagueId: league.leagueId, playerId: "fa_qb", until: soon },
      { leagueId: league.leagueId, playerId: "fa_wr", until: later },
    ]);
    await db.insert(waiverClaims).values([
      // Inserted deliberately out of the expected order.
      bid({ leagueId: league.leagueId, teamId: league.myTeamId, addPlayerId: "fa_wr", createdAt: T0 }),
      bid({ leagueId: league.leagueId, teamId: league.myTeamId, addPlayerId: "fa_qb", createdAt: T0 }),
      bid({ leagueId: league.leagueId, teamId: league.myTeamId, addPlayerId: "fa_rb", createdAt: T0 }),
    ]);

    const claims = await pendingWaiverClaims(db, league.leagueId, league.myTeamId);
    expect(claims.map((claim) => claim.playerName)).toEqual(["Alpha Back", "Bravo Arm", "Charlie Wide"]);
    expect(claims.map((claim) => claim.clearsAt)).toEqual([soon.toISOString(), soon.toISOString(), later.toISOString()]);
  });
});
