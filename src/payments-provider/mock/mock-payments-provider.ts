import type { Clock } from "@/domain/timing";
import type { PaymentsProvider, TransferRef } from "../contract";
import type { RawProviderCallback } from "../ingest";

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

export function createMockPaymentsProvider(clock: Clock, options: MockPaymentsOptions = {}): MockPaymentsProvider {
  throw new Error(`Task 4 Step 3 implements createMockPaymentsProvider. (${clock.now()}, ${String(options.surfaceCardFee)})`);
}
