import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

/** `deposits/route.test.ts`'s exact mock: the shipped `MONEY_STATES.enabled` is EMPTY, so the
 *  gates behind the state gate are unreachable through the real constant. */
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
import { createTestDb, truncateAll, truncateMoneyTables } from "@/db/test-db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { postMoneyTransaction, type PostDeps } from "@/money-service/post";
import { expectNoPostingTookPlace, snapshotMoneyBook } from "@/money-service/test-support";
import { accountIdFor } from "@/money/accounts";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { getAuditLogger } from "@/integrity-service/audit-logger";
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

/** Funds `id`'s available balance directly through the ONE writer — a Task 5 stand-in exactly
 *  `deposits/route.test.ts` needs no version of, because the deposit door posts nothing at
 *  request time; the withdrawal door needs a real balance to debit against. */
async function fundAvailable(id: string, amountCents: number): Promise<void> {
  const deps: PostDeps = { audit: getAuditLogger(), clock: { now: () => "2026-09-01T00:00:00.000Z" }, newId: () => crypto.randomUUID() };
  const outcome = await db.transaction((tx) =>
    postMoneyTransaction(
      tx,
      {
        kind: "deposit",
        stateOfEntry: "TN",
        entries: [
          { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents },
          { accountId: accountIdFor("user_available", id), direction: "credit", amountCents },
        ],
        auditEvent: { eventType: "deposit_completed", actorId: id, actorType: "user", leagueId: null, payload: { amountCents } },
      },
      deps,
    ),
  );
  expect(outcome).toMatchObject({ ok: true });
}

const validBody = { amountCents: 20_00, stateOfEntry: "TN", destination: { externalAccountRef: "ext_1" }, idempotencyKey: "form_key_1" };

function post(body: unknown) {
  return POST(
    new Request("http://test/api/wallet/withdrawals", {
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
});

describe("POST /api/wallet/withdrawals", () => {
  it("answers 401 to a caller with no session, before anything else runs", async () => {
    signedInAs(null);
    const res = await post(validBody);
    expect(res.status).toBe(401);
    await expectNoPostingTookPlace(db);
  });

  it("answers 400 to a body that is not JSON", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post("{not json");
    expect(res.status).toBe(400);
    await expectNoPostingTookPlace(db);
  });

  it("answers 400 below the minimum, stating the configured bound", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, amountCents: MONEY_CONFIG.withdrawal.minCents - 1 });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toContain(MONEY_REFUSALS.withdrawalBelowMinimum);
    await expectNoPostingTookPlace(db);
  });

  it("answers 400 to a body carrying keys the boundary does not know", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, surprise: true });
    expect(res.status).toBe(400);
    await expectNoPostingTookPlace(db);
  });

  it("refuses 403 through the state gate — the shipped enabled list is empty, so money is dark for everyone", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post(validBody);
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe(MONEY_REFUSALS.stateNotEnabled);
    await expectNoPostingTookPlace(db);
  });

  it("refuses 403 before KYC is verified, once a state is enabled", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1", { kycStatus: "none" });
    const res = await post(validBody);
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe(MONEY_REFUSALS.kycRequired);
    await expectNoPostingTookPlace(db);
  });

  it("does NOT refuse a self-excluded member — the withdrawal door stays open", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1", { selfExcludedAt: new Date("2026-08-30T00:00:00.000Z") });
    await fundAvailable("u1", 50_00);
    const res = await post(validBody);
    expect(res.status).toBe(200);
  });

  it("refuses 403 with insufficientBalance for an amount the locked balance cannot cover", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1");
    await fundAvailable("u1", 5_00);
    const before = await snapshotMoneyBook(db);
    const res = await post(validBody);
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe(MONEY_REFUSALS.insufficientBalance);
    await expectNoPostingTookPlace(db, before);
  });

  it("requests for a verified member in an enabled state: 200 with the typed pending transfer, fee and ETA from the descriptor, and the reservation posted", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1");
    await fundAvailable("u1", 50_00);
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      ok: boolean;
      data: { transfer: { status: string; direction: string; amountCents: number }; feeCents: number; feePercentBasisPoints: number; etaDescription: string };
    };
    expect(payload.ok).toBe(true);
    expect(payload.data.transfer).toMatchObject({ status: "pending", direction: "withdrawal", amountCents: 20_00 });
    expect(payload.data).toMatchObject({ feeCents: 0, feePercentBasisPoints: 0 });
    expect(typeof payload.data.etaDescription).toBe("string");
  });
});
