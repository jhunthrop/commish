import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftPicks, drafts, matchups, rosterSlots, weeks } from "@/db/schema";
import { LEAGUE_CONFIG } from "@/league";
import { leagueHome, matchupWeek, scoreWeek } from "@/league-service";
import { runRealDraft, seedWeekStats } from "./pipeline";

const db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * The proof the v1 review asked for, for BOTH formats: a real draft, run through the real
 * store, committed by the store's own commit-on-completion, then read back through the exact
 * functions the standings and matchup PAGES call. No hand-written roster rows anywhere.
 */
describe.each(["snake", "auction"] as const)("a real %s draft becomes a real season", (format) => {
  it("commits every pick onto the rosters the league home then renders", async () => {
    const league = await runRealDraft(db, format, `pipe_${format}`);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, league.draftId));
    expect(draft?.status).toBe("complete");

    const picks = await db
      .select()
      .from(draftPicks)
      .where(eq(draftPicks.draftId, league.draftId))
      .orderBy(asc(draftPicks.pickNumber));
    expect(picks).toHaveLength(league.teamIds.length * 3);
    expect(new Set(picks.map((pick) => pick.playerId)).size).toBe(picks.length);
    // An auction pick carries the price it cleared at; a snake pick has none.
    expect(picks.every((pick) => (format === "auction" ? pick.price !== null : pick.price === null))).toBe(true);

    // What the DRAFT produced, per team.
    const draftedByTeam = new Map<string, string[]>();
    for (const pick of picks) {
      draftedByTeam.set(pick.teamId, [...(draftedByTeam.get(pick.teamId) ?? []), pick.playerId]);
    }

    // What the SEASON believes each team owns.
    for (const teamId of league.teamIds) {
      const slots = await db.select().from(rosterSlots).where(eq(rosterSlots.teamId, teamId));
      expect(slots).toHaveLength(3);
      expect([...slots.map((slot) => slot.slot)].sort()).toEqual(["QB", "RB", "WR"]);
      expect(slots.map((slot) => slot.playerId).filter((id): id is string => id !== null).sort()).toEqual(
        [...(draftedByTeam.get(teamId) ?? [])].sort(),
      );
    }

    // And the page-level read agrees with both.
    const home = await leagueHome(db, league.leagueId, league.userIds[0]!);
    expect(home).not.toBeNull();
    expect(home!.draftStatus).toBe("complete");
    expect(home!.standings).toHaveLength(league.teamIds.length);
  });

  it("writes the whole season's fixtures in the same transaction that finishes the draft", async () => {
    const league = await runRealDraft(db, format, `sched_${format}`);

    const weekRows = await db.select().from(weeks).where(eq(weeks.leagueId, league.leagueId));
    expect(weekRows).toHaveLength(LEAGUE_CONFIG.regularSeasonWeeks);
    const matchupRows = await db.select().from(matchups).where(eq(matchups.leagueId, league.leagueId));
    expect(matchupRows.length).toBeGreaterThan(0);

    const home = await leagueHome(db, league.leagueId, league.userIds[0]!);
    expect(home!.totalWeeks).toBe(LEAGUE_CONFIG.regularSeasonWeeks);
    expect(home!.myMatchup).not.toBeNull();
  });

  it("scores week 1 off the drafted rosters and moves the standings", async () => {
    const league = await runRealDraft(db, format, `score_${format}`);
    await seedWeekStats(db, 1);

    const scored = await scoreWeek(db, league.leagueId, 1);
    expect(scored.ok).toBe(true);

    const week = await matchupWeek(db, league.leagueId, 1, league.userIds[0]!);
    expect(week).not.toBeNull();
    expect(week!.matchups.length).toBeGreaterThan(0);
    for (const detail of week!.matchups) {
      expect(detail.final).toBe(true);
      // Every starter on the board came out of the draft, not out of a fixture.
      expect(detail.home.starters.every((entry) => entry.playerId !== null)).toBe(true);
      expect(detail.away.starters.every((entry) => entry.playerId !== null)).toBe(true);
    }

    const home = await leagueHome(db, league.leagueId, league.userIds[0]!);
    const played = home!.standings.reduce((total, row) => total + row.wins + row.losses + row.ties, 0);
    expect(played).toBeGreaterThan(0);
  });
});
