import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

vi.mock("@/lib/auth/current-user", () => ({
  getCurrentUser: vi.fn(),
}));

/** Same swap `deposits/route.test.ts` uses: the shipped `MONEY_STATES.enabled` is EMPTY (money
 *  ships dark), so the gates behind it are unreachable through the real constant. */
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

import { eq } from "drizzle-orm";
import { users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { MOCK_KYC_CONFIG } from "@/payments-provider/mock/mock-kyc-provider";
import { resetKycRateLimit } from "../_shared";
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

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id });
}

const validBody = { legalName: "Verifying Member", dateOfBirth: "1990-01-01", stateOfEntry: "TN", idempotencyKey: "form_kyc_1" };

function post(body: unknown) {
  return POST(
    new Request("http://test/api/wallet/kyc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await truncateAll(db);
  vi.mocked(getCurrentUser).mockReset();
  stateHolder.enabled = [];
  resetKycRateLimit();
});

describe("POST /api/wallet/kyc", () => {
  it("answers 401 to a caller with no session", async () => {
    signedInAs(null);
    const res = await post(validBody);
    expect(res.status).toBe(401);
  });

  it("answers 400 to a body that is not JSON", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post("{not json");
    expect(res.status).toBe(400);
  });

  it("answers 400 for a malformed date of birth", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, dateOfBirth: "01/01/1990" });
    expect(res.status).toBe(400);
  });

  it("answers 400 to a body carrying keys the boundary does not know", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, surprise: true });
    expect(res.status).toBe(400);
  });

  it("refuses 403 through the state gate — the shipped enabled list is empty, so KYC has no minAge to submit against", async () => {
    signedInAs("u1");
    await seedUser("u1");
    const res = await post(validBody);
    expect(res.status).toBe(403);
    const payload = (await res.json()) as { error: string };
    expect(payload.error).toBe(MONEY_REFUSALS.stateNotEnabled);
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("none");
  });

  it("submits once a state is enabled: 200 with pending, and the row written", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1");
    const res = await post(validBody);
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { ok: boolean; data: { status: string } };
    expect(payload.ok).toBe(true);
    expect(payload.data.status).toBe("pending");
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("pending");
  });

  it("writes failed for the mock's fixed failing identity, 200 not an error", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, legalName: MOCK_KYC_CONFIG.failingLegalName, idempotencyKey: "form_kyc_failing" });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { status: string } };
    expect(payload.data.status).toBe("failed");
  });

  it("writes failed for an identity below the enabled state's minAge", async () => {
    stateHolder.enabled = [{ state: "TN", minAge: 18 }];
    signedInAs("u1");
    await seedUser("u1");
    const res = await post({ ...validBody, dateOfBirth: "2020-01-01", idempotencyKey: "form_kyc_underage" });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as { data: { status: string } };
    expect(payload.data.status).toBe("failed");
  });

  it("answers 429 past the per-user ceiling, before the provider is ever reached", async () => {
    signedInAs("u1");
    await seedUser("u1");
    for (let i = 0; i < MONEY_CONFIG.kyc.rateLimit.maxRequests; i++) {
      expect((await post("{not json")).status).toBe(400);
    }
    expect((await post("{not json")).status).toBe(429);
  });
});
