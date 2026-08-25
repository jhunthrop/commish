import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { auditEvents, moneyTransactions, paymentTransferIntents, users } from "@/db/schema";
import { createTestDb, truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { accountIdFor } from "@/money/accounts";
import { MONEY_REFUSALS } from "@/money/config";
import { MONEY_STATES, type MoneyStatesConfig, type StateCode } from "@/money/states";
import type { TransferRef } from "@/payments-provider/contract";
import { ingestProviderCallback, type PaymentsEvent } from "@/payments-provider/ingest";
import { createMockPaymentsProvider, MOCK_PAYMENTS_CONFIG, type MockPaymentsProvider } from "@/payments-provider/mock/mock-payments-provider";
import {
  DEPOSIT_ALARMS,
  initiateDeposit,
  recordDepositCompleted,
  recordDepositReturned,
  type DepositDeps,
} from "./deposits";
import { postMoneyTransaction, type PostDeps } from "./post";
import { walletSummary } from "./read";
import { expectNoDepositTookPlace, expectNoPostingTookPlace, snapshotDepositBook, snapshotMoneyBook } from "./test-support";

const db = createTestDb();

const clock: Clock = { now: () => "2026-09-01T00:00:00.000Z" };
let nextId = 0;
const newId = () => `dep_${(nextId += 1)}`;

/** The test-only enabled entry — the shipped `MONEY_STATES.enabled` stays empty everywhere. */
const enabledTN: MoneyStatesConfig = {
  enabled: [{ state: "TN", minAge: 18 }],
  neverEligible: MONEY_STATES.neverEligible,
};

let provider: MockPaymentsProvider;
let deps: DepositDeps;
const postDeps = (): PostDeps => ({ audit: deps.audit, clock: deps.clock, newId: deps.newId });

async function seedUser(id: string, overrides: Partial<typeof users.$inferInsert> = {}): Promise<void> {
  await db
    .insert(users)
    .values({ id, email: `${id}@test.local`, displayName: id, kycStatus: "verified", ...overrides })
    .onConflictDoNothing();
}

const depositInput = (userId: string, amountCents: number, stateOfEntry: StateCode = "TN") => ({
  userId,
  amountCents,
  stateOfEntry,
  method: "bank" as const,
  idempotencyKey: `form_${userId}_${amountCents}_${(nextId += 1)}`,
});

/** Drains the mock's queued callbacks through the REAL ingestion point — the exact wire shape
 *  the webhook route consumes — and returns the typed events. */
function drainEvents(): PaymentsEvent[] {
  return provider.drainCallbacks().map((raw) => {
    const outcome = ingestProviderCallback(raw);
    if (!outcome.ok) throw new Error(`test drain: the mock's own callback failed ingestion: ${outcome.reason}`);
    return outcome.event;
  });
}

/** The full happy pipeline: initiate, settle at the (mock) bank, ingest, post — answering the
 *  transfer ref so a test can later return it. */
async function verifiedDeposit(userId: string, amountCents: number, stateOfEntry: StateCode = "TN"): Promise<TransferRef> {
  await seedUser(userId);
  const initiated = await initiateDeposit(db, depositInput(userId, amountCents, stateOfEntry), deps);
  if (!initiated.ok) throw new Error(`test deposit refused: ${initiated.reason}`);
  provider.advance();
  const events = drainEvents();
  expect(events).toHaveLength(1);
  const completed = await recordDepositCompleted(db, events[0]!, postDeps());
  expect(completed).toMatchObject({ ok: true, replayed: false });
  return initiated.transfer.ref;
}

/** The bank takes a completed transfer back (R01/R10) and the product ingests the callback. */
async function returnDeposit(ref: TransferRef) {
  provider.triggerReturn(ref);
  const events = drainEvents();
  expect(events).toHaveLength(1);
  return recordDepositReturned(db, events[0]!, postDeps());
}

/** A Task 8 stand-in: the member spends through the ONE writer, exactly as the fee door will. */
async function spendOnEntryFee(userId: string, leagueId: string, amountCents: number): Promise<void> {
  const outcome = await db.transaction((tx) =>
    postMoneyTransaction(
      tx,
      {
        kind: "entry_fee",
        leagueId,
        stateOfEntry: "TN",
        entries: [
          { accountId: accountIdFor("user_available", userId), direction: "debit", amountCents },
          { accountId: accountIdFor("league_escrow", leagueId), direction: "credit", amountCents },
        ],
        auditEvent: { eventType: "entry_fee_collected", actorId: userId, actorType: "user", leagueId, payload: { amountCents } },
      },
      postDeps(),
    ),
  );
  expect(outcome).toMatchObject({ ok: true });
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  provider = createMockPaymentsProvider(clock);
  deps = { provider, audit: getAuditLogger(), clock, newId, states: enabledTN };
});

describe("initiateDeposit's gates", () => {
  it("refuses a deposit from a user in no enabled state, which today is every user", async () => {
    await seedUser("u1");
    const out = await initiateDeposit(db, depositInput("u1", 50_00), { ...deps, states: MONEY_STATES });
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.stateNotEnabled });
    await expectNoDepositTookPlace(db);
  });

  it("refuses a deposit before KYC is verified, and says why in plain words", async () => {
    await seedUser("u1", { kycStatus: "none" });
    const out = await initiateDeposit(db, depositInput("u1", 50_00), deps);
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.kycRequired });
    await expectNoDepositTookPlace(db);
  });

  it("refuses a self-excluded member", async () => {
    await seedUser("u1", { selfExcludedAt: new Date("2026-08-30T00:00:00.000Z") });
    const out = await initiateDeposit(db, depositInput("u1", 50_00), deps);
    expect(out).toEqual({ ok: false, status: 403, reason: MONEY_REFUSALS.selfExcluded });
    await expectNoDepositTookPlace(db);
  });

  it("initiates WHILE owed — the deposit door is how a receivable ever settles", async () => {
    const ref = await verifiedDeposit("u1", 50_00);
    await spendOnEntryFee("u1", "lg1", 30_00);
    await returnDeposit(ref);
    const out = await initiateDeposit(db, depositInput("u1", 20_00), deps);
    expect(out).toMatchObject({ ok: true, transfer: { status: "pending" } });
  });

  it("throws for a user id with no row behind it — a caller bug, not a refusal", async () => {
    await expect(initiateDeposit(db, depositInput("u_ghost", 50_00), deps)).rejects.toThrow(/no user row/);
  });
});

describe("initiateDeposit's intent, and the law that pending money is the bank's", () => {
  it("stores the intent and posts NOTHING until the completion event", async () => {
    await seedUser("u1");
    const out = await initiateDeposit(db, depositInput("u1", 50_00), deps);
    expect(out).toMatchObject({ ok: true, transfer: { status: "pending", direction: "deposit", amountCents: 50_00 } });
    await expectNoPostingTookPlace(db);

    const intents = await db.select().from(paymentTransferIntents);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      providerTransferRef: (out as { transfer: { ref: string } }).transfer.ref,
      direction: "deposit",
      userId: "u1",
      amountCents: 50_00,
      method: "bank",
      stateOfEntry: "TN",
    });
  });

  it("answers a decline as typed data, and stores no intent for a transfer no callback will ever name", async () => {
    await seedUser("u1");
    const out = await initiateDeposit(db, depositInput("u1", MOCK_PAYMENTS_CONFIG.declineAmountCents), deps);
    expect(out).toMatchObject({
      ok: true,
      transfer: { status: "failed", failureReason: MOCK_PAYMENTS_CONFIG.declineReason },
    });
    await expectNoDepositTookPlace(db);
  });

  it("resolves a double-submitted form to the SAME transfer and one intent row", async () => {
    await seedUser("u1");
    const input = depositInput("u1", 50_00);
    const first = await initiateDeposit(db, input, deps);
    const second = await initiateDeposit(db, input, deps);
    expect(first).toMatchObject({ ok: true });
    expect(second).toEqual(first);
    expect(await db.select().from(paymentTransferIntents)).toHaveLength(1);
  });

  it("namespaces the provider key per user, so two users sharing a form key cannot collide", async () => {
    await seedUser("u1");
    await seedUser("u2");
    const shared = { amountCents: 50_00, stateOfEntry: "TN" as const, method: "bank" as const, idempotencyKey: "same_key" };
    const first = await initiateDeposit(db, { userId: "u1", ...shared }, deps);
    const second = await initiateDeposit(db, { userId: "u2", ...shared }, deps);
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    expect(await db.select().from(paymentTransferIntents)).toHaveLength(2);
  });
});

describe("recordDepositCompleted", () => {
  it("posts the deposit on completion: pool grows, the member's balance grows, audited deposit_completed", async () => {
    const ref = await verifiedDeposit("u1", 50_00);
    const wallet = await walletSummary(db, "u1");
    expect(wallet).toEqual({ availableCents: 50_00, escrowCents: 0, heldCents: 0, owedCents: 0 });

    const [txn] = await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "deposit"));
    expect(txn).toMatchObject({ providerTransferRef: ref, idempotencyKey: `deposit_completed:${ref}` });
    const audited = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "deposit_completed"));
    expect(audited).toHaveLength(1);
    expect(audited[0]!.payload).toMatchObject({ amountCents: 50_00, providerTransferRef: ref });
  });

  it("treats a webhook redelivery as the same non-event", async () => {
    await seedUser("u1");
    const initiated = await initiateDeposit(db, depositInput("u1", 50_00), deps);
    if (!initiated.ok) throw new Error("unreachable");
    provider.advance();
    const [event] = drainEvents();
    expect(await recordDepositCompleted(db, event!, postDeps())).toEqual({ ok: true, replayed: false, settledOwedCents: 0 });

    const before = await snapshotMoneyBook(db);
    expect(await recordDepositCompleted(db, event!, postDeps())).toEqual({ ok: true, replayed: true, settledOwedCents: 0 });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("settles the receivable first on a later deposit, remainder to the member — across two deposits", async () => {
    const ref = await verifiedDeposit("u1", 50_00);
    await spendOnEntryFee("u1", "lg1", 30_00);
    await returnDeposit(ref);
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 0, owedCents: 30_00 });

    // A $20 deposit is consumed whole by the $30 debt: nothing becomes spendable.
    await seedUser("u1");
    const first = await initiateDeposit(db, depositInput("u1", 20_00), deps);
    if (!first.ok) throw new Error("unreachable");
    provider.advance();
    const [firstEvent] = drainEvents();
    expect(await recordDepositCompleted(db, firstEvent!, postDeps())).toEqual({ ok: true, replayed: false, settledOwedCents: 20_00 });
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 0, owedCents: 10_00 });

    // A $50 deposit clears the last $10 and the remainder is the member's again.
    const second = await initiateDeposit(db, depositInput("u1", 50_00), deps);
    if (!second.ok) throw new Error("unreachable");
    provider.advance();
    const [secondEvent] = drainEvents();
    expect(await recordDepositCompleted(db, secondEvent!, postDeps())).toEqual({ ok: true, replayed: false, settledOwedCents: 10_00 });
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 40_00, owedCents: 0 });

    // Both settlements audited as system_action with the payload outcome, platform scope.
    const settlements = await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "receivable_settlement"));
    expect(settlements).toHaveLength(2);
  });

  it("never settles a NEWER debt off a stale redelivery of an older completion", async () => {
    const ref = await verifiedDeposit("u1", 50_00);
    provider.advance();
    const staleEvent: PaymentsEvent = { type: "deposit_completed", ref, amountCents: 50_00 };
    await spendOnEntryFee("u1", "lg1", 30_00);
    await returnDeposit(ref);
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 0, owedCents: 30_00 });

    const before = await snapshotMoneyBook(db);
    expect(await recordDepositCompleted(db, staleEvent, postDeps())).toEqual({ ok: true, replayed: true, settledOwedCents: 0 });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("alarms on a transfer this product never initiated, posting nothing", async () => {
    const out = await recordDepositCompleted(db, { type: "deposit_completed", ref: "mock-transfer-999", amountCents: 50_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: DEPOSIT_ALARMS.unknownTransferRef });
    await expectNoPostingTookPlace(db);
  });

  it("alarms on an amount that disagrees with the stored intent, posting nothing", async () => {
    await seedUser("u1");
    const initiated = await initiateDeposit(db, depositInput("u1", 50_00), deps);
    if (!initiated.ok) throw new Error("unreachable");
    const before = await snapshotDepositBook(db);
    const out = await recordDepositCompleted(db, { type: "deposit_completed", ref: initiated.transfer.ref, amountCents: 49_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: DEPOSIT_ALARMS.transferDisagreement });
    await expectNoDepositTookPlace(db, before);
  });

  it("throws on the wrong event type — a route wiring bug, not a business outcome", async () => {
    await expect(
      recordDepositCompleted(db, { type: "deposit_returned", ref: "r", amountCents: 1 }, postDeps()),
    ).rejects.toThrow(/wrong event type/);
  });
});

describe("recordDepositReturned — the deposit that comes back", () => {
  it("claws back a returned deposit from the available balance, and books any shortfall as owed, never negative", async () => {
    const ref = await verifiedDeposit("u1", 50_00); // balance 5000
    await spendOnEntryFee("u1", "lg1", 30_00); // balance 2000
    const out = await returnDeposit(ref);
    expect(out).toEqual({ ok: true, replayed: false, shortfallCents: 30_00 });

    const w = await walletSummary(db, "u1");
    expect(w.availableCents).toBe(0);
    expect(w.owedCents).toBe(30_00); // platform_receivable:u1

    const audited = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "deposit_returned"));
    expect(audited).toHaveLength(1);
    expect(audited[0]!.payload).toMatchObject({ amountCents: 50_00, shortfallCents: 30_00 });
  });

  it("claws back entirely from the balance when nothing was spent — no shortfall, no receivable", async () => {
    const ref = await verifiedDeposit("u1", 50_00);
    const out = await returnDeposit(ref);
    expect(out).toEqual({ ok: true, replayed: false, shortfallCents: 0 });
    expect(await walletSummary(db, "u1")).toMatchObject({ availableCents: 0, owedCents: 0 });
  });

  it("treats a redelivered return as the same non-event", async () => {
    const ref = await verifiedDeposit("u1", 50_00);
    await spendOnEntryFee("u1", "lg1", 30_00);
    const out = await returnDeposit(ref);
    expect(out).toMatchObject({ ok: true, replayed: false });

    const before = await snapshotMoneyBook(db);
    const redelivered = await recordDepositReturned(db, { type: "deposit_returned", ref, amountCents: 50_00 }, postDeps());
    expect(redelivered).toEqual({ ok: true, replayed: true, shortfallCents: 0 });
    expect(await snapshotMoneyBook(db)).toEqual(before);
  });

  it("alarms on a return whose completion has not posted yet — the one alarm redelivery heals", async () => {
    await seedUser("u1");
    const initiated = await initiateDeposit(db, depositInput("u1", 50_00), deps);
    if (!initiated.ok) throw new Error("unreachable");
    const before = await snapshotDepositBook(db);
    const out = await recordDepositReturned(db, { type: "deposit_returned", ref: initiated.transfer.ref, amountCents: 50_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: DEPOSIT_ALARMS.returnBeforeCompletion });
    await expectNoDepositTookPlace(db, before);
  });

  it("alarms on a transfer this product never initiated, posting nothing", async () => {
    const out = await recordDepositReturned(db, { type: "deposit_returned", ref: "mock-transfer-404", amountCents: 10_00 }, postDeps());
    expect(out).toEqual({ ok: false, alarm: DEPOSIT_ALARMS.unknownTransferRef });
    await expectNoPostingTookPlace(db);
  });

  it("throws on the wrong event type", async () => {
    await expect(
      recordDepositReturned(db, { type: "deposit_completed", ref: "r", amountCents: 1 }, postDeps()),
    ).rejects.toThrow(/wrong event type/);
  });
});
