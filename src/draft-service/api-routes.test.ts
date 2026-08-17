import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// The route handlers use the process-wide getDb()/getPublisher(); point them at the test
// infrastructure before any module is imported. vi.hoisted runs before the import graph.
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
import { draftActions, players } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { GET as getDraft } from "@/app/api/drafts/[draftId]/route";
import { POST as postAction } from "@/app/api/drafts/[draftId]/actions/route";
import { POST as postStart } from "@/app/api/drafts/[draftId]/start/route";
import { getDraftStore } from "@/draft-service";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const DRAFT_ID = "draft_api";
const params = Promise.resolve({ draftId: DRAFT_ID });
const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null ? null : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z" },
  );

async function fixture() {
  const f = await seedDraftFixture(db, {
    draftId: DRAFT_ID, leagueId: "league_api", format: "snake", teamCount: 2,
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

function postJson(body: unknown): Request {
  return new Request(`http://test/api/drafts/${DRAFT_ID}/actions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await truncateAll(db);
  getDraftStore().invalidate(DRAFT_ID);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/drafts/[draftId]", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    await fixture();
    signedInAs(null);
    const response = await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params });
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("answers 404 for a draft that doesn't exist", async () => {
    signedInAs("someone");
    const response = await getDraft(new Request("http://test/api/drafts/nope"), { params: Promise.resolve({ draftId: "nope" }) });
    expect(response.status).toBe(404);
  });

  it("returns the materialized state and the caller's own team", async () => {
    const f = await fixture();
    signedInAs(f.userIds[1]!);
    await getDraftStore().startDraft(DRAFT_ID);
    const response = await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.teamId).toBe(f.teamIds[1]);
    expect(body.data.draft.phase).toBe("in_progress");
    expect(body.data.draft.onClockTeamId).not.toBeNull();
    expect(body.data.draft.deadlineAt).not.toBeNull();
  });

  // Ruling R-B5: reading a draft is restricted to that league's own members (plus its
  // commissioner) — a signed-in stranger from another league must not see this board.
  it("answers 403 for a signed-in user with no team in this league", async () => {
    await fixture();
    signedInAs("stranger");
    const response = await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "You don't have a team in this league." });
  });
});

describe("POST /api/drafts/[draftId]/actions", () => {
  it("rejects a malformed body with 400", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await getDraftStore().startDraft(DRAFT_ID);
    const response = await postAction(postJson({ type: "MAKE_PICK" }), { params });
    expect(response.status).toBe(400);
  });

  it("refuses TIMER_EXPIRE from a client — only the server ticker expires a clock", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await getDraftStore().startDraft(DRAFT_ID);
    const response = await postAction(postJson({ type: "TIMER_EXPIRE" }), { params });
    expect(response.status).toBe(400);
    expect(await db.select().from(draftActions).where(eq(draftActions.draftId, DRAFT_ID))).toHaveLength(1);
  });

  it("records a pick for the caller's own team, ignoring any teamId in the body", async () => {
    const f = await fixture();
    const state = await getDraftStore().startDraft(DRAFT_ID);
    if (!state.ok) throw new Error(state.reason);
    const onClockTeamId = state.state.draftOrder[0]!;
    const onClockUserId = f.userIds[f.teamIds.indexOf(onClockTeamId)]!;
    signedInAs(onClockUserId);

    const response = await postAction(postJson({ type: "MAKE_PICK", playerId: "qb1", teamId: "some_other_team" }), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.draft.picks[0]).toMatchObject({ teamId: onClockTeamId, playerId: "qb1" });
  });

  it("answers 409 with the reducer's plain-language reason when the action isn't legal, even if the body claims to be the on-clock team", async () => {
    const f = await fixture();
    const state = await getDraftStore().startDraft(DRAFT_ID);
    if (!state.ok) throw new Error(state.reason);
    const onClockTeamId = state.state.draftOrder[0]!;
    const offClockTeamId = state.state.draftOrder[1]!;
    signedInAs(f.userIds[f.teamIds.indexOf(offClockTeamId)]!);
    // The body lies and claims to be the on-clock team. If the server ever honoured a body
    // teamId, this would wrongly succeed as that team's pick instead of being rejected as
    // the off-clock caller's own illegal pick.
    const response = await postAction(postJson({ type: "MAKE_PICK", playerId: "qb1", teamId: onClockTeamId }), { params });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "It's not your turn to pick." });
  });

  it("answers 403 for a signed-in user with no team in this league", async () => {
    await fixture();
    signedInAs("stranger");
    await getDraftStore().startDraft(DRAFT_ID);
    const response = await postAction(postJson({ type: "MAKE_PICK", playerId: "qb1" }), { params });
    expect(response.status).toBe(403);
  });
});

describe("POST /api/drafts/[draftId]/start", () => {
  it("lets only the commissioner start the draft", async () => {
    const f = await fixture();
    signedInAs(f.userIds[1]!);
    const denied = await postStart(new Request(`http://test/api/drafts/${DRAFT_ID}/start`, { method: "POST" }), { params });
    expect(denied.status).toBe(403);

    signedInAs(f.userIds[0]!); // seedDraftFixture makes the first user the commissioner
    const allowed = await postStart(new Request(`http://test/api/drafts/${DRAFT_ID}/start`, { method: "POST" }), { params });
    expect(allowed.status).toBe(200);
    const body = await allowed.json();
    expect(body.data.draft.phase).toBe("in_progress");
  });

  it("answers 409 when the draft has already started", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await postStart(new Request(`http://test/api/drafts/${DRAFT_ID}/start`, { method: "POST" }), { params });
    const again = await postStart(new Request(`http://test/api/drafts/${DRAFT_ID}/start`, { method: "POST" }), { params });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: false, error: "This draft has already started." });
  });
});
