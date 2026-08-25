import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { MONEY_REFUSALS } from "@/money/config";
import { MONEY_STATES, type MoneyStatesConfig } from "@/money/states";
import { createMockKycProvider, MOCK_KYC_CONFIG } from "@/payments-provider/mock/mock-kyc-provider";
import { submitKycVerification, type SubmitKycDeps } from "./kyc";

const db = createTestDb();
const clock: Clock = { now: () => "2026-09-01T00:00:00.000Z" };

const enabledTN: MoneyStatesConfig = {
  enabled: [{ state: "TN", minAge: 18 }],
  neverEligible: MONEY_STATES.neverEligible,
};

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id });
}

function deps(): SubmitKycDeps {
  return { provider: createMockKycProvider(clock), states: enabledTN };
}

const REQUEST = {
  legalName: "Verifying Member",
  dateOfBirth: "1990-01-01",
  stateOfEntry: "TN" as const,
  idempotencyKey: "kyc-test-1",
};

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await truncateAll(db);
});

describe("submitKycVerification", () => {
  it("refuses with stateNotEnabled when the submitted state has no MONEY_STATES entry, touching the provider not at all", async () => {
    await seedUser("u1");
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST, stateOfEntry: "NJ" }, deps());
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled });
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("none");
  });

  it("writes pending for an identity the provider has not yet settled", async () => {
    await seedUser("u1");
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST }, deps());
    expect(out).toEqual({ ok: true, status: "pending" });
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("pending");
  });

  it("writes failed for the mock's fixed failing identity", async () => {
    await seedUser("u1");
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST, legalName: MOCK_KYC_CONFIG.failingLegalName }, deps());
    expect(out).toEqual({ ok: true, status: "failed" });
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("failed");
  });

  it("writes failed for an identity below the submitted state's minAge", async () => {
    await seedUser("u1");
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST, dateOfBirth: "2020-01-01" }, deps());
    expect(out).toEqual({ ok: true, status: "failed" });
  });

  it("carries verified forward once the provider reports it, after the harness settles the submission", async () => {
    await seedUser("u1");
    const provider = createMockKycProvider(clock);
    const d: SubmitKycDeps = { provider, states: enabledTN };
    const ref = await provider.submitVerification({
      userId: "u1",
      legalName: REQUEST.legalName,
      dateOfBirth: REQUEST.dateOfBirth,
      minAge: 18,
      idempotencyKey: `kyc:u1:${REQUEST.idempotencyKey}`,
    });
    provider.advance();
    await expect(provider.getStatus(ref)).resolves.toBe("verified");

    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST }, d);
    expect(out).toEqual({ ok: true, status: "verified" });
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("verified");
  });

  it("is one way toward verified: a second submission from an already-verified member never re-touches the provider or the row", async () => {
    await seedUser("u1");
    await db.update(users).set({ kycStatus: "verified" }).where(eq(users.id, "u1"));

    let submitCalls = 0;
    const provider = createMockKycProvider(clock);
    const spyingProvider: typeof provider = {
      ...provider,
      submitVerification: async (input) => {
        submitCalls += 1;
        return provider.submitVerification(input);
      },
    };

    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST }, { provider: spyingProvider, states: enabledTN });
    expect(out).toEqual({ ok: true, status: "verified" });
    expect(submitCalls).toBe(0);
  });

  it("namespaces the idempotency key per user before it reaches the provider", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const provider = createMockKycProvider(clock);
    const d: SubmitKycDeps = { provider, states: enabledTN };

    await submitKycVerification(db, { userId: "u1", ...REQUEST }, d);
    // Same raw idempotencyKey, different user: must not collide into the same submission.
    const out = await submitKycVerification(db, { userId: "u2", ...REQUEST, legalName: MOCK_KYC_CONFIG.failingLegalName }, d);
    expect(out).toEqual({ ok: true, status: "failed" });
    const [row1] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row1?.kycStatus).toBe("pending");
  });

  it("throws for a userId with no row — the caller's bug to fix, not a refusal to answer", async () => {
    await expect(submitKycVerification(db, { userId: "u_never_seen", ...REQUEST }, deps())).rejects.toThrow(
      'submitKycVerification: no user row for "u_never_seen".',
    );
  });
});
