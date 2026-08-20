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
import { leagues, players, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { GET as getQueue, POST as postQueue } from "@/app/api/drafts/[draftId]/queue/route";
import { GET as getDraft } from "@/app/api/drafts/[draftId]/route";
import { getDraftStore } from "@/draft-service";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const DRAFT_ID = "draft_queue_api";
const params = Promise.resolve({ draftId: DRAFT_ID });
const url = `http://test/api/drafts/${DRAFT_ID}/queue`;

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null ? null : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

const post = (body: unknown) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function fixture() {
  const f = await seedDraftFixture(db, {
    draftId: DRAFT_ID, leagueId: "league_queue_api", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
  });
  await db.insert(players).values([
    { id: "qb1", name: "QB One", position: "QB", nflTeam: "KC" },
    { id: "rb1", name: "RB One", position: "RB", nflTeam: "SF" },
    { id: "wr1", name: "WR One", position: "WR", nflTeam: "NYJ" },
    { id: "qb2", name: "QB Two", position: "QB", nflTeam: "KC" },
    { id: "rb2", name: "RB Two", position: "RB", nflTeam: "SF" },
    { id: "wr2", name: "WR Two", position: "WR", nflTeam: "NYJ" },
  ]);
  return f;
}

beforeEach(async () => {
  await truncateAll(db);
  getDraftStore().invalidate(DRAFT_ID);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/drafts/[draftId]/queue", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    await fixture();
    signedInAs(null);
    const response = await postQueue(post({ playerIds: ["rb1"] }), { params });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("answers 403 for a signed-in stranger with no team in this league", async () => {
    await fixture();
    signedInAs("stranger");
    const response = await postQueue(post({ playerIds: ["rb1"] }), { params });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "You don't have a team in this league." });
  });

  it("stores the caller's own queue — a body teamId is impossible to send", async () => {
    const f = await fixture();
    signedInAs(f.userIds[1]!);
    const response = await postQueue(post({ playerIds: ["rb1", "qb1"], teamId: f.teamIds[0]! }), { params });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { queue: ["rb1", "qb1"] } });
    // The queue landed on team 2 (the signed-in caller), not the team named in the body.
    signedInAs(f.userIds[0]!);
    expect(await (await getQueue(new Request(url), { params })).json()).toEqual({ ok: true, data: { queue: [] } });
  });

  it("answers 400 with the offending field for a malformed body", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const response = await postQueue(post({ playerIds: "rb1" }), { params });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("playerIds");
  });

  it("answers 409 with the reducer's plain-language reason", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const response = await postQueue(post({ playerIds: ["rb1", "rb1"] }), { params });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "Each player may appear in your queue only once." });
  });
});

describe("GET /api/drafts/[draftId]/queue and the snapshot's queue", () => {
  it("returns the caller's own queue and nobody else's", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await postQueue(post({ playerIds: ["rb1"] }), { params });
    expect(await (await getQueue(new Request(url), { params })).json()).toEqual({ ok: true, data: { queue: ["rb1"] } });

    signedInAs(f.userIds[1]!);
    expect(await (await getQueue(new Request(url), { params })).json()).toEqual({ ok: true, data: { queue: [] } });
    const snapshot = await (await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params })).json();
    expect(snapshot.data.queue).toEqual([]);
  });

  it("carries the caller's queue on the full snapshot too", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await postQueue(post({ playerIds: ["rb1", "qb1"] }), { params });
    const snapshot = await (await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params })).json();
    expect(snapshot.data.queue).toEqual(["rb1", "qb1"]);
  });

  // Task 2 carry: a commissioner with no team of their own has no queue of their own either —
  // `GET /queue` and the snapshot's `queue` field both answer `[]` rather than a 403 or a 500,
  // the same `teamId === null` branch the state route already covers for `isCommissioner`.
  it("answers an empty queue — never a 403 — for a commissioner with no team of their own", async () => {
    const f = await fixture();
    const commissionerId = "queue_api_commish_no_team";
    await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId });
    await db.update(leagues).set({ commissionerUserId: commissionerId }).where(eq(leagues.id, f.leagueId));
    signedInAs(commissionerId);

    expect(await (await getQueue(new Request(url), { params })).json()).toEqual({ ok: true, data: { queue: [] } });
    const snapshot = await (await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params })).json();
    expect(snapshot.data.teamId).toBeNull();
    expect(snapshot.data.isCommissioner).toBe(true);
    expect(snapshot.data.queue).toEqual([]);
  });
});
