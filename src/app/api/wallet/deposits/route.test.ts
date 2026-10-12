import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

/**
 * The state list holder: the shipped `MONEY_STATES.enabled` is EMPTY (money ships dark), which
 * is itself the first refusal these tests prove — but the gates BEHIND the state gate (KYC, and
 * the happy path) are unreachable through the real constant, so the mock swaps the enabled list
 * per test while everything else in the module stays real.
 */
const stateHolder = vi.hoisted(() => ({ enabled: [] as { state: "TN"; minAge: number }[] }));
vi.mock("@/money/states", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/money/states")>();
  return {
    ...actual,
    MONEY_STATES: {
      neverEligible: actual.MONEY_STATES.neverEligible,
      get enabled() {
        return stateHolder.enabled;
      },
    },
  };
});

import { users } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { expectNoDepositTookPlace, expectNoPostingTookPlace } from "@/money-service/test-support";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { resetDepositRateLimit } from "../_shared";
import { POST } from "./route";

const db = createTestDb();

const currentUser = (id: string) => ({
  id,
  email: `${id}@test.local`,
  displayName: id,
  experienceTier: "beginner" as const,
  avatarUrl: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  isAdmin: false,
});

const signedInAs = (id: string | null) => {
  vi.mocked(getCurrentUser).mockResolvedValue(id === null ? null : currentUser(id));
};

async function seedUser(id: string, overrides: Partial<typeof users.$inferInsert> = {}): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id, kycStatus: "verified", ...overrides });
}

const validBody = { amountCents: 50_00, stateOfEntry: "TN", method: "bank", idempotencyKey: "form_key_1" };

function post(body: unknown) {
  return POST(
    new Request("http://test/api/wallet/deposits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  vi.mocked(getCurrentUser).mockReset();
  stateHolder.enabled = [];
  resetDepositRateLimit();
});

describe("POST /api/wallet/deposits", () => {
  it("answers 401 to a caller with no session, before anything else runs", async () => {
    signedInAs(null);
    const res = await post(validBody);
    expect(res.status).toBe(401);
    await expectNoDepositTookPlace(db);
  });

  it("answers 400 to a body that is not JSON", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post("{not json");
    expect(res.status).toBe(400);
    await expectNoDepositTookPlace(db);
  });

  it("answers 400 below the minimum, stating the configured bound", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, amountCents: MONEY_CONFIG.deposit.minCents - 1 });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toContain(MONEY_REFUSALS.depositBelowMinimum);
    await expectNoDepositTookPlace(db);
  });

  it("answers 400 above the per-transfer maximum", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, amountCents: MONEY_CONFIG.deposit.maxPerTransferCents + 1 });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toContain(MONEY_REFUSALS.depositAboveMaximum);
    await expectNoDepositTookPlace(db);
  });

  it("answers 400 to a body carrying keys the boundary does not know", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, surprise: true });
    expect(res.status).toBe(400);
    await expectNoDepositTookPlace(db);
  });

  it("refuses 403 through the state gate — the shipped enabled list is empty, so money is dark for everyone", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post(validBody);
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe(MONEY_REFUSALS.stateNotEnabled);
    await expectNoDepositTookPlace(db);
  });

  it("refuses 403 before KYC is verified, once a state is enabled", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1", { kycStatus: "none" });
    const res = await post(validBody);
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe(MONEY_REFUSALS.kycRequired);
    await expectNoDepositTookPlace(db);
  });

  it("initiates for a verified member in an enabled state: 200 with the typed pending transfer, and no ledger rows", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1");
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { ok: boolean; data: { transfer: { status: string; direction: string; amountCents: number } } };
    expect(payload.ok).toBe(true);
    expect(payload.data.transfer).toMatchObject({ status: "pending", direction: "deposit", amountCents: 50_00 });
    await expectNoPostingTookPlace(db); // the intent is stored; the BOOK stays empty until completion
  });

  it("answers 429 past the per-user ceiling, before the provider is ever reached", async () => {
    signedInAs("u1");
    await seedUser("u1");
    for (let i = 0; i < MONEY_CONFIG.deposit.rateLimit.maxRequests; i++) {
      expect((await post("{not json")).status).toBe(400);
    }
    expect((await post("{not json")).status).toBe(429);
  });
});
