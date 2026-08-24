import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

import { createTestDb, truncateAll } from "@/db/test-db";
import { reviews, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { removeReview } from "@/review-service/reviews";
import { REVIEW_CONFIG } from "@/reviews/config";
import { GET, POST } from "./route";
import { resetReviewRateLimits } from "./_shared";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );

function get(query = "", forwardedFor?: string): Request {
  return new Request(
    `http://test/api/reviews${query}`,
    forwardedFor === undefined ? undefined : { headers: { "x-forwarded-for": forwardedFor } },
  );
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

  // The KEY, not just the ceiling. Rekeying this limiter to a single "GLOBAL" bucket passed all
  // 15 route tests in this file, because none of them ever varied the caller — the docblock's own
  // "per-IP" claim was untested at the wiring. This is Task 7's assertion
  // (`league-routes.test.ts`: "a DIFFERENT caller spends its own budget"), which Task 9's copy of
  // the limiter pattern dropped.
  it("keys the browse ceiling per caller: a DIFFERENT IP spends its own budget", async () => {
    for (let i = 0; i < REVIEW_CONFIG.browseRateLimit.maxRequests; i += 1) {
      expect((await GET(get("", "203.0.113.9"))).status).toBe(200);
    }
    expect((await GET(get("", "203.0.113.9"))).status).toBe(429);
    expect((await GET(get("", "198.51.100.4"))).status).toBe(200);
  });

  // FIX 1: a malformed `before` cursor used to reach `new Date(garbage).toISOString()` inside
  // `feedQuery` unvalidated and throw an uncaught RangeError on this PUBLIC, unauthenticated
  // route. It must now be a 400 naming the field, never a 500.
  it("answers 400 naming the field for a garbage before cursor", async () => {
    const response = await GET(get("?before=not-a-date-at-all"));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toContain("before");
  });

  it("answers 400 for a date-only (non-ISO-datetime) before value", async () => {
    const response = await GET(get("?before=2026-08-19"));
    expect(response.status).toBe(400);
  });

  // A cursor is a timestamp AND a row id (`@/reviews/cursor`). A bare timestamp — including one
  // this feed handed out before the id joined the sort key — is refused rather than silently
  // paging with a non-unique key.
  it("answers 400 for a bare-timestamp cursor with no row id", async () => {
    const response = await GET(get(`?before=${encodeURIComponent("2026-08-19T00:00:00.000Z")}`));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toContain("before");
  });

  it("accepts a well-formed compound cursor", async () => {
    const response = await GET(get(`?before=${encodeURIComponent("2026-08-19T00:00:00.000Z|r1")}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { reviews: [], hasMore: false, nextBefore: null } });
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

  it("answers 409 at the wire when the caller's review has been removed", async () => {
    await db.insert(users).values([
      { id: "u1", email: "u1@test.local", displayName: "u1" },
      { id: "operator", email: "operator@test.local", displayName: "operator" },
    ]);
    signedInAs("u1");
    await POST(post({ rating: 1, body: LONG_ENOUGH }));
    const [row] = await db.select({ id: reviews.id }).from(reviews);
    await removeReview(db, { reviewId: row!.id, removedByUserId: "operator", reason: "spam" });

    const response = await POST(post({ rating: 5, body: "Trying to write over the review that was taken down for spam." }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, error: "We removed your review. It cannot be edited." });
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

  it("keys the submit ceiling per caller: a DIFFERENT user spends its own budget", async () => {
    await db.insert(users).values([
      { id: "u1", email: "u1@test.local", displayName: "u1" },
      { id: "u2", email: "u2@test.local", displayName: "u2" },
    ]);
    signedInAs("u1");
    for (let i = 0; i < REVIEW_CONFIG.submitRateLimit.maxRequests; i += 1) {
      await POST(post({ rating: 3, body: LONG_ENOUGH }));
    }
    expect((await POST(post({ rating: 3, body: LONG_ENOUGH }))).status).toBe(429);

    signedInAs("u2");
    expect((await POST(post({ rating: 3, body: LONG_ENOUGH }))).status).toBe(200);
  });
});
