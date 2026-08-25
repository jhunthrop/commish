import { eq } from "drizzle-orm";
import type { Db, DbTx } from "@/db/client";
import { moneyTransactions, paymentTransferIntents, users } from "@/db/schema";
import { accountIdFor } from "@/money/accounts";
import { MONEY_REFUSALS } from "@/money/config";
import type { MoneyStatesConfig, StateCode } from "@/money/states";
import type { PaymentsProvider, TransferIntent, TransferRef, WithdrawalDestination } from "@/payments-provider/contract";
import type { PaymentsEvent } from "@/payments-provider/ingest";
import { moneyGates, type MoneyGateOutcome } from "./gates";
import { ensureAndLockMoneyAccounts, postMoneyTransaction, type PostDeps, type PostMoneyOutcome } from "./post";

/**
 * The withdrawal lifecycle (Task 6), the deposit machinery (`./deposits.ts`) run in reverse, with
 * two differences that change the shape rather than the discipline:
 *
 * (1) DEBIT AT REQUEST. A deposit posts nothing until the provider's completion callback; a
 * withdrawal posts the moment the member asks, debiting `user_available` and crediting
 * `provider_clearing` in THE SAME REQUEST that validates it — so the money a member asked out can
 * never be spent twice while the transfer is in flight. That posting's own balance floor
 * (`postMoneyTransaction`'s ruling-5 refusal, never a pre-trusted read) is the ONLY amount
 * enforcement this door has, and it runs BEFORE the provider is ever called: an internal
 * reservation is cheap and instantly reversible, a bank pull is neither, so nothing here ever
 * tells the provider to move money the ledger has not already set aside. A provider decline
 * arriving synchronously (right here, in the same request) reverses that reservation immediately
 * — no callback will ever name a transfer that never left initiation, the same reasoning
 * `initiateDeposit` uses for why a declined deposit stores no intent.
 *
 * (2) THE FATE SET. Completion settles `provider_clearing` against `fbo_pool` (the money
 * genuinely left). A provider FAILURE (the credit leg bouncing before it settles) and a bank
 * RETURN (the credit leg bouncing AFTER it settles, R02-class) both end the same way — the money
 * goes back to `user_available` — which is why `AUDIT_EVENT_TYPES` was never grown a fourth
 * `withdrawal_failed` member: a failed withdrawal is money returned, not money lost, so both
 * fates audit as `withdrawal_returned`, told apart by `payload.outcome` ("failed" vs "returned"),
 * the same reuse Phase 3.6 established for `trade_rejected`'s own two outcomes.
 *
 * The webhook route (`src/app/api/payments/webhook`) is the only production caller of the three
 * `record*` writers, handed events already translated by `ingestProviderCallback` — nothing here
 * ever reads provider-shaped JSON.
 */

/** What the withdrawal door needs injected — the provider seam, the posting deps, and the state
 *  list, exactly `DepositDeps`'s shape (`./deposits.ts`). */
export interface WithdrawalDeps extends PostDeps {
  readonly provider: PaymentsProvider;
  readonly states: MoneyStatesConfig;
}

export interface InitiateWithdrawalInput {
  readonly userId: string;
  /** Integer cents, already inside `MONEY_CONFIG.withdrawal`'s bounds (`withdrawalRequestSchema`);
   *  the true ceiling is the member's LOCKED available balance, enforced by the reservation
   *  posting's own balance floor. */
  readonly amountCents: number;
  readonly stateOfEntry: StateCode;
  readonly destination: WithdrawalDestination;
  /** The form's per-submission key (`withdrawalRequestSchema`); namespaced per user below. */
  readonly idempotencyKey: string;
}

/**
 * A refusal is a closed gate or the reservation's own insufficient-balance floor — both answered
 * in the SAME `{ ok: false, status: 403, reason }` shape, so the route needs exactly one branch.
 * Fee and ETA ride every success answer, read from the provider's own `listSupportedMethods()`
 * descriptor for `"bank"` — withdrawals are bank-only, permanently — so the UI renders figures the
 * provider stated and never invents one.
 */
export type InitiateWithdrawalOutcome =
  | {
      readonly ok: true;
      readonly transfer: TransferIntent;
      readonly feeCents: number;
      readonly feePercentBasisPoints: number;
      readonly etaDescription: string;
    }
  | Exclude<MoneyGateOutcome, { ok: true }>
  | { readonly ok: false; readonly status: 403; readonly reason: typeof MONEY_REFUSALS.insufficientBalance };

/**
 * The closed set of operator-facing alarm sentences the callback writers answer instead of
 * posting — the `DEPOSIT_ALARMS` discipline (`./deposits.ts`), one level up: the callback
 * VERIFIED but the book must not move on it.
 */
export const WITHDRAWAL_ALARMS = {
  /** A verified callback names a transfer this product never initiated — same reasoning as
   *  `DEPOSIT_ALARMS.unknownTransferRef`. */
  unknownTransferRef: "No posting made. This callback names a transfer this product never initiated.",
  /** A verified callback contradicts the stored intent. */
  transferDisagreement: "No posting made. This callback disagrees with the transfer it names.",
  /** A return arrived before its withdrawal's completion posted — out-of-order delivery, the one
   *  alarm redelivery genuinely heals (`DEPOSIT_ALARMS.returnBeforeCompletion`'s exact reasoning,
   *  the outbound leg). */
  returnBeforeCompletion: "No posting made. This return arrived before its withdrawal completion has posted.",
  /**
   * A failure arrived for a withdrawal that has already completed — invalid on the seam's own
   * transition graph (a completed transfer's credit leg can only bounce as a RETURN, never a
   * FAILURE; the mock's own `failPendingWithdrawal` refuses this shape at the source). Unlike
   * `returnBeforeCompletion`, redelivery reproduces this verbatim rather than healing it, so it
   * answers 200 at the wall, the same class as `unknownTransferRef`.
   */
  failureAfterCompletion: "No posting made. This failure arrived for a withdrawal that has already completed.",
} as const;
export type WithdrawalAlarmReason = (typeof WITHDRAWAL_ALARMS)[keyof typeof WITHDRAWAL_ALARMS];

export type WithdrawalCompletedOutcome =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly alarm: WithdrawalAlarmReason };

export type WithdrawalFailedOutcome =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly alarm: WithdrawalAlarmReason };

export type WithdrawalReturnedOutcome =
  | { readonly ok: true; readonly replayed: boolean }
  | { readonly ok: false; readonly alarm: WithdrawalAlarmReason };

/** The ledger-side idempotency keys. `requestKey` is client-scoped (namespaced per user) because
 *  it is minted BEFORE any provider ref exists — the reservation posting is what makes the
 *  provider call safe to attempt, not the other way around. The other three are ref-scoped, the
 *  deposit idiom, so a webhook redelivery becomes the same non-event at the book. */
const requestKey = (userId: string, idempotencyKey: string): string => `withdrawal_requested:${userId}:${idempotencyKey}`;
const completionKey = (ref: TransferRef): string => `withdrawal_completed:${ref}`;
const failKey = (ref: TransferRef): string => `withdrawal_failed:${ref}`;
const returnKey = (ref: TransferRef): string => `withdrawal_returned:${ref}`;

/** The three accounts every withdrawal-fate posting can touch, locked in sorted order — the exact
 *  discipline `lockDepositAccounts` lends out (`./deposits.ts`, `ensureAndLockMoneyAccounts`).
 *  Every writer below locks all three uniformly even though any one posting touches only two of
 *  them, the same "lock the whole fate set, post a subset" shape deposits uses. */
async function lockWithdrawalAccounts(tx: DbTx, userId: string) {
  const fboPool = accountIdFor("fbo_pool");
  const providerClearing = accountIdFor("provider_clearing");
  const available = accountIdFor("user_available", userId);
  await ensureAndLockMoneyAccounts(tx, [fboPool, providerClearing, available]);
  return { fboPool, providerClearing, available };
}

/**
 * The shared reversal posting behind BOTH failure paths: a provider decline synchronous with
 * initiation (`initiateWithdrawal`, no callback ever coming) and a provider `withdrawal_failed`
 * callback arriving later (`recordWithdrawalFailed`). Debit `provider_clearing` (the reservation
 * resolves), credit `user_available` (the member has it back) — never a floor risk either side:
 * `provider_clearing` is `NEGATIVE_ALLOWED_KINDS`-exempt and crediting `user_available` only ever
 * grows it.
 */
async function postWithdrawalReversal(
  tx: DbTx,
  args: { readonly userId: string; readonly stateOfEntry: string; readonly amountCents: number; readonly providerTransferRef: TransferRef; readonly idempotencyKey: string },
  deps: PostDeps,
): Promise<PostMoneyOutcome> {
  const { providerClearing, available } = await lockWithdrawalAccounts(tx, args.userId);
  return postMoneyTransaction(
    tx,
    {
      kind: "withdrawal_fail",
      providerTransferRef: args.providerTransferRef,
      idempotencyKey: args.idempotencyKey,
      stateOfEntry: args.stateOfEntry,
      entries: [
        { accountId: providerClearing, direction: "debit", amountCents: args.amountCents },
        { accountId: available, direction: "credit", amountCents: args.amountCents },
      ],
      auditEvent: {
        eventType: "withdrawal_returned",
        actorId: args.userId,
        actorType: "user",
        leagueId: null,
        payload: { outcome: "failed", amountCents: args.amountCents, providerTransferRef: args.providerTransferRef },
      },
    },
    deps,
  );
}

/**
 * The withdrawal door. Gates first (`moneyGates`, door `"withdraw"` — self-exclusion does not
 * apply, see the gates' own docblock), then the reservation posting (the balance floor's answer
 * IS the amount enforcement — never a pre-trusted read), then the provider, mirroring
 * `initiateDeposit`'s shape everywhere else: `ensureAccount`, `initiateWithdrawal` under the
 * namespaced key `withdrawal:<userId>:<formKey>`, an intent row stored for every outcome EXCEPT a
 * decline (which never had and never will have a callback).
 *
 * ORDER, AND WHY: the reservation posts BEFORE the provider is ever called. An internal debit is
 * cheap and instantly reversible; a bank pull is neither. So an insufficient-balance refusal here
 * never reaches the provider at all — the member's balance is checked by attempting to move it,
 * under the SAME row locks a concurrent posting would need, so two requests racing the same
 * balance genuinely serialize rather than both reading a balance that is about to change.
 *
 * A provider decline (typed data, `status: "failed"`, never a thrown string — Seam A's own
 * discipline) arriving in this same call reverses the reservation immediately via
 * `postWithdrawalReversal`, so a declined withdrawal never leaves money stranded in
 * `provider_clearing` waiting for a callback that will never arrive. This is the one place a
 * withdrawal leaves ledger rows behind a refusal-shaped outcome (`ok: true` with a `failed`
 * transfer) — deliberately, because unlike a deposit's decline (which posts nothing, ever), a
 * withdrawal's decline is a reservation ALREADY MADE and then undone, and the undo is itself an
 * audited money motion.
 */
export async function initiateWithdrawal(db: Db, input: InitiateWithdrawalInput, deps: WithdrawalDeps): Promise<InitiateWithdrawalOutcome> {
  const [subject] = await db
    .select({ id: users.id, kycStatus: users.kycStatus, selfExcludedAt: users.selfExcludedAt })
    .from(users)
    .where(eq(users.id, input.userId));
  if (subject === undefined) throw new Error(`initiateWithdrawal: no user row for "${input.userId}".`);

  const gate = await moneyGates(db, subject, input.stateOfEntry, "withdraw", deps.states);
  if (!gate.ok) return gate;

  const bankMethod = deps.provider.listSupportedMethods().find((descriptor) => descriptor.method === "bank");
  if (bankMethod === undefined) {
    throw new Error("initiateWithdrawal: the provider does not support the bank method withdrawals require.");
  }
  const fee = { feeCents: bankMethod.feeCents, feePercentBasisPoints: bankMethod.feePercentBasisPoints, etaDescription: bankMethod.etaDescription };

  const reserved = await db.transaction((tx) =>
    postMoneyTransaction(
      tx,
      {
        kind: "withdrawal_request",
        stateOfEntry: input.stateOfEntry,
        idempotencyKey: requestKey(input.userId, input.idempotencyKey),
        entries: [
          { accountId: accountIdFor("user_available", input.userId), direction: "debit", amountCents: input.amountCents },
          { accountId: accountIdFor("provider_clearing"), direction: "credit", amountCents: input.amountCents },
        ],
        auditEvent: {
          eventType: "withdrawal_requested",
          actorId: input.userId,
          actorType: "user",
          leagueId: null,
          payload: { amountCents: input.amountCents },
        },
      },
      deps,
    ),
  );
  if (!reserved.ok) return { ok: false, status: 403, reason: MONEY_REFUSALS.insufficientBalance };

  await deps.provider.ensureAccount(input.userId);
  const transfer = await deps.provider.initiateWithdrawal({
    userId: input.userId,
    amountCents: input.amountCents,
    destination: input.destination,
    idempotencyKey: `withdrawal:${input.userId}:${input.idempotencyKey}`,
  });

  if (transfer.status === "failed") {
    const reversed = await db.transaction((tx) =>
      postWithdrawalReversal(
        tx,
        { userId: input.userId, stateOfEntry: input.stateOfEntry, amountCents: input.amountCents, providerTransferRef: transfer.ref, idempotencyKey: failKey(transfer.ref) },
        deps,
      ),
    );
    if (!reversed.ok) throw new Error(`initiateWithdrawal: the decline reversal refused: ${reversed.reason}`);
    return { ok: true, transfer, ...fee };
  }

  await db
    .insert(paymentTransferIntents)
    .values({
      providerTransferRef: transfer.ref,
      direction: "withdrawal",
      userId: input.userId,
      amountCents: transfer.amountCents,
      method: null,
      stateOfEntry: input.stateOfEntry,
      idempotencyKey: `withdrawal:${input.userId}:${input.idempotencyKey}`,
      createdAt: new Date(deps.clock.now()),
    })
    .onConflictDoNothing();

  return { ok: true, transfer, ...fee };
}

/** The stored intent for `ref`, verified against the callback that names it — or the alarm.
 *  `verifiedDepositIntent`'s exact shape (`./deposits.ts`), checking `direction === "withdrawal"`. */
async function verifiedWithdrawalIntent(
  db: Db,
  event: PaymentsEvent,
): Promise<{ readonly ok: true; readonly intent: typeof paymentTransferIntents.$inferSelect } | { readonly ok: false; readonly alarm: WithdrawalAlarmReason }> {
  const [intent] = await db.select().from(paymentTransferIntents).where(eq(paymentTransferIntents.providerTransferRef, event.ref));
  if (intent === undefined) return { ok: false, alarm: WITHDRAWAL_ALARMS.unknownTransferRef };
  if (intent.direction !== "withdrawal" || intent.amountCents !== event.amountCents) {
    return { ok: false, alarm: WITHDRAWAL_ALARMS.transferDisagreement };
  }
  return { ok: true, intent };
}

/**
 * The completion event: debit `provider_clearing` (the reservation resolves), credit `fbo_pool`
 * (the money genuinely left the pool), audit `withdrawal_completed`, platform scope.
 */
export async function recordWithdrawalCompleted(db: Db, event: PaymentsEvent, deps: PostDeps): Promise<WithdrawalCompletedOutcome> {
  if (event.type !== "withdrawal_completed") throw new Error(`recordWithdrawalCompleted: wrong event type "${event.type}".`);
  const verified = await verifiedWithdrawalIntent(db, event);
  if (!verified.ok) return verified;
  const { intent } = verified;

  return db.transaction(async (tx): Promise<WithdrawalCompletedOutcome> => {
    const { fboPool, providerClearing } = await lockWithdrawalAccounts(tx, intent.userId);
    const outcome = await postMoneyTransaction(
      tx,
      {
        kind: "withdrawal_complete",
        providerTransferRef: intent.providerTransferRef,
        idempotencyKey: completionKey(intent.providerTransferRef),
        stateOfEntry: intent.stateOfEntry,
        entries: [
          { accountId: providerClearing, direction: "debit", amountCents: event.amountCents },
          { accountId: fboPool, direction: "credit", amountCents: event.amountCents },
        ],
        auditEvent: {
          eventType: "withdrawal_completed",
          actorId: intent.userId,
          actorType: "user",
          leagueId: null,
          payload: { amountCents: event.amountCents, providerTransferRef: intent.providerTransferRef },
        },
      },
      deps,
    );
    if (!outcome.ok) throw new Error(`recordWithdrawalCompleted: the completion posting refused: ${outcome.reason}`);
    return { ok: true, replayed: outcome.replayed };
  });
}

/**
 * The provider failure event (the credit leg bouncing BEFORE it settles): reverses the
 * reservation via `postWithdrawalReversal` — the async twin of `initiateWithdrawal`'s own
 * synchronous decline handling. Guarded against arriving AFTER a completion already posted (the
 * transition graph's own invariant, `WITHDRAWAL_ALARMS.failureAfterCompletion`), checked inside
 * the same transaction before any account lock is taken — `recordDepositReturned`'s exact
 * `returnBeforeCompletion` shape, inverted.
 */
export async function recordWithdrawalFailed(db: Db, event: PaymentsEvent, deps: PostDeps): Promise<WithdrawalFailedOutcome> {
  if (event.type !== "withdrawal_failed") throw new Error(`recordWithdrawalFailed: wrong event type "${event.type}".`);
  const verified = await verifiedWithdrawalIntent(db, event);
  if (!verified.ok) return verified;
  const { intent } = verified;

  return db.transaction(async (tx): Promise<WithdrawalFailedOutcome> => {
    const [completed] = await tx
      .select({ id: moneyTransactions.id })
      .from(moneyTransactions)
      .where(eq(moneyTransactions.idempotencyKey, completionKey(intent.providerTransferRef)));
    if (completed !== undefined) return { ok: false, alarm: WITHDRAWAL_ALARMS.failureAfterCompletion };

    const outcome = await postWithdrawalReversal(
      tx,
      {
        userId: intent.userId,
        stateOfEntry: intent.stateOfEntry,
        amountCents: event.amountCents,
        providerTransferRef: intent.providerTransferRef,
        idempotencyKey: failKey(intent.providerTransferRef),
      },
      deps,
    );
    if (!outcome.ok) throw new Error(`recordWithdrawalFailed: the reversal posting refused: ${outcome.reason}`);
    return { ok: true, replayed: outcome.replayed };
  });
}

/**
 * The withdrawal that comes back (the credit leg bouncing AFTER it settles, R02-class): debit
 * `fbo_pool` (the money genuinely returned to the pool), credit `user_available` (the member has
 * it back, in full — unlike a deposit's return, nothing was ever spent in between: the balance
 * was already reduced at request time and stayed reduced through completion, so there is no
 * shortfall to compute and no receivable to book), audit `withdrawal_returned`. Only a COMPLETED
 * withdrawal can return — checked before any lock, `recordDepositReturned`'s exact shape.
 */
export async function recordWithdrawalReturned(db: Db, event: PaymentsEvent, deps: PostDeps): Promise<WithdrawalReturnedOutcome> {
  if (event.type !== "withdrawal_returned") throw new Error(`recordWithdrawalReturned: wrong event type "${event.type}".`);
  const verified = await verifiedWithdrawalIntent(db, event);
  if (!verified.ok) return verified;
  const { intent } = verified;

  return db.transaction(async (tx): Promise<WithdrawalReturnedOutcome> => {
    const [completed] = await tx
      .select({ id: moneyTransactions.id })
      .from(moneyTransactions)
      .where(eq(moneyTransactions.idempotencyKey, completionKey(intent.providerTransferRef)));
    if (completed === undefined) return { ok: false, alarm: WITHDRAWAL_ALARMS.returnBeforeCompletion };

    const { fboPool, available } = await lockWithdrawalAccounts(tx, intent.userId);
    const outcome = await postMoneyTransaction(
      tx,
      {
        kind: "withdrawal_return",
        providerTransferRef: intent.providerTransferRef,
        idempotencyKey: returnKey(intent.providerTransferRef),
        stateOfEntry: intent.stateOfEntry,
        entries: [
          { accountId: fboPool, direction: "debit", amountCents: event.amountCents },
          { accountId: available, direction: "credit", amountCents: event.amountCents },
        ],
        auditEvent: {
          eventType: "withdrawal_returned",
          actorId: intent.userId,
          actorType: "user",
          leagueId: null,
          payload: { outcome: "returned", amountCents: event.amountCents, providerTransferRef: intent.providerTransferRef },
        },
      },
      deps,
    );
    if (!outcome.ok) throw new Error(`recordWithdrawalReturned: the return posting refused: ${outcome.reason}`);
    return { ok: true, replayed: outcome.replayed };
  });
}
