import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { leagues, matchups, rosterSlots, teams, users } from "@/db/schema";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { totalRosterSlots } from "@/draft-engine";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { computeStandings, LEAGUE_CONFIG } from "@/league";
import { DEV_SEED } from "./config";
import { seedPlayers } from "./seed-players";
import { seedSeasonLeague } from "./seed-season-league";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };

beforeEach(async () => {
  await truncateAll(db);
  await seedPlayers(db, createMockStatsProvider());
});

afterAll(async () => {
  await truncateAll(db);
});

describe("seedSeasonLeague", () => {
  it("creates a full 12-team league with drafted rosters and a scored season", async () => {
    const counts = await seedSeasonLeague(db, clock);
    expect(counts).toEqual({
      teams: DEV_SEED.teamCount,
      weeks: LEAGUE_CONFIG.regularSeasonWeeks,
      scoredWeeks: LEAGUE_CONFIG.regularSeasonWeeks,
    });

    const teamRows = await db.select().from(teams).where(eq(teams.leagueId, DEV_SEED.season.leagueId));
    expect(teamRows).toHaveLength(12);

    // Every team's roster is completely filled, and every slot is legal by construction.
    const perTeam = totalRosterSlots(STANDARD_ROSTER_SLOTS);
    for (const team of teamRows) {
      const slots = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, team.id));
      expect(slots).toHaveLength(perTeam);
      expect(slots.every((slot) => slot.playerId !== null)).toBe(true);
    }

    // No player is on two rosters.
    const allSlots = await db.select().from(rosterSlots);
    const owned = allSlots.map((slot) => slot.playerId);
    expect(new Set(owned).size).toBe(owned.length);

    const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, DEV_SEED.season.leagueId));
    expect(matchupRows).toHaveLength(LEAGUE_CONFIG.regularSeasonWeeks * 6);
    expect(matchupRows.every((row) => row.homeScore !== null && row.awayScore !== null)).toBe(true);
    // Real scores, not a table of zeroes.
    expect(matchupRows.some((row) => (row.homeScore ?? 0) > 0)).toBe(true);

    const standings = computeStandings({ teamIds: teamRows.map((row) => row.id), matchups: matchupRows });
    const games = standings.reduce((sum, row) => sum + row.wins + row.losses + row.ties, 0);
    expect(games).toBe(LEAGUE_CONFIG.regularSeasonWeeks * 12);
  });

  it("is safe to run twice", async () => {
    await seedSeasonLeague(db, clock);
    const before = await db.select().from(matchups).where(eq(matchups.leagueId, DEV_SEED.season.leagueId));
    await seedSeasonLeague(db, clock);
    const after = await db.select().from(matchups).where(eq(matchups.leagueId, DEV_SEED.season.leagueId));
    expect(after).toHaveLength(before.length);
    expect(await db.select().from(rosterSlots)).toHaveLength(12 * totalRosterSlots(STANDARD_ROSTER_SLOTS));
  });

  it("hands team 1 to the claiming user when one is given", async () => {
    // The claim id is a real (WorkOS) user id — its `users` row already exists from the
    // AuthKit callback by the time anyone would run the seed while signed in. Mirrors the
    // same setup in seed-dev-leagues.test.ts.
    await db.insert(users).values({ id: "workos_user_123", email: "workos_user_123@test.local", displayName: "Claim User" });
    await seedSeasonLeague(db, clock, "workos_user_123");
    const [league] = await db.select().from(leagues).where(eq(leagues.id, DEV_SEED.season.leagueId));
    expect(league!.commissionerUserId).toBe("workos_user_123");
  });
});
