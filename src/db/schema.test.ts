import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "./test-db";
import { users, leagues, teams, scoringSettings, leagueInvites, lineupSlots, statWeeks, userPreferences, reviews, reviewReports } from "./schema";
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

describe("stat_weeks", () => {
  it("round-trips the enum's three values and the row's defaults", async () => {
    await db.insert(statWeeks).values({ week: 1 });
    await db.insert(statWeeks).values({ week: 2, status: "in_progress" });
    await db.insert(statWeeks).values({ week: 3, status: "final", version: 5, gamesTotal: 16, gamesFinal: 16 });

    const [scheduled] = await db.select().from(statWeeks).where(eq(statWeeks.week, 1));
    expect(scheduled).toMatchObject({ status: "scheduled", version: 0, gamesTotal: 0, gamesFinal: 0 });

    const [inProgress] = await db.select().from(statWeeks).where(eq(statWeeks.week, 2));
    expect(inProgress?.status).toBe("in_progress");

    const [final] = await db.select().from(statWeeks).where(eq(statWeeks.week, 3));
    expect(final).toMatchObject({ status: "final", version: 5, gamesTotal: 16, gamesFinal: 16 });

    await expect(db.insert(statWeeks).values({ week: 1 })).rejects.toThrow();
  });
});

describe("user_preferences", () => {
  it("defaults to guided help and an undismissed tour, one row per user", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(userPreferences).values({ userId: "u1" });

    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, "u1"));
    expect(row).toMatchObject({ userId: "u1", helpLevel: "guided", draftTourDismissedAt: null });

    await expect(db.insert(userPreferences).values({ userId: "u1" })).rejects.toThrow();
  });

  it("round-trips the standard help level and a dismissal timestamp", async () => {
    await db.insert(users).values({ id: "u2", email: "u2@example.com", displayName: "u2" });
    await db.insert(userPreferences).values({
      userId: "u2",
      helpLevel: "standard",
      draftTourDismissedAt: new Date("2026-08-19T00:00:00.000Z"),
    });

    const [row] = await db.select().from(userPreferences).where(eq(userPreferences.userId, "u2"));
    expect(row?.helpLevel).toBe("standard");
    expect(row?.draftTourDismissedAt?.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("drops the preferences row when the user goes away", async () => {
    await db.insert(users).values({ id: "u3", email: "u3@example.com", displayName: "u3" });
    await db.insert(userPreferences).values({ userId: "u3" });
    await db.delete(users).where(eq(users.id, "u3"));
    expect(await db.select().from(userPreferences).where(eq(userPreferences.userId, "u3"))).toEqual([]);
  });
});

describe("reviews", () => {
  it("enforces one review per user", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(reviews).values({ id: "r1", userId: "u1", rating: 5, body: "Great platform, no complaints at all." });
    await expect(
      db.insert(reviews).values({ id: "r2", userId: "u1", rating: 1, body: "Changed my mind, this is terrible now." }),
    ).rejects.toThrow();
  });

  it("round-trips the removal stamp without deleting the row", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(users).values({ id: "operator", email: "operator@example.com", displayName: "operator" });
    await db.insert(reviews).values({ id: "r1", userId: "u1", rating: 1, body: "This league ate my roster overnight." });
    await db
      .update(reviews)
      .set({ removedAt: new Date("2026-08-19T00:00:00.000Z"), removedByUserId: "operator", removalReason: "spam" })
      .where(eq(reviews.id, "r1"));

    const [row] = await db.select().from(reviews).where(eq(reviews.id, "r1"));
    expect(row).toMatchObject({
      userId: "u1",
      body: "This league ate my roster overnight.",
      removedByUserId: "operator",
      removalReason: "spam",
    });
    expect(row?.removedAt?.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("drops a user's review when the user goes away", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(reviews).values({ id: "r1", userId: "u1", rating: 3, body: "Solid league, would recommend to friends." });
    await db.delete(users).where(eq(users.id, "u1"));
    expect(await db.select().from(reviews).where(eq(reviews.id, "r1"))).toEqual([]);
  });
});

describe("review_reports", () => {
  it("is idempotent by the (review, reporter) pair, and drops when the review goes away", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@example.com", displayName: "u1" });
    await db.insert(users).values({ id: "u2", email: "u2@example.com", displayName: "u2" });
    await db.insert(reviews).values({ id: "r1", userId: "u1", rating: 1, body: "This league ate my roster overnight." });
    await db.insert(reviewReports).values({ reviewId: "r1", reporterUserId: "u2", reason: "spam" });
    await expect(
      db.insert(reviewReports).values({ reviewId: "r1", reporterUserId: "u2", reason: "abusive" }),
    ).rejects.toThrow();

    await db.delete(reviews).where(eq(reviews.id, "r1"));
    expect(await db.select().from(reviewReports)).toEqual([]);
  });
});
