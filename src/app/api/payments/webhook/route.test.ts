import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://commish:commish@localhost:5433/commish_test";
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
});

import { users } from "@/db/schema";
import { createTestDb, truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { initiateDeposit, type DepositDeps } from "@/money-service/deposits";
import { walletSummary } from "@/money-service/read";
import { expectNoPostingTookPlace, snapshotMoneyBook } from "@/money-service/test-support";
import { MONEY_STATES } from "@/money/states";
import { PAYMENTS_PROVIDER_CONFIG } from "@/payments-provider/config";
import type { TransferRef } from "@/payments-provider/contract";
import { signProviderCallback, type RawProviderCallback } from "@/payments-provider/ingest";
import { createMockPaymentsProvider, type MockPaymentsProvider } from "@/payments-provider/mock/mock-payments-provider";
import { POST } from "./route";

const db = createTestDb();

const clock: Clock = { now: () => "2026-09-01T00:00:00.000Z" };
let nextId = 0;

/** The tests' own mock rail: the route never touches a provider (it only consumes callbacks and
 *  the stored intents), so this instance seeds intents and mints WIRE-EXACT signed callbacks —
 *  the same dev signing secret `ingestProviderCallback` verifies against. */
let provider: MockPaymentsProvider;
let deps: DepositDeps;

/** POSTs a callback exactly as the wire would carry it; `signature: undefined` sends no header. */
function deliver(raw: RawProviderCallback) {
  const headers = new Headers({ "content-type": "application/json" });
  if (raw.signature !== undefined) headers.set(PAYMENTS_PROVIDER_CONFIG.webhookSignatureHeader, raw.signature);
  return POST(new Request("http://test/api/payments/webhook", { method: "POST", headers, body: raw.body }));
}

const signed = (payload: unknown): RawProviderCallback => {
  const body = typeof payload === "string" ? payload : JSON.stringify(payload);
  return { body, signature: signProviderCallback(body) };
};

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@test.local`, displayName: id, kycStatus: "verified" }).onConflictDoNothing();
}

/** Initiates a real (mock) deposit so the intent row exists, answering the transfer ref. */
async function pendingDeposit(userId: string, amountCents: number): Promise<TransferRef> {
  await seedUser(userId);
  const out = await initiateDeposit(
    db,
    { userId, amountCents, stateOfEntry: "TN", method: "bank", idempotencyKey: `form_${(nextId += 1)}` },
    deps,
  );
  if (!out.ok) throw new Error(`test initiation refused: ${out.reason}`);
  return out.transfer.ref;
}

/** The mock settles everything pending and hands back the queued signed callbacks. */
function settle(): RawProviderCallback[] {
  provider.advance();
  return [...provider.drainCallbacks()];
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  provider = createMockPaymentsProvider(clock);
  deps = {
    provider,
    audit: getAuditLogger(),
    clock,
    newId: () => `wh_${(nextId += 1)}`,
    states: { enabled: [{ state: "TN", minAge: 18 }], neverEligible: MONEY_STATES.neverEligible },
  };
});

describe("POST /api/payments/webhook — the signature wall", () => {
  it("answers 401 to a callback with no signature header, echoing nothing of the body", async () => {
    const res = await deliver({ body: JSON.stringify({ type: "deposit_completed", ref: "r1", amountCents: 50_00 }), signature: undefined });
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("r1");
    await expectNoPostingTookPlace(db);
  });

  it("answers 401 to a signature that does not verify", async () => {
    const res = await deliver({ body: JSON.stringify({ type: "deposit_completed", ref: "r1", amountCents: 50_00 }), signature: "deadbeef" });
    expect(res.status).toBe(401);
    await expectNoPostingTookPlace(db);
  });

  it("answers 400 to a verified but malformed payload", async () => {
    for (const raw of [signed("not json at all"), signed({ type: "deposit_completed" }), signed({ type: "gift", ref: "r", amountCents: 1 })]) {
      expect((await deliver(raw)).status).toBe(400);
    }
    await expectNoPostingTookPlace(db);
  });
});

describe("POST /api/payments/webhook — deposit fates", () => {
  it("posts a completed deposit into the book and answers 200", async () => {
    await pendingDeposit("u1", 50_00);
    const [callback] = settle();
    const res = await deliver(callback!);
    expect(res.status).toBe(200);
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 50_00, owedCents: 0 });
  });

  it("answers a redelivery 200 as the same non-event", async () => {
    await pendingDeposit("u1", 50_00);
    const [callback] = settle();
    expect((await deliver(callback!)).status).toBe(200);
    const before = await snapshotMoneyBook(db);
    expect((await deliver(callback!)).status).toBe(200);
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("claws back a returned deposit through the same wall, shortfall path included", async () => {
    const ref = await pendingDeposit("u1", 50_00);
    const [completion] = settle();
    expect((await deliver(completion!)).status).toBe(200);

    provider.triggerReturn(ref);
    const [returned] = provider.drainCallbacks();
    expect((await deliver(returned!)).status).toBe(200);
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 0, owedCents: 0 });
  });

  it("answers 503 to a return that outran its completion, so the provider redelivers it after", async () => {
    const ref = await pendingDeposit("u1", 50_00);
    const before = await snapshotMoneyBook(db);
    const res = await deliver(signed({ type: "deposit_returned", ref, amountCents: 50_00 }));
    expect(res.status).toBe(503);
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("acknowledges 200 and posts NOTHING for a transfer this product never initiated — the reconcile sweep's case, not a retry's", async () => {
    const res = await deliver(signed({ type: "deposit_completed", ref: "mock-transfer-999", amountCents: 50_00 }));
    expect(res.status).toBe(200);
    await expectNoPostingTookPlace(db);
  });

  it("acknowledges 200 and posts NOTHING when a verified callback disagrees with the stored intent — the alarm class the mock throws for at initiation", async () => {
    const ref = await pendingDeposit("u1", 50_00);
    const res = await deliver(signed({ type: "deposit_completed", ref, amountCents: 49_00 }));
    expect(res.status).toBe(200);
    await expectNoPostingTookPlace(db);
  });

  it("acknowledges 200 and posts nothing for withdrawal events until Task 6 wires their writers", async () => {
    const res = await deliver(signed({ type: "withdrawal_completed", ref: "mock-transfer-77", amountCents: 10_00 }));
    expect(res.status).toBe(200);
    await expectNoPostingTookPlace(db);
  });
});
