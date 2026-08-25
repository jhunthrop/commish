import type { DbTx } from "@/db/client";
import type { MoneyTxnKind } from "@/db/schema";
import type { AuditEventInput } from "@/domain/audit";
import type { Clock } from "@/domain/timing";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import type { MoneyAccountId } from "@/money/accounts";
import type { MoneyPostingDirection } from "@/money/posting";

/**
 * One leg of a money transaction, as the writer receives it. Structurally a `MoneyPosting`
 * (`@/money/posting`) plus the one per-leg override decision 6 requires: settlement (Task 10)
 * pays winners who attested different states, so a single transaction can carry legs in several
 * states while every other writer stamps the whole set from `MoneyTransactionInput.stateOfEntry`.
 */
export interface MoneyEntryInput {
  readonly accountId: MoneyAccountId;
  readonly direction: MoneyPostingDirection;
  readonly amountCents: number;
  /** Overrides `MoneyTransactionInput.stateOfEntry` for THIS leg only (decision 6). */
  readonly stateOfEntry?: string;
}

export interface MoneyTransactionInput {
  readonly kind: MoneyTxnKind;
  /**
   * The league this money motion belongs to, when it has one (entry fee, refund, dissolution,
   * settlement) — and the row this writer locks FIRST, per the global lock law. `null`/absent
   * for the league-less external motions (deposits, withdrawals, receivable recovery).
   */
  readonly leagueId?: string | null;
  /** The provider's own reference for an external transfer (Seam A); never a join key. */
  readonly providerTransferRef?: string | null;
  /**
   * The replay backstop: a provider webhook redelivering a settled transfer, or a
   * double-submitted deposit, carries the same key and becomes the SAME transaction rather than
   * a second one. `null`/absent for internal postings, which are serialized by their row locks.
   */
  readonly idempotencyKey?: string | null;
  /** Decision 6: stamped on every leg (each leg may override — see `MoneyEntryInput`). */
  readonly stateOfEntry: string;
  readonly entries: readonly MoneyEntryInput[];
  /**
   * The audit record of this money motion, appended in the SAME transaction, anchor LAST
   * (rulings 3 and 4). `occurredAt` is stamped by the writer from its own clock, so the audit
   * row, `taxYear` and `createdAt` can never disagree about when the money moved.
   */
  readonly auditEvent: Omit<AuditEventInput, "occurredAt">;
}

export interface PostDeps {
  readonly audit: AuditLogger;
  readonly clock: Clock;
  readonly newId: () => string;
}

export type PostMoneyOutcome =
  | {
      readonly ok: true;
      readonly transactionId: string;
      /** True when this call found the idempotency key already committed and wrote nothing. */
      readonly replayed: boolean;
    }
  | { readonly ok: false; readonly reason: string };

export async function postMoneyTransaction(_tx: DbTx, _input: MoneyTransactionInput, _deps: PostDeps): Promise<PostMoneyOutcome> {
  throw new Error("Task 3 Step 2 implements postMoneyTransaction.");
}
