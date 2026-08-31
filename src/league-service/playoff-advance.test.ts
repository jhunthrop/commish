import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { matchups, teams, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { LEAGUE_CONFIG } from "@/league";
import { advancePlayoffsInTx } from "./playoff-advance";
import { createLeague } from "./creation";

const db = createTestDb();
const RSW = LEAGUE_CONFIG.regularSeasonWeeks;

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

/** A six-team league with a fully-scored regular season whose standings order is t1 > … > t6 by
 *  wins (t1 wins every week against rotating opponents is overkill — a simple fixed table:
 *  every week the same three games with fixed winners produces the clean 1..6 order). */
async function playedOutLeague() {
  await db.insert(users).values(Array.from({ length: 6 }, (_, i) => ({ id: `pu${i + 1}`, email: `pu${i + 1}@test.local`, displayName: `P${i + 1}` })));
  const created = await createLeague(
    { db, clock: { now: () => "2026-08-20T12:00:00.000Z" }, newId: (() => { let n = 0; return () => `po_id_${(n += 1)}`; })() },
    {
      name: "Playoff League", format: "snake", teamCount: 6, scoringPreset: "ppr", auctionBudget: null,
      rosterSlots: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }, { slot: "BENCH", count: 1, eligiblePositions: ["QB"] }],
      owner: { kind: "member", userId: "pu1", teamName: "T1" }, experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
    },
  );
  if (!created.ok) throw new Error(created.reason);
  const leagueId = created.leagueId;
  const teamIds = [created.teamId!, "po_t2", "po_t3", "po_t4", "po_t5", "po_t6"];
  await db.insert(teams).values(teamIds.slice(1).map((id, i) => ({ id, leagueId, userId: `pu${i + 2}`, name: `T${i + 2}` })));

  // Every regular-season week: 1 beats 6, 2 beats 5, 3 beats 4 — margins descending so
  // points-for also orders 1..6 and the seeds are unambiguous.
  const rows = [];
  for (let week = 1; week <= RSW; week++) {
    rows.push(
      { leagueId, weekNumber: week, homeTeamId: teamIds[0]!, awayTeamId: teamIds[5]!, homeScore: 150, awayScore: 60 },
      { leagueId, weekNumber: week, homeTeamId: teamIds[1]!, awayTeamId: teamIds[4]!, homeScore: 140, awayScore: 70 },
      { leagueId, weekNumber: week, homeTeamId: teamIds[2]!, awayTeamId: teamIds[3]!, homeScore: 130, awayScore: 80 },
    );
  }
  await db.insert(matchups).values(rows);
  return { leagueId, teamIds };
}

async function scoreWeek(leagueId: string, week: number, scores: ReadonlyMap<string, number>) {
  const games = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, week)));
  for (const game of games) {
    await db
      .update(matchups)
      .set({ homeScore: scores.get(game.homeTeamId) ?? 0, awayScore: scores.get(game.awayTeamId) ?? 0 })
      .where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, week), eq(matchups.homeTeamId, game.homeTeamId)));
  }
}

describe("advancePlayoffsInTx", () => {
  it("runs the whole bracket: round 1 from final standings, reseeded semis, one championship — idempotently", async () => {
    const { leagueId, teamIds } = await playedOutLeague();
    const [t1, t2, t3, t4, t5, t6] = teamIds;

    // Regular season ends: round 1 appears — 3v6 and 4v5, seeds 1-2 on bye.
    const round1 = await db.transaction((tx) => advancePlayoffsInTx(tx, leagueId, RSW));
    expect(round1).toBe(2);
    const week15 = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, RSW + 1)));
    expect(week15.map((g) => [g.homeTeamId, g.awayTeamId])).toEqual([
      [t3, t6],
      [t4, t5],
    ]);
    // Idempotent: settling the same week again writes nothing.
    expect(await db.transaction((tx) => advancePlayoffsInTx(tx, leagueId, RSW))).toBe(0);

    // Round 1: seed 6 upsets seed 3; seed 4 wins. Reseeded semis: 1 hosts 6, 2 hosts 4.
    await scoreWeek(leagueId, RSW + 1, new Map([[t6!, 120], [t3!, 80], [t4!, 110], [t5!, 90]]));
    expect(await db.transaction((tx) => advancePlayoffsInTx(tx, leagueId, RSW + 1))).toBe(2);
    const week16 = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, RSW + 2)));
    expect(week16.map((g) => [g.homeTeamId, g.awayTeamId])).toEqual([
      [t1, t6],
      [t2, t4],
    ]);

    // Semis: 1 and 4 advance. Championship: better seed hosts.
    await scoreWeek(leagueId, RSW + 2, new Map([[t1!, 130], [t6!, 70], [t4!, 100], [t2!, 95]]));
    expect(await db.transaction((tx) => advancePlayoffsInTx(tx, leagueId, RSW + 2))).toBe(1);
    const week17 = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, RSW + 3)));
    expect(week17.map((g) => [g.homeTeamId, g.awayTeamId])).toEqual([[t1, t4]]);

    // The championship settles: no further round.
    await scoreWeek(leagueId, RSW + 3, new Map([[t1!, 140], [t4!, 100]]));
    expect(await db.transaction((tx) => advancePlayoffsInTx(tx, leagueId, RSW + 3))).toBe(0);
  });

  it("a tied playoff game advances the better seed", async () => {
    const { leagueId, teamIds } = await playedOutLeague();
    const [, , t3, t4, t5, t6] = teamIds;
    await db.transaction((tx) => advancePlayoffsInTx(tx, leagueId, RSW));
    await scoreWeek(leagueId, RSW + 1, new Map([[t3!, 100], [t6!, 100], [t4!, 100], [t5!, 100]]));
    await db.transaction((tx) => advancePlayoffsInTx(tx, leagueId, RSW + 1));
    const week16 = await db.select().from(matchups).where(and(eq(matchups.leagueId, leagueId), eq(matchups.weekNumber, RSW + 2)));
    // Both ties advance the better seeds: 3 and 4 — reseeded, 1 hosts 4 and 2 hosts 3.
    expect(week16.map((g) => g.awayTeamId).sort()).toEqual([t3, t4].sort());
  });
});
