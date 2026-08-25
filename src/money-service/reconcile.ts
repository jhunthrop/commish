import type { ReadonlyDb } from "@/db/client";
import { moneyAccounts } from "@/db/schema";
import { accountIdFor, accountSide, type MoneyAccountKind } from "@/money/accounts";
import { formatUsd, MONEY_CONFIG } from "@/money/config";
import type { PaymentsProvider } from "@/payments-provider/contract";
import { accountBalance } from "./read";

/**
 * Reconciliation and the Phase 5 guarantee, proven (Task 11): the one place the ledger's own
 * self-consistency and its agreement with the outside world are BOTH answered as data, not
 * trusted. Level-triggered by design — every figure below is derived from the CURRENT database
 * state on every call, and this module stores nothing between calls (no "last reconciled"
 * timestamp, no cached report): a script (`scripts/money-reconcile.ts`) and an admin-room refresh
 * button (`@/admin-room/components/reconcile-drift-panel`) are the only two callers, per ruling
 * 12 — no scheduler, because the founder-gated bucket has said "no production scheduler" for
 * three phases running.
 *
 * `reconcileMoney` answers FOUR checks, each its own typed figures — never collapsed into a
 * single boolean, so a caller (the script's exit code, the panel's copy) derives "clean" from the
 * actual numbers rather than trusting a flag this module decided:
 *
 *  1. THE BANK CHECK: the ledger's own `fbo_pool` entry-sum (`accountBalance`, never the rollup —
 *     `read.ts`'s own "entries are the truth" discipline) against `PaymentsProvider
 *     .getPooledBalanceCents()` — the one figure that answers "does the money we THINK is in the
 *     bank match what the bank says is there." `MONEY_CONFIG.reconcileToleranceCents` (zero) is
 *     the alarm threshold; this is also exactly the surface T5's webhook translator built for —
 *     `DEPOSIT_ALARMS.unknownTransferRef`/`transferDisagreement` are cases where a verified
 *     callback could not be posted (`src/money-service/deposits.ts`'s own docblocks), so the
 *     provider's real balance and the ledger's posted balance can only be brought back into
 *     agreement by THIS check surfacing the drift for an operator to investigate.
 *  2. THE DOUBLE-ENTRY LAW: assets minus liabilities, summed straight off the `money_accounts`
 *     rollup (never re-derived from entries, which would only prove `balancedOrRefuse` held per
 *     transaction — a tautology). Every balanced posting leaves this at exactly zero
 *     (`ledgerBalanceFigures`'s own docblock proves the arithmetic); a nonzero answer means the
 *     mutable rollup itself has drifted from the law it exists to track.
 *  3. THE FLOOR, RE-PROVEN: no `user_available` rollup has gone negative. The database's own
 *     `money_accounts_balance_floor_ck` (migration 0035) already makes this UNREACHABLE through
 *     any write this product issues — this is the same invariant proven again at the application
 *     layer, the backstop's own backstop, exactly the "prove it twice, once at each layer" shape
 *     the balance floor itself already follows (`postMoneyTransaction`'s refusal, then the CHECK).
 *  4. ESCROW-BY-LEAGUE CONSISTENCY: every `league_escrow` account's rollup against its OWN
 *     independently-computed entry-sum (`escrowRollupMismatches`) — the same "rollup is a
 *     backstop, entries are the truth" proof `read.test.ts` runs for every account kind, scoped
 *     here to escrow specifically because it is the account holding money "in flight," the one an
 *     operator most needs to trust between a league's entry-fee collection and its settlement or
 *     refund.
 */

/** One row of `money_accounts`, exactly what the checks below need — never the whole
 *  `$inferSelect` row, so the pure helpers stay decoupled from the schema's own column set. */
export interface MoneyAccountRow {
  readonly id: string;
  readonly kind: MoneyAccountKind;
  readonly ownerId: string | null;
  readonly balanceCents: number;
}

export interface NegativeAvailableAccount {
  readonly accountId: string;
  readonly balanceCents: number;
}

export interface EscrowMismatch {
  readonly accountId: string;
  readonly leagueId: string | null;
  readonly rollupCents: number;
  readonly entrySumCents: number;
}

export interface LedgerBalanceFigures {
  readonly assetsCents: number;
  readonly liabilitiesCents: number;
}

/**
 * Check 2, pure: sums every rollup row by which side of the accounting equation its kind sits on
 * (`accountSide`). Every balanced transaction (`balancedOrRefuse`) contributes its debit total to
 * `assetsCents` xor `liabilitiesCents` depending on which kind each leg landed on, and its credit
 * total to the other — a debit on an asset account (money arriving) and a credit on a liability
 * account (a claim growing) both raise the SAME side of this equation, and a balanced posting's
 * debits equal its credits, so `assetsCents` and `liabilitiesCents` move together, transaction by
 * transaction, and a healthy ledger's two totals are ALWAYS equal. Exported and unit-tested
 * directly against fabricated rows (never DB corruption) precisely because a real ledger can never
 * produce the unequal case on its own — the same reason `balancedOrRefuse` is tested with
 * hand-built inputs rather than through a writer.
 */
export function ledgerBalanceFigures(rows: readonly MoneyAccountRow[]): LedgerBalanceFigures {
  let assetsCents = 0;
  let liabilitiesCents = 0;
  for (const row of rows) {
    if (accountSide(row.kind) === "asset") assetsCents += row.balanceCents;
    else liabilitiesCents += row.balanceCents;
  }
  return { assetsCents, liabilitiesCents };
}

/**
 * Check 3, pure: every `user_available` rollup below zero. `money_accounts_balance_floor_ck`
 * (migration 0035) makes the non-empty answer UNREACHABLE through any real database write — no
 * test here injects one through Postgres, because none can; this function is unit-tested directly
 * against a fabricated negative row instead, the honest way to exercise an app-layer proof of an
 * invariant the database also enforces (`postMoneyTransaction`'s own refusal is the same shape,
 * proven twice, once per layer).
 */
export function negativeUserAvailableAccounts(rows: readonly MoneyAccountRow[]): readonly NegativeAvailableAccount[] {
  return rows
    .filter((row) => row.kind === "user_available" && row.balanceCents < 0)
    .map((row) => ({ accountId: row.id, balanceCents: row.balanceCents }));
}

/**
 * Check 4, pure: every `league_escrow` row whose rollup disagrees with `entrySumsByAccountId`'s
 * independently-computed entry-sum for that same account (`reconcileMoney` builds the map via
 * `accountBalance`, one real query per escrow account). A rollup with no entry in the map reads as
 * zero, matching `accountBalance`'s own "no entries at all" answer for an account that somehow has
 * a rollup row but no entries — not a real production shape, but the honest default rather than a
 * thrown `Map.get` surprise.
 */
export function escrowRollupMismatches(
  rows: readonly MoneyAccountRow[],
  entrySumsByAccountId: ReadonlyMap<string, number>,
): readonly EscrowMismatch[] {
  const mismatches: EscrowMismatch[] = [];
  for (const row of rows) {
    if (row.kind !== "league_escrow") continue;
    const entrySumCents = entrySumsByAccountId.get(row.id) ?? 0;
    if (entrySumCents !== row.balanceCents) {
      mismatches.push({ accountId: row.id, leagueId: row.ownerId, rollupCents: row.balanceCents, entrySumCents });
    }
  }
  return mismatches;
}

/**
 * The whole answer, as data. `drift` is check 1 (the bank check); `ledgerBalanceDriftCents` is
 * check 2, restated as one signed number (`assetsCents - liabilitiesCents`) for the same reason
 * `drift` is; `negativeUserAvailable` and `escrowMismatches` are checks 3 and 4, each a list that
 * is empty exactly when the ledger is clean on that check. Nothing here is a boolean: a caller
 * decides "clean" by reading these numbers and lists, never by trusting a flag this module
 * computed on its behalf (`moneyDriftFindings` below is that one shared decision, so the script
 * and the panel can never disagree about what counts as a finding).
 */
export interface MoneyDriftReport {
  readonly ledgerFboPoolCents: number;
  readonly providerPooledBalanceCents: number;
  /** `ledgerFboPoolCents - providerPooledBalanceCents`, integer cents. Zero means agreement. */
  readonly drift: number;
  readonly assetsCents: number;
  readonly liabilitiesCents: number;
  /** `assetsCents - liabilitiesCents`. A healthy ledger is always exactly zero. */
  readonly ledgerBalanceDriftCents: number;
  readonly negativeUserAvailable: readonly NegativeAvailableAccount[];
  readonly escrowMismatches: readonly EscrowMismatch[];
}

/**
 * The one entry point (Task 11's own name, `reconcileMoney(db, provider)`): fetches the rollup
 * table once, the pool figures in parallel with it, computes each escrow account's real entry-sum
 * (one `accountBalance` call per escrow account — a level-triggered health read, never a hot
 * path, so N real queries over N open escrows costs nothing a script or an admin's own click
 * cannot afford), and assembles the report from the pure checks above. No transaction, no lock —
 * `ReadonlyDb` (`select` only) is the whole dependency, the same seam `read.ts` already proves a
 * reconciliation needs to read from a table it must never write to.
 */
export async function reconcileMoney(db: ReadonlyDb, provider: PaymentsProvider): Promise<MoneyDriftReport> {
  const [ledgerFboPoolCents, providerPooledBalanceCents, rows] = await Promise.all([
    accountBalance(db, accountIdFor("fbo_pool")),
    provider.getPooledBalanceCents(),
    db
      .select({ id: moneyAccounts.id, kind: moneyAccounts.kind, ownerId: moneyAccounts.ownerId, balanceCents: moneyAccounts.balanceCents })
      .from(moneyAccounts),
  ]);

  const escrowRows = rows.filter((row) => row.kind === "league_escrow");
  const escrowEntrySums = await Promise.all(escrowRows.map((row) => accountBalance(db, row.id)));
  const entrySumsByAccountId = new Map(escrowRows.map((row, index) => [row.id, escrowEntrySums[index]!]));

  const { assetsCents, liabilitiesCents } = ledgerBalanceFigures(rows);

  return {
    ledgerFboPoolCents,
    providerPooledBalanceCents,
    drift: ledgerFboPoolCents - providerPooledBalanceCents,
    assetsCents,
    liabilitiesCents,
    ledgerBalanceDriftCents: assetsCents - liabilitiesCents,
    negativeUserAvailable: negativeUserAvailableAccounts(rows),
    escrowMismatches: escrowRollupMismatches(rows, entrySumsByAccountId),
  };
}

/** One named alarm, money-first: what and how much, never why — attribution is the operator's
 *  job (`docs/conventions.md`'s copy rulebook, restated for the operator console the same way the
 *  player-facing deposit-failure sentence states it). */
export interface MoneyDriftFinding {
  readonly code: "bank_drift" | "ledger_balance_drift" | "negative_user_available" | "escrow_mismatch";
  readonly message: string;
}

/**
 * The ONE place a `MoneyDriftReport` becomes named alarms — shared by `scripts/money-reconcile.ts`
 * (the exit-code decision) and `ReconcileDriftPanel` (the admin copy), so the two can never
 * disagree about what counts as drift. An empty array is the whole definition of "clean"; nothing
 * here is more collapsed than that.
 */
export function moneyDriftFindings(report: MoneyDriftReport): readonly MoneyDriftFinding[] {
  const findings: MoneyDriftFinding[] = [];

  if (Math.abs(report.drift) > MONEY_CONFIG.reconcileToleranceCents) {
    findings.push({
      code: "bank_drift",
      message: `The ledger's pooled balance disagrees with the bank by ${formatUsd(Math.abs(report.drift))}.`,
    });
  }
  if (report.ledgerBalanceDriftCents !== 0) {
    findings.push({
      code: "ledger_balance_drift",
      message: `The ledger's assets and liabilities disagree by ${formatUsd(Math.abs(report.ledgerBalanceDriftCents))}.`,
    });
  }
  for (const account of report.negativeUserAvailable) {
    findings.push({
      code: "negative_user_available",
      message: `${account.accountId} carries a negative balance of ${formatUsd(Math.abs(account.balanceCents))}.`,
    });
  }
  for (const mismatch of report.escrowMismatches) {
    const leagueName = mismatch.leagueId ?? mismatch.accountId;
    findings.push({
      code: "escrow_mismatch",
      message: `League ${leagueName}'s escrow disagrees with its own entries by ${formatUsd(Math.abs(mismatch.rollupCents - mismatch.entrySumCents))}.`,
    });
  }

  return findings;
}
