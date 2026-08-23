import { describe, it, expect, afterEach, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll, TEST_DATABASE_URL } from "@/db/test-db";
import { leagues, matchups, rosterSlots, teams, users, weeks } from "@/db/schema";
import { createMockStatsProvider } from "@/stats/mock/mock-stats-provider";
import { totalRosterSlots } from "@/draft-engine";
import { STANDARD_ROSTER_SLOTS } from "@/domain/roster";
import { INTEGRITY_CONFIG } from "@/integrity/config";
import { computeStandings, LEAGUE_CONFIG } from "@/league";
import { completedSeasonsFor } from "@/league-service/participation";
import { participationTierFor } from "@/participation/tier";
import { DEV_SEED } from "./config";
import { ensureDevUsers } from "./dev-users";
import { seedPlayers } from "./seed-players";
import { MEDIAN_DEMO_LEAGUE, seedSeasonLeague, VETERAN_SEASON_LEAGUES } from "./seed-season-league";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };

beforeEach(async () => {
  // `seedPlayers` refuses to run against a database it cannot prove is local (see `guard.ts`).
  // The test database IS local, so say so explicitly rather than letting the guard fail open.
  vi.stubEnv("ALLOW_DESTRUCTIVE_SEED", "1");
  vi.stubEnv("DATABASE_URL", TEST_DATABASE_URL);
  await truncateAll(db);
  await seedPlayers(db, createMockStatsProvider());
});

afterEach(() => {
  vi.unstubAllEnvs();
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
    // Named like the sibling dev leagues — "Team 1" placeholders failed the founder's
    // legibility directive once already.
    expect(teamRows.map((row) => row.name).sort()).toEqual([...DEV_SEED.teamNames].sort());

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

  it("is safe to run twice — same rows AND the same numbers, not just the same counts", async () => {
    await seedSeasonLeague(db, clock);
    const before = await db.select().from(matchups).where(eq(matchups.leagueId, DEV_SEED.season.leagueId));
    const rostersBefore = await db.select().from(rosterSlots);
    await seedSeasonLeague(db, clock);
    const after = await db.select().from(matchups).where(eq(matchups.leagueId, DEV_SEED.season.leagueId));
    // Deep equality: a re-run that duplicated rows, re-dealt different rosters, or re-scored a
    // week to different numbers would all slip past a bare length check. Sorted first —
    // an unordered SELECT does not promise a stable row order across runs.
    const matchupKey = (row: { weekNumber: number; homeTeamId: string }) => `${row.weekNumber}:${row.homeTeamId}`;
    const slotKey = (row: { teamId: string; slot: string; slotIndex: number }) => `${row.teamId}:${row.slot}:${row.slotIndex}`;
    const sortBy = <T,>(rows: readonly T[], key: (row: T) => string): T[] => [...rows].sort((a, b) => key(a).localeCompare(key(b)));
    expect(sortBy(after, matchupKey)).toEqual(sortBy(before, matchupKey));
    expect(sortBy(await db.select().from(rosterSlots), slotKey)).toEqual(sortBy(rostersBefore, slotKey));
    expect(rostersBefore).toHaveLength(12 * totalRosterSlots(STANDARD_ROSTER_SLOTS));
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

  it("does not un-claim a founder's team or commissioner's chair on a re-seed without a claim id", async () => {
    await db.insert(users).values({ id: "workos_user_123", email: "workos_user_123@test.local", displayName: "Claim User" });
    await seedSeasonLeague(db, clock, "workos_user_123");

    // Re-seed WITHOUT a claim id — the scenario the bug required (e.g. a run where
    // DEV_SEED_CLAIM_USER_ID isn't exported). The previously claimed team and chair must hold.
    await seedSeasonLeague(db, clock);

    const [league] = await db.select().from(leagues).where(eq(leagues.id, DEV_SEED.season.leagueId));
    expect(league!.commissionerUserId).toBe("workos_user_123");
    const [team1] = await db.select().from(teams).where(eq(teams.id, `${DEV_SEED.season.leagueId}_team_01`));
    expect(team1!.userId).toBe("workos_user_123");
    // The rest of the roster is still refreshed to the (still-placeholder) dev owners.
    const [team2] = await db.select().from(teams).where(eq(teams.id, `${DEV_SEED.season.leagueId}_team_02`));
    expect(team2!.userId).toBe(`${DEV_SEED.userIdPrefix}02`);
  });
});

describe("VETERAN_SEASON_LEAGUES (Phase 3 Plan D, Task 10, Step 1)", () => {
  it("crosses team 1's owner over the veteran cutoff by finishing three REAL seasons, while every other seeded identity stays below it", async () => {
    for (const config of [DEV_SEED.season, ...VETERAN_SEASON_LEAGUES]) {
      await seedSeasonLeague(db, clock, undefined, config);
    }

    const ownerIds = await ensureDevUsers(db);
    // Team 1's owner (index 0) sat every one of the three playthroughs, in every league —
    // three REAL completed seasons, each stamped by `finalizeWeekInTx` itself.
    const veteranSeasons = await completedSeasonsFor(db, ownerIds[0]!);
    expect(veteranSeasons).toBe(3);
    expect(participationTierFor(veteranSeasons, INTEGRITY_CONFIG.participation.veteranSeasonCutoff)).toBe("veteran");

    // The two `VETERAN_SEASON_LEAGUES` entries deliberately use DISJOINT non-veteran indices
    // (1-3, then 4-6) — every one of THOSE identities sat at most two of the three playthroughs,
    // never three, and stays a newcomer.
    for (const index of [1, 2, 3, 4, 5, 6]) {
      const seasons = await completedSeasonsFor(db, ownerIds[index]!);
      expect(seasons).toBeLessThan(3);
      expect(participationTierFor(seasons, INTEGRITY_CONFIG.participation.veteranSeasonCutoff)).toBe("newcomer");
    }

    // Indices 7-11 never sat in either extra league at all — one completed season, from the
    // primary league only.
    for (const index of [7, 8, 9, 10, 11]) {
      expect(await completedSeasonsFor(db, ownerIds[index]!)).toBe(1);
    }
  });
});

describe("MEDIAN_DEMO_LEAGUE (Phase 3.5, Task 10)", () => {
  it("threads medianGame onto the league row and produces a real second (median) result every week", async () => {
    const counts = await seedSeasonLeague(db, clock, undefined, MEDIAN_DEMO_LEAGUE);
    expect(counts.scoredWeeks).toBe(LEAGUE_CONFIG.regularSeasonWeeks);

    const [league] = await db.select().from(leagues).where(eq(leagues.id, MEDIAN_DEMO_LEAGUE.leagueId));
    expect(league?.medianGame).toBe(true);

    const teamRows = await db.select().from(teams).where(eq(teams.leagueId, MEDIAN_DEMO_LEAGUE.leagueId));
    expect(teamRows).toHaveLength(4);

    const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, MEDIAN_DEMO_LEAGUE.leagueId));
    // The real stored medians (`weeks.median_score`, written by `finalizeWeekInTx`'s own median
    // branch) — never recomputed here, the same read `leagueStandings` (`@/league-service/home.ts`)
    // itself performs before folding them into `computeStandings`.
    const weekRows = await db.select().from(weeks).where(eq(weeks.leagueId, MEDIAN_DEMO_LEAGUE.leagueId));
    const medianByWeek = new Map(weekRows.filter((row) => row.medianScore !== null).map((row) => [row.weekNumber, row.medianScore!]));
    expect(medianByWeek.size).toBe(LEAGUE_CONFIG.regularSeasonWeeks);

    const standings = computeStandings({ teamIds: teamRows.map((row) => row.id), matchups: matchupRows, medianByWeek });
    const games = standings.reduce((sum, row) => sum + row.wins + row.losses + row.ties, 0);
    // Two games a week (head-to-head plus the median game) for every one of the 4 teams — a real
    // second result folded into the SAME wins/losses/ties `computeStandings` already produces.
    expect(games).toBe(LEAGUE_CONFIG.regularSeasonWeeks * 2 * teamRows.length);
  });

  it("stays disjoint from VETERAN_SEASON_LEAGUES' own indices, never pushing a rookie-snake identity over the cutoff", async () => {
    for (const config of [DEV_SEED.season, ...VETERAN_SEASON_LEAGUES, MEDIAN_DEMO_LEAGUE]) {
      await seedSeasonLeague(db, clock, undefined, config);
    }

    const ownerIds = await ensureDevUsers(db);
    for (const index of [1, 2, 3, 4, 5, 6]) {
      const seasons = await completedSeasonsFor(db, ownerIds[index]!);
      expect(seasons).toBeLessThan(INTEGRITY_CONFIG.participation.veteranSeasonCutoff);
    }
    // 7-9 sit in `DEV_SEED.season` AND `MEDIAN_DEMO_LEAGUE` — two completed seasons, still safely
    // under the cutoff.
    for (const index of [7, 8, 9]) {
      expect(await completedSeasonsFor(db, ownerIds[index]!)).toBe(2);
    }
  });
});
