import { z } from "zod";
import { MONEY_CONFIG, MONEY_REFUSALS } from "@/money/config";
import { US_STATE_CODES } from "@/money/states";
import { DEPOSIT_METHODS } from "@/payments-provider/contract";

/**
 * The money doors' request boundary, the `@/league-service/schemas` idiom: every route under
 * `/api/wallet/**` parses its body through one of these via `parseJson` before any writer runs,
 * so a malformed request is a 400 naming the field and never an exception downstream.
 *
 * `strictObject`, the validate-hard rule: a body carrying keys this boundary does not understand
 * is refused whole. Bounds read `MONEY_CONFIG.deposit` and refuse with the `MONEY_REFUSALS`
 * sentences built FROM those same numbers, so the figure a refusal states and the figure the
 * server enforces cannot drift.
 */
export const depositRequestSchema = z.strictObject({
  /** Integer cents, inside `MONEY_CONFIG.deposit`'s bounds — the same whole-cents law as the book. */
  amountCents: z
    .number()
    .int(MONEY_REFUSALS.invalidAmount)
    .min(MONEY_CONFIG.deposit.minCents, MONEY_REFUSALS.depositBelowMinimum)
    .max(MONEY_CONFIG.deposit.maxPerTransferCents, MONEY_REFUSALS.depositAboveMaximum),
  /** Self-attested at the door this phase (Task 5 Step 2); Phase 5 replaces the producer. */
  stateOfEntry: z.enum(US_STATE_CODES),
  method: z.enum(DEPOSIT_METHODS),
  /**
   * Minted by the deposit form once per submission attempt, so a double-click and a retried
   * request become the SAME transfer at the provider (Seam A's replay law). Bounded because it
   * is untrusted input that becomes part of a provider-side key.
   */
  idempotencyKey: z.string().min(1).max(128),
});

export type DepositRequest = z.infer<typeof depositRequestSchema>;

/**
 * The withdrawal door's request boundary (Task 6), the same discipline as `depositRequestSchema`
 * above. No `method` field — `WithdrawalDestination` (`@/payments-provider/contract`) is bank
 * ONLY, permanently (the closed-loop wallet has no card withdrawals), so there is no choice for a
 * request to carry. No maximum bound either: the member's own LOCKED available balance is the
 * ceiling, and `MONEY_REFUSALS.insufficientBalance` — the writer's balance floor, never a
 * pre-trusted read — is what enforces it.
 */
export const withdrawalRequestSchema = z.strictObject({
  /** Integer cents, at least `MONEY_CONFIG.withdrawal.minCents`. */
  amountCents: z
    .number()
    .int(MONEY_REFUSALS.invalidAmount)
    .min(MONEY_CONFIG.withdrawal.minCents, MONEY_REFUSALS.withdrawalBelowMinimum),
  /** Self-attested at the door this phase (Task 5 Step 2); Phase 5 replaces the producer. */
  stateOfEntry: z.enum(US_STATE_CODES),
  /** The provider's reference for the member's linked external bank account. Opaque. */
  destination: z.strictObject({ externalAccountRef: z.string().min(1) }),
  /**
   * Minted by the withdrawal form once per submission attempt — the deposit idiom. Namespaced
   * per user at the writer (`withdrawal:<userId>:<idempotencyKey>`), so a double-click and a
   * retried request become the SAME transfer and no two users can collide on a shared key.
   */
  idempotencyKey: z.string().min(1).max(128),
});

export type WithdrawalRequest = z.infer<typeof withdrawalRequestSchema>;

/**
 * The KYC submit door's request boundary (Task 7), the same discipline as `depositRequestSchema`.
 * `stateOfEntry` is self-attested here too, for the same reason the deposit and withdrawal doors
 * attest it: it is what `submitKycVerification` (`./kyc.ts`) reads `MONEY_STATES.enabled`'s
 * `minAge` by — the number the provider is handed to attest age-of-majority against
 * (`src/payments-provider/kyc-contract.ts`'s module docblock).
 */
export const kycSubmissionRequestSchema = z.strictObject({
  /** The name on the identity document being verified. Bounded because it is untrusted input
   *  that reaches the provider. */
  legalName: z.string().trim().min(1).max(200),
  /** ISO 8601 calendar date, `YYYY-MM-DD` — the one shape `submitVerification` accepts. */
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date of birth must be in YYYY-MM-DD form."),
  stateOfEntry: z.enum(US_STATE_CODES),
  /** Minted by the KYC form once per submission attempt — the deposit door's own idempotency
   *  idiom, namespaced per user at the writer (`kyc:<userId>:<idempotencyKey>`). */
  idempotencyKey: z.string().min(1).max(128),
});

export type KycSubmissionBody = z.infer<typeof kycSubmissionRequestSchema>;

/**
 * The admin-room self-exclusion clear door's request boundary (Task 7 Step 2): the one field an
 * operator supplies, the member being cleared. No other field — the operator's own id comes from
 * `withAdmin`'s verified session, never from the body (the same discipline `resolveFlag`'s route
 * follows for `operatorUserId`).
 */
export const clearExclusionRequestSchema = z.strictObject({
  userId: z.string().min(1),
});

export type ClearExclusionRequest = z.infer<typeof clearExclusionRequestSchema>;

/**
 * The settlement door's request boundary (Task 10): WHO finished where, and nothing else. NO
 * amount field exists on this shape at all, by design — every dollar figure comes from the
 * league's own stored `payout_table`, read under lock inside `settleSeasonPayouts`, so a request
 * cannot even ATTEMPT to name a prize. `strictObject` at both levels enforces that shape-wise: a
 * body (or a standing) carrying an amount key is refused whole. Bounded because it is untrusted
 * input; empty is legal — a rake-only table pays no places, and the service's own
 * `standingsIncomplete` check is the authority on how many places need naming.
 */
export const settleSeasonRequestSchema = z.strictObject({
  standings: z
    .array(
      z.strictObject({
        place: z.number().int().positive(),
        userId: z.string().min(1).max(128),
      }),
    )
    .max(100),
});

export type SettleSeasonRequest = z.infer<typeof settleSeasonRequestSchema>;

/**
 * The holds door's request boundary (Task 10): which one-way outcome the operator chose for the
 * member named by the path. The member's id lives in the path and the operator's in `withAdmin`'s
 * session — the body carries only the decision, `resolveFlag`'s own separation.
 */
export const holdOutcomeRequestSchema = z.strictObject({
  action: z.enum(["release", "confiscate"]),
});

export type HoldOutcomeRequest = z.infer<typeof holdOutcomeRequestSchema>;
