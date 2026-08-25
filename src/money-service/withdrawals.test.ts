import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, moneyTransactions, paymentTransferIntents, users } from "@/db/schema";
import { createTestDb, truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { MONEY_REFUSALS } from "@/money/config";
import { MONEY_STATES, type MoneyStatesConfig, type StateCode } from "@/money/states";
import type { TransferRef } from "@/payments-provider/contract";
import { ingestProviderCallback, type PaymentsEvent } from "@/payments-provider/ingest";
import { createMockPaymentsProvider, type MockPaymentsProvider } from "@/payments-provider/mock/mock-payments-provider";
import { initiateDeposit, recordDepositCompleted, type DepositDeps } from "./deposits";
import type { PostDeps } from "./post";
import { walletSummary } from "./read";
import {
  WITHDRAWAL_ALARMS,
  initiateWithdrawal,
  recordWithdrawalCompleted,
  recordWithdrawalFailed,
  recordWithdrawalReturned,
  type WithdrawalDeps,
} from "./withdrawals";
import { expectNoPostingTookPlace, snapshotMoneyBook } from "./test-support";

const db = createTestDb();

const clock: Clock = { now: () => "2026-09-01T00:00:00.000Z" };
let nextId = 0;
const newId = () => `wd_${(nextId += 1)}`;

const enabledTN: MoneyStatesConfig = {
  enabled: [{ state: "TN", minAge: 18 }],
  neverEligible: MONEY_STATES.neverEligible,
};

let provider: MockPaymentsProvider;
let deps: WithdrawalDeps;
const postDeps = (): PostDeps => ({ audit: deps.audit, clock: deps.clock, newId: deps.newId });

async function seedUser(id: string, overrides: Partial<typeof users.$inferInsert> = {}): Promise<void> {
  await db
    .insert(users)
    .values({ id, email: `${id}@test.local`, displayName: id, kycStatus: "verified", ...overrides })
    .onConflictDoNothing();
}

const withdrawalInput = (userId: string, amountCents: number, stateOfEntry: StateCode = "TN") => ({
  userId,
  amountCents,
  stateOfEntry,
  destination: { externalAccountRef: `ext_${userId}` },
  idempotencyKey: `form_${userId}_${amountCents}_${(nextId += 1)}`,
});

/** Funds `userId` to `amountCents` through the real deposit pipeline, so a withdrawal test has a
 *  real available balance to move against — a Task 5 stand-in, exactly `deposits.test.ts`'s own
 *  `verifiedDeposit` shape applied here. */
async function fundAvailable(userId: string, amountCents: number): Promise<void> {
  await seedUser(userId);
  const depositDeps: DepositDeps = { ...deps };
  const initiated = await initiateDeposit(db, { userId, amountCents, stateOfEntry: "TN", method: "bank", idempotencyKey: `fund_${(nextId += 1)}` }, depositDeps);
  if (!initiated.ok) throw new Error(`test funding refused: ${initiated.reason}`);
  provider.advance();
  const [callback] = provider.drainCallbacks();
  const outcome = ingestProviderCallback(callback!);
  if (!outcome.ok) throw new Error(`test funding: callback failed ingestion: ${outcome.reason}`);
  const completed = await recordDepositCompleted(db, outcome.event, postDeps());
  expect(completed).toMatchObject({ ok: true, replayed: false });
}

/** Drains the mock's queued callbacks through the REAL ingestion point. */
function drainEvents(): PaymentsEvent[] {
  return provider.drainCallbacks().map((raw) => {
    const outcome = ingestProviderCallback(raw);
    if (!outcome.ok) throw new Error(`test drain: the mock's own callback failed ingestion: ${outcome.reason}`);
    return outcome.event;
  });
}

/** The full happy pipeline: request, settle at the (mock) bank, ingest, post — answering the ref. */
async function verifiedWithdrawal(userId: string, amountCents: number): Promise<TransferRef> {
  const initiated = await initiateWithdrawal(db, withdrawalInput(userId, amountCents), deps);
  if (!initiated.ok) throw new Error(`test withdrawal refused: ${initiated.reason}`);
  provider.advance();
  const events = drainEvents();
  expect(events).toHaveLength(1);
  const completed = await recordWithdrawalCompleted(db, events[0]!, postDeps());
  expect(completed).toMatchObject({ ok: true, replayed: false });
  return initiated.transfer.ref;
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  provider = createMockPaymentsProvider(clock);
  deps = { provider, audit: getAuditLogger(), clock, newId, states: enabledTN };
});

describe("initiateWithdrawal's gates", () => {
  it("refuses a withdrawal from a user in no enabled state, which today is every user", async () => {
    await seedUser("u1");
    const out = await initiateWithdrawal(db, withdrawalInput("u1", 50_00), { ...deps, states: MONEY_STATES });
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled });
    await expectNoPostingTookPlace(db);
  });

  it("refuses a withdrawal before KYC is verified", async () => {
    await seedUser("u1", { kycStatus: "none" });
    const out = await initiateWithdrawal(db, withdrawalInput("u1", 50_00), deps);
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.kycRequired });
    await expectNoPostingTookPlace(db);
  });

  it("does NOT refuse a self-excluded member — exclusion closes the doors money enters, never the door it leaves", async () => {
    await fundAvailable("u1", 50_00);
    await seedUser("u1", { selfExcludedAt: new Date("2026-08-30T00:00:00.000Z") });
    const out = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    expect(out).toMatchObject({ ok: true, transfer: { status: "pending" } });
  });

  it("throws for a user id with no row behind it — a caller bug, not a refusal", async () => {
    await expect(initiateWithdrawal(db, withdrawalInput("u_ghost", 50_00), deps)).rejects.toThrow(/no user row/);
  });

  it("throws when the provider offers no bank method — a provider-implementation bug, not a refusal", async () => {
    await fundAvailable("u1", 50_00);
    const noBankProvider = { ...provider, listSupportedMethods: () => [] };
    await expect(initiateWithdrawal(db, withdrawalInput("u1", 20_00), { ...deps, provider: noBankProvider })).rejects.toThrow(/does not support the bank method/);
  });
});

describe("initiateWithdrawal's request-time reservation — the debit-at-request law", () => {
  it("debits user_available and credits provider_clearing immediately, audited withdrawal_requested", async () => {
    await fundAvailable("u1", 50_00);
    const out = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    expect(out).toMatchObject({ ok: true, transfer: { status: "pending", direction: "withdrawal", amountCents: 20_00 }, feeCents: 0 });

    const withdrawalIntents = await db.select().from(paymentTransferIntents).where(eq(paymentTransferIntents.direction, "withdrawal"));
    expect(withdrawalIntents).toHaveLength(1);
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 30_00 });

    const audited = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "withdrawal_requested"));
    expect(audited).toHaveLength(1);
    expect(audited[0]!.payload).toMatchObject({ amountCents: 20_00 });
  });

  it("refuses with insufficientBalance for an amount the LOCKED balance cannot cover, posting nothing", async () => {
    await fundAvailable("u1", 10_00);
    const before = await snapshotMoneyBook(db);
    const out = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.insufficientBalance });
    await expectNoPostingTookPlace(db, before);
    expect(await db.select().from(paymentTransferIntents).where(eq(paymentTransferIntents.direction, "withdrawal"))).toHaveLength(0);
  });

  it("reverses the reservation synchronously when the provider declines at initiation", async () => {
    await fundAvailable("u1", 50_00);
    provider.failNextInitiation("The bank rejected the linked account.");
    const out = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    expect(out).toMatchObject({ ok: true, transfer: { status: "failed", failureReason: "The bank rejected the linked account." } });

    // Net zero: the reservation posted, then the decline reversed it — no callback will ever
    // reference this ref, so no intent is stored.
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 50_00 });
    expect(await db.select().from(paymentTransferIntents).where(eq(paymentTransferIntents.direction, "withdrawal"))).toHaveLength(0);
    const audited = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "withdrawal_returned"));
    expect(audited).toHaveLength(1);
    expect(audited[0]!.payload).toMatchObject({ outcome: "failed", amountCents: 20_00 });
  });

  it("resolves a double-submitted form to the SAME transfer without a second debit", async () => {
    await fundAvailable("u1", 50_00);
    const input = withdrawalInput("u1", 20_00);
    const first = await initiateWithdrawal(db, input, deps);
    const second = await initiateWithdrawal(db, input, deps);
    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 30_00 });
    expect(await db.select().from(paymentTransferIntents).where(eq(paymentTransferIntents.direction, "withdrawal"))).toHaveLength(1);
  });
});

describe("recordWithdrawalCompleted", () => {
  it("posts the completion: clearing resolves, the pool shrinks, audited withdrawal_completed", async () => {
    await fundAvailable("u1", 50_00);
    const ref = await verifiedWithdrawal("u1", 20_00);
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 30_00 });

    const [txn] = await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "withdrawal_complete"));
    expect(txn).toMatchObject({ providerTransferRef: ref, idempotencyKey: `withdrawal_completed:${ref}` });
    const audited = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "withdrawal_completed"));
    expect(audited).toHaveLength(1);
    expect(audited[0]!.payload).toMatchObject({ amountCents: 20_00, providerTransferRef: ref });
  });

  it("treats a webhook redelivery as the same non-event", async () => {
    await fundAvailable("u1", 50_00);
    const initiated = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    if (!initiated.ok) throw new Error("unreachable");
    provider.advance();
    const [event] = drainEvents();
    expect(await recordWithdrawalCompleted(db, event!, postDeps())).toEqual({ ok: true, replayed: false });

    const before = await snapshotMoneyBook(db);
    expect(await recordWithdrawalCompleted(db, event!, postDeps())).toEqual({ ok: true, replayed: true });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("alarms on a transfer this product never initiated, posting nothing", async () => {
    const out = await recordWithdrawalCompleted(db, { type: "withdrawal_completed", ref: "mock-transfer-999", amountCents: 50_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: WITHDRAWAL_ALARMS.unknownTransferRef });
    await expectNoPostingTookPlace(db);
  });

  it("alarms on an amount that disagrees with the stored intent, posting nothing", async () => {
    await fundAvailable("u1", 50_00);
    const initiated = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    if (!initiated.ok) throw new Error("unreachable");
    const before = await snapshotMoneyBook(db);
    const out = await recordWithdrawalCompleted(db, { type: "withdrawal_completed", ref: initiated.transfer.ref, amountCents: 19_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: WITHDRAWAL_ALARMS.transferDisagreement });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("throws on the wrong event type", async () => {
    await expect(recordWithdrawalCompleted(db, { type: "withdrawal_returned", ref: "r", amountCents: 1 }, postDeps())).rejects.toThrow(/wrong event type/);
  });
});

describe("recordWithdrawalFailed — the credit leg bouncing before it settles", () => {
  it("reverses the reservation back to user_available, audited withdrawal_returned with outcome failed", async () => {
    await fundAvailable("u1", 50_00);
    const initiated = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    if (!initiated.ok) throw new Error("unreachable");
    provider.failPendingWithdrawal(initiated.transfer.ref, "Account closed.");
    const [event] = drainEvents();

    const out = await recordWithdrawalFailed(db, event!, postDeps());
    expect(out).toEqual({ ok: true, replayed: false });
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 50_00 });

    const audited = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "withdrawal_returned"));
    expect(audited).toHaveLength(1);
    expect(audited[0]!.payload).toMatchObject({ outcome: "failed", amountCents: 20_00 });
  });

  it("treats a redelivered failure as the same non-event", async () => {
    await fundAvailable("u1", 50_00);
    const initiated = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    if (!initiated.ok) throw new Error("unreachable");
    provider.failPendingWithdrawal(initiated.transfer.ref, "Account closed.");
    const [event] = drainEvents();
    expect(await recordWithdrawalFailed(db, event!, postDeps())).toMatchObject({ ok: true, replayed: false });

    const before = await snapshotMoneyBook(db);
    expect(await recordWithdrawalFailed(db, event!, postDeps())).toEqual({ ok: true, replayed: true });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("alarms on a failure arriving after the withdrawal already completed", async () => {
    await fundAvailable("u1", 50_00);
    const ref = await verifiedWithdrawal("u1", 20_00);
    const before = await snapshotMoneyBook(db);
    const out = await recordWithdrawalFailed(db, { type: "withdrawal_failed", ref, amountCents: 20_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: WITHDRAWAL_ALARMS.failureAfterCompletion });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("alarms on a transfer this product never initiated, posting nothing", async () => {
    const out = await recordWithdrawalFailed(db, { type: "withdrawal_failed", ref: "mock-transfer-404", amountCents: 10_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: WITHDRAWAL_ALARMS.unknownTransferRef });
    await expectNoPostingTookPlace(db);
  });

  it("throws on the wrong event type", async () => {
    await expect(recordWithdrawalFailed(db, { type: "withdrawal_completed", ref: "r", amountCents: 1 }, postDeps())).rejects.toThrow(/wrong event type/);
  });
});

describe("recordWithdrawalReturned — the withdrawal that comes back", () => {
  it("refunds the returned withdrawal to user_available in full, no shortfall, audited outcome returned", async () => {
    await fundAvailable("u1", 50_00);
    const ref = await verifiedWithdrawal("u1", 20_00);
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 30_00 });

    provider.triggerReturn(ref);
    const [event] = drainEvents();
    const out = await recordWithdrawalReturned(db, event!, postDeps());
    expect(out).toEqual({ ok: true, replayed: false });
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 50_00, owedCents: 0 });

    const audited = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "withdrawal_returned"));
    expect(audited).toHaveLength(1);
    expect(audited[0]!.payload).toMatchObject({ outcome: "returned", amountCents: 20_00 });
  });

  it("treats a redelivered return as the same non-event", async () => {
    await fundAvailable("u1", 50_00);
    const ref = await verifiedWithdrawal("u1", 20_00);
    provider.triggerReturn(ref);
    const [event] = drainEvents();
    expect(await recordWithdrawalReturned(db, event!, postDeps())).toMatchObject({ ok: true, replayed: false });

    const before = await snapshotMoneyBook(db);
    expect(await recordWithdrawalReturned(db, event!, postDeps())).toEqual({ ok: true, replayed: true });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("alarms on a return whose completion has not posted yet — the one alarm redelivery heals", async () => {
    await fundAvailable("u1", 50_00);
    const initiated = await initiateWithdrawal(db, withdrawalInput("u1", 20_00), deps);
    if (!initiated.ok) throw new Error("unreachable");
    const before = await snapshotMoneyBook(db);
    const out = await recordWithdrawalReturned(db, { type: "withdrawal_returned", ref: initiated.transfer.ref, amountCents: 20_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: WITHDRAWAL_ALARMS.returnBeforeCompletion });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("alarms on a transfer this product never initiated, posting nothing", async () => {
    const out = await recordWithdrawalReturned(db, { type: "withdrawal_returned", ref: "mock-transfer-404", amountCents: 10_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: WITHDRAWAL_ALARMS.unknownTransferRef });
    await expectNoPostingTookPlace(db);
  });

  it("throws on the wrong event type", async () => {
    await expect(recordWithdrawalReturned(db, { type: "withdrawal_completed", ref: "r", amountCents: 1 }, postDeps())).rejects.toThrow(/wrong event type/);
  });
});
