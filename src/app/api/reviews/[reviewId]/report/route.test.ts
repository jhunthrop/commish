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
import { POST } from "./route";
import { resetReviewRateLimits } from "../../_shared";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z" },
  );

function post(reviewId: string, body: unknown) {
  const request = new Request(`http://test/api/reviews/${reviewId}/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ reviewId }) });
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  resetReviewRateLimits();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/reviews/[reviewId]/report", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await post("r1", { reason: "spam" });
    expect(response.status).toBe(401);
  });

  it("answers 400 for a reason outside the closed set", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await post("r1", { reason: "not-a-real-reason" });
    expect(response.status).toBe(400);
  });

  it("answers 404 for a review that doesn't exist", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await post("missing", { reason: "spam" });
    expect(response.status).toBe(404);
  });

  it("succeeds, and a second report from the same user is the same report, not an error", async () => {
    await db.insert(users).values({ id: "author", email: "author@test.local", displayName: "author" });
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    await db.insert(reviews).values({ id: "r1", userId: "author", rating: 1, body: "Spam spam spam, click here for free stuff!" });
    signedInAs("u1");

    const first = await post("r1", { reason: "spam" });
    expect(first.status).toBe(200);
    const second = await post("r1", { reason: "spam" });
    expect(second.status).toBe(200);
  });
});
