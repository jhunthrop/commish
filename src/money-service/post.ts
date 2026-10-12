import { eq } from "drizzle-orm";
import type { DbTx } from "@research-ts/db/client";
import { isUniqueViolation } from "@research-ts/db/errors";
import { leagues, moneyAccounts, moneyEntries, moneyTransactions, type MoneyTxnKind } from "@/db/schema";
import type { AuditEventInput } from "@/domain/audit";
import type { Clock } from "@research-ts/domain/timing";
import type { AuditLogger } from "@/integrity-service/audit-logger";
import { parseAccountId, signedBalance, type MoneyAccountId, type MoneyAccountKind } from "@/money/accounts";
import { MONEY_REFUSALS } from "@/money/config";
import { balancedOrRefuse, type MoneyPostingDirection } from "@/money/posting";

/** The unique index that backstops "the same money motion posted twice" — see `schema.ts`. */
const IDEMPOTENCY_UNIQUE_INDEX = "money_transactions_idempotency_key_idx";

/**
 * The kinds the balance floor exempts, mirroring `money_accounts_balance_floor_ck`
 * (`src/db/schema.ts`, migration 0035): the pool an already-spent deposit reverses out of, the
 * clearing account mid-flight, and the receivable that CARRIES an ACH-return shortfall. Every
 * other kind is a player-facing (or platform-facing) claim that must never read below zero —
 * plan ruling 5: the writer refuses, never clamps, and the database CHECK is the backstop for
 * the day this list and that CHECK ever disagree.
 */
const NEGATIVE_ALLOWED_KINDS: readonly MoneyAccountKind[] = ["fbo_pool", "provider_clearing", "platform_receivable"];

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

/**
 * The already-committed transaction holding `idempotencyKey`, as the outcome the original call
 * answered — or `undefined` when no such transaction has committed yet. One query, written once,
 * because the pre-check and the unique-violation recovery below must read the identical fact.
 */
async function replayOutcome(tx: DbTx, idempotencyKey: string): Promise<PostMoneyOutcome | undefined> {
  const [prior] = await tx
    .select({ id: moneyTransactions.id })
    .from(moneyTransactions)
    .where(eq(moneyTransactions.idempotencyKey, idempotencyKey));
  return prior === undefined ? undefined : { ok: true, transactionId: prior.id, replayed: true };
}

/**
 * Ensures one rollup row exists and locks it for the rest of the caller's transaction —
 * `lockAnchor`'s exact auto-provisioning shape (`@/integrity-service/audit-logger`): the
 * `INSERT … ON CONFLICT DO NOTHING` lets two writers race to create the same new account, exactly
 * one row survives, and the `SELECT … FOR UPDATE` that follows is what serializes them onto it. A
 * row lock and never `pg_advisory_lock`, because this connection reaches Postgres through
 * PgBouncer in transaction pooling mode, where session state does not survive a statement
 * boundary.
 */
async function ensureAndLockAccount(tx: DbTx, accountId: MoneyAccountId): Promise<{ kind: MoneyAccountKind; balanceCents: number }> {
  const parsed = parseAccountId(accountId);
  await tx.insert(moneyAccounts).values({ id: accountId, kind: parsed.kind, ownerId: parsed.ownerId }).onConflictDoNothing();
  const [row] = await tx
    .select({ kind: moneyAccounts.kind, balanceCents: moneyAccounts.balanceCents })
    .from(moneyAccounts)
    .where(eq(moneyAccounts.id, accountId))
    .for("update");
  // Unreachable through Postgres: the insert above either created the row or found it committed.
  if (row === undefined) throw new Error(`Money account "${accountId}" vanished between insert and lock.`);
  return row;
}

/**
 * Sorted-order lock acquisition over any set of money accounts, exported for the writers that
 * must DECIDE a posting's shape from balances no concurrent transaction can move — the ACH-return
 * clawback split and the receivable-settlement split (`./deposits.ts`), each of which reads a
 * balance and then posts against it. Deciding from an unlocked read would race every concurrent
 * posting; taking the locks in any order but this one could deadlock against
 * `postMoneyTransaction` itself. So the ONE writer owns the discipline and lends it out:
 * deduplicate, sort lexicographically, `ensureAndLockAccount` each — exactly the acquisition
 * order `postMoneyTransaction` uses below, which makes a caller's pre-lock a pure prefix of the
 * posting's own (every re-lock inside the posting finds the row already held by this same
 * transaction). The returned map's iteration order is the sorted lock order.
 */
export async function ensureAndLockMoneyAccounts(
  tx: DbTx,
  accountIds: readonly MoneyAccountId[],
): Promise<Map<MoneyAccountId, { kind: MoneyAccountKind; balanceCents: number }>> {
  const locked = new Map<MoneyAccountId, { kind: MoneyAccountKind; balanceCents: number }>();
  for (const accountId of [...new Set(accountIds)].sort()) {
    locked.set(accountId, await ensureAndLockAccount(tx, accountId));
  }
  return locked;
}

/** How this posting moves ONE account's rollup, under the vocabulary's own sign convention. */
function deltaFor(kind: MoneyAccountKind, accountId: MoneyAccountId, entries: readonly MoneyEntryInput[]): number {
  let debits = 0;
  let credits = 0;
  for (const entry of entries) {
    if (entry.accountId !== accountId) continue;
    if (entry.direction === "debit") debits += entry.amountCents;
    else credits += entry.amountCents;
  }
  return signedBalance(kind, debits, credits);
}

/**
 * THE ONE WRITER of `money_entries` and `money_transactions`. Every deposit, fee, refund, payout
 * and reversal in the product goes through this function inside the caller's transaction, or it
 * does not happen — the writers of Tasks 5-10 decide WHAT to post; this function owns how a
 * posting becomes rows without deadlocks, drift, or an unaudited hole.
 *
 * WHAT IT GUARANTEES, in order:
 *  1. `balancedOrRefuse` gates the set BEFORE any statement runs — an unbalanced or malformed
 *     set refuses with zero writes (`expectNoPostingTookPlace`-provable, `./test-support`).
 *  2. The rollup (`money_accounts.balance_cents`) advances in the SAME transaction as the
 *     entries it summarizes, under row locks taken in sorted order (below).
 *  3. No player-facing balance goes below zero: the sufficient-balance answer is decided while
 *     the rollup lock is held, refused (never clamped) with zero writes; only
 *     `NEGATIVE_ALLOWED_KINDS` may swing negative (ruling 5's ACH-return model).
 *  4. A replayed `idempotencyKey` — the double-click and the webhook redelivery — returns the
 *     already-committed transaction's outcome as the same non-event, at three layers: a cheap
 *     pre-lock read answers the long-committed case; a post-lock RE-CHECK answers the duplicate
 *     that committed while this transaction was blocked on a shared rollup row, BEFORE the
 *     balance floor can re-evaluate the duplicate's own debit against the post-commit balance
 *     (fix round 1); and the unique index catches the disjoint-row race that neither read can
 *     see (the violation is caught via `isUniqueViolation` under a savepoint so the caller's
 *     transaction survives it).
 *  5. Decision 6: EVERY entry row is stamped `state_of_entry` (from the input, per-leg
 *     overridable) and `tax_year` (from the injected clock, stored — never recomputed later).
 *  6. Ruling 4: `deps.audit.record` appends in the SAME transaction; an append failure throws
 *     and rolls back the whole money write. No catch, no best-effort.
 *
 * LOCK ORDER, ENUMERATED (rulings 3 + the global lock law; foreign keys named per the Plan C
 * lesson — an INSERT's parent-row locks are invisible at the call site). In statement order this
 * function takes:
 *  - `leagues[input.leagueId] FOR UPDATE`, FIRST, as its own statement, whenever the posting
 *    names a league — the global lock law verbatim. A caller already holding it (Task 8's
 *    `collectEntryFeeInTx` inside `joinLeagueInTx`) re-locks its own row at no cost; a
 *    standalone money transaction acquires it here before any money row. The row may be absent
 *    (money history survives league deletion — `money_transactions.league_id` carries NO
 *    foreign key), in which case nothing is locked and the posting proceeds.
 *  - `money_accounts[id] FOR UPDATE` for every account the set touches, in SORTED account-id
 *    order (deduplicated, lexicographic) — the deterministic total order that makes two
 *    transactions touching the same pair of rollups queue instead of cycle, whatever order
 *    their inputs named the accounts. Each lock is preceded by that row's own
 *    `INSERT … ON CONFLICT DO NOTHING` (`ensureAndLockAccount`), which references no other
 *    table and therefore takes no FK lock.
 *  - `money_transactions` INSERT: `league_id` and `provider_transfer_ref` carry no foreign
 *    key — this statement locks nothing beyond its own new row.
 *  - `money_entries` INSERT: implicit `FOR KEY SHARE` on `money_transactions[transactionId]` (a
 *    row THIS transaction just created — a re-lock of its own insert, no new edge) and on every
 *    referenced `money_accounts` row (each already held `FOR UPDATE` by this transaction — a
 *    re-lock, no new edge).
 *  - `money_accounts` UPDATEs: the rows already held above.
 *  - The audit chain anchor, LAST, through `deps.audit.record` — after every FK-taking write of
 *    this function's own, exactly as every other audited writer orders it. Nothing here runs
 *    after the anchor.
 * Driven on two real connections in `src/integrity-service/lock-order.test.ts`
 * ("postMoneyTransaction's lock order").
 */
export async function postMoneyTransaction(tx: DbTx, input: MoneyTransactionInput, deps: PostDeps): Promise<PostMoneyOutcome> {
  const balanced = balancedOrRefuse(input.entries);
  if (!balanced.ok) return balanced;

  // The global lock law: the leagues row, FIRST, as its own statement (see the docblock).
  if (input.leagueId != null) {
    await tx.select({ id: leagues.id }).from(leagues).where(eq(leagues.id, input.leagueId)).for("update");
  }

  // The committed-replay FAST PATH, deliberately ahead of the leagues lock and every money row
  // lock: the ordinary replay (a webhook redelivering a transfer settled minutes ago, a
  // double-click answered after the first commit) is answered from one indexed read without
  // this transaction taking a single lock the original no longer holds. Correctness does not
  // rest here — the post-lock re-check below is the load-bearing half.
  if (input.idempotencyKey != null) {
    const replay = await replayOutcome(tx, input.idempotencyKey);
    if (replay !== undefined) return replay;
  }

  const lockedAccounts = await ensureAndLockMoneyAccounts(
    tx,
    input.entries.map((entry) => entry.accountId),
  );
  const accountIds = [...lockedAccounts.keys()];

  // The post-lock replay RE-CHECK (fix round 1, CRITICAL), between the locks and the balance
  // floor: a duplicate that shared a rollup row committed while this transaction was BLOCKED on
  // that row's lock above, and its delta is already in the balances just read. Evaluating the
  // floor first would re-apply the same debit against the post-commit balance and hand a
  // webhook redelivery a spurious insufficientBalance refusal — the exact non-event the
  // idempotency mechanism exists to prevent. Answered here, the just-committed duplicate is a
  // replay BEFORE its delta is ever evaluated a second time. (A duplicate sharing NO rollup row
  // never serializes here and is caught by the unique index below instead.)
  if (input.idempotencyKey != null) {
    const replay = await replayOutcome(tx, input.idempotencyKey);
    if (replay !== undefined) return replay;
  }

  const nextBalances = new Map<MoneyAccountId, number>();
  for (const accountId of accountIds) {
    const account = lockedAccounts.get(accountId)!;
    const next = account.balanceCents + deltaFor(account.kind, accountId, input.entries);
    if (next < 0 && !NEGATIVE_ALLOWED_KINDS.includes(account.kind)) {
      return { ok: false, reason: MONEY_REFUSALS.insufficientBalance };
    }
    nextBalances.set(accountId, next);
  }

  const occurredAt = deps.clock.now();
  const taxYear = new Date(occurredAt).getUTCFullYear();
  const transactionId = deps.newId();
  try {
    // A savepoint (drizzle's nested transaction) around the one statement that can collide on
    // the idempotency index: without it, the unique violation would poison the CALLER's whole
    // transaction (25P02) and the recovery read below could never run.
    await tx.transaction(async (insertPoint) => {
      await insertPoint.insert(moneyTransactions).values({
        id: transactionId,
        kind: input.kind,
        leagueId: input.leagueId ?? null,
        providerTransferRef: input.providerTransferRef ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdAt: new Date(occurredAt),
      });
    });
  } catch (error: unknown) {
    // The mid-flight race: a concurrent posting with the same key committed first, and this
    // insert waited on the index and then violated. Read the winner back and answer as the
    // same non-event. Any OTHER violation (a colliding id mint) is a bug and surfaces.
    if (input.idempotencyKey != null && isUniqueViolation(error, IDEMPOTENCY_UNIQUE_INDEX)) {
      const replay = await replayOutcome(tx, input.idempotencyKey);
      if (replay !== undefined) return replay;
    }
    throw error;
  }

  await tx.insert(moneyEntries).values(
    input.entries.map((entry) => ({
      id: deps.newId(),
      transactionId,
      accountId: entry.accountId,
      direction: entry.direction,
      amountCents: entry.amountCents,
      stateOfEntry: entry.stateOfEntry ?? input.stateOfEntry,
      taxYear,
      createdAt: new Date(occurredAt),
    })),
  );

  for (const accountId of accountIds) {
    await tx.update(moneyAccounts).set({ balanceCents: nextBalances.get(accountId)! }).where(eq(moneyAccounts.id, accountId));
  }

  // Ruling 4, anchor last: commits with the rows above, or nothing commits.
  await deps.audit.record(tx, { ...input.auditEvent, occurredAt });
  return { ok: true, transactionId, replayed: false };
}
