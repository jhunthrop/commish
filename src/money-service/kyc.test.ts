import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditEvents, users } from "@/db/schema";
import { createTestDb, truncateAll } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { createAuditLogger } from "@/integrity-service/audit-logger";
import { MONEY_REFUSALS } from "@/money/config";
import { MONEY_STATES, type MoneyStatesConfig } from "@/money/states";
import { createMockKycProvider, MOCK_KYC_CONFIG } from "@/payments-provider/mock/mock-kyc-provider";
import { submitKycVerification, type SubmitKycDeps } from "./kyc";

const db = createTestDb();
const clock: Clock = { now: () => "2026-09-01T00:00:00.000Z" };

let eventCounter = 0;
const logger = createAuditLogger({ newId: () => `evt_${(eventCounter += 1)}` });

const enabledTN: MoneyStatesConfig = {
  enabled: [{ state: "TN", minAge: 18 }],
  neverEligible: MONEY_STATES.neverEligible,
};

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id });
}

function deps(): SubmitKycDeps {
  return { provider: createMockKycProvider(clock), states: enabledTN, clock, audit: logger };
}

const REQUEST = {
  legalName: "Verifying Member",
  dateOfBirth: "1990-01-01",
  stateOfEntry: "TN" as const,
  idempotencyKey: "kyc-test-1",
};

async function kycAuditEvents(): Promise<readonly { readonly payload: unknown; readonly actorId: string | null }[]> {
  return db.select({ payload: auditEvents.payload, actorId: auditEvents.actorId }).from(auditEvents).where(eq(auditEvents.eventType, "kyc_status_changed"));
}

beforeEach(async () => {
  await truncateAll(db);
  eventCounter = 0;
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
    expect(await kycAuditEvents()).toEqual([]);
  });

  it("writes pending for an identity the provider has not yet settled, and audits kyc_status_changed", async () => {
    await seedUser("u1");
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST }, deps());
    expect(out).toEqual({ ok: true, status: "pending" });
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("pending");
    const events = await kycAuditEvents();
    expect(events).toEqual([{ payload: { status: "pending" }, actorId: "u1" }]);
  });

  it("writes failed for the mock's fixed failing identity, and audits it", async () => {
    await seedUser("u1");
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST, legalName: MOCK_KYC_CONFIG.failingLegalName }, deps());
    expect(out).toEqual({ ok: true, status: "failed" });
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("failed");
    expect(await kycAuditEvents()).toEqual([{ payload: { status: "failed" }, actorId: "u1" }]);
  });

  it("writes failed for an identity below the submitted state's minAge", async () => {
    await seedUser("u1");
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST, dateOfBirth: "2020-01-01" }, deps());
    expect(out).toEqual({ ok: true, status: "failed" });
  });

  it("carries verified forward once the provider reports it, after the harness settles the submission", async () => {
    await seedUser("u1");
    const provider = createMockKycProvider(clock);
    const d: SubmitKycDeps = { provider, states: enabledTN, clock, audit: logger };
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
    expect(await kycAuditEvents()).toEqual([{ payload: { status: "verified" }, actorId: "u1" }]);
  });

  it("audits nothing for a resubmission that lands on the SAME status the row already carries", async () => {
    await seedUser("u1");
    // First submission settles to "pending" (a generic identity, never advanced).
    await submitKycVerification(db, { userId: "u1", ...REQUEST }, deps());
    expect(await kycAuditEvents()).toHaveLength(1);

    // A second, independent submission (fresh idempotency key -> a different provider ref) that
    // ALSO resolves to "pending": the guarded write is a no-op (ne(kycStatus, status) fails), so
    // no second audit event, even though a real provider round trip happened.
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST, idempotencyKey: "kyc-test-1-again" }, deps());
    expect(out).toEqual({ ok: true, status: "pending" });
    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("pending");
    expect(await kycAuditEvents()).toHaveLength(1);
  });

  /**
   * The review HIGH's own race shape: a member becomes `verified` (by any path — a faster
   * concurrent submission, in this test simulated directly), and a LATER, independent submission
   * from the same member — already past the provider round trip, unaware the row changed under
   * it — resolves to something other than `verified` and lands after. The guarded `UPDATE`'s WHERE
   * clause is what refuses it: the write matches zero rows (provable by its own `returning()`
   * count, exercised here through the outcome it produces), the row is never downgraded, and
   * nothing is audited for a write that did not happen.
   */
  it("never downgrades an already-verified member — a later submission landing after a verify is refused by the guarded write, not audited", async () => {
    await seedUser("u1");
    // Some other path already verified this member (a faster concurrent submission, or a future
    // operator path) — simulated directly, since this test is about the WRITE guard, not about
    // how "verified" was reached.
    await db.update(users).set({ kycStatus: "verified" }).where(eq(users.id, "u1"));

    // A late-arriving submission that resolves to "failed" this time (the fixed failing fixture)
    // — must not touch the row.
    const out = await submitKycVerification(db, { userId: "u1", ...REQUEST, legalName: MOCK_KYC_CONFIG.failingLegalName }, deps());
    expect(out).toEqual({ ok: true, status: "verified" });

    const [row] = await db.select({ kycStatus: users.kycStatus }).from(users).where(eq(users.id, "u1"));
    expect(row?.kycStatus).toBe("verified");
    expect(await kycAuditEvents()).toEqual([]);
  });

  it("namespaces the idempotency key per user before it reaches the provider", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const provider = createMockKycProvider(clock);
    const d: SubmitKycDeps = { provider, states: enabledTN, clock, audit: logger };

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
