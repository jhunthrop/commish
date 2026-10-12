import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSheet } from "@/draft-hq/sheet/service";
import { POST } from "./route";

const db = createTestDb();

function signedInAs(id: string) {
  vi.mocked(getCurrentUser).mockResolvedValue({
    id,
    email: `${id}@test.local`,
    displayName: id,
    experienceTier: "beginner",
    avatarUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    isAdmin: false,
  });
}

function req(body: unknown): Request {
  return new Request("http://test/api/draft/sheets/x/duplicate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function ctx(sheetId: string) {
  return { params: Promise.resolve({ sheetId }) };
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
  signedInAs("u1");
});

afterAll(async () => {
  await truncateAll(db);
});

describe("POST /api/draft/sheets/[sheetId]/duplicate", () => {
  it("copies a sheet under a fresh id", async () => {
    const sheet = await createSheet(db, "u1", { name: "Original" });
    const response = await POST(req({ name: "Copy" }), ctx(sheet.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly data: { readonly id: string; readonly name: string } };
    expect(body.data.id).not.toBe(sheet.id);
    expect(body.data.name).toBe("Copy");
  });

  it("404s a sheet that does not exist", async () => {
    expect((await POST(req({ name: "Copy" }), ctx("nope"))).status).toBe(404);
  });
});
