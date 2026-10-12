import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { drafts, leagues, mockRooms, teams, users } from "@/db/schema";
import { myLeaguesOverview } from "./read";

const db = createTestDb();

let seq = 0;

/** One league, its one draft, and a single team for `userId` — the plain member shape every
 *  `myLeaguesOverview` test starts from. */
async function seedRealLeague(userId: string): Promise<string> {
  seq += 1;
  const id = `rlg${seq}`;
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
  await db.insert(leagues).values({ id, name: id, format: "snake", teamCount: 12, commissionerUserId: userId });
  await db.insert(drafts).values({ id: `${id}_draft`, leagueId: id, format: "snake", status: "scheduled", kickoffAt: new Date("2026-09-10T00:00:00.000Z") });
  await db.insert(teams).values({ id: `${id}_team`, leagueId: id, userId, name: "My Team" });
  return id;
}

/** A mock league `userId` is the host (and only seat) of — the shape `myLeaguesOverview` must
 *  keep out of every returned row set entirely, not merely filter out of the final summary. */
async function seedMockLeague(userId: string): Promise<string> {
  seq += 1;
  const id = `mlg${seq}`;
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: userId }).onConflictDoNothing();
  await db.insert(leagues).values({ id, name: id, format: "snake", teamCount: 12, isPublicMatchmade: false, isMock: true, commissionerUserId: userId });
  await db.insert(mockRooms).values({ leagueId: id, hostUserId: userId, mode: "solo", pickSeconds: 60, botSeed: seq, shareCode: `code_${id}`, startsAt: new Date() });
  await db.insert(drafts).values({ id: `${id}_draft`, leagueId: id, format: "snake", status: "in_progress", kickoffAt: new Date("2026-09-10T00:00:00.000Z") });
  await db.insert(teams).values({ id: `${id}_team`, leagueId: id, userId, name: "Host" });
  return id;
}

beforeEach(async () => {
  await truncateAll(db);
  seq = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

describe("myLeaguesOverview — mock exclusion (Phase 4.5, Task 2)", () => {
  it("returns the caller's real leagues untouched when they hold no mock seat at all", async () => {
    const real = await seedRealLeague("u1");
    const overview = await myLeaguesOverview(db, "u1");
    expect(overview.leagueRows.map((row) => row.id)).toEqual([real]);
  });

  it("keeps a mock league the caller hosts out of every returned row set, not only the league list", async () => {
    const mockId = await seedMockLeague("u1");
    const overview = await myLeaguesOverview(db, "u1");

    expect(overview.leagueRows).toHaveLength(0);
    expect(overview.teamRows.some((row) => row.leagueId === mockId)).toBe(false);
    expect(overview.draftRows.some((row) => row.leagueId === mockId)).toBe(false);
    expect(overview.myTeamByLeague.has(mockId)).toBe(false);
  });

  it("returns only the real leagues when the caller holds both a real seat and a mock seat", async () => {
    const real = await seedRealLeague("u1");
    const mockId = await seedMockLeague("u1");

    const overview = await myLeaguesOverview(db, "u1");
    expect(overview.leagueRows.map((row) => row.id)).toEqual([real]);
    expect(overview.teamRows.map((row) => row.leagueId)).toEqual([real]);
    expect(overview.draftRows.map((row) => row.leagueId)).toEqual([real]);
    expect([...overview.myTeamByLeague.keys()]).toEqual([real]);
    expect(overview.leagueRows.map((row) => row.id)).not.toContain(mockId);
  });

  it("answers the empty overview when every one of the caller's seats is a mock", async () => {
    await seedMockLeague("u1");
    expect(await myLeaguesOverview(db, "u1")).toEqual({ leagueRows: [], teamRows: [], draftRows: [], myTeamByLeague: new Map() });
  });
});
