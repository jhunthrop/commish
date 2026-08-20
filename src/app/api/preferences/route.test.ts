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
import { readPreferences } from "@/identity-service/preferences";
import { PATCH } from "./route";

const db = createTestDb();

const signedInAs = (id: string | null) =>
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z" },
  );

function patch(body: unknown): Request {
  return new Request("http://test/api/preferences", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("PATCH /api/preferences", () => {
  it("answers 401 JSON — never a redirect — when nobody is signed in", async () => {
    signedInAs(null);
    const response = await PATCH(patch({ dismissDraftTour: true }));
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("answers 400 for a body that isn't one of the two known fields", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await PATCH(patch({ helpLevel: "extreme" }));
    expect(response.status).toBe(400);
  });

  it("stamps the tour dismissal, leaving a previously-seeded help level untouched", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1", experienceTier: "experienced" });
    await readPreferences(db, { id: "u1", experienceTier: "experienced" });
    signedInAs("u1");

    const response = await PATCH(patch({ dismissDraftTour: true }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly ok: true; readonly data: { readonly helpLevel: string; readonly draftTourDismissedAt: string | null } };
    expect(body.data.helpLevel).toBe("standard");
    expect(body.data.draftTourDismissedAt).not.toBeNull();
  });

  it("writes a new help level", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    await readPreferences(db, { id: "u1", experienceTier: "beginner" });
    signedInAs("u1");

    const response = await PATCH(patch({ helpLevel: "standard" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { helpLevel: "standard", draftTourDismissedAt: null } });
  });

  it("answers 500 rather than crashing when the caller never had preferences seeded", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    const response = await PATCH(patch({ dismissDraftTour: true }));
    expect(response.status).toBe(500);
  });
});
