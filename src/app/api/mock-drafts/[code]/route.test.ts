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
import { getCurrentUser } from "@/lib/auth/current-user";
import { MOCK_REFUSALS } from "@/mock-draft-service/claim";
import { MOCK_CONFIG } from "@/mock-draft/config";
import { seedLobbyMock } from "@/mock-draft-service/test-support";
import { resetMockRateLimits } from "../_shared";
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

function get(code: string) {
  return GET(new Request(`http://test/api/mock-drafts/${code}`), { params: Promise.resolve({ code }) });
}

function claim(code: string) {
  return POST(new Request(`http://test/api/mock-drafts/${code}`, { method: "POST" }), { params: Promise.resolve({ code }) });
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

describe("GET /api/mock-drafts/[code]", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await get("ANYCODE");
    expect(response.status).toBe(401);
  });

  it("answers the room's summary for a valid code", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await seedUser("u_summary_reader");
    signedInAs("u_summary_reader");

    const response = await get(room.shareCode);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly ok: true;
      readonly data: { readonly leagueId: string; readonly mode: string; readonly seatsOpen: number; readonly alreadySeated: boolean };
    };
    expect(body.data).toMatchObject({ leagueId: room.leagueId, mode: "lobby", seatsOpen: 7, alreadySeated: false });
  });

  it("answers 404 with the shared missing-room refusal for a code that names nothing", async () => {
    await seedUser("u_summary_lost");
    signedInAs("u_summary_lost");

    const response = await get("NOPE99");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toBe(MOCK_REFUSALS.missing);
  });

  it("answers 429 once the shared per-user read ceiling is spent", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await seedUser("u_summary_limit");
    signedInAs("u_summary_limit");

    let lastStatus = 0;
    for (let i = 0; i < MOCK_CONFIG.rateLimit.read.maxRequests + 1; i++) {
      lastStatus = (await get(room.shareCode)).status;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("POST /api/mock-drafts/[code]", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await claim("ANYCODE");
    expect(response.status).toBe(401);
  });

  it("claims an open seat and answers the room's ids", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await seedUser("u_claimer");
    signedInAs("u_claimer");

    const response = await claim(room.shareCode);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      readonly ok: true;
      readonly data: { readonly leagueId: string; readonly draftId: string; readonly teamId: string; readonly alreadySeated: boolean };
    };
    expect(body.data).toMatchObject({ leagueId: room.leagueId, draftId: room.draftId, alreadySeated: false });
  });

  it("treats a second claim by the same person as re-entry, not an error", async () => {
    const room = await seedLobbyMock(db, { teamCount: 8, humans: 1 });
    await seedUser("u_re_enter");
    signedInAs("u_re_enter");

    await claim(room.shareCode);
    const second = await claim(room.shareCode);
    expect(second.status).toBe(200);
    const body = (await second.json()) as { readonly data: { readonly alreadySeated: boolean } };
    expect(body.data.alreadySeated).toBe(true);
  });

  it("surfaces MOCK_REFUSALS.full with status 409 for a full room", async () => {
    const room = await seedLobbyMock(db, { teamCount: 2, humans: 2 });
    await seedUser("u_thirteenth");
    signedInAs("u_thirteenth");

    const response = await claim(room.shareCode);
    expect(response.status).toBe(409);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toBe(MOCK_REFUSALS.full);
  });

  it("answers 404 with the shared missing-room refusal for a code that names nothing", async () => {
    await seedUser("u_claim_lost");
    signedInAs("u_claim_lost");

    const response = await claim("NOPE99");
    expect(response.status).toBe(404);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toBe(MOCK_REFUSALS.missing);
  });

  it("answers 400 for a blank code, the same zod boundary schemas.ts states the claim door owns", async () => {
    await seedUser("u_blank_code");
    signedInAs("u_blank_code");

    const response = await claim("   ");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.ok).toBe(false);
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("answers 429 once the per-user claim ceiling is spent", async () => {
    const room = await seedLobbyMock(db, { teamCount: 12, humans: 1 });
    await seedUser("u_claim_limit");
    signedInAs("u_claim_limit");

    let lastStatus = 0;
    for (let i = 0; i < MOCK_CONFIG.rateLimit.claim.maxRequests + 1; i++) {
      lastStatus = (await claim(room.shareCode)).status;
    }
    expect(lastStatus).toBe(429);
  });
});
