/**
 * Seam A: the interface between this product and whoever actually moves money in and out of it.
 *
 * EXTERNAL money motion only. Deposits, withdrawals and their asynchronous fates cross this
 * seam; nothing else does. Entry fees, escrow, prizes, refunds and rake are internal
 * double-entry postings (`src/money-service/post.ts`) that never touch a provider, and the
 * provider never sees this product's ledger: no `MoneyAccountId`, no league, no posting shape
 * appears below. The provider speaks its own language — transfer intents and its own references
 * — and `postMoneyTransaction`'s `providerTransferRef` is where the two vocabularies meet,
 * as an opaque string the ledger stores but never parses.
 *
 * The shape is the payments dossier's §3.1 sketch verbatim
 * (`docs/research/2026-08-24-phase4-payments-research.md`), the same seam discipline as
 * `StatsProvider` (`src/stats/provider.ts`): product code imports THIS interface from ONE
 * module, a fail-fast registry (`./registry.ts`) selects the implementation from env, and one
 * contract suite (`./contract-suite.ts`) runs against every implementation, mock included. A
 * real rail (Column / Aeropay / Paysafe — founder decisions 2-4) plugs in as another
 * implementation of this interface, not a rewrite.
 *
 * All amounts are integer cents, the same law as everywhere else in the money code
 * (`src/money/config.ts`'s `formatUsd` docblock: floating-point dollars is how a cent of drift
 * enters a ledger that is supposed to reconcile exactly).
 */

/**
 * Where a transfer is in its life, as the provider tells it.
 *
 * `returned` is the member that makes this seam worth having: an ACH transfer that COMPLETED
 * can come back days later (NACHA return codes — R01 insufficient funds, R10 unauthorized),
 * money the product already credited and now must claw back. It is a fourth terminal-looking
 * state reachable FROM `completed`, not a flavor of `failed`, and the contract suite refuses
 * any implementation that cannot represent that transition.
 */
export const TRANSFER_STATUSES = ["pending", "completed", "failed", "returned"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/**
 * The provider's own reference for a transfer. Opaque here and everywhere: the ledger stores it
 * (`providerTransferRef`), the ingestion point keys callbacks by it, and nothing on our side
 * ever parses or fabricates one.
 */
export type TransferRef = string;

/** The provider's own reference for a user's account on ITS side. Opaque, same as `TransferRef`. */
export type ProviderAccountRef = string;

/**
 * The rails a deposit can arrive on. `bank` (Aeropay-class pay-by-bank) is the launch rail and
 * every implementation must support it; `card` is founder-gated on a gaming-MCC merchant
 * account clearing underwriting (founder decision 4), listed so the vocabulary exists before
 * the rail does.
 */
export const DEPOSIT_METHODS = ["bank", "card"] as const;
export type DepositMethod = (typeof DEPOSIT_METHODS)[number];

/**
 * Where a withdrawal goes: a linked bank account, by the provider's own reference for it.
 * Bank ONLY, deliberately and permanently — the closed-loop wallet has no card withdrawals
 * (chargeback-control posture, recorded in the plan's gateway application pack), so the type
 * does not model a method choice that must never exist.
 */
export interface WithdrawalDestination {
  /** The provider's reference for the user's linked external bank account. Opaque. */
  readonly externalAccountRef: string;
}

export interface DepositInput {
  /** This product's user id, for the provider to bind to ITS account (`ensureAccount`). */
  readonly userId: string;
  /** Integer cents. */
  readonly amountCents: number;
  readonly method: DepositMethod;
  /**
   * Required, never optional: a double-submitted form and a retried request must become the
   * SAME transfer. The provider answers a replayed key with the original transfer, never a
   * second one — asserted by the contract suite.
   */
  readonly idempotencyKey: string;
}

export interface WithdrawalInput {
  readonly userId: string;
  /** Integer cents. */
  readonly amountCents: number;
  readonly destination: WithdrawalDestination;
  /** Same law as `DepositInput.idempotencyKey`. */
  readonly idempotencyKey: string;
}

/**
 * What an initiation call answers: the provider's reference, what it accepted, and where the
 * transfer stands right now. A DECLINE is a `TransferIntent` with `status: "failed"` and a
 * `failureReason` — typed data, never a thrown string — because a decline is a normal business
 * outcome the deposit form has to render, not an exceptional condition.
 */
export interface TransferIntent {
  readonly ref: TransferRef;
  readonly direction: "deposit" | "withdrawal";
  /** Integer cents, exactly as requested — a provider that shaves a fee off it fails the suite. */
  readonly amountCents: number;
  readonly status: TransferStatus;
  /** Present exactly when `status` is `"failed"`: the provider's stated reason, for the UI. */
  readonly failureReason?: string;
  /** ISO 8601, from the implementation's injected clock — never `Date.now()` in disguise. */
  readonly initiatedAt: string;
}

/**
 * Fee and ETA for one supported method, so the wallet UI renders figures the provider stated
 * rather than inventing either. The fee is a flat component plus a percentage component
 * (basis points), because the modeled card fee is percent-plus-fixed (3.25% + $0.30 at
 * gaming-MCC rates) while pay-by-bank is flat zero; a single flat `feeCents` cannot say both.
 * Whether the card fee is SURFACED to players or eaten is a founder question (Task 14) — the
 * mock ships it surfaced-off, reporting zeros, so no player sees a number the founder has not
 * priced.
 */
export interface MethodDescriptor {
  readonly method: DepositMethod;
  /** Flat fee component the player pays, integer cents. 0 when eaten or free. */
  readonly feeCents: number;
  /** Percentage fee component in basis points (325 = 3.25%). 0 when eaten or free. */
  readonly feePercentBasisPoints: number;
  /** Player-facing copy, e.g. "1-3 business days". The UI shows it verbatim. */
  readonly etaDescription: string;
}

/**
 * The seam itself — see the module docblock. Async status changes (a pending transfer
 * completing, a completed transfer RETURNING) arrive as provider callbacks through the one
 * ingestion point (`./ingest.ts`), never through polling loops scattered over the product.
 */
export interface PaymentsProvider {
  /**
   * Idempotent onboarding: the same user always answers the same reference, and calling
   * it twice creates nothing. Every initiation requires the account to exist first.
   */
  ensureAccount(userId: string): Promise<ProviderAccountRef>;
  initiateDeposit(input: DepositInput): Promise<TransferIntent>;
  initiateWithdrawal(input: WithdrawalInput): Promise<TransferIntent>;
  getTransferStatus(ref: TransferRef): Promise<TransferStatus>;
  /** Fee + ETA per supported method, for the deposit/withdrawal UI. See `MethodDescriptor`. */
  listSupportedMethods(): readonly MethodDescriptor[];
  /**
   * The provider's answer for how much money sits in the pooled FBO account, integer cents.
   * The daily reconcile job compares the ledger's own aggregate against this and alarms on any
   * drift (`MONEY_CONFIG.reconcileToleranceCents` is zero) — an FBO contractual requirement,
   * provable against the mock now.
   */
  getPooledBalanceCents(): Promise<number>;
}
