import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// The route handler uses the process-wide getDb(); point it at the test infrastructure before
// any module is imported, the same way every other route test does.
vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb, truncateAll } from "@/db/test-db";
import { players } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SEARCH_CONFIG } from "@/search/config";
import { GET } from "./route";
import { resetSearchRateLimit } from "./_shared";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null ? null : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

const get = (query: string) => GET(new Request(`http://test/api/search?q=${encodeURIComponent(query)}`));

beforeEach(async () => {
  await truncateAll(db);
  await db.insert(players).values({ id: "k-bates", name: "Jake Bates", position: "K", nflTeam: "DET", adp: 140.5, posAdp: "K1" });
  vi.mocked(getCurrentUser).mockReset();
  resetSearchRateLimit();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/search", () => {
  it("answers 401 JSON, never a redirect, when nobody is signed in", async () => {
    signedInAs(null);
    const response = await get("bates");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("answers 400 naming the field for a blank or oversized query", async () => {
    signedInAs("u1");
    expect((await get("   ")).status).toBe(400);
    const long = await get("a".repeat(SEARCH_CONFIG.maxQueryLength + 1));
    expect(long.status).toBe(400);
    expect(await long.json()).toMatchObject({ ok: false, error: expect.stringContaining("q:") });
  });

  it("answers the envelope with the query and its results, no-store", async () => {
    signedInAs("u1");
    const response = await get("bates");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.data.query).toBe("bates");
    expect(body.data.results).toHaveLength(1);
    expect(body.data.results[0]).toMatchObject({ kind: "player", player: { id: "k-bates", name: "Jake Bates" }, positionRank: 1, boardRank: null });
  });

  it("answers an empty list for a query nothing matches", async () => {
    signedInAs("u1");
    const body = await (await get("zzq")).json();
    expect(body).toEqual({ ok: true, data: { query: "zzq", results: [] } });
  });

  it("rate limits one caller past the configured ceiling", async () => {
    signedInAs("u1");
    for (let i = 0; i < SEARCH_CONFIG.rateLimit.maxRequests; i += 1) expect((await get("b")).status).toBe(200);
    expect((await get("b")).status).toBe(429);
  });
});
