import type { Clock } from "@research-ts/domain/timing";
import type {
  DepositInput,
  MethodDescriptor,
  PaymentsProvider,
  TransferIntent,
  TransferRef,
  TransferStatus,
  WithdrawalInput,
} from "../contract";
import type { PaymentsEvent, RawProviderCallback } from "../ingest";
import { signProviderCallback } from "../ingest";

/**
 * The mock rail: an in-memory transfer book on an injected `Clock`, moving no money and hitting
 * no network — the implementation the registry selects by default, and the first implementation
 * the contract suite (`../contract-suite.ts`) holds to the seam's rules. Its whole job is to be
 * adversarial on the transitions real rails are worst at: pending transfers settle only when
 * time is advanced, declines are typed data, and a transfer that COMPLETED can still be
 * RETURNED by the bank days later (the NACHA R01/R10 class), with a signed callback queued for
 * the ingestion point exactly as a real provider's webhook would deliver one.
 */

/**
 * The mock's own tunables, exported so its tests and the wallet UI's fixtures read the same
 * numbers this file behaves by — never re-typed literals.
 */
export const MOCK_PAYMENTS_CONFIG = {
  /**
   * The amount sentinel: any initiation of EXACTLY this many cents is declined, the way test
   * rails reserve magic amounts for forced failures. $13.13 sits below every real floor a form
   * would send and reads as deliberately unlucky.
   */
  declineAmountCents: 13_13,
  /** The typed reason a sentinel-declined transfer carries. */
  declineReason: "The bank declined this transfer.",
  /**
   * Fee and ETA per method. `bank` is genuinely free (pay-by-bank is free to the player under
   * EITHER answer to the founder's fee question). `card` carries the MODELED gaming-MCC fee —
   * 3.25% + $0.30, the plan's Task 14 numbers, a model and not a shipped price — so the wallet
   * UI renders real figures whichever way the founder decides.
   */
  methods: {
    bank: { feeCents: 0, feePercentBasisPoints: 0, etaDescription: "1-3 business days" },
    card: { feeCents: 30, feePercentBasisPoints: 325, etaDescription: "Within minutes" },
  },
  /**
   * Whether `listSupportedMethods` SURFACES the card fee model or reports zeros (the fee eaten).
   * Ships false — founder question, Task 14: no player sees a number the founder has not
   * priced. The `MockPaymentsOptions` override exists so both branches stay tested either way.
   */
  surfaceCardFee: false,
} as const;

export interface MockPaymentsOptions {
  /** Overrides `MOCK_PAYMENTS_CONFIG.surfaceCardFee`. See its docblock. */
  readonly surfaceCardFee?: boolean;
}

/**
 * The mock's control surface, over and above the seam itself: what a harness (the contract
 * suite's, Task 5's webhook tests') uses to play the OUTSIDE WORLD — settlement time passing,
 * a bank declining, a bank returning settled money. Product code only ever sees
 * `PaymentsProvider`; these extra methods exist for tests, the same split as the stats mock's
 * options.
 */
export interface MockPaymentsProvider extends PaymentsProvider {
  /** Settlement time passes: every pending transfer settles (completes, or fails if injected). */
  advance(): void;
  /**
   * The bank returns a transfer that already COMPLETED (R01 insufficient funds, R10
   * unauthorized, R02 closed account on the outbound leg): status flips to `returned`, the
   * pooled balance gives the money back, and a signed callback is queued. Refuses (throws) for
   * a transfer that is not `completed` — a return of unsettled money is a harness bug, not a
   * scenario.
   */
  triggerReturn(ref: TransferRef): void;
  /** The next initiation (deposit or withdrawal) is declined with `reason`, typed, then the tap closes. */
  failNextInitiation(reason: string): void;
  /**
   * A PENDING withdrawal fails asynchronously (the credit leg bounces before settling) and
   * queues a `withdrawal_failed` callback. Withdrawals only: a deposit that goes bad after
   * initiation is modeled as a RETURN, which is why `PAYMENTS_EVENT_TYPES` has no
   * `deposit_failed` member.
   */
  failPendingWithdrawal(ref: TransferRef, reason: string): void;
  /**
   * Every signed callback queued since the last drain, oldest first, exactly as the wire would
   * deliver them — bodies signed with `signProviderCallback`, ready for
   * `ingestProviderCallback`. Draining clears the queue.
   */
  drainCallbacks(): readonly RawProviderCallback[];
}

/** One transfer as the mock's book records it. Replaced whole on every transition, never mutated. */
interface TransferRecord {
  readonly ref: TransferRef;
  readonly direction: "deposit" | "withdrawal";
  readonly userId: string;
  readonly amountCents: number;
  readonly idempotencyKey: string;
  readonly status: TransferStatus;
  readonly failureReason?: string;
  readonly initiatedAt: string;
}

/**
 * What one transfer contributes to the pooled FBO balance: money that SETTLED and stayed.
 * A returned transfer contributes zero — the money moved and then moved back — which is
 * exactly the arithmetic the contract suite's reconcile case asserts.
 */
function pooledContributionCents(record: TransferRecord): number {
  if (record.status !== "completed") return 0;
  return record.direction === "deposit" ? record.amountCents : -record.amountCents;
}

export function createMockPaymentsProvider(clock: Clock, options: MockPaymentsOptions = {}): MockPaymentsProvider {
  const surfaceCardFee = options.surfaceCardFee ?? MOCK_PAYMENTS_CONFIG.surfaceCardFee;
  const accounts = new Map<string, string>();
  const transfers = new Map<TransferRef, TransferRecord>();
  const refByIdempotencyKey = new Map<string, TransferRef>();
  const callbackQueue: RawProviderCallback[] = [];
  let injectedDeclineReason: string | undefined;
  let nextRefSequence = 1;

  /** Sign-and-queue exactly what a real rail's webhook would deliver: raw body, header value. */
  function queueCallback(event: PaymentsEvent): void {
    const body = JSON.stringify(event);
    callbackQueue.push({ body, signature: signProviderCallback(body) });
  }

  function requireTransfer(ref: TransferRef): TransferRecord {
    const record = transfers.get(ref);
    if (record === undefined) {
      throw new Error(`Unknown transfer ref "${ref}". The mock never issued it.`);
    }
    return record;
  }

  function intentFor(record: TransferRecord): TransferIntent {
    return {
      ref: record.ref,
      direction: record.direction,
      amountCents: record.amountCents,
      status: record.status,
      ...(record.failureReason === undefined ? {} : { failureReason: record.failureReason }),
      initiatedAt: record.initiatedAt,
    };
  }

  /**
   * The one initiation path for both directions: guards (caller bugs, thrown), idempotent
   * replay (the same transfer answered at its current status), then decline-or-pend. The
   * sentinel amount and the injected reason both decline TYPED — a decline is a business
   * outcome the form renders, never an exception.
   */
  function initiate(direction: "deposit" | "withdrawal", input: DepositInput | WithdrawalInput): TransferIntent {
    if (!accounts.has(input.userId)) {
      throw new Error(`No provider account for user "${input.userId}". Call ensureAccount first.`);
    }
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
      throw new Error(`Transfer amounts must be a positive integer number of cents (got ${input.amountCents}).`);
    }
    const existingRef = refByIdempotencyKey.get(input.idempotencyKey);
    if (existingRef !== undefined) {
      const existing = requireTransfer(existingRef);
      if (existing.direction !== direction || existing.userId !== input.userId || existing.amountCents !== input.amountCents) {
        throw new Error(
          `Replayed idempotency key "${input.idempotencyKey}" disagrees with the transfer it created (${existing.direction} of ${existing.amountCents} cents).`,
        );
      }
      return intentFor(existing);
    }

    const declineReason = injectedDeclineReason ?? (input.amountCents === MOCK_PAYMENTS_CONFIG.declineAmountCents ? MOCK_PAYMENTS_CONFIG.declineReason : undefined);
    injectedDeclineReason = undefined;
    const record: TransferRecord = {
      ref: `mock-transfer-${nextRefSequence++}`,
      direction,
      userId: input.userId,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      status: declineReason === undefined ? "pending" : "failed",
      ...(declineReason === undefined ? {} : { failureReason: declineReason }),
      initiatedAt: clock.now(),
    };
    transfers.set(record.ref, record);
    refByIdempotencyKey.set(input.idempotencyKey, record.ref);
    return intentFor(record);
  }

  return {
    async ensureAccount(userId) {
      const existing = accounts.get(userId);
      if (existing !== undefined) return existing;
      const ref = `mock-account-${userId}`;
      accounts.set(userId, ref);
      return ref;
    },

    async initiateDeposit(input) {
      return initiate("deposit", input);
    },

    async initiateWithdrawal(input) {
      return initiate("withdrawal", input);
    },

    async getTransferStatus(ref) {
      return requireTransfer(ref).status;
    },

    listSupportedMethods(): readonly MethodDescriptor[] {
      const card = surfaceCardFee
        ? MOCK_PAYMENTS_CONFIG.methods.card
        : { ...MOCK_PAYMENTS_CONFIG.methods.card, feeCents: 0, feePercentBasisPoints: 0 };
      return [
        { method: "bank", ...MOCK_PAYMENTS_CONFIG.methods.bank },
        { method: "card", ...card },
      ];
    },

    async getPooledBalanceCents() {
      let total = 0;
      for (const record of transfers.values()) total += pooledContributionCents(record);
      return total;
    },

    advance() {
      for (const record of transfers.values()) {
        if (record.status !== "pending") continue;
        transfers.set(record.ref, { ...record, status: "completed" });
        queueCallback({
          type: record.direction === "deposit" ? "deposit_completed" : "withdrawal_completed",
          ref: record.ref,
          amountCents: record.amountCents,
        });
      }
    },

    triggerReturn(ref) {
      const record = requireTransfer(ref);
      if (record.status !== "completed") {
        throw new Error(`Only a completed transfer can be returned; "${ref}" is ${record.status}.`);
      }
      transfers.set(ref, { ...record, status: "returned" });
      queueCallback({
        type: record.direction === "deposit" ? "deposit_returned" : "withdrawal_returned",
        ref,
        amountCents: record.amountCents,
      });
    },

    failNextInitiation(reason) {
      injectedDeclineReason = reason;
    },

    failPendingWithdrawal(ref, reason) {
      const record = requireTransfer(ref);
      if (record.direction !== "withdrawal") {
        throw new Error(`Only a withdrawal can fail asynchronously; "${ref}" is a ${record.direction}. A deposit's late failure is a return.`);
      }
      if (record.status !== "pending") {
        throw new Error(`Only a pending withdrawal can fail asynchronously; "${ref}" is ${record.status}.`);
      }
      transfers.set(ref, { ...record, status: "failed", failureReason: reason });
      queueCallback({ type: "withdrawal_failed", ref, amountCents: record.amountCents });
    },

    drainCallbacks() {
      return callbackQueue.splice(0, callbackQueue.length);
    },
  };
}
