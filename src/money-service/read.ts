import type { ReadonlyDb } from "@/db/client";
import type { MoneyAccountId } from "@/money/accounts";

/** The four figures the wallet renders (Task 12), each a SUM over `money_entries`. */
export interface WalletSummary {
  readonly availableCents: number;
  readonly escrowCents: number;
  readonly heldCents: number;
  readonly owedCents: number;
}

export async function accountBalance(_db: ReadonlyDb, _accountId: MoneyAccountId): Promise<number> {
  throw new Error("Task 3 Step 3 implements accountBalance.");
}

export async function walletSummary(_db: ReadonlyDb, _userId: string): Promise<WalletSummary> {
  throw new Error("Task 3 Step 3 implements walletSummary.");
}

export async function getUserAnnualNetProfit(_db: ReadonlyDb, _userId: string, _taxYear: number): Promise<number> {
  throw new Error("Task 3 Step 3 implements getUserAnnualNetProfit.");
}
