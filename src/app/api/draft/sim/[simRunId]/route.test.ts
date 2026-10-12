import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { createSimRun, hashSimConfig } from "@/draft-service/sim/store";
import type { SimConfig } from "@/draft-service/sim/types";
import { GET } from "./route";

const db = createTestDb();

function signedInAs(id: string | null) {
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );
}

function get(id: string): Request {
  return new Request(`http://test/api/draft/sim/${id}`, { method: "GET" });
}

function context(id: string) {
  return { params: Promise.resolve({ simRunId: id }) };
}

const CONFIG: SimConfig = { teamCount: 12, rosterSlots: STANDARD_ROSTER_SLOTS, slot: 7, rounds: 15, runs: 1000, sharpness: 0.5, seed: 1 };

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/draft/sim/[simRunId]", () => {
  it("401s a signed-out caller", async () => {
    signedInAs(null);
    expect((await GET(get("missing"), context("missing"))).status).toBe(401);
  });

  it("404s a run that does not exist", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    expect((await GET(get("missing"), context("missing"))).status).toBe(404);
  });

  it("404s another user's run rather than revealing it exists", async () => {
    await db.insert(users).values([
      { id: "u1", email: "u1@test.local", displayName: "u1" },
      { id: "u2", email: "u2@test.local", displayName: "u2" },
    ]);
    await createSimRun(db, { id: "run-1", userId: "u2", leagueId: null, config: CONFIG, configHash: hashSimConfig(CONFIG), boardGeneration: "gen-1" });
    signedInAs("u1");
    expect((await GET(get("run-1"), context("run-1"))).status).toBe(404);
  });

  it("returns the caller's own run", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    await createSimRun(db, { id: "run-1", userId: "u1", leagueId: null, config: CONFIG, configHash: hashSimConfig(CONFIG), boardGeneration: "gen-1" });
    signedInAs("u1");
    const response = await GET(get("run-1"), context("run-1"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.id).toBe("run-1");
    expect(body.data.status).toBe("pending");
  });
});
