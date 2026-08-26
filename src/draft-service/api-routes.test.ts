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
import { draftActions, drafts, leagues, mockRooms, players, users } from "@/db/schema";
import { describeStartTiming } from "@/matchmaking/roll";
import { getCurrentUser } from "@/lib/auth/current-user";
import { GET as getDraft } from "@/app/api/drafts/[draftId]/route";
import { GET as getPlayers } from "@/app/api/drafts/[draftId]/players/route";
import { POST as postAction } from "@/app/api/drafts/[draftId]/actions/route";
import { POST as postStart } from "@/app/api/drafts/[draftId]/start/route";
import { getDraftStore } from "@/draft-service";
import { MOCK_COPY } from "@/mock-draft/config";
import type { MockMode } from "@/mock-draft/config";
import { seedDraftFixture, SPRINT_ROSTER_SLOTS } from "./test-support";

const db = createTestDb();
const DRAFT_ID = "draft_api";
const params = Promise.resolve({ draftId: DRAFT_ID });
const MOCK_DRAFT_ID = "draft_api_mock";
const mockParams = Promise.resolve({ draftId: MOCK_DRAFT_ID });
const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null ? null : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
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

/**
 * Task 8: a mock room's own fixture, alongside `fixture()` above rather than a parameter on it
 * — `seedDraftFixture`'s own `isMock`/`botTeams` inputs (Task 4's addition) do the seeding;
 * this only patches `mock_rooms.mode` after the fact, since `seedDraftFixture` always seeds
 * `"solo"` and Task 8's own `ShareLinkPanel` data only ever answers for `"link"`.
 */
async function mockFixture(mode: MockMode = "solo", botTeams = 0) {
  const f = await seedDraftFixture(db, {
    draftId: MOCK_DRAFT_ID, leagueId: "league_api_mock", format: "snake", teamCount: 2,
    slotConfig: SPRINT_ROSTER_SLOTS, kickoffAt: new Date("2026-09-10T17:00:00.000Z"), auctionBudget: null,
    isMock: true, botTeams,
  });
  if (mode !== "solo") await db.update(mockRooms).set({ mode }).where(eq(mockRooms.leagueId, f.leagueId));
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

/** Drives a 2-team, 3-slot mock draft to `phase: "complete"` through the real actions route —
 *  every pick a real human's own MAKE_PICK, never a store shortcut, so this proves the SAME
 *  route this file already tests actually reaches the completed state Task 8's results copy
 *  depends on. */
async function completeMockDraft(f: { readonly teamIds: readonly string[]; readonly userIds: readonly string[] }): Promise<void> {
  const started = await getDraftStore().startDraft(MOCK_DRAFT_ID);
  if (!started.ok) throw new Error(started.reason);
  let phase: string = started.state.phase;
  // `DraftState` has no `onClockTeamId` field of its own (it is a VIEW selector,
  // `teamOnClock`) — the first pick of a fresh snake draft always belongs to `draftOrder[0]`,
  // and every pick after that reads the on-clock team off the previous response's own view.
  let onClockTeamId: string | null = started.state.draftOrder[0]!;
  // Pick order t1,t2,t2,t1,t1,t2 (2-team snake, 3 rounds) — one of each position per team, never
  // a repeat before the OTHER two slots are filled, so every pick lands on an open slot.
  for (const playerId of ["qb1", "qb2", "rb2", "rb1", "wr1", "wr2"]) {
    if (phase === "complete") break;
    signedInAs(f.userIds[f.teamIds.indexOf(onClockTeamId!)]!);
    const response = await postAction(
      new Request(`http://test/api/drafts/${MOCK_DRAFT_ID}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "MAKE_PICK", playerId }),
      }),
      { params: mockParams },
    );
    const body = await response.json();
    if (!body.ok) throw new Error(`pick failed: ${JSON.stringify(body)}`);
    phase = body.data.draft.phase;
    onClockTeamId = body.data.draft.onClockTeamId;
  }
}

beforeEach(async () => {
  await truncateAll(db);
  getDraftStore().invalidate(DRAFT_ID);
  getDraftStore().invalidate(MOCK_DRAFT_ID);
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
    expect(await response.json()).toEqual({ ok: false, error: "You do not have a team in this league." });
  });

  // The `teamId === null && isCommissioner` branch: a commissioner who runs the league but
  // fields no team of their own must still be able to view the draft room.
  it("lets a commissioner with no team of their own view the draft", async () => {
    const f = await fixture();
    const commissionerId = "league_api_commish_no_team";
    await db.insert(users).values({ id: commissionerId, email: `${commissionerId}@test.local`, displayName: commissionerId });
    await db.update(leagues).set({ commissionerUserId: commissionerId }).where(eq(leagues.id, f.leagueId));
    signedInAs(commissionerId);

    const response = await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.teamId).toBeNull();
    expect(body.data.isCommissioner).toBe(true);
    expect(body.data.draft.draftId).toBe(DRAFT_ID);
  });

  // The room header names the league you are drafting in. It is the one thing on that header
  // the view itself cannot supply, so the snapshot carries it.
  it("names the league in the draft state body", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const [league] = await db.select({ name: leagues.name }).from(leagues).where(eq(leagues.id, f.leagueId));
    const body = await (await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params })).json();
    expect(body.data.leagueName).toBe(league!.name);
  });

  it("includes every team card in the draft state body", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const body = await (await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params })).json();
    expect(body.data.teams).toHaveLength(f.teamIds.length);
    expect(body.data.teams[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), ownerDisplayName: expect.any(String) });
    expect(body.data.draft.slotConfig).toEqual(SPRINT_ROSTER_SLOTS);
  });
});

/**
 * Task 8: the mock room's own words, carried on `DraftSnapshotBody.mock` — null for a real
 * league (proven against the SAME fixture every test above already drives), and populated with
 * `MOCK_COPY`'s exact strings, each bot seat's `TeamCard.isBot`, `ShareLinkPanel`'s own data for
 * a `link`-mode room, and `MockResults`' own copy once the draft actually finishes.
 */
describe("GET /api/drafts/[draftId] — Task 8's mock room info", () => {
  it("answers mock: null for a real league's draft", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const body = await (await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params })).json();
    expect(body.data.mock).toBeNull();
  });

  it("carries MOCK_COPY's exact words and every seat's isBot flag for an unstarted, non-link mock", async () => {
    const f = await mockFixture("lobby", 1);
    signedInAs(f.userIds[0]!); // botTeams takes seats from the end — index 0 is the human host
    const body = await (await getDraft(new Request(`http://test/api/drafts/${MOCK_DRAFT_ID}`), { params: mockParams })).json();

    expect(body.data.mock.practiceBanner).toBe(MOCK_COPY.practiceBanner);
    expect(body.data.mock.botBadge).toBe(MOCK_COPY.botBadge);
    expect(body.data.mock.botMarkerLabel).toBe(MOCK_COPY.botMarkerLabel);
    // Not "link" mode, so ShareLinkPanel has nothing to show; not complete, so no results yet.
    expect(body.data.mock.share).toBeNull();
    expect(body.data.mock.results).toBeNull();

    const teams: readonly { readonly isBot?: boolean }[] = body.data.teams;
    expect(teams.filter((team) => team.isBot === true)).toHaveLength(1);
    expect(teams.filter((team) => team.isBot !== true)).toHaveLength(1);
  });

  it("carries ShareLinkPanel's own data for an unstarted link-mode mock", async () => {
    const f = await mockFixture("link");
    signedInAs(f.userIds[0]!);
    const body = await (await getDraft(new Request(`http://test/api/drafts/${MOCK_DRAFT_ID}`), { params: mockParams })).json();

    expect(body.data.mock.share).toEqual({
      shareCode: "league_api_mock_code",
      path: "/app/mock-drafts/league_api_mock_code",
      teamCount: 2,
      seatsFilled: 2,
      startsAt: "2026-09-10T17:00:00.000Z",
    });
    expect(body.data.mock.results).toBeNull();
  });

  it("answers a null share for a solo mock, even unstarted", async () => {
    const f = await mockFixture("solo");
    signedInAs(f.userIds[0]!);
    const body = await (await getDraft(new Request(`http://test/api/drafts/${MOCK_DRAFT_ID}`), { params: mockParams })).json();
    expect(body.data.mock.share).toBeNull();
  });

  it("yields MockResults' own copy, and nulls the share, once the mock draft actually finishes", async () => {
    const f = await mockFixture("solo");
    await completeMockDraft(f);
    signedInAs(f.userIds[0]!);
    const body = await (await getDraft(new Request(`http://test/api/drafts/${MOCK_DRAFT_ID}`), { params: mockParams })).json();

    expect(body.data.draft.phase).toBe("complete");
    expect(body.data.mock.results).toEqual({
      heading: MOCK_COPY.resultsHeading,
      retentionSentence: MOCK_COPY.resultsRetentionSentence,
      runAgainLabel: MOCK_COPY.resultsRunAgainLabel,
      openLobbyLabel: MOCK_COPY.resultsOpenLobbyLabel,
      browseLeaguesLabel: MOCK_COPY.resultsBrowseLeaguesLabel,
    });
    expect(body.data.mock.share).toBeNull();
  });
});

/**
 * R2 (the draft-room design review, Task 10's carry): the scheduled room's waiting story on
 * `DraftSnapshotBody.waiting` — the kickoff instant the rail counts down to and the
 * trigger-aware sentence, quoted from `describeStartTiming` (the one start-timing authority)
 * for a real league and from `MOCK_COPY.waitingDetail` for a practice room. Null the moment
 * the draft leaves `scheduled`.
 */
describe("GET /api/drafts/[draftId] — the scheduled waiting story (R2)", () => {
  const snapshot = async () => (await (await getDraft(new Request(`http://test/api/drafts/${DRAFT_ID}`), { params })).json()).data;

  it("quotes the member-league scheduled sentence and the draft's own kickoff instant", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    expect((await snapshot()).waiting).toEqual({
      kickoffAt: "2026-09-10T17:00:00.000Z",
      detail: describeStartTiming({ startTrigger: "scheduled", authority: "member" }),
    });
  });

  it("quotes the house sentence for a house league — no commissioner is ever implied", async () => {
    const f = await fixture();
    await db.update(leagues).set({ houseRung: "casual", commissionerUserId: null }).where(eq(leagues.id, f.leagueId));
    signedInAs(f.userIds[0]!);
    expect((await snapshot()).waiting).toEqual({
      kickoffAt: "2026-09-10T17:00:00.000Z",
      detail: describeStartTiming({ startTrigger: "scheduled", authority: "house" }),
    });
  });

  it("carries the when-full commitment with no countdown target — there is no chosen time", async () => {
    const f = await fixture();
    await db.update(drafts).set({ startTrigger: "when_full" }).where(eq(drafts.id, DRAFT_ID));
    signedInAs(f.userIds[0]!);
    expect((await snapshot()).waiting).toEqual({
      kickoffAt: null,
      detail: describeStartTiming({ startTrigger: "when_full", authority: "member" }),
    });
  });

  it("counts a practice room down to its own fill-window start with MOCK_COPY's sentence", async () => {
    const f = await mockFixture("lobby", 1);
    signedInAs(f.userIds[0]!);
    const [room] = await db.select({ startsAt: mockRooms.startsAt }).from(mockRooms).where(eq(mockRooms.leagueId, f.leagueId));
    const body = await (await getDraft(new Request(`http://test/api/drafts/${MOCK_DRAFT_ID}`), { params: mockParams })).json();
    expect(body.data.waiting).toEqual({
      kickoffAt: room!.startsAt.toISOString(),
      detail: MOCK_COPY.waitingDetail,
    });
  });

  it("answers waiting: null the moment the draft starts", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    await getDraftStore().startDraft(DRAFT_ID);
    expect((await snapshot()).waiting).toBeNull();
  });
});

describe("GET /api/drafts/[draftId]/players", () => {
  it("returns ranked player metadata to a league member", async () => {
    const f = await fixture();
    signedInAs(f.userIds[0]!);
    const response = await getPlayers(new Request(`http://test/api/drafts/${DRAFT_ID}/players`), { params });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.players).toHaveLength(6);
    expect(body.data.players[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), position: expect.any(String), nflTeam: expect.any(String) });
  });

  it("refuses a signed-in stranger with no team in this league", async () => {
    await fixture();
    await db.insert(users).values({ id: "stranger", email: "stranger@test.local", displayName: "Stranger" });
    signedInAs("stranger");
    const response = await getPlayers(new Request(`http://test/api/drafts/${DRAFT_ID}/players`), { params });
    expect(response.status).toBe(403);
  });

  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    await fixture();
    signedInAs(null);
    const response = await getPlayers(new Request(`http://test/api/drafts/${DRAFT_ID}/players`), { params });
    expect(response.status).toBe(401);
    expect((await response.json()).ok).toBe(false);
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
