import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  requireAdmin: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { drafts, leagues, memberNotices, teams, users } from "@/db/schema";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { requireAdmin } from "@/lib/auth/current-user";
import { DISSOLUTION_REFUSALS } from "@/money-service/dissolution";
import { GET, POST } from "./route";

const db = createTestDb();

const signedInAs = (id: string | null) => {
  if (id === null) {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not authenticated."));
    return;
  }
  if (id === "u_plain") {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    return;
  }
  vi.mocked(requireAdmin).mockResolvedValue({
    id,
    email: `${id}@test.local`,
    displayName: id,
    experienceTier: "beginner",
    avatarUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    isAdmin: true,
  });
};

function dissolve(leagueId: string) {
  const request = new Request(`http://test/api/admin/leagues/${leagueId}/dissolve`, { method: "POST" });
  return POST(request, { params: Promise.resolve({ leagueId }) });
}

function previewDissolve(leagueId: string) {
  const request = new Request(`http://test/api/admin/leagues/${leagueId}/dissolve`);
  return GET(request, { params: Promise.resolve({ leagueId }) });
}

async function seedPreDraftLeague(leagueId: string, entryFeeCents: number, memberIds: readonly string[]): Promise<void> {
  await db.insert(users).values(memberIds.map((id) => ({ id, email: `${id}@test.local`, displayName: id, kycStatus: "verified" as const })));
  await db.insert(leagues).values({
    id: leagueId,
    name: "Route Test League",
    format: "snake",
    teamCount: 4,
    isPublicMatchmade: true,
    commissionerUserId: memberIds[0] ?? null,
    entryFeeCents,
    platformFeeCents: 0,
    payoutTable: entryFeeCents > 0 ? [{ place: 1, amountCents: entryFeeCents * memberIds.length }] : null,
  });
  await db.insert(drafts).values({
    id: `${leagueId}_draft`,
    leagueId,
    format: "snake",
    status: "scheduled",
    kickoffAt: new Date("2026-09-20T17:00:00.000Z"),
    auctionBudget: null,
    startTrigger: "scheduled",
  });
  for (const userId of memberIds) {
    await db.insert(teams).values({ id: `${leagueId}_${userId}`, leagueId, userId, name: userId });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(requireAdmin).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/admin/leagues/[leagueId]/dissolve", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await dissolve("lg_x");
    expect(response.status).toBe(401);
  });

  it("answers 404, never 403, for a signed-in non-operator (ruling 14)", async () => {
    signedInAs("u_plain");
    const response = await dissolve("lg_x");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "Not found." });
  });

  it("answers 404 for a league that does not exist, the service's own refusal surfaced verbatim", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const response = await dissolve("lg_ghost");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: DISSOLUTION_REFUSALS.leagueMissing });
  });

  it("answers 409 for a league whose draft has already started", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    await seedPreDraftLeague("lg_live", 0, ["u1"]);
    await db.update(drafts).set({ status: "in_progress" }).where(eq(drafts.leagueId, "lg_live"));

    const response = await dissolve("lg_live");
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: DISSOLUTION_REFUSALS.draftStarted });
  });

  it("dissolves a real pre-draft league and answers ok with the refund summary", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    await seedPreDraftLeague("lg_real", 0, ["u1", "u2"]);

    const response = await dissolve("lg_real");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { leagueId: "lg_real", refundedMembers: 2, totalRefundedCents: 0 } });

    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, "lg_real"));
    expect(draft!.status).toBe("dissolved");
    const notices = await db.select().from(memberNotices).where(eq(memberNotices.leagueId, "lg_real"));
    expect(notices).toHaveLength(2);
  });
});

describe("GET /api/admin/leagues/[leagueId]/dissolve", () => {
  it("answers 404, never 403, for a signed-in non-operator (ruling 14)", async () => {
    signedInAs("u_plain");
    const response = await previewDissolve("lg_x");
    expect(response.status).toBe(404);
  });

  it("answers 404 for a league that does not exist", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const response = await previewDissolve("lg_ghost");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: DISSOLUTION_REFUSALS.leagueMissing });
  });

  it("previews the league's own name and seated count, without touching the book", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    await seedPreDraftLeague("lg_preview", 500, ["u1", "u2", "u3"]);

    const response = await previewDissolve("lg_preview");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { leagueId: "lg_preview", leagueName: "Route Test League", seatedCount: 3 } });

    // A GET is a read: the draft's own status is untouched, unlike a real dissolve.
    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.leagueId, "lg_preview"));
    expect(draft!.status).toBe("scheduled");
  });
});
