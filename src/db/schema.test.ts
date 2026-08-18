import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "./test-db";
import { users, leagues, teams, scoringSettings, leagueInvites, lineupSlots } from "./schema";
import { PPR_SCORING } from "@/domain/scoring";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("schema round-trip against Postgres", () => {
  it("creates a user, a league they commission, their team, and the league's scoring settings", async () => {
    await db.insert(users).values({
      id: "user_1",
      email: "jh@example.com",
      displayName: "JH",
    });

    await db.insert(leagues).values({
      id: "league_1",
      name: "Sunday Money",
      format: "snake",
      teamCount: 12,
      commissionerUserId: "user_1",
    });

    await db.insert(teams).values({
      id: "team_1",
      leagueId: "league_1",
      userId: "user_1",
      name: "The Commish",
    });

    await db.insert(scoringSettings).values({ leagueId: "league_1", ...PPR_SCORING });

    const [league] = await db.select().from(leagues).where(eq(leagues.id, "league_1"));
    const leagueTeams = await db.select().from(teams).where(eq(teams.leagueId, "league_1"));
    const [scoring] = await db
      .select()
      .from(scoringSettings)
      .where(eq(scoringSettings.leagueId, "league_1"));

    expect(league?.name).toBe("Sunday Money");
    expect(league?.format).toBe("snake");
    expect(leagueTeams).toHaveLength(1);
    expect(leagueTeams[0]?.name).toBe("The Commish");
    expect(scoring?.pointsPerReception).toBe(1);
  });

  it("rejects a second team for the same user in the same league", async () => {
    await db.insert(users).values({
      id: "user_1",
      email: "jh@example.com",
      displayName: "JH",
    });
    await db.insert(leagues).values({
      id: "league_1",
      name: "L",
      format: "auction",
      teamCount: 10,
      commissionerUserId: "user_1",
    });
    await db.insert(teams).values({ id: "team_1", leagueId: "league_1", userId: "user_1", name: "A" });

    await expect(
      db.insert(teams).values({ id: "team_2", leagueId: "league_1", userId: "user_1", name: "B" }),
    ).rejects.toThrow();
  });

  it("rejects duplicate emails", async () => {
    await db.insert(users).values({ id: "u1", email: "dup@example.com", displayName: "A" });
    await expect(
      db.insert(users).values({ id: "u2", email: "dup@example.com", displayName: "B" }),
    ).rejects.toThrow();
  });
});

const LEAGUE_ID = "league_invite_lineup";
const USER_ID = "user_invite_lineup";
const TEAM_ID = "team_invite_lineup";

/** Inserts a user, the league they commission, and their team — the fixture `league_invites` and `lineup_slots` hang off. */
async function seedLeague(): Promise<void> {
  await db.insert(users).values({ id: USER_ID, email: "invite-lineup@example.com", displayName: "Invite Lineup" });
  await db.insert(leagues).values({
    id: LEAGUE_ID,
    name: "Invite Lineup League",
    format: "snake",
    teamCount: 12,
    commissionerUserId: USER_ID,
  });
  await db.insert(teams).values({ id: TEAM_ID, leagueId: LEAGUE_ID, userId: USER_ID, name: "Fixture Team" });
}

describe("league_invites and lineup_slots", () => {
  it("stores an invite and enforces one row per code", async () => {
    await seedLeague();
    await db.insert(leagueInvites).values({
      code: "SUNDAY12",
      leagueId: LEAGUE_ID,
      createdByUserId: USER_ID,
      expiresAt: new Date("2026-09-30T00:00:00.000Z"),
      maxUses: 12,
    });
    const [row] = await db.select().from(leagueInvites).where(eq(leagueInvites.code, "SUNDAY12"));
    expect(row).toMatchObject({ leagueId: LEAGUE_ID, maxUses: 12, uses: 0 });
    await expect(
      db.insert(leagueInvites).values({
        code: "SUNDAY12", leagueId: LEAGUE_ID, createdByUserId: USER_ID,
        expiresAt: new Date("2026-09-30T00:00:00.000Z"), maxUses: 1,
      }),
    ).rejects.toThrow();
  });

  it("stores one lineup row per team, week and slot", async () => {
    await seedLeague();
    await db.insert(lineupSlots).values([
      { teamId: TEAM_ID, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb1" },
      { teamId: TEAM_ID, weekNumber: 2, slot: "QB", slotIndex: 0, playerId: "qb2" },
    ]);
    const rows = await db.select().from(lineupSlots).where(eq(lineupSlots.teamId, TEAM_ID));
    expect(rows).toHaveLength(2);
    await expect(
      db.insert(lineupSlots).values({ teamId: TEAM_ID, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb3" }),
    ).rejects.toThrow();
  });

  it("drops both when the league goes away", async () => {
    await seedLeague();
    await db.insert(leagueInvites).values({
      code: "GONE1234", leagueId: LEAGUE_ID, createdByUserId: USER_ID,
      expiresAt: new Date("2026-09-30T00:00:00.000Z"), maxUses: 1,
    });
    await db.insert(lineupSlots).values({ teamId: TEAM_ID, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: "qb1" });
    await db.delete(leagues).where(eq(leagues.id, LEAGUE_ID));
    expect(await db.select().from(leagueInvites)).toEqual([]);
    expect(await db.select().from(lineupSlots)).toEqual([]);
  });
});
