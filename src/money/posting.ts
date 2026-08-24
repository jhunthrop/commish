import { MONEY_REFUSALS } from "./config";
import type { MoneyAccountId } from "./accounts";

export type MoneyPostingDirection = "debit" | "credit";

/** One leg of a double-entry transaction — a debit or a credit against one account, for one
 *  whole-cent amount. A money writer (`src/money-service/**`, a later task) always posts a SET of
 *  these inside one Postgres transaction, never a single leg alone. */
export interface MoneyPosting {
  readonly accountId: MoneyAccountId;
  readonly direction: MoneyPostingDirection;
  readonly amountCents: number;
}

export type BalancedOrRefuseResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * The one gate every money writer calls before it ever opens a Postgres transaction: a posting
 * set is only ever committed if its debits sum to exactly its credits (double-entry's own
 * invariant) and every individual amount is a positive whole number of cents. Refuses BEFORE any
 * write is attempted — this is what makes `expectNoPostingTookPlace` provable at the pure-vocabulary
 * layer, not just at the Postgres layer.
 *
 * Per-posting validity is checked before the balance sum for a reason: a single zero-amount
 * posting with nothing to offset it sums to itself on both sides trivially (0 debits = 0 credits)
 * and would otherwise slip past a balance-only check.
 *
 * Every `posting.amountCents` is checked against `Number.isSafeInteger`, and so are the
 * `totalDebits`/`totalCredits` sums this function computes from them: two individually safe
 * amounts can still sum past `Number.MAX_SAFE_INTEGER` and lose exact-cent precision, which a
 * double-entry ledger can never tolerate.
 */
export function balancedOrRefuse(postings: readonly MoneyPosting[]): BalancedOrRefuseResult {
  if (postings.length === 0) {
    return { ok: false, reason: MONEY_REFUSALS.emptyPostingSet };
  }
  for (const posting of postings) {
    if (!Number.isInteger(posting.amountCents) || posting.amountCents <= 0) {
      return { ok: false, reason: MONEY_REFUSALS.invalidAmount };
    }
    if (!Number.isSafeInteger(posting.amountCents)) {
      return { ok: false, reason: MONEY_REFUSALS.amountOverflow };
    }
  }
  const totalDebits = sumWhere(postings, "debit");
  const totalCredits = sumWhere(postings, "credit");
  if (!Number.isSafeInteger(totalDebits) || !Number.isSafeInteger(totalCredits)) {
    return { ok: false, reason: MONEY_REFUSALS.amountOverflow };
  }
  if (totalDebits !== totalCredits) {
    return { ok: false, reason: MONEY_REFUSALS.unbalanced };
  }
  return { ok: true };
}

function sumWhere(postings: readonly MoneyPosting[], direction: MoneyPostingDirection): number {
  return postings
    .filter((posting) => posting.direction === direction)
    .reduce((sum, posting) => sum + posting.amountCents, 0);
}
