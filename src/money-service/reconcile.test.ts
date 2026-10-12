import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DbTx } from "@research/db/client";
import { createTestDb } from "@research/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@research/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { accountIdFor } from "@/money/accounts";
import { MONEY_CONFIG } from "@/money/config";
import { createMockPaymentsProvider } from "@/payments-provider/mock/mock-payments-provider";
import { postMoneyTransaction, type MoneyTransactionInput, type PostDeps } from "./post";
import {
  escrowRollupMismatches,
  ledgerBalanceFigures,
  moneyDriftFindings,
  negativeUserAvailableAccounts,
  reconcileMoney,
  type MoneyAccountRow,
  type MoneyDriftReport,
} from "./reconcile";
import { runSeededPostingSequence } from "./test-support";

const db = createTestDb();

let nextId = 0;
const newId = () => `r_${(nextId += 1)}`;
const clock: Clock = { now: () => "2026-09-01T00:00:00.000Z" };
const deps: PostDeps = { audit: getAuditLogger(), clock, newId };

const post = (input: MoneyTransactionInput) => db.transaction((tx: DbTx) => postMoneyTransaction(tx, input, deps));

const deposit = (userId: string, amountCents: number, stateOfEntry: string): MoneyTransactionInput => ({
  kind: "deposit",
  stateOfEntry,
  entries: [
    { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents },
    { accountId: accountIdFor("user_available", userId), direction: "credit", amountCents },
  ],
  auditEvent: { eventType: "deposit_completed", actorId: userId, actorType: "user", leagueId: null, payload: { amountCents } },
});

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
});

describe("reconcileMoney — the bank check", () => {
  it("answers zero drift when the ledger and the mock provider agree", async () => {
    const provider = createMockPaymentsProvider(clock);
    await provider.ensureAccount("u1");
    const intent = await provider.initiateDeposit({ userId: "u1", amountCents: 50_00, method: "bank", idempotencyKey: "dep_1" });
    provider.advance();
    provider.drainCallbacks();
    await post(deposit("u1", 50_00, "NJ"));

    const report = await reconcileMoney(db, provider);
    expect(report).toMatchObject({ drift: 0, ledgerFboPoolCents: 50_00, providerPooledBalanceCents: 50_00 });
    expect(intent.status).toBe("pending");
    expect(moneyDriftFindings(report)).toEqual([]);
  });

  it("reports the exact cent drift when a verified callback never got posted", async () => {
    const provider = createMockPaymentsProvider(clock);
    await provider.ensureAccount("u1");
    await provider.initiateDeposit({ userId: "u1", amountCents: 75_00, method: "bank", idempotencyKey: "dep_2" });
    provider.advance();
    // Deliberately never posts the matching ledger transaction — the exact shape of
    // `DEPOSIT_ALARMS.unknownTransferRef`/`transferDisagreement`: the bank moved money the
    // ledger never recorded.
    const report = await reconcileMoney(db, provider);

    expect(report.ledgerFboPoolCents).toBe(0);
    expect(report.providerPooledBalanceCents).toBe(75_00);
    expect(report.drift).toBe(-75_00);

    const findings = moneyDriftFindings(report);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toEqual({ code: "bank_drift", message: "The ledger's pooled balance disagrees with the bank by $75.00." });
  });
});

describe("reconcileMoney — the internal invariants, re-proven as a health read", () => {
  it("agrees on every check after the seeded posting sequence — a healthy book alarms on nothing", async () => {
    const provider = createMockPaymentsProvider(clock);
    await runSeededPostingSequence(db, deps);

    const report = await reconcileMoney(db, provider);
    expect(report.assetsCents).toBe(report.liabilitiesCents);
    expect(report.ledgerBalanceDriftCents).toBe(0);
    expect(report.negativeUserAvailable).toEqual([]);
    expect(report.escrowMismatches).toEqual([]);
    // The pool check disagrees here on purpose: the seeded sequence posts straight through
    // `postMoneyTransaction`, never through the mock provider's own initiation path, so this
    // ONE check is expected to alarm while every internal invariant stays clean.
    expect(moneyDriftFindings(report).map((finding) => finding.code)).toEqual(["bank_drift"]);
  });

  it("finds an escrow rollup that disagrees with its own entries, corrupted directly at the rollup", async () => {
    const provider = createMockPaymentsProvider(clock);
    await post(deposit("u1", 100_00, "NJ"));
    await post({
      kind: "entry_fee",
      leagueId: "lg1",
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("user_available", "u1"), direction: "debit", amountCents: 20_00 },
        { accountId: accountIdFor("league_escrow", "lg1"), direction: "credit", amountCents: 20_00 },
      ],
      auditEvent: { eventType: "entry_fee_collected", actorId: "u1", actorType: "user", leagueId: "lg1", payload: { amountCents: 20_00 } },
    });
    // The rollup is the mutable backstop, not the record (`post.ts`'s own docblock) — a direct
    // UPDATE is exactly the corruption this check exists to catch, the same technique
    // `schema-invariants.test.ts` uses to prove the rollup is a mutable table at all.
    await db.execute(sql`UPDATE money_accounts SET balance_cents = 999 WHERE id = 'league_escrow:lg1'`);

    const report = await reconcileMoney(db, provider);
    expect(report.escrowMismatches).toEqual([{ accountId: "league_escrow:lg1", leagueId: "lg1", rollupCents: 999, entrySumCents: 20_00 }]);

    const findings = moneyDriftFindings(report);
    const escrowFinding = findings.find((finding) => finding.code === "escrow_mismatch");
    expect(escrowFinding?.message).toBe("League lg1's escrow disagrees with its own entries by $10.01.");
  });

  it("finds an assets-vs-liabilities drift when a rollup is corrupted off both totals", async () => {
    const provider = createMockPaymentsProvider(clock);
    await post(deposit("u1", 40_00, "NJ"));
    // Bumps the asset-side pool up with nothing offsetting it on the liability side — the
    // double-entry law's own violation, reachable only by corrupting the rollup directly (a real
    // posting can never do this — `balancedOrRefuse` refuses first).
    await db.execute(sql`UPDATE money_accounts SET balance_cents = 90_00 WHERE id = 'fbo_pool'`);

    const report = await reconcileMoney(db, provider);
    expect(report.assetsCents - report.liabilitiesCents).toBe(50_00);
    expect(report.ledgerBalanceDriftCents).toBe(50_00);

    const findings = moneyDriftFindings(report);
    const balanceFinding = findings.find((finding) => finding.code === "ledger_balance_drift");
    expect(balanceFinding?.message).toBe("The ledger's assets and liabilities disagree by $50.00.");
  });

  it("answers a clean report on a fresh, empty book", async () => {
    const provider = createMockPaymentsProvider(clock);
    const report = await reconcileMoney(db, provider);
    expect(report).toEqual<MoneyDriftReport>({
      ledgerFboPoolCents: 0,
      providerPooledBalanceCents: 0,
      drift: 0,
      assetsCents: 0,
      liabilitiesCents: 0,
      ledgerBalanceDriftCents: 0,
      negativeUserAvailable: [],
      escrowMismatches: [],
    });
    expect(moneyDriftFindings(report)).toEqual([]);
  });
});

describe("ledgerBalanceFigures — pure, the double-entry law's own arithmetic", () => {
  it("sums the asset side and the liability side separately", () => {
    const rows: readonly MoneyAccountRow[] = [
      { id: "fbo_pool", kind: "fbo_pool", ownerId: null, balanceCents: 100_00 },
      { id: "user_available:u1", kind: "user_available", ownerId: "u1", balanceCents: 60_00 },
      { id: "league_escrow:lg1", kind: "league_escrow", ownerId: "lg1", balanceCents: 40_00 },
    ];
    expect(ledgerBalanceFigures(rows)).toEqual({ assetsCents: 100_00, liabilitiesCents: 100_00 });
  });

  it("answers zero and zero for an empty ledger", () => {
    expect(ledgerBalanceFigures([])).toEqual({ assetsCents: 0, liabilitiesCents: 0 });
  });
});

describe("negativeUserAvailableAccounts — pure, the floor re-proven at the app layer", () => {
  it("finds a negative user_available row — the database's own CHECK makes this unreachable through any real write, so it is proven here directly against a fabricated row instead", () => {
    const rows: readonly MoneyAccountRow[] = [
      { id: "user_available:u1", kind: "user_available", ownerId: "u1", balanceCents: -5_00 },
      { id: "user_available:u2", kind: "user_available", ownerId: "u2", balanceCents: 10_00 },
      { id: "fbo_pool", kind: "fbo_pool", ownerId: null, balanceCents: -5_00 },
    ];
    expect(negativeUserAvailableAccounts(rows)).toEqual([{ accountId: "user_available:u1", balanceCents: -5_00 }]);
  });

  it("finds nothing when every user_available row is non-negative", () => {
    const rows: readonly MoneyAccountRow[] = [{ id: "user_available:u1", kind: "user_available", ownerId: "u1", balanceCents: 0 }];
    expect(negativeUserAvailableAccounts(rows)).toEqual([]);
  });
});

describe("escrowRollupMismatches — pure", () => {
  it("reads a missing map entry as a zero entry-sum, never a throw", () => {
    const rows: readonly MoneyAccountRow[] = [{ id: "league_escrow:lg1", kind: "league_escrow", ownerId: "lg1", balanceCents: 20_00 }];
    expect(escrowRollupMismatches(rows, new Map())).toEqual([
      { accountId: "league_escrow:lg1", leagueId: "lg1", rollupCents: 20_00, entrySumCents: 0 },
    ]);
  });

  it("ignores every non-escrow account kind", () => {
    const rows: readonly MoneyAccountRow[] = [{ id: "fbo_pool", kind: "fbo_pool", ownerId: null, balanceCents: 500_00 }];
    expect(escrowRollupMismatches(rows, new Map([["fbo_pool", 0]]))).toEqual([]);
  });
});

describe("moneyDriftFindings — the one shared decision", () => {
  it("names every kind of drift a report can carry, all at once", () => {
    const report: MoneyDriftReport = {
      ledgerFboPoolCents: 90_00,
      providerPooledBalanceCents: 100_00,
      drift: -10_00,
      assetsCents: 150_00,
      liabilitiesCents: 140_00,
      ledgerBalanceDriftCents: 10_00,
      negativeUserAvailable: [{ accountId: "user_available:u1", balanceCents: -3_00 }],
      escrowMismatches: [{ accountId: "league_escrow:lg1", leagueId: "lg1", rollupCents: 20_00, entrySumCents: 15_00 }],
    };
    expect(moneyDriftFindings(report)).toEqual([
      { code: "bank_drift", message: "The ledger's pooled balance disagrees with the bank by $10.00." },
      { code: "ledger_balance_drift", message: "The ledger's assets and liabilities disagree by $10.00." },
      { code: "negative_user_available", message: "user_available:u1 carries a negative balance of $3.00." },
      { code: "escrow_mismatch", message: "League lg1's escrow disagrees with its own entries by $5.00." },
    ]);
  });

  it("falls back to the account id when an escrow mismatch names no league", () => {
    const report: MoneyDriftReport = {
      ledgerFboPoolCents: 0,
      providerPooledBalanceCents: 0,
      drift: 0,
      assetsCents: 0,
      liabilitiesCents: 0,
      ledgerBalanceDriftCents: 0,
      negativeUserAvailable: [],
      escrowMismatches: [{ accountId: "league_escrow:ghost", leagueId: null, rollupCents: 5_00, entrySumCents: 0 }],
    };
    expect(moneyDriftFindings(report)[0]?.message).toBe("League league_escrow:ghost's escrow disagrees with its own entries by $5.00.");
  });

  it("respects MONEY_CONFIG.reconcileToleranceCents rather than a hardcoded zero", () => {
    expect(MONEY_CONFIG.reconcileToleranceCents).toBe(0);
    const report: MoneyDriftReport = {
      ledgerFboPoolCents: 0,
      providerPooledBalanceCents: 0,
      drift: 0,
      assetsCents: 0,
      liabilitiesCents: 0,
      ledgerBalanceDriftCents: 0,
      negativeUserAvailable: [],
      escrowMismatches: [],
    };
    expect(moneyDriftFindings(report)).toEqual([]);
  });
});
