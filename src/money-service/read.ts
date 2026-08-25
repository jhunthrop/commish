import { and, eq, inArray, sql } from "drizzle-orm";
import type { ReadonlyDb } from "@/db/client";
import { moneyEntries, moneyTransactions } from "@/db/schema";
import { accountIdFor, parseAccountId, signedBalance, type MoneyAccountId } from "@/money/accounts";

/**
 * The money book's read side. Every figure here is a SUM over `money_entries` — NEVER the
 * `money_accounts` rollup, which is a lock target and a backstop, not the record
 * (`postMoneyTransaction`'s docblock, and the rollup-equals-entry-sum test in `read.test.ts`
 * that holds the two to each other). `ReadonlyDb`, so `tsc` enforces that this module cannot
 * write, the same seam the AI advisor uses.
 *
 * All three aggregate through `sum(amount_cents)::float8`: exact for every value below
 * `Number.MAX_SAFE_INTEGER`, which `balancedOrRefuse` already refuses to let a posting cross —
 * an `::int8` cast would arrive as a string from the driver and re-parse on every caller.
 */

/** The four figures the wallet renders (Task 12), each a SUM over `money_entries`. */
export interface WalletSummary {
  readonly availableCents: number;
  readonly escrowCents: number;
  readonly heldCents: number;
  readonly owedCents: number;
}

/**
 * One account's balance derived from its entries, under the vocabulary's own sign convention
 * (`signedBalance`): what the rollup row MUST equal, which is exactly why this function never
 * reads it — reconciliation (Task 4's `reconcileMoney`, and the dedicated test here) compares
 * the two, and a comparison where both sides read the same table proves nothing.
 */
export async function accountBalance(db: ReadonlyDb, accountId: MoneyAccountId): Promise<number> {
  const parsed = parseAccountId(accountId);
  const [row] = await db
    .select({
      debits: sql<number>`coalesce(sum(${moneyEntries.amountCents}) filter (where ${moneyEntries.direction} = 'debit'), 0)::float8`,
      credits: sql<number>`coalesce(sum(${moneyEntries.amountCents}) filter (where ${moneyEntries.direction} = 'credit'), 0)::float8`,
    })
    .from(moneyEntries)
    .where(eq(moneyEntries.accountId, accountId));
  // An ungrouped aggregate always returns exactly one row, even over zero entries.
  return signedBalance(parsed.kind, row!.debits, row!.credits);
}

/**
 * The member's money that currently sits in league escrows: net entry-fee contribution per
 * league (fees debited from their available balance, minus refunds credited back), counted only
 * while the league is UNFINISHED — the wallet's own sentence, "Entry fees for leagues that have
 * not finished". A settled league's escrow closed at exactly zero without per-member refund
 * legs (the pot became prizes and rake), so "finished" is read off the book itself: any
 * `settlement`-kind transaction naming the league. A dissolved league needs no such carve-out —
 * dissolution refunds every seat, and the contribution nets to zero on its own.
 */
async function escrowCentsFor(db: ReadonlyDb, userId: string): Promise<number> {
  const accountId = accountIdFor("user_available", userId);
  const contributions = await db
    .select({
      leagueId: moneyTransactions.leagueId,
      kind: moneyTransactions.kind,
      totalCents: sql<number>`sum(${moneyEntries.amountCents})::float8`,
    })
    .from(moneyEntries)
    .innerJoin(moneyTransactions, eq(moneyEntries.transactionId, moneyTransactions.id))
    .where(and(eq(moneyEntries.accountId, accountId), inArray(moneyTransactions.kind, ["entry_fee", "entry_fee_refund"])))
    .groupBy(moneyTransactions.leagueId, moneyTransactions.kind);

  const leagueIds = [...new Set(contributions.map((row) => row.leagueId))].filter((id): id is string => id !== null);
  if (leagueIds.length === 0) return 0;
  const settledRows = await db
    .select({ leagueId: moneyTransactions.leagueId })
    .from(moneyTransactions)
    .where(and(inArray(moneyTransactions.leagueId, leagueIds), eq(moneyTransactions.kind, "settlement")));
  const settled = new Set(settledRows.map((row) => row.leagueId));

  let total = 0;
  for (const row of contributions) {
    // A fee whose transaction names no league cannot be attributed to any escrow; a settled
    // league's escrow no longer holds anyone's fee.
    if (row.leagueId === null || settled.has(row.leagueId)) continue;
    total += row.kind === "entry_fee" ? row.totalCents : -row.totalCents;
  }
  return total;
}

/** The wallet's four figures (Task 12 renders these verbatim; no surface invents its own sums). */
export async function walletSummary(db: ReadonlyDb, userId: string): Promise<WalletSummary> {
  const [availableCents, heldCents, owedCents, escrowCents] = await Promise.all([
    accountBalance(db, accountIdFor("user_available", userId)),
    accountBalance(db, accountIdFor("held_for_review", userId)),
    accountBalance(db, accountIdFor("platform_receivable", userId)),
    escrowCentsFor(db, userId),
  ]);
  return { availableCents, escrowCents, heldCents, owedCents };
}

/**
 * THE Phase 5 guarantee (founder decision 6): a member's annual net profit for one tax year —
 * prizes credited minus entry fees debited plus refunds credited, the DraftKings/FanDuel
 * annual-net methodology — answerable by index (`money_entries_tax_year_state_idx` plus the
 * account index) with no backfill, because every entry row carries `tax_year` from the day it
 * was written. Phase 5 compares this against
 * `MONEY_CONFIG.reportingThresholdCentsByTaxYear[taxYear]` to answer "who crossed the line";
 * the companion test in `read.test.ts` runs that exact comparison.
 */
export async function getUserAnnualNetProfit(db: ReadonlyDb, userId: string, taxYear: number): Promise<number> {
  const accountId = accountIdFor("user_available", userId);
  const rows = await db
    .select({
      kind: moneyTransactions.kind,
      direction: moneyEntries.direction,
      totalCents: sql<number>`sum(${moneyEntries.amountCents})::float8`,
    })
    .from(moneyEntries)
    .innerJoin(moneyTransactions, eq(moneyEntries.transactionId, moneyTransactions.id))
    .where(
      and(
        eq(moneyEntries.accountId, accountId),
        eq(moneyEntries.taxYear, taxYear),
        inArray(moneyTransactions.kind, ["settlement", "entry_fee", "entry_fee_refund"]),
      ),
    )
    .groupBy(moneyTransactions.kind, moneyEntries.direction);

  let net = 0;
  for (const row of rows) {
    if (row.kind === "settlement" && row.direction === "credit") net += row.totalCents;
    else if (row.kind === "entry_fee" && row.direction === "debit") net -= row.totalCents;
    else if (row.kind === "entry_fee_refund" && row.direction === "credit") net += row.totalCents;
    // Any other leg on this account (a settlement-kind debit moving a payout to review) is
    // neither a prize, a fee nor a refund, and the methodology ignores it.
  }
  return net;
}
