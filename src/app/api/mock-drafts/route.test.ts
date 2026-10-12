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
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { draftSlotPreferences, drafts, mockRooms, users } from "@/db/schema";
import { createDraftStore } from "@/draft-service/store";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { seedLobbyMock, seedPracticePlayers } from "@/mock-draft-service/test-support";
import { resetMockRateLimits } from "./_shared";
import { GET, POST } from "./route";

const db = createTestDb();

const currentUser = (id: string) => ({
  id,
  email: `${id}@test.local`,
  displayName: id,
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  isAdmin: false,
});

const signedInAs = (id: string | null) => {
  vi.mocked(getCurrentUser).mockResolvedValue(id === null ? null : currentUser(id));
};

function post(body: unknown) {
  const request = new Request("http://test/api/mock-drafts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request);
}

function get() {
  return GET(new Request("http://test/api/mock-drafts"));
}

async function seedUser(id: string): Promise<string> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id }).onConflictDoNothing();
  return id;
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  resetMockRateLimits();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/mock-drafts", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await post({ mode: "solo" });
    expect(response.status).toBe(401);
    const body = (await response.json()) as { readonly ok: false };
    expect(body.ok).toBe(false);
  });

  it("answers 400 naming the field for an out-of-bounds teamCount, the bound coming from MOCK_CONFIG", async () => {
    await seedUser("u_bad_team_count");
    signedInAs("u_bad_team_count");

    const response = await post({ mode: "lobby", teamCount: 14 });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toContain("teamCount");
    expect(MOCK_CONFIG.teamCountOptions).not.toContain(14);
  });

  it("creates a lobby room from just a mode, and answers 201 with the ids a client needs next", async () => {
    await seedUser("u_lobby_host");
    signedInAs("u_lobby_host");

    const response = await post({ mode: "lobby" });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      readonly ok: true;
      readonly data: { readonly leagueId: string; readonly teamId: string; readonly draftId: string; readonly shareCode: string; readonly startsAt: string };
    };
    expect(body.data.leagueId).toBeTruthy();
    expect(body.data.teamId).toBeTruthy();
    expect(body.data.draftId).toBeTruthy();
    expect(body.data.shareCode).toBeTruthy();

    const [room] = await db.select().from(mockRooms).where(eq(mockRooms.leagueId, body.data.leagueId));
    expect(room).toMatchObject({ mode: "lobby", shareCode: body.data.shareCode });
  });

  it("starts a solo room in the same call — the caller's own draft is already in progress by the time this responds", async () => {
    await seedUser("u_solo_host");
    await seedPracticePlayers(db);
    signedInAs("u_solo_host");

    const response = await post({ mode: "solo", teamCount: 8 });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly draftId: string } };

    const [draft] = await db.select({ status: drafts.status }).from(drafts).where(eq(drafts.id, body.data.draftId));
    expect(draft?.status).toBe("in_progress");
  });

  it("answers 429 once the per-user create ceiling is spent", async () => {
    await seedUser("u_create_limit");
    signedInAs("u_create_limit");

    let lastStatus = 0;
    for (let i = 0; i < MOCK_CONFIG.rateLimit.create.maxRequests + 1; i++) {
      lastStatus = (await post({ mode: "lobby" })).status;
    }
    expect(lastStatus).toBe(429);
  });

  it("threads draftSlot through to the started draft's own order (founder directive 2026-08-26)", async () => {
    await seedUser("u_slot_host");
    await seedPracticePlayers(db);
    signedInAs("u_slot_host");

    // The LAST slot (draftSlot === teamCount) is the one preference `assignDraftSlots`
    // (`@/draft-service/order`) can never lose regardless of where the real-UUID shuffle draws
    // the host: with only the host ranked, every unranked bot fills strictly bottom-up, so the
    // final slot is never claimed by fallback ahead of the host's own turn. A middle slot (say
    // 5 of 8) is NOT a sure thing — the host only keeps it if drawn before position 5 in the
    // shuffle — so this route-level test (real random UUIDs, no seeded shuffle to control) picks
    // the one slot number that is deterministic under any draw order, to avoid a flaky assertion.
    const response = await post({ mode: "solo", teamCount: 8, draftSlot: 8 });
    expect(response.status).toBe(201);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly draftId: string; readonly teamId: string } };

    const [preference] = await db
      .select({ ranking: draftSlotPreferences.ranking })
      .from(draftSlotPreferences)
      .where(eq(draftSlotPreferences.draftId, body.data.draftId));
    expect(preference?.ranking).toEqual([8]);

    const store = createDraftStore({ db, publish: async () => "0-0", clock: { now: () => new Date().toISOString() } });
    const state = await store.getDraftState(body.data.draftId);
    expect(state!.draftOrder[7]).toBe(body.data.teamId);
  });

  it("answers 400 naming the field for a draftSlot outside the request's own teamCount", async () => {
    await seedUser("u_bad_slot");
    signedInAs("u_bad_slot");

    const response = await post({ mode: "lobby", teamCount: 8, draftSlot: 9 });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toBe("draftSlot: Pick a draft position from 1 to 8.");
  });

  it("forwards createMockRoom's own failure status and reason, rather than assuming 500", async () => {
    // A session naming a user who was never seeded: `getCurrentUser` is mocked, so `withCurrentUser`
    // never checks the database, and the transaction's own `teams` insert (the host's seat) hits
    // the real `users` FK and rolls back — `createMockRoom`'s own catch answers `{ ok: false,
    // status: 500 }`, and this test proves the route forwards that pair rather than assuming a
    // fixed status of its own.
    signedInAs("u_never_seeded");

    const response = await post({ mode: "lobby" });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.ok).toBe(false);
    expect(body.error.length).toBeGreaterThan(0);
  });
});

describe("GET /api/mock-drafts", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await get();
    expect(response.status).toBe(401);
  });

  it("lists the open lobby and the caller's own rooms separately", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await seedUser("u_lobby_reader");
    signedInAs("u_lobby_reader");

    const response = await get();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly ok: true;
      readonly data: { readonly open: readonly { readonly leagueId: string }[]; readonly mine: readonly { readonly leagueId: string }[] };
    };
    expect(body.data.open.map((r) => r.leagueId)).toContain(room.leagueId);
    expect(body.data.mine).toEqual([]);
  });

  it("lists the caller's own room even when it is a link room the open lobby never surfaces", async () => {
    signedInAs("u_lobby_owner");
    await seedUser("u_lobby_owner");
    const created = await post({ mode: "link" });
    // reset ceiling touched by the create call above so the read below is unaffected
    resetMockRateLimits();
    const createdBody = (await created.json()) as { readonly data: { readonly leagueId: string } };

    const response = await get();
    const body = (await response.json()) as { readonly data: { readonly mine: readonly { readonly leagueId: string }[] } };
    expect(body.data.mine.map((r) => r.leagueId)).toContain(createdBody.data.leagueId);
  });

  it("answers 429 once the per-user read ceiling is spent", async () => {
    await seedUser("u_read_limit");
    signedInAs("u_read_limit");

    let lastStatus = 0;
    for (let i = 0; i < MOCK_CONFIG.rateLimit.read.maxRequests + 1; i++) {
      lastStatus = (await get()).status;
    }
    expect(lastStatus).toBe(429);
  });
});
