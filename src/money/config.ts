/**
 * The money vocabulary's root: the tunables every entry-fee form, wallet screen and server
 * writer reads from the SAME object, and the one closed set of refusal reasons `balancedOrRefuse`
 * (`./posting`) and `prizeTableInvariant` (`./prize-table`) hand back instead of a fresh string
 * per call site. Pure, browser-safe, no I/O, no `Date.now()` — the ninth directory on that list,
 * beside `src/chat`, `src/matchmaking`, `src/identity`, `src/help`, `src/reviews`,
 * `src/moderation`, `src/trades` and `src/participation` (`docs/conventions.md`'s directory map,
 * `eslint.config.mjs`'s `BROWSER_SAFE_MODULE_DIRS`). Everything downstream — the creation form's
 * fee ceiling, the wallet's own sentence, the server's enforcement — imports its words from here,
 * exactly the argument that put the roll's vocabulary in `src/matchmaking`.
 */
export const MONEY_CONFIG = {
  /** Founder decision 8: $500 per seat, config not constant. */
  entryFeeCeilingCents: 50_000,
  deposit: { minCents: 5_00, maxPerTransferCents: 1_000_00 },
  withdrawal: { minCents: 5_00 },
  /**
   * Founder decision 6 / Phase 5's "Assumed Phase 4 interface": the threshold the ledger must
   * be able to answer, versioned by tax year because it is already legislation-sensitive
   * (strategy §3.1: $600 TY2025, $2,000 TY2026+). Phase 5 files; Phase 4 only answers.
   */
  reportingThresholdCentsByTaxYear: { 2025: 600_00, 2026: 2_000_00 } as const,
  /** How far ledger-vs-bank may drift before the reconcile check alarms: zero. Any drift is a bug. */
  reconcileToleranceCents: 0,
} as const;

/**
 * The one closed set of refusal reasons the pure money vocabulary hands back, shared by
 * `balancedOrRefuse` (`./posting`) and `prizeTableInvariant` (`./prize-table`) rather than each
 * file inventing its own strings — the same "one vocabulary, every caller reads the same words"
 * reasoning `MONEY_CONFIG` above follows for numbers. A money writer that refuses a transaction
 * (`src/money-service/**`, a later task) surfaces these to `expectNoPostingTookPlace`/
 * `expectNoSettlementTookPlace` assertions verbatim, so the reason a test checks and the reason a
 * refusal actually carries can never drift apart.
 */
export const MONEY_REFUSALS = {
  /** `balancedOrRefuse`: the set's debits and credits do not sum to the same amount. */
  unbalanced: "Debits and credits must sum to the same amount, to the cent.",
  /** `balancedOrRefuse`: a posting's own amount is not a positive whole number of cents. */
  invalidAmount: "Every posting amount must be a positive whole number of cents.",
  /** `balancedOrRefuse`: an empty posting set has nothing to balance and is not a transaction. */
  emptyPostingSet: "A posting set must contain at least one posting.",
  /** `prizeTableInvariant`: the entry fee, rake or seat count is not a sane non-negative count. */
  invalidPrizeTableInputs:
    "Entry fee and rake must be non-negative whole cents, and seats must be a positive whole number.",
  /** `prizeTableInvariant`: a place is non-positive, repeated, skips a rank in the paid
   *  sequence, or its amount is not a positive whole cent value. */
  invalidPrizeTableEntry:
    "Every prize table place must be a positive whole number, listed once, unbroken from 1st place, with a positive whole-cent amount.",
  /** `prizeTableInvariant`: prizes plus rake do not equal the pot exactly. */
  prizeTableMismatch: "Prize table amounts plus rake must equal the pot exactly, to the cent.",
  /**
   * `balancedOrRefuse` and `prizeTableInvariant`: an individual amount, or a sum either function
   * computes from several amounts, has grown past `Number.MAX_SAFE_INTEGER` — JavaScript can no
   * longer represent it as an exact whole number of cents. Two individually safe amounts can
   * still sum past that boundary, so both functions check every input AND every computed sum.
   * Money-first copy, matching the deposit-failure example in the copy rulebook: state what
   * happened to the money before the reason.
   */
  amountOverflow: "No money moved. This amount is too large for the ledger to represent safely.",
  /**
   * `postMoneyTransaction` (`src/money-service/post.ts`, Task 3): the posting would drive a
   * player-facing balance below zero, and the writer refuses rather than clamps (plan ruling 5 —
   * the database's own `money_accounts_balance_floor_ck` is the backstop, this sentence is the
   * front door). Money-first copy, the same discipline as `amountOverflow` above.
   */
  insufficientBalance: "No money moved. The balance available does not cover this amount.",
} as const;

/** The union of every refusal sentence in `MONEY_REFUSALS`, for a writer's own refusal type. */
export type MoneyRefusalReason = (typeof MONEY_REFUSALS)[keyof typeof MONEY_REFUSALS];

/**
 * The one place integer cents become a dollar string, so a wallet balance, an entry-fee label
 * and a prize amount can never round or format differently from each other. Every money amount
 * in this codebase is an integer number of cents (never a float dollar amount) for the same
 * reason `MONEY_CONFIG.reconcileToleranceCents` is zero: floating-point dollars is how a cent of
 * drift enters a ledger that is supposed to reconcile exactly.
 */
export function formatUsd(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new Error(`formatUsd: cents must be a whole number (got ${cents}).`);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
