import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DbTx } from "@research/db/client";
import { auditEvents, moneyAccounts, moneyEntries, moneyTransactions } from "@/db/schema";
import { createTestDb } from "@research/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@research/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { accountIdFor, accountSide, parseAccountId } from "@/money/accounts";
import { MONEY_REFUSALS } from "@/money/config";
import { postMoneyTransaction, type MoneyTransactionInput, type PostDeps, type PostMoneyOutcome } from "./post";
import { expectNoPostingTookPlace, runSeededPostingSequence, snapshotMoneyBook } from "./test-support";

const db = createTestDb();
// A second pool for the two-transaction races below, so both sides genuinely hold separate
// connections — the same shape `src/integrity-service/lock-order.test.ts` uses throughout.
const raceDb = createTestDb();

const OCCURRED_AT = "2026-09-01T00:00:00.000Z";
const clock: Clock = { now: () => OCCURRED_AT };
let nextId = 0;
const newId = () => `m_${(nextId += 1)}`;
const deps: PostDeps = { audit: getAuditLogger(), clock, newId };

const withTx = <T>(fn: (tx: DbTx) => Promise<T>): Promise<T> => db.transaction(fn);

/** A completed deposit: the pool grows (asset debit), the member's balance grows (liability credit). */
function depositInput(userId: string, amountCents: number, overrides: Partial<MoneyTransactionInput> = {}): MoneyTransactionInput {
  return {
    kind: "deposit",
    stateOfEntry: "NJ",
    entries: [
      { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents },
      { accountId: accountIdFor("user_available", userId), direction: "credit", amountCents },
    ],
    auditEvent: { eventType: "deposit_completed", actorId: userId, actorType: "user", leagueId: null, payload: { amountCents } },
    ...overrides,
  };
}

/** An entry fee, named accounts in USER-FIRST input order ("u…" sorts after "l…" on purpose). */
function feeInput(userId: string, leagueId: string, amountCents: number): MoneyTransactionInput {
  return {
    kind: "entry_fee",
    leagueId,
    stateOfEntry: "NJ",
    entries: [
      { accountId: accountIdFor("user_available", userId), direction: "debit", amountCents },
      { accountId: accountIdFor("league_escrow", leagueId), direction: "credit", amountCents },
    ],
    auditEvent: { eventType: "entry_fee_collected", actorId: userId, actorType: "user", leagueId, payload: { amountCents } },
  };
}

/** The fee's mirror, named accounts in ESCROW-FIRST input order — the opposite of `feeInput`. */
function refundInput(leagueId: string, userId: string, amountCents: number): MoneyTransactionInput {
  return {
    kind: "entry_fee_refund",
    leagueId,
    stateOfEntry: "NJ",
    entries: [
      { accountId: accountIdFor("league_escrow", leagueId), direction: "debit", amountCents },
      { accountId: accountIdFor("user_available", userId), direction: "credit", amountCents },
    ],
    auditEvent: { eventType: "entry_fee_refunded", actorId: userId, actorType: "user", leagueId, payload: { amountCents } },
  };
}

async function balanceOf(accountId: string): Promise<number> {
  const [row] = await db.select({ balanceCents: moneyAccounts.balanceCents }).from(moneyAccounts).where(eq(moneyAccounts.id, accountId));
  return row?.balanceCents ?? 0;
}

/** Sums every entry by which side of the accounting equation its account sits on. */
async function sumBySide(): Promise<{ assets: number; liabilities: number }> {
  const rows = await db.select().from(moneyEntries);
  let assets = 0;
  let liabilities = 0;
  for (const row of rows) {
    const side = accountSide(parseAccountId(row.accountId).kind);
    const signed = row.direction === "debit" ? row.amountCents : -row.amountCents;
    if (side === "asset") assets += signed;
    else liabilities -= signed;
  }
  return { assets, liabilities };
}

/** `pg_stat_activity`-driven, never a sleep — the `lock-order.test.ts` idiom. */
async function waitForBlockedBackend(timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const rows = await db.execute<{ count: string }>(
      sql`SELECT count(*) AS count FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()`,
    );
    if (Number(rows[0]?.count ?? 0) > 0) return true;
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
});

describe("postMoneyTransaction — the one writer", () => {
  it("posts a balanced set as one transaction: the rows, the rollups and the audit event land together", async () => {
    const out = await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 50_00), deps));
    expect(out).toEqual({ ok: true, transactionId: "m_1", replayed: false });

    const transactions = await db.select().from(moneyTransactions);
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({ id: "m_1", kind: "deposit", leagueId: null, providerTransferRef: null, idempotencyKey: null });

    const entries = await db.select().from(moneyEntries).orderBy(asc(moneyEntries.id));
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry).toMatchObject({ transactionId: "m_1", stateOfEntry: "NJ", taxYear: 2026, amountCents: 50_00 });
    }

    expect(await balanceOf("fbo_pool")).toBe(50_00);
    expect(await balanceOf("user_available:u1")).toBe(50_00);

    const events = await db.select().from(auditEvents).where(eq(auditEvents.eventType, "deposit_completed"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ actorId: "u1", leagueId: null });
    expect(events[0]!.occurredAt.toISOString()).toBe(OCCURRED_AT);
  });

  it("stamps a per-entry stateOfEntry override on that leg alone — decision 6's many-state case", async () => {
    const input = depositInput("u1", 50_00);
    const overridden: MoneyTransactionInput = {
      ...input,
      entries: [input.entries[0]!, { ...input.entries[1]!, stateOfEntry: "TN" }],
    };
    await withTx((tx) => postMoneyTransaction(tx, overridden, deps));

    const entries = await db.select().from(moneyEntries).orderBy(asc(moneyEntries.id));
    expect(entries.map((entry) => entry.stateOfEntry)).toEqual(["NJ", "TN"]);
  });

  it("stores the provider transfer reference when an external motion carries one", async () => {
    await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 50_00, { providerTransferRef: "transfer_abc" }), deps));
    const [row] = await db.select().from(moneyTransactions);
    expect(row).toMatchObject({ providerTransferRef: "transfer_abc" });
  });

  it("refuses an unbalanced set before touching any row", async () => {
    const input = depositInput("u1", 50_00);
    const unbalanced: MoneyTransactionInput = { ...input, entries: [input.entries[0]!, { ...input.entries[1]!, amountCents: 49_99 }] };
    const out = await withTx((tx) => postMoneyTransaction(tx, unbalanced, deps));
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.unbalanced });
    await expectNoPostingTookPlace(db);
  });

  it("refuses an insufficient balance with zero writes, holding the rollup lock while it decides", async () => {
    const out = await withTx((tx) => postMoneyTransaction(tx, feeInput("brokeUser", "lg1", 20_00), deps));
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.insufficientBalance });
    await expectNoPostingTookPlace(db);
  });

  it("refuses a posting that would drive a funded balance below zero — refuse, never clamp", async () => {
    await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 20_00), deps));
    const before = await snapshotMoneyBook(db);

    const out = await withTx((tx) => postMoneyTransaction(tx, feeInput("u1", "lg1", 50_00), deps));
    expect(out).toEqual({ ok: false, reason: MONEY_REFUSALS.insufficientBalance });
    await expectNoPostingTookPlace(db, before);
    expect(await balanceOf("user_available:u1")).toBe(20_00);
  });

  it("lets the three shortfall accounts swing negative — the ACH-return model the floor exempts", async () => {
    const out = await withTx((tx) =>
      postMoneyTransaction(
        tx,
        {
          kind: "deposit_return",
          stateOfEntry: "NJ",
          providerTransferRef: "transfer_return",
          entries: [
            { accountId: accountIdFor("fbo_pool"), direction: "credit", amountCents: 10_00 },
            { accountId: accountIdFor("platform_receivable", "u1"), direction: "debit", amountCents: 10_00 },
          ],
          auditEvent: { eventType: "deposit_returned", actorId: "u1", actorType: "user", leagueId: null, payload: { amountCents: 10_00 } },
        },
        deps,
      ),
    );
    expect(out).toMatchObject({ ok: true });
    expect(await balanceOf("fbo_pool")).toBe(-10_00);
    expect(await balanceOf("platform_receivable:u1")).toBe(10_00);
  });

  it("locks rollup rows in sorted account-id order, so two transactions touching the same pair cannot deadlock", async () => {
    await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 40_00), deps));
    await withTx((tx) => postMoneyTransaction(tx, feeInput("u1", "lg1", 10_00), deps));

    // Two concurrent postings, opposite account orders in their input. Both must complete.
    const [fee, refund] = await Promise.all([
      withTx((tx) => postMoneyTransaction(tx, feeInput("u1", "lg1", 10_00), deps)),
      raceDb.transaction((tx) => postMoneyTransaction(tx, refundInput("lg1", "u1", 10_00), deps)),
    ]);
    expect(fee).toMatchObject({ ok: true });
    expect(refund).toMatchObject({ ok: true });
    expect(await balanceOf("user_available:u1")).toBe(30_00);
    expect(await balanceOf("league_escrow:lg1")).toBe(10_00);
  });

  it("keeps the books balanced: assets equal liabilities after any sequence of postings", async () => {
    await runSeededPostingSequence(db, deps); // deposit, fee, refund, settlement, return — the property harness
    const { assets, liabilities } = await sumBySide();
    expect(assets).toBe(liabilities);
    expect(assets).toBe(120_00);
  });

  it("fails the whole transaction when the audit append fails, leaving no money rows behind", async () => {
    const failing: PostDeps = {
      ...deps,
      audit: {
        record: async () => {
          throw new Error("audit append failed");
        },
        recordAll: async () => {
          throw new Error("audit append failed");
        },
      },
    };
    await expect(withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 50_00), failing))).rejects.toThrow("audit append failed");
    await expectNoPostingTookPlace(db);
  });
});

describe("the idempotency backstop", () => {
  it("treats a replayed key as the same non-event: the prior outcome, no new rows", async () => {
    const first = await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 50_00, { idempotencyKey: "idem_1" }), deps));
    expect(first).toEqual({ ok: true, transactionId: "m_1", replayed: false });

    const replay = await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 50_00, { idempotencyKey: "idem_1" }), deps));
    expect(replay).toEqual({ ok: true, transactionId: "m_1", replayed: true });

    expect(await db.select().from(moneyTransactions)).toHaveLength(1);
    expect(await balanceOf("user_available:u1")).toBe(50_00);
  });

  it("answers a mid-lock replay of a DEBIT the account tolerates exactly once — never a spurious insufficientBalance", async () => {
    // The fix-round scenario (review, CRITICAL): a webhook double-delivers a withdrawal whose
    // amount the balance can absorb ONCE. The replay blocks on the account row lock, unblocks
    // after the original commits, and re-evaluates the same debit against the POST-commit
    // balance — the post-lock replay re-check must answer it as the non-event before the
    // balance floor ever sees the now-unaffordable delta.
    await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 50_00), deps));

    const withdrawal = (): MoneyTransactionInput => ({
      kind: "withdrawal_request",
      stateOfEntry: "NJ",
      idempotencyKey: "idem_withdrawal",
      entries: [
        { accountId: accountIdFor("user_available", "u1"), direction: "debit", amountCents: 50_00 },
        { accountId: accountIdFor("provider_clearing"), direction: "credit", amountCents: 50_00 },
      ],
      auditEvent: { eventType: "withdrawal_requested", actorId: "u1", actorType: "user", leagueId: null, payload: { amountCents: 50_00 } },
    });

    let firstPosted: () => void = () => {};
    const posted = new Promise<void>((resolve) => (firstPosted = resolve));
    let releaseFirst: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseFirst = resolve));

    let first: PostMoneyOutcome | undefined;
    const holding = db.transaction(async (tx) => {
      first = await postMoneyTransaction(tx, withdrawal(), deps);
      firstPosted();
      await parked;
    });
    await posted;

    // The replay's own pre-check sees nothing (the original is uncommitted), so it walks into
    // the rollup locks the original holds and genuinely blocks — asked of Postgres, never slept.
    const racing = raceDb.transaction((tx) => postMoneyTransaction(tx, withdrawal(), deps));
    expect(await waitForBlockedBackend()).toBe(true);
    releaseFirst();
    await holding;

    const second = await racing;
    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(second).toEqual({ ok: true, transactionId: (first as { transactionId: string }).transactionId, replayed: true });
    expect(await db.select().from(moneyTransactions).where(eq(moneyTransactions.kind, "withdrawal_request"))).toHaveLength(1);
    expect(await balanceOf("user_available:u1")).toBe(0); // debited exactly once
    expect(await balanceOf("provider_clearing")).toBe(50_00);
  });

  it("returns the prior outcome when a replay touching DISJOINT accounts races the original — the unique index catches it", async () => {
    // No shared rollup row here, on purpose: with disjoint accounts neither the row locks nor
    // the post-lock re-check can serialize the pair, so the replay proceeds all the way to its
    // own `money_transactions` insert and waits on the unique index — the backstop's one
    // genuinely reachable moment, driven deterministically.
    let firstPosted: () => void = () => {};
    const posted = new Promise<void>((resolve) => (firstPosted = resolve));
    let releaseFirst: () => void = () => {};
    const parked = new Promise<void>((resolve) => (releaseFirst = resolve));

    let first: PostMoneyOutcome | undefined;
    const holding = db.transaction(async (tx) => {
      first = await postMoneyTransaction(tx, depositInput("u1", 50_00, { idempotencyKey: "idem_race" }), deps);
      firstPosted();
      await parked;
    });
    await posted;

    const disjoint: MoneyTransactionInput = {
      kind: "deposit_return",
      stateOfEntry: "NJ",
      idempotencyKey: "idem_race",
      entries: [
        { accountId: accountIdFor("provider_clearing"), direction: "credit", amountCents: 10_00 },
        { accountId: accountIdFor("platform_receivable", "u2"), direction: "debit", amountCents: 10_00 },
      ],
      auditEvent: { eventType: "deposit_returned", actorId: "u2", actorType: "user", leagueId: null, payload: { amountCents: 10_00 } },
    };
    const racing = raceDb.transaction((tx) => postMoneyTransaction(tx, disjoint, deps));
    expect(await waitForBlockedBackend()).toBe(true);
    releaseFirst();
    await holding;

    const second = await racing;
    expect(first).toEqual({ ok: true, transactionId: "m_1", replayed: false });
    expect(second).toEqual({ ok: true, transactionId: "m_1", replayed: true });
    expect(await db.select().from(moneyTransactions)).toHaveLength(1);
    expect(await balanceOf("user_available:u1")).toBe(50_00);
    expect(await balanceOf("provider_clearing")).toBe(0); // the replay wrote nothing of its own
  });

  it("rethrows a duplicate transaction id with no idempotency key in play — a bug, never a replay", async () => {
    await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 50_00), deps));
    const before = await snapshotMoneyBook(db);

    // `m_1` is the committed transaction's id; a colliding mint must surface, not be swallowed.
    let calls = 0;
    const colliding: PostDeps = { ...deps, newId: () => (calls === 0 ? ((calls += 1), "m_1") : `x_${(calls += 1)}`) };
    await expect(withTx((tx) => postMoneyTransaction(tx, depositInput("u2", 10_00), colliding))).rejects.toThrow();
    await expectNoPostingTookPlace(db, before);
  });

  it("rethrows a unique violation that is not the idempotency index, even when a key is present", async () => {
    await withTx((tx) => postMoneyTransaction(tx, depositInput("u1", 50_00), deps));
    const before = await snapshotMoneyBook(db);

    let calls = 0;
    const colliding: PostDeps = { ...deps, newId: () => (calls === 0 ? ((calls += 1), "m_1") : `x_${(calls += 1)}`) };
    await expect(
      withTx((tx) => postMoneyTransaction(tx, depositInput("u2", 10_00, { idempotencyKey: "idem_other" }), colliding)),
    ).rejects.toThrow();
    await expectNoPostingTookPlace(db, before);
  });
});

/**
 * The two guards unreachable through real Postgres, driven by narrow stub transactions that put
 * the code in the state it defends against — the same discipline `vitest.config.mts`'s own
 * docblock records for `lockAnchor`'s "vanished between insert and lock" (never a lowered
 * threshold, never an ignored line).
 */
describe("the unreachable guards, held by stubs", () => {
  function stubTx({ lockedRows, onInsertTransaction }: { lockedRows: unknown[]; onInsertTransaction: () => never }): DbTx {
    const whereResult = Object.assign(Promise.resolve([] as unknown[]), { for: () => Promise.resolve(lockedRows) });
    return {
      select: () => ({ from: () => ({ where: () => whereResult }) }),
      insert: () => ({ values: () => ({ onConflictDoNothing: () => Promise.resolve() }) }),
      transaction: async () => onInsertTransaction(),
    } as unknown as DbTx;
  }

  it("throws when a rollup row vanishes between its ensure-insert and its lock", async () => {
    const tx = stubTx({
      lockedRows: [],
      onInsertTransaction: () => {
        throw new Error("unreachable: the lock guard fires first");
      },
    });
    await expect(postMoneyTransaction(tx, depositInput("u1", 50_00), deps)).rejects.toThrow(/vanished between insert and lock/);
  });

  it("rethrows the original violation when the committed replay row cannot be read back", async () => {
    const violation = Object.assign(new Error("duplicate key stub"), {
      code: "23505",
      constraint_name: "money_transactions_idempotency_key_idx",
    });
    const tx = stubTx({
      lockedRows: [{ kind: "fbo_pool", balanceCents: 0 }],
      onInsertTransaction: () => {
        throw violation;
      },
    });
    await expect(postMoneyTransaction(tx, depositInput("u1", 50_00, { idempotencyKey: "idem_gone" }), deps)).rejects.toThrow(
      "duplicate key stub",
    );
  });
});
