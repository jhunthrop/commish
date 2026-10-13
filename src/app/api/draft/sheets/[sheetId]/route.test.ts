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
import { createSheet } from "@/draft-hq/sheet/service";
import { DELETE, GET, PATCH } from "./route";

const db = createTestDb();

function signedInAs(id: string | null) {
  vi.mocked(getCurrentUser).mockResolvedValue(
    id === null
      ? null
      : { id, email: `${id}@test.local`, displayName: id, experienceTier: "beginner", avatarUrl: null, createdAt: "2026-09-01T00:00:00.000Z", isAdmin: false },
  );
}

function req(method: string, body?: unknown): Request {
  return new Request("http://test/api/draft/sheets/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}

function ctx(sheetId: string) {
  return { params: Promise.resolve({ sheetId }) };
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("/api/draft/sheets/[sheetId]", () => {
  it("GET 404s a sheet id that does not exist", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    signedInAs("u1");
    expect((await GET(req("GET"), ctx("nope"))).status).toBe(404);
  });

  it("GET 404s a stranger's sheet — the non-oracle answer", async () => {
    await db.insert(users).values([
      { id: "u1", email: "u1@test.local", displayName: "u1" },
      { id: "u2", email: "u2@test.local", displayName: "u2" },
    ]);
    const sheet = await createSheet(db, "u1", { name: "Mine" });
    signedInAs("u2");
    expect((await GET(req("GET"), ctx(sheet.id))).status).toBe(404);
  });

  it("GET 200s the caller's own sheet", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    const sheet = await createSheet(db, "u1", { name: "Mine" });
    signedInAs("u1");
    const response = await GET(req("GET"), ctx(sheet.id));
    expect(response.status).toBe(200);
  });

  it("PATCH renames the caller's own sheet", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    const sheet = await createSheet(db, "u1", { name: "Old" });
    signedInAs("u1");
    const response = await PATCH(req("PATCH", { name: "New" }), ctx(sheet.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly data: { readonly name: string } };
    expect(body.data.name).toBe("New");
  });

  it("DELETE removes the caller's own sheet and 404s a repeat", async () => {
    await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
    const sheet = await createSheet(db, "u1", { name: "Doomed" });
    signedInAs("u1");
    expect((await DELETE(req("DELETE"), ctx(sheet.id))).status).toBe(200);
    expect((await DELETE(req("DELETE"), ctx(sheet.id))).status).toBe(404);
  });
});
