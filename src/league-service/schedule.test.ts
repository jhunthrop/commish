import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { matchups, teams, users, weeks } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { LEAGUE_CONFIG } from "@/league";
import { createLeague } from "./creation";
import { writeSchedule } from "./schedule";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

async function leagueWithTeams(count: number) {
  await db.insert(users).values(
    Array.from({ length: count }, (_, i) => ({ id: `u${i + 1}`, email: `u${i + 1}@test.local`, displayName: `Manager ${i + 1}` })),
  );
  const created = await createLeague({ db, clock, newId }, {
    name: "Sunday Money", format: "snake", teamCount: count, scoringPreset: "ppr", auctionBudget: null,
    rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Commish" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  if (created.teamId === null) throw new Error("expected a team id");
  const extra = Array.from({ length: count - 1 }, (_, i) => ({
    id: `team_${i + 2}`, leagueId: created.leagueId, userId: `u${i + 2}`, name: `Team ${i + 2}`,
  }));
  if (extra.length > 0) await db.insert(teams).values(extra);
  return { ...created, teamIds: [created.teamId, ...extra.map((t) => t.id)] };
}

describe("writeSchedule", () => {
  it("writes every week and matchup for a 12-team season", async () => {
    const league = await leagueWithTeams(12);
    const counts = await db.transaction((tx) =>
      writeSchedule(tx, { leagueId: league.leagueId, teamIds: league.teamIds, weeks: LEAGUE_CONFIG.regularSeasonWeeks }),
    );
    expect(counts).toEqual({ weeks: 14, matchups: 84 });
    expect(await db.select().from(weeks).where(eq(weeks.leagueId, league.leagueId))).toHaveLength(14);
    const rows = await db.select().from(matchups).where(eq(matchups.leagueId, league.leagueId));
    expect(rows).toHaveLength(84);
    expect(rows.every((row) => row.homeScore === null && row.awayScore === null)).toBe(true);
  });

  it("is idempotent — running it twice leaves exactly one season", async () => {
    const league = await leagueWithTeams(12);
    const input = { leagueId: league.leagueId, teamIds: league.teamIds, weeks: LEAGUE_CONFIG.regularSeasonWeeks };
    await db.transaction((tx) => writeSchedule(tx, input));
    await db.transaction((tx) => writeSchedule(tx, input));
    expect(await db.select().from(matchups).where(eq(matchups.leagueId, league.leagueId))).toHaveLength(84);
    expect(await db.select().from(weeks).where(eq(weeks.leagueId, league.leagueId))).toHaveLength(14);
  });

  it("writes nothing when the schedule cannot be built", async () => {
    const league = await leagueWithTeams(1);
    // The unbuildable schedule is logged, not thrown — the draft that produced it is still
    // legitimately complete. Silenced here so the suite's output stays clean.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const counts = await db.transaction((tx) =>
      writeSchedule(tx, { leagueId: league.leagueId, teamIds: league.teamIds, weeks: 14 }),
    );
    expect(counts).toEqual({ weeks: 0, matchups: 0 });
    expect(await db.select().from(weeks)).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
