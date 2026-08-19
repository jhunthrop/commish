import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { draftPicks, drafts, matchups, rosterSlots, weeks } from "@/db/schema";
import { AUCTION_CONFIG } from "@/draft-engine";
import { LEAGUE_CONFIG } from "@/league";
import { leagueHome, matchupWeek, scoreWeek } from "@/league-service";
import { AUCTION_WAR_BUDGET, runAuctionDraftWithBiddingWar, runRealDraft, seedWeekStats } from "./pipeline";

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
 *
 * This block's auction runs (`runRealDraft`) drive every turn with TIMER_EXPIRE alone, so every
 * auction pick here clears at the unopposed floor — it proves the commit-on-completion seam for
 * BOTH formats, but on its own it says nothing about `reduceNominate` or `reduceBid`. The
 * dedicated "bidding war" case below, using `runAuctionDraftWithBiddingWar`, is what actually
 * exercises a contested lot end to end.
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
    // An auction pick carries the price it cleared at — here, always the unopposed floor,
    // since this block's drafts never see a competing bid; a snake pick has none.
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

/**
 * The proof the describe.each block above cannot give: `reduceNominate` and `reduceBid`,
 * exercised through the real store, on a lot that is actually contested. Two teams trade real,
 * escalating BIDs against each other after a third team's NOMINATE opens the lot; TIMER_EXPIRE
 * only closes it once that war is over.
 */
describe("a real auction draft's contested lots", () => {
  it("awards a contested lot to the last bidder — not the nominator, and not at the floor", async () => {
    const { league, contests } = await runAuctionDraftWithBiddingWar(db, "war");
    // Two lots, each genuinely contested — the whole point of this test.
    expect(contests).toHaveLength(2);

    for (const contest of contests) {
      // The nominator only opened the lot; a DIFFERENT team, the one who bid last, won it.
      expect(contest.winningTeamId).not.toBe(contest.nominatingTeamId);
      // The price it cleared at is what the winner actually bid, never the unopposed floor.
      expect(contest.finalPrice).toBeGreaterThan(AUCTION_CONFIG.minBid);

      // What the STORE persisted agrees with what the contest resolved to.
      const [pick] = await db
        .select()
        .from(draftPicks)
        .where(and(eq(draftPicks.draftId, league.draftId), eq(draftPicks.playerId, contest.playerId)));
      expect(pick?.teamId).toBe(contest.winningTeamId);
      expect(pick?.price).toBe(contest.finalPrice);
      expect(pick?.price).not.toBe(AUCTION_CONFIG.minBid);

      // And the winner's budget reflects exactly that one deduction — not an approximation.
      expect(contest.winnerBudgetAfter).toBe(AUCTION_WAR_BUDGET - contest.finalPrice);
    }

    // Both lots resolved to different winners, so neither budget check above could be masking
    // a missed deduction from the other lot.
    expect(new Set(contests.map((contest) => contest.winningTeamId)).size).toBe(contests.length);

    const [draft] = await db.select().from(drafts).where(eq(drafts.id, league.draftId));
    expect(draft?.status).toBe("complete");
  });
});
