import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { createTestDb, truncateAll } from "@/db/test-db";
import { chatMessages, leagues, teams, users } from "@/db/schema";
import { getCurrentUser, requireCurrentUser } from "@/lib/auth/current-user";
import { GET as getModeration } from "./route";

const db = createTestDb();

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-17T12:00:00.000Z", isAdmin: false,
});
const signedInAs = (id: string) => {
  vi.mocked(getCurrentUser).mockResolvedValue(profile(id));
  vi.mocked(requireCurrentUser).mockResolvedValue(profile(id));
};

const get = () => new Request("http://test/moderation");

/** A commissioner, a second member, and one removed chat message between them — enough for the
 *  window to have something real to show. */
async function leagueWithHistory(): Promise<{ readonly leagueId: string }> {
  await db.insert(users).values([
    { id: "u_route_commish", email: "u_route_commish@test.local", displayName: "Commish" },
    { id: "u_route_member", email: "u_route_member@test.local", displayName: "Member" },
    { id: "u_route_stranger", email: "u_route_stranger@test.local", displayName: "Stranger" },
    { id: "u_route_operator", email: "u_route_operator@test.local", displayName: "Operator", isAdmin: true },
  ]);
  await db.insert(leagues).values({ id: "lg_route_mod", name: "Route Moderation League", format: "snake", teamCount: 10, commissionerUserId: "u_route_commish" });
  await db.insert(teams).values([
    { id: "team_route_commish", leagueId: "lg_route_mod", userId: "u_route_commish", name: "Commish Team" },
    { id: "team_route_member", leagueId: "lg_route_mod", userId: "u_route_member", name: "Member Team" },
  ]);
  const [message] = await db.insert(chatMessages).values({ leagueId: "lg_route_mod", authorUserId: "u_route_member", body: "removed content" }).returning({ id: chatMessages.id });
  await db
    .update(chatMessages)
    .set({ removedAt: new Date("2026-08-19T14:02:00.000Z"), removedByUserId: "u_route_operator", removalReason: "spam" })
    .where(eq(chatMessages.id, message!.id));
  return { leagueId: "lg_route_mod" };
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  vi.mocked(requireCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/leagues/[leagueId]/moderation", () => {
  it("answers the commissioner's own summary, with the counts and the date and nothing else", async () => {
    const league = await leagueWithHistory();
    signedInAs("u_route_commish");
    const response = await getModeration(get(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      removedMessages: 1,
      removedReviews: 0,
      mostRecentAt: "2026-08-19T14:02:00.000Z",
      openQuestions: 0,
    });
    expect(JSON.stringify(body.data)).not.toContain("u_route_member");
  });

  it("answers 404, never 403, to a member who is not the commissioner", async () => {
    const league = await leagueWithHistory();
    signedInAs("u_route_member");
    const response = await getModeration(get(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(404);
  });

  it("answers 403 for a stranger with no team in the league", async () => {
    const league = await leagueWithHistory();
    signedInAs("u_route_stranger");
    const response = await getModeration(get(), { params: Promise.resolve({ leagueId: league.leagueId }) });
    expect(response.status).toBe(403);
  });

  it("answers 404 for a league that doesn't exist", async () => {
    signedInAs("nobody");
    const response = await getModeration(get(), { params: Promise.resolve({ leagueId: "nope" }) });
    expect(response.status).toBe(404);
  });

  it("answers 401 when nobody is signed in", async () => {
    vi.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await getModeration(get(), { params: Promise.resolve({ leagueId: "lg_route_mod" }) });
    expect(response.status).toBe(401);
  });
});
