import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { Clock } from "@/domain/timing";
import { drafts, matchups, statWeeks, teams, users } from "@/db/schema";
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
 *  needs and nothing more (`nextAction`/`weekStatus` fixtures are layered on top per test). */
async function seedLeague(name: string, userId: string): Promise<string> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: name }).onConflictDoNothing();
  const created = await createLeague(
    { db, clock, newId },
    {
      name,
      format: "snake",
      teamCount: 8,
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

  it("always answers a null liveState — Task 9's own read decides the real pill (ruling 12)", async () => {
    await seedLeague("Thunder Squad", "u_quiet");
    const { liveState } = await shellData(db, { id: "u_quiet" });
    expect(liveState).toBeNull();
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
  });

  it("marks a league quiet when nothing needs the caller and the week isn't live", async () => {
    await seedLeague("Thunder Squad", "u_quiet2");

    const { rail } = await shellData(db, { id: "u_quiet2" });

    expect(rail).toHaveLength(1);
    expect(rail[0]!.shortName).toBe("TS");
    expect(rail[0]!.state).toBe("quiet");
  });

  it("gives the same league the same tone every time, deterministically", async () => {
    await seedLeague("Golden Hawks", "u_tone");
    const first = await shellData(db, { id: "u_tone" });
    const second = await shellData(db, { id: "u_tone" });
    expect(first.rail[0]!.tone).toBe(second.rail[0]!.tone);
  });
});
