import { beforeEach, describe, expect, it } from "vitest";
import { leagues, matchups, teams, users, weeks } from "@/db/schema";
import { countingDb, createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import type { Db } from "@research/db/client";
import { headToHeadKey, LEAGUE_CONFIG, type HeadToHeadRecord } from "@/league";
import { cachedHeadToHeadRecords, headToHeadRecords, recordsForTeam } from "./head-to-head";

const db: Db = createTestDb();

const SEASON = new Date(LEAGUE_CONFIG.season.startedAt).getUTCFullYear();

async function fixture(): Promise<void> {
  await db.insert(users).values([
    { id: "u_me", email: "me@test.local", displayName: "Justin Hunthrop" },
    { id: "u_rey", email: "rey@test.local", displayName: "Rey Moreno" },
    { id: "u_dana", email: "dana@test.local", displayName: "Dana Kwon" },
  ]);
  await db.insert(leagues).values({ id: "l1", name: "L1", format: "snake", teamCount: 3, commissionerUserId: "u_me" });
  await db.insert(teams).values([
    { id: "t_me", leagueId: "l1", userId: "u_me", name: "Sunday Scaries" },
    { id: "t_rey", leagueId: "l1", userId: "u_rey", name: "Trap Game" },
    { id: "t_dana", leagueId: "l1", userId: "u_dana", name: "Bye Week" },
  ]);
  await db.insert(weeks).values([1, 2, 3, 4, 5, 6].map((weekNumber) => ({ leagueId: "l1", weekNumber })));
}

interface Game {
  readonly week: number;
  readonly home: string;
  readonly away: string;
  readonly homeScore: number | null;
  readonly awayScore: number | null;
}

async function play(games: readonly Game[]): Promise<void> {
  await db.insert(matchups).values(
    games.map((game) => ({
      leagueId: "l1",
      weekNumber: game.week,
      homeTeamId: game.home,
      awayTeamId: game.away,
      homeScore: game.homeScore,
      awayScore: game.awayScore,
    })),
  );
}

beforeEach(async () => {
  await truncateAll(db);
  await fixture();
});

describe("headToHeadRecords", () => {
  it("counts settled games between the same two managers, from both sides, across home and away", async () => {
    await play([
      { week: 1, home: "t_me", away: "t_rey", homeScore: 110, awayScore: 90 },
      { week: 2, home: "t_rey", away: "t_me", homeScore: 80, awayScore: 101 },
      { week: 3, home: "t_me", away: "t_rey", homeScore: 70, awayScore: 99 },
    ]);
    const records = await headToHeadRecords(db, "l1");
    expect(records.get(headToHeadKey("t_me", "t_rey"))).toEqual({ wins: 2, losses: 1, ties: 0, seasons: [SEASON] });
    expect(records.get(headToHeadKey("t_rey", "t_me"))).toEqual({ wins: 1, losses: 2, ties: 0, seasons: [SEASON] });
  });

  it("counts a tie as a tie, on both sides", async () => {
    await play([{ week: 1, home: "t_me", away: "t_rey", homeScore: 100, awayScore: 100 }]);
    const records = await headToHeadRecords(db, "l1");
    expect(records.get(headToHeadKey("t_me", "t_rey"))).toEqual({ wins: 0, losses: 0, ties: 1, seasons: [SEASON] });
    expect(records.get(headToHeadKey("t_rey", "t_me"))).toEqual({ wins: 0, losses: 0, ties: 1, seasons: [SEASON] });
  });

  it("leaves out a week nobody has settled, and a pair that has never played", async () => {
    await play([
      { week: 1, home: "t_me", away: "t_rey", homeScore: null, awayScore: null },
      { week: 2, home: "t_me", away: "t_rey", homeScore: 101, awayScore: null },
      { week: 3, home: "t_me", away: "t_dana", homeScore: null, awayScore: null },
    ]);
    const records = await headToHeadRecords(db, "l1");
    expect(records.size).toBe(0);
  });

  it("holds nothing at all for a league that has settled nothing", async () => {
    expect((await headToHeadRecords(db, "l1")).size).toBe(0);
  });

  it("never counts another league's games", async () => {
    await db.insert(leagues).values({ id: "l2", name: "L2", format: "snake", teamCount: 2, commissionerUserId: "u_me" });
    await db.insert(teams).values([
      { id: "t2_me", leagueId: "l2", userId: "u_me", name: "Elsewhere" },
      { id: "t2_rey", leagueId: "l2", userId: "u_rey", name: "Also Elsewhere" },
    ]);
    await db.insert(weeks).values({ leagueId: "l2", weekNumber: 1 });
    await play([{ week: 1, home: "t_me", away: "t_rey", homeScore: 110, awayScore: 90 }]);
    await db.insert(matchups).values({ leagueId: "l2", weekNumber: 1, homeTeamId: "t2_me", awayTeamId: "t2_rey", homeScore: 1, awayScore: 200 });

    const records = await headToHeadRecords(db, "l1");
    expect(records.get(headToHeadKey("t_me", "t_rey"))).toEqual({ wins: 1, losses: 0, ties: 0, seasons: [SEASON] });
    expect(records.get(headToHeadKey("t2_me", "t2_rey"))).toBeUndefined();
  });

  it("keeps every pair in the league apart", async () => {
    await play([
      { week: 1, home: "t_me", away: "t_rey", homeScore: 110, awayScore: 90 },
      { week: 2, home: "t_me", away: "t_dana", homeScore: 60, awayScore: 130 },
    ]);
    const records = await headToHeadRecords(db, "l1");
    expect(records.get(headToHeadKey("t_me", "t_rey"))?.wins).toBe(1);
    expect(records.get(headToHeadKey("t_me", "t_dana"))).toEqual({ wins: 0, losses: 1, ties: 0, seasons: [SEASON] });
  });

  it("is one query for the whole league, however many pairs have played", async () => {
    await play([
      { week: 1, home: "t_me", away: "t_rey", homeScore: 110, awayScore: 90 },
      { week: 2, home: "t_me", away: "t_dana", homeScore: 60, awayScore: 130 },
      { week: 3, home: "t_rey", away: "t_dana", homeScore: 99, awayScore: 99 },
    ]);
    const counted = countingDb(db);
    await headToHeadRecords(counted.db, "l1");
    expect(counted.selectCount()).toBe(1);
  });
});

describe("recordsForTeam", () => {
  it("keys one team's own pairings by the opponent, and leaves every other pair behind", async () => {
    await play([
      { week: 1, home: "t_me", away: "t_rey", homeScore: 110, awayScore: 90 },
      { week: 2, home: "t_rey", away: "t_dana", homeScore: 120, awayScore: 60 },
    ]);
    const mine = recordsForTeam(await headToHeadRecords(db, "l1"), "t_me");
    expect([...mine.keys()]).toEqual(["t_rey"]);
    expect(mine.get("t_rey")).toEqual({ wins: 1, losses: 0, ties: 0, seasons: [SEASON] });
  });

  it("answers empty for a commissioner with no team of their own", async () => {
    await play([{ week: 1, home: "t_me", away: "t_rey", homeScore: 110, awayScore: 90 }]);
    expect(recordsForTeam(await headToHeadRecords(db, "l1"), null).size).toBe(0);
  });

  it("answers empty for a team that has settled nothing", async () => {
    await play([{ week: 1, home: "t_me", away: "t_rey", homeScore: 110, awayScore: 90 }]);
    expect(recordsForTeam(await headToHeadRecords(db, "l1"), "t_dana").size).toBe(0);
  });
});

describe("cachedHeadToHeadRecords", () => {
  function fakeCache() {
    const held = new Map<string, ReadonlyMap<string, HeadToHeadRecord>>();
    const calls: string[] = [];
    return {
      held,
      calls,
      read: async (leagueId: string, week: number) => {
        calls.push(`read ${leagueId} ${week}`);
        return held.get(`${leagueId}:${week}`) ?? null;
      },
      write: async (leagueId: string, week: number, records: ReadonlyMap<string, HeadToHeadRecord>) => {
        calls.push(`write ${leagueId} ${week}`);
        held.set(`${leagueId}:${week}`, records);
      },
    };
  }

  beforeEach(async () => {
    await play([{ week: 1, home: "t_me", away: "t_rey", homeScore: 110, awayScore: 90 }]);
  });

  it("computes on a miss, stores what it computed, and serves the second read from the cache", async () => {
    const cache = fakeCache();
    const first = await cachedHeadToHeadRecords(db, "l1", 3, cache);
    expect(first.get(headToHeadKey("t_me", "t_rey"))?.wins).toBe(1);
    expect(cache.calls).toEqual(["read l1 3", "write l1 3"]);

    const counted = countingDb(db);
    const second = await cachedHeadToHeadRecords(counted.db, "l1", 3, cache);
    expect(second.get(headToHeadKey("t_me", "t_rey"))?.wins).toBe(1);
    expect(counted.selectCount()).toBe(0);
  });

  it("keeps one answer per week, so the week rolling forward is itself a miss", async () => {
    const cache = fakeCache();
    await cachedHeadToHeadRecords(db, "l1", 3, cache);
    await cachedHeadToHeadRecords(db, "l1", 4, cache);
    expect(cache.calls).toEqual(["read l1 3", "write l1 3", "read l1 4", "write l1 4"]);
  });

  it("reads straight through with no cache wired at all", async () => {
    const records = await cachedHeadToHeadRecords(db, "l1", 3);
    expect(records.get(headToHeadKey("t_me", "t_rey"))?.wins).toBe(1);
  });
});
