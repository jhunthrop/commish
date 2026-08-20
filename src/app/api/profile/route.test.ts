import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

// The route handler uses the process-wide getDb(); point it at the test infrastructure
// before any module is imported. vi.hoisted runs before the import graph.
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
import { IDENTITY_CONFIG } from "@/identity";
import { PATCH } from "./route";
import { resetProfileRateLimit } from "./_shared";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z" },
  );

function patch(body: unknown): Request {
  return new Request("http://test/api/profile", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_BODY = { displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "shield" };

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  resetProfileRateLimit();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("PATCH /api/profile", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    signedInAs(null);
    const response = await PATCH(patch(VALID_BODY));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("answers 400 naming the field for a two-character-short name", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await PATCH(patch({ ...VALID_BODY, displayName: "A" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toContain("displayName");
    expect(body.error).toContain("Your name needs at least 2 characters.");
  });

  it("answers 429 once the caller is past the rate-limit threshold", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    for (let i = 0; i < IDENTITY_CONFIG.profileRateLimit.maxRequests; i += 1) {
      const response = await PATCH(patch(VALID_BODY));
      expect(response.status).toBe(200);
    }
    const limited = await PATCH(patch(VALID_BODY));
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({
      ok: false,
      error: "You've changed that a lot in a short time. Give it a minute and try again.",
    });
  });

  it("writes and round-trips the profile on success", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await PATCH(patch(VALID_BODY));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      data: { displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "shield", avatar: "preset:shield" },
    });
  });

  it("answers 400 for a display name carrying hidden characters", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    // A right-to-left override in front of a reversed name: renders as something other than the
    // characters it is made of, under `authorName` on the unauthenticated /reviews page.
    const response = await PATCH(patch({ displayName: `${String.fromCharCode(0x202e)}troppuS hsimmoC` }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toContain("Your name can only use characters people can see.");
  });

  it("answers 400 for a body that asks for nothing", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await PATCH(patch({}));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { readonly ok: false; readonly error: string };
    expect(body.error).toContain("Send at least one of displayName, experienceTier or avatarPreset.");
  });

  it("writes only the field a sparse body names and leaves the rest of the row alone", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    await PATCH(patch(VALID_BODY));

    const response = await PATCH(patch({ avatarPreset: "flame" }));
    expect(await response.json()).toEqual({
      ok: true,
      data: { displayName: "Ada Lovelace", experienceTier: "experienced", avatarPreset: "flame", avatar: "preset:flame" },
    });
  });
});
