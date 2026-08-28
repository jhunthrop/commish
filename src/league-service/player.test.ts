import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { createTestDb, truncateAll } from "@/db/test-db";
import { matchups, players, playerStatLines, statWeeks, teams, users } from "@/db/schema";
import type { StatLine } from "@/domain/player";
import { createLeague } from "./creation";
import { playerSeason } from "./player";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const SLOTS = [
  { slot: "RB" as const, count: 1, eligiblePositions: ["RB" as const] },
  { slot: "BENCH" as const, count: 1, eligiblePositions: ["RB" as const] },
];

const EMPTY_LINE: Omit<StatLine, "playerId" | "week"> = {
  passingYards: 0,
  passingTouchdowns: 0,
  interceptions: 0,
  rushingYards: 0,
  rushingTouchdowns: 0,
  receivingYards: 0,
  receivingTouchdowns: 0,
  receptions: 0,
  fumblesLost: 0,
  fieldGoalsMade: 0,
  extraPointsMade: 0,
  sacks: 0,
  defensiveInterceptions: 0,
  defensiveTouchdowns: 0,
};

/** A rushing week worth exactly `yards / 10` points under every preset this test uses. */
const rushingWeek = (playerId: string, week: number, yards: number) => ({ ...EMPTY_LINE, playerId, week, rushingYards: yards });

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

/**
 * One league with a three-week schedule, three running backs, and stat lines in weeks 1 through
 * 3 — but only weeks 1 and 2 marked played. Week 3's rows exist ON PURPOSE: the product's own
 * dataset carries stat lines for weeks nobody has played yet, and the whole point of the
 * `stat_weeks` gate is that those rows are not results.
 */
async function league() {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Duel", format: "snake", teamCount: 2, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false, medianGame: false,
  });
  if (!created.ok) throw new Error(created.reason);
  const leagueId = created.leagueId;

  const homeTeamId = created.teamId;
  if (homeTeamId === null) throw new Error("expected a team id");
  await db.insert(teams).values({ id: "team_2", leagueId, userId: "u2", name: "Team Two" });
  // Three fixtures, so the league's own season is three weeks long — which is what caps the
  // chart's week list independently of how many NFL weeks have been played.
  await db.insert(matchups).values([1, 2, 3].map((weekNumber) => ({ leagueId, weekNumber, homeTeamId, awayTeamId: "team_2" })));
  await db.insert(statWeeks).values([
    { week: 1, status: "final" as const },
    { week: 2, status: "final" as const },
    { week: 3, status: "scheduled" as const },
  ]);
  await db.insert(players).values([
    { id: "rb1", name: "Rashad Long", position: "RB" as const, nflTeam: "SF", headshotUrl: null, adp: 2.5 },
    { id: "rb2", name: "Second Back", position: "RB" as const, nflTeam: "NYG", headshotUrl: null, adp: 9.5 },
    { id: "rb3", name: "Unranked Back", position: "RB" as const, nflTeam: "LV", headshotUrl: null, adp: null },
    { id: "wr1", name: "A Receiver", position: "WR" as const, nflTeam: "CIN", headshotUrl: null, adp: 1.5 },
  ]);
  await db.insert(playerStatLines).values([
    rushingWeek("rb1", 1, 200),
    // Week 2 happened WITHOUT rb1 — no row at all.
    rushingWeek("rb1", 3, 999),
    rushingWeek("rb2", 1, 50),
    rushingWeek("rb2", 2, 60),
  ]);
  return leagueId;
}

describe("playerSeason", () => {
  it("draws only weeks the season has actually played, never weeks that merely have rows", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1"))!;
    // Week 3 has a 999-yard stat line and is `scheduled`. It is not a result and does not appear.
    expect(body.weeks.map((week) => week.week)).toEqual([1, 2]);
  });

  it("keeps 'did not play' and 'played and scored nothing' apart", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1"))!;
    expect(body.weeks[0]!.points).toBe(20);
    // No stat line in week 2. Never coalesced to zero.
    expect(body.weeks[1]!.points).toBeNull();
    expect(body.weeks[1]!.percentile).toBeNull();
  });

  it("averages only the weeks he played, so a bye never drags his average down", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1"))!;
    expect(body.pointsPerGame).toBe(20);
  });

  it("ranks him among his own position by market draft position, lower being earlier", async () => {
    const leagueId = await league();
    // A receiver drafted ahead of him does not move his RB rank; an unranked back is not counted.
    expect((await playerSeason(db, leagueId, "rb1"))!.positionRank).toBe(1);
    expect((await playerSeason(db, leagueId, "rb2"))!.positionRank).toBe(2);
  });

  it("gives an unranked player no rank and no percentile, rather than a last place he never earned", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb3"))!;
    expect(body.positionRank).toBeNull();
    expect(body.adpPercentile).toBeNull();
  });

  it("judges a week against every week played at his position, not against his own season", async () => {
    const leagueId = await league();
    const body = (await playerSeason(db, leagueId, "rb1"))!;
    // The population is rb1's 20.0 and rb2's 5.0 and 6.0 — his week is the best of the three.
    expect(body.weeks[0]!.percentile).toBe(1);
  });

  it("answers null for a player the feed does not carry at all", async () => {
    const leagueId = await league();
    expect(await playerSeason(db, leagueId, "nobody")).toBeNull();
  });
});
