import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@research-ts/db/client";
import { countingDb, createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players, playerStatLines } from "@research-ts/db/schema";
import { drafts, rosterSlots, teams, users } from "@/db/schema";
import { ADVISOR_CONFIG } from "@/domain/advisor";
import { createLeague } from "@/league-service/creation";
import { writeSchedule } from "@/league-service/schedule";
import { finalizeWeek } from "@/stats-pipeline/finalize";
import { assembleAdvisorContext, valuePlayers } from "./context";
import { advisorFixture } from "@/league-service/test-support";

const ADVISOR_SLOTS = [{ slot: "QB" as const, count: 1, eligiblePositions: ["QB" as const] }];

const db: Db = createTestDb();

beforeEach(async () => {
  await truncateAll(db);
});

describe("assembleAdvisorContext", () => {
  it("carries the league's own name, week, scoring settings and both rosters", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });

    expect(context).not.toBeNull();
    if (context === null) return;
    expect(context.leagueName).toBe("Sunday Money");
    expect(context.weekNumber).toBe(4);
    expect(context.scoring.pointsPerReception).toBe(1);
    expect(context.me.teamName).toBe("Bay Bandits");
    expect(context.me.players.map((p) => p.playerId).sort()).toEqual(["rb_bell", "rb_change", "wr_deep", "wr_volume"]);
    expect(context.opponent?.teamName).toBe("Iron Owls");
  });

  it("bounds recent form to ADVISOR_CONFIG.trendWeeks — no unbounded stat read", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });
    for (const player of context!.me.players) {
      expect(player.recentPoints.length).toBeLessThanOrEqual(ADVISOR_CONFIG.trendWeeks);
    }
  });

  it("values the SAME roster differently under PPR and standard scoring", async () => {
    const ppr = await advisorFixture(db, "ppr", "_ppr");
    const pprContext = await assembleAdvisorContext(db, { ...ppr, weekNumber: 4 });
    const standard = await advisorFixture(db, "standard", "_std");
    const standardContext = await assembleAdvisorContext(db, { ...standard, weekNumber: 4 });

    const volumeInPpr = pprContext!.me.players.find((p) => p.playerId === "wr_volume")!;
    const volumeInStandard = standardContext!.me.players.find((p) => p.playerId === "wr_volume")!;
    // 10 catches a week is ten points a week of difference, and nothing else changed.
    expect(volumeInPpr.averagePoints - volumeInStandard.averagePoints).toBe(10);

    // And the ORDER flips: the volume receiver outscores the deep threat only under PPR.
    const deepInPpr = pprContext!.me.players.find((p) => p.playerId === "wr_deep")!;
    const deepInStandard = standardContext!.me.players.find((p) => p.playerId === "wr_deep")!;
    expect(volumeInPpr.averagePoints).toBeGreaterThan(deepInPpr.averagePoints);
    expect(volumeInStandard.averagePoints).toBeLessThan(deepInStandard.averagePoints);
  });

  it("marks who is currently starting, straight off the stored lineup", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });
    const starting = context!.me.players.filter((p) => p.starting).map((p) => p.playerId).sort();
    expect(starting).toEqual(["rb_bell", "wr_deep"]);
  });

  it("returns a context with no opponent for a week with no matchup", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 99 });
    expect(context?.opponent).toBeNull();
  });

  it("returns null for a league that doesn't exist", async () => {
    expect(await assembleAdvisorContext(db, { leagueId: "nope", teamId: "nope", weekNumber: 1 })).toBeNull();
  });

  /**
   * Fix round 1 (F2): the median-record fix (`formatTeamRecord`/`computeStandings`, above) folded
   * its `weeks` read into the SAME query `matchups` already ran (a `leftJoin`, not a second round
   * trip) rather than adding one — this pins that at ZERO added queries, not merely "some bounded
   * number." Real stakes: `assembleAdvisorContext` is called TWICE per action on both the trade
   * propose path (`league-service/trades.ts`) and the accept-time fairness re-check
   * (`integrity-service/trade-fairness.ts`), so a silent extra read here is a silent extra FOUR
   * round trips on those paths. Six: `leagues`, `scoring_settings`, `teams`, the joined `matchups`
   * (median included), `player_stat_lines`, `players` — plus two more per team fielded
   * (`getLineup`'s own `lineup_slots` and, absent a saved lineup, `roster_slots`) — `advisorFixture`
   * saves no lineup for either team and has an opponent, so `me` and `opponent` each cost 2.
   */
  it("costs a bounded, MEASURED number of queries — the weeks read rides the matchups query, not a new one", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const counting = countingDb(db);
    const context = await assembleAdvisorContext(counting.db, { ...fixture, weekNumber: 4 });
    expect(context).not.toBeNull();
    expect(counting.selectCount()).toBe(10);
    // And the fold is real, not a coincidence of this fixture's own shape: `weeks` is reached
    // through a JOIN clause on the matchups query, never as its own standalone FROM — zero
    // queries whose own FROM table is `weeks`, exactly one query whose JOIN names it.
    expect(counting.queriesMatching(/from "weeks"/i)).toBe(0);
    expect(counting.queriesMatching(/join "weeks"/i)).toBe(1);
  });
});

describe("assembleAdvisorContext — the record", () => {
  const clock = { now: () => "2026-08-17T12:00:00.000Z" };
  let nextId = 0;
  const newId = () => `id_rec_${++nextId}`;

  /** Two teams, one QB slot each, a week-1 stat line per quarterback, and the median toggle the
   *  caller asks for — enough for `finalizeWeek` to produce a real, scored record. */
  async function twoTeamLeague(medianGame: boolean) {
    await db.insert(users).values([
      { id: "u_rec1", email: "u_rec1@test.local", displayName: "Manager 1" },
      { id: "u_rec2", email: "u_rec2@test.local", displayName: "Manager 2" },
    ]);
    const created = await createLeague({ db, clock, newId }, {
      name: "Record League", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
      rosterSlots: ADVISOR_SLOTS, owner: { kind: "member", userId: "u_rec1", teamName: "Team One" },
      experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false, medianGame,
    });
    if (!created.ok) throw new Error(created.reason);
    const teamId = created.teamId;
    if (teamId === null) throw new Error("expected a team id");
    await db.insert(teams).values({ id: "team_rec2", leagueId: created.leagueId, userId: "u_rec2", name: "Team Two" });
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, created.leagueId));
    await db.insert(players).values([
      { id: "qb_rec1", name: "QB One", position: "QB", nflTeam: "KC" },
      { id: "qb_rec2", name: "QB Two", position: "QB", nflTeam: "SF" },
    ]);
    await db.insert(playerStatLines).values([
      { playerId: "qb_rec1", week: 1, passingYards: 300, passingTouchdowns: 3 },
      { playerId: "qb_rec2", week: 1, passingYards: 100, passingTouchdowns: 0 },
    ]);
    await db.insert(rosterSlots).values([
      { teamId, slot: "QB", slotIndex: 0, playerId: "qb_rec1" },
      { teamId: "team_rec2", slot: "QB", slotIndex: 0, playerId: "qb_rec2" },
    ]);
    await db.transaction((tx) => writeSchedule(tx, { leagueId: created.leagueId, teamIds: [teamId, "team_rec2"], weeks: 1 }));
    return { leagueId: created.leagueId, teamId, opponentTeamId: "team_rec2" };
  }

  it("reports the SAME record the standings page would, off finished matchups", async () => {
    const league = await twoTeamLeague(false);
    await finalizeWeek(db, league.leagueId, 1);
    const context = await assembleAdvisorContext(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 2 });
    expect(context!.me.record).toBe("1-0");
    const opponentContext = await assembleAdvisorContext(db, { leagueId: league.leagueId, teamId: league.opponentTeamId, weekNumber: 2 });
    expect(opponentContext!.me.record).toBe("0-1");
  });

  it("folds the league median's own result into the record for a league with the toggle on", async () => {
    // Two teams, so the median is the average of both scores: the head-to-head winner also
    // clears it and the loser also misses it, doubling both records rather than leaving them
    // exactly where the head-to-head-only computation used to freeze them.
    const league = await twoTeamLeague(true);
    await finalizeWeek(db, league.leagueId, 1);
    const context = await assembleAdvisorContext(db, { leagueId: league.leagueId, teamId: league.teamId, weekNumber: 2 });
    expect(context!.me.record).toBe("2-0");
    const opponentContext = await assembleAdvisorContext(db, { leagueId: league.leagueId, teamId: league.opponentTeamId, weekNumber: 2 });
    expect(opponentContext!.me.record).toBe("0-2");
  });
});

describe("valuePlayers", () => {
  it("picks out named players with their per-week value, ignoring ids the team doesn't have", async () => {
    const fixture = await advisorFixture(db, "ppr");
    const context = await assembleAdvisorContext(db, { ...fixture, weekNumber: 4 });
    const valued = valuePlayers(context!.me, ["rb_bell", "not_on_this_team"]);
    expect(valued.map((p) => p.playerId)).toEqual(["rb_bell"]);
    expect(valued[0]?.averagePoints).toBeGreaterThan(0);
  });
});
