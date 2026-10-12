import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research/db/schema";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSheet } from "@/draft-hq/sheet/service";
import { PUT } from "./route";

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
  return new Request("http://test/api/draft/sheets/x/replace", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
function ctx(sheetId: string) {
  return { params: Promise.resolve({ sheetId }) };
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  await db.insert(users).values({ id: "u1", email: "u1@test.local", displayName: "u1" });
  await db.insert(players).values([
    { id: "p1", name: "Player One", position: "RB", nflTeam: "SF" },
    { id: "p2", name: "Player Two", position: "WR", nflTeam: "DAL" },
  ]);
  signedInAs("u1");
});

afterAll(async () => {
  await truncateAll(db);
});

describe("PUT /api/draft/sheets/[sheetId]/replace", () => {
  it("replaces the whole entry list — the CSV-import and re-seed write", async () => {
    const sheet = await createSheet(db, "u1", { name: "Sheet" });
    const response = await PUT(
      req({ entries: [{ playerId: "p2", tag: "target" }, { playerId: "p1", note: "sleeper" }] }),
      ctx(sheet.id),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly data: { readonly entries: readonly { readonly playerId: string; readonly rank: number }[] } };
    expect(body.data.entries.map((entry) => entry.playerId)).toEqual(["p2", "p1"]);
  });

  it("fix round 1, HIGH 2: 400s a body naming the same player twice, before it can ever reach the unique-index write", async () => {
    const sheet = await createSheet(db, "u1", { name: "Sheet" });
    const response = await PUT(req({ entries: [{ playerId: "p1" }, { playerId: "p1" }] }), ctx(sheet.id));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "entries: The same player cannot appear twice in one sheet." });
  });
});
