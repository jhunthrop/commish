import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { createTestDb, truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { REVIEW_CONFIG } from "@/reviews/config";
import { GET, POST } from "./route";
import { resetReviewRateLimits } from "./_shared";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z" },
  );

function get(query = ""): Request {
  return new Request(`http://test/api/reviews${query}`);
}

function post(body: unknown): Request {
  return new Request("http://test/api/reviews", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const LONG_ENOUGH = "This league runs itself. Draft night was smooth and scoring settled fast.";

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  resetReviewRateLimits();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/reviews", () => {
  it("answers 200 with an empty page when there are no reviews, with no sign-in required", async () => {
    const response = await GET(get());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { reviews: [], hasMore: false, nextBefore: null } });
  });

  it("lists a submitted review newest-first, signed out", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Ada Lovelace" });
    signedInAs("u1");
    await POST(post({ rating: 1, body: LONG_ENOUGH }));
    signedInAs(null);

    const response = await GET(get());
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly reviews: readonly { readonly rating: number }[] } };
    expect(body.data.reviews).toHaveLength(1);
    expect(body.data.reviews[0]?.rating).toBe(1);
  });

  it("answers 429 once the caller is past the rate-limit threshold", async () => {
    for (let i = 0; i < REVIEW_CONFIG.browseRateLimit.maxRequests; i += 1) {
      const response = await GET(get());
      expect(response.status).toBe(200);
    }
    const limited = await GET(get());
    expect(limited.status).toBe(429);
  });
});

describe("POST /api/reviews", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    signedInAs(null);
    const response = await POST(post({ rating: 5, body: LONG_ENOUGH }));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("answers 400 for a body shorter than the floor", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await POST(post({ rating: 5, body: "too short" }));
    expect(response.status).toBe(400);
  });

  it("writes and round-trips a review on success", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "Ada Lovelace", avatarUrl: "preset:shield" });
    signedInAs("u1");
    const response = await POST(post({ rating: 4, body: LONG_ENOUGH }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly rating: number; readonly authorName: string; readonly authorAvatar: string | null } };
    expect(body.data).toMatchObject({ rating: 4, body: LONG_ENOUGH, authorName: "Ada Lovelace", authorAvatar: "preset:shield" });
  });

  it("edits rather than duplicates a second POST from the same user", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    await POST(post({ rating: 2, body: LONG_ENOUGH }));
    await POST(post({ rating: 5, body: "Revising my review: everything I complained about got fixed fast." }));

    const list = await GET(get());
    const body = (await list.json()) as { readonly ok: true; readonly data: { readonly reviews: readonly unknown[] } };
    expect(body.data.reviews).toHaveLength(1);
  });

  it("answers 429 once the caller is past the rate-limit threshold", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    for (let i = 0; i < REVIEW_CONFIG.submitRateLimit.maxRequests; i += 1) {
      const response = await POST(post({ rating: 3, body: LONG_ENOUGH }));
      expect(response.status).toBe(200);
    }
    const limited = await POST(post({ rating: 3, body: LONG_ENOUGH }));
    expect(limited.status).toBe(429);
  });
});
