import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: vi.fn() }));

import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { players } from "@research-ts/db/schema";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createSheet, replaceEntries } from "@/draft-hq/sheet/service";
import { DELETE, POST, PUT } from "./route";

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

function req(method: string, body?: unknown, url = "http://test/api/draft/sheets/x/entries"): Request {
  return new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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

describe("/api/draft/sheets/[sheetId]/entries", () => {
  it("POST adds a player to the bottom of the sheet", async () => {
    const sheet = await createSheet(db, "u1", { name: "Sheet" });
    const response = await POST(req("POST", { playerId: "p1", tag: "target" }), ctx(sheet.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly data: { readonly entries: readonly { readonly playerId: string; readonly tag: string | null }[] } };
    expect(body.data.entries).toEqual([expect.objectContaining({ playerId: "p1", tag: "target" })]);
  });

  it("PUT reorders the sheet", async () => {
    const sheet = await createSheet(db, "u1", { name: "Sheet" });
    await replaceEntries(db, "u1", sheet.id, [{ playerId: "p1" }, { playerId: "p2" }]);
    const response = await PUT(req("PUT", { order: ["p2", "p1"] }), ctx(sheet.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly data: { readonly entries: readonly { readonly playerId: string }[] } };
    expect(body.data.entries.map((entry) => entry.playerId)).toEqual(["p2", "p1"]);
  });

  it("DELETE removes one player by query param", async () => {
    const sheet = await createSheet(db, "u1", { name: "Sheet" });
    await replaceEntries(db, "u1", sheet.id, [{ playerId: "p1" }, { playerId: "p2" }]);
    const response = await DELETE(req("DELETE", undefined, `http://test/api/draft/sheets/x/entries?playerId=p1`), ctx(sheet.id));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { readonly data: { readonly entries: readonly { readonly playerId: string }[] } };
    expect(body.data.entries.map((entry) => entry.playerId)).toEqual(["p2"]);
  });

  it("404s every verb against a sheet that is not the caller's own", async () => {
    await db.insert(users).values({ id: "u2", email: "u2@test.local", displayName: "u2" });
    const sheet = await createSheet(db, "u2", { name: "Not mine" });
    expect((await POST(req("POST", { playerId: "p1" }), ctx(sheet.id))).status).toBe(404);
  });
});
