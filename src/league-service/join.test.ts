import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { drafts, leagues, teams, users } from "@/db/schema";
import { DRAFT_ALREADY_STARTED, joinPublicLeague, LEAGUE_FULL, NOT_PUBLIC } from "./join";

const db = createTestDb();
let nextId = 0;
const newId = () => `team_${++nextId}`;
const deps = () => ({ db, newId });

async function seedLeague(over: {
  readonly id?: string;
  readonly teamCount?: number;
  readonly filled?: number;
  readonly isPublicMatchmade?: boolean;
  readonly draftStatus?: "scheduled" | "in_progress" | "complete";
} = {}): Promise<string> {
  const id = over.id ?? "open";
  await db.insert(leagues).values({
    id,
    name: "Rookie Snake Room",
    format: "snake",
    teamCount: over.teamCount ?? 12,
    stakeTier: 0,
    experienceTier: "beginner",
    isPublicMatchmade: over.isPublicMatchmade ?? true,
    commissionerUserId: "owner",
  });
  await db.insert(drafts).values({
    id: `${id}_draft`,
    leagueId: id,
    format: "snake",
    status: over.draftStatus ?? "scheduled",
    kickoffAt: new Date("2026-09-10T17:00:00.000Z"),
    auctionBudget: null,
  });
  for (let i = 0; i < (over.filled ?? 0); i++) {
    const userId = `${id}_seat_${i}`;
    await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Seat ${i}` });
    await db.insert(teams).values({ id: `${id}_t${i}`, leagueId: id, userId, name: `Team ${i}` });
  }
  return id;
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  await db.insert(users).values([
    { id: "owner", email: "owner@test.local", displayName: "Commissioner Casey" },
    { id: "joiner", email: "joiner@test.local", displayName: "Robin Vale" },
  ]);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("joinPublicLeague", () => {
  it("gives the caller a team named after them, and reports it as a fresh join", async () => {
    const leagueId = await seedLeague();
    const result = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    expect(result).toEqual({ ok: true, leagueId, teamId: "team_1", alreadyMember: false });

    const [row] = await db.select().from(teams).where(eq(teams.id, "team_1"));
    expect(row).toMatchObject({ leagueId, userId: "joiner", name: "Robin Vale" });
  });

  it("is idempotent: joining twice returns the same team and creates nothing", async () => {
    const leagueId = await seedLeague();
    const first = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    const second = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    expect(second).toEqual({ ok: true, leagueId, teamId: (first as { teamId: string }).teamId, alreadyMember: true });
    expect(await db.select().from(teams).where(eq(teams.leagueId, leagueId))).toHaveLength(1);
  });

  it("refuses a league that is not publicly listed", async () => {
    const leagueId = await seedLeague({ isPublicMatchmade: false });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 404, reason: NOT_PUBLIC,
    });
  });

  it("refuses a league whose draft has already started", async () => {
    const leagueId = await seedLeague({ draftStatus: "in_progress" });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 409, reason: DRAFT_ALREADY_STARTED,
    });
  });

  it("refuses a full league", async () => {
    const leagueId = await seedLeague({ teamCount: 2, filled: 2 });
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: false, status: 409, reason: LEAGUE_FULL,
    });
  });

  it("refuses a league that does not exist, identically to one that is not publicly listed", async () => {
    // Not `LEAGUE_MISSING`: a caller posting a league id must not be able to tell "no such
    // league" apart from "a real league that just isn't public" — see `publicJoinPrecondition`'s
    // docblock. The two cases answer byte-identically.
    const missing = await joinPublicLeague(deps(), { leagueId: "nope", userId: "joiner" });
    expect(missing).toEqual({ ok: false, status: 404, reason: NOT_PUBLIC });

    const privateLeagueId = await seedLeague({ id: "private", isPublicMatchmade: false });
    const notPublic = await joinPublicLeague(deps(), { leagueId: privateLeagueId, userId: "joiner" });
    expect(notPublic).toEqual(missing);
  });

  it("lets an existing member back in even after the league closed behind them", async () => {
    // A member re-arriving must succeed for free whatever the path's own gate now says —
    // the same rule that makes re-opening your own expired invite link a success.
    const leagueId = await seedLeague();
    const first = await joinPublicLeague(deps(), { leagueId, userId: "joiner" });
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));
    expect(await joinPublicLeague(deps(), { leagueId, userId: "joiner" })).toEqual({
      ok: true, leagueId, teamId: (first as { teamId: string }).teamId, alreadyMember: true,
    });
  });

  it("never seats more managers than the league has room for, under concurrent joins", async () => {
    const leagueId = await seedLeague({ teamCount: 4, filled: 3 });
    await db.insert(users).values([
      { id: "racer_a", email: "racer_a@test.local", displayName: "Racer A" },
      { id: "racer_b", email: "racer_b@test.local", displayName: "Racer B" },
    ]);
    const results = await Promise.all([
      joinPublicLeague(deps(), { leagueId, userId: "racer_a" }),
      joinPublicLeague(deps(), { leagueId, userId: "racer_b" }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, status: 409, reason: LEAGUE_FULL }]);
    expect(await db.select().from(teams).where(eq(teams.leagueId, leagueId))).toHaveLength(4);
  });
});
