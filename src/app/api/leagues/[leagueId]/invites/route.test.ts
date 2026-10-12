import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research/domain/roster";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createLeague } from "@/league-service/creation";
import { POST as postInvite, GET as getInvites, DELETE as deleteInvite } from "./route";

const db = createTestDb();
const clock = { now: () => "2026-08-17T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-08-17T12:00:00.000Z", isAdmin: false,
});
const signedInAs = (id: string) => {
  vi.mocked(getCurrentUser).mockResolvedValue(profile(id));
};

const post = (body: unknown = {}) =>
  new Request("http://commish.example/api/leagues/l1/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = () => new Request("http://commish.example/api/leagues/l1/invites");
const del = (body: unknown) =>
  new Request("http://commish.example/api/leagues/l1/invites", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function league(): Promise<{ readonly leagueId: string }> {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Ana's Office League", format: "snake", teamCount: 12, scoringPreset: "ppr",
    auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  return { leagueId: created.leagueId };
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/leagues/[leagueId]/invites", () => {
  it("mints an invite whose url is ABSOLUTE, composed from this request's own origin (C-01)", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    const response = await postInvite(post(), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.url).toBe(`http://commish.example/app/join/${body.data.code}`);
    expect(body.data.path).toBe(`/app/join/${body.data.code}`);
    expect(body.data.uses).toBe(0);
  });

  it("answers 403 for a member who is not the commissioner", async () => {
    const { leagueId } = await league();
    signedInAs("u2");
    const response = await postInvite(post(), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(403);
  });
});

describe("GET /api/leagues/[leagueId]/invites", () => {
  it("lists only LIVE invites, newest first, each with an absolute url (C-03)", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    const first = await (await postInvite(post(), { params: Promise.resolve({ leagueId }) })).json();
    const second = await (await postInvite(post(), { params: Promise.resolve({ leagueId }) })).json();

    const response = await getInvites(get(), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.invites.map((invite: { code: string }) => invite.code)).toEqual([second.data.code, first.data.code]);
    expect(body.data.invites[0].url).toBe(`http://commish.example/app/join/${second.data.code}`);
  });

  it("answers an empty list for a league with no live invites", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    const response = await getInvites(get(), { params: Promise.resolve({ leagueId }) });
    expect((await response.json()).data.invites).toEqual([]);
  });

  it("answers 403 for a member who is not the commissioner", async () => {
    const { leagueId } = await league();
    signedInAs("u2");
    const response = await getInvites(get(), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(403);
  });
});

describe("DELETE /api/leagues/[leagueId]/invites", () => {
  it("revokes a live code, and the list no longer carries it (C-03)", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    const minted = await (await postInvite(post(), { params: Promise.resolve({ leagueId }) })).json();

    const response = await deleteInvite(del({ code: minted.data.code }), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(200);

    const listed = await getInvites(get(), { params: Promise.resolve({ leagueId }) });
    expect((await listed.json()).data.invites).toEqual([]);
  });

  it("answers 404 for a code that does not belong to this league", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    const response = await deleteInvite(del({ code: "NOSUCH12" }), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(404);
  });

  it("answers 403 for a member who is not the commissioner", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    const minted = await (await postInvite(post(), { params: Promise.resolve({ leagueId }) })).json();

    signedInAs("u2");
    const response = await deleteInvite(del({ code: minted.data.code }), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(403);
  });
});
