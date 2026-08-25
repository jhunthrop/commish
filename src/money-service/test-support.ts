import { asc } from "drizzle-orm";
import { expect } from "vitest";
import type { Db } from "@/db/client";
import { moneyAccounts, moneyEntries, moneyTransactions, paymentTransferIntents } from "@/db/schema";
import { accountIdFor } from "@/money/accounts";
import { postMoneyTransaction, type MoneyTransactionInput, type PostDeps, type PostMoneyOutcome } from "./post";

/**
 * Shared test support for the money book, the same helper-class idiom the plan requires of every
 * money writer's refusal paths (`expectNoPostingTookPlace` here, `expectNoSettlementTookPlace`
 * and `expectNoDissolutionTookPlace` beside their writers in Tasks 9-10): a refusal is only a
 * refusal if the database can prove nothing landed, asserted over the WHOLE book rather than
 * trusted from one table — the shape `expectNoSeatReleaseTookPlace`
 * (`src/league-service/release.test.ts`) established.
 */

export interface MoneyBookSnapshot {
  readonly transactions: readonly (typeof moneyTransactions.$inferSelect)[];
  readonly entries: readonly (typeof moneyEntries.$inferSelect)[];
  readonly accounts: readonly (typeof moneyAccounts.$inferSelect)[];
}

/** Every row of all three money tables, in a deterministic order, for before/after comparison. */
export async function snapshotMoneyBook(db: Db): Promise<MoneyBookSnapshot> {
  return {
    transactions: await db.select().from(moneyTransactions).orderBy(asc(moneyTransactions.id)),
    entries: await db.select().from(moneyEntries).orderBy(asc(moneyEntries.id)),
    accounts: await db.select().from(moneyAccounts).orderBy(asc(moneyAccounts.id)),
  };
}

const EMPTY_BOOK: MoneyBookSnapshot = { transactions: [], entries: [], accounts: [] };

/**
 * Proves a refused (or failed) posting left the book of record untouched: no transaction row, no
 * entry row, and no balance moved — against `before` when the test seeded earlier postings, or
 * against an empty book when it did not.
 *
 * A zero-balance `money_accounts` row MAY appear that `before` never held, deliberately:
 * `postMoneyTransaction` ensures its rollup lock targets exist BEFORE it can decide a refusal
 * (the sufficient-balance answer needs the locked row), and a caller that commits its
 * transaction around the refusal commits those empty rows with it. A lock target holding zero
 * is not a posting — the record is `money_entries`, and this helper holds THAT to emptiness
 * exactly.
 */
export async function expectNoPostingTookPlace(db: Db, before: MoneyBookSnapshot = EMPTY_BOOK): Promise<void> {
  const after = await snapshotMoneyBook(db);
  expect(after.transactions).toEqual(before.transactions);
  expect(after.entries).toEqual(before.entries);
  for (const account of after.accounts) {
    const prior = before.accounts.find((row) => row.id === account.id);
    expect({ id: account.id, balanceCents: account.balanceCents }).toEqual({ id: account.id, balanceCents: prior?.balanceCents ?? 0 });
  }
}

/** `MoneyBookSnapshot` plus the deposit door's own side table — see `expectNoDepositTookPlace`. */
export interface DepositBookSnapshot extends MoneyBookSnapshot {
  readonly intents: readonly (typeof paymentTransferIntents.$inferSelect)[];
}

/** `snapshotMoneyBook` plus `payment_transfer_intents`, for before/after comparison at the
 *  deposit door. */
export async function snapshotDepositBook(db: Db): Promise<DepositBookSnapshot> {
  return {
    ...(await snapshotMoneyBook(db)),
    intents: await db.select().from(paymentTransferIntents).orderBy(asc(paymentTransferIntents.providerTransferRef)),
  };
}

/**
 * The deposit door's own refusal proof (Task 5's TDD requirement): a refused initiation left the
 * book untouched AND stored no intent — because an intent row with no gate behind it would be a
 * deposit the platform later completes for a member the gates refused. Composes
 * `expectNoPostingTookPlace` for the book half.
 */
export async function expectNoDepositTookPlace(db: Db, before?: DepositBookSnapshot): Promise<void> {
  await expectNoPostingTookPlace(db, before);
  const intents = await db.select().from(paymentTransferIntents).orderBy(asc(paymentTransferIntents.providerTransferRef));
  expect(intents).toEqual(before?.intents ?? []);
}

/**
 * The property harness the plan's balanced-books test names: one of every internal posting shape
 * this phase will produce — deposits, entry fees into two leagues, a refund, a settlement with
 * rake, and the ACH return with ruling 5's shortfall to `platform_receivable` — every one of
 * them through the real `postMoneyTransaction`. The hand-computed end state, for tests that
 * assert figures:
 *
 *   u1 available 96_00 (100 in, 2×20 fees out, 36 prize in) · u2 available 0 (60 in, 20 fee,
 *   20 refund back, 60 returned with a 20_00 shortfall) · league_escrow:lg_open 20_00 ·
 *   league_escrow:lg_done 0 (settled) · platform_rake 4_00 · platform_receivable:u2 20_00 ·
 *   fbo_pool 100_00. Assets 120_00 = liabilities 120_00.
 */
export async function runSeededPostingSequence(db: Db, deps: PostDeps): Promise<void> {
  const post = async (input: MoneyTransactionInput): Promise<PostMoneyOutcome> =>
    db.transaction((tx) => postMoneyTransaction(tx, input, deps));

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

  await post(deposit("u1", 100_00, "NJ"));
  await post(deposit("u2", 60_00, "TN"));
  await post(fee("u1", "lg_open", 20_00, "NJ"));
  await post(fee("u2", "lg_open", 20_00, "TN"));
  await post(fee("u1", "lg_done", 20_00, "NJ"));
  await post(fee("u2", "lg_done", 20_00, "TN"));
  await post({
    kind: "entry_fee_refund",
    leagueId: "lg_open",
    stateOfEntry: "TN",
    entries: [
      { accountId: accountIdFor("league_escrow", "lg_open"), direction: "debit", amountCents: 20_00 },
      { accountId: accountIdFor("user_available", "u2"), direction: "credit", amountCents: 20_00 },
    ],
    auditEvent: { eventType: "entry_fee_refunded", actorId: "u2", actorType: "user", leagueId: "lg_open", payload: { amountCents: 20_00 } },
  });
  // lg_done settles: the pot pays u1 a 36_00 prize and the platform its fixed 4_00 rake
  // (founder decision 10), closing the escrow at exactly zero.
  await post({
    kind: "settlement",
    leagueId: "lg_done",
    stateOfEntry: "NJ",
    entries: [
      { accountId: accountIdFor("league_escrow", "lg_done"), direction: "debit", amountCents: 40_00 },
      { accountId: accountIdFor("user_available", "u1"), direction: "credit", amountCents: 36_00 },
      { accountId: accountIdFor("platform_rake"), direction: "credit", amountCents: 4_00 },
    ],
    auditEvent: { eventType: "prize_paid", actorId: null, actorType: "system", leagueId: "lg_done", payload: { winnerUserId: "u1", amountCents: 36_00 } },
  });
  // u2's deposit comes back (ruling 5's failure model): the pool refunds the bank the full
  // 60_00, the available balance covers 40_00 of it, and the 20_00 shortfall books to
  // `platform_receivable:u2` — never a negative member balance.
  await post({
    kind: "deposit_return",
    stateOfEntry: "TN",
    providerTransferRef: "transfer_u2_return",
    entries: [
      { accountId: accountIdFor("fbo_pool"), direction: "credit", amountCents: 60_00 },
      { accountId: accountIdFor("user_available", "u2"), direction: "debit", amountCents: 40_00 },
      { accountId: accountIdFor("platform_receivable", "u2"), direction: "debit", amountCents: 20_00 },
    ],
    auditEvent: { eventType: "deposit_returned", actorId: "u2", actorType: "user", leagueId: null, payload: { amountCents: 60_00, shortfallCents: 20_00 } },
  });
}
