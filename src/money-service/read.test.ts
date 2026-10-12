import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { DbTx } from "@research-ts/db/client";
import { leagues, moneyAccounts, moneyEntries, moneyTransactions, teams, users } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@research-ts/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { raiseFlag } from "@/integrity-service/flags";
import { accountIdFor } from "@/money/accounts";
import { MONEY_CONFIG } from "@/money/config";
import { postMoneyTransaction, type MoneyTransactionInput, type PostDeps } from "./post";
import { confiscateHold, releaseHold, settleSeasonPayouts } from "./settlement";
import { accountBalance, getUserAnnualNetProfit, walletAccountFlags, walletSummary } from "./read";
import { runSeededPostingSequence } from "./test-support";

const db = createTestDb();

let nextId = 0;
const newId = () => `r_${(nextId += 1)}`;
const clock2026: Clock = { now: () => "2026-09-01T00:00:00.000Z" };
const clock2025: Clock = { now: () => "2025-12-31T23:59:00.000Z" };
const deps: PostDeps = { audit: getAuditLogger(), clock: clock2026, newId };
const deps2025: PostDeps = { audit: getAuditLogger(), clock: clock2025, newId };

const post = (input: MoneyTransactionInput, postDeps: PostDeps = deps) =>
  db.transaction((tx: DbTx) => postMoneyTransaction(tx, input, postDeps));

const deposit = (userId: string, amountCents: number, stateOfEntry: string): MoneyTransactionInput => ({
  kind: "deposit",
  stateOfEntry,
  entries: [
    { accountId: accountIdFor("fbo_pool"), direction: "debit", amountCents },
    { accountId: accountIdFor("user_available", userId), direction: "credit", amountCents },
  ],
  auditEvent: { eventType: "deposit_completed", actorId: userId, actorType: "user", leagueId: null, payload: { amountCents } },
});

const fee = (userId: string, leagueId: string, amountCents: number, stateOfEntry: string): MoneyTransactionInput => ({
  kind: "entry_fee",
  leagueId,
  stateOfEntry,
  entries: [
    { accountId: accountIdFor("user_available", userId), direction: "debit", amountCents },
    { accountId: accountIdFor("league_escrow", leagueId), direction: "credit", amountCents },
  ],
  auditEvent: { eventType: "entry_fee_collected", actorId: userId, actorType: "user", leagueId, payload: { amountCents } },
});

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  nextId = 0;
});

afterAll(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
});

describe("walletSummary — four figures, each a SUM over money_entries", () => {
  it("reports the property harness's hand-computed end state for both members", async () => {
    await runSeededPostingSequence(db, deps);

    expect(await walletSummary(db, "u1")).toEqual({ availableCents: 96_00, escrowCents: 20_00, heldCents: 0, owedCents: 0 });
    // u2's fee into lg_open was refunded and lg_done settled, so nothing of theirs sits in
    // escrow; the ACH return's shortfall is what they owe.
    expect(await walletSummary(db, "u2")).toEqual({ availableCents: 0, escrowCents: 0, heldCents: 0, owedCents: 20_00 });
  });

  it("answers all zeros for a member the book has never seen", async () => {
    await runSeededPostingSequence(db, deps);
    expect(await walletSummary(db, "stranger")).toEqual({ availableCents: 0, escrowCents: 0, heldCents: 0, owedCents: 0 });
  });

  it("reads the entries and never the rollup: a corrupted rollup row changes nothing it reports", async () => {
    await runSeededPostingSequence(db, deps);
    await db.execute(sql`UPDATE money_accounts SET balance_cents = 999999 WHERE id = 'user_available:u1'`);
    expect((await walletSummary(db, "u1")).availableCents).toBe(96_00);
  });

  it("counts a payout held for review as held, not available", async () => {
    await runSeededPostingSequence(db, deps);
    await post({
      kind: "hold_confiscation",
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("user_available", "u1"), direction: "debit", amountCents: 10_00 },
        { accountId: accountIdFor("held_for_review", "u1"), direction: "credit", amountCents: 10_00 },
      ],
      auditEvent: { eventType: "payout_held", actorId: null, actorType: "system", leagueId: null, payload: { amountCents: 10_00 } },
    });

    expect(await walletSummary(db, "u1")).toEqual({ availableCents: 86_00, escrowCents: 20_00, heldCents: 10_00, owedCents: 0 });
  });

  it("cannot attribute an entry fee that carries no league to any escrow, and says zero", async () => {
    await post(deposit("u3", 50_00, "NJ"));
    // A fee whose transaction names no league (legal at this layer; Task 8's caller always
    // names one): the escrow attribution has no league to hang it on and must not invent one.
    await post({ ...fee("u3", "lg_ghost", 20_00, "NJ"), leagueId: null });
    expect((await walletSummary(db, "u3")).escrowCents).toBe(0);
  });
});

describe("accountBalance — one account's entry-sum truth", () => {
  it("agrees with every rollup row after the property harness — the rollup is a backstop, the entries are the truth", async () => {
    await runSeededPostingSequence(db, deps);
    const accounts = await db.select().from(moneyAccounts);
    expect(accounts.length).toBeGreaterThan(0);
    for (const account of accounts) {
      expect(await accountBalance(db, account.id)).toBe(account.balanceCents);
    }
  });

  it("answers zero for an account with no entries at all", async () => {
    expect(await accountBalance(db, accountIdFor("user_available", "ghost"))).toBe(0);
  });
});

describe("getUserAnnualNetProfit — the Phase 5 guarantee", () => {
  /** Two tax years, two states, one member: 2025 nets a prize minus a fee, 2026 nets to zero. */
  async function seedTwoYears(): Promise<void> {
    await post(deposit("u1", 100_00, "NJ"), deps2025);
    await post(deposit("u2", 100_00, "TN"), deps2025);
    await post(fee("u1", "lgA", 20_00, "NJ"), deps2025);
    await post(fee("u2", "lgA", 20_00, "TN"), deps2025);
    await post(
      {
        kind: "settlement",
        leagueId: "lgA",
        stateOfEntry: "TN",
        entries: [
          { accountId: accountIdFor("league_escrow", "lgA"), direction: "debit", amountCents: 40_00 },
          { accountId: accountIdFor("user_available", "u1"), direction: "credit", amountCents: 36_00 },
          { accountId: accountIdFor("platform_rake"), direction: "credit", amountCents: 4_00 },
        ],
        auditEvent: { eventType: "prize_paid", actorId: null, actorType: "system", leagueId: "lgA", payload: { winnerUserId: "u1" } },
      },
      deps2025,
    );

    await post(fee("u1", "lgB", 30_00, "NJ"));
    await post({
      kind: "entry_fee_refund",
      leagueId: "lgB",
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("league_escrow", "lgB"), direction: "debit", amountCents: 30_00 },
        { accountId: accountIdFor("user_available", "u1"), direction: "credit", amountCents: 30_00 },
      ],
      auditEvent: { eventType: "entry_fee_refunded", actorId: "u1", actorType: "user", leagueId: "lgB", payload: { amountCents: 30_00 } },
    });
    // A settlement-kind DEBIT of the available balance (a hold at payout time) is neither a
    // prize, a fee nor a refund — the annual-net methodology ignores it, and this pins that.
    await post({
      kind: "settlement",
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("user_available", "u1"), direction: "debit", amountCents: 5_00 },
        { accountId: accountIdFor("held_for_review", "u1"), direction: "credit", amountCents: 5_00 },
      ],
      auditEvent: { eventType: "payout_held", actorId: null, actorType: "system", leagueId: null, payload: { amountCents: 5_00 } },
    });
  }

  it("computes prizes credited minus fees debited plus refunds credited, per tax year — the annual-net methodology", async () => {
    await seedTwoYears();
    expect(await getUserAnnualNetProfit(db, "u1", 2025)).toBe(16_00); // 36_00 prize − 20_00 fee
    expect(await getUserAnnualNetProfit(db, "u2", 2025)).toBe(-20_00); // a fee and no prize
    expect(await getUserAnnualNetProfit(db, "u1", 2026)).toBe(0); // 30_00 fee, 30_00 refund, held payout ignored
    expect(await getUserAnnualNetProfit(db, "stranger", 2025)).toBe(0);
  });

  it("answers who crossed the reporting line for a tax year — the exact query Phase 5 consumes", async () => {
    const threshold = MONEY_CONFIG.reportingThresholdCentsByTaxYear[2026];
    await post(deposit("u_payer", 30_000_00, "NJ"));
    await post(fee("u_payer", "lg_big", 25_00_00, "NJ"));
    await post(fee("u_payer", "lg_small", 50_00, "NJ"));
    await post({
      kind: "settlement",
      leagueId: "lg_big",
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("league_escrow", "lg_big"), direction: "debit", amountCents: 25_00_00 },
        { accountId: accountIdFor("user_available", "u_big"), direction: "credit", amountCents: 21_00_00 },
        { accountId: accountIdFor("platform_rake"), direction: "credit", amountCents: 4_00_00 },
      ],
      auditEvent: { eventType: "prize_paid", actorId: null, actorType: "system", leagueId: "lg_big", payload: { winnerUserId: "u_big" } },
    });
    await post({
      kind: "settlement",
      leagueId: "lg_small",
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("league_escrow", "lg_small"), direction: "debit", amountCents: 50_00 },
        { accountId: accountIdFor("user_available", "u_small"), direction: "credit", amountCents: 45_00 },
        { accountId: accountIdFor("platform_rake"), direction: "credit", amountCents: 5_00 },
      ],
      auditEvent: { eventType: "prize_paid", actorId: null, actorType: "system", leagueId: "lg_small", payload: { winnerUserId: "u_small" } },
    });

    const crossed: string[] = [];
    for (const userId of ["u_big", "u_small"]) {
      if ((await getUserAnnualNetProfit(db, userId, 2026)) >= threshold) crossed.push(userId);
    }
    expect(crossed).toEqual(["u_big"]);
  });
});

/**
 * The constructive-receipt ruling (Task 10 review, controller tax ruling), proven against the
 * REAL writers rather than hand-shaped rows: a December-of-year-N prize held by an open flag is
 * income in NO year while held; released in January of N+1 it is income in N+1, in the release's
 * own stamped tax year (read back, never restamped); confiscated, it is income NEVER — the money
 * lands on `platform_forfeiture` and dominion never arrives.
 */
describe("getUserAnnualNetProfit — held prizes across a year boundary (the constructive-receipt ruling)", () => {
  const decemberClock: Clock = { now: () => "2025-12-20T00:00:00.000Z" };
  const januaryClock: Clock = { now: () => "2026-01-10T00:00:00.000Z" };
  const depsDecember: PostDeps = { audit: getAuditLogger(), clock: decemberClock, newId };

  /** A real held settlement: paid 2-seat league, season complete in December 2025, the winner
   *  under an OPEN flag — through `settleSeasonPayouts` itself, never a hand-shaped posting. */
  async function seedHeldDecemberPrize(): Promise<void> {
    await db.insert(users).values([
      { id: "u_tax", email: "u_tax@test.local", displayName: "Tax" },
      { id: "u_mate", email: "u_mate@test.local", displayName: "Mate" },
    ]);
    await db.insert(leagues).values({
      id: "lg_tax",
      name: "lg_tax",
      format: "snake",
      teamCount: 2,
      commissionerUserId: "u_mate",
      entryFeeCents: 20_00,
      platformFeeCents: 0,
      payoutTable: [{ place: 1, amountCents: 40_00 }],
      seasonCompletedAt: new Date("2025-12-19T00:00:00.000Z"),
    });
    await db.insert(teams).values([
      { id: "team_tax", leagueId: "lg_tax", userId: "u_tax", name: "Tax's Team" },
      { id: "team_mate", leagueId: "lg_tax", userId: "u_mate", name: "Mate's Team" },
    ]);
    for (const userId of ["u_tax", "u_mate"]) {
      await post(deposit(userId, 50_00, "TN"), depsDecember);
      await post(fee(userId, "lg_tax", 20_00, "TN"), depsDecember);
    }
    await db.transaction((tx) =>
      raiseFlag(tx, {
        flagType: "multi_account",
        subjectId: "u_mate:u_tax",
        leagueId: null,
        evidence: {},
        raisedByUserId: null,
        occurredAt: decemberClock.now(),
        newId,
        audit: getAuditLogger(),
      }),
    );
    const settled = await settleSeasonPayouts(
      db,
      { leagueId: "lg_tax", operatorUserId: "u_mate", standings: [{ place: 1, userId: "u_tax" }] },
      { clock: decemberClock, audit: getAuditLogger(), newId },
    );
    expect(settled).toMatchObject({ ok: true, heldCents: 40_00 });
  }

  it("excludes a held prize from year N, and counts the FULL amount in year N+1 once released — in the release's own stamped tax year", async () => {
    await seedHeldDecemberPrize();

    // Held: the fee is 2025's only movement, and NO year holds the prize.
    expect(await getUserAnnualNetProfit(db, "u_tax", 2025)).toBe(-20_00);
    expect(await getUserAnnualNetProfit(db, "u_tax", 2026)).toBe(0);

    const released = await releaseHold(db, { userId: "u_tax", operatorUserId: "u_mate" }, { clock: januaryClock, audit: getAuditLogger(), newId });
    expect(released).toEqual({ ok: true, amountCents: 40_00 });

    // Income lands in the RELEASE's year; the held year stays untouched.
    expect(await getUserAnnualNetProfit(db, "u_tax", 2025)).toBe(-20_00);
    expect(await getUserAnnualNetProfit(db, "u_tax", 2026)).toBe(40_00);

    // The stamp is the release row's own, from the writer's clock — read back, never restamped.
    const releaseRows = await db
      .select({ taxYear: moneyEntries.taxYear })
      .from(moneyEntries)
      .innerJoin(moneyTransactions, eq(moneyEntries.transactionId, moneyTransactions.id))
      .where(and(eq(moneyTransactions.kind, "hold_release"), eq(moneyEntries.accountId, accountIdFor("user_available", "u_tax"))));
    expect(releaseRows.length).toBeGreaterThan(0);
    for (const row of releaseRows) expect(row.taxYear).toBe(2026);
  });

  it("never counts a confiscated prize in ANY year — it lands on platform_forfeiture, not the member's account", async () => {
    await seedHeldDecemberPrize();

    const confiscated = await confiscateHold(db, { userId: "u_tax", operatorUserId: "u_mate" }, { clock: januaryClock, audit: getAuditLogger(), newId });
    expect(confiscated).toEqual({ ok: true, amountCents: 40_00 });

    expect(await getUserAnnualNetProfit(db, "u_tax", 2025)).toBe(-20_00);
    expect(await getUserAnnualNetProfit(db, "u_tax", 2026)).toBe(0);

    // The destination proof: the member's available account never saw the money.
    expect(await accountBalance(db, accountIdFor("user_available", "u_tax"))).toBe(30_00); // 50_00 deposit − 20_00 fee
    expect(await accountBalance(db, accountIdFor("platform_forfeiture"))).toBe(40_00);
    expect(await accountBalance(db, accountIdFor("held_for_review", "u_tax"))).toBe(0);
  });
});

describe("walletAccountFlags — the KYC status and self-exclusion stamp the wallet panels render (Task 12)", () => {
  it("reads a fresh user's resting state: none, never excluded", async () => {
    await db.insert(users).values({ id: "u_fresh", email: "u_fresh@test.local", displayName: "Fresh" });
    expect(await walletAccountFlags(db, "u_fresh")).toEqual({ kycStatus: "none", selfExcludedAt: null });
  });

  it("reads a verified, self-excluded user's actual stamped columns, never a derived guess", async () => {
    const excludedAt = new Date("2026-06-01T12:00:00.000Z");
    await db.insert(users).values({ id: "u_flagged", email: "u_flagged@test.local", displayName: "Flagged", kycStatus: "verified", selfExcludedAt: excludedAt });
    expect(await walletAccountFlags(db, "u_flagged")).toEqual({ kycStatus: "verified", selfExcludedAt: excludedAt.toISOString() });
  });

  it("throws for a user id with no row — not a reachable state for a signed-in session, but never a silent wrong answer", async () => {
    await expect(walletAccountFlags(db, "u_ghost")).rejects.toThrow(/no user row/);
  });
});
