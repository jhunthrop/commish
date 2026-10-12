import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
  requireCurrentUser: vi.fn(),
}));

import { eq } from "drizzle-orm";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll } from "@/db/test-db";
import { leagues, users } from "@/db/schema";
import { STANDARD_ROSTER_SLOTS } from "@research-ts/domain/roster";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createLeague } from "@/league-service/creation";
import { PUT as putSettings } from "./route";

const db = createTestDb();
const clock = { now: () => "2026-09-05T12:00:00.000Z" };
let nextId = 0;
const newId = () => `id_${++nextId}`;

const profile = (id: string) => ({
  id, email: `${id}@test.local`, displayName: `Manager ${id}`,
  experienceTier: "beginner" as const, avatarUrl: null, createdAt: "2026-09-05T12:00:00.000Z", isAdmin: false,
});
const signedInAs = (id: string) => {
  vi.mocked(getCurrentUser).mockResolvedValue(profile(id));
};

const put = (body: unknown) =>
  new Request("http://commish.example/api/leagues/l1/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

async function league(): Promise<{ readonly leagueId: string }> {
  await db.insert(users).values([
    { id: "u1", email: "u1@test.local", displayName: "Manager 1" },
    { id: "u2", email: "u2@test.local", displayName: "Manager 2" },
  ]);
  const created = await createLeague({ db, clock, newId }, {
    name: "Sunday Money", format: "snake", teamCount: 12, scoringPreset: "ppr",
    auctionBudget: null, rosterSlots: STANDARD_ROSTER_SLOTS, owner: { kind: "member", userId: "u1", teamName: "Team One" },
    experienceTier: "beginner", stakeTier: 0, isPublicMatchmade: false,
  });
  if (!created.ok) throw new Error(created.reason);
  return { leagueId: created.leagueId };
}

beforeEach(async () => {
  await truncateAll(db);
  nextId = 0;
  vi.mocked(getCurrentUser).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("PUT /api/leagues/[leagueId]/settings", () => {
  it("lets the commissioner turn draft grades off, and the write lands on the league row", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    const response = await putSettings(put({ draftGradesVisible: false }), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.draftGradesVisible).toBe(false);

    const [row] = await db.select({ draftGradesVisible: leagues.draftGradesVisible }).from(leagues).where(eq(leagues.id, leagueId));
    expect(row?.draftGradesVisible).toBe(false);
  });

  it("turns it back on just as freely — no one-way, no state-machine gate", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    await putSettings(put({ draftGradesVisible: false }), { params: Promise.resolve({ leagueId }) });
    const response = await putSettings(put({ draftGradesVisible: true }), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(200);
    const [row] = await db.select({ draftGradesVisible: leagues.draftGradesVisible }).from(leagues).where(eq(leagues.id, leagueId));
    expect(row?.draftGradesVisible).toBe(true);
  });

  it("answers 403 for a member who is not the commissioner, and never writes", async () => {
    const { leagueId } = await league();
    signedInAs("u2");
    const response = await putSettings(put({ draftGradesVisible: false }), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(403);
    const [row] = await db.select({ draftGradesVisible: leagues.draftGradesVisible }).from(leagues).where(eq(leagues.id, leagueId));
    expect(row?.draftGradesVisible).toBe(true);
  });

  it("400s a non-boolean body", async () => {
    const { leagueId } = await league();
    signedInAs("u1");
    const response = await putSettings(put({ draftGradesVisible: "off" }), { params: Promise.resolve({ leagueId }) });
    expect(response.status).toBe(400);
  });
});
