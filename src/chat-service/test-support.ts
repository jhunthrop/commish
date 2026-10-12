import type { Db } from "@research-ts/db/client";
import { leagues, teams, users } from "@/db/schema";

/**
 * Two managers in one league — the smallest fixture that can prove "the other person sees it".
 * Deliberately does NOT go through `createLeague`: chat has no draft, schedule or scoring
 * dependency, and a heavier fixture would imply one.
 */
export async function chatLeagueFixture(db: Db): Promise<{ readonly leagueId: string }> {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Alex Rivera" },
    { id: "u2", email: "u2@test.local", displayName: "Jordan Lee" },
  ]);
  await db.insert(leagues).values({
    id: "l1",
    name: "Sunday Money",
    format: "snake",
    teamCount: 12,
    commissionerUserId: "u1",
  });
  await db.insert(teams).values([
    { id: "t1", leagueId: "l1", userId: "u1", name: "Bay Bandits" },
    { id: "t2", leagueId: "l1", userId: "u2", name: "Iron Owls" },
  ]);
  return { leagueId: "l1" };
}
