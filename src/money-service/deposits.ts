import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { moneyTransactions, paymentTransferIntents, users } from "@/db/schema";
import { accountIdFor, type MoneyAccountId } from "@/money/accounts";
import type { MoneyStatesConfig, StateCode } from "@/money/states";
import type { DepositMethod, PaymentsProvider, TransferIntent, TransferRef } from "@/payments-provider/contract";
import type { PaymentsEvent } from "@/payments-provider/ingest";
import { moneyGates, type MoneyGateOutcome } from "./gates";
import { ensureAndLockMoneyAccounts, postMoneyTransaction, type MoneyEntryInput, type PostDeps } from "./post";

/**
 * The deposit lifecycle (Task 5 Step 3), in three writers around one law: NO LEDGER ROWS UNTIL
 * THE COMPLETION EVENT. Pending money is the bank's, not the book's — initiation stores only an
 * intent (`payment_transfer_intents`, the attribution a provider callback cannot carry itself),
 * the completion callback posts the `deposit`, and the ACH return that can follow DAYS later
 * (NACHA R01/R10, the failure model this whole phase exists to survive) posts the clawback with
 * ruling 5's shortfall to `platform_receivable` — never a negative member balance.
 *
 * The webhook route (`src/app/api/payments/webhook`) is the only production caller of the two
 * `record*` writers, and it hands them events already translated by `ingestProviderCallback` —
 * nothing here ever reads provider-shaped JSON.
 */

/** What the deposit door needs injected — the provider seam, the posting deps (`PostDeps`: the
 *  audit logger, clock and id mint), and the state list (`MONEY_STATES` in production; tests
 *  prove the enabled path with a test-only entry). */
export interface DepositDeps extends PostDeps {
  readonly provider: PaymentsProvider;
  readonly states: MoneyStatesConfig;
}

export interface InitiateDepositInput {
  readonly userId: string;
  /** Integer cents, already inside `MONEY_CONFIG.deposit` bounds (`depositRequestSchema`). */
  readonly amountCents: number;
  readonly stateOfEntry: StateCode;
  readonly method: DepositMethod;
  /** The form's per-submission key (`depositRequestSchema`); namespaced per user below. */
  readonly idempotencyKey: string;
}

/**
 * A refusal is a closed gate (`moneyGates`); a DECLINE is `ok: true` with a `failed` transfer —
 * typed data the deposit form renders, exactly as Seam A models it, never an exception.
 */
export type InitiateDepositOutcome = { readonly ok: true; readonly transfer: TransferIntent } | Exclude<MoneyGateOutcome, { ok: true }>;

/**
 * The closed set of operator-facing alarm sentences the callback writers answer instead of
 * posting — the `INGEST_REFUSALS` discipline, one level up: the callback VERIFIED (the signature
 * was real) but the book must not move on it. The webhook route logs each with full context and
 * chooses its status per the sentence's own docblock; none of these is player copy.
 */
export const DEPOSIT_ALARMS = {
  /**
   * A verified callback names a transfer this product never initiated. Redelivery can never fix
   * it (no intent will appear), so the route answers 200 and the discrepancy is Task 11's
   * reconcile sweep to surface — the ledger-vs-bank drift check is the surface built for it.
   */
  unknownTransferRef: "No posting made. This callback names a transfer this product never initiated.",
  /**
   * The disagreement class (the same fact the mock states by THROWING on a replayed initiation
   * key that disagrees with its transfer): a verified callback contradicts the stored intent —
   * wrong amount, or an event for the wrong direction. Redelivery reproduces the contradiction
   * verbatim, so the route logs with full context, answers 200 so the provider never retries
   * into the same alarm, and Task 11's reconciliation owns the follow-up.
   */
  transferDisagreement: "No posting made. This callback disagrees with the transfer it names.",
  /**
   * A return arrived before its deposit's completion posted — out-of-order delivery, the ONE
   * alarm redelivery genuinely heals (the completion callback is being retried too, and once it
   * posts, the redelivered return finds its deposit). The route answers 503 for this one alone.
   */
  returnBeforeCompletion: "No posting made. This return arrived before its deposit completion has posted.",
} as const;
export type DepositAlarmReason = (typeof DEPOSIT_ALARMS)[keyof typeof DEPOSIT_ALARMS];

export type DepositCompletedOutcome =
  | { readonly ok: true; readonly replayed: boolean; readonly settledOwedCents: number }
  | { readonly ok: false; readonly alarm: DepositAlarmReason };

export type DepositReturnedOutcome =
  /** `shortfallCents` is 0 on a replay — the original posting's own rows carry the truth. */
  | { readonly ok: true; readonly replayed: boolean; readonly shortfallCents: number }
  | { readonly ok: false; readonly alarm: DepositAlarmReason };

/** The ledger-side idempotency keys, derived from the provider's ref so a webhook redelivery
 *  becomes the same non-event at the book (`postMoneyTransaction`'s three layers). */
const completionKey = (ref: TransferRef): string => `deposit_completed:${ref}`;
const returnKey = (ref: TransferRef): string => `deposit_returned:${ref}`;

/**
 * The deposit door. Gates first (`moneyGates`, door `"deposit"` — the receivable check
 * deliberately does not apply, see the gates' own docblock), then the provider, then the intent
 * row; NO ledger rows (the module docblock's law), which `expectNoDepositTookPlace` proves for
 * every refusal path.
 *
 * The provider key is namespaced `deposit:<userId>:<formKey>`, so one user's replayed form
 * resolves to the SAME transfer (Seam A's replay law) while no user can collide with another's
 * key. A replayed key that DISAGREES with its transfer (same key, edited amount — a client bug)
 * makes the provider throw by contract; that throw is deliberately not caught here, because it
 * is a bug's alarm, not a business outcome: the route's error boundary logs it and answers 500.
 */
export async function initiateDeposit(db: Db, input: InitiateDepositInput, deps: DepositDeps): Promise<InitiateDepositOutcome> {
  const [subject] = await db
    .select({ id: users.id, kycStatus: users.kycStatus, selfExcludedAt: users.selfExcludedAt })
    .from(users)
    .where(eq(users.id, input.userId));
  if (subject === undefined) throw new Error(`initiateDeposit: no user row for "${input.userId}".`);

  const gate = await moneyGates(db, subject, input.stateOfEntry, "deposit", deps.states);
  if (!gate.ok) return gate;

  await deps.provider.ensureAccount(input.userId);
  const transfer = await deps.provider.initiateDeposit({
    userId: input.userId,
    amountCents: input.amountCents,
    method: input.method,
    idempotencyKey: `deposit:${input.userId}:${input.idempotencyKey}`,
  });

  // A decline never had and never will have a callback, so it needs no attribution row. Every
  // other outcome gets the intent stored — `ON CONFLICT DO NOTHING` on the ref, because a
  // replayed initiation answers the SAME transfer and the row is already there.
  if (transfer.status !== "failed") {
    await db
      .insert(paymentTransferIntents)
      .values({
        providerTransferRef: transfer.ref,
        direction: "deposit",
        userId: input.userId,
        amountCents: transfer.amountCents,
        method: input.method,
        stateOfEntry: input.stateOfEntry,
        idempotencyKey: `deposit:${input.userId}:${input.idempotencyKey}`,
        createdAt: new Date(deps.clock.now()),
      })
      .onConflictDoNothing();
  }
  return { ok: true, transfer };
}

/** The stored intent for `ref`, verified against the callback that names it — or the alarm. */
async function verifiedDepositIntent(
  db: Db,
  event: PaymentsEvent,
): Promise<{ readonly ok: true; readonly intent: typeof paymentTransferIntents.$inferSelect } | { readonly ok: false; readonly alarm: DepositAlarmReason }> {
  const [intent] = await db.select().from(paymentTransferIntents).where(eq(paymentTransferIntents.providerTransferRef, event.ref));
  if (intent === undefined) return { ok: false, alarm: DEPOSIT_ALARMS.unknownTransferRef };
  if (intent.direction !== "deposit" || intent.amountCents !== event.amountCents) {
    return { ok: false, alarm: DEPOSIT_ALARMS.transferDisagreement };
  }
  return { ok: true, intent };
}

/** The three accounts every deposit-fate posting can touch, locked in sorted order (post.ts's
 *  own discipline, lent out via `ensureAndLockMoneyAccounts`) so the split decisions below are
 *  made from balances no concurrent posting can move. */
async function lockDepositAccounts(tx: DbTx, userId: string) {
  const fboPool = accountIdFor("fbo_pool");
  const available = accountIdFor("user_available", userId);
  const receivable = accountIdFor("platform_receivable", userId);
  const locked = await ensureAndLockMoneyAccounts(tx, [fboPool, available, receivable]);
  const balanceOf = (id: MoneyAccountId): number => locked.get(id)!.balanceCents;
  return { fboPool, available, receivable, balanceOf };
}

/**
 * The completion event becomes the book's `deposit` (Step 3): debit `fbo_pool`, credit
 * `user_available:<id>`, audit `deposit_completed`, platform scope — the first ledger rows of
 * the transfer's life. If the member OWES from an earlier return (plan invariant 5: "their next
 * deposit clears the receivable first"), a second posting settles it in the SAME database
 * transaction: kind `receivable_settlement`, debit `user_available` for `min(owed, amount)`,
 * credit `platform_receivable` — so the deposit lands whole (one `deposit_completed` audit event
 * for every completed deposit, always) and the debt is cleared before the commit that makes any
 * of it spendable. Atomicity is what delivers the brief's "first": no interleaving can spend the
 * remainder before the settlement, because both postings commit together or not at all.
 *
 * A webhook redelivery replays at the `deposit` posting's idempotency key and returns WITHOUT
 * re-evaluating the settlement — otherwise a stale redelivery arriving after a LATER return
 * could settle that newer debt from money the original delivery already credited and spent.
 */
export async function recordDepositCompleted(db: Db, event: PaymentsEvent, deps: PostDeps): Promise<DepositCompletedOutcome> {
  if (event.type !== "deposit_completed") throw new Error(`recordDepositCompleted: wrong event type "${event.type}".`);
  const verified = await verifiedDepositIntent(db, event);
  if (!verified.ok) return verified;
  const { intent } = verified;

  return db.transaction(async (tx): Promise<DepositCompletedOutcome> => {
    const { fboPool, available, receivable, balanceOf } = await lockDepositAccounts(tx, intent.userId);

    const deposit = await postMoneyTransaction(
      tx,
      {
        kind: "deposit",
        providerTransferRef: intent.providerTransferRef,
        idempotencyKey: completionKey(intent.providerTransferRef),
        stateOfEntry: intent.stateOfEntry,
        entries: [
          { accountId: fboPool, direction: "debit", amountCents: event.amountCents },
          { accountId: available, direction: "credit", amountCents: event.amountCents },
        ],
        auditEvent: {
          eventType: "deposit_completed",
          actorId: intent.userId,
          actorType: "user",
          leagueId: null,
          payload: { amountCents: event.amountCents, providerTransferRef: intent.providerTransferRef },
        },
      },
      deps,
    );
    if (!deposit.ok) throw new Error(`recordDepositCompleted: the deposit posting refused: ${deposit.reason}`);
    if (deposit.replayed) return { ok: true, replayed: true, settledOwedCents: 0 };

    // The balances were read under locks taken BEFORE the deposit posted, and the posting above
    // does not touch the receivable — so this is the owed figure as of this commit, immovable.
    const owedCents = balanceOf(receivable);
    const settledOwedCents = Math.min(owedCents, event.amountCents);
    if (settledOwedCents > 0) {
      const settlement = await postMoneyTransaction(
        tx,
        {
          kind: "receivable_settlement",
          providerTransferRef: intent.providerTransferRef,
          idempotencyKey: `${completionKey(intent.providerTransferRef)}:receivable`,
          stateOfEntry: intent.stateOfEntry,
          entries: [
            { accountId: available, direction: "debit", amountCents: settledOwedCents },
            { accountId: receivable, direction: "credit", amountCents: settledOwedCents },
          ],
          // `system_action` with a payload outcome, the Phase 3.6 precedent for happenings inside
          // the frozen event list: the platform collecting its own receivable is not the member's
          // deposit (that event just landed above) and not one of the ten money events.
          auditEvent: {
            eventType: "system_action",
            actorId: null,
            actorType: "system",
            leagueId: null,
            payload: {
              outcome: "receivable_settlement",
              userId: intent.userId,
              amountCents: settledOwedCents,
              providerTransferRef: intent.providerTransferRef,
            },
          },
        },
        deps,
      );
      if (!settlement.ok) throw new Error(`recordDepositCompleted: the receivable settlement refused: ${settlement.reason}`);
    }
    return { ok: true, replayed: false, settledOwedCents };
  });
}

/**
 * The deposit that comes back (Step 3, ruling 5): credit `fbo_pool` the full returned amount
 * (the bank took it back whole), debit `user_available` UP TO its balance, and book any
 * shortfall — money the member already spent — as a debit to `platform_receivable:<id>`,
 * audited `deposit_returned` with the shortfall in the payload. Never a negative member
 * balance: the split is DECIDED under the same sorted row locks the posting itself takes
 * (`lockDepositAccounts`), so a fee collected while this writer waited is already in the
 * balance it divides — the lock-order suite drives exactly that race.
 */
export async function recordDepositReturned(db: Db, event: PaymentsEvent, deps: PostDeps): Promise<DepositReturnedOutcome> {
  if (event.type !== "deposit_returned") throw new Error(`recordDepositReturned: wrong event type "${event.type}".`);
  const verified = await verifiedDepositIntent(db, event);
  if (!verified.ok) return verified;
  const { intent } = verified;

  return db.transaction(async (tx): Promise<DepositReturnedOutcome> => {
    // Out-of-order delivery: only a COMPLETED deposit can return (the seam's transition graph),
    // and completion is a fact the book itself records. Checked before any lock is taken.
    const [completed] = await tx
      .select({ id: moneyTransactions.id })
      .from(moneyTransactions)
      .where(eq(moneyTransactions.idempotencyKey, completionKey(intent.providerTransferRef)));
    if (completed === undefined) return { ok: false as const, alarm: DEPOSIT_ALARMS.returnBeforeCompletion };

    const { fboPool, available, receivable, balanceOf } = await lockDepositAccounts(tx, intent.userId);
    const clawbackCents = Math.min(balanceOf(available), event.amountCents);
    const shortfallCents = event.amountCents - clawbackCents;
    const entries: MoneyEntryInput[] = [
      { accountId: fboPool, direction: "credit", amountCents: event.amountCents },
      ...(clawbackCents > 0 ? [{ accountId: available, direction: "debit", amountCents: clawbackCents } as const] : []),
      ...(shortfallCents > 0 ? [{ accountId: receivable, direction: "debit", amountCents: shortfallCents } as const] : []),
    ];
    const outcome = await postMoneyTransaction(
      tx,
      {
        kind: "deposit_return",
        providerTransferRef: intent.providerTransferRef,
        idempotencyKey: returnKey(intent.providerTransferRef),
        stateOfEntry: intent.stateOfEntry,
        entries,
        auditEvent: {
          eventType: "deposit_returned",
          actorId: intent.userId,
          actorType: "user",
          leagueId: null,
          payload: { amountCents: event.amountCents, shortfallCents, providerTransferRef: intent.providerTransferRef },
        },
      },
      deps,
    );
    if (!outcome.ok) throw new Error(`recordDepositReturned: the return posting refused: ${outcome.reason}`);
    return { ok: true, replayed: outcome.replayed, shortfallCents: outcome.replayed ? 0 : shortfallCents };
  });
}
