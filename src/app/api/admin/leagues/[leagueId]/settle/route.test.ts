import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  requireAdmin: vi.fn(),
}));

import { drafts, leagues, teams, users } from "@/db/schema";
import { createTestDb } from "@research/db/test-db";
import { truncateAll } from "@/db/test-db";
import { requireAdmin } from "@/lib/auth/current-user";
import { SETTLEMENT_REFUSALS } from "@/money-service/settlement";
import type { PrizeTable } from "@/money/prize-table";
import { GET } from "./route";

const db = createTestDb();

const signedInAs = (id: string | null) => {
  if (id === null) {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not authenticated."));
    return;
  }
  if (id === "u_plain") {
    vi.mocked(requireAdmin).mockRejectedValue(new Error("Not an operator."));
    return;
  }
  vi.mocked(requireAdmin).mockResolvedValue({
    id,
    email: `${id}@test.local`,
    displayName: id,
    experienceTier: "beginner",
    avatarUrl: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    isAdmin: true,
  });
};

function previewSettle(leagueId: string) {
  const request = new Request(`http://test/api/admin/leagues/${leagueId}/settle`);
  return GET(request, { params: Promise.resolve({ leagueId }) });
}

const TABLE_2: PrizeTable = [{ place: 1, amountCents: 40_00 }];

async function seedPaidLeague(leagueId: string, memberIds: readonly string[]): Promise<void> {
  await db.insert(users).values(memberIds.map((id) => ({ id, email: `${id}@test.local`, displayName: `Display ${id}`, kycStatus: "verified" as const })));
  await db.insert(leagues).values({
    id: leagueId,
    name: "Route Settle League",
    format: "snake",
    teamCount: memberIds.length,
    isPublicMatchmade: true,
    commissionerUserId: memberIds[0] ?? null,
    entryFeeCents: 20_00,
    platformFeeCents: 0,
    payoutTable: TABLE_2,
  });
  await db.insert(drafts).values({
    id: `${leagueId}_draft`,
    leagueId,
    format: "snake",
    status: "complete",
    kickoffAt: new Date("2026-09-20T17:00:00.000Z"),
    auctionBudget: null,
    startTrigger: "scheduled",
  });
  for (const userId of memberIds) {
    await db.insert(teams).values({ id: `${leagueId}_${userId}`, leagueId, userId, name: `Team ${userId}` });
  }
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(requireAdmin).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/admin/leagues/[leagueId]/settle", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await previewSettle("lg_x");
    expect(response.status).toBe(401);
  });

  it("answers 404, never 403, for a signed-in non-operator (ruling 14)", async () => {
    signedInAs("u_plain");
    const response = await previewSettle("lg_x");
    expect(response.status).toBe(404);
  });

  it("answers 404 for a league that does not exist, the service's own refusal surfaced verbatim", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const response = await previewSettle("lg_ghost");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: SETTLEMENT_REFUSALS.leagueMissing });
  });

  it("names the league, its prize table and a roster with names, without moving money", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    await seedPaidLeague("lg_real", ["u1", "u2"]);

    const response = await previewSettle("lg_real");
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      readonly data: {
        readonly leagueId: string;
        readonly leagueName: string;
        readonly seasonCompleted: boolean;
        readonly prizeTable: PrizeTable;
        readonly roster: readonly { readonly userId: string; readonly teamName: string; readonly ownerDisplayName: string }[];
      };
    };
    expect(payload.data.leagueId).toBe("lg_real");
    expect(payload.data.leagueName).toBe("Route Settle League");
    expect(payload.data.prizeTable).toEqual(TABLE_2);
    expect(payload.data.roster.map((row) => row.userId).sort()).toEqual(["u1", "u2"]);
    expect(payload.data.roster.every((row) => row.ownerDisplayName.startsWith("Display"))).toBe(true);
  });
});
