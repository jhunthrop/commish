import { and, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import type { DbTx } from "@research-ts/db/client";
import { moneyEntries, moneyTransactions } from "@/db/schema";
import { createTestDb } from "@research-ts/db/test-db";
import { truncateAll, truncateMoneyTables } from "@/db/test-db";
import type { Clock } from "@research-ts/domain/timing";
import { getAuditLogger } from "@/integrity-service/audit-logger";
import { accountIdFor } from "@/money/accounts";
import { MONEY_CONFIG } from "@/money/config";
import { postMoneyTransaction, type MoneyTransactionInput, type PostDeps } from "./post";
import { getUserAnnualNetProfit } from "./read";

/**
 * THE PHASE 5 CONTRACT, proven against the real writer rather than trusted from a docblock.
 * `docs/research/2026-08-24-phase4-payments-research.md`'s "Assumed Phase 4 interface" section
 * names three facts Phase 5 builds directly on top of, additively, with no backfill:
 *
 *   1. Per-user annual net profit is answerable and comparable against the VERSIONED reporting
 *      threshold (`MONEY_CONFIG.reportingThresholdCentsByTaxYear`) — the 1099 "who crossed the
 *      line" question.
 *   2. Money is aggregable PER STATE over `state_of_entry` — the per-state gaming-revenue
 *      question a state privilege tax needs answered.
 *   3. `tax_year` is stamped on every entry row the day it is written, never backfilled or
 *      recomputed later.
 *
 * This file seeds one multi-user, multi-state, two-tax-year season through the real
 * `postMoneyTransaction` and asserts all three, by name, against concrete numbers — so a change
 * that breaks any of them (a dropped column, a query Phase 5 could no longer write, a threshold
 * that stops being read from config) fails a NAMED test here first, not a hope stated in a
 * research doc nobody re-reads once Phase 5 starts.
 */

const db = createTestDb();

let nextId = 0;
const newId = () => `phase5_${(nextId += 1)}`;
const clock2025: Clock = { now: () => "2025-12-31T23:59:00.000Z" };
const clock2026: Clock = { now: () => "2026-09-01T00:00:00.000Z" };
const deps2025: PostDeps = { audit: getAuditLogger(), clock: clock2025, newId };
const deps2026: PostDeps = { audit: getAuditLogger(), clock: clock2026, newId };

const post = (input: MoneyTransactionInput, postDeps: PostDeps) => db.transaction((tx: DbTx) => postMoneyTransaction(tx, input, postDeps));

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

/**
 * A two-season, three-state, two-tax-year book:
 *
 *  2025 (threshold $600.00) — `lgA`, two NJ/TN seats, $20.00 each, NJ winner u1:
 *    u1 nets $16.00 (below threshold); u2 nets -$20.00 (a loss is never "crossed").
 *  2026 (threshold $2,000.00) — `lg_big`, a $2,500.00 NJ entry fee funding an NY-attested prize:
 *    u_payer nets -$2,500.00 (never crosses, a negative net cannot); u3 nets $2,100.00 (crosses).
 */
async function seedTwoStateSeasons(): Promise<void> {
  await post(deposit("u1", 100_00, "NJ"), deps2025);
  await post(deposit("u2", 80_00, "TN"), deps2025);
  await post(fee("u1", "lgA", 20_00, "NJ"), deps2025);
  await post(fee("u2", "lgA", 20_00, "TN"), deps2025);
  await post(
    {
      kind: "settlement",
      leagueId: "lgA",
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("league_escrow", "lgA"), direction: "debit", amountCents: 40_00 },
        { accountId: accountIdFor("user_available", "u1"), direction: "credit", amountCents: 36_00 },
        { accountId: accountIdFor("platform_rake"), direction: "credit", amountCents: 4_00 },
      ],
      auditEvent: { eventType: "prize_paid", actorId: null, actorType: "system", leagueId: "lgA", payload: { winnerUserId: "u1" } },
    },
    deps2025,
  );

  await post(deposit("u_payer", 30_000_00, "NJ"), deps2026);
  await post(fee("u_payer", "lg_big", 25_00_00, "NJ"), deps2026);
  await post(
    {
      kind: "settlement",
      leagueId: "lg_big",
      // The transaction-level default (decision 6): every leg except the one below stamps NJ,
      // the payer's own attested state.
      stateOfEntry: "NJ",
      entries: [
        { accountId: accountIdFor("league_escrow", "lg_big"), direction: "debit", amountCents: 25_00_00 },
        // The per-leg override (decision 6): the WINNER's own attested state, NY, distinct from
        // the transaction's default — exactly the case a per-state aggregation must key off the
        // ENTRY's own `stateOfEntry`, never the transaction's.
        { accountId: accountIdFor("user_available", "u3"), direction: "credit", amountCents: 21_00_00, stateOfEntry: "NY" },
        { accountId: accountIdFor("platform_rake"), direction: "credit", amountCents: 4_00_00 },
      ],
      auditEvent: { eventType: "prize_paid", actorId: null, actorType: "system", leagueId: "lg_big", payload: { winnerUserId: "u3" } },
    },
    deps2026,
  );
}

beforeEach(async () => {
  await truncateAll(db);
  await truncateMoneyTables(db);
  await seedTwoStateSeasons();
});

describe("Phase 5 fact 1 — per-user annual net profit against the versioned threshold", () => {
  it("answers the exact annual net for every user, in the tax year it belongs to", async () => {
    expect(await getUserAnnualNetProfit(db, "u1", 2025)).toBe(16_00);
    expect(await getUserAnnualNetProfit(db, "u2", 2025)).toBe(-20_00);
    expect(await getUserAnnualNetProfit(db, "u_payer", 2026)).toBe(-25_00_00);
    expect(await getUserAnnualNetProfit(db, "u3", 2026)).toBe(21_00_00);
  });

  it("answers who crossed the reporting line, reading the threshold from config, not a literal", async () => {
    const threshold2025 = MONEY_CONFIG.reportingThresholdCentsByTaxYear[2025];
    const threshold2026 = MONEY_CONFIG.reportingThresholdCentsByTaxYear[2026];

    const crossed2025: string[] = [];
    for (const userId of ["u1", "u2"]) {
      if ((await getUserAnnualNetProfit(db, userId, 2025)) >= threshold2025) crossed2025.push(userId);
    }
    expect(crossed2025).toEqual([]);

    const crossed2026: string[] = [];
    for (const userId of ["u_payer", "u3"]) {
      if ((await getUserAnnualNetProfit(db, userId, 2026)) >= threshold2026) crossed2026.push(userId);
    }
    expect(crossed2026).toEqual(["u3"]);
  });
});

describe("Phase 5 fact 2 — per-state aggregation over state_of_entry", () => {
  it("aggregates entry fees collected by state and tax year, exactly", async () => {
    const rows = await db
      .select({
        taxYear: moneyEntries.taxYear,
        state: moneyEntries.stateOfEntry,
        totalCents: sql<number>`sum(${moneyEntries.amountCents})::float8`,
      })
      .from(moneyEntries)
      .innerJoin(moneyTransactions, eq(moneyEntries.transactionId, moneyTransactions.id))
      .where(and(eq(moneyTransactions.kind, "entry_fee"), eq(moneyEntries.direction, "debit")))
      .groupBy(moneyEntries.taxYear, moneyEntries.stateOfEntry)
      .orderBy(moneyEntries.taxYear, moneyEntries.stateOfEntry);

    expect(rows).toEqual([
      { taxYear: 2025, state: "NJ", totalCents: 20_00 },
      { taxYear: 2025, state: "TN", totalCents: 20_00 },
      { taxYear: 2026, state: "NJ", totalCents: 25_00_00 },
    ]);
  });

  it("aggregates prizes paid by the state the WINNER attested, distinct from the payer's own fee state", async () => {
    // lg_big's fee posted under NJ (u_payer's attestation) but its prize leg carries NY
    // (u3's) — decision 6's per-leg override, and the reason a per-state aggregation cannot
    // simply read the transaction's own `stateOfEntry` for every leg.
    const [row] = await db
      .select({ totalCents: sql<number>`sum(${moneyEntries.amountCents})::float8` })
      .from(moneyEntries)
      .innerJoin(moneyTransactions, eq(moneyEntries.transactionId, moneyTransactions.id))
      .where(
        and(
          eq(moneyTransactions.kind, "settlement"),
          eq(moneyEntries.direction, "credit"),
          eq(moneyEntries.stateOfEntry, "NY"),
          eq(moneyEntries.taxYear, 2026),
        ),
      );
    expect(row?.totalCents).toBe(21_00_00);
  });
});

describe("Phase 5 fact 3 — tax_year stored on every row, from the write, never backfilled", () => {
  it("stamps every entry with a non-null tax year matching the clock that wrote it", async () => {
    const rows = await db.select({ taxYear: moneyEntries.taxYear, createdAt: moneyEntries.createdAt }).from(moneyEntries);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.taxYear).not.toBeNull();
      expect(row.taxYear).toBe(row.createdAt.getUTCFullYear());
    }
    expect(new Set(rows.map((row) => row.taxYear))).toEqual(new Set([2025, 2026]));
  });
});
