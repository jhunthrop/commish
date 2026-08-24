import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { Clock } from "@/domain/timing";
import { drafts, lineupSlots, matchups, statWeeks, teams, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { createLeague } from "@/league-service/creation";
import { shellData, shortNameFor } from "./shell-data";

const db = createTestDb();
const clock: Clock = { now: () => "2026-08-23T12:00:00.000Z" };
let sequence = 0;
const newId = () => `sd_id_${++sequence}`;

beforeEach(async () => {
  await truncateAll(db);
  sequence = 0;
});

afterAll(async () => {
  await truncateAll(db);
});

/** One member-owned league, named `name`, commissioned by `userId` — the shape every test below
 *  needs and nothing more (`nextAction`/`weekStatus` fixtures are layered on top per test).
 *  `teamCount` defaults to 8 (an ordinary open league); a test that needs `invite-managers`'
 *  unfilled-seat check to never outrank the fact under test passes `1` — a solo, already-full
 *  room — rather than seeding seven more teams it has no other use for. */
async function seedLeague(name: string, userId: string, teamCount = 8): Promise<string> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: name }).onConflictDoNothing();
  const created = await createLeague(
    { db, clock, newId },
    {
      name,
      format: "snake",
      teamCount,
      scoringPreset: "ppr",
      auctionBudget: null,
      rosterSlots: [{ slot: "QB", count: 1, eligiblePositions: ["QB"] }],
      owner: { kind: "member", userId, teamName: `${name} Team` },
      experienceTier: "beginner",
      stakeTier: 0,
      isPublicMatchmade: false,
    },
  );
  if (!created.ok) throw new Error(created.reason);
  return created.leagueId;
}

describe("shortNameFor", () => {
  it("takes the first letter of each of the first two words, uppercased", () => {
    expect(shortNameFor("Bay Bandits")).toBe("BB");
    expect(shortNameFor("Thunder Squad")).toBe("TS");
    expect(shortNameFor("Golden Hawks")).toBe("GH");
  });

  it("falls back to the first two letters of a one-word name", () => {
    expect(shortNameFor("Ballers")).toBe("BA");
  });
});

describe("shellData", () => {
  it("answers an empty rail for a caller in no leagues", async () => {
    await db.insert(users).values({ id: "u_none", email: "u_none@test.local", displayName: "Nobody" });
    const { rail } = await shellData(db, { id: "u_none" });
    expect(rail).toEqual([]);
  });

  it("answers a null liveState off-season — no stat_weeks row means nothing is live (ruling 12)", async () => {
    await seedLeague("Thunder Squad", "u_quiet");
    const { liveState } = await shellData(db, { id: "u_quiet" });
    expect(liveState).toBeNull();
  });

  it("answers the real liveState once a week is genuinely live, on a real game day (Task 10, Step 3)", async () => {
    const leagueId = await seedLeague("Sunday Squad", "u_liveday");
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, leagueId));
    const [team] = await db.select().from(teams).where(eq(teams.leagueId, leagueId));
    await db.insert(users).values({ id: "u_liveday_rival", email: "u_liveday_rival@test.local", displayName: "Rival" });
    await db.insert(teams).values({ id: "u_liveday_rival_team", leagueId, userId: "u_liveday_rival", name: "Rival" });
    await db.insert(matchups).values({ leagueId, weekNumber: 1, homeTeamId: team!.id, awayTeamId: "u_liveday_rival_team" });
    await db.insert(statWeeks).values({ week: 1, status: "in_progress", gamesTotal: 16, gamesFinal: 9 }).onConflictDoNothing();

    // `clock` above (2026-08-23T12:00:00.000Z) is a real Sunday — the one day `shellData`'s own
    // injected clock can prove `liveStateFor`'s weekday gate through, deterministically.
    const { liveState } = await shellData(db, { id: "u_liveday" }, clock);
    expect(liveState).toEqual({ weekday: "Sunday", gamesLive: 7 });
  });

  it("marks a league needs-you exactly when the caller's own draft is live (join-draft, F1)", async () => {
    const leagueId = await seedLeague("Bay Bandits", "u_needs");
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, leagueId));

    const { rail } = await shellData(db, { id: "u_needs" });

    expect(rail).toHaveLength(1);
    expect(rail[0]!.id).toBe(leagueId);
    expect(rail[0]!.name).toBe("Bay Bandits");
    expect(rail[0]!.shortName).toBe("BB");
    expect(rail[0]!.state).toBe("needs-you");
    // Fix round 1, H1: the rail's own kind, not just its bucket — `LeagueRail` reads this to
    // pick between "Fix your lineup" and "Join the draft".
    expect(rail[0]!.needsYouKind).toBe("join-draft");
  });

  it("marks a league live when its current week is in progress, regardless of nextAction", async () => {
    const leagueId = await seedLeague("Golden Hawks", "u_live");
    const [team] = await db.select().from(teams).where(eq(teams.leagueId, leagueId));
    await db.insert(users).values({ id: "u_live_rival", email: "u_live_rival@test.local", displayName: "Rival" });
    await db.insert(teams).values({ id: "u_live_rival_team", leagueId, userId: "u_live_rival", name: "Rival" });
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, leagueId));
    await db.insert(matchups).values({ leagueId, weekNumber: 1, homeTeamId: team!.id, awayTeamId: "u_live_rival_team" });
    await db.insert(statWeeks).values({ week: 1, status: "in_progress" }).onConflictDoNothing();

    const { rail } = await shellData(db, { id: "u_live" });

    expect(rail).toHaveLength(1);
    expect(rail[0]!.shortName).toBe("GH");
    expect(rail[0]!.state).toBe("live");
    expect(rail[0]!.needsYouKind).toBeNull();
  });

  it("marks a league quiet when nothing needs the caller and the week isn't live", async () => {
    const leagueId = await seedLeague("Thunder Squad", "u_quiet2", 1);
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, leagueId));
    // A lineup this manager already saved for the current week — without this row, `lineupSet`
    // is false and the league correctly reads `needs-you` (`fix-lineup`), not `quiet`.
    const [team] = await db.select().from(teams).where(eq(teams.leagueId, leagueId));
    await db.insert(lineupSlots).values({ teamId: team!.id, weekNumber: 1, slot: "QB", slotIndex: 0, playerId: null });

    const { rail } = await shellData(db, { id: "u_quiet2" });

    expect(rail).toHaveLength(1);
    expect(rail[0]!.shortName).toBe("TS");
    expect(rail[0]!.state).toBe("quiet");
    expect(rail[0]!.needsYouKind).toBeNull();
  });

  it("marks a league needs-you when this manager's own lineup is genuinely unset (fix-lineup, F1)", async () => {
    const leagueId = await seedLeague("Bay Bandits", "u_fixlineup", 1);
    await db.update(drafts).set({ status: "complete" }).where(eq(drafts.leagueId, leagueId));

    const { rail } = await shellData(db, { id: "u_fixlineup" });

    expect(rail).toHaveLength(1);
    expect(rail[0]!.state).toBe("needs-you");
    expect(rail[0]!.needsYouKind).toBe("fix-lineup");
  });
});
