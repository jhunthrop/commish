import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  requireAdmin: vi.fn(),
}));

import { moneyAccounts, moneyEntries, moneyTransactions, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { requireAdmin } from "@/lib/auth/current-user";
import { accountIdFor } from "@/money/accounts";
import { SETTLEMENT_REFUSALS } from "@/money-service/settlement";
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

function previewHold(userId: string) {
  const request = new Request(`http://test/api/admin/holds/${userId}`);
  return GET(request, { params: Promise.resolve({ userId }) });
}

async function seedHeldMember(userId: string, heldCents: number): Promise<void> {
  await db.insert(users).values({ id: userId, email: `${userId}@test.local`, displayName: `Display ${userId}`, kycStatus: "verified" });
  const accountId = accountIdFor("held_for_review", userId);
  await db.insert(moneyAccounts).values({ id: accountId, kind: "held_for_review", ownerId: userId, balanceCents: heldCents });
  await db.insert(moneyTransactions).values({ id: `mt_${userId}`, kind: "settlement" as const, leagueId: null });
  await db.insert(moneyEntries).values({
    id: `me_${userId}`,
    accountId,
    transactionId: `mt_${userId}`,
    direction: "credit",
    amountCents: heldCents,
    stateOfEntry: "TN",
    taxYear: 2026,
  });
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(requireAdmin).mockReset();
});

afterAll(async () => {
  await truncateAll(db);
});

describe("GET /api/admin/holds/[userId]", () => {
  it("answers 401 JSON when nobody is signed in", async () => {
    signedInAs(null);
    const response = await previewHold("u_x");
    expect(response.status).toBe(401);
  });

  it("answers 404, never 403, for a signed-in non-operator (ruling 14)", async () => {
    signedInAs("u_plain");
    const response = await previewHold("u_x");
    expect(response.status).toBe(404);
  });

  it("answers 404 for a member that does not exist, the service's own refusal surfaced verbatim", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    const response = await previewHold("u_ghost");
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: SETTLEMENT_REFUSALS.memberMissing });
  });

  it("names the member and the held amount, without moving money", async () => {
    await db.insert(users).values({ id: "u_op", email: "u_op@test.local", displayName: "u_op", isAdmin: true });
    signedInAs("u_op");
    await seedHeldMember("u_flag", 40_00);

    const response = await previewHold("u_flag");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: { userId: "u_flag", displayName: "Display u_flag", heldCents: 40_00 } });
  });
});
