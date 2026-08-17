import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "./test-db";
import { users, leagues, teams, scoringSettings } from "./schema";
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
      inviteCode: "SUNDAY1",
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
      inviteCode: "CODE1",
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
